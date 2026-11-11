import test from 'node:test';import assert from 'node:assert/strict';import {harness} from './harness.mjs';import {backup,fixture,allocationFixture} from './fixture.mjs';
import {validateSchedule} from '../src/class-swap.js';
import {performanceFixture} from './performance-fixture.mjs';

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
