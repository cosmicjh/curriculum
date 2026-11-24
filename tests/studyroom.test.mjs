import {setupStudyroom,studyroomFault,studyroomFaultHarness} from './studyroom-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import {localTime,schedule,currentSession} from '../src/studyroom-domain.js';
import {createHash} from 'node:crypto';
import {isTransientStudyroomD1} from '../src/studyroom.js';
const today=()=>localTime(new Date()).date;
test('D1 studyroom: shared roster, durable identity, teacher notes, archive and concurrency',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());const {admin,teacher,api,revision}=await setupStudyroom(h);
 let first,second;const submit=(studentNumber,seat,requestId=crypto.randomUUID())=>api('submit',{studentNumber,seat,requestId},'');
 await t.test('anonymous API cannot enumerate students or edit attendance; teacher access is separate from admin configuration',async()=>{
  for(const op of ['dashboard','students','query','configuration','change','export','closeDue'])assert.equal((await api(op,{},'')).status,401);
  assert.equal((await api('configuration',{},teacher.cookie)).status,401);
  assert.equal((await api('change',{change:'confirm',requestId:crypto.randomUUID()},teacher.cookie)).code,'INVALID_REQUEST');
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
 await t.test('teacher notes, cancellation, restore and audit are retained',async()=>{
  const change=async(change,recordId=first.recordId,extra={})=>api('change',{change,recordId,reason:'가상 정정',requestId:crypto.randomUUID(),expectedRevision:await revision(),expectedRecordVersion:(await h.sql('SELECT version FROM sr_attendance WHERE id=?',recordId)).results[0].version,...extra},teacher.cookie);
  for(const note of ['a'.repeat(150),'가'.repeat(50),'🙂'.repeat(37)+'ab'])assert((await change('note',first.recordId,{note})).ok);
  for(const note of ['a'.repeat(151),'가'.repeat(50)+'a','🙂'.repeat(37)+'abc']){
   const rejected=await change('note',first.recordId,{note});assert.equal(rejected.status,400);assert.match(rejected.error,/150byte/);
  }
  const noted=await change('note',first.recordId,{note:'가상 특이사항',actor:'위조교사'});assert(noted.ok,JSON.stringify(noted));assert.equal(noted.data.note,'가상 특이사항');
  assert((await change('cancel')).ok);assert((await change('restore')).ok);
  const hist=await api('history',{recordId:first.recordId},teacher.cookie);assert(hist.data.events.some(e=>e.action==='cancel'));assert(hist.data.events.some(e=>e.action==='restore'));
  assert.equal(hist.data.events.find(e=>e.action==='note').actor,'role:teacher');
  await h.sql("UPDATE sr_sessions SET label='아침' WHERE id=?",noted.data.session_id);
  const q=await api('query',{from:today(),to:today()},teacher.cookie);assert.equal(q.data.totals.records,2);assert(q.data.rows.every(r=>r.label==='오전'));assert.equal(q.data.rows.find(r=>r.id===first.recordId).note,'가상 특이사항');
  const st=(await api('students',{search:'30101'},teacher.cookie)).data.students[0];assert(st.person_id);
  const only=await api('query',{personId:st.person_id,from:today(),to:today(),sessionLabel:'오전'},teacher.cookie);assert.equal(only.data.totals.days,1);
  assert.equal((await api('query',{from:today(),to:today(),sessionLabel:'야간'},teacher.cookie)).data.totals.records,0);
  assert.equal((await h.sql('SELECT revision FROM app_state WHERE id=1')).results[0].revision,2,'attendance never increments timetable revision');
 });
 await t.test('stopping reception retains the current teacher seat display and its history',async()=>{
  assert((await api('configuration',{enabled:false,expectedRevision:await revision()})).ok);
  assert.equal((await api('dashboard')).data.rows.length,2);assert.equal((await submit('30101','09')).code,'CLOSED');
  assert((await api('configuration',{enabled:true,expectedRevision:await revision()})).ok);
 });
 await t.test('unrelated arrivals do not block note edits, but a stale target record does',async()=>{
  const d=(await api('dashboard')).data,r=d.rows.find(r=>r.id===first.recordId);
  assert((await submit('30102','99')).ok);
  const saved=await api('change',{change:'note',note:'갱신한 비고',recordId:r.id,requestId:crypto.randomUUID(),expectedRevision:d.revision,expectedRecordVersion:r.version},teacher.cookie);assert(saved.ok,JSON.stringify(saved));
  const stale=await api('change',{change:'note',note:'오래된 비고',recordId:r.id,requestId:crypto.randomUUID(),expectedRecordVersion:r.version},teacher.cookie);assert.equal(stale.code,'SR_RECORD_CHANGED');
  assert.equal((await h.sql('SELECT note FROM sr_attendance WHERE id=?',r.id)).results[0].note,'갱신한 비고');
 });
 await t.test('manual registration preserves the original first time and refuses a stale session',async()=>{
  const d=(await api('dashboard')).data,r=d.rows.find(r=>r.id===second.recordId);
  assert((await api('change',{change:'cancel',recordId:r.id,requestId:crypto.randomUUID(),reason:'가상 수동 복원 검증',expectedRecordVersion:r.version},teacher.cookie)).ok);
  const body={change:'manual',studentNumber:'30102',seat:'99',reason:'가상 수동 복원 검증'};
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
 await t.test('revoked teacher session cannot change a note',async()=>{
  await h.sql("DELETE FROM sessions WHERE role='teacher'");
  assert.equal((await api('change',{change:'note',recordId:second.recordId,requestId:crypto.randomUUID()},teacher.cookie)).status,401);
 });
});
test('lightweight attendance reads preserve filters, ordering and the 200-row page boundary',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());const {api,teacher}=await setupStudyroom(h);
 const schedule=(await h.sql('SELECT id FROM sr_schedules LIMIT 1')).results[0].id;
 const person=(await h.sql("SELECT person_id FROM student_person_links WHERE student_id='student-one'")).results[0].person_id;
 await h.sql("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<201) INSERT INTO sr_sessions(id,date,label,academic_year,schedule_id,starts_at,ends_at) SELECT 'page-'||i,'2026-10-01','아침',2026,?,'2026-10-01T00:00:00Z','2026-10-01T10:00:00Z' FROM n",schedule);
 await h.sql("INSERT INTO sr_attendance(id,session_id,person_id,term_id,student_id,student_number,name,seat,state,first_at,last_at,version,note) SELECT id,id,?,'2026-2','student-one','30101','가상학생','01','active',starts_at,starts_at,1,'' FROM sr_sessions WHERE id LIKE 'page-%'",person);
 for(const scope of [{},{personId:person}])for(const offset of [0,200]){
  const args={from:'2026-10-01',to:'2026-10-01',sessionLabel:'오전',offset,...scope};
  const full=await api('query',args,teacher.cookie),light=await api('query',{...args,recordsOnly:true},teacher.cookie);
  assert(full.ok&&light.ok);assert.deepEqual(light.data.rows,full.data.rows);assert.equal(light.data.next,offset===0?200:null);assert.equal(light.data.offset,offset);
  assert.equal(light.data.calendar,undefined);assert.equal(light.data.totals,undefined);
 }
 assert.equal((await api('query',{from:'2026-10-01',to:'2026-10-01',sessionLabel:'야간',recordsOnly:true},teacher.cookie)).data.rows.length,0);
 await h.sql("UPDATE sr_attendance SET state='cancelled' WHERE id='page-1'");
 assert.equal((await api('query',{from:'2026-10-01',to:'2026-10-01',recordsOnly:true},teacher.cookie)).data.next,null);
 assert.equal((await api('query',{from:'2026-10-01',to:'2026-10-01',recordsOnly:true,includeCancelled:true},teacher.cookie)).data.next,200);
});

