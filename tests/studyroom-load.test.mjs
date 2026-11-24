import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {setupStudyroom,studyroomFault,studyroomFaultHarness} from './studyroom-fixture.mjs';
import {stretchPassword} from '../src/password.js';
async function loadStudents(h){
 const students=Array.from({length:99},(_,i)=>({id:'load-'+i,grade:'1',classNum:String(Math.floor(i/33)+1),number:String(i%33+1),name:'가상부하학생'+i,seat:String(i+1).padStart(2,'0')}));
 await h.sql("INSERT INTO students(term_id,id,source_key,grade,class_num,number,name,status,note,manual_fields,updated_at) SELECT '2026-2',json_extract(value,'$.id'),json_extract(value,'$.id'),json_extract(value,'$.grade'),json_extract(value,'$.classNum'),json_extract(value,'$.number'),json_extract(value,'$.name'),'재학','','[]','' FROM json_each(?)",JSON.stringify(students));
 return students.map(s=>({op:'submit',studentNumber:s.grade+s.classNum.padStart(2,'0')+s.number.padStart(2,'0'),seat:s.seat,requestId:crypto.randomUUID()}));
}
const nat={'CF-Connecting-IP':'one-school-nat'};
test('99 different seats submit concurrently behind one school NAT without a global attendance lock',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());const {api}=await setupStudyroom(h),submissions=await loadStudents(h);
 const start=performance.now(),results=await Promise.all(submissions.map(body=>h.api('studyroom',body,'',nat)));
 assert(results.every(r=>r.ok),JSON.stringify(results.filter(r=>!r.ok).map(r=>({code:r.code,error:r.error}))));
 const d=(await api('dashboard')).data;assert.equal(d.rows.length,99);assert.equal(new Set(d.rows.map(r=>r.seat)).size,99);
 const ms=results.map(r=>r.elapsed).sort((a,b)=>a-b),report={environment:'local Miniflare synthetic-only; not production latency or CPU',concurrentStudents:99,success:results.filter(r=>r.ok).length,totalMs:Math.round(performance.now()-start),p50Ms:Math.round(ms[49]),p95Ms:Math.round(ms[94]),rowsRead:results.reduce((n,r)=>n+Number(r.headers.get('x-d1-rows-read')),0),rowsWritten:results.reduce((n,r)=>n+Number(r.headers.get('x-d1-rows-written')),0)};
 await mkdir('test-results/studyroom',{recursive:true});await writeFile('test-results/studyroom/load.json',JSON.stringify(report,null,2));
});
test('990 requests behind one NAT preserve all 99 student-seat pairs across a real timetable revision conflict',async t=>{
 const h=await studyroomFaultHarness();t.after(()=>h.close());const {api,admin}=await setupStudyroom(h),requests=await loadStudents(h);
 const send=(body,fault)=>h.api('studyroom',body,'',{...nat,...fault});
 const assertSuccess=results=>assert(results.every(r=>r.ok),JSON.stringify(results.filter(r=>!r.ok)));
 const lookups=requests.map(({studentNumber,seat})=>({op:'studentInfo',studentNumber,seat}));
 let confirmed;
 // 99 seats × two operations × five attempts must fit inside a single 1,200-request window.
 for(let attempt=0;attempt<5;attempt++){
  confirmed=await Promise.all(lookups.map(body=>send(body)));
  assertSuccess(confirmed);
 }
 const submissions=requests.map((body,i)=>({...body,studentKey:confirmed[i].data.studentKey,expectedSessionId:confirmed[i].data.session.id}));
 const ctx=(await h.api('bootstrap')).data;
 const first=send(submissions[0],studyroomFault('commitGate'));
 let submitting;
 try{
  await h.waitForCommit();
  submitting=Promise.all(submissions.slice(1).map(body=>send(body)));
  const saved=await h.api('saveBlocks',{expectedTerm:ctx.term,expectedRevision:ctx.revision,grade:'3',blocks:[{grade:'3',day:'목',period:4,block:'A'}]},admin.cookie);
  assert(saved.ok,JSON.stringify(saved));
 }finally{await h.releaseCommit();}
 const gated=await first,results=[gated,...await submitting];
 assertSuccess(results);
 assert.equal(gated.headers.get('X-Test-Studyroom-Revision-Conflicts'),'1');
 assert.equal(gated.headers.get('X-Test-Studyroom-Commits'),'2');
 for(let attempt=1;attempt<5;attempt++){
  const retried=await Promise.all(submissions.map(body=>send(body)));
  assertSuccess(retried);
  assert.deepEqual(retried.map(r=>r.data),results.map(r=>r.data));
 }
 const rows=(await api('dashboard')).data.rows;
 assert.deepEqual(rows.map(r=>[r.student_id,r.student_number,r.seat,r.version]),
  submissions.map((body,i)=>['load-'+i,body.studentNumber,body.seat,1]));
 const events=(await h.sql("SELECT request_id FROM sr_events WHERE action='submit'")).results;
 assert.deepEqual(events.map(e=>e.request_id).sort(),submissions.map(body=>body.requestId).sort());
 assert.deepEqual((await h.sql("SELECT attempts FROM login_limits WHERE bucket LIKE 'sr-student:%'")).results,[{attempts:990}]);
});
test('Pages authentication for attendance notes is bound to the exact origin',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());await setupStudyroom(h);
 const origin='https://cosmicjh.github.io',head=token=>({Origin:origin,...(token?{Authorization:'Bearer '+token}:{})});
 const p=(await h.api('passwordParameters',{role:'teacher'},'',head())).data;
 const logged=await h.api('login',{role:'teacher',password:await stretchPassword('1234',p),credentialEpoch:p.epoch},'',head());assert(logged.ok);
 const bearer=logged.data.token,api=(op,data={})=>h.api('studyroom',{op,...data},'',head(bearer));
 const submitted=await h.api('studyroom',{op:'submit',studentNumber:'30101',seat:'01',requestId:crypto.randomUUID()});assert(submitted.ok);
 const row=(await api('dashboard')).data.rows[0],body={op:'change',change:'note',note:'가상 기록',recordId:row.id,expectedRecordVersion:row.version,requestId:crypto.randomUUID()};
 assert.equal((await h.api('studyroom',body,'',{...head(bearer),Origin:'https://example.org'})).status,403);
 assert((await api('change',body)).ok);
});
