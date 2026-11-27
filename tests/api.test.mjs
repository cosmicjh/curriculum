import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {backup,fixture} from './fixture.mjs';
import {setupStudyroom} from './studyroom-fixture.mjs';
import Core from '../src/core.js';
import {summarize} from '../scripts/compare-backups.mjs';
test('integrated allocation uses the existing workspace, role, and independent term',async t=>{
 const h=await harness({course:true});t.after(()=>h.close());
 for(const sql of (await readFile('tests/course-fixture.sql','utf8')).trim().split(/;\s*/).filter(Boolean))await h.sql(sql);
 const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const request=(cookie,role,path='/workspace',method='GET',data={})=>h.api('courseWorkspace',{role,path,method,data},cookie);
 const {cookie:student}=await h.login('student');
 assert.equal((await request(student,'teacher')).status,401);
 assert.equal((await request(student,'admin')).status,401);
 assert.equal((await request('','admin')).status,401);
 assert.equal((await request(teacher,'admin')).status,401);
 assert.equal((await request(teacher,'teacher')).code,'COURSE_CLOSED');
 const start=await request(admin,'admin');
 assert(start.ok);assert.equal(start.data.admin,true);assert.equal(start.data.global.school.semester,1);
 assert.equal(start.data.activeTerm,'2026-2');
 assert.deepEqual((await request(admin,'admin','/term')).data,{term:'2026-1',activeTerm:'2026-2',archivedTerms:[]});
 assert.equal(start.data.departments.length,2);assert.equal(start.data.parts[0].teachers[0].name,'가상교사1');
 assert.equal((await request(admin,'admin','/auth/password','POST')).status,404);
 assert((await h.mutation('saveSettings',{settings:{...Core.defaultSettings(),courseAllocationTeachers:true}},admin)).ok);
 assert.equal((await request(teacher,'teacher')).data.admin,false);
 assert.equal((await request(admin,'teacher')).data.admin,false);
 assert.equal((await request(teacher,'teacher','/term')).status,403);
 assert.equal((await request(teacher,'teacher','/term','POST',{term:'2027-1'})).status,403);
 assert.equal((await request(teacher,'teacher','/timetable-transfer','POST',{term:'2026-1'})).status,403);
 const part=structuredClone(start.data.parts[0]);part.teachers[0].name='가상교사수정';
 const save={part,revision:start.data.revisions.d1,globalRevision:start.data.globalRevision,operationId:'test-'+crypto.randomUUID()};
 const saved=await request(teacher,'teacher','/sheets/d1','PUT',save);assert(saved.ok,JSON.stringify(saved));
 assert.deepEqual((await request(teacher,'teacher','/sheets/d1','PUT',save)).data,saved.data);
 assert((await request(admin,'admin','/term','POST',{term:'2027-1'})).ok);
 assert.equal((await request(admin,'admin')).data.global.school.year,2027);
 assert.deepEqual((await request(admin,'admin','/term')).data,{term:'2027-1',activeTerm:'2026-2',archivedTerms:['2026-1']});
 assert((await request(admin,'admin','/term','POST',{term:'2026-1'})).ok);
 assert.equal((await request(admin,'admin')).data.parts[0].teachers[0].name,'가상교사수정');
 await h.sql("UPDATE ca_sheets SET payload=json_set(payload,'$.department.status','locked') WHERE id='d1'");
 const sent=await request(admin,'admin','/timetable-transfer','POST',{term:'2026-1'});
 assert.deepEqual(sent.data,{term:'2026-1',sections:1});
 assert.equal((await h.api('bootstrap')).data.term,'2026-2');
 await t.test('courseTransfer counts use the requested term and default to the operating term',async()=>{
  const counts=(data={},cookie=admin)=>h.api('courseTransfer',{summary:'counts',...data},cookie);
  const otherTerm=await counts({term:'2026-1'});assert(otherTerm.ok,otherTerm.error);
  assert.equal(otherTerm.data.length,1);assert.equal(otherTerm.data[0].count,1);
  assert.deepEqual((await counts()).data,[]);
  assert.equal((await counts({term:'2027-3'})).status,400);
  assert.equal((await counts({term:null})).status,400);
  assert.equal((await counts({term:'2026-1'},teacher)).status,401);
  assert.equal((await h.api('courseTransfer',{term:'2026-1'},admin)).data,null);
  assert((await h.mutation('switchTerm',{term:'2026-1'},admin)).ok);
  assert.deepEqual((await counts()).data,otherTerm.data);
 });
 assert.equal((await h.api('courseTransfer',{},admin)).data.transfer.sections[0].teachers[0].name,'가상교사수정');
 assert.equal((await request(teacher,'teacher')).code,'COURSE_CLOSED');
 assert.equal((await request(admin,'admin')).data.admin,true);
 await h.api('logout',{},admin);
 assert.equal((await request(admin,'admin')).status,401);
});
const hours={format:'school-course-hours',schemaVersion:1,hoursUnit:'weekly-periods',includesStudentData:false,sheets:[{
 sheetId:'grade3',sourceSheetName:'3학년',grade:3,students:['전달에서 제외할 이름'],
 validation:{complete:true,hardConstraintsPassed:true,coupledCohortsPassed:true},coupledCohorts:[],
 courses:[{courseId:'science',courseName:'가상과학',credits:3,weeklyHours:3,sectionCount:1,totalWeeklyHours:3,
  sections:[{sectionId:'science-a',sectionCode:'A',timeBlock:'A',weeklyHours:3}]}]
}]};

