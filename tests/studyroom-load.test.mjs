import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {setupStudyroom} from './studyroom-fixture.mjs';
import {stretchPassword} from '../src/password.js';
test('99 different seats submit concurrently behind one school NAT without a global attendance lock',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());const {api}=await setupStudyroom(h);
 const students=Array.from({length:99},(_,i)=>({id:'load-'+i,grade:'1',classNum:String(Math.floor(i/33)+1),number:String(i%33+1),name:'가상부하학생'+i,seat:String(i+1).padStart(2,'0')}));
 await h.sql("INSERT INTO students(term_id,id,source_key,grade,class_num,number,name,status,note,manual_fields,updated_at) SELECT '2026-2',json_extract(value,'$.id'),json_extract(value,'$.id'),json_extract(value,'$.grade'),json_extract(value,'$.classNum'),json_extract(value,'$.number'),json_extract(value,'$.name'),'재학','','[]','' FROM json_each(?)",JSON.stringify(students));
 const start=performance.now(),results=await Promise.all(students.map(s=>h.api('studyroom',{op:'submit',studentNumber:s.grade+s.classNum.padStart(2,'0')+s.number.padStart(2,'0'),seat:s.seat,requestId:crypto.randomUUID()},'',{'CF-Connecting-IP':'one-school-nat'})));
 assert(results.every(r=>r.ok),JSON.stringify(results.filter(r=>!r.ok).map(r=>({code:r.code,error:r.error}))));
 const d=(await api('dashboard')).data;assert.equal(d.rows.length,99);assert.equal(new Set(d.rows.map(r=>r.seat)).size,99);
 const ms=results.map(r=>r.elapsed).sort((a,b)=>a-b),report={environment:'local Miniflare synthetic-only; not production latency or CPU',concurrentStudents:99,success:results.filter(r=>r.ok).length,totalMs:Math.round(performance.now()-start),p50Ms:Math.round(ms[49]),p95Ms:Math.round(ms[94]),rowsRead:results.reduce((n,r)=>n+Number(r.headers.get('x-d1-rows-read')),0),rowsWritten:results.reduce((n,r)=>n+Number(r.headers.get('x-d1-rows-written')),0)};
 await mkdir('test-results/studyroom',{recursive:true});await writeFile('test-results/studyroom/load.json',JSON.stringify(report,null,2));
});
test('Pages authentication and an individual staff token are bound to the exact origin',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());await setupStudyroom(h);
 const origin='https://cosmicjh.github.io',head=token=>({Origin:origin,...(token?{Authorization:'Bearer '+token}:{})});
 const p=(await h.api('passwordParameters',{role:'teacher'},'',head())).data;
 const logged=await h.api('login',{role:'teacher',password:await stretchPassword('1234',p),credentialEpoch:p.epoch},'',head());assert(logged.ok);
 const bearer=logged.data.token,api=(op,data={})=>h.api('studyroom',{op,...data},'',head(bearer));
 assert((await api('dashboard')).ok);const parameters=(await api('staffParameters',{username:'test.teacher'})).data;
 const staff=await api('staffLogin',{username:'test.teacher',epoch:parameters.epoch,passwordProof:await stretchPassword('가상교사1234',parameters)});assert(staff.ok);
 assert.equal((await api('dashboard',{staffToken:staff.data.token})).data.staff.name,'가상확인교사');
 const native=await h.login('teacher');assert.equal((await h.api('studyroom',{op:'dashboard',staffToken:staff.data.token},native.cookie)).data.staff,null);
});
