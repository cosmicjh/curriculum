import {C} from './core.js';
export const boundedDataset=raw=>{const ds=C.validateDataset(raw);if(new TextEncoder().encode(JSON.stringify(ds)).byteLength>1900000)throw new Error('시간표 자료가 너무 큽니다. 교사·수업 자료를 확인해 주세요.');return ds;};
const fail = () => { throw new Error('복원할 계획서 자료의 형식·날짜·수업 스냅샷을 확인해 주세요.'); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(value);
const field = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function reservationRows(plans) {
  const rows = [], seen = new Set();
  for (const p of plans.filter(p => p.status === 'active')) {
    for (const i of p.items) {
      const times = [[i.dateA, i.periodA], ...(i.mode === 'swap' ? [[i.dateB, i.periodB]] : [])];
      for (const [date, period] of times) for (const teacher of [p.teacherA, i.teacherB]) {
        const key = C.actualKey(teacher,date,period); if (seen.has(key)) fail(); seen.add(key);
        rows.push({teacher, date, period, plan:p.id});
      }
    }
  }
  return rows;
}
export function validateInput(raw, cutoff = today()) {
  if (raw?.type !== 'class-swap-backup') return {dataset:boundedDataset(raw), plans:[], backup:false};
  if (raw.schema !== 1 || !Array.isArray(raw.plans) || raw.plans.length > 3000) fail();
  const dataset = boundedDataset(raw.dataset), seen = new Set();
  const plans = raw.plans.map(p => {
    if (!p || !/^p_[A-Za-z0-9_-]{12,80}$/.test(p.id) || seen.has(p.id) || !Number.isInteger(p.version) || p.version < 1 || !['active','cancelled'].includes(p.status) || !identifier(p.teacherA) || !field(p.teacherAName,40) || !field(p.reason,200) || !Array.isArray(p.items) || p.items.length < 1 || p.items.length > 24 || JSON.stringify(p).length > 45000) fail();
    C.date(p.submitDate);
    for (const k of ['createdAt','updatedAt']) if (typeof p[k] !== 'string' || p[k].length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(p[k]) || !Number.isFinite(Date.parse(p[k]))) fail();
    if (p.submitter != null && (typeof p.submitter !== 'string' || p.submitter.length > 40)) fail();
    const items = p.items.map(i => {
      if (!i || !['swap','cover'].includes(i.mode) || !identifier(i.teacherB) || i.teacherB === p.teacherA || !field(i.teacherBName,40) || !field(i.subjectA,100) || !field(i.roomA,80) || !Number.isInteger(i.periodA) || i.periodA < 1 || i.periodA > 12 || !Number.isInteger(i.periodB) || i.periodB < 1 || i.periodB > 12 || C.dayOf(i.dateA) > 4 || C.dayOf(i.dateB) > 4) fail();
      if (i.mode === 'cover' && (i.dateA !== i.dateB || i.periodA !== i.periodB)) fail();
      if (i.mode === 'swap' && (!field(i.subjectB,100) || !field(i.roomB,80))) fail();
      return Object.fromEntries(['mode','dateA','periodA','subjectA','roomA','teacherB','teacherBName','dateB','periodB',...(i.mode === 'swap' ? ['subjectB','roomB'] : [])].map(k => [k,i[k]]));
    });
    seen.add(p.id);
    return {id:p.id, version:p.version, status:p.status, teacherA:p.teacherA, teacherAName:p.teacherAName, reason:p.reason, submitter:p.submitter || '', submitDate:p.submitDate, items, createdAt:p.createdAt, updatedAt:p.updatedAt, ...(p.updatedRole ? {updatedRole:p.updatedRole} : {})};
  });
  reservationRows(plans);
  C.validateExisting(dataset, plans, cutoff);
  return {dataset,plans,backup:true};
}
export function counts(input) {
  return {...C.stats(input.dataset), plans:input.plans.length, active:input.plans.filter(p=>p.status==='active').length,
    cancelled:input.plans.filter(p=>p.status==='cancelled').length, reservations:reservationRows(input.plans).length};
}
export function chunks(rows, bytes = 800000) {
  const output = []; let group = [], size = 0;
  for (const row of rows) { const next = new TextEncoder().encode(JSON.stringify(row)).byteLength+1; if (size + next > bytes && group.length) { output.push(group); group=[]; size=0; } group.push(row); size += next; }
  if (group.length) output.push(group); return output;
}