test('new term links require an explicit identity decision; attendance and policy are isolated by active term',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());const {api,admin,teacher,revision}=await setupStudyroom(h);
 assert((await api('submit',{studentNumber:'30101',seat:'01',requestId:crypto.randomUUID()},'')).ok);
 const old=(await h.sql("SELECT person_id FROM student_person_links WHERE term_id='2026-2' AND student_id='student-one'")).results[0].person_id;
 const settings={...backup().store.settings,academicYear:2027,semester:1};assert((await h.mutation('saveSettings',{settings},admin.cookie)).ok);
 const created=await h.mutation('saveStudent',{student:{grade:'3',classNum:'1',number:'1',name:'가상학생하나',choices:{}}},admin.cookie);assert(created.ok);
 const id=created.data.result.id,newPerson=(await h.sql("SELECT person_id FROM student_person_links WHERE term_id='2027-1' AND student_id=?",id)).results[0].person_id;assert.notEqual(old,newPerson);
 assert((await api('linkStudent',{studentId:id,personId:old,expectedRevision:await revision()})).ok);
 assert.equal((await api('query',{personId:old,from:today(),to:today()},teacher.cookie)).data.totals.records,0);
 assert.equal((await api('dashboard')).data.enabled,false);
 assert((await h.mutation('switchTerm',{term:'2026-2'},admin.cookie)).ok);
 assert.equal((await api('dashboard')).data.enabled,true);
 assert.equal((await api('query',{personId:old,from:today(),to:today()},teacher.cookie)).data.totals.records,1);
});
test('schedule validation, Seoul boundaries, and feature-disabled production defaults',async t=>{
 assert.throws(()=>schedule({effectiveDate:'2026-11-01',definitions:[{id:'x',label:'오류',start:'10:00',end:'09:00',days:[1]}]},'2026-11-01'));
 const ctx={settings:{academicYear:2026}},s=[{id:'s',effective_date:'2026-01-01',definitions:JSON.stringify([{id:'x',label:'가상',start:'08:00',end:'09:00',days:[1]}])}];assert(currentSession(s,ctx,'2026-11-01T23:00:00Z'));assert.equal(currentSession(s,ctx,'2026-11-02T00:00:00Z'),null);
 const h=await harness();t.after(()=>h.close());assert.equal((await h.api('studyroom',{op:'studentInfo',studentNumber:'30101',seat:'01'})).status,404);
});

