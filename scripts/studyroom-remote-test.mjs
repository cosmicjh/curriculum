// Synthetic-only. The hostname guard prevents all writes to the operating app.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {backup} from '../tests/fixture.mjs';
import {stretchPassword,newSalt} from '../src/password.js';
import {localTime} from '../src/studyroom-domain.js';
const root=resolve(import.meta.dirname,'..'),privateFile=name=>resolve(root,'private',name),command=process.argv[2];
const release=JSON.parse(await readFile(privateFile('studyroom-test-release.local.json'),'utf8')),credentials=JSON.parse(await readFile(privateFile('studyroom-test-credentials.local.json'),'utf8'));
const base=release.url;if(!/^https:\/\/school-timetable-studyroom-test-20261106\.[a-z0-9-]+\.workers\.dev$/.test(base))throw Error('Refusing a non-test hostname');
const metrics=[];
async function fetchTLS(url,options={}){
 for(let attempt=0;attempt<5;attempt++)try{return await fetch(url,{...options,signal:AbortSignal.timeout(30000)});}catch(e){if(attempt===4||e.cause?.code!=='ECONNRESET'||!String(e.cause?.message).includes('before secure TLS connection'))throw e;}
}
async function api(action,data={},cookie=''){
 const at=performance.now(),r=await fetchTLS(base+'/api/'+action,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)}),body=await r.json();metrics.push({action,op:data.op,status:r.status,ms:Math.round(performance.now()-at),rowsRead:r.headers.get('X-D1-Rows-Read'),rowsWritten:r.headers.get('X-D1-Rows-Written')});return {...body,status:r.status,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
async function login(role){const p=await api('passwordParameters',{role});assert(p.ok,JSON.stringify(p));const r=await api('login',{role,credentialEpoch:p.data.epoch,password:await stretchPassword(credentials[role+'Password'],p.data)});assert(r.ok,JSON.stringify(r));return r.cookie;}
async function productionSnapshot(){const out={};for(const path of ['/api/health','/assets/app.js']){const r=await fetchTLS('https://school-timetable.cosmicjh.workers.dev'+path);assert(r.ok,'Operating public endpoint unavailable');out[path]={status:r.status,sha256:createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')};}return out;}
const admin=await login('admin'),teacher=await login('teacher'),sr=(op,data={},cookie=admin)=>api('studyroom',{op,...data},cookie),revision=async()=>(await sr('dashboard')).data.revision;
if(command==='seed'){
 const before=await productionSnapshot();await writeFile(privateFile('studyroom-production-readonly-before.local.json'),JSON.stringify(before,null,2));
 const empty=await sr('dashboard');assert.equal(empty.data.revision,0,'Test already seeded; do not overwrite');
 const b=backup();b.store.settings.schoolName='가상 검증 학교';for(let n=3;n<=99;n++)b.store.students.push({id:'synthetic-'+n,sourceKey:'3-1-'+n,grade:'3',classNum:'1',number:String(n),name:'가상검증학생'+n,status:'재학',note:'가상 검증 전용',manualFields:[],updatedAt:'',choices:{}});
 const ctx=(await api('bootstrap')).data;const restored=await api('restore',{backup:b,expectedTerm:ctx.term,expectedRevision:ctx.revision},admin);assert(restored.ok,JSON.stringify(restored));
 const salt=newSalt();assert((await sr('saveStaff',{expectedRevision:await revision(),staff:{username:credentials.staffUsername,name:'가상확인교사',enabled:true,passwordProof:await stretchPassword(credentials.staffPassword,{salt}),passwordSalt:salt,passwordLength:credentials.staffPassword.length}})).ok);
 const now=Date.now(),from=localTime(new Date(now-60000)),end=localTime(new Date(now+4*60000));assert.equal(from.date,end.date,'Use a test window within one Seoul date');
 assert((await sr('configuration',{expectedRevision:await revision(),enabled:true,schedule:{effectiveDate:from.date,definitions:[{id:'remote-synthetic',label:'가상 자동마감 검증',days:[1,2,3,4,5,6,7],start:from.time,end:end.time}]}})).ok);
 const info=await sr('studentInfo',{studentNumber:'30101',seat:'01'},'');assert.equal(info.data.name,'가상학생하나');
 const submitted=await sr('submit',{studentNumber:'30101',seat:'01',requestId:crypto.randomUUID()},'');assert(submitted.ok,JSON.stringify(submitted));
 const second=await sr('submit',{studentNumber:'30102',seat:'99',requestId:crypto.randomUUID()},'');assert(second.ok);
 const jobs=Array.from({length:97},(_,i)=>({studentNumber:'301'+String(i+3).padStart(2,'0'),seat:String(i+2).padStart(2,'0'),requestId:crypto.randomUUID()})),rows=new Array(jobs.length);let cursor=0;
 await Promise.all(Array.from({length:8},async()=>{while(cursor<jobs.length){const i=cursor++;rows[i]=await sr('submit',jobs[i],'');}}));
 assert(rows.every(r=>r.ok),JSON.stringify(rows.filter(r=>!r.ok).map(r=>({status:r.status,code:r.code,error:r.error}))));
 const p=(await sr('staffParameters',{username:credentials.staffUsername},teacher)).data,staff=await sr('staffLogin',{username:credentials.staffUsername,epoch:p.epoch,passwordProof:await stretchPassword(credentials.staffPassword,p)},teacher);assert(staff.ok);
 const confirmed=await sr('change',{change:'confirm',recordId:submitted.data.recordId,requestId:crypto.randomUUID(),staffToken:staff.data.token,expectedRevision:await revision(),expectedRecordVersion:(await sr('dashboard')).data.rows.find(r=>r.id===submitted.data.recordId).version},teacher);assert(confirmed.ok,JSON.stringify(confirmed));assert.equal(confirmed.data.confirmed_name,'가상확인교사');
 const d=await sr('dashboard');assert.equal(d.data.rows.length,99);
 const person=d.data.rows.find(r=>r.id===submitted.data.recordId).person_id,q=await sr('query',{personId:person,from:from.date,to:from.date},teacher);assert.equal(q.data.calendar[0].records,1);assert.equal(q.data.calendar[0].confirmed,1);
 await writeFile(privateFile('studyroom-test-seed.local.json'),JSON.stringify({at:new Date().toISOString(),endsAt:info.data.session.endsAt,date:from.date,personId:person,records:99,worker:release.worker,productionSnapshot:before,metrics},null,2));
 console.log(JSON.stringify({syntheticOnly:true,records:99,additionalSubmissions:97,clientConcurrency:8,confirmed:1,endsAt:info.data.session.endsAt,remoteTestUrl:base}));
}else if(command==='verify-mutations'){
 const seed=JSON.parse(await readFile(privateFile('studyroom-test-seed.local.json'),'utf8'));
 const p=(await sr('staffParameters',{username:credentials.staffUsername},teacher)).data,staff=await sr('staffLogin',{username:credentials.staffUsername,epoch:p.epoch,passwordProof:await stretchPassword(credentials.staffPassword,p)},teacher);assert(staff.ok);
 const current=(await sr('query',{personId:seed.personId,from:seed.date,to:seed.date},teacher)).data.rows[0];assert(current.confirmed_at);
 const change=(kind,r,id=crypto.randomUUID())=>sr('change',{change:kind,recordId:r.id,expectedRecordVersion:r.version,requestId:id,staffToken:staff.data.token,reason:'가상 검증용 확인 정정'},teacher);
 const cancelled=await change('unconfirm',current);assert(cancelled.ok,JSON.stringify(cancelled));assert.equal((await change('confirm',current)).code,'SR_RECORD_CHANGED');
 const id=crypto.randomUUID(),confirmed=await change('confirm',cancelled.data,id);assert(confirmed.ok,JSON.stringify(confirmed));assert.equal(confirmed.data.actorName,'가상확인교사');
 const replayed=await change('confirm',cancelled.data,id);assert.deepEqual(replayed.data,confirmed.data);
 const report={syntheticOnly:true,verifiedAt:new Date().toISOString(),namedActor:true,staleRecordRejected:true,correctionReplayIdempotent:true,confirmedRestored:true};await writeFile(privateFile('studyroom-test-mutation-check.local.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}else if(command==='verify'){
 const seed=JSON.parse(await readFile(privateFile('studyroom-test-seed.local.json'),'utf8')),d=await sr('dashboard'),out=await sr('export');assert(out.ok,JSON.stringify(out));
 const archive=out.data.data.sr_archives,closed=out.data.data.sr_sessions.filter(s=>s.status==='closed');
 const after=await productionSnapshot();assert.deepEqual(after,seed.productionSnapshot,'Operating public app changed during test');
 if(!archive.length){console.log(JSON.stringify({pending:true,endsAt:seed.endsAt,serverAt:d.data.serverAt,lastRunAt:d.data.lastRunAt,lastError:d.data.lastError,records:out.data.data.sr_attendance.length,productionUnchanged:true}));process.exit(2);}
 assert.equal(archive.length,1);assert.equal(closed.length,1);assert.equal(archive[0].record_count,99);assert.equal(out.data.data.sr_attendance.length,99);assert.equal(createHash('sha256').update(archive[0].content).digest('hex'),archive[0].sha256);assert.equal(d.data.rows.length,0);
 const q=await sr('query',{personId:seed.personId,from:seed.date,to:seed.date},teacher);assert.equal(q.data.calendar[0].records,1);assert.equal(q.data.calendar[0].confirmed,1);
 const report={syntheticOnly:true,verifiedAt:new Date().toISOString(),url:base,records:99,archiveRecords:archive[0].record_count,closedAt:closed[0].closed_at,currentDisplayRows:d.data.rows.length,monthlyConfirmed:q.data.calendar[0].confirmed,lastRunAt:d.data.lastRunAt,cronEnabled:d.data.cronEnabled,productionUnchanged:true,metrics};
 await writeFile(privateFile('studyroom-test-verification.local.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,metrics:undefined}));
}else throw Error('Use seed, verify-mutations or verify');
