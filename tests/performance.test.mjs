import test from 'node:test';import assert from 'node:assert/strict';import {harness} from './harness.mjs';import {backup,fixture,allocationFixture} from './fixture.mjs';
import {validateSchedule} from '../src/class-swap.js';
import {performanceFixture} from './performance-fixture.mjs';
import {setupStudyroom} from './studyroom-fixture.mjs';

test('full allocation snapshots read assignments once and preserve the entire pre-save store',async t=>{
 const h=await harness();t.after(()=>h.close());const admin=await h.login(),{store,board}=performanceFixture();
 assert((await h.mutation('restore',{backup:{format:'school-timetable-backup',schemaVersion:1,store}},admin.cookie)).ok);
 assert((await h.mutation('saveAllocation',{board,compact:true},admin.cookie)).ok);
 const before=await h.mutation('backup',{},admin.cookie);assert(before.ok);
 board.grades[0].homerooms.r0='가상담임수정';
 const saved=await h.mutation('saveAllocation',{board,compact:true},admin.cookie);assert(saved.ok,JSON.stringify(saved.error));
 assert(Number(saved.headers.get('x-d1-rows-read'))<9000,'full backup avoids re-reading 900 student rows through the assignment join');
 const backups=(await h.api('adminHistory',{},admin.cookie)).data.backups;
 const snapshot=await h.api('downloadBackup',{backupId:backups[0].id},admin.cookie);assert(snapshot.ok);
 assert.deepEqual(snapshot.data.store,before.data.result.backup.store);
 assert.equal(snapshot.data.store.students.length,900);
 assert.equal(snapshot.data.store.students.reduce((n,s)=>n+Object.keys(s.choices).length,0),7200);
});

test('one-person studyroom history does not scan other students attendance',async t=>{
 const h=await harness({studyroom:true});t.after(()=>h.close());const {api,teacher}=await setupStudyroom(h);
 const schedule=(await h.sql('SELECT id FROM sr_schedules LIMIT 1')).results[0].id;
 await h.sql("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<201) INSERT INTO sr_sessions(id,date,label,academic_year,schedule_id,starts_at,ends_at) SELECT 'history-'||i,'2026-10-01','아침',2026,?,'2026-10-01T00:00:00Z','2026-10-01T10:00:00Z' FROM n",schedule);
 await h.sql("INSERT INTO sr_attendance(id,session_id,person_id,term_id,student_id,student_number,name,seat,state,first_at,last_at,version,note) SELECT se.id||s.id,se.id,l.person_id,s.term_id,s.id,'3010'||s.number,s.name,'0'||s.number,'active',se.starts_at,se.starts_at,1,'' FROM sr_sessions se CROSS JOIN students s JOIN student_person_links l ON l.term_id=s.term_id AND l.student_id=s.id WHERE s.id='student-two' OR se.id IN ('history-1','history-2')");
 const person=(await h.sql("SELECT person_id FROM student_person_links WHERE student_id='student-one'")).results[0].person_id;
 const args={from:'2026-10-01',to:'2026-10-01',personId:person,sessionLabel:'오전'};
 for(const scope of [{},{recordsOnly:true},{calendarOnly:true}]){
  const result=await api('query',{...args,...scope},teacher.cookie);assert(result.ok);
  assert(Number(result.headers.get('x-d1-rows-read'))<50,'existing person index bounds all three query variants');
  if(result.data.rows){assert.equal(result.data.rows.length,2);assert(result.data.rows.every(r=>r.person_id===person));assert.equal(result.data.next,null);}
  if(result.data.calendar)assert.deepEqual(result.data.calendar,[{date:'2026-10-01',records:2,students:1}]);
  if(result.data.totals)assert.deepEqual(result.data.totals,{records:2,days:1,students:1});
 }
});

test('class timetable lookup reads the selected class instead of every student assignment',async t=>{
 const h=await harness();t.after(()=>h.close());const {cookie}=await h.login(),{store}=performanceFixture();
 assert((await h.mutation('restore',{backup:{format:'school-timetable-backup',schemaVersion:1,store}},cookie)).ok);
 const args={grade:'3',classNum:'1'};assert((await h.api('classBatch',args,cookie)).ok);
 const batch=await h.api('classBatch',args,cookie);
 assert(batch.ok);assert.equal(batch.data.timetables.length,30);
 assert(batch.data.timetables.every(s=>s.grade==='3'&&s.classNum==='1'));
 assert(Number(batch.headers.get('x-d1-rows-read'))<1000,'selected-class reads stay bounded with 7,200 assignments');
 const detail=await h.api('adminStudent',{id:'student-3-1-1'},cookie);assert.equal(Object.keys(detail.data.student.choices).length,8);
});

