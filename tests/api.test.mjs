import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {backup,fixture} from './fixture.mjs';
import Core from '../src/core.js';
import {summarize} from '../scripts/compare-backups.mjs';
test('course launch inherits the role and can transfer to an inactive term',async t=>{
 const h=await harness();t.after(()=>h.close());const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const launch=await h.api('courseLaunch',{role:'admin'},admin);
 assert(launch.ok);
 const adminToken=launch.data.token;
 assert.equal((await h.api('courseBridge',{token:adminToken})).data.role,'admin');
 assert.equal((await h.api('courseLaunch',{role:'teacher'},teacher)).code,'COURSE_CLOSED');
 assert((await h.mutation('saveSettings',{settings:{...Core.defaultSettings(),courseAllocationTeachers:true}},admin)).ok);
 const grant=async(role,cookie)=>(await h.api('courseLaunch',{role},cookie)).data.token;
 const teacherToken=await grant('teacher',teacher);
 assert.equal((await h.api('courseBridge',{token:teacherToken})).data.role,'teacher');
 assert.equal((await h.api('courseLaunch',{role:'admin'},teacher)).status,401);
 const transfer={format:'school-course-allocation-transfer',schemaVersion:1,term:'2027-1',sections:[{grade:'3',subject:'가상과학',code:'A1',weeklyHours:3,teachers:[{name:'가상교사',hours:3}]}]};
 assert.equal((await h.api('courseBridge',{token:teacherToken,transfer})).status,403);
 assert.equal((await h.api('courseBridge',{token:adminToken,transfer})).data.term,'2027-1');
 assert.equal((await h.api('bootstrap')).data.term,'2026-2');
 assert.equal((await h.api('courseTransfer',{},admin)).data,null);
 assert.equal((await h.api('courseBridge',{token:adminToken})).data.role,'admin');
 assert((await h.mutation('switchTerm',{term:'2027-1'},admin)).ok);
 assert.deepEqual((await h.api('courseTransfer',{},admin)).data.transfer,transfer);
 assert.deepEqual((await h.api('courseTransfer',{summary:'counts'},admin)).data,[{grade:'3',subject:'가상과학',count:1}]);
 assert((await h.mutation('switchTerm',{term:'2026-2'},admin)).ok);
 await h.api('logout',{},teacher);
 assert.equal((await h.api('courseBridge',{token:teacherToken})).status,401);
});
test('integrated allocation uses the existing workspace, role, and independent term',async t=>{
 const h=await harness({course:true});t.after(()=>h.close());
 for(const sql of (await readFile('tests/course-fixture.sql','utf8')).trim().split(/;\s*/).filter(Boolean))await h.courseSql(sql);
 const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const request=(cookie,role,path='/workspace',method='GET',data={})=>h.api('courseWorkspace',{role,path,method,data},cookie);
 assert.equal((await request('','admin')).status,401);
 assert.equal((await request(teacher,'admin')).status,401);
 assert.equal((await request(teacher,'teacher')).code,'COURSE_CLOSED');
 const start=await request(admin,'admin');
 assert(start.ok);assert.equal(start.data.admin,true);assert.equal(start.data.global.school.semester,1);
 assert.equal(start.data.departments.length,2);assert.equal(start.data.parts[0].teachers[0].name,'가상교사1');
 assert.equal((await request(admin,'admin','/auth/password','POST')).status,404);
 assert((await h.mutation('saveSettings',{settings:{...Core.defaultSettings(),courseAllocationTeachers:true}},admin)).ok);
 assert.equal((await request(teacher,'teacher')).data.admin,false);
 assert.equal((await request(admin,'teacher')).data.admin,false);
 assert.equal((await request(teacher,'teacher','/term','POST',{term:'2027-1'})).status,403);
 assert.equal((await request(teacher,'teacher','/timetable-transfer','POST',{term:'2026-1'})).status,403);
 const part=structuredClone(start.data.parts[0]);part.teachers[0].name='가상교사수정';
 const save={part,revision:start.data.revisions.d1,globalRevision:start.data.globalRevision,operationId:'test-'+crypto.randomUUID()};
 const saved=await request(teacher,'teacher','/sheets/d1','PUT',save);assert(saved.ok,JSON.stringify(saved));
 assert.deepEqual((await request(teacher,'teacher','/sheets/d1','PUT',save)).data,saved.data);
 assert((await request(admin,'admin','/term','POST',{term:'2027-1'})).ok);
 assert.equal((await request(admin,'admin')).data.global.school.year,2027);
 assert((await request(admin,'admin','/term','POST',{term:'2026-1'})).ok);
 assert.equal((await request(admin,'admin')).data.parts[0].teachers[0].name,'가상교사수정');
 await h.courseSql("UPDATE sheets SET payload=json_set(payload,'$.department.status','locked') WHERE id='d1'");
 const sent=await request(admin,'admin','/timetable-transfer','POST',{term:'2026-1'});
 assert.deepEqual(sent.data,{term:'2026-1',sections:1});
 assert.equal((await h.api('bootstrap')).data.term,'2026-2');
 assert((await h.mutation('switchTerm',{term:'2026-1'},admin)).ok);
 assert.equal((await h.api('courseTransfer',{},admin)).data.transfer.sections[0].teachers[0].name,'가상교사수정');
 assert.equal((await request(teacher,'teacher')).code,'COURSE_CLOSED');
 assert.equal((await request(admin,'admin')).data.admin,true);
 await h.api('logout',{},admin);
 assert.equal((await request(admin,'admin')).status,401);
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
 const hours={format:'school-course-hours',schemaVersion:1,hoursUnit:'weekly-periods',includesStudentData:false,sheets:[{
  sheetId:'grade3',sourceSheetName:'3학년',grade:3,students:['전달에서 제외할 이름'],
  validation:{complete:true,hardConstraintsPassed:true,coupledCohortsPassed:true},coupledCohorts:[],
  courses:[{courseId:'science',courseName:'가상과학',credits:3,weeklyHours:3,sectionCount:1,totalWeeklyHours:3,
   sections:[{sectionId:'science-a',sectionCode:'A',timeBlock:'A',weeklyHours:3}]}]
 }]};
 assert((await h.mutation('stageToolTransfer',{term:'2026-2',kind:'hours',data:hours},admin)).ok);
 const receive=(role,cookie,data={})=>h.api('courseWorkspace',{role,path:'/assignment-hours',method:'GET',data},cookie);
 assert.equal((await receive('admin',admin,{term:'2026-2'})).code,'term_mismatch');
 assert((await h.api('courseWorkspace',{role:'admin',path:'/term',method:'POST',data:{term:'2026-2'}},admin)).ok);
 const received=await receive('admin',admin);
 assert(received.ok,received.error);assert.equal(received.data.term,'2026-2');
 assert.equal(received.data.data.sheets[0].year,2026);assert.equal(received.data.data.sheets[0].grade,3);
 assert(!JSON.stringify(received.data).includes('전달에서 제외할 이름'));
 assert.equal((await receive('teacher',teacher)).status,403);
 assert((await h.mutation('switchTerm',{term:'2027-1'},admin)).ok);
 assert.equal((await h.api('toolTransfer',{kind:'students'},admin)).data,null);
 assert.equal((await stage(rows)).code,'TERM_CHANGED');
});