test('staged hours keep incomplete counts in storage and assignment-hours',async t=>{
 const h=await harness({course:true});t.after(()=>h.close());
 const {cookie:admin}=await h.login();
 const term='2026-2',data=structuredClone(hours),validation=data.sheets[0].validation;
 const stage=()=>h.mutation('stageToolTransfer',{kind:'hours',term,data},admin);
 Object.assign(validation,{complete:false,missingChoices:7,unassignedStudents:2});
 const saved=await stage();assert(saved.ok,saved.error);
 for(const [key,value] of [
  ['complete',null],['hardConstraintsPassed',false],['coupledCohortsPassed',false],
  ['missingChoices',-1],['unassignedStudents',1.5],
  ...['missingChoices','unassignedStudents'].flatMap(key=>[Number.MAX_SAFE_INTEGER+1,1e100].map(value=>[key,value]))
 ]){
  const original=validation[key];validation[key]=value;
  assert.equal((await stage()).status,400,key);
  validation[key]=original;
 }
 const stored=await h.sql("SELECT transfer_id,content FROM tool_transfers WHERE term_id=? AND kind='hours'",term);
 const course=(path,method='GET',data={})=>h.api('courseWorkspace',{role:'admin',path,method,data},admin);
 assert((await course('/term','POST',{term})).ok);
 const received=await course('/assignment-hours');assert(received.ok,received.error);
 assert.equal(stored.results[0].transfer_id,saved.data.result.id);
 assert.equal(received.data.id,saved.data.result.id);
 for(const [sheet] of [JSON.parse(stored.results[0].content).sheets,received.data.data.sheets]){
  assert.equal(sheet.complete,false);
  assert.equal(sheet.missingChoices,7);
  assert.equal(sheet.unassignedStudents,2);
 }
});

test('school terms and staged transfers are admin-only, isolated, and versioned',async t=>{
 const h=await harness({course:true});t.after(()=>h.close());
 const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 assert((await h.mutation('restore',{backup:backup()},admin)).ok);
 assert.equal((await h.mutation('createTerm',{term:'2027-1'},teacher)).status,401);
 assert.equal((await h.mutation('createTerm',{term:'2027-3'},admin)).status,400);
 const created=await h.mutation('createTerm',{term:'2027-1'},admin);assert(created.ok,created.error);
 assert.equal((await h.api('bootstrap')).data.term,'2026-2');
 assert.equal((await h.mutation('createTerm',{term:'2027-1'},admin)).code,'TERM_EXISTS');
 const rows=[{grade:'3',classNum:'1',number:'1',name:'가상학생하나',choices:{가상선택:'A1'}}];
 const stage=(data,cookie=admin)=>h.mutation('stageToolTransfer',{term:'2026-2',kind:'students',data},cookie);
 assert.equal((await stage(rows,teacher)).status,401);
 const first=await stage(rows);assert(first.ok,JSON.stringify(first));
 const transferRef={kind:'students',id:first.data.result.id};
 assert.equal((await h.api('toolTransfer',{kind:'students'},teacher)).status,401);
 const read=await h.api('toolTransfer',{kind:'students'},admin);
 assert.equal(read.data.id,transferRef.id);assert.equal(read.data.count,1);assert(!('data' in read.data));
 assert.equal((await h.api('previewImport',{transferRef},admin)).data.changedStudents,1);
 assert((await stage(rows)).ok);
 assert.equal((await h.mutation('commitImport',{transferRef},admin)).code,'TRANSFER_CHANGED');
 assert((await h.mutation('stageToolTransfer',{term:'2026-2',kind:'hours',data:hours},admin)).ok);
 const receive=(role,cookie,data={})=>h.api('courseWorkspace',{role,path:'/assignment-hours',method:'GET',data},cookie);
 assert.equal((await receive('admin',admin,{term:'2026-2'})).code,'term_mismatch');
 assert((await h.api('courseWorkspace',{role:'admin',path:'/term',method:'POST',data:{term:'2026-2'}},admin)).ok);
 const received=await receive('admin',admin);
 assert(received.ok,received.error);assert.equal(received.data.term,'2026-2');
 assert.equal(received.data.data.sheets[0].year,2026);assert.equal(received.data.data.sheets[0].grade,3);
 assert.equal(received.data.data.sheets[0].complete,true);
 assert(!Object.hasOwn(received.data.data.sheets[0],'missingChoices'));
 assert(!JSON.stringify(received.data).includes('전달에서 제외할 이름'));
 assert.equal((await receive('teacher',teacher)).status,403);
 assert((await h.mutation('switchTerm',{term:'2027-1'},admin)).ok);
 assert.equal((await h.api('toolTransfer',{kind:'students'},admin)).data,null);
 assert.equal((await stage(rows)).code,'TERM_CHANGED');
});