test('schedule writes only rebuild the conflict dataset when active future plans need validation',async()=>{
 const store={term:'2026-2',get settings(){throw Error('dataset rebuilt');}},db={all:async()=>[]};
 await validateSchedule(db,store);
 db.all=async()=>[{content:JSON.stringify({status:'cancelled',items:[{dateA:'2099-01-01'}]})},{content:JSON.stringify({status:'active',items:[{dateA:'2000-01-01'}]})}];
 await validateSchedule(db,store);
 db.all=async()=>[{content:JSON.stringify({status:'active',items:[{dateA:'2099-01-01'}]})}];
 await assert.rejects(validateSchedule(db,store),/dataset rebuilt/);
});
test('versioned schedule cache stays fresh, isolates students and never bypasses authentication',async t=>{
 const h=await harness();t.after(()=>h.close());const admin=await h.login(),teacher=await h.login('teacher');assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
 const cold=await h.api('teacher',{teacher:'가상교사'},teacher.cookie),warm=await h.api('teacher',{teacher:'가상교사'},teacher.cookie);assert(cold.ok&&warm.ok);assert.deepEqual(warm.data,cold.data);assert(Number(warm.headers.get('x-d1-rows-read'))<Number(cold.headers.get('x-d1-rows-read')));
 const studentCookie=(await h.login('student')).cookie;
 const students=await Promise.all(['30101','30102'].map(studentNumber=>h.api('student',{studentNumber},studentCookie)));assert.deepEqual(students.map(r=>r.data.name),['가상학생하나','가상학생둘']);assert.notDeepEqual(students[0].data.cells,students[1].data.cells);
 const old=(await h.api('adminStudent',{id:'student-one'},admin.cookie)).data.student;assert((await h.mutation('saveStudent',{student:{...old,classNum:'4'}},admin.cookie)).ok);assert((await h.api('teacherBootstrap',{},teacher.cookie)).data.meta.classes['3'].includes('4'));
 const section=fixture().sections[0];assert((await h.mutation('saveSection',{section:{...section,room:'캐시 갱신실'}},admin.cookie)).ok);assert((await h.api('teacher',{teacher:'가상교사'},teacher.cookie)).data.cells.some(c=>c.room==='캐시 갱신실'));
 const legacy=await h.mutation('saveAllocation',{board:allocationFixture()},admin.cookie);assert(legacy.ok);assert(legacy.data.bootstrap,'already-open clients retain their original save response');assert((await h.api('teacher',{teacher:'가상교사'},teacher.cookie)).data.cells.some(c=>c.room==='새 과학실'));
 assert((await h.api('classSwap',{swapAction:'load',swapPayload:{}},teacher.cookie)).data.dataset.lessons.some(l=>l.room==='새 과학실'));
 assert((await h.mutation('saveSettings',{settings:{...fixture().settings,academicYear:2027,semester:1}},admin.cookie)).ok);assert.equal((await h.api('teacherBootstrap',{},teacher.cookie)).data.teachers.length,0);assert((await h.mutation('switchTerm',{term:'2026-2'},admin.cookie)).ok);assert((await h.api('teacher',{teacher:'가상교사'},teacher.cookie)).ok);
 assert((await h.passwordChange('teacher','5678',admin.cookie)).ok);assert.equal((await h.api('teacher',{teacher:'가상교사'},teacher.cookie)).status,401);assert.equal((await h.api('classSwap',{swapAction:'load',swapPayload:{}},teacher.cookie)).status,401);
});
test('unrelated assignments and sections are not rewritten; snapshots and new-section rosters stay complete',async t=>{
 const h=await harness();t.after(()=>h.close());const a=await h.login();assert((await h.mutation('restore',{backup:backup()},a.cookie)).ok);
 const old=(await h.api('adminStudent',{id:'student-one'},a.cookie)).data.student;
 for(const event of ['INSERT','UPDATE','DELETE'])await h.sql(`CREATE TRIGGER assignments_probe_${event} BEFORE ${event} ON assignments BEGIN SELECT RAISE(ABORT,'unrelated_assignment_write'); END;`);
 const nameSave=await h.mutation('saveStudent',{student:{...old,name:'가상수정'}},a.cookie);assert(nameSave.ok,JSON.stringify(nameSave.error));assert.deepEqual((await h.api('adminStudent',{id:old.id},a.cookie)).data.student.choices,old.choices);
 for(const event of ['INSERT','UPDATE','DELETE'])await h.sql('DROP TRIGGER assignments_probe_'+event);
 assert((await h.mutation('saveAllocation',{board:allocationFixture()},a.cookie)).ok);
 for(const event of ['INSERT','UPDATE','DELETE'])await h.sql(`CREATE TRIGGER sections_probe_${event} BEFORE ${event} ON sections BEGIN SELECT RAISE(ABORT,'unrelated_section_write'); END;`);
 const board=(await h.api('allocation',{},a.cookie)).data.board;board.grades[0].homerooms.r2='가상담임수정';const saved=await h.mutation('saveAllocation',{board,compact:true},a.cookie);assert(saved.ok,JSON.stringify(saved.error));assert(saved.data.allocation);assert(!saved.data.bootstrap);
 const snap=(await h.api('adminHistory',{},a.cookie)).data.backups[0],before=(await h.api('downloadBackup',{backupId:snap.id},a.cookie)).data;assert.equal(before.store.students.length,2);assert.equal(Object.keys(before.store.students.find(s=>s.id===old.id).choices).length,2);
 for(const event of ['INSERT','UPDATE','DELETE'])await h.sql('DROP TRIGGER sections_probe_'+event);
 const student=(await h.api('adminStudent',{id:old.id},a.cookie)).data.student;assert((await h.mutation('saveStudent',{student:{...student,choices:{가상언어:'B1',가상신설:'A3'}}},a.cookie)).ok);
 board.rooms.push({id:'r3',label:'신설실',classNum:''});board.grades[0].blocks[0].cells.r3={subject:'가상신설',code:'A3',teachers:['가상교사']};const created=await h.mutation('saveAllocation',{board,compact:true},a.cookie);assert(created.ok,JSON.stringify(created.error));const section=created.data.allocation.sections.find(s=>s.subject==='가상신설');const roster=await h.api('roster',{query:{kind:'elective',sectionId:section.id}},a.cookie);assert.deepEqual(roster.data.students.map(s=>s.name),['가상수정']);
});
