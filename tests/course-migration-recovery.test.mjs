import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {access,mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {Miniflare} from 'miniflare';
import {freezeCatalogSql,inspectFreeze,removeFreeze,thawGenerationSql} from '../modules/allocation/server/source-freeze.js';
import {emergencyReservationSql} from '../scripts/migrate-course-allocation.mjs';
import {harness} from './harness.mjs';

const runFile=promisify(execFile);
const marker='recovery-fixture-private-marker';
const payload=JSON.stringify({marker});

async function fixture(migrateThrough){
 await mkdir('test-results',{recursive:true});
 const directory=await mkdtemp(resolve('test-results/course-recovery-'));
 const persistTo=resolve(directory,'state');
 const h=await harness({persistTo,migration:true,migrateThrough});
 async function cli(flags,{exit=0,cookie,url}={}){
  const logPath=resolve(directory,'unexpected-wrangler.log');
  const env={...process.env,WRANGLER_WRITE_LOGS:'true',WRANGLER_LOG_PATH:logPath};
  if(cookie)env.COURSE_ALLOCATION_ADMIN_COOKIE=cookie;
  else delete env.COURSE_ALLOCATION_ADMIN_COOKIE;
  const args=['scripts/migrate-course-allocation.mjs','--local','--persist-to',persistTo,...(url?['--url',url]:[]),...flags];
  const result=await runFile(process.execPath,args,{env,windowsHide:true}).then(
   ({stdout,stderr})=>({exit:0,stdout,stderr}),error=>({exit:error.code,stdout:error.stdout,stderr:error.stderr})
  );
  assert(![marker,cookie].filter(Boolean).some(value=>(result.stdout+result.stderr).includes(value)));
  await assert.rejects(access(logPath),{code:'ENOENT'});
  assert.equal(result.exit,exit,result.stderr);
  return exit?result.stderr:JSON.parse(result.stdout);
 }
 return {h,cli,persistTo};
}

test('failed schema or Worker version verification leaves the source unchanged and writable',async()=>{
 const {h,cli}=await fixture('0016');
 try{
  const url=await h.listen(),{cookie}=await h.login();
  await h.sourceSql('UPDATE workspace SET payload=?,revision=1 WHERE id=1',payload);
  const before=(await h.sourceSql('SELECT payload,revision FROM workspace')).results;
  assert.match(await cli(['--freeze-source','--expected-version','prior-version'],{exit:1,cookie,url}),/Worker/);
  assert.match(await cli(['--freeze-source','--expected-version','rehearsal-cutover'],{exit:1,cookie,url}),/status, HTTP 503/);
  assert.deepEqual(inspectFreeze((await h.sourceSql(freezeCatalogSql)).results),{generation:null,complete:false});
  assert.deepEqual((await h.sourceSql('SELECT payload,revision FROM workspace')).results,before);
  await h.sourceSql('UPDATE workspace SET revision=2 WHERE id=1');
  assert.equal((await h.sourceSql('SELECT revision FROM workspace')).results[0].revision,2);
 }finally{await h.close();}
});

test('emergency thaw reserves and clears a D1 ticket without a Worker and blocks every release stage',async()=>{
 const {h,cli,persistTo}=await fixture();
 let url,freeze;
 try{
  url=await h.listen();
  const {cookie}=await h.login();
  await h.sourceSql('UPDATE workspace SET payload=?,revision=1 WHERE id=1',payload);
  assert.equal((await cli(['--freeze-source','--expected-version','rehearsal-cutover'],{cookie,url})).triggers,27);
  freeze=inspectFreeze((await h.sourceSql(freezeCatalogSql)).results);
  await h.sql("INSERT INTO ca_import(id,source_hash,state,source_freeze) VALUES(1,?,'paused',?)",marker,freeze.generation);
  await h.sql("INSERT INTO ca_import_progress(id,token,phase) VALUES(1,?,'release-check')",marker);
 }finally{await h.close();}
 await assert.rejects(fetch(url+'/api/health'),TypeError);

 const [targetConfig,sourceConfig]=await Promise.all(['wrangler.jsonc','modules/allocation/migrations/wrangler.source.json']
  .map(async path=>JSON.parse(await readFile(path,'utf8'))));
 const mf=new Miniflare({modules:true,script:'export default {}',d1Databases:{
  DB:targetConfig.d1_databases[0].database_id,SOURCE:sourceConfig.d1_databases[0].database_id
 },d1Persist:resolve(persistTo,'v3/d1')});
 try{
  const target=await mf.getD1Database('DB'),source=await mf.getD1Database('SOURCE');
  const progress=target.prepare('UPDATE ca_import_progress SET phase=? WHERE id=1');
  const catalog=async()=>inspectFreeze((await source.prepare(freezeCatalogSql).all()).results);
  assert.deepEqual(await cli(['--db-status']),{state:'paused',phase:'release-check',thawReserved:false});
  for(const [state,phase] of [['paused','release-check'],['paused','release-ready'],['released','release-ready']]){
   await progress.bind(phase).run();
   await target.prepare('UPDATE ca_import SET state=? WHERE id=1').bind(state).run();
   assert.match(await cli(['--emergency-thaw'],{exit:1}),/해제 검증 중이거나 해제된 이관/);
   assert.deepEqual(await catalog(),freeze);
  }
  // Simulate a separate unreleased snapshot after the refusal checks.
  await target.prepare("UPDATE ca_import SET state='paused' WHERE id=1").run();
  await progress.bind('verified').run();
  assert.equal((await cli(['--emergency-thaw'])).mode,'source-thawed');
  assert.deepEqual(await catalog(),{generation:null,complete:false});
  assert.deepEqual(await source.prepare('SELECT payload,revision FROM workspace').first(),{payload,revision:1});
  await source.prepare('UPDATE workspace SET revision=2 WHERE id=1').run();
  assert.equal((await source.prepare('SELECT revision FROM workspace').first()).revision,2);
  assert.deepEqual(await cli(['--db-status']),{state:'paused',phase:'verified',thawReserved:false});
 }finally{await mf.dispose();}
});

test('release and emergency thaw reservations fence each other in both orders',async()=>{
 const {h,cli}=await fixture();
 try{
  const url=await h.listen(),{cookie}=await h.login();
  const operation=(op,data={})=>h.api('courseAllocationMigration',{version:'rehearsal-cutover',op,...data},cookie);
  const flags=['--expected-version','rehearsal-cutover'];
  await cli(['--freeze-source',...flags],{cookie,url});
  const {generation}=inspectFreeze((await h.sourceSql(freezeCatalogSql)).results);
  await h.sql("INSERT INTO ca_import(id,source_hash,state,source_freeze) VALUES(1,?,'paused',?)",marker,generation);
  await h.sql("INSERT INTO ca_import_progress(id,token,phase) VALUES(1,?,'verified')",marker);

  assert.deepEqual(await cli(['--db-status']),{state:'paused',phase:'verified',thawReserved:false});
  const release=(await operation('verifyRelease',{token:marker})).data;
  assert.equal(release.phase,'release-check');
  await assert.rejects(h.sql(emergencyReservationSql(generation)),/allocation_thaw_blocked/);
  await assert.rejects(h.sourceSql('UPDATE workspace SET revision=2 WHERE id=1'),/ca_source_frozen/);
  assert.equal((await operation('status')).data.thawReserved,false);
  assert((await operation('cancelRelease',{token:release.token})).ok);

  const staleToken=(await operation('status')).data.token;
  await h.sql(emergencyReservationSql(generation));
  assert.equal((await operation('verifyRelease',{token:staleToken})).code,'allocation_thaw_active');
  const {token_hash:adminHash}=(await h.sql("SELECT token_hash FROM sessions WHERE role='admin'")).results[0];
  await assert.rejects(h.sql('INSERT INTO ca_import_lock(id,token,token_hash,checked_at) VALUES(1,?,?,?)',staleToken,adminHash,Date.now()),/allocation_thaw_active/);
  assert.equal((await cli(['--emergency-thaw'])).mode,'source-thawed');
  await h.sourceSql('UPDATE workspace SET revision=2 WHERE id=1');
  assert.equal((await h.sourceSql('SELECT revision FROM workspace')).results[0].revision,2);
  const current=(await operation('status')).data;
  assert.equal(current.state,'paused');
  assert.equal(current.phase,'verified');
  assert.equal(current.thawReserved,false);
  assert.notEqual(current.token,staleToken);
  assert.equal((await operation('verifyRelease',{token:staleToken})).code,'allocation_import_conflict');
  const edit=await h.api('courseWorkspace',{role:'admin',path:'/global',method:'PUT',data:{}},cookie);
  assert.equal(edit.code,'allocation_import_paused');
 }finally{await h.close();}
});

test('an empty target still reports a thaw reservation and blocks refreeze after the source DDL',async()=>{
 const {h,cli}=await fixture();
 try{
  const url=await h.listen(),{cookie}=await h.login();
  const flags=['--expected-version','rehearsal-cutover'];
  const opts={cookie,url};
  await cli(['--freeze-source',...flags],opts);
  const {generation}=inspectFreeze((await h.sourceSql(freezeCatalogSql)).results);
  const begun=await h.api('courseAllocationMigration',{version:'rehearsal-cutover',op:'beginThaw'},cookie);
  assert(begun.ok,begun.error);
  await h.sourceSql(thawGenerationSql(generation));
  for(const sql of removeFreeze())await h.sourceSql(sql);

  const reserved={state:'empty',phase:null,thawReserved:true};
  assert.deepEqual(await cli(['--status',...flags],opts),reserved);
  assert.deepEqual(await cli(['--db-status']),reserved);
  assert.match(await cli(['--freeze-source',...flags],{...opts,exit:1}),/원복 예약/);
  assert.deepEqual(inspectFreeze((await h.sourceSql(freezeCatalogSql)).results),{generation:null,complete:false});
  assert.equal((await cli(['--emergency-thaw'])).mode,'source-thawed');
  assert.deepEqual(await cli(['--status',...flags],opts),{...reserved,thawReserved:false});
  assert.equal((await cli(['--freeze-source',...flags],opts)).triggers,27);
 }finally{await h.close();}
});
