import * as Auth from './auth.js';
import * as D from './domain.js';
import Core from './core.js';
import {parse as parseHours} from '../modules/allocation/shared/hours-import.js';

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

const yearDifference=(term,sourceTerm)=>Number(term.slice(0,4))-Number(sourceTerm.slice(0,4));

export function prepareToolTransfer(db,term,kind,raw,sourceTerm){
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
  const students=studentRows(raw),advance=yearDifference(term,sourceTerm);
  if(students.some(s=>Number(s.grade)+advance>3))throw Error('진급 학년이 3학년을 넘는 학생이 있습니다.');
  data={sourceTerm,students};count=students.length;
 }else throw Error('전달 자료 종류를 확인하세요.');
 const content=JSON.stringify(data);
 if(new TextEncoder().encode(content).length>800*1024)Auth.fail(413,'TOO_LARGE','서버 전달 자료는 800KB까지입니다.');
 const result={kind,term,id:crypto.randomUUID(),savedAt,count,...(kind==='students'?{sourceTerm}:{})};
 const statement=db.prepare('INSERT INTO tool_transfers(term_id,kind,transfer_id,content,saved_at) VALUES(?,?,?,?,?) ON CONFLICT(term_id,kind) DO UPDATE SET transfer_id=excluded.transfer_id,content=excluded.content,saved_at=excluded.saved_at',term,kind,result.id,content,result.savedAt);
 return {result,statement};
}

export async function readToolTransfer(db,term,kind,includeContent=false){
 if(!['hours','students'].includes(kind))throw Error('전달 자료 종류를 확인하세요.');
 const fields=includeContent?'content':kind==='students'
  ?"COALESCE(json_array_length(content,'$.students'),json_array_length(content)) AS count,json_extract(content,'$.sourceTerm') AS source_term"
  :"json_array_length(content,'$.sheets') AS count";
 const row=await db.first('SELECT transfer_id,saved_at,'+fields+' FROM tool_transfers WHERE term_id=? AND kind=?',term,kind);
 if(!row)return null;
 const saved={term,kind,id:row.transfer_id,savedAt:row.saved_at};
 if(!includeContent)return {...saved,count:row.count,...(kind==='students'?{sourceTerm:row.source_term??term}:{})};
 const data=JSON.parse(row.content);
 if(kind==='students')return {...saved,sourceTerm:Array.isArray(data)?term:data.sourceTerm,data:Array.isArray(data)?data:data.students};
 return {...saved,data};
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

function studentMapping(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('구학번 대응 파일을 선택하세요.');
 if(rows.length>3000)throw Error('구학번 대응표는 3,000행까지입니다.');
 const oldNumbers=new Map(),newNumbers=new Set(),sid=/^\d{5}$/;
 for(const row of rows){
  const {oldNumber,newNumber,name}=row??{};
  if(typeof oldNumber!=='string'||typeof newNumber!=='string'||!sid.test(oldNumber)||!sid.test(newNumber)||typeof name!=='string'||!D.clean(name,80))throw Error('구학번 대응의 학번·이름을 확인하세요.');
  if(oldNumbers.has(oldNumber)||newNumbers.has(newNumber))throw Error('구학번 또는 신학번이 중복됩니다.');
  oldNumbers.set(oldNumber,{newNumber,name:Core.text(name)});newNumbers.add(newNumber);
 }
 return oldNumbers;
}

export async function importPayload(db,store,req){
 if(!req.transferRef)return req.payload;
 const {kind,id}=req.transferRef;
 const term=store.term;
 const saved=kind==='course'?await readCourseTransfer(db,term):kind==='students'?await readToolTransfer(db,term,kind,true):null;
 if(!saved||saved.id!==id)Auth.fail(409,'TRANSFER_CHANGED','전달 자료가 변경되었습니다. 다시 불러와 미리보기 하세요.');
 if(kind==='course')return {format:'timetable-import',sections:saved.transfer.sections.map(({grade,subject,code})=>({grade,subject,code}))};
 const advance=yearDifference(term,saved.sourceTerm);
 if(advance<=0)return {format:'timetable-import',assignmentOnly:true,students:saved.data};
 const mapping=studentMapping(req.transferRef.studentMapping);
 const roster=new Map(store.students.filter(Core.active).map(s=>[Core.sid(s),s]));
 const students=[],excludedStudents=[];
 for(const student of saved.data){
  const oldNumber=Core.sid(student),entry=mapping.get(oldNumber),match=roster.get(entry?.newNumber);
  let reason;
  if(!entry)reason='대응 없음';
  else if(entry.name!==Core.text(student.name))reason='이름 불일치';
  else if(Number(entry.newNumber[0])!==Number(student.grade)+advance)reason='진급 학년 불일치';
  else if(!match)reason='명부 없음';
  else if(Core.text(match.name)!==entry.name)reason='명부 이름 불일치';
  if(reason)excludedStudents.push({oldNumber,name:student.name,reason});
  else students.push({...student,grade:match.grade,classNum:match.classNum,number:match.number});
 }
 if(!students.length)throw Error('구학번 대응으로 연결할 수 있는 학생이 없습니다.');
 return {format:'timetable-import',assignmentOnly:true,students,excludedStudents};
}