test('D1 retry classification uses documented transient binding failures',()=>{
 for(const message of [
  'Network connection lost.',
  'D1 DB reset because its code was updated.',
  'Internal error while starting up D1 DB storage caused object to be reset.',
  'Internal error in D1 DB storage caused object to be reset.',
  'Replica disconnected from primary.',
  'Cannot resolve D1 DB due to transient issue on remote node.',
  "Can't read from request stream because client disconnected.",
  'D1 DB is overloaded. Requests queued for too long.',
  'D1 DB is overloaded. Too many requests queued.',
  'D1 DB is overloaded. Too many resources consumed within a 10 second window'
 ])assert(isTransientStudyroomD1(Error('D1_ERROR: '+message)),message);
 assert(isTransientStudyroomD1(new Error('D1_ERROR',{cause:Error('Network connection lost.')})));
 for(const message of [
  'no such table: sr_attendance',
  'UNIQUE constraint failed: sr_attendance.id',
  "Your account has exceeded D1's free tier daily row write limit.",
  'D1 DB storage operation exceeded timeout which caused object to be reset.',
  'D1 DB exceeded its CPU time limit and was reset.'
 ])assert(!isTransientStudyroomD1(Error('D1_ERROR: '+message)),message);
});

test('student submit retries transient D1 and write conflicts with replay before another commit',async t=>{
 for(const [phase,count,message,expectedStatus,commits] of [
  ['beforeCommit',1,'D1_ERROR: Network connection lost.',200,2],
  ['afterCommit',1,'D1_ERROR: Network connection lost.',200,1],
  ['beforeCommit',4,'D1_ERROR: sr_revision_conflict: SQLITE_CONSTRAINT',200,5],
  ['beforeCommit',1,'D1_ERROR: sr_record_conflict: SQLITE_CONSTRAINT',200,2],
  ['beforeCommit',1,{cause:'sr_revision_conflict: SQLITE_CONSTRAINT'},200,2],
  ['beforeCommit',1,{cause:'sr_record_conflict: SQLITE_CONSTRAINT'},200,2],
  ['beforeCommit',1,{cause:'UNIQUE constraint failed: sr_attendance.session_id, sr_attendance.person_id'},200,2],
  ['replay',1,'D1_ERROR: Network connection lost.',200,1],
  ['beforeCommit',5,'D1_ERROR: D1 DB is overloaded. Too many requests queued.',503,5],
  ['beforeCommit',5,'D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window',503,1],
  ['beforeCommit',5,'D1_ERROR: sr_revision_conflict: SQLITE_CONSTRAINT',503,5]
 ])await t.test(phase+' × '+count+' · '+(message.cause?'cause: '+message.cause:message),async t=>{
  const h=await studyroomFaultHarness();t.after(()=>h.close());const {api}=await setupStudyroom(h);
  const input={studentNumber:'30101',seat:'01'};
  const confirmed=await api('studentInfo',input,'');assert(confirmed.ok);
  const args={...input,studentKey:confirmed.data.studentKey,requestId:crypto.randomUUID()};
  const response=await api('submit',args,'',studyroomFault(phase,count,message));
  assert.equal(response.status,expectedStatus,JSON.stringify(response));
  assert.equal(Number(response.headers.get('X-Test-Studyroom-Commits')),commits);
  const [record]= (await h.sql('SELECT id, version FROM sr_attendance')).results;
  const events=(await h.sql('SELECT request_id,record FROM sr_events WHERE action=?','submit')).results;
  if(expectedStatus===503){
   assert.deepEqual([response.code,response.error],['SR_RETRY','접속이 많아 저장하지 못했습니다. 출석 제출을 다시 누르세요.']);
   assert.equal(record,undefined);assert.equal(events.length,0);
  }else{
   assert.deepEqual(record,{id:response.data.recordId,version:1});
   assert.equal(events.length,1);assert.equal(events[0].request_id,args.requestId);
   assert.deepEqual(response.data,JSON.parse(events[0].record));
   assert.deepEqual((await api('submit',args,'',studyroomFault('beforeCommit',5))).data,response.data);
  }
 });
});

