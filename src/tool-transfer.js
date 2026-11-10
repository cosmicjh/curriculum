import * as Auth from './auth.js';
import * as D from './domain.js';
import Core from './core.js';
import {parse as parseHours} from '../vendor/course-allocation/shared/hours-import.js';

export const validTerm=term=>typeof term==='string'&&/^(?:20[2-9][0-9]|2100)-[12]$/.test(term);
export function newTermSettings(settings,term){
 const [academicYear,semester]=term.split('-').map(Number);
 return D.settings({...settings,academicYear,semester,courseAllocationTeachers:false});
}

function studentRows(raw){
 if(!Array.isArray(raw)||!raw.length||raw.length>1500)throw Error('학생 배정 인원을 확인하세요.');
 const seen=new Set();
 return raw.map(row=>{
  const grade=Core.number(row?.grade),classNum=Core.number(row?.classNum),number=Core.number(row?.number),name=D.clean(row?.name,80);
  const key=[grade,classNum,number].join('-');
  if(!['1','2','3'].includes(grade)||!classNum||!number||Number(classNum)>99||Number(number)>99||!name||seen.has(key))throw Error('학생 배정의 학번·이름을 확인하세요.');
  seen.add(key);
  const choices=row.choices;
  if(!choices||typeof choices!=='object'||Array.isArray(choices)||Object.keys(choices).length>60)throw Error('학생별 선택과목을 확인하세요.');
  const entries=Object.entries(choices).map(([subject,code])=>[D.clean(subject),D.clean(code,30)]);
  if(new Set(entries.map(([subject])=>Core.norm(subject))).size!==entries.length||entries.some(([subject,code])=>!subject||Object.hasOwn(Object.prototype,subject)||!/^[A-Z]+[0-9]*$/.test(Core.code(code))))throw Error('과목명과 분반 코드를 확인하세요.');
  return {grade,classNum,number,name,choices:Object.fromEntries(entries)};
 });
}

export function prepareToolTransfer(db,term,kind,raw){
 const savedAt=new Date().toISOString();
 let data,count;
 if(kind==='hours'){
  const [year,semester]=term.split('-').map(Number);
  const parsed=parseHours(raw);
  const sheets=parsed.sheets.map(sheet=>{
   if(sheet.year&&sheet.year!==year||sheet.semester&&sheet.semester!==semester)throw Error('배정 자료와 대상 학기가 다릅니다.');
   return {...sheet,year,semester};
  });
  count=sheets.reduce((sum,s)=>sum+s.courses.reduce((n,c)=>n+c.sections.length,0),0);
  if(count>3000)throw Error('한 번에 전달할 수 있는 분반은 3,000개까지입니다.');
  data={...parsed,sheets,exportedAt:savedAt,toolVersion:'v19'};
 }else if(kind==='students'){
  data=studentRows(raw);count=data.length;
 }else throw Error('전달 자료 종류를 확인하세요.');
 const content=JSON.stringify(data);
 if(new TextEncoder().encode(content).length>800*1024)Auth.fail(413,'TOO_LARGE','서버 전달 자료는 800KB까지입니다.');
 const result={kind,term,id:crypto.randomUUID(),savedAt,count};
 const statement=db.prepare('INSERT INTO tool_transfers(term_id,kind,transfer_id,content,saved_at) VALUES(?,?,?,?,?) ON CONFLICT(term_id,kind) DO UPDATE SET transfer_id=excluded.transfer_id,content=excluded.content,saved_at=excluded.saved_at',term,kind,result.id,content,result.savedAt);
 return {result,statement};
}

export async function readToolTransfer(db,term,kind,includeContent=false){
 if(!['hours','students'].includes(kind))throw Error('전달 자료 종류를 확인하세요.');
 const fields=includeContent?'content':kind==='students'?"json_array_length(content) AS count":"json_array_length(content,'$.sheets') AS count";
 const row=await db.first('SELECT transfer_id,saved_at,'+fields+' FROM tool_transfers WHERE term_id=? AND kind=?',term,kind);
 if(!row)return null;
 return {term,kind,id:row.transfer_id,savedAt:row.saved_at,...(includeContent?{data:JSON.parse(row.content)}:{count:row.count})};
}

export async function readCourseTransfer(db,term,summary=false){
 if(summary==='counts'){
  const rows=await db.all("SELECT json_extract(value,'$.grade') AS grade,json_extract(value,'$.subject') AS subject,COUNT(*) AS count FROM course_transfers,json_each(content,'$.sections') WHERE term_id=? GROUP BY grade,subject",term);
  return rows;
 }
 const fields=summary?"json_array_length(content,'$.sections') AS count":'content';
 const row=await db.first('SELECT COALESCE(transfer_id,saved_at) AS id,saved_at,'+fields+' FROM course_transfers WHERE term_id=?',term);
 if(!row)return null;
 return {term,id:row.id,savedAt:row.saved_at,...(summary?{count:row.count}:{transfer:JSON.parse(row.content)})};
}

export async function importPayload(db,term,req){
 if(!req.transferRef)return req.payload;
 const {kind,id}=req.transferRef;
 const saved=kind==='course'?await readCourseTransfer(db,term):kind==='students'?await readToolTransfer(db,term,kind,true):null;
 if(!saved||saved.id!==id)Auth.fail(409,'TRANSFER_CHANGED','전달 자료가 변경되었습니다. 다시 불러와 미리보기 하세요.');
 if(kind==='course')return {format:'timetable-import',sections:saved.transfer.sections.map(({grade,subject,code})=>({grade,subject,code}))};
 return {format:'timetable-import',assignmentOnly:true,students:saved.data};
}
