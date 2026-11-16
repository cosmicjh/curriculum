import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {performanceFixture} from '../tests/performance-fixture.mjs';
import {benchmarkTargets} from './benchmark-targets.mjs';
const outputIndex=process.argv.indexOf('--output'),output=outputIndex>=0?process.argv[outputIndex+1]:'test-results/benchmark.json';
const countIndex=process.argv.indexOf('--count'),count=countIndex<0?10:Number(process.argv[countIndex+1]);
assert(Number.isInteger(count)&&count>=2&&count<=200,'--count must be between 2 and 200');
const {store,board}=performanceFixture(),targets=await benchmarkTargets(),metrics=[];
function summarize(operation,samples){
 const sorted=[...samples].sort((a,b)=>a.elapsed-b.elapsed),m=sorted[Math.floor(sorted.length/2)],timing=m.headers.get('server-timing')||'';
 return {operation,count:samples.length,medianMs:+m.elapsed.toFixed(2),p95Ms:+sorted[Math.ceil(sorted.length*.95)-1].elapsed.toFixed(2),maxMs:+sorted.at(-1).elapsed.toFixed(2),bytes:m.bytes,rowsRead:Number(m.headers.get('x-d1-rows-read')),rowsWritten:Number(m.headers.get('x-d1-rows-written')),appMs:Number(/app;dur=([\d.]+)/.exec(timing)?.[1]||0),dbMs:Number(/db;dur=([\d.]+)/.exec(timing)?.[1]||0)};
}
try{
 for(const target of targets){
  const {h}=target;target.cookie=(await h.login()).cookie;target.studentCookie=(await h.login('student')).cookie;
  assert((await h.mutation('restore',{backup:{format:'school-timetable-backup',schemaVersion:1,store}},target.cookie)).ok);
  assert((await h.mutation('saveAllocation',{board},target.cookie)).ok);
 }
 async function measure(operation,run){
  const samples=new Map(targets.map(t=>[t,[]]));
  for(let i=0;i<count;i++)for(const target of i%2?[...targets].reverse():targets){const r=await run(target,i);assert(r.ok,JSON.stringify(r.error));samples.get(target).push(r);}
  for(const target of targets)metrics.push({variant:target.variant,...summarize(operation,samples.get(target))});
 }
 for(const [action,args] of [['bootstrap',{}],['student',{studentNumber:'30101'}],['teacher',{teacher:'가상교사0'}],['adminBootstrap',{}],['adminLinks',{}],['allocation',{}],['classSwap',{swapAction:'resume',swapPayload:{}}]]){
  await measure(action,({h,cookie,studentCookie})=>h.api(action,args,action==='student'?studentCookie:cookie));
 }
 for(const target of targets)target.student=(await target.h.api('adminStudent',{id:'student-3-1-1'},target.cookie)).data.student;
 for(const operation of ['saveStudent','saveAllocation'])await measure(operation,async({h,cookie,student},i)=>{
  let args;if(operation==='saveStudent')args={student:{...student,note:'가상수정'+i}};
  else{const data=(await h.api('allocation',{},cookie)).data;data.board.grades[0].homerooms.r0='가상담임'+i;args={board:data.board,compact:true};}
  return h.mutation(operation,args,cookie);
 });
 const report={measuredAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,runtime:'Local Miniflare/workerd and isolated D1; wall time is not production CPU time',comparison:targets.length>1?'Alternating variants per sample, reversed on odd samples':'Single variant'},scale:{students:900,sections:288,assignments:7200,teachers:120,allocatedSections:192},metrics};
 await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.table(metrics);
}finally{for(const {h} of targets)await h.close();}