test('hours can create a future term without switching the operating term or widening student access',async t=>{
 const h=await harness({course:true});t.after(()=>h.close());
 const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const term='2027-1',operating='2026-2';
 const stage=(args={},cookie=admin)=>h.mutation('stageToolTransfer',{term,kind:'hours',data:hours,...args},cookie);
 const students={kind:'students',data:[{grade:'3',classNum:'1',number:'1',name:'가상학생하나',choices:{가상선택:'A1'}}]};
 assert.equal((await stage({},teacher)).status,401);
 assert.equal((await stage(students,teacher)).status,401);
 assert.equal((await stage(students)).status,400);
 assert.equal((await stage({term:'2027-3'})).status,400);
 assert.equal((await stage({data:{}})).status,400);
 assert.equal((await stage({viewTerm:term})).code,'TERM_CHANGED');
 assert.equal((await stage({expectedTerm:term})).code,'CONFLICT');
 assert.equal((await stage({expectedRevision:'-1'})).code,'CONFLICT');
 assert.deepEqual((await h.api('adminSettings',{},admin)).data.terms,[operating]);
 const before=(await h.api('bootstrap')).data;
 const saved=await stage();assert(saved.ok,saved.error);
 assert.equal(saved.data.result.term,term);
 assert.deepEqual((await h.api('adminSettings',{},admin)).data.terms,[term,operating]);
 const after=(await h.api('bootstrap')).data;
 assert.equal(after.term,operating);assert.equal(after.revision,before.revision);
 assert.equal((await h.api('toolTransfer',{kind:'hours'},admin)).data,null);
 const course=(path,method='GET',data={})=>h.api('courseWorkspace',{role:'admin',path,method,data},admin);
 assert.equal((await course('/assignment-hours','GET',{term})).code,'term_mismatch');
 assert((await course('/term','POST',{term})).ok);
 const received=await course('/assignment-hours');
 assert(received.ok,received.error);assert.equal(received.data.term,term);
 assert.equal(received.data.id,saved.data.result.id);
 assert.equal(received.data.data.sheets[0].year,2027);assert.equal(received.data.data.sheets[0].semester,1);
});

