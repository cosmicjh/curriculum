import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {promisify} from 'node:util';
import {harness} from './harness.mjs';
import {freezeCatalogSql,inspectFreeze,thawGenerationSql} from '../modules/allocation/server/source-freeze.js';
import {privateChild} from '../scripts/migrate-course-allocation.mjs';
import {assemble,boundedJson,validatePart} from '../modules/allocation/server/validation.js';
import {demoState,demoSeed} from '../modules/allocation/tests/fixtures/demo.js';
import {scaleState} from '../modules/allocation/tests/fixtures/scale.js';
import {globalPart,departmentPart,identityKey} from '../modules/allocation/shared/state.js';

const runFile=promisify(execFile);
await mkdir('test-results',{recursive:true});
const run=await mkdtemp(resolve('test-results/course-migration-'));
const persist=resolve(run,'state'),log=[];
const oldRoot=resolve(run,'legacy-handler');
const oldRevision='eb75f3c071cdd19b4d0ba7243d6f58da73890e14';
const git=async args=>(await runFile('git',args,{windowsHide:true})).stdout;
const legacyFiles=(await git(['ls-tree','-r','--name-only',oldRevision,'server','shared'])).trim().split(/\r?\n/).filter(name=>name.endsWith('.js'));
for(const file of legacyFiles){
 const path=resolve(oldRoot,file);
 await mkdir(dirname(path),{recursive:true});
 await writeFile(path,await git(['show',oldRevision+':'+file]));
}
const oldBundle=resolve(oldRoot,'legacy.mjs');
await build({entryPoints:[resolve(oldRoot,'server/api.js')],outfile:oldBundle,bundle:true,format:'esm',platform:'browser'});
const {handleRequest:legacyHandler}=await import(pathToFileURL(oldBundle));
const legacySql=[];
let legacyStatus;

