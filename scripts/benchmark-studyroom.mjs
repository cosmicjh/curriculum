import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {benchmarkTargets} from './benchmark-targets.mjs';
import {performanceFixture} from '../tests/performance-fixture.mjs';
import {localTime} from '../src/studyroom-domain.js';
const i=process.argv.indexOf('--output'),output=i>=0?process.argv[i+1]:'test-results/benchmark-studyroom.json',metrics=[];
const countIndex=process.argv.indexOf('--count'),count=countIndex<0?10:Number(process.argv[countIndex+1]);
assert(Number.isInteger(count)&&count>=2&&count<=200);
const targets=await benchmarkTargets({studyroom:true});
try{
 const date=localTime(new Date()).date;
 for(const target of targets){
  const {h}=target,{store}=performanceFixture(),admin=await h.login();
  assert((await h.mutation('restore',{backup:{format:'school-timetable-backup',schemaVersion:1,store}},admin.cookie)).ok);
  const api=(op,data={})=>h.api('studyroom',{op,...data},admin.cookie);target.api=api;
  assert((await api('configuration',{expectedRevision:(await api('dashboard')).data.revision,enabled:true,schedule:{effectiveDate:date,definitions:[{id:'bench',label:'야간',days:[1,2,3,4,5,6,7],start:'00:00',end:'23:59'}]}})).ok);
  const current=(await api('dashboard')).data.current;assert(current);
  await h.sql('INSERT INTO sr_sessions(id,date,label,academic_year,schedule_id,starts_at,ends_at) VALUES(?,?,?,?,?,?,?)',current.id,date,current.label,2026,current.schedule_id,current.starts_at,current.ends_at);
  await h.sql("WITH RECURSIVE days(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM days WHERE n<90) INSERT INTO sr_sessions(id,date,label,academic_year,schedule_id,starts_at,ends_at) SELECT 'bench-'||n,date(?,'-'||n||' days'),'야간',2026,?,date(?,'-'||n||' days')||'T00:00:00Z',date(?,'-'||n||' days')||'T14:59:00Z' FROM days",date,current.schedule_id,date,date);
  await h.sql("WITH roster AS (SELECT s.*,l.person_id,row_number() OVER(ORDER BY s.id) AS seat FROM students s JOIN student_person_links l ON l.term_id=s.term_id AND l.student_id=s.id WHERE s.term_id='2026-2' ORDER BY s.id LIMIT 99) INSERT INTO sr_attendance(id,session_id,person_id,term_id,student_id,student_number,name,seat,state,first_at,last_at,version,note) SELECT se.id||':'||r.id,se.id,r.person_id,r.term_id,r.id,r.grade||printf('%02d',r.class_num)||printf('%02d',r.number),r.name,printf('%02d',r.seat),'active',se.starts_at,se.starts_at,1,'' FROM sr_sessions se CROSS JOIN roster r");
  target.person=(await h.sql('SELECT person_id FROM sr_attendance LIMIT 1')).results[0].person_id;
 }
 const from=new Date(new Date(date+'T00:00:00Z')-30*86400000).toISOString().slice(0,10),range={from,to:date};
 for(const [operation,op,args] of [['srDashboard','dashboard',{}],['srQuery','query',range],['srRecords','query',{...range,recordsOnly:true}],['srCalendar','query',{...range,calendarOnly:true}],['srPerson','query',range],['srStudents','students',{search:'가상학생'}]]){
  const samples=new Map(targets.map(t=>[t,[]]));
  for(let n=0;n<count;n++)for(const target of n%2?[...targets].reverse():targets){
   const r=await target.api(op,operation==='srPerson'?{...args,personId:target.person}:args);assert(r.ok,JSON.stringify(r.error));samples.get(target).push(r);
  }
  for(const target of targets){
   const sorted=samples.get(target).sort((a,b)=>a.elapsed-b.elapsed),m=sorted[Math.floor(count/2)];
   metrics.push({variant:target.variant,operation,count,medianMs:+m.elapsed.toFixed(2),p95Ms:+sorted[Math.ceil(count*.95)-1].elapsed.toFixed(2),maxMs:+sorted.at(-1).elapsed.toFixed(2),rowsRead:+m.headers.get('x-d1-rows-read'),rowsWritten:+m.headers.get('x-d1-rows-written'),bytes:m.bytes});
  }
 }
 const report={measuredAt:new Date().toISOString(),scale:{students:900,sessions:91,attendance:9009,rangeDays:31},environment:'Isolated local Miniflare/D1; synthetic data; wall time is not Worker CPU',metrics};await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.table(metrics);
}finally{for(const {h} of targets)await h.close();}