test('future student transfers connect only matched promoted students and preserve legacy exact matching',async t=>{
 const h=await harness();t.after(()=>h.close());
 const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const term='2027-1',sourceTerm='2026-2';
 const rows=['가상유지','가상누락','가상대응이름','가상학년','가상명부','가상명부이름'].map((name,i)=>({
  grade:'1',classNum:'1',number:String(i+1),name,choices:{가상선택:'A1'}
 }));
 const stage=(args={},cookie=admin)=>h.mutation('stageToolTransfer',{term,kind:'students',data:rows,...args},cookie);
 const summary=(cookie=admin)=>h.api('toolTransfer',{kind:'students'},cookie);
 assert.equal((await stage({},teacher)).status,401);
 assert.equal((await stage({},'')).status,401);
 assert.equal((await stage({term:'2026-1'})).status,409);
 assert.equal((await stage({term:'2027-3'})).status,400);
 assert.equal((await stage({data:[{...rows[0],grade:'3'}]})).status,400);
 assert.equal((await stage({expectedTerm:term})).code,'CONFLICT');
 assert.equal((await stage({expectedRevision:'-1'})).code,'CONFLICT');
 const before=(await h.api('bootstrap')).data;
 const saved=await stage();assert(saved.ok,saved.error);
 assert.equal(saved.data.result.sourceTerm,sourceTerm);
 assert.equal(saved.data.result.count,rows.length);
 assert.deepEqual((await h.api('adminSettings',{},admin)).data.terms,[term,sourceTerm]);
 const after=(await h.api('bootstrap')).data;
 assert.equal(after.term,sourceTerm);assert.equal(after.revision,before.revision);
 assert.equal((await summary()).data,null);
 assert.deepEqual(JSON.parse((await h.sql("SELECT content FROM tool_transfers WHERE term_id=? AND kind='students'",term)).results[0].content),{sourceTerm,students:rows});

 assert((await h.mutation('switchTerm',{term},admin)).ok);
 assert.equal((await summary(teacher)).status,401);
 assert.equal((await summary('')).status,401);
 assert.deepEqual((await summary()).data,saved.data.result);
 const promoted={grade:'2',classNum:'7',number:'11',name:rows[0].name,status:'재학',note:'가상 비고',choices:{}};
 const linked=await h.mutation('saveStudent',{student:promoted},admin);assert(linked.ok,linked.error);
 assert((await h.mutation('saveStudent',{student:{...promoted,number:'16',name:'다른 가상학생'}},admin)).ok);
 const studentMapping=[
  {oldNumber:'10101',newNumber:'20711',name:rows[0].name},
  {oldNumber:'10103',newNumber:'20713',name:'다른 가상학생'},
  {oldNumber:'10104',newNumber:'30714',name:rows[3].name},
  {oldNumber:'10105',newNumber:'20715',name:rows[4].name},
  {oldNumber:'10106',newNumber:'20716',name:rows[5].name}
 ];
 const ref={kind:'students',id:saved.data.result.id};
 const transferRef={...ref,studentMapping};
 const preview=(transferRef,cookie=admin)=>h.api('previewImport',{transferRef},cookie);
 const commit=(transferRef,cookie=admin)=>h.mutation('commitImport',{transferRef},cookie);
 for(const cookie of [teacher,'']){
  assert.equal((await preview(transferRef,cookie)).status,401);
  assert.equal((await commit(transferRef,cookie)).status,401);
 }
 assert.equal((await preview(ref)).status,400);
 assert.equal((await commit(ref)).status,400);
 const maximumRows=[...studentMapping,...Array.from({length:3000-studentMapping.length},(_,i)=>({
  oldNumber:String(11000+i),newNumber:String(21000+i),name:'가상 무관 학생'
 }))];
 assert((await preview({...ref,studentMapping:maximumRows})).ok);
 const overMaximum={...ref,studentMapping:[...maximumRows,{oldNumber:'18000',newNumber:'28000',name:'가상 초과 학생'}]};
 for(const request of [preview,commit]){
  const denied=await request(overMaximum);
  assert.equal(denied.status,400);assert.match(denied.error,/3,000행까지/);
 }
 for(const invalid of [
  [...studentMapping,{...studentMapping[0],newNumber:'20717'}],
  [...studentMapping,{...studentMapping[0],oldNumber:'10107'}],
  [{...studentMapping[0],newNumber:'2711'}],
  [{...studentMapping[0],name:''}],
  studentMapping.slice(1)
 ]){
  assert.equal((await preview({...ref,studentMapping:invalid})).status,400);
  assert.equal((await commit({...ref,studentMapping:invalid})).status,400);
 }
 const result=await preview(transferRef);assert(result.ok,result.error);
 assert.deepEqual(result.data.errors,[]);
 assert.equal(result.data.changedStudents,1);
 assert.deepEqual(result.data.inferredSections,['2학년 가상선택 A1']);
 assert.deepEqual(result.data.excludedStudents.map(row=>[row.oldNumber,row.reason]),[
  ['10102','대응 없음'],['10103','이름 불일치'],['10104','진급 학년 불일치'],['10105','명부 없음'],['10106','명부 이름 불일치']
 ]);
 const applied=await commit(transferRef);assert(applied.ok,applied.error);
 const detail=(await h.api('adminStudent',{id:linked.data.result.id},admin)).data.student;
 assert.deepEqual(detail.choices,{가상선택:'A1'});assert.equal(detail.note,promoted.note);
 assert.equal((await h.api('adminBootstrap',{},admin)).data.store.students.length,2);
 assert((await h.sql("SELECT backup_id FROM history WHERE action='commitImport'")).results[0].backup_id);
 assert.deepEqual(JSON.parse((await h.sql("SELECT content FROM tool_transfers WHERE term_id=? AND kind='students'",term)).results[0].content),{sourceTerm,students:rows});
 const manual=await h.mutation('saveStudent',{student:{...detail,choices:{가상선택:'B'}}},admin);assert(manual.ok,manual.error);
 assert.match((await preview(transferRef)).data.errors.join('\n'),/수동 배정과 충돌/);
 assert.equal((await commit(transferRef)).status,400);

 const legacyRows=[{...promoted,choices:{가상선택:'B'}},{...promoted,number:'16',name:'이름 불일치'}];
 await h.sql("UPDATE tool_transfers SET transfer_id='legacy',content=? WHERE term_id=? AND kind='students'",JSON.stringify(legacyRows),term);
 assert.equal((await preview(transferRef)).code,'TRANSFER_CHANGED');
 assert.equal((await commit(transferRef)).code,'TRANSFER_CHANGED');
 assert.equal((await summary()).data.sourceTerm,term);
 assert.equal((await summary()).data.count,2);
 const legacyRef={kind:'students',id:'legacy'};
 assert.match((await preview(legacyRef)).data.errors.join('\n'),/재학생 명부와 이름 또는 학번이 일치하지 않습니다/);
 assert.equal((await commit(legacyRef)).status,400);
 await h.sql("UPDATE tool_transfers SET content=? WHERE term_id=? AND kind='students'",JSON.stringify(legacyRows.slice(0,1)),term);
 assert((await commit(legacyRef)).ok);
});

