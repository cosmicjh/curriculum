import {digest} from './crypto.js';
import {database} from './storage.js';
import {freezeCatalogSql,freezeError,freezeProbeSql,inspectFreeze} from '../modules/allocation/server/source-freeze.js';

const tables={
 workspace:{keys:['id'],fields:['id','payload','revision'],limit:1},
 sheets:{keys:['id'],fields:['id','payload','revision','identity_hash','last_operation','request_hash','updated_at'],limit:1},
 entity_ids:{keys:['kind','entity_id'],fields:['kind','entity_id','sheet_id'],limit:250},
 operations:{keys:['id'],fields:['id','kind','sheet_id','request_hash','result','created_at'],limit:16},
 write_guards:{keys:['id'],fields:['id'],limit:1},
 term_archives:{keys:['term','sheet_id'],fields:['term','sheet_id','payload','identity_hash'],limit:1}
};
const names=Object.keys(tables);
const legacy='https://course-allocation.pages.dev';
const hashPattern=/^[a-f0-9]{64}$/;
class MigrationError extends Error {}
function fail(status,code,message){throw Object.assign(new MigrationError(message),{status,code});}
const unset=()=>fail(503,'allocation_schema_required','시수배당 DB 마이그레이션을 적용하세요.');
const refuse=(code,message)=>fail(409,code,message);
const paused=()=>fail(503,'allocation_import_paused','시수배당 자료 이관 중입니다.');

export function allocationSchemaMissing(error){
 return /no such table:\s*(?:main\.)?ca_(?:workspace|sheets|entity_ids|operations|write_guards|term_archives|import(?:_progress|_lock)?)(?=[\s:]|$)/i.test(String(error?.message));
}
export function migrationVersion(env){
 return env.COURSE_ALLOCATION_MIGRATION==='true'&&env.COURSE_DB?env.COURSE_ALLOCATION_VERSION?.id||null:null;
}
async function status(db){
 return db.first('SELECT m.state,m.source_hash,m.source_freeze,p.token,p.phase,p.table_index,p.cursor,p.hash,p.verified_at FROM ca_import m LEFT JOIN ca_import_progress p ON p.id=m.id WHERE m.id=1');
}
export async function allocationAccess(db,env,method){
 if(env.COURSE_ALLOCATION_MIGRATION!=='true')return;
 const current=await status(db);
 if(current?.state!=='released'&&(method!=='GET'||!['verified','release-check','release-ready'].includes(current?.phase)))paused();
}

async function probeLegacy(){
 // GET /global without credentials reaches only the legacy authentication read path.
 try{
  const response=await fetch(legacy+'/api/global',{headers:{'Cache-Control':'no-store'},redirect:'manual',signal:AbortSignal.timeout(5000)});
  await response.body?.cancel();
  if(response.status===410&&response.headers.get('X-Course-Allocation-Frozen')==='1')return;
 }catch{}
 refuse('allocation_legacy_open','이전 시수배당 API의 차단 응답을 확인하세요.');
}

async function frozenSource(source,expected,prove=false){
 let state;
 try{state=inspectFreeze(await source.all(freezeCatalogSql));}catch{}
 if(!state?.complete||expected&&state.generation!==expected)
  refuse('allocation_source_unfrozen','원본 DB 동결 트리거를 확인하세요.');
 if(prove){
  let rejected=false;
  try{await source.all(freezeProbeSql);}catch(error){rejected=String(error.message).includes(freezeError(state.generation));}
  if(!rejected)refuse('allocation_source_unfrozen','원본 DB 쓰기 차단을 확인하세요.');
 }
 return state.generation;
}

