import {C} from '../vendor/class-swap/src/shared/core.js';
import {today} from '../vendor/class-swap/src/shared/backup.js';
import {datasetFromStore} from './class-swap-data.js';
import {schedule} from './storage.js';
import {digest,randomToken} from './crypto.js';
import {fail} from './auth.js';
const conflict=()=>fail(409,'CONFLICT','자료나 계획서가 변경되었습니다. 작성 내용을 보관하고 새로고침하여 확인하세요.');
export const readPlans=(db,term)=>db.all('SELECT content FROM swap_plans WHERE term_id=? ORDER BY id',term).then(rows=>rows.map(row=>JSON.parse(row.content)));
export async function validateSchedule(db,store){
 const dataset=datasetFromStore(store),plans=await readPlans(db,store.term);
 if(!dataset&&plans.some(p=>p.status==='active'&&p.items.some(i=>i.dateA>=today()||i.dateB>=today())))fail(409,'PLAN_CONFLICT','저장된 결보강 계획서를 먼저 취소한 뒤 시간표를 비워 주세요.');
 if(dataset)C.validateExisting(dataset,plans,today());
}
async function commit(db,ctx,session,statement){
 const id=randomToken();
 try{await db.batch([
  db.prepare('INSERT INTO swap_write_guards(id,expected_revision,expected_term,token_hash,at) VALUES(?,?,?,?,?)',id,ctx.revision,ctx.term,session.token_hash,Date.now()),statement,
  db.prepare('DELETE FROM swap_write_guards WHERE id=?',id)
 ]);}catch(error){if(/UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(error.message))conflict();throw error;}
}
export async function classSwap(db,ctx,session,request){
 if(!['load','resume','savePlan','cancelPlan'].includes(request.swapAction))fail(403,'FORBIDDEN','이 기능에 접근할 수 없습니다.');
 const payload=request.swapPayload;if(!payload||typeof payload!=='object'||Array.isArray(payload))fail(400,'INVALID_REQUEST','요청을 확인하세요.');
 if(['savePlan','cancelPlan'].includes(request.swapAction)&&payload.term&&payload.term!==ctx.term)fail(409,'TERM_CHANGED','학기가 변경되었습니다. 새로고침하여 현재 학기 자료를 확인하세요. 이전 학기 초안은 유지됩니다.');
 const source=await schedule(db,ctx);
 source.swap??=(async()=>{const dataset=datasetFromStore(source.store,source.rt);return {dataset,dataRev:ctx.term+':'+await digest(JSON.stringify(dataset))};})();
 const {dataset,dataRev}=await source.swap,plans=await readPlans(db,ctx.term);
 if(['load','resume'].includes(request.swapAction)){
  const current=await db.first('SELECT revision,active_term FROM app_state WHERE id=1');if(current.revision!==ctx.revision||current.active_term!==ctx.term)fail(409,'READ_CHANGED','자료가 변경되었습니다. 다시 조회하세요.');
  return {role:'teacher',term:ctx.term,dataRev,planRev:String(ctx.revision),hasDataset:!!dataset,dataset:payload.dataRev===dataRev?null:dataset,plans:String(payload.planRev)===String(ctx.revision)?null:plans};
 }
 if(request.swapAction==='cancelPlan'){
  const old=plans.find(p=>p.id===payload.id);if(!old)fail(400,'INVALID_REQUEST','계획서를 찾지 못했습니다.');
  if(old.status!=='active'||old.version!==payload.version)conflict();
  const plan={...old,status:'cancelled',version:old.version+1,updatedAt:new Date().toISOString(),updatedRole:session.role};
  await commit(db,ctx,session,db.prepare('UPDATE swap_plans SET version=?,status=?,content=? WHERE id=? AND term_id=?',plan.version,plan.status,JSON.stringify(plan),plan.id,ctx.term));
  return {plan,planRev:String(ctx.revision+1)};
 }
 if(payload.dataRev!==dataRev)conflict();if(!dataset)fail(400,'INVALID_REQUEST','관리자에서 교사 시간표를 먼저 등록해 주세요.');
 const raw=payload.plan;if(!raw||!/^p_[A-Za-z0-9_-]{12,80}$/.test(raw.id)||!Number.isInteger(raw.version)||raw.version<0)fail(400,'INVALID_REQUEST','계획서 식별자·버전을 확인해 주세요.');
 const old=plans.find(p=>p.id===raw.id);if(old&&(old.status!=='active'||raw.version!==0&&old.version!==raw.version)||!old&&raw.version!==0)conflict();
 C.validatePlan(dataset,[],raw);let clean;try{clean=C.validatePlan(dataset,plans,raw);}catch{conflict();}
 if(old&&raw.version===0){if(JSON.stringify(Object.fromEntries(Object.keys(clean).map(k=>[k,old[k]])))!==JSON.stringify(clean))conflict();return {plan:old,planRev:String(ctx.revision)};}
 const at=new Date().toISOString(),plan={...clean,id:raw.id,version:old?old.version+1:1,status:'active',createdAt:old?.createdAt||at,updatedAt:at,updatedRole:session.role};
 if(JSON.stringify(plan).length>45000)fail(400,'INVALID_REQUEST','계획서가 너무 큽니다.');
 const statement=old?db.prepare('UPDATE swap_plans SET version=?,status=?,content=? WHERE id=? AND term_id=?',plan.version,plan.status,JSON.stringify(plan),plan.id,ctx.term):db.prepare('INSERT INTO swap_plans(id,term_id,version,status,content) VALUES(?,?,?,?,?)',plan.id,ctx.term,plan.version,plan.status,JSON.stringify(plan));
 try{await commit(db,ctx,session,statement);}
 catch(error){
  if(raw.version===0&&(/revision_conflict/.test(error.message)||error.code==='CONFLICT')){
   const winner=(await readPlans(db,ctx.term)).find(p=>p.id===raw.id);
   if(winner?.status==='active'&&JSON.stringify(Object.fromEntries(Object.keys(clean).map(k=>[k,winner[k]])))===JSON.stringify(clean))return {plan:winner,planRev:String((await db.first('SELECT revision FROM app_state WHERE id=1')).revision)};
  }throw error;
 }
 return {plan,planRev:String(ctx.revision+1)};
}
