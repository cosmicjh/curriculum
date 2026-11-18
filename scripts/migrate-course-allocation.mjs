import {execFile,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,open,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {parseArgs,promisify} from 'node:util';
import {assemble} from '../modules/allocation/server/validation.js';

const root=resolve(import.meta.dirname,'..');
const sourceConfig=resolve(root,'modules/allocation/migrations/wrangler.source.json');
const targetConfig=resolve(root,'wrangler.jsonc');
const sourceId='2f1b7cde-5ea8-453b-b810-f372cf138c60';
const targetId='c4c3186c-bcfa-4bb9-959f-5086151abce8';
const workerOrigin='https://school-timetable.cosmicjh.workers.dev';
const tables=['workspace','sheets','entity_ids','operations','write_guards','term_archives'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
class SafeError extends Error {}
function check(ok,message){if(!ok)throw new SafeError(message);}

export async function privateChild(executable,args,capture=false){
 const env={...process.env};
 delete env.COURSE_ALLOCATION_ADMIN_COOKIE;
 const options={cwd:root,windowsHide:true,
  env:{...env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_SANITIZE:'true'}};
 try{
  if(capture)return (await promisify(execFile)(executable,args,{...options,maxBuffer:1024*1024})).stdout;
  await new Promise((done,reject)=>{
   const child=spawn(executable,args,{...options,stdio:'ignore'});
   child.once('error',reject);
   child.once('exit',exit=>exit===0?done():reject(new Error()));
  });
  return '';
 }catch{throw new SafeError('명령이 실패했습니다. 인증과 명령 옵션을 확인하세요.');}
}
function wrangler(args,config,capture=false){
 const cli=resolve(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),'bin/wrangler.js');
 return privateChild(process.execPath,[cli,...args,'--config',config],capture);
}
async function prepareConfig(){
 const config=JSON.parse(await readFile(targetConfig,'utf8'));
 const source=JSON.parse(await readFile(sourceConfig,'utf8')).d1_databases[0];
 check(config.d1_databases.length===1&&config.d1_databases[0].database_id===targetId&&source.database_id===sourceId,'이관 DB 바인딩을 확인하세요.');
 config.d1_databases.push({binding:'COURSE_DB',database_id:sourceId,database_name:source.database_name});
 config.vars.COURSE_ALLOCATION_MIGRATION='true';
 config.version_metadata={binding:'COURSE_ALLOCATION_VERSION'};
 // Apply the schema before the manual deployment. Preserve the normal scheduled handlers.
 const path=resolve(root,'wrangler.allocation-migration.local.json');
 await writeFile(path,JSON.stringify(config,null,2)+'\n',{flag:'wx'});
 return {config:path};
}
async function sourceExport(directory,options){
 const path=resolve(directory,'source.sql');
 if(options.remote){
  await wrangler(['d1','export','DB','--remote','--skip-confirmation','--output',path],sourceConfig);
  return;
 }
 const {Miniflare}=await import('miniflare');
 const mf=new Miniflare({modules:true,script:'export default {}',d1Databases:{DB:sourceId},d1Persist:resolve(options['persist-to'],'v3/d1')});
 try{
  const db=await mf.getD1Database('DB');
  const [lines]=await db.prepare('PRAGMA miniflare_d1_export(?,?,?);').bind(false,false).raw();
  await writeFile(path,lines.join('\n'));
 }finally{await mf.dispose();}
}
async function bookmark(directory,remote){
 const record=remote
  ?JSON.parse(await wrangler(['d1','time-travel','info','DB','--json'],targetConfig,true))
  :{local:true};
 check(!remote||typeof record.bookmark==='string'&&record.bookmark.length>0,'공통 DB 복구 지점을 확인하세요.');
 await writeFile(resolve(directory,'target-recovery.json'),JSON.stringify(record,null,2)+'\n');
}

async function snapshot(call,side,directory){
 const rows={},sha256={},revisions=[],active={};
 let globalRevision=null,snapshotSha256='';
 for(const table of tables){
  let cursor=null,count=0,tableHash='';
  const output=directory?await open(resolve(directory,side+'-'+table+'.jsonl'),'wx'):null;
  try{
   do{
    const page=await call('page',{side,table,cursor,dump:Boolean(output)});
    count+=page.count;
    tableHash=hash([tableHash,page.hash,page.count]);
    snapshotSha256=hash([snapshotSha256,table,page.hash,page.count]);
    if(table==='workspace'&&page.count)globalRevision=page.revisions[0];
    if(table==='sheets')revisions.push(...page.revisions);
    if(output){
     for(const row of page.rows)await output.write(JSON.stringify(row)+'\n');
     if(side==='source'&&['workspace','sheets'].includes(table))(active[table]??=[]).push(...page.rows);
    }
    cursor=page.next;
   }while(cursor!==null);
  }finally{await output?.close();}
  rows[table]=count;sha256[table]=tableHash;
 }
 if(directory&&side==='source'){
  const global=JSON.parse(active.workspace[0].payload),parts=new Map(active.sheets.map(row=>[row.id,JSON.parse(row.payload)]));
  check(global.departmentIds.length===parts.size&&global.departmentIds.every(id=>parts.has(id)),'원본 교과군 목록을 확인하세요.');
  const body=assemble(global,global.departmentIds.map(id=>parts.get(id)));
  await writeFile(resolve(directory,'source.json'),JSON.stringify(body));
 }
 return {rows,sha256,globalRevision,revisions,idSetSha256:sha256.entity_ids,snapshotSha256};
}
async function backupDirectory(){
 const directory=resolve(root,'private');
 await mkdir(directory,{recursive:true});
 return mkdtemp(resolve(directory,'course-allocation-'));
}
async function migrate(options){
 if(options['prepare-config'])return prepareConfig();
 const {apply,release,remote}=options,reset=options['reset-paused'];
 check([apply,release,reset].filter(Boolean).length<=1&&!(remote&&options.local),'이관 동작과 실행 위치를 하나씩 선택하세요.');
 check(!remote||!options.url&&!options['persist-to'],'원격 실행에서는 로컬 옵션을 사용하지 않습니다.');
 const origin=remote?workerOrigin:new URL(options.url||'http://127.0.0.1:8787').origin;
 check(remote||/^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]+)?$/.test(origin),'격리된 로컬 Worker 주소를 사용하세요.');
 const version=options['expected-version'];
 const cookie=process.env.COURSE_ALLOCATION_ADMIN_COOKIE;
 check(version&&cookie&&/^__Host-tt_admin=[a-f0-9]{64}$/.test(cookie),'예상 Worker 버전과 관리자 세션을 확인하세요.');
 const post=(action,data)=>fetch(origin+'/api/'+action,{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},
  body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(15000)
 });
 async function call(op,data={}){
  const response=await post('courseAllocationMigration',{op,version,...data});
  const payload=await response.json();
  check(response.ok&&payload.ok,'이관 요청 실패 ('+op+', HTTP '+response.status+').');
  return payload.data;
 }
 async function deployCheck(){
  const response=await fetch(origin+'/api/health',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  check(response.ok&&(await response.json()).data?.courseAllocationMigrationVersion===version,'배포된 Worker 버전이 예상 버전과 다릅니다.');
 }
 async function frozen(){
  await deployCheck();
  const bridge=await post('courseBridge',{});
  const workspace=await post('courseWorkspace',{role:'admin',path:'/global',method:'PUT',data:{}});
  await bridge.body?.cancel();
  check(bridge.status===410&&bridge.headers.get('X-Course-Allocation-Frozen')==='1'&&
    workspace.status===503&&(await workspace.json()).code==='allocation_import_paused',
   '현재 Worker의 이전 쓰기 경로 차단을 확인하세요.');
  await call('checkLegacy');
  await deployCheck();
 }
 await deployCheck();
 let state=await call('status');
 if(state.state==='released'){
  check(!reset,'이미 해제한 이관은 정리할 수 없습니다.');
  return {mode:'already-released'};
 }
 if(!apply&&!release&&!reset){
  const before=await snapshot(call,'source');
  check(before.rows.workspace===1&&before.rows.write_guards===0,'원본 자료와 진행 중 쓰기를 확인하세요.');
  return {mode:'preflight',before};
 }
 await frozen();
 if(reset){
  check(state.state==='paused','일시 중지된 이관이 없습니다.');
  const directory=await backupDirectory();
  const target=await snapshot(call,'target',directory);
  await writeFile(resolve(directory,'comparison.json'),JSON.stringify({target,import:{hash:state.hash,phase:state.phase}},null,2));
  await frozen();
  const lastTarget=await snapshot(call,'target');
  check(lastTarget.snapshotSha256===target.snapshotSha256,'정리 대상이 백업 이후 변경됐습니다.');
  await call('reset',{hash:state.hash,token:state.token});
  return {mode:'reset',target,backupDirectory:directory};
 }
 const before=await snapshot(call,'source');
 let directory;
 check(before.rows.workspace===1&&before.rows.write_guards===0,'원본 자료와 진행 중 쓰기를 확인하세요.');
 if(state.state==='empty'){
  check(apply,'복사·대조를 먼저 완료하세요.');
  check(remote||options['persist-to'],'로컬 원본 SQL 백업의 격리 상태 경로를 지정하세요.');
  directory=await backupDirectory();
  await sourceExport(directory,options);
  const sourceBackup=await snapshot(call,'source',directory);
  check(sourceBackup.snapshotSha256===before.snapshotSha256,'백업 중 원본이 바뀌었습니다.');
  const target=await snapshot(call,'target');
  check(Object.values(target.rows).every(count=>count===0),'대상 시수배당 테이블이 비어 있지 않습니다.');
  await writeFile(resolve(directory,'before.json'),JSON.stringify({before,target},null,2));
  await frozen();
  await bookmark(directory,remote);
  state=await call('begin',{hash:before.snapshotSha256});
 }else{
  check(state.hash===before.snapshotSha256,'일시 중지된 이관과 원본 해시가 다릅니다.');
 }
 if(apply){
  while(state.phase==='copy')state=await call('step');
  state=await call('verify');
  while(state.phase==='verify')state=await call('step');
 }
 const resultDir=directory||await backupDirectory();
 const after=await snapshot(call,'target',resultDir);
 check(after.snapshotSha256===before.snapshotSha256,'원본과 대상의 대조 결과가 다릅니다.');
 await writeFile(resolve(resultDir,'comparison.json'),JSON.stringify({before,after},null,2));
 if(release){
  state=await call('verifyRelease');
  while(state.phase==='release-check')state=await call('step');
  await frozen();
  await call('release',{hash:before.snapshotSha256});
 }
 return {mode:release?'released':directory?'applied':'already-imported',before,after,backupDirectory:resultDir};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 try{
  const {values}=parseArgs({options:{apply:{type:'boolean'},release:{type:'boolean'},'reset-paused':{type:'boolean'},
   'prepare-config':{type:'boolean'},local:{type:'boolean'},remote:{type:'boolean'},url:{type:'string'},
   'expected-version':{type:'string'},'persist-to':{type:'string'}}});
  console.log(JSON.stringify(await migrate(values),null,2));
 }catch(error){console.error(error instanceof SafeError?error.message:'이관 도구 실행을 중단했습니다.');process.exitCode=1;}
}
