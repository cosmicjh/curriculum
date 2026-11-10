import Core from './core.js';
export const statuses=['재학','전출','자퇴','휴학','졸업'];
export function clean(v,max=100){const s=Core.text(v);if(s.length>max)throw Error('입력 길이를 확인하세요.');return s;}
export function settings(input){
 const s={...Core.defaultSettings(),...input},y=Number(s.academicYear),semester=Number(s.semester);
 if(!Number.isInteger(y)||y<2020||y>2100||![1,2].includes(semester))throw Error('학년도·학기를 확인하세요.');
 s.academicYear=y;s.semester=semester;s.schoolName=clean(s.schoolName,80);s.title=clean(s.title)||'개인 시간표';
 const periods={};for(const d of Core.DAYS){const n=Number(s.periods?.[d]);if(!Number.isInteger(n)||n<1||n>7)throw Error('요일별 교시를 확인하세요.');periods[d]=n;}s.periods=periods;
 if(!Array.isArray(s.fixedPeriods)||s.fixedPeriods.length>35)throw Error('창체 설정을 확인하세요.');
 s.fixedPeriods=s.fixedPeriods.map(f=>{if(!Core.DAYS.includes(f.day)||!Number.isInteger(Number(f.period))||f.period<1||f.period>periods[f.day])throw Error('창체 교시를 확인하세요.');return {day:f.day,period:Number(f.period),label:clean(f.label,30)||'창체'};});return s;
}
export function assertStore(store){
 if(!store||!Array.isArray(store.students)||!Array.isArray(store.sections)||!Array.isArray(store.teacherRows)||!Array.isArray(store.overrides)||!Array.isArray(store.blocks))throw Error('자료 형식을 확인하세요.');
 settings(store.settings);const v=Core.validate(store);if(v.errors.length)throw Error(v.errors.slice(0,10).join('\n'));
 const ids=new Set();for(const s of store.sections){if(!s.id||ids.has(s.id)||!['1','2','3'].includes(String(s.grade)))throw Error('분반 ID·학년을 확인하세요.');ids.add(s.id);}
 for(const s of store.students){if(!statuses.includes(s.status||'재학')||!Array.isArray(s.manualFields||[])||typeof s.choices!=='object'||!s.choices||Array.isArray(s.choices))throw Error('학생 자료를 확인하세요.');clean(s.name,80);clean(s.note,500);}
 for(const o of store.overrides){slot(o);if(!ids.has(o.sectionId))throw Error('수업 연결의 분반이 없습니다.');}
 for(const b of store.blocks)block(b);
 return v;
}
export function slot(o){if(!o||!Core.DAYS.includes(o.day)||!Number.isInteger(Number(o.period))||o.period<1||o.period>7||!clean(o.teacher,80))throw Error('수업 정보를 확인하세요.');}
export function block(o){if(!o||!['1','2','3'].includes(String(o.grade))||!Core.DAYS.includes(o.day)||!Number.isInteger(Number(o.period))||o.period<1||o.period>7||o.block&&!/^[A-Z]+$/.test(o.block))throw Error('시간블록을 확인하세요.');}
export function student(input,old){
 const s={id:old?.id||crypto.randomUUID(),sourceKey:old?.sourceKey||Core.key(input),manualFields:[...(old?.manualFields||[])],choices:{},updatedAt:new Date().toISOString()};
 for(const k of ['grade','classNum','number'])s[k]=Core.number(input[k]);
 s.name=clean(input.name,80);s.note=clean(input.note,500);s.status=clean(input.status,10)||'재학';
 if(!statuses.includes(s.status))throw Error('학적을 확인하세요.');
 for(const k of ['grade','classNum','number','name','note','status'])if(!old||s[k]!==old[k])s.manualFields.push(k);
 if(!input.choices||typeof input.choices!=='object'||Array.isArray(input.choices))throw Error('수강 배정을 확인하세요.');
 for(const subject of new Set([...Object.keys(input.choices),...Object.keys(old?.choices||{})])){clean(subject,100);s.choices[subject]=clean(input.choices[subject],30);if(!old||s.choices[subject]!==old.choices[subject])s.manualFields.push('choice:'+subject);}
 s.manualFields=[...new Set(s.manualFields)];const v=Core.validate({students:[s],sections:[],teacherRows:[]});if(v.errors.length)throw Error(v.errors.join('\n'));return s;
}
export function section(input,old){
 const s={id:old?.id||crypto.randomUUID(),grade:Core.number(input.grade),subject:clean(input.subject),code:clean(input.code,30),shortName:clean(input.shortName),room:clean(input.room),manualFields:[...(old?.manualFields||[])]};
 if(!['1','2','3'].includes(s.grade)||!s.subject||!Core.block(s.code))throw Error('학년·과목·분반을 확인하세요.');
 s.sourceKey=old?.sourceKey||Core.sectionKey(s.grade,s.subject,s.code);
 for(const k of ['grade','subject','code','shortName','room'])if(!old||s[k]!==old[k])s.manualFields.push(k);s.manualFields=[...new Set(s.manualFields)];return s;
}
export function prepareImport(store,payload,preserve=true,revision=''){
 if(!payload||payload.format!=='timetable-import'||!payload.teacherRows&&!payload.sections&&!payload.students)throw Error('업로드 자료를 선택하세요.');
 const next=structuredClone(store),parts=[],summary={errors:[],warnings:[],addedStudents:0,changedStudents:0,preservedFields:0,missingStudents:0,revision};
 if(payload.teacherRows){next.teacherRows=payload.teacherRows;parts.push('teacherRows');}
 if(payload.sections){
  const natural=new Map(),source=new Map();for(const s of store.sections){natural.set(Core.sectionKey(s.grade,s.subject,s.code),s);if(s.sourceKey)source.set(s.sourceKey,s);}
  const imported=payload.sections.map(raw=>{const key=Core.sectionKey(raw.grade,raw.subject,raw.code),old=source.get(key)||natural.get(key),s={id:old?.id||crypto.randomUUID(),sourceKey:old?.sourceKey||key,manualFields:old?.manualFields||[]};for(const k of ['grade','subject','code','shortName','room']){s[k]=preserve&&old?.manualFields?.includes(k)?old[k]:k==='grade'?Core.number(raw[k]):clean(raw[k]);if(s[k]!==raw[k]&&old?.manualFields?.includes(k))summary.preservedFields++;}return s;});
  // Preserve sections referenced by protected choices or manual links.
  const ids=new Set(imported.map(s=>s.id));for(const s of store.sections)if(!ids.has(s.id))imported.push(s);
  next.sections=imported;parts.push('sections');
 }
 if(payload.students){
 const seen=new Set(),studentsByKey=new Map(),sectionsBySource=new Map();
 const inferred=[],infer=payload.inferSections===true&&!payload.sections;
 // Build lookup keys once. Re-normalizing every section for every choice can
 // exhaust the deployed Worker's CPU before its atomic D1 write starts.
 for(const section of next.sections){
  if(!sectionsBySource.has(section.sourceKey))sectionsBySource.set(section.sourceKey,section);
  if(infer)sectionsBySource.set(Core.sectionKey(section.grade,section.subject,section.code),section);
 }
 const keys=s=>new Set([s.sourceKey,Core.key(s)]);
 function indexStudent(s,index,remove=false){for(const key of keys(s)){if(remove)studentsByKey.get(key)?.delete(index);else{if(!studentsByKey.has(key))studentsByKey.set(key,new Set());studentsByKey.get(key).add(index);}}}
 next.students.forEach((s,index)=>indexStudent(s,index));
 for(const raw of payload.students){
  const sourceKey=Core.key(raw),candidates=Array.from(studentsByKey.get(sourceKey)||[]);if(candidates.length>1)throw Error('학번 연결이 모호합니다: '+sourceKey);
  const index=candidates[0],old=index===undefined?null:next.students[index],s=old?structuredClone(old):{id:crypto.randomUUID(),sourceKey,status:'재학',choices:{},manualFields:[]};if(seen.has(s.id))throw Error('등록 학생이 중복됩니다: '+sourceKey);seen.add(s.id);
  for(const k of ['grade','classNum','number','name','note']){const value=['grade','classNum','number'].includes(k)?Core.number(raw[k]):clean(raw[k],k==='note'?500:80);if(preserve&&old&&s.manualFields.includes(k)){if(value!==s[k])summary.preservedFields++;}else s[k]=value;}
  for(const subject of Object.keys(raw.choices||{})){
   const value=clean(raw.choices[subject],30);
   if(preserve&&old&&s.manualFields.includes('choice:'+subject)){if(value!==s.choices[subject])summary.preservedFields++;continue;}
   const choiceKey=Core.sectionKey(raw.grade,subject,value);
   let mapped=sectionsBySource.get(choiceKey);
   if(infer&&(!mapped||mapped.grade!==s.grade)){
    const name=clean(subject,100),key=Core.sectionKey(s.grade,name,value);
    mapped=sectionsBySource.get(key);
    if(mapped&&mapped.grade!==s.grade)mapped=null;
    if(!mapped&&name&&['1','2','3'].includes(s.grade)&&/^[A-Z]+\d*$/.test(Core.code(value))){
     mapped={id:crypto.randomUUID(),sourceKey:key,grade:s.grade,subject:name,code:value,room:'',shortName:'',manualFields:[]};
     next.sections.push(mapped);sectionsBySource.set(key,mapped);
     inferred.push(s.grade+'학년 '+name+' '+value);
    }
   }
   s.choices[mapped?.subject||subject]=mapped?.code||value;
  }
  if(!preserve)s.manualFields=s.manualFields.filter(k=>k==='status');s.updatedAt=new Date().toISOString();
  if(old){indexStudent(old,index,true);next.students[index]=s;indexStudent(s,index);if(JSON.stringify({...s,updatedAt:old.updatedAt})!==JSON.stringify(old))summary.changedStudents++;}else{const addedIndex=next.students.length;next.students.push(s);indexStudent(s,addedIndex);summary.addedStudents++;}
 }
 const grades=new Set(payload.students.map(s=>String(s.grade)));summary.missingStudents=store.students.filter(s=>grades.has(s.grade)&&!seen.has(s.id)).length;
 if(summary.missingStudents)summary.warnings.push('업로드에 없는 기존 학생 '+summary.missingStudents+'명은 유지합니다.');
 if(inferred.length){parts.push('sections');summary.inferredSections=inferred;}
 parts.push('students');}
 const v=Core.validate(next);summary.errors=v.errors;summary.warnings.push(...v.warnings);const rt=Core.runtime(next);
 Object.assign(summary,{students:next.students.length,sections:next.sections.length,teachers:rt.teachers.length,linkWarnings:rt.warnings.length});
 if(rt.warnings.length)summary.warnings.push('학년·분반 확인이 필요한 수업 '+rt.warnings.length+'건');return {store:next,parts,summary};
}
export const studentSummary=s=>({id:s.id,grade:s.grade,classNum:s.classNum,number:s.number,name:s.name,status:s.status,note:s.note||'',choiceCount:Object.values(s.choices||{}).filter(Boolean).length});
export const lesson=l=>({key:l.key,teacher:l.teacher,day:l.day,period:l.period,rawSubject:l.rawSubject,rawRoom:l.rawRoom,sectionId:l.section?.id||'',candidateIds:l.candidates.map(s=>s.id)});
