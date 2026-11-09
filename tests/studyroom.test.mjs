import {setupStudyroom} from './studyroom-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import {stretchPassword,newSalt} from '../src/password.js';
import {localTime,schedule,currentSession} from '../src/studyroom-domain.js';
import {createHash} from 'node:crypto';
const today=()=>localTime(new Date()).date;
test('D1 studyroom: shared roster, durable identity, individual confirmation, archive and concurrency',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());const {admin,teacher,staffToken,api,revision}=await setupStudyroom(h);
 let first,second;const submit=(studentNumber,seat,requestId=crypto.randomUUID())=>api('submit',{studentNumber,seat,requestId},'');
 await t.test('anonymous API cannot enumerate students or invoke staff/admin actions; common password cannot confirm',async()=>{
  for(const op of ['dashboard','students','query','configuration','saveStaff','export','closeDue'])assert.equal((await api(op,{},'')).status,401);
  assert.equal((await api('configuration',{},teacher.cookie)).status,401);
  assert.equal((await api('change',{change:'confirm',requestId:crypto.randomUUID()},teacher.cookie)).code,'STAFF_REQUIRED');
  assert.equal((await api('dashboard',{},admin.cookie,{Origin:'https://evil.example'})).status,403);
  for(const seat of ['1','00','100','<script>'])assert.equal((await api('studentInfo',{studentNumber:'30101',seat},'')).status,400);
  const info=await api('studentInfo',{studentNumber:'30101',seat:'01'},'');assert.equal(info.data.name,'가상학생하나');assert.equal(info.data.person_id,undefined);
 });
 await t.test('same request is idempotent, including concurrent retries; seat move preserves first time',async()=>{
  const id=crypto.randomUUID(),pair=await Promise.all([submit('30101','01',id),submit('30101','01',id)]);assert(pair.every(r=>r.ok),JSON.stringify(pair));assert.equal(pair[0].data.recordId,pair[1].data.recordId);first=pair[0].data;
  const mismatch=await submit('30101','02',id);assert.equal(mismatch.code,'REQUEST_REUSED');
  const moved=await submit('30101','09');assert(moved.ok);assert.equal(moved.data.recordId,first.recordId);assert.equal(moved.data.submittedAt,first.submittedAt);
  assert.equal((await submit('30102','09')).code,'SEAT_OCCUPIED');
  const sameSeat=await Promise.all([submit('30101','07'),submit('30102','07')]);assert.equal(sameSeat.filter(r=>r.ok).length,1,JSON.stringify(sameSeat));
  assert.equal((await h.sql("SELECT count(*) n FROM sr_attendance WHERE state='active' AND seat='07'")).results[0].n,1);
  assert((await submit('30101','09')).ok);second=(await submit('30102','99')).data;assert(second);
 });
 await t.test('staff identity is server-derived; confirmation, cancellation, restore and audit are retained',async()=>{
  const change=async(change,recordId=first.recordId,extra={})=>api('change',{change,recordId,reason:'가상 정정',requestId:crypto.randomUUID(),staffToken,expectedRevision:await revision(),expectedRecordVersion:(await h.sql('SELECT version FROM sr_attendance WHERE id=?',recordId)).results[0].version,...extra},teacher.cookie);
  const confirmed=await change('confirm',first.recordId,{confirmed_name:'위조교사'});assert(confirmed.ok,JSON.stringify(confirmed));assert.equal(confirmed.data.confirmed_name,'가상확인교사');
  assert((await change('cancel')).ok);assert((await change('restore')).ok);assert((await change('confirm')).ok);
  const hist=await api('history',{recordId:first.recordId},teacher.cookie);assert(hist.data.events.some(e=>e.action==='cancel'));assert(hist.data.events.some(e=>e.action==='restore'));
  assert.equal(JSON.parse(hist.data.events.find(e=>e.action==='cancel').record).actorName,'가상확인교사');
  const q=await api('query',{from:today(),to:today()},teacher.cookie);assert.equal(q.data.totals.records,2);assert.equal(q.data.calendar[0].confirmed,1);
  const st=(await api('students',{search:'30101'},teacher.cookie)).data.students[0];assert(st.person_id);
  const only=await api('query',{personId:st.person_id,from:today(),to:today(),confirmedOnly:true},teacher.cookie);assert.equal(only.data.totals.days,1);
  assert.equal((await h.sql('SELECT revision FROM app_state WHERE id=1')).results[0].revision,2,'attendance never increments timetable revision');
 });
 await t.test('stopping reception retains the current teacher seat display and its history',async()=>{
  assert((await api('configuration',{enabled:false,expectedRevision:await revision()})).ok);
  assert.equal((await api('dashboard')).data.rows.length,2);assert.equal((await submit('30101','09')).code,'CLOSED');
  assert((await api('configuration',{enabled:true,expectedRevision:await revision()})).ok);
 });
 await t.test('unrelated arrivals do not block confirmation, but a stale target record does',async()=>{
  const d=(await api('dashboard')).data,r=d.rows.find(r=>r.id===first.recordId);
  assert((await submit('30102','99')).ok);
  const saved=await api('change',{change:'confirm',recordId:r.id,requestId:crypto.randomUUID(),staffToken,expectedRevision:d.revision,expectedRecordVersion:r.version},teacher.cookie);assert(saved.ok,JSON.stringify(saved));
  const stale=await api('change',{change:'unconfirm',recordId:r.id,requestId:crypto.randomUUID(),staffToken,expectedRecordVersion:r.version},teacher.cookie);assert.equal(stale.code,'SR_RECORD_CHANGED');
  assert((await h.sql('SELECT confirmed_at FROM sr_attendance WHERE id=?',r.id)).results[0].confirmed_at);
 });
 await t.test('manual registration preserves the original first time and refuses a stale session',async()=>{
  const d=(await api('dashboard')).data,r=d.rows.find(r=>r.id===second.recordId);
  assert((await api('change',{change:'cancel',recordId:r.id,requestId:crypto.randomUUID(),staffToken,reason:'가상 수동 복원 검증',expectedRecordVersion:r.version},teacher.cookie)).ok);
  const body={change:'manual',studentNumber:'30102',seat:'99',staffToken,reason:'가상 수동 복원 검증'};
  assert.equal((await api('change',{...body,requestId:crypto.randomUUID(),expectedSessionId:'old-session'},teacher.cookie)).code,'SESSION_CHANGED');
  const restored=await api('change',{...body,requestId:crypto.randomUUID(),expectedSessionId:d.current.id},teacher.cookie);assert(restored.ok,JSON.stringify(restored));assert.equal(restored.data.first_at,r.first_at);assert.equal(restored.data.id,r.id);
 });
 await t.test('timetable student edits immediately affect lookup; roster restore preserves attendance and person identity',async()=>{
  const p=(await h.sql("SELECT person_id FROM student_person_links WHERE term_id='2026-2' AND student_id='student-one'")).results[0].person_id;
  const s=(await h.api('adminStudent',{id:'student-one'},admin.cookie)).data.student;
  assert((await h.mutation('saveStudent',{student:{...s,name:'가상공유수정',number:'3'}},admin.cookie)).ok);
  assert.equal((await api('studentInfo',{studentNumber:'30103',seat:'01'},'')).data.name,'가상공유수정');assert.equal((await api('studentInfo',{studentNumber:'30101',seat:'01'},'')).status,404);
  assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
  assert.equal((await h.sql("SELECT person_id FROM student_person_links WHERE term_id='2026-2' AND student_id='student-one'")).results[0].person_id,p);
  assert.equal((await h.sql('SELECT count(*) n FROM sr_attendance')).results[0].n,2);
  const membership=await api('setMember',{personId:p,enabled:false,expectedRevision:await revision()});assert(membership.ok);assert.equal((await submit('30101','01')).status,404);
  assert.equal((await api('query',{personId:p,from:today(),to:today()},teacher.cookie)).data.totals.records,1);
  assert((await api('setMember',{personId:p,enabled:true,expectedRevision:await revision()})).ok);
 });
 await t.test('D1 transaction failure leaves neither event nor partial seat change',async()=>{
  await h.sql("CREATE TRIGGER sr_test_failure BEFORE INSERT ON sr_events WHEN NEW.action='submit' BEGIN SELECT RAISE(ABORT,'test_failure'); END");
  const before=(await h.sql('SELECT count(*) n FROM sr_events')).results[0].n;
  assert.equal((await submit('30101','08')).ok,false);
  assert.equal((await h.sql('SELECT count(*) n FROM sr_events')).results[0].n,before);assert.equal((await h.sql('SELECT seat FROM sr_attendance WHERE id=?',first.recordId)).results[0].seat,'09');
  await h.sql('DROP TRIGGER sr_test_failure');
 });
 await t.test('actual scheduled handler closes with no browser, handles archive failure and duplicate invocation',async()=>{
  const worker=await h.mf.getWorker(),time=new Date(new Date(today()+'T23:59:00+09:00').getTime()+1000);
  await h.sql("CREATE TRIGGER sr_test_archive_failure BEFORE INSERT ON sr_archives BEGIN SELECT RAISE(ABORT,'archive_failure'); END");
  await worker.scheduled({scheduledTime:time,cron:'* * * * *'}).catch(()=>{});
  assert.equal((await h.sql("SELECT count(*) n FROM sr_sessions WHERE status='open'")).results[0].n,1);assert.equal((await h.sql('SELECT count(*) n FROM sr_attendance')).results[0].n,2);
  await h.sql('DROP TRIGGER sr_test_archive_failure');
  await worker.scheduled({scheduledTime:time,cron:'* * * * *'});await worker.scheduled({scheduledTime:time,cron:'* * * * *'});
  const archive=(await h.sql('SELECT * FROM sr_archives')).results;assert.equal(archive.length,1);assert.equal(archive[0].record_count,2);assert.equal(createHash('sha256').update(archive[0].content).digest('hex'),archive[0].sha256);
  assert.equal((await h.sql("SELECT count(*) n FROM sr_events WHERE action='close'")).results[0].n,1);assert.equal((await h.sql("SELECT count(*) n FROM sr_sessions WHERE status='closed'")).results[0].n,1);
  const closedCount=(await h.sql('SELECT count(*) n FROM sr_events')).results[0].n;
  assert.equal((await submit('30101','08')).code,'CLOSED','a request cannot append after a concurrent archive');assert.equal((await h.sql('SELECT count(*) n FROM sr_events')).results[0].n,closedCount);assert.equal((await h.sql('SELECT record_count FROM sr_archives')).results[0].record_count,2);
  // Successful request replay still works after reception and the roster change.
  const exported=await api('export');assert(exported.ok);assert.equal(createHash('sha256').update(JSON.stringify(exported.data.data)).digest('hex'),exported.data.sha256);
 });
 await t.test('individual session revocation blocks another confirmation',async()=>{
  await h.sql('UPDATE sr_staff SET enabled=0,epoch=epoch+1');assert.equal((await api('change',{change:'confirm',recordId:second.recordId,requestId:crypto.randomUUID(),staffToken,expectedRevision:await revision()},teacher.cookie)).code,'STAFF_REQUIRED');
 });
});
test('new term links require an explicit identity decision; historical month remains queryable',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());const {api,admin,teacher,revision}=await setupStudyroom(h);
 assert((await api('submit',{studentNumber:'30101',seat:'01',requestId:crypto.randomUUID()},'')).ok);
 const old=(await h.sql("SELECT person_id FROM student_person_links WHERE term_id='2026-2' AND student_id='student-one'")).results[0].person_id;
 const settings={...backup().store.settings,academicYear:2027,semester:1};assert((await h.mutation('saveSettings',{settings},admin.cookie)).ok);
 const created=await h.mutation('saveStudent',{student:{grade:'3',classNum:'1',number:'1',name:'가상학생하나',choices:{}}},admin.cookie);assert(created.ok);
 const id=created.data.result.id,newPerson=(await h.sql("SELECT person_id FROM student_person_links WHERE term_id='2027-1' AND student_id=?",id)).results[0].person_id;assert.notEqual(old,newPerson);
 assert((await api('linkStudent',{studentId:id,personId:old,expectedRevision:await revision()})).ok);
 assert.equal((await api('query',{personId:old,from:today(),to:today()},teacher.cookie)).data.totals.records,1);
});
test('schedule validation, Seoul boundaries, and feature-disabled production defaults',async t=>{
 assert.throws(()=>schedule({effectiveDate:'2026-11-01',definitions:[{id:'x',label:'오류',start:'10:00',end:'09:00',days:[1]}]},'2026-11-01'));
 const ctx={settings:{academicYear:2026}},s=[{id:'s',effective_date:'2026-01-01',definitions:JSON.stringify([{id:'x',label:'가상',start:'08:00',end:'09:00',days:[1]}])}];assert(currentSession(s,ctx,'2026-11-01T23:00:00Z'));assert.equal(currentSession(s,ctx,'2026-11-02T00:00:00Z'),null);
 const h=await harness();t.after(()=>h.close());assert.equal((await h.api('studyroom',{op:'studentInfo',studentNumber:'30101',seat:'01'})).status,404);
});