test('Workers + actual local D1: authorization, migration, edits, term isolation, backup, concurrent writes',async t=>{
 const h=await harness();t.after(()=>h.close());const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const studentCookie=(await h.login('student')).cookie;
 const samples=[];
 await t.test('anonymous access, teacher/admin boundaries, strict Origin and cookies',async()=>{
  assert.equal((await h.api('adminBootstrap')).status,401);assert.equal((await h.api('adminBootstrap',{},teacher)).status,401);
  assert.equal((await h.api('teacherBootstrap',{},teacher)).status,200);assert.equal((await h.api('saveStudent',{},teacher)).status,401);
  assert.equal((await h.api('bootstrap',{},'',{Origin:'https://evil.example'})).status,403);
  assert.equal((await h.api('bootstrap',{},'',{Origin:''})).status,403);const r=await h.api('bootstrap');assert.equal(r.headers.get('cache-control'),'no-store');assert(!JSON.stringify(r).includes('가상학생'));
 });
 await t.test('legacy JSON backup import, counts and exact timetable/roster parity',async()=>{
  const r=await h.mutation('restore',{backup:backup()},admin);assert(r.ok,JSON.stringify(r));
  for(const [table,count] of [['students',2],['sections',3],['assignments',3],['teachers',1],['lessons',35]])assert.equal((await h.sql('SELECT count(*) AS n FROM '+table)).results[0].n,count);
  const s=await h.api('student',{studentNumber:'30101'},studentCookie);assert(s.ok,JSON.stringify(s));assert.deepEqual(s.data.cells,Core.studentTimetable(Core.runtime(fixture()),fixture().students[0]).cells);assert.equal(s.data.name,'가상학생하나');assert(!JSON.stringify(s.data).includes('가상학생둘'));assert(!('id' in s.data));
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
