import Core from './core.js';
import {clean} from './domain.js';

// Sections retain their IDs and student choices; the board owns rooms and teams.
export function prepareAllocation(store,input){
 if(!input||!Array.isArray(input.rooms)||!Array.isArray(input.grades)||input.rooms.length>60||input.grades.length>3)throw Error('배치표 형식을 확인하세요.');
 const ids=new Set(),labels=new Set(),rooms=input.rooms.map(r=>{
  const id=clean(r.id,80),label=clean(r.label,100),classNum=r.classNum?Core.number(r.classNum):'';
  if(!id||!label||ids.has(id)||labels.has(Core.norm(label))||r.classNum&&(!classNum||Number(classNum)>99))throw Error('교실 이름·번호가 비어 있거나 중복됩니다.');
  ids.add(id);labels.add(Core.norm(label));return {id,label,classNum};
 }),sections=structuredClone(store.sections),byId=new Map(sections.map(s=>[s.id,s])),byKey=new Map(sections.map(s=>[Core.sectionKey(s.grade,s.subject,s.code),s]));
 const oldIds=new Set((store.allocation?.grades||[]).flatMap(g=>g.blocks.flatMap(b=>Object.values(b.cells).map(c=>c.sectionId))));
 const used=new Set(),grades=new Set(),warnings=[];
 const board={rooms,grades:input.grades.map(g=>{
  const grade=Core.number(g.grade);if(!['1','2','3'].includes(grade)||grades.has(grade)||!Array.isArray(g.blocks)||g.blocks.length>30)throw Error('배치표 학년을 확인하세요.');grades.add(grade);
  const codes=new Set(),slots=new Set(),homerooms={};
  for(const [id,name] of Object.entries(g.homerooms||{})){if(!ids.has(id))throw Error('담임 교실을 확인하세요.');homerooms[id]=clean(name,80);}
  return {grade,homerooms,blocks:g.blocks.map(b=>{
   const code=clean(b.code,8).toUpperCase();if(!/^[A-Z]+$/.test(code)||codes.has(code)||!Array.isArray(b.slots)||b.slots.length>7)throw Error('시간블록 이름·교시를 확인하세요.');codes.add(code);
   const times=b.slots.map(s=>{const period=Number(s.period),key=s.day+period;if(!Core.DAYS.includes(s.day)||!Number.isInteger(period)||period<1||period>store.settings.periods[s.day]||slots.has(key)||(store.settings.fixedPeriods||[]).some(f=>f.day===s.day&&Number(f.period)===period))throw Error(grade+'학년 '+code+'의 교시가 중복되거나 수업 가능 시간이 아닙니다.');slots.add(key);return {day:s.day,period};});
   const cells={};for(const [id,c] of Object.entries(b.cells||{})){
    if(!ids.has(id)||!c||typeof c!=='object')throw Error('배치 교실을 확인하세요.');
    const old=c.sectionId?byId.get(c.sectionId):null;if(c.sectionId&&!old)throw Error('분반 정보가 변경되었습니다. 새로고침하여 확인하세요.');
    const subject=clean(c.subject??old?.subject,100),sc=clean(c.code??old?.code,30);
    if(!subject||Core.block(sc)!==code)throw Error(grade+'학년 '+code+'의 과목·분반을 확인하세요.');
    let section=old||byKey.get(Core.sectionKey(grade,subject,sc));
    if(section&&(section.grade!==grade||Core.sectionKey(grade,subject,sc)!==Core.sectionKey(section.grade,section.subject,section.code)))throw Error('기존 분반의 과목·이름은 선택분반 메뉴에서 수정하세요.');
    if(!section){section={id:crypto.randomUUID(),grade,subject,code:sc,shortName:'',room:'',manualFields:[],sourceKey:Core.sectionKey(grade,subject,sc)};sections.push(section);byId.set(section.id,section);byKey.set(section.sourceKey,section);}
    if(used.has(section.id))throw Error('같은 분반을 두 교실에 배치할 수 없습니다: '+subject+' '+sc);used.add(section.id);
    if(!Array.isArray(c.teachers)||c.teachers.length>20)throw Error('담당 교사를 확인하세요.');
    const teachers=c.teachers.map(n=>clean(n,80));if(teachers.some(n=>!n)||new Set(teachers.map(Core.norm)).size!==teachers.length)throw Error('담당 교사명이 비어 있거나 중복됩니다.');
    section.room=rooms.find(r=>r.id===id).classNum?grade+'-'+rooms.find(r=>r.id===id).classNum:rooms.find(r=>r.id===id).label;
    section.manualFields=[...new Set([...(section.manualFields||[]),'room'])];cells[id]={sectionId:section.id,teachers};
   }
   return {code,slots:times,cells};
  })};
 })};
 for(const id of oldIds)if(!used.has(id)&&byId.has(id)){byId.get(id).room='';byId.get(id).manualFields=[...new Set([...(byId.get(id).manualFields||[]),'room'])];}
 const names=new Set(Core.parseTeacherMatrix(store.teacherRows).teachers.map(t=>Core.norm(t.name)));
 for(const name of new Set(board.grades.flatMap(g=>g.blocks.flatMap(b=>Object.values(b.cells).flatMap(c=>c.teachers)))))if(!names.has(Core.norm(name)))warnings.push(name+' 교사의 시간표 자료가 없습니다. 배치표에는 저장됩니다.');
 return {store:{...store,sections,allocation:board},board,warnings};
}
