import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {backup,fixture,allocationFixture as boardFixture} from './fixture.mjs';
import {prepareAllocation} from '../src/allocations.js';

test('allocation validates its source and keeps section identities and choices',()=>{
 const store=fixture(),board=boardFixture(),p=prepareAllocation(store,board);assert.equal(p.store.sections[0].id,store.sections[0].id);assert.equal(p.store.sections[0].room,'새 과학실');assert.equal(p.store.sections[1].room,'3-2');assert.deepEqual(p.store.students,store.students);assert.equal(store.sections[0].room,'과학실');
 const duplicate=boardFixture();duplicate.grades[0].blocks[0].cells.r2={...duplicate.grades[0].blocks[0].cells.r1};assert.throws(()=>prepareAllocation(store,duplicate),/같은 분반/);
 const slot=boardFixture();slot.grades[0].blocks[0].slots.push({day:'월',period:2});assert.throws(()=>prepareAllocation(store,slot),/교시/);
 const fixed=boardFixture();fixed.grades[0].blocks[0].slots=[{day:'월',period:1}];assert.throws(()=>prepareAllocation(store,fixed),/교시/);
 const teacher=boardFixture();teacher.grades[0].blocks[0].cells.r1.teachers=['가상교사','가상교사'];assert.throws(()=>prepareAllocation(store,teacher),/교사명/);
});
test('printed Excel parser preserves split sections, teams, homerooms and rejects unreadable cells',async()=>{
 const ctx=vm.createContext({});vm.runInContext(await readFile('assets/allocation-import.js','utf8'),ctx);
 const board=JSON.parse(JSON.stringify(ctx.TTAllocationImport.fromMatrix([['.','교시','','','1반','음악실'],['3학년','','','','담임',''],['A','화2','수2','금3','과학 A_1\n(가교사, 나교사)','음악 A2\n(다교사)']])));
 assert.equal(board.rooms.length,2);assert.equal(board.grades[0].homerooms['room-0'],'담임');assert.deepEqual(board.grades[0].blocks[0].cells['room-0'],{subject:'과학',code:'A_1',teachers:['가교사','나교사']});assert.equal(board.grades[0].blocks[0].slots.length,3);
 assert.throws(()=>ctx.TTAllocationImport.fromMatrix([['.','교시','1반'],['3학년'],['A','화2','형식 오류']]),/형식/);
});
test('one allocation save updates teacher, student and class-swap, protects writes and survives backup/term changes',async t=>{
 const h=await harness();t.after(()=>h.close());const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');assert((await h.mutation('restore',{backup:backup()},admin)).ok);
 assert.equal((await h.api('allocation')).status,401);assert.equal((await h.api('saveAllocation',{board:boardFixture()},teacher)).status,401);
 const prior=(await h.api('bootstrap')).data,reply=await h.mutation('saveAllocation',{board:boardFixture()},admin);assert(reply.ok,JSON.stringify(reply));assert(reply.data.bootstrap);assert.equal((await h.api('allocation',{},teacher)).data.board.grades[0].blocks[0].cells.r1.sectionId,'section-one');
 const student=(await h.api('student',{studentNumber:'30101'})).data.cells.find(c=>c.day==='월'&&c.period===2),tt=(await h.api('teacher',{teacher:'가상교사'},teacher)).data.cells.find(c=>c.day==='월'&&c.period===2);assert.equal(student.room,'새 과학실');assert.deepEqual(student.teachers,['가상교사']);assert.equal(tt.room,student.room);
 const swap=await h.api('classSwap',{swapAction:'load',swapPayload:{}},teacher);assert(swap.ok,JSON.stringify(swap));assert(swap.data.dataset.lessons.some(l=>l.room==='새 과학실'));
 const stale=await h.api('saveAllocation',{board:boardFixture(),expectedTerm:prior.term,expectedRevision:prior.revision},admin);assert.equal(stale.status,409);
 const b=(await h.mutation('backup',{},admin)).data.result.backup;assert(b.store.allocation);const invalid=structuredClone(b);invalid.store.allocation.grades[0].blocks[0].cells.r1.sectionId='missing';assert.equal((await h.mutation('restore',{backup:invalid},admin)).ok,false);
 const imported=await h.mutation('commitImport',{payload:{format:'timetable-import',sections:[{grade:'3',subject:'가상과학',code:'A1',room:'엑셀 이전값',shortName:'가상과학'}]},preserveManual:false},admin);assert(imported.ok,JSON.stringify(imported));assert.equal((await h.api('adminSections',{},admin)).data.sections.find(s=>s.id==='section-one').room,'새 과학실');
 assert.equal((await h.mutation('saveSection',{section:{...b.store.sections.find(s=>s.id==='section-one'),room:'우회실'}},admin)).ok,false);
 assert((await h.mutation('saveSettings',{settings:{...fixture().settings,academicYear:2027,semester:1}},admin)).ok);assert.equal((await h.api('allocation',{},teacher)).data.board,null);
 assert((await h.mutation('switchTerm',{term:'2026-2'},admin)).ok);assert((await h.mutation('restore',{backup:b},admin)).ok);assert.deepEqual((await h.api('allocation',{},teacher)).data.board,b.store.allocation);
 const empty=boardFixture();empty.grades[0].blocks[0].cells={};assert((await h.mutation('saveAllocation',{board:empty},admin)).ok);assert.equal((await h.api('adminSections',{},admin)).data.sections.find(s=>s.id==='section-one').room,'');assert.equal((await h.sql('SELECT count(*) AS n FROM assignments')).results[0].n,3);
});