test('cause-only D1 business failures keep their student responses without retrying the commit',async t=>{
 const h=await studyroomFaultHarness();t.after(()=>h.close());const {api}=await setupStudyroom(h);
 for(const [cause,code,error] of [
  ['sr_session_closed: SQLITE_CONSTRAINT','CLOSED','회차가 마감되었습니다. 교사에게 확인하세요.'],
  ['UNIQUE constraint failed: sr_attendance.session_id, sr_attendance.seat','SEAT_OCCUPIED','이미 사용 중인 좌석입니다. 교사에게 확인하세요.']
 ]){
  const result=await api('submit',{studentNumber:'30101',seat:'01',requestId:crypto.randomUUID()},'',studyroomFault('beforeCommit',5,{cause}));
  assert.deepEqual([result.status,result.code,result.error,result.headers.get('X-Test-Studyroom-Commits')],[409,code,error,'1']);
 }
 assert.equal((await h.sql('SELECT count(*) n FROM sr_attendance')).results[0].n,0);
 assert.equal((await h.sql("SELECT count(*) n FROM sr_events WHERE action IN ('submit','recordSnapshot')")).results[0].n,0);
});

test('studyroom student preflight D1 faults and Pages rate-limit headers are scoped to student operations',async t=>{
 const h=await studyroomFaultHarness();t.after(()=>h.close());const {api,admin}=await setupStudyroom(h);
 const origin='https://cosmicjh.github.io',cors='Server-Timing, X-D1-Rows-Read, X-D1-Rows-Written';
 const ip='school-nat',args={studentNumber:'30101',seat:'01',requestId:crypto.randomUUID()};
 for(const op of ['studentInfo','submit'])for(const phase of ['context','limit']){
  const result=await api(op,args,'',studyroomFault(phase));
  assert.deepEqual([result.status,result.code,result.error],[503,'SR_RETRY','접속이 많아 저장하지 못했습니다. 출석 제출을 다시 누르세요.']);
  assert.equal(result.headers.get('X-Test-Studyroom-Attempts'),'1');
  assert.equal(result.headers.get('X-Test-Studyroom-Commits'),'0');
 }
 const teacherFault=await api('dashboard',{},admin.cookie,studyroomFault('context'));
 assert.notEqual(teacherFault.code,'SR_RETRY');
 assert.equal((await h.sql('SELECT count(*) n FROM sr_attendance')).results[0].n,0);
 assert.equal((await api('studentInfo',args,'',{Origin:origin})).headers.get('Access-Control-Expose-Headers'),cors);
 for(const [scope,count] of [['sr-student',1200],['login:teacher',10]]){
  const bucket=scope+':'+createHash('sha256').update(ip).digest('hex');
  await h.sql('INSERT INTO login_limits(bucket,attempts,expires_at) VALUES(?,?,?)',bucket,count,Date.now()+12000);
 }
 const headers={Origin:origin,'CF-Connecting-IP':ip};
 for(const op of ['studentInfo','submit']){
  const result=await api(op,args,'',headers);
  assert.equal(result.status,429);
  assert(Number(result.headers.get('Retry-After'))>=1&&Number(result.headers.get('Retry-After'))<=12);
  assert.equal(result.headers.get('Access-Control-Expose-Headers'),cors+', Retry-After');
 }
 const local=await api('submit',args,'',{'CF-Connecting-IP':ip});
 assert.equal(local.status,429);assert.equal(local.headers.get('Access-Control-Expose-Headers'),null);
 const login=await h.api('login',{role:'teacher'},'',headers);
 assert.equal(login.status,429);assert.equal(login.headers.get('Retry-After'),'60');assert.equal(login.headers.get('Access-Control-Expose-Headers'),cors);
});

