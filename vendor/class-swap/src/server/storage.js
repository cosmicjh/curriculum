import {C} from '../shared/core.js';
import {boundedDataset, chunks, reservationRows, today, validateInput} from '../shared/backup.js';
import {random} from './crypto.js';
import {business, conflict, invalid} from './errors.js';
export async function readState(db) {
  const [state, plans] = await db.batch([db.prepare('SELECT * FROM state WHERE id=1'), db.prepare('SELECT content FROM plans ORDER BY id')]);
  const s = state.results[0];
  return {...s, dataset:s.dataset ? JSON.parse(s.dataset) : null, plans:plans.results.map(p=>JSON.parse(p.content))};
}
export function snapshot(s, role, known = {}) {
  return {version:'2026.11.02',role,dataRev:String(s.data_rev),planRev:String(s.plan_rev),hasDataset:!!s.dataset,
    dataset:String(known.dataRev) === String(s.data_rev) ? null : s.dataset,
    plans:String(known.planRev) === String(s.plan_rev) ? null : s.plans};
}
function guard(db, state, auth) {
  const id = random(16);
  return {id, statement:db.prepare(`INSERT INTO mutation_guard(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM state WHERE id=1 AND revision=?)
    AND EXISTS(SELECT 1 FROM sessions s JOIN credentials c ON s.role=c.role AND s.epoch=c.epoch WHERE s.token_hash=? AND s.expires>?) THEN 1 ELSE 0 END)`)
    .bind(id,state.revision,auth.tokenHash,Date.now())};
}
export async function commit(db, s, auth, statements, dataChanged = false, plansChanged = true) {
  const g = guard(db,s,auth);
  try { await db.batch([g.statement,...statements,db.prepare('UPDATE state SET revision=revision+1,data_rev=data_rev+?,plan_rev=plan_rev+? WHERE id=1').bind(+dataChanged,+plansChanged),db.prepare('DELETE FROM mutation_guard WHERE id=?').bind(g.id)]); }
  catch (e) {
    if (/CHECK constraint failed|UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(String(e.message))) conflict();
    throw e;
  }
}
export function insertPlans(db, plans) {
  return chunks(plans).map(group=>db.prepare(`INSERT INTO plans(id,version,status,content) SELECT json_extract(value,'$.id'),json_extract(value,'$.version'),json_extract(value,'$.status'),value FROM json_each(?)`).bind(JSON.stringify(group)));
}
export function insertReservations(db, plans) {
  return chunks(reservationRows(plans)).map(group=>db.prepare(`INSERT INTO reservations(teacher_id,actual_date,period,plan_id) SELECT json_extract(value,'$.teacher'),json_extract(value,'$.date'),json_extract(value,'$.period'),json_extract(value,'$.plan') FROM json_each(?)`).bind(JSON.stringify(group)));
}
function revision(expected, actual) { if (String(expected) !== String(actual)) conflict(); }
function sameCreate(old, clean) {
  return old?.status === 'active' && JSON.stringify(Object.fromEntries(Object.keys(clean).map(k=>[k,old[k]]))) === JSON.stringify(clean);
}
export async function savePlan(db, s, auth, payload) {
  revision(payload.dataRev,s.data_rev);
  if (!s.dataset) invalid('먼저 시간표를 등록해 주세요.');
  const raw = payload.plan;
  if (!raw || !/^p_[A-Za-z0-9_-]{12,80}$/.test(raw.id) || !Number.isInteger(raw.version) || raw.version < 0) invalid('계획서 식별자·버전을 확인해 주세요.');
  const old = s.plans.find(p=>p.id===raw.id);
  if (old && raw.version !== 0) revision(raw.version,old.version);
  if (old && old.status !== 'active') conflict();
  if (!old && raw.version !== 0) conflict();
  business(()=>C.validatePlan(s.dataset,[],raw));
  let clean;
  try { clean=C.validatePlan(s.dataset,s.plans,raw); } catch { conflict(); }
  if (old && raw.version === 0) {
    if (sameCreate(old,clean)) return {plan:old,planRev:String(s.plan_rev)};
    conflict();
  }
  const now = new Date().toISOString();
  const plan = {...clean,id:raw.id,version:old ? old.version+1 : 1,status:'active',createdAt:old?.createdAt || now,updatedAt:now,updatedRole:auth.role};
  if (JSON.stringify(plan).length > 45000) invalid('계획서가 너무 큽니다.');
  const statements = [db.prepare('DELETE FROM reservations WHERE plan_id=?').bind(plan.id)];
  if (old) statements.push(db.prepare('DELETE FROM plans WHERE id=?').bind(plan.id));
  statements.push(...insertPlans(db,[plan]),...insertReservations(db,[plan]));
  try { await commit(db,s,auth,statements); }
  catch(e) {
    if (e.code === 'CONFLICT' && raw.version === 0) {
      const current = await readState(db), winner=current.plans.find(p=>p.id===raw.id);
      if (current.data_rev === s.data_rev && sameCreate(winner,clean)) return {plan:winner,planRev:String(current.plan_rev)};
    }
    throw e;
  }
  return {plan,planRev:String(s.plan_rev+1)};
}
export async function cancelPlan(db, s, auth, payload) {
  const old = s.plans.find(p=>p.id===payload.id); if (!old) invalid('계획서를 찾지 못했습니다.');
  revision(payload.version,old.version); if (old.status !== 'active') conflict();
  const plan = {...old,status:'cancelled',version:old.version+1,updatedAt:new Date().toISOString(),updatedRole:auth.role};
  await commit(db,s,auth,[db.prepare('DELETE FROM reservations WHERE plan_id=?').bind(plan.id),
    db.prepare('UPDATE plans SET version=?,status=?,content=? WHERE id=?').bind(plan.version,plan.status,JSON.stringify(plan),plan.id)]);
  return {plan,planRev:String(s.plan_rev+1)};
}
export async function replaceData(db, s, auth, payload) {
  revision(payload.dataRev,s.data_rev);
  const dataset=business(()=>boundedDataset(payload.dataset)); business(()=>C.validateExisting(dataset,s.plans,today()));
  await commit(db,s,auth,[db.prepare('UPDATE state SET dataset=? WHERE id=1').bind(JSON.stringify(dataset))],true,false);
  return snapshot({...s,dataset,data_rev:s.data_rev+1},auth.role);
}
export async function restoreBackup(db, s, auth, payload) {
  revision(payload.dataRev,s.data_rev); revision(payload.planRev,s.plan_rev);
  if (payload.backup?.type !== 'class-swap-backup') invalid('전체 복원에는 class-swap-backup JSON이 필요합니다.');
  const input = business(()=>validateInput(payload.backup));
  await commit(db,s,auth,[db.prepare('DELETE FROM reservations'),db.prepare('DELETE FROM plans'),
    db.prepare('UPDATE state SET dataset=? WHERE id=1').bind(JSON.stringify(input.dataset)),...insertPlans(db,input.plans),...insertReservations(db,input.plans)],true,true);
  return snapshot({...s,...input,data_rev:s.data_rev+1,plan_rev:s.plan_rev+1},auth.role);
}
