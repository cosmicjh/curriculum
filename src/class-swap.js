import {C} from '../vendor/class-swap/src/shared/core.js';
import {today} from '../vendor/class-swap/src/shared/backup.js';
import {datasetFromStore} from './class-swap-data.js';
import {schedule} from './storage.js';
import {digest,randomToken} from './crypto.js';
import {fail} from './auth.js';
const conflict=()=>fail(409,'CONFLICT','자료나 계획서가 변경되었습니다. 작성 내용을 보관하고 새로고침하여 확인하세요.');
export const readPlans=(db,term)=>db.all('SELECT content FROM swap_plans WHERE term_id=? ORDER BY id',term).then(rows=>rows.map(row=>JSON.parse(row.content)));
async function readReservedSlots(db,term){
 const rows=await db.all('SELECT teacher_id,actual_date,period FROM swap_reservations WHERE term_id=? ORDER BY teacher_id,actual_date,period',term);
 const byTeacher=new Map();
 for(const {teacher_id,actual_date,period} of rows){
  if(!byTeacher.has(teacher_id))byTeacher.set(teacher_id,{id:'slots:'+teacher_id,teacherA:teacher_id,status:'active',items:[]});
  byTeacher.get(teacher_id).items.push({teacherB:teacher_id,dateA:actual_date,periodA:period});
 }
 return [...byTeacher.values()];
}
export async function validateSchedule(db,store){
 const dataset=datasetFromStore(store);
 const cutoff=today();
 const pending=(await readPlans(db,store.term)).filter(p=>p.status==='active'&&p.items.some(i=>i.dateA>=cutoff||i.dateB>=cutoff));
 if(!pending.length)return;
 if(!dataset)fail(409,'PLAN_CONFLICT','제출된 결보강 계획서를 먼저 취소한 뒤 시간표를 비워 주세요.');
 C.validateExisting(dataset,pending,cutoff);
}
async function commit(db,ctx,session,statement){
 const id=randomToken();
 try{await db.batch([
  db.prepare('INSERT INTO swap_write_guards(id,expected_revision,expected_term,token_hash,at) VALUES(?,?,?,?,?)',id,ctx.revision,ctx.term,session.token_hash,Date.now()),statement,
  db.prepare('DELETE FROM swap_write_guards WHERE id=?',id)
 ]);}catch(error){if(/UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(error.message))conflict();throw error;}
}
export async function classSwap(db,ctx,session,request){
 const action=request.swapAction,admin=request.swapScope==='admin'&&session.role==='admin',listing=['load','resume'].includes(action);
 if(!listing&&action!=='submitPlan'&&!(admin&&action==='cancelPlan'))fail(403,'FORBIDDEN','이 기능에 접근할 수 없습니다.');
 const payload=request.swapPayload;if(!payload||typeof payload!=='object'||Array.isArray(payload))fail(400,'INVALID_REQUEST','요청을 확인하세요.');
 if(!listing&&payload.term&&payload.term!==ctx.term)fail(409,'TERM_CHANGED','학기가 변경되었습니다. 새로고침하여 현재 학기 자료를 확인하세요. 이전 학기 초안은 유지됩니다.');
 if(listing){
  const planRev=ctx.term+':'+ctx.revision,unchanged=payload.planRev===planRev;
  const [source,plans]=await Promise.all([
   admin?null:swapDataset(db,ctx),
   unchanged?null:admin?readPlans(db,ctx.term):readReservedSlots(db,ctx.term)
  ]);
  const current=await db.first('SELECT revision,active_term FROM app_state WHERE id=1');if(current.revision!==ctx.revision||current.active_term!==ctx.term)fail(409,'READ_CHANGED','자료가 변경되었습니다. 다시 조회하세요.');
  if(admin)return {role:'admin',term:ctx.term,planRev,plans};
  return {role:'teacher',term:ctx.term,dataRev:source.dataRev,planRev,hasDataset:!!source.dataset,dataset:payload.dataRev===source.dataRev?null:source.dataset,reservedSlots:plans};
 }
 if(action==='cancelPlan'){
  const row=await db.first('SELECT content FROM swap_plans WHERE term_id=? AND id=?',ctx.term,payload.id||'');
  if(!row)fail(400,'INVALID_REQUEST','계획서를 찾지 못했습니다.');
  const old=JSON.parse(row.content);
  if(old.status!=='active'||old.version!==payload.version)conflict();
  const plan={...old,status:'cancelled',version:old.version+1,updatedAt:new Date().toISOString(),updatedRole:session.role};
  await commit(db,ctx,session,db.prepare('UPDATE swap_plans SET version=?,status=?,content=? WHERE id=? AND term_id=?',plan.version,plan.status,JSON.stringify(plan),plan.id,ctx.term));
  return {plan,planRev:ctx.term+':'+(ctx.revision+1)};
 }
 const [{dataset,dataRev},plans]=await Promise.all([swapDataset(db,ctx),readPlans(db,ctx.term)]);
 if(payload.dataRev!==dataRev)conflict();if(!dataset)fail(400,'INVALID_REQUEST','관리자에서 교사 시간표를 먼저 등록해 주세요.');
 const raw=payload.plan;if(!raw||!/^p_[A-Za-z0-9_-]{12,80}$/.test(raw.id)||raw.version!==0)fail(400,'INVALID_REQUEST','계획서 식별자·버전을 확인해 주세요.');
 const old=plans.find(p=>p.id===raw.id);if(old&&old.status!=='active')conflict();
 C.validatePlan(dataset,[],raw);let clean;try{clean=C.validatePlan(dataset,plans,raw);}catch{conflict();}
 const matches=p=>p?.status==='active'&&JSON.stringify(Object.fromEntries(Object.keys(clean).map(k=>[k,p[k]])))===JSON.stringify(clean);
 if(old){if(!matches(old))conflict();return {submitted:true};}
 const at=new Date().toISOString(),plan={...clean,id:raw.id,version:1,status:'active',createdAt:at,updatedAt:at,updatedRole:session.role};
 if(JSON.stringify(plan).length>45000)fail(400,'INVALID_REQUEST','계획서가 너무 큽니다.');
 const statement=db.prepare('INSERT INTO swap_plans(id,term_id,version,status,content) VALUES(?,?,?,?,?)',plan.id,ctx.term,plan.version,plan.status,JSON.stringify(plan));
 try{await commit(db,ctx,session,statement);}
 catch(error){
  if(/revision_conflict/.test(error.message)||error.code==='CONFLICT'){
   const row=await db.first('SELECT content FROM swap_plans WHERE term_id=? AND id=?',ctx.term,raw.id);
   if(row&&matches(JSON.parse(row.content)))return {submitted:true};
  }throw error;
 }
 return {submitted:true};
}
async function swapDataset(db,ctx){
 const source=await schedule(db,ctx);
 source.swap??=(async()=>{const dataset=datasetFromStore(source.store,source.rt);return {dataset,dataRev:ctx.term+':'+await digest(JSON.stringify(dataset))};})();
 return source.swap;
}