async function readPage(db,prefix,name,cursor){
 if(!Object.hasOwn(tables,name))fail(400,'allocation_bad_page','이관 테이블을 확인하세요.');
 const {keys,fields,limit}=tables[name];
 if(cursor!==null&&(!Array.isArray(cursor)||cursor.length!==keys.length||cursor.some((value,index)=>
  name==='workspace'&&index===0?value!==1:typeof value!=='string'||value.length>2000))){
  fail(400,'allocation_bad_page','이관 페이지를 확인하세요.');
 }
 const where=cursor?' WHERE ('+keys.join(',')+') > ('+keys.map(()=>'?').join(',')+')':'';
 const rows=await db.all('SELECT '+fields.join(',')+' FROM '+prefix+name+where+' ORDER BY '+keys.join(',')+' LIMIT ?',...(cursor||[]),limit);
 const values=rows.map(row=>fields.map(field=>row[field]));
 const last=rows.at(-1),next=rows.length===limit?keys.map(key=>last[key]):null;
 return {rows,values,next,count:rows.length,hash:await digest(JSON.stringify(values))};
}

function lock(db,token,session){
 return db.prepare('INSERT INTO ca_import_lock(id,token,token_hash,checked_at) VALUES (1,?,?,?)',token,session.token_hash,Date.now());
}
const unlock=db=>db.prepare('DELETE FROM ca_import_lock WHERE id=1');

async function begin(db,session,sourceHash,generation){
 if(!hashPattern.test(sourceHash||''))fail(400,'allocation_bad_hash','원본 대조 해시를 확인하세요.');
 const token=crypto.randomUUID();
 await db.batch([
  db.prepare("INSERT INTO ca_import(id,source_hash,state,source_freeze) VALUES(1,?,'paused',?)",sourceHash,generation),
  db.prepare("INSERT INTO ca_import_progress(id,token,phase) VALUES(1,?,'copy')",token),
  lock(db,token,session),unlock(db)
 ]);
}
async function startVerify(db,current,session,phase){
 if(current.phase===phase&&phase!=='release-check')return;
 const allowed=phase==='release-check'?['verified','release-check','release-ready']:['copied','verified','release-check','release-ready'];
 if(!allowed.includes(current.phase))refuse('allocation_copy_incomplete','이관 복사와 대조를 먼저 완료하세요.');
 await db.batch([lock(db,current.token,session),
  db.prepare("UPDATE ca_import_progress SET phase=?,token=?,table_index=0,cursor=NULL,hash='',verified_at=NULL WHERE id=1",phase,crypto.randomUUID()),unlock(db)]);
}
async function step(source,db,current,session){
 if(!['copy','verify','release-check'].includes(current.phase))return;
 await frozenSource(source,current.source_freeze);
 const name=names[current.table_index],cursor=JSON.parse(current.cursor??'null');
 const page=await readPage(source,'',name,cursor);
 if(name==='workspace'&&page.count===0&&cursor===null)refuse('allocation_source_empty','시수배당 원본이 비어 있습니다.');
 if(name==='write_guards'&&page.count)refuse('allocation_source_busy','원본의 쓰기 요청을 소진하세요.');
 if(current.phase!=='copy'){
  const target=await readPage(db,'ca_',name,cursor);
  if(page.hash!==target.hash||page.count!==target.count)refuse('allocation_mismatch','원본과 대상의 대조 결과가 다릅니다.');
 }
 const running=await digest(JSON.stringify([current.hash,name,page.hash,page.count]));
 const index=current.table_index+(page.next===null?1:0);
 const complete=index===names.length;
 if(complete)await frozenSource(source,current.source_freeze,true);
 if(complete&&running!==current.source_hash)refuse('allocation_source_changed','원본 해시가 바뀌었습니다.');
 const statements=[lock(db,current.token,session)];
 if(current.phase==='copy'&&name!=='entity_ids'&&name!=='write_guards'){
  const {fields}=tables[name];
  const sql='INSERT INTO ca_'+name+'('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')';
  statements.push(...page.values.map(row=>db.prepare(sql,...row)));
 }
 const nextPhase=complete?(current.phase==='copy'?'copied':current.phase==='verify'?'verified':'release-ready'):current.phase;
 statements.push(db.prepare('UPDATE ca_import_progress SET phase=?,token=?,table_index=?,cursor=?,hash=?,verified_at=? WHERE id=1',
  nextPhase,crypto.randomUUID(),index,page.next===null?null:JSON.stringify(page.next),running,nextPhase==='release-ready'?Date.now():null),unlock(db));
 await db.batch(statements);
}
async function reset(db,current,session){
 await db.batch([lock(db,current.token,session),
  ...['sheets','workspace','operations','term_archives'].map(name=>db.prepare('DELETE FROM ca_'+name)),
  db.prepare('DELETE FROM ca_import WHERE id=1'),unlock(db)]);
}