test('Workers + actual local D1: authorization, migration, edits, term isolation, backup, concurrent writes',async t=>{
 const h=await harness();t.after(()=>h.close());const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const studentCookie=(await h.login('student')).cookie;
 const samples=[];
 await t.test('anonymous access, teacher/admin boundaries, strict Origin and cookies',async()=>{
  assert.equal((await h.api('student',{studentNumber:'30101'})).status,401);
  assert.equal((await h.api('passwordParameters',{role:'student'})).status,400);
  assert.equal((await h.mutation('changePassword',{role:'student'},admin)).status,400);
  assert.equal((await h.api('adminBootstrap')).status,401);assert.equal((await h.api('adminBootstrap',{},teacher)).status,401);
  assert.equal((await h.api('teacherBootstrap',{},teacher)).status,200);assert.equal((await h.api('saveStudent',{},teacher)).status,401);
  assert.equal((await h.api('bootstrap',{},'',{Origin:'https://evil.example'})).status,403);
  assert.equal((await h.api('bootstrap',{},'',{Origin:''})).status,403);const r=await h.api('bootstrap');assert.equal(r.headers.get('cache-control'),'no-store');assert(!JSON.stringify(r).includes('가상학생'));
 });
 await t.test('legacy JSON backup import, counts and exact timetable/roster parity',async()=>{
  const r=await h.mutation('restore',{backup:backup()},admin);assert(r.ok,JSON.stringify(r));
  for(const [table,count] of [['students',2],['sections',3],['assignments',3],['teachers',1],['lessons',35]])assert.equal((await h.sql('SELECT count(*) AS n FROM '+table)).results[0].n,count);
  const s=await h.api('student',{studentNumber:'30101'},studentCookie);assert(s.ok,JSON.stringify(s));assert.deepEqual(s.data.cells,Core.studentTimetable(Core.runtime(fixture()),fixture().students[0]).cells);assert.equal(s.data.name,'가상학생하나');assert(!JSON.stringify(s.data).includes('가상학생둘'));assert(!('id' in s.data));
  for(const cookie of [teacher,admin])assert.deepEqual((await h.api('student',{studentNumber:'30101'},cookie)).data,s.data);
  const r2=await h.api('roster',{query:{kind:'elective',sectionId:'section-one'}},teacher);assert.deepEqual(r2.data,Core.roster(Core.runtime(fixture()),{kind:'elective',sectionId:'section-one'}));
  assert.equal(s.data.cells.filter(c=>c.subject==='가상과학').length,3);assert(s.data.cells.some(c=>!c.subject));
  const exported=await h.mutation('backup',{},admin);assert.deepEqual(summarize(exported.data.result.backup),summarize(backup()));
 });
 await t.test('switching roles replaces the browser session',async()=>{
  const fresh=await h.login('admin'),student=await h.login('student','1234',fresh.cookie);
  assert.equal((await h.api('adminBootstrap',{},fresh.cookie)).status,401);
  assert.equal((await h.api('student',{studentNumber:'30101'},student.cookie)).status,200);
  assert.equal((await h.api('adminBootstrap',{},student.cookie)).status,401);
 });
 await t.test('failed login revokes this browser\'s previous authenticated session',async()=>{
  const fresh=await h.login('teacher'),p=(await h.api('passwordParameters',{role:'teacher'})).data;
  const failure=await h.api('login',{role:'teacher',password:'0'.repeat(64),credentialEpoch:p.epoch},fresh.cookie);assert.equal(failure.status,401);assert.equal((await h.api('teacherBootstrap',{},fresh.cookie)).status,401);
 });
 let edited;
 await t.test('single student update, stable ID/source, transfer exclusion, unrelated rows untouched',async()=>{
  const detail=await h.api('adminStudent',{id:'student-one'},admin),other=(await h.sql("SELECT * FROM students WHERE id='student-two'")).results[0];edited={...detail.data.student,classNum:'2',number:'7',name:'웹수정학생',status:'전출',choices:{가상과학:'A2',가상언어:'B1'}};
  const r=await h.mutation('saveStudent',{student:edited},admin);assert(r.ok,JSON.stringify(r));assert.equal(r.data.result.id,'student-one');assert.equal(r.data.result.sourceKey,'3-1-1');assert(r.data.result.manualFields.includes('choice:가상과학'));assert.deepEqual((await h.sql("SELECT * FROM students WHERE id='student-two'")).results[0],other);
  assert.equal((await h.api('student',{studentNumber:'30207'},studentCookie)).status,404);assert.equal((await h.api('roster',{query:{kind:'elective',sectionId:'section-two'}},teacher)).data.students.length,1);
  assert.equal((await h.api('classBatch',{grade:'3',classNum:'2'},teacher)).data.timetables.length,0);
 });
 await t.test('re-import protects web fields, status and assignment; teacher-only import keeps students',async()=>{
  const payload={format:'timetable-import',students:fixture().students,sections:fixture().sections,teacherRows:fixture().teacherRows};
  const p=await h.api('previewImport',{payload,preserveManual:true},admin);assert(p.ok);assert(p.data.preservedFields>=4);
  assert((await h.mutation('commitImport',{payload,preserveManual:true},admin)).ok);
  const d=(await h.api('adminStudent',{id:'student-one'},admin)).data.student;assert.equal(d.name,'웹수정학생');assert.equal(d.status,'전출');assert.equal(d.classNum,'2');assert.equal(d.choices.가상과학,'A2');
  assert((await h.mutation('commitImport',{payload:{format:'timetable-import',teacherRows:fixture().teacherRows}},admin)).ok);assert.deepEqual((await h.api('adminStudent',{id:'student-one'},admin)).data.student,d);
 });
 await t.test('classroom/short-name changes and IDs survive re-import',async()=>{
  const s=(await h.api('adminSections',{},admin)).data.sections.find(s=>s.id==='section-one');assert((await h.mutation('saveSection',{section:{...s,room:'웹교실',shortName:'웹약칭'}},admin)).ok);
  assert((await h.mutation('commitImport',{payload:{format:'timetable-import',sections:fixture().sections}},admin)).ok);
  const next=(await h.api('adminSections',{},admin)).data.sections.find(s=>s.id===s.id&&s.id==='section-one');assert.equal(next.room,'웹교실');assert.equal(next.shortName,'웹약칭');
 });
 await t.test('student creation and section changes update only related assignments',async()=>{
  const created=await h.mutation('saveStudent',{student:{grade:'2',classNum:'1',number:'1',name:'추가가상',status:'재학',note:'',choices:{}}},admin);assert(created.ok,JSON.stringify(created));const id=created.data.result.id;
  assert.equal((await h.api('student',{studentNumber:'20101'},studentCookie)).data.name,'추가가상');
  const section=(await h.api('adminSections',{},admin)).data.sections.find(s=>s.id==='section-two');
  const renamed=await h.mutation('saveSection',{section:{...section,code:'C2'}},admin);assert(renamed.ok,JSON.stringify(renamed));
  assert.equal((await h.api('adminStudent',{id:'student-two'},admin)).data.student.choices.가상과학,'C2');assert.equal((await h.api('adminStudent',{id:'student-one'},admin)).data.student.choices.가상과학,'C2');
  assert((await h.mutation('saveSection',{section:{...renamed.data.result,code:'A2'}},admin)).ok);
  // Retain the newly added student and verify status transition as well.
  const detail=(await h.api('adminStudent',{id},admin)).data.student;assert((await h.mutation('saveStudent',{student:{...detail,status:'휴학'}},admin)).ok);assert.equal((await h.api('student',{studentNumber:'20101'},studentCookie)).status,404);
 });
 await t.test('manual lesson links and time blocks feed teacher and student timetables',async()=>{
  const o={teacher:'가상교사',day:'월',period:2,sectionId:'section-two'};
  assert((await h.mutation('saveOverride',{override:o},admin)).ok);const tt=await h.api('teacher',{teacher:'가상교사'},teacher);assert.equal(tt.data.cells.find(c=>c.day==='월'&&c.period===2).roster.sectionId,'section-two');
  assert((await h.mutation('saveOverride',{override:{...o,sectionId:''}},admin)).ok);
  assert((await h.mutation('saveBlocks',{grade:'3',blocks:[{grade:'3',day:'목',period:4,block:'A'}]},admin)).ok);const links=await h.api('adminLinks',{},admin);assert.equal(links.data.blocks['목-4']['3'],'A');assert((await h.mutation('saveBlocks',{grade:'3',blocks:[]},admin)).ok);
 });
 await t.test('concurrent writes: one commit, one conflict, transactional audit',async()=>{
  const d=(await h.api('adminStudent',{id:'student-two'},admin)).data,revision=d.meta.revision;
  const results=await Promise.all(['동시하나','동시둘'].map(name=>h.api('saveStudent',{expectedTerm:d.meta.term,expectedRevision:revision,patch:true,student:{...d.student,name}},admin)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const rows=(await h.sql("SELECT after_value FROM history WHERE action='saveStudent' AND json_extract(after_value,'$.id')='student-two'")).results;assert.equal(rows.length,1);
 });
 await t.test('sections version validation and protected bootstrap reuse',async()=>{
  const r=await h.api('teacherBootstrap',{},teacher);const reused=await h.api('teacherBootstrap',{knownRevision:r.data.meta.revision,sectionsRevision:r.data.meta.sectionsRevision},teacher);assert.equal(reused.data.unchanged,true);
  const sec=await h.api('adminSections',{sectionsRevision:r.data.meta.sectionsRevision},admin);assert.equal(sec.data.unchanged,true);assert(!sec.data.sections);
 });
 await t.test('backup metadata has one row per backup, downloads and restores complete data',async()=>{
  const b=await h.mutation('backup',{},admin);assert(b.ok,JSON.stringify(b));const list=await h.api('adminHistory',{},admin);assert.equal(new Set(list.data.backups.map(b=>b.id)).size,list.data.backups.length);assert(!JSON.stringify(list.data.backups).includes('students'));
  const download=await h.api('downloadBackup',{backupId:b.data.result.id},admin);assert.deepEqual(download.data,b.data.result.backup);
  assert((await h.mutation('restore',{backupId:b.data.result.id},admin)).ok);assert.equal((await h.sql('SELECT count(*) AS n FROM students')).results[0].n,3);
 });
 await t.test('term switching rejects stale clients and leaves previous term intact',async()=>{
  const old=(await h.api('bootstrap')).data,newSettings={...old.settings,semester:1};assert((await h.mutation('saveSettings',{settings:newSettings},admin)).ok);
  assert.equal((await h.api('adminBootstrap',{},admin)).data.store.students.length,0);
  assert.equal((await h.api('adminStudent',{id:'student-one',viewTerm:old.term},admin)).code,'TERM_CHANGED');assert.equal((await h.api('teacher',{teacher:'가상교사',viewTerm:old.term},teacher)).code,'TERM_CHANGED');
  const stale=await h.api('saveStudent',{expectedTerm:old.term,expectedRevision:old.revision,student:edited},admin);assert.equal(stale.status,409);
  assert((await h.mutation('switchTerm',{term:'2026-2'},admin)).ok);assert.equal((await h.api('adminBootstrap',{},admin)).data.store.students.length,3);
 });
 await t.test('invalid backup rolls back data, backup and audit together',async()=>{
  const b=backup();b.store.students[1].id=b.store.students[0].id;const count=(await h.sql('SELECT count(*) AS n FROM backups')).results[0].n;
  assert.equal((await h.mutation('restore',{backup:b},admin)).status,400);assert.equal((await h.sql('SELECT count(*) AS n FROM backups')).results[0].n,count);
 });
 await t.test('login attempt throttling, password change revokes old sessions, setup never resets changed password',async()=>{
  const p=await h.api('passwordParameters',{role:'teacher'});let r;for(let i=0;i<11;i++)r=await h.api('login',{role:'teacher',password:'0'.repeat(64),credentialEpoch:p.data.epoch},'',{'CF-Connecting-IP':'throttled'});assert.equal(r.status,429);
  assert((await h.passwordChange('teacher','새교사4321',admin)).ok);assert.equal((await h.api('teacherBootstrap',{},teacher)).status,401);
  await h.api('passwordParameters',{role:'teacher'});const fresh=await h.login('teacher','새교사4321');assert.equal((await h.api('teacherBootstrap',{},fresh.cookie)).status,200);
  await h.api('logout',{},fresh.cookie);assert.equal((await h.api('teacherBootstrap',{},fresh.cookie)).status,401);
  assert((await h.passwordChange('admin','새관리자4321',admin)).ok);assert.equal((await h.api('adminBootstrap',{},admin)).status,401);assert((await h.login('admin','새관리자4321')).cookie);
 });
 const fresh=await h.login('admin','새관리자4321');for(const action of ['bootstrap','adminBootstrap','adminStudent']){const r=await h.api(action,{id:'student-two'},fresh.cookie);samples.push({action,ms:r.elapsed,bytes:r.bytes,rowsRead:r.headers.get('x-d1-rows-read'),rowsWritten:r.headers.get('x-d1-rows-written')});}
 await mkdir('test-results',{recursive:true});await writeFile('test-results/api-metrics.json',JSON.stringify(samples,null,2));
});

test('admin student deletion is term-scoped, guarded, audited, and preserves studyroom identity',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());
 const {admin,teacher,api:study,revision:studyRevision}=await setupStudyroom(h);
 const id='student-one',term='2026-2',otherTerm='2026-1',personId='synthetic-linked-person';
 await h.sql('INSERT INTO student_people(id,created_at) VALUES(?,?)',personId,'2026-01-01T00:00:00Z');
 assert((await study('linkStudent',{studentId:id,personId,expectedRevision:await studyRevision()})).ok);
 assert((await study('setMember',{personId,enabled:true,expectedRevision:await studyRevision()})).ok);
 const attendance=await study('submit',{studentNumber:'30101',seat:'07',requestId:crypto.randomUUID()},'');
 assert(attendance.ok,JSON.stringify(attendance));

 const otherBackup=backup();otherBackup.store.term=otherTerm;otherBackup.store.settings.semester=1;
 assert((await h.mutation('saveSettings',{settings:otherBackup.store.settings},admin.cookie)).ok);
 assert((await h.mutation('restore',{backup:otherBackup},admin.cookie)).ok);
 assert((await h.mutation('switchTerm',{term},admin.cookie)).ok);

 const rows=async (query,...args)=>(await h.sql(query,...args)).results;
 const roster=()=>Promise.all([
  rows('SELECT * FROM students WHERE term_id!=? OR id!=? ORDER BY term_id,id',term,id),
  rows('SELECT * FROM assignments WHERE term_id!=? OR student_id!=? ORDER BY term_id,student_id,subject',term,id)
 ]);
 const studyroom=()=>Promise.all(['student_person_links','student_people','sr_members','sr_attendance','sr_events'].map(table=>rows('SELECT * FROM '+table+' ORDER BY rowid')));
 const [otherRows,studyroomBefore]=await Promise.all([roster(),studyroom()]);
 assert(otherRows.every(table=>table.some(row=>row.term_id===otherTerm&&(row.id===id||row.student_id===id))));
 assert(studyroomBefore.every(table=>table.length>0));
 assert(studyroomBefore[3].some(row=>row.id===attendance.data.recordId&&row.person_id===personId));
 const {student,meta}=(await h.api('adminStudent',{id},admin.cookie)).data;
 const payload={id,expectedTerm:term,expectedRevision:meta.revision,patch:true};
 const backupCount=await rows('SELECT count(*) AS n FROM backups');
 assert.equal((await h.api('deleteStudent',payload,teacher.cookie)).status,401);
 assert.equal((await h.api('deleteStudent',payload)).status,401);
 assert.equal((await h.api('deleteStudent',{...payload,id:'missing'},admin.cookie)).status,404);
 assert.equal((await h.api('deleteStudent',{...payload,expectedRevision:String(Number(meta.revision)-1)},admin.cookie)).status,409);
 assert.equal((await h.api('deleteStudent',{...payload,expectedTerm:otherTerm},admin.cookie)).status,409);
 assert.deepEqual((await h.api('adminStudent',{id},admin.cookie)).data.student,student);
 assert.deepEqual(await rows("SELECT id FROM history WHERE action='deleteStudent'"),[]);

 const result=await h.api('deleteStudent',payload,admin.cookie);
 assert(result.ok,JSON.stringify(result));
 assert.equal(result.data.meta.revision,String(Number(meta.revision)+1));
 const studentsRevision=Number(meta.revisions.students.split(':')[1]);
 assert.equal(result.data.meta.revisions.students,term+':'+(studentsRevision+1));
 for(const part of ['sections','schedule'])assert.equal(result.data.meta.revisions[part],meta.revisions[part]);
 assert.equal((await h.api('adminStudent',{id},admin.cookie)).status,404);
 assert.deepEqual(await rows('SELECT * FROM students WHERE term_id=? AND id=?',term,id),[]);
 assert.deepEqual(await rows('SELECT * FROM assignments WHERE term_id=? AND student_id=?',term,id),[]);
 assert.deepEqual(await roster(),otherRows);
 const history=await rows("SELECT term_id,target,before_value,after_value,backup_id FROM history WHERE action='deleteStudent'");
 assert.deepEqual(history,[{term_id:term,target:'30101 가상학생하나',before_value:JSON.stringify(student),after_value:'null',backup_id:null}]);
 assert.deepEqual(await rows('SELECT count(*) AS n FROM backups'),backupCount);
 assert.deepEqual(await studyroom(),studyroomBefore);

 // Restoring the roster inserts the same (term_id, id), including non-default links.
 assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
 assert.equal((await h.api('adminStudent',{id},admin.cookie)).status,200);
 assert.deepEqual(await rows('SELECT person_id FROM student_person_links WHERE term_id=? AND student_id=?',term,id),[{person_id:personId}]);
 assert.deepEqual(await studyroom(),studyroomBefore);
});