test('a roster number swap before the first commit rejects the previously confirmed student key',async t=>{
 const h=await studyroomFaultHarness();t.after(()=>h.close());const {api,admin}=await setupStudyroom(h);
 const [ada,ben]=await Promise.all([
  api('studentInfo',{studentNumber:'30101',seat:'03'},''),
  api('studentInfo',{studentNumber:'30102',seat:'02'},'')
 ]);
 assert.match(ada.data.studentKey,/^[a-f0-9]{64}$/);
 assert.match(ben.data.studentKey,/^[a-f0-9]{64}$/);
 assert.notEqual(ada.data.studentKey,ben.data.studentKey);
 for(const [studentNumber,seat] of [['30101','01'],['30102','02']]){
  const legacy=await api('submit',{studentNumber,seat,requestId:crypto.randomUUID()},'');assert(legacy.ok);
  assert.equal(legacy.data.studentKey,undefined);
 }
 const read=async()=>(await h.sql('SELECT * FROM sr_attendance ORDER BY student_id')).results;
 const before=await read();
 const body={studentNumber:'30101',studentKey:ada.data.studentKey,seat:'03',expectedSessionId:ada.data.session.id,requestId:crypto.randomUUID()};
 const pending=api('submit',body,'',studyroomFault('commitGate',1,undefined,2));
 try{
  await h.waitForCommit();
  for(const [id,number] of [['student-one','3'],['student-two','1'],['student-one','2']]){
   const {student}=(await h.api('adminStudent',{id},admin.cookie)).data;
   const save=await h.mutation('saveStudent',{student:{...student,number}},admin.cookie);assert(save.ok,JSON.stringify(save));
  }
 }finally{await h.releaseCommit();}
 const rejected=await pending;
 assert.deepEqual([rejected.status,rejected.code,rejected.error],[409,'STUDENT_CHANGED','학생 정보가 변경되었습니다. 이름 확인을 다시 하세요.']);
 assert.equal(rejected.headers.get('X-Test-Studyroom-Revision-Conflicts'),'1');
 assert.equal(rejected.headers.get('X-Test-Studyroom-Replay-Failures'),'1');
 assert.deepEqual(await read(),before);
 assert.equal((await h.sql('SELECT count(*) n FROM sr_events WHERE request_id=?',body.requestId)).results[0].n,0);
 const fresh=(await api('studentInfo',body,'')).data;assert.equal(fresh.studentKey,ben.data.studentKey);
 const accepted=await api('submit',{...body,studentKey:fresh.studentKey},'');assert(accepted.ok);
 const legacyReplay=await api('submit',{...body,studentKey:undefined},'');assert.deepEqual(legacyReplay.data,accepted.data);
});

