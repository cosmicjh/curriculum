import * as Auth from './auth.js';
import * as D from './domain.js';
import * as S from './storage.js';
import Core from './core.js';

export function requireEnabled(ctx){
 if(ctx.settings.courseAllocationTeachers!==true)Auth.fail(403,'COURSE_CLOSED','시수배당표가 열려 있지 않습니다. 관리자 설정에서 시수배당표 사용을 허용해 주세요.');
}
export async function storeCourseTransfer(db,transfer){
 const {term,sections}=transfer;
 if(!/^(?:20[2-9]\d|2100)-[12]$/.test(term)||transfer.format!=='school-course-allocation-transfer'||transfer.schemaVersion!==1||!Array.isArray(sections)||!sections.length||sections.length>3000)Auth.fail(400,'INVALID_REQUEST','전달 자료의 학기와 형식을 확인하세요.');
 const keys=new Set(),validHours=hours=>Number.isInteger(hours)&&hours>0&&hours<=40;
 const normalized=sections.map(s=>{
  const code=D.clean(s.code,30),subject=D.clean(s.subject),grade=String(s.grade),key=Core.sectionKey(grade,subject,code);
  if(!['1','2','3'].includes(grade)||!subject||!Core.block(code)||keys.has(key)||!validHours(s.weeklyHours)||!Array.isArray(s.teachers)||s.teachers.length>40)Auth.fail(400,'INVALID_REQUEST','전달 자료의 과목·분반·시수를 확인하세요.');
  const teachers=s.teachers.map(t=>({name:D.clean(t.name,80),hours:t.hours}));
  if(teachers.some(t=>!t.name||!validHours(t.hours))||teachers.reduce((sum,t)=>sum+t.hours,0)!==s.weeklyHours)Auth.fail(400,'INVALID_REQUEST','담당 교사와 시수를 확인하세요.');
  keys.add(key);return {grade,subject,code,weeklyHours:s.weeklyHours,teachers};
 });
 const ctx=await S.context(db),[academicYear,semester]=term.split('-').map(Number),at=new Date().toISOString();
 const defaults=D.settings({...Core.defaultSettings(),academicYear,semester,schoolName:ctx.settings.schoolName,title:ctx.settings.title});
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO terms(id,settings) VALUES(?,?)',term,JSON.stringify(defaults)),
  db.prepare('INSERT INTO course_transfers(term_id,content,saved_at,transfer_id) VALUES(?,?,?,?) ON CONFLICT(term_id) DO UPDATE SET content=excluded.content,saved_at=excluded.saved_at,transfer_id=excluded.transfer_id',term,JSON.stringify({format:transfer.format,schemaVersion:1,term,sections:normalized}),at,crypto.randomUUID()),
  db.prepare('UPDATE app_state SET history_revision=history_revision+1 WHERE id=1')
 ]);
 return {term,sections:sections.length};
}