const tag='rehearsal-private-payload';
const operationId='virtual-private-operation-id';
const secretUrl='https://example.invalid/export?signature=virtual-test';
const noLeak=output=>{for(const value of [tag,operationId,secretUrl])assert(!output.includes(value),'Sensitive rehearsal marker reached an output stream');};
const digest=value=>createHash('sha256').update(value).digest('hex');
let legacyOpen=false,releasePause;
const probes=[];
const h=await harness({persistTo:persist,migration:true,legacyProbe:async request=>{
 const path=new URL(request.url).pathname;
 probes.push([request.method,path]);
 if(legacyOpen){
  const response=await legacyHandler(request,{PASSWORD_PEPPER:'a'.repeat(64),DB:{prepare(sql){
   legacySql.push(sql);throw Error('Unexpected DB access by the legacy probe');
  }}});
  legacyStatus=response.status;
  return response;
 }
 if(releasePause&&++releasePause.probes===3){releasePause.reached();await releasePause.resume;}
 return new Response(null,{status:410,headers:{'X-Course-Allocation-Frozen':'1'}});

}});
try{
 const url=await h.listen();
 const {cookie}=await h.login();
 const migrationArgs=['scripts/migrate-course-allocation.mjs','--local','--url',url,'--persist-to',persist];
 const env={...process.env,COURSE_ALLOCATION_ADMIN_COOKIE:cookie};
 async function migrate(flags=[],exit=0,version='rehearsal-cutover'){
  const args=[...migrationArgs,'--expected-version',version,...flags];
  const result=await runFile(process.execPath,args,{env,windowsHide:true}).then(
   ({stdout,stderr})=>({exit:0,stdout,stderr}),error=>({exit:error.code,stdout:error.stdout,stderr:error.stderr})
  );
  noLeak(result.stdout+result.stderr);
  log.push({args:['node',...args],...result});
  assert.equal(result.exit,exit,result.stderr);
  return exit?result.stderr:JSON.parse(result.stdout);
 }
 const operation=async(op,data={})=>h.api('courseAllocationMigration',{version:'rehearsal-cutover',op,...data},cookie);
 const freeze=()=>migrate(['--freeze-source']);
 const thaw=()=>migrate(['--thaw-source']);
 const checkFrozen=()=>migrate(['--check-source-freeze']);
 const edit=view=>h.api('courseWorkspace',{role:'admin',path:'/global',method:'PUT',data:view},cookie);

 const {cookie:teacher}=await h.login('teacher');
 assert.equal((await h.api('courseAllocationMigration',{version:'rehearsal-cutover',op:'status'},teacher)).status,401);
 assert.equal((await h.api('courseAllocationMigration',{version:'rehearsal-cutover',op:'page',side:'source',table:'sheets',dump:true})).status,401);
 assert.equal((await edit({})).code,'allocation_import_paused');
 assert((await h.api('adminSettings',{},cookie)).ok);
 assert.match(await migrate([],1,'old-deployment'),/Worker/);
 const preexisting=await h.sql("SELECT name FROM sqlite_master WHERE name='students'");
 assert.equal(preexisting.results.length,1);
 for(const sql of demoSeed().trim().split(/;\s*/).filter(Boolean))await h.sourceSql(sql);

 const fixture=demoState(),global=globalPart(fixture),parts=fixture.departments.map(d=>departmentPart(fixture,d.id));
 const invalid=structuredClone(parts[0]);
 invalid.assignments[0].teacherId='virtual-missing-teacher';
 await h.sourceSql("UPDATE sheets SET payload=? WHERE id='d1'",JSON.stringify(invalid));
 assert.match(await migrate(['--apply'],1),/checkLegacy, HTTP 503/);
 assert.equal((await freeze()).triggers,27);
 assert.equal((await checkFrozen()).writeRejected,true);
 assert.match(await migrate(['--apply'],1),/원본 업무 무결성/);
 assert.equal((await operation('status')).data.state,'empty');
 await thaw();
 await h.sourceSql("UPDATE sheets SET payload=? WHERE id='d1'",JSON.stringify(parts[0]));
 const idRow=(await h.sourceSql("SELECT kind,entity_id,sheet_id FROM entity_ids ORDER BY kind,entity_id LIMIT 1")).results[0];
 await h.sourceSql('DELETE FROM entity_ids WHERE kind=? AND entity_id=?',idRow.kind,idRow.entity_id);
 await freeze();
 assert.match(await migrate([],1),/원본 업무 무결성/);
 await thaw();
 await h.sourceSql('INSERT INTO entity_ids(kind,entity_id,sheet_id) VALUES(?,?,?)',idRow.kind,idRow.entity_id,idRow.sheet_id);
 const large=(part,bytes)=>{
  const next={...part,fixtureExtension:tag};
  next.fixtureExtension+='x'.repeat(bytes-Buffer.byteLength(JSON.stringify(next)));
  validatePart(global,next,part.department.id);
  assert.equal(Buffer.byteLength(boundedJson(next,'fixture')),bytes);
  return next;
 };
 const sized=[large(parts[0],150000),large(parts[1],1500000)];
 const oldRequest={id:'d1',part:sized[0],revision:6,globalRevision:9};
 const requestHash=digest(JSON.stringify(oldRequest));
 await h.sourceSql('UPDATE workspace SET revision=9 WHERE id=1');
 await h.sourceSql('UPDATE sheets SET payload=?,revision=7,last_operation=?,request_hash=?,updated_at=? WHERE id=?',
  JSON.stringify(sized[0]),operationId,requestHash,Date.now(),'d1');
 await h.sourceSql('UPDATE sheets SET payload=? WHERE id=?',JSON.stringify(sized[1]),'d2');
 const scale=scaleState();
 await h.sourceSql("INSERT INTO term_archives(term,sheet_id,payload) VALUES('2025-2','',?)",JSON.stringify(globalPart(scale)));
 for(const {id} of scale.departments){
  const part=departmentPart(scale,id);
  const payload=id==='d1'?sized[1]:part;
  await h.sourceSql("INSERT INTO term_archives(term,sheet_id,payload,identity_hash) VALUES('2025-2',?,?,?)",
   id,JSON.stringify(payload),digest(identityKey(payload)));
 }
 assert.equal((await freeze()).triggers,27);
 assert.deepEqual(await freeze(),await checkFrozen());
 const first=await migrate();
 assert.equal(first.before.rows.term_archives,13);
 assert.equal(first.before.rows.operations,1);
 assert.equal(first.before.globalRevision,9);
 assert.deepEqual(first.before.revisions,[7,1]);
 legacyOpen=true;
 assert.match(await migrate(['--apply'],1),/checkLegacy, HTTP 409/);
 assert.equal((await operation('status')).data.state,'empty');
 assert.equal(legacyStatus,401);
 assert.deepEqual(legacySql,[]);
 for(const table of ['login_limits','credentials','sessions']){
  assert.equal((await h.sourceSql('SELECT COUNT(*) n FROM '+table)).results[0].n,0);
 }
 legacyOpen=false;
 const applied=await migrate(['--apply']);
 assert.equal(applied.mode,'applied');
 assert.deepEqual(applied.before,applied.after);
 const appState=(await h.api('courseWorkspace',{role:'admin',path:'/state',method:'GET',data:{}},cookie)).data.state;
 const appBackup=JSON.parse(await readFile(resolve(applied.backupDirectory,'source.json'),'utf8'));
 assert.deepEqual(appState,appBackup);
 assert.deepEqual(appState,assemble(global,parts));
 assert.equal((await h.sql("SELECT length(CAST(payload AS BLOB)) n FROM ca_sheets WHERE id='d1'")).results[0].n,150000);
 assert.equal((await h.sql("SELECT length(CAST(payload AS BLOB)) n FROM ca_sheets WHERE id='d2'")).results[0].n,1500000);
 assert.equal((await h.sql("SELECT length(CAST(payload AS BLOB)) n FROM ca_term_archives WHERE term='2025-2' AND sheet_id='d1'")).results[0].n,1500000);
 await access(resolve(applied.backupDirectory,'source.sql'));
 await access(resolve(applied.backupDirectory,'target-recovery.json'));
 assert.deepEqual((await migrate(['--apply'])).after,applied.after);
 assert.equal((await operation('release',{hash:first.before.snapshotSha256})).code,'allocation_not_verified');
 await h.sql("UPDATE ca_import_progress SET phase='copied' WHERE id=1");
 assert.equal((await operation('verifyRelease')).code,'allocation_copy_incomplete');
 await h.sql("UPDATE ca_import_progress SET phase='verified' WHERE id=1");

 await h.sql("UPDATE ca_sheets SET revision=8,last_operation=NULL WHERE id='d1'");
 assert.match(await migrate(['--release'],1),/대조|HTTP 409/);
 assert.equal((await operation('status')).data.state,'paused');

 // A pending thaw acquired through the actual Worker fences a release transition.
 const reserved=await operation('beginThaw');
 assert(reserved.ok&&reserved.data.token);
 assert.equal((await operation('verifyRelease')).code,'allocation_thaw_active');
 await assert.rejects(h.sourceSql("UPDATE sheets SET revision=8,last_operation=NULL WHERE id='d1'"),/ca_source_frozen/);
 // Resume the reserved thaw, then simulate a new save in the old deployment.
 assert.equal((await thaw()).mode,'source-thawed');
 assert.match(await migrate(['--check-source-freeze'],1),/동결 트리거/);
 await h.sourceSql("UPDATE sheets SET revision=8,last_operation=NULL WHERE id='d1'");
 await freeze();
 assert.match(await migrate(['--apply'],1),/원본 해시/);
 legacyOpen=true;
 assert.match(await migrate(['--reset-paused'],1),/checkLegacy, HTTP 409/);
 legacyOpen=false;
 const reset=await migrate(['--reset-paused']);
 assert.equal(reset.mode,'reset');
 await access(resolve(reset.backupDirectory,'target-sheets.jsonl'));
 assert.equal((await operation('status')).data.state,'empty');
 assert((await h.api('adminSettings',{},cookie)).ok);
 assert.equal((await edit({})).code,'allocation_import_paused');
 const second=await migrate(['--apply']);
 assert.deepEqual(second.after.revisions,[8,1]);
 assert.notEqual(second.after.snapshotSha256,first.before.snapshotSha256);

 legacyOpen=true;
 assert.match(await migrate(['--release'],1),/checkLegacy, HTTP 409/);
 legacyOpen=false;

 let state=(await operation('verifyRelease')).data;
 assert.equal(state.phase,'release-check');
 assert.match(await migrate(['--thaw-source'],1),/해제 검증 중/);
 let injected=false;
 while(state.phase==='release-check'){
  const result=await operation('step');
  assert(result.ok,result.error);
  state=result.data;
  const {table_index:index}=(await h.sql('SELECT table_index FROM ca_import_progress WHERE id=1')).results[0];
  if(!injected&&index===2){
   injected=true;
   await assert.rejects(h.sourceSql("UPDATE sheets SET revision=revision+1,last_operation=NULL WHERE id='d1'"),/ca_source_frozen/);
   assert.equal((await h.sourceSql("SELECT revision FROM sheets WHERE id='d1'")).results[0].revision,8);
  }
 }
 assert(injected);
 assert.equal(state.phase,'release-ready');
 const originalFreeze=inspectFreeze((await h.sourceSql(freezeCatalogSql)).results);
 await h.sourceSql('DROP TRIGGER ca_source_freeze_sheets_update');
 await h.sourceSql('DROP TRIGGER ca_source_freeze_operations_insert');
 const absent=await operation('release',{hash:second.after.snapshotSha256});
 assert.equal(absent.status,503);
 assert.equal(absent.code,'allocation_source_unfrozen');
 assert.equal(absent.error,'시수배당 원본 동결을 확인하세요.');
 assert(!JSON.stringify(absent).includes(originalFreeze.generation));
 assert.match(await migrate(['--release'],1),/checkLegacy, HTTP 503/);
 await h.sourceSql("UPDATE sheets SET revision=revision+1,last_operation=?,request_hash=?,updated_at=? WHERE id='d2'",
  'virtual-late-save',digest('virtual-late-request'),Date.now());

 await freeze();
 const repaired=inspectFreeze((await h.sourceSql(freezeCatalogSql)).results);
 assert.equal(repaired.complete,true);
 assert.notEqual(repaired.generation,originalFreeze.generation);
 await assert.rejects(h.sourceSql(thawGenerationSql(originalFreeze.generation)),/malformed JSON/);
 const stale=await operation('release',{hash:second.after.snapshotSha256});
 assert.equal(stale.status,503);
 assert.equal(stale.code,'allocation_source_unfrozen');
 assert(!JSON.stringify(stale).includes(repaired.generation));
 assert.equal((await operation('status')).data.state,'paused');
 assert.equal((await h.sql("SELECT revision FROM ca_sheets WHERE id='d2'")).results[0].revision,1);
 assert.equal((await h.sourceSql("SELECT revision FROM sheets WHERE id='d2'")).results[0].revision,2);

 assert.equal((await migrate(['--reset-paused'])).mode,'reset');
 const repairedCopy=await migrate(['--apply']);
 assert.deepEqual(repairedCopy.after.revisions,[8,2]);

 // Hold the final legacy probe of the release request while a separate CLI tries to thaw.
 let reached,resume;
 const paused=new Promise(resolve=>{reached=resolve;});
 releasePause={probes:0,reached,resume:new Promise(resolve=>{resume=resolve;})};
 const releasing=migrate(['--release']);
 try{
  await Promise.race([paused,releasing.then(()=>assert.fail('Expected the final release probe'))]);
  assert.equal((await operation('status')).data.phase,'release-ready');
  assert.match(await migrate(['--thaw-source'],1),/해제 검증 중/);
  assert.deepEqual(inspectFreeze((await h.sourceSql(freezeCatalogSql)).results),repaired);
 }finally{resume();releasePause=null;}
 const release=await releasing;
 assert.equal(release.mode,'released');
 assert.deepEqual(release.after,repairedCopy.after);
 assert.match(await migrate(['--thaw-source'],1),/해제된 이관은 원복할 수 없습니다/);
 assert.match(await migrate(['--reset-paused'],1),/이미 해제/);
 assert.equal((await operation('reset',{hash:second.after.snapshotSha256})).code,'allocation_released');
 assert.equal((await migrate(['--apply'])).mode,'already-released');
 assert.equal((await checkFrozen()).triggers,27);
 const editPart=structuredClone(parts[0]);
 editPart.teachers[0].name='가상 이관 후 편집';
 const saved=await h.api('courseWorkspace',{role:'admin',path:'/sheets/d1',method:'PUT',data:{
  part:editPart,revision:8,globalRevision:9,operationId:'virtual-new-save'
 }},cookie);
 assert.deepEqual(saved.data,{revision:9},saved.error);
 assert.equal((await h.sourceSql("SELECT revision FROM sheets WHERE id='d1'")).results[0].revision,8);
 assert(probes.length>0&&probes.every(([method,path])=>method==='GET'&&path==='/api/global'));
 assert.deepEqual(legacySql,[]);

 // An isolated child models Wrangler's successful export URL and a verbose failure.
 // If file logging were inherited, it would write the synthetic markers to this path.
 const childLog=resolve(run,'unexpected-wrangler.log');
 const childScript=resolve(run,'dummy-wrangler.mjs');
 await writeFile(childScript,"import {writeFileSync} from 'node:fs';\n"+
  'const markers='+JSON.stringify([tag,operationId,secretUrl].join('\n'))+';\n'+
  "if(process.env.WRANGLER_WRITE_LOGS!=='false')writeFileSync(process.argv[2],markers);\n"+
  'console.log(markers); console.error(markers); process.exitCode=Number(process.argv[3]);\n');
 const priorLogs=process.env.WRANGLER_WRITE_LOGS;
 process.env.WRANGLER_WRITE_LOGS='true';
 try{
  assert.equal(await privateChild(process.execPath,[childScript,childLog,'0']),'');
  await assert.rejects(privateChild(process.execPath,[childScript,childLog,'1']),error=>{
   noLeak(error.message);return error.message.includes('명령이 실패');
  });
  await assert.rejects(access(childLog),{code:'ENOENT'});
 }finally{
  if(priorLogs===undefined)delete process.env.WRANGLER_WRITE_LOGS;else process.env.WRANGLER_WRITE_LOGS=priorLogs;
 }
 const result={initial:applied.before,verified:applied.after,reimported:repairedCopy.after,maxSheetBytes:1500000,
  maxArchiveBytes:1500000,lateWriteBlocked:true,freezeRemovalBlockedRelease:true,partialRepairBlockedStaleRelease:true,activeThawBlockedRelease:true,releaseBlockedConcurrentThaw:true,releasedThawRejected:true,legacyProbeWrites:0,integrityRejected:true,otherModuleAvailable:true,releaseRevision:9,sourceRevision:8,logLeak:false,
  cases:'wrong deployment, source freeze, legacy GET, invalid references and IDs, late write denied, missing freeze, duplicate copy, target mismatch, paused reset, original re-save, repopulate, release'};
 await writeFile(resolve(run,'comparison.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({report:resolve(run,'comparison.json'),...result},null,2));
}finally{
 await writeFile(resolve(run,'commands.json'),JSON.stringify(log,null,2)+'\n');
 await h.close();
}