export async function courseMigration(db,env,session,request){
 try{
  const version=migrationVersion(env);
  if(!version||request.version!==version)refuse('allocation_version_mismatch','예상한 이관 Worker 버전을 확인하세요.');
  const source=database(env.COURSE_DB),current=await status(db);
  if(request.op==='status')return {state:current?.state??'empty',phase:current?.phase??null,hash:current?.source_hash??null,token:current?.token??null};
  if(request.op==='page'){
   if(!['source','target'].includes(request.side))fail(400,'allocation_bad_page','이관 대상을 확인하세요.');
   if(current?.state==='released'&&request.dump)refuse('allocation_released','이미 해제한 이관입니다.');
   const isSource=request.side==='source';
   const page=await readPage(isSource?source:db,isSource?'':'ca_',request.table,request.cursor??null);
   const revisions=['workspace','sheets'].includes(request.table)?page.rows.map(row=>row.revision):[];
   return {next:page.next,count:page.count,hash:page.hash,revisions,...(request.dump?{rows:page.rows}:{})};
  }
  if(request.op==='checkFreeze'){await frozenSource(source,current?.source_freeze,true);return true;}
  if(current?.state==='released')refuse('allocation_released','이미 해제한 이관입니다.');
  if(request.op==='checkLegacy'){
   await frozenSource(source,null,true);
   await probeLegacy();
   return true;
  }
  if(request.op==='begin'){
   if(current)refuse('allocation_import_exists','이전에 시작한 이관을 확인하세요.');
   await probeLegacy();
   const generation=await frozenSource(source,null,true);
   await begin(db,session,request.hash,generation);
  }else{
   if(!current?.token)refuse('allocation_import_missing','이관을 먼저 시작하세요.');
   if(!current.source_freeze&&request.op!=='reset')refuse('allocation_source_unfrozen','원본 DB 동결 세대가 기록된 이관을 시작하세요.');
   if(request.op==='step')await step(source,db,current,session);
   else if(request.op==='verify'||request.op==='verifyRelease'){
    await frozenSource(source,current.source_freeze,true);
    await startVerify(db,current,session,request.op==='verify'?'verify':'release-check');
   }
   else if(request.op==='reset'){
    if(request.hash!==current.source_hash||request.token!==current.token)refuse('allocation_reset_mismatch','백업한 이관과 현재 이관이 다릅니다.');
    await frozenSource(source,null,true);
    await reset(db,current,session);
   }else if(request.op==='release'){
    if(current.phase!=='release-ready'||request.hash!==current.hash||Date.now()-current.verified_at>120000)refuse('allocation_not_verified','원본·대상 재대조를 완료하세요.');
    await probeLegacy();
    await frozenSource(source,current.source_freeze,true);
    await db.batch([lock(db,current.token,session),db.prepare("UPDATE ca_import SET state='released' WHERE id=1"),unlock(db)]);
   }else fail(400,'allocation_bad_action','이관 동작을 확인하세요.');
  }
  const next=await status(db);
  return {state:next?.state??'empty',phase:next?.phase??null,hash:next?.source_hash??null};
 }catch(error){
  if(allocationSchemaMissing(error))unset();
  if(error instanceof MigrationError)throw error;
  if(String(error.message).includes('auth_required'))fail(401,'AUTH_REQUIRED','다시 로그인하세요.');
  if(/allocation_(?:import_changed|target_not_empty)|UNIQUE constraint/.test(String(error.message)))refuse('allocation_import_conflict','이관 상태 또는 대상 자료가 변경되었습니다.');
  // Driver errors can contain row text. Keep the management response free of SQL and data.
  fail(503,'allocation_migration_failed','시수배당 이관 처리에 실패했습니다.');
 }
}