test('confirmed business errors survive a transient final replay failure',async t=>{
 const h=await studyroomFaultHarness();t.after(()=>h.close());const {api,admin,revision}=await setupStudyroom(h);
 const submit=(data,headers={})=>api('submit',{studentNumber:'30101',seat:'01',requestId:crypto.randomUUID(),...data},'',headers);
 assert((await submit({})).ok);
 for(const [data,status,code] of [
  [{studentNumber:'30199'},404,'NOT_ELIGIBLE'],
  [{expectedSessionId:'other-session'},409,'SESSION_CHANGED'],
  [{studentNumber:'30102'},409,'SEAT_OCCUPIED'],
  [{studentKey:'other-student'},409,'STUDENT_CHANGED']
 ]){
  const result=await submit(data,studyroomFault('responseReplay',0,undefined,1));
  assert.deepEqual([result.status,result.code,result.headers.get('X-Test-Studyroom-Replay-Failures')],[status,code,'1']);
 }
 assert((await api('configuration',{expectedRevision:await revision(),enabled:false})).ok);
 const closed=await submit({},studyroomFault('responseReplay',0,undefined,1));
 assert.deepEqual([closed.status,closed.code,closed.headers.get('X-Test-Studyroom-Replay-Failures')],[409,'CLOSED','1']);
 assert((await api('configuration',{expectedRevision:await revision(),enabled:true})).ok);
 const pending=submit({},studyroomFault('commitGate',1,undefined,2));
 try{
  await h.waitForCommit();
  const settings={...backup().store.settings,academicYear:2027,semester:1};
  assert((await h.mutation('saveSettings',{settings},admin.cookie)).ok);
 }finally{await h.releaseCommit();}
 const changed=await pending;
 assert.deepEqual([changed.status,changed.code,changed.headers.get('X-Test-Studyroom-Replay-Failures')],[409,'TERM_CHANGED','1']);
 assert.equal((await h.sql("SELECT count(*) n FROM sr_events WHERE action='submit'")).results[0].n,1);
});

test('a closed session returns 409 and still replays an already committed request',async t=>{
 const h=await studyroomFaultHarness();t.after(()=>h.close());const {api}=await setupStudyroom(h);
 const body={studentNumber:'30101',seat:'01',requestId:crypto.randomUUID()};
 const accepted=await api('submit',body,'');assert(accepted.ok);
 const worker=await h.mf.getWorker();
 await worker.scheduled({scheduledTime:new Date(accepted.data.session.date+'T23:59:01+09:00'),cron:'* * * * *'});
 assert.equal((await h.sql('SELECT status FROM sr_sessions WHERE id=?',accepted.data.session.id)).results[0].status,'closed');
 const closed=await api('submit',{...body,requestId:crypto.randomUUID()},'',studyroomFault('responseReplay',0,undefined,1));
 assert.deepEqual([closed.status,closed.code,closed.error],[409,'CLOSED','회차가 마감되었습니다. 교사에게 확인하세요.']);
 assert.equal(closed.headers.get('X-Test-Studyroom-Replay-Failures'),'1');
 assert.deepEqual((await api('submit',body,'')).data,accepted.data);
 assert.equal((await h.sql("SELECT count(*) n FROM sr_events WHERE action='submit'")).results[0].n,1);
});