test('allocation distinguishes a missing schema from an empty migrated workspace',async t=>{
 const old=await harness({migrateThrough:'0011'});t.after(()=>old.close());
 const empty=await harness();t.after(()=>empty.close());
 const request=async h=>h.api('courseWorkspace',{role:'admin',path:'/workspace',method:'GET',data:{}},(await h.login()).cookie);
 const missing=await request(old),unavailable=await request(empty);
 assert.equal(missing.status,503);
 assert.equal(missing.code,'allocation_schema_required');
 assert.match(missing.error,/마이그레이션/);
 assert.equal(unavailable.status,503);
 assert.equal(unavailable.code,'allocation_unavailable');
 assert.equal((await empty.api('courseAllocationMigration',{op:'status'},(await empty.login()).cookie)).status,404);
});
test('allocation D1 write guard rejects an expired or revoked platform session',async t=>{
 const h=await harness({course:true});t.after(()=>h.close());
 const {cookie}=await h.login();
 const tokenHash=(await h.sql("SELECT token_hash FROM sessions WHERE role='admin'")).results[0].token_hash;
 const guard=()=>h.sql('INSERT INTO ca_write_guards(id,token_hash,checked_at) VALUES (?,?,?)','test-session-guard',tokenHash,Date.now());
 await guard();
 await h.sql("DELETE FROM ca_write_guards WHERE id='test-session-guard'");
 await h.sql('UPDATE sessions SET expires_at=1 WHERE token_hash=?',tokenHash);
 await assert.rejects(guard,/auth_required/);
 await h.sql('UPDATE sessions SET expires_at=? WHERE token_hash=?',Date.now()+60000,tokenHash);
 assert((await h.api('logout',{},cookie)).ok);
 await assert.rejects(guard,/auth_required/);
 assert.equal((await h.sql('SELECT count(*) n FROM ca_write_guards')).results[0].n,0);
});

