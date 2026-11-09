import {fail} from './auth.js';
export function check(value,message){if(!value)fail(400,'INVALID_REQUEST',message);}
export const seat=value=>{check(typeof value==='string'&&/^(0[1-9]|[1-9][0-9])$/.test(value),'좌석 QR을 다시 확인하세요.');return value;};
export const number=value=>{check(typeof value==='string'&&/^[1-3](0[1-9]|[1-9][0-9])(0[1-9]|[1-9][0-9])$/.test(value),'학번 5자리를 입력하세요.');return value;};
export const requestId=value=>{check(typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value),'요청을 다시 준비해 주세요.');return value;};
export function date(value){const parsed=new Date(value+'T00:00:00Z');check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value,'날짜를 확인하세요.');return value;}
export function localTime(now){const d=new Date(new Date(now).getTime()+9*3600000);return {date:d.toISOString().slice(0,10),time:d.toISOString().slice(11,16),day:d.getUTCDay()||7};}
export function schedule(input,today){
 date(input.effectiveDate);check(input.effectiveDate>=today,'적용일은 오늘 이후로 선택하세요.');
 check(Array.isArray(input.definitions)&&input.definitions.length>0&&input.definitions.length<=30,'회차를 1개부터 30개까지 입력하세요.');
 const ids=new Set(),definitions=input.definitions.map(r=>{
  check(typeof r.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(r.id)&&!ids.has(r.id),'회차 ID를 확인하세요.');ids.add(r.id);
  check(typeof r.label==='string'&&r.label.trim()&&r.label.trim().length<=30,'회차 이름을 입력하세요.');
  check([r.start,r.end].every(s=>typeof s==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s))&&r.start<r.end,'시작·저장 시각을 확인하세요.');
  check(Array.isArray(r.days)&&r.days.length&&r.days.every(d=>Number.isInteger(d)&&d>=1&&d<=7),'요일을 선택하세요.');
  return {id:r.id,label:r.label.trim(),start:r.start,end:r.end,days:[...new Set(r.days)].sort()};
 });
 for(let d=1;d<=7;d++){const rules=definitions.filter(r=>r.days.includes(d)).sort((a,b)=>a.start.localeCompare(b.start));check(rules.every((r,i)=>!i||rules[i-1].end<=r.start),'같은 요일의 회차가 겹칩니다.');}
 return {effectiveDate:input.effectiveDate,definitions};
}
export function currentSession(schedules,ctx,now){
 const t=localTime(now),s=schedules.find(r=>r.effective_date<=t.date);if(!s)return null;
 const r=JSON.parse(s.definitions).find(r=>r.days.includes(t.day)&&r.start<=t.time&&t.time<r.end);if(!r)return null;
 return {id:ctx.term+':'+t.date+':'+s.id+':'+r.id,date:t.date,label:r.label,academic_year:ctx.settings.academicYear,schedule_id:s.id,starts_at:new Date(t.date+'T'+r.start+':00+09:00').toISOString(),ends_at:new Date(t.date+'T'+r.end+':00+09:00').toISOString()};
}
export const studentNumber=s=>s.grade+String(s.class_num).padStart(2,'0')+String(s.number).padStart(2,'0');
