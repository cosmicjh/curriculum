import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {harness} from './harness.mjs';
import {demoSeed} from '../modules/allocation/tests/fixtures/demo.js';
import {scaleState} from '../modules/allocation/tests/fixtures/scale.js';
import {globalPart,departmentPart,identityKey} from '../modules/allocation/shared/state.js';

const cli=resolve(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),'bin/wrangler.js');
await mkdir('test-results',{recursive:true});
const run=await mkdtemp(resolve('test-results/course-migration-'));
const persist=resolve(run,'state'),log=[];
const options={encoding:'utf8',windowsHide:true,maxBuffer:10*1024*1024,env:{...process.env,
 CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:resolve(run,'wrangler.log')}};
function invoke(args,expected=0){
 const result=spawnSync(process.execPath,args,options);
 log.push({command:['node',...args],exit:result.status,stdout:result.stdout,stderr:result.stderr});
 assert.equal(result.status,expected,result.stderr||result.stdout||String(result.error));
 return result;
}
function wrangler(source,args){
 return invoke([cli,...args,'--local','--persist-to',persist,'--config',source?'modules/allocation/migrations/wrangler.source.json':'wrangler.jsonc']).stdout;
}
function migrate(flags=[],exit=0){
 const result=invoke(['scripts/migrate-course-allocation.mjs','--local','--persist-to',persist,...flags],exit);
 if(exit){assert.match(result.stderr,/Target report differs from source/);return;}
 return JSON.parse(result.stdout.slice(result.stdout.indexOf('{\n')));
}
const sha=value=>createHash('sha256').update(value).digest('hex');
const escape=value=>"'"+String(value).replaceAll("'","''")+"'";
const fixture=JSON.parse(await readFile('modules/allocation/tests/fixtures/demo-backup.json','utf8'));
const originalSql=await readFile('modules/allocation/tests/fixtures/demo.sql','utf8');
assert.equal(originalSql.replaceAll('\r\n','\n'),demoSeed());
try{
 wrangler(true,['d1','migrations','apply','DB']);
 const archive=scaleState();
 const insertArchive=(id,payload,hash='')=>'INSERT INTO term_archives(term,sheet_id,payload,identity_hash) VALUES ('+
  ['2025-2',id,JSON.stringify(payload),hash].map(escape).join(',')+');';
 const scaleArchive=[insertArchive('',globalPart(archive)),...archive.departments.map(({id})=>{
  const part=departmentPart(archive,id);
  return insertArchive(id,part,sha(identityKey(part)));
 })];
 const saveRequest={id:'d1',part:departmentPart(fixture,'d1'),revision:6,globalRevision:9};
 const requestHash=sha(JSON.stringify(saveRequest));
 const fixtureSql=resolve(run,'source-fixture.sql');
 await writeFile(fixtureSql,[originalSql,
  "UPDATE workspace SET revision=9;",
  "UPDATE sheets SET revision=7,last_operation='rehearsal-retry',request_hash="+escape(requestHash)+",updated_at="+Date.now()+" WHERE id='d1';",
  ...scaleArchive].join('\n'));
 wrangler(true,['d1','execute','DB','--file',fixtureSql]);
 wrangler(false,['d1','execute','DB','--command','CREATE TABLE rehearsal_platform_witness(id INTEGER PRIMARY KEY); INSERT INTO rehearsal_platform_witness VALUES (1);']);
 const before=migrate();
 assert.equal(before.mode,'preflight');
 assert.equal(before.before.rows.term_archives,13);
 assert.equal(before.before.rows.operations,1);
 assert.equal(before.before.globalRevision,9);
 assert.equal(before.before.revisions.d1,7);
 assert.equal(before.before.bodySha256,sha(JSON.stringify(fixture)));
 const applied=migrate(['--apply']);
 assert.equal(applied.mode,'applied');
 assert.deepEqual(applied.before,applied.after);
 const repeated=migrate(['--apply']);
 assert.equal(repeated.mode,'already-imported');
 assert.deepEqual(repeated.after,applied.after);

 const h=await harness({persistTo:persist});
 const data={role:'admin',path:'/sheets/d1',method:'PUT',data:{
  part:structuredClone(saveRequest.part),revision:7,globalRevision:9,operationId:'rehearsal-edit'
 }};
 data.data.part.teachers[0].name='가상 이관 후 편집';
 try{
  const {cookie}=await h.login();
  const result=await h.api('courseWorkspace',{role:'admin',path:'/state',method:'GET',data:{}},cookie);
  assert.deepEqual(result.data.state,fixture);
  assert.equal(result.data.globalRevision,9);
  assert.equal(result.data.revisions.d1,7);
  const retry=await h.api('courseWorkspace',{...data,data:{part:saveRequest.part,revision:6,globalRevision:9,operationId:'rehearsal-retry'}},cookie);
  assert.deepEqual(retry.data,{revision:7});
  assert.equal((await h.api('courseWorkspace',data,cookie)).code,'allocation_import_paused');
  assert.equal((await h.sql('SELECT id FROM rehearsal_platform_witness')).results[0].id,1);
 }finally{await h.close();}
 wrangler(false,['d1','execute','DB','--command',"UPDATE ca_sheets SET revision=8,last_operation=NULL WHERE id='d1';"]);
 migrate(['--apply'],1);
 migrate(['--release'],1);
 const paused=JSON.parse(wrangler(false,['d1','execute','DB','--json','--command','SELECT state FROM ca_import']));
 assert.equal(paused[0].results[0].state,'paused');
 wrangler(false,['d1','execute','DB','--command',"DELETE FROM ca_operations WHERE id='rehearsal-retry'; UPDATE ca_sheets SET revision=7,last_operation='rehearsal-retry',request_hash="+escape(requestHash)+" WHERE id='d1';"]);
 assert.equal(migrate(['--release']).mode,'released');

 const live=await harness({persistTo:persist});
 try{
  const {cookie}=await live.login();
  const save=await live.api('courseWorkspace',data,cookie);
  assert.deepEqual(save.data,{revision:8},JSON.stringify(save));
 }finally{await live.close();}
 assert.equal(migrate(['--apply']).mode,'already-released');
 // Rollback continues from the original binding and its last pre-cutover snapshot.
 const rollback=migrate();
 assert.deepEqual(rollback.before,before.before);
 const result={before:before.before,after:applied.after,rerun:'idempotent',mismatchApplyExit:1,mismatchReleaseExit:1,
  pausedApiWrite:503,releasedApiRevision:8,originalDbRollbackSnapshot:rollback.before.snapshotSha256};
 await writeFile(resolve(run,'comparison.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({report:resolve(run,'comparison.json'),...result},null,2));
}finally{
 await writeFile(resolve(run,'commands.json'),JSON.stringify(log,null,2)+'\n');
}