test('allocation reports the missing source-freeze column as a schema error',async t=>{
 const h=await harness({migration:true,migrateThrough:'0014'});t.after(()=>h.close());
 const {cookie}=await h.login();
 // Supply the newer guard table so the status query fails specifically on m.source_freeze.
 await h.sql('CREATE TABLE ca_import_thaw(id INTEGER PRIMARY KEY, token TEXT)');
 for(const [action,data] of [
  ['courseWorkspace',{role:'admin',path:'/workspace',method:'GET',data:{}}],
  ['courseAllocationMigration',{version:'rehearsal-cutover',op:'status'}]
 ]){
  const response=await h.api(action,data,cookie);
  assert.equal(response.status,503);
  assert.equal(response.code,'allocation_schema_required');
  assert.match(response.error,/마이그레이션/);
  assert.doesNotMatch(response.error,/source_freeze/);
 }
});
test('allocation normalizes raw freeze errors to a 503 without the generation',async t=>{
 const h=await harness({course:true});t.after(()=>h.close());
 const {cookie}=await h.login();
 const workspace={role:'admin',path:'/workspace',method:'GET',data:{}};
 const {data}=await h.api('courseWorkspace',workspace,cookie);
 const part=structuredClone(data.parts[0]);part.department.note='가상 동결 확인';
 const generation='a'.repeat(32);
 await h.sql("CREATE TRIGGER test_freeze_error BEFORE INSERT ON ca_write_guards BEGIN SELECT RAISE(ABORT,'ca_source_frozen:"+generation+"'); END;");
 const response=await h.api('courseWorkspace',{role:'admin',path:'/sheets/d1',method:'PUT',data:{
  part,globalRevision:data.globalRevision,revision:data.revisions.d1,operationId:'test-freeze-display'
 }},cookie);
 assert.equal(response.status,503);
 assert.equal(response.code,'allocation_source_unfrozen');
 assert.equal(response.error,'시수배당 원본 동결을 확인하세요.');
 assert(!JSON.stringify(response).includes(generation));
});
