import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {backup,fixture,allocationFixture as boardFixture} from './fixture.mjs';
import {performanceFixture} from './performance-fixture.mjs';
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
test('allocation counts match elective rosters and include assignments linked by a save',async t=>{
 const h=await harness();t.after(()=>h.close());
 const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const source=backup(),[active,inactive]=source.store.students;
 active.choices.가상미술='A3';
 inactive.status='전출';
 inactive.choices.가상과학='A1';
 inactive.choices.가상미술='A3';
 source.store.students.push({...active,id:'student-other-grade',sourceKey:'2-1-1',grade:'2',choices:{가상미술:'A3'}});
 const restored=await h.mutation('restore',{backup:source},admin);
 assert(restored.ok,JSON.stringify(restored));
 const unlinked=await h.sql('SELECT section_id FROM assignments WHERE term_id=? AND student_id=? AND subject=?',source.store.term,active.id,'가상미술');
 assert.equal(unlinked.results[0].section_id,null);

 assert.equal((await h.api('allocation')).status,401);
 for(const cookie of [teacher,admin]){
  const reply=await h.api('allocation',{},cookie);
  assert(reply.ok,JSON.stringify(reply));
  for(const [sectionId,count] of [['section-one',1],['section-two',0]]){
   const roster=await h.api('roster',{query:{kind:'elective',sectionId}},cookie);
   assert(roster.ok,JSON.stringify(roster));
   assert.equal(reply.data.counts[sectionId],count);
   assert.equal(roster.data.students.length,count);
  }
 }

 const board=boardFixture();
 board.rooms.push({id:'r3',label:'가상 미술실',classNum:''});
 board.grades[0].blocks[0].cells.r3={subject:'가상미술',code:'A3',teachers:[]};
 const saved=await h.mutation('saveAllocation',{board,compact:true},admin);
 assert(saved.ok,JSON.stringify(saved));
 const {sectionId}=saved.data.allocation.board.grades[0].blocks[0].cells.r3;
 const roster=await h.api('roster',{query:{kind:'elective',sectionId}},teacher);
 assert(roster.ok,JSON.stringify(roster));
 assert.equal(roster.data.students.length,1);
 assert.deepEqual(saved.data.allocation.counts,{'section-one':1,'section-two':0,'section-three':1,[sectionId]:1});
 assert.deepEqual((await h.api('allocation',{},teacher)).data.counts,saved.data.allocation.counts);
});
test('allocation reports only exact active consigned counts before and after a section relink',async t=>{
 const h=await harness();t.after(()=>h.close());
 const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const source=backup(),[active]=source.store.students;
 active.note='위탁';
 active.choices.가상미술='A3';
 const notes=[' 위탁 ','\ufeff위탁\ufeff','\u3000위탁\u3000','\r\n위탁\n','위탁교육','위탁.','위 탁'];
 const variants=[...notes,'위탁'].map((note,i)=>{
  const number=String(i+3);
  return {...active,id:'student-note-'+number,sourceKey:'3-1-'+number,number,note,status:i<notes.length?'재학':'전출'};
 });
 source.store.students.push(...variants);
 assert((await h.mutation('restore',{backup:source},admin)).ok);
 // Restore normalizes notes, so seed the exact values directly in the fixture DB.
 for(const {id,note} of variants)await h.sql('UPDATE students SET note=? WHERE term_id=? AND id=?',note,source.store.term,id);
 const board=boardFixture();
 board.rooms.push({id:'r3',label:'가상 미술실',classNum:''});
 board.grades[0].blocks[0].cells.r3={subject:'가상미술',code:'A3',teachers:[]};
 assert.equal((await h.api('allocation')).status,401);
 assert.equal((await h.api('saveAllocation',{board})).status,401);
 for(const cookie of [teacher,admin]){
  const read=await h.api('allocation',{},cookie);
  const roster=await h.api('roster',{query:{kind:'elective',sectionId:'section-one'}},cookie);
  assert(read.ok&&roster.ok);
  assert.deepEqual(roster.data.students.map(s=>s.note),['위탁',...notes]);
  assert.equal(read.data.counts['section-one'],roster.data.students.length);
  assert.equal(read.data.consignedCounts['section-one'],5);
  assert.equal(read.data.consignedCounts['section-two'],0);
  assert(!JSON.stringify(read.data).includes('위탁교육'));
  assert(!JSON.stringify(read.data).includes(active.name));
 }
 const saved=await h.mutation('saveAllocation',{board,compact:true},admin);
 assert(saved.ok,JSON.stringify(saved.error));
 const {allocation}=saved.data,{sectionId}=allocation.board.grades[0].blocks[0].cells.r3;
 const roster=await h.api('roster',{query:{kind:'elective',sectionId}},teacher);
 assert(roster.ok,JSON.stringify(roster.error));
 assert.equal(allocation.counts[sectionId],8);
 assert.equal(allocation.consignedCounts[sectionId],5);
 assert.equal(roster.data.students.filter(s=>s.note.trim()==='위탁').length,allocation.consignedCounts[sectionId]);
 assert(!JSON.stringify(allocation).includes('위탁교육'));
 assert(!JSON.stringify(allocation).includes(active.name));
 const read=await h.api('allocation',{},teacher);
 assert(read.ok,JSON.stringify(read.error));
 assert.deepEqual(read.data.consignedCounts,allocation.consignedCounts);
});
test('allocation reads stay below 9,000 D1 rows for a school-sized roster',async t=>{
 const h=await harness();t.after(()=>h.close());
 const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');
 const {store,board}=performanceFixture();
 store.students[0].status='전출';
 assert((await h.mutation('restore',{backup:{format:'school-timetable-backup',schemaVersion:1,store}},admin)).ok);
 assert((await h.mutation('saveAllocation',{board,compact:true},admin)).ok);
 const response=await h.api('allocation',{},teacher);
 assert(response.ok,JSON.stringify(response.error));
 const rows=Number(response.headers.get('x-d1-rows-read'));
 assert(rows>0&&rows<9000,'allocation read '+rows+' D1 rows');
 const sectionId='section-1-0-2',query={kind:'elective',sectionId};
 const roster=await h.api('roster',{query,includeRevision:true},teacher);
 assert(roster.ok,JSON.stringify(roster.error));
 assert.equal(roster.data.revision,response.data.meta.revision);
 assert.equal(roster.data.students.length,29);
 assert.equal(response.data.counts[sectionId],roster.data.students.length);
});
test('one allocation save updates teacher, student and class-swap, protects writes and survives backup/term changes',async t=>{
 const h=await harness();t.after(()=>h.close());const {cookie:admin}=await h.login(),{cookie:teacher}=await h.login('teacher');assert((await h.mutation('restore',{backup:backup()},admin)).ok);
 assert.equal((await h.api('allocation')).status,401);assert.equal((await h.api('saveAllocation',{board:boardFixture()},teacher)).status,401);
 const prior=(await h.api('bootstrap')).data,reply=await h.mutation('saveAllocation',{board:boardFixture(),compact:true},admin);assert(reply.ok,JSON.stringify(reply));assert(reply.data.allocation);assert(!reply.data.bootstrap);assert.equal((await h.api('allocation',{},teacher)).data.board.grades[0].blocks[0].cells.r1.sectionId,'section-one');
 const studentCookie=(await h.login('student')).cookie;
 const student=(await h.api('student',{studentNumber:'30101'},studentCookie)).data.cells.find(c=>c.day==='월'&&c.period===2),tt=(await h.api('teacher',{teacher:'가상교사'},teacher)).data.cells.find(c=>c.day==='월'&&c.period===2);assert.equal(student.room,'새 과학실');assert.deepEqual(student.teachers,['가상교사']);assert.equal(tt.room,student.room);
 const swap=await h.api('classSwap',{swapAction:'load',swapPayload:{}},teacher);assert(swap.ok,JSON.stringify(swap));assert(swap.data.dataset.lessons.some(l=>l.room==='새 과학실'));
 const stale=await h.api('saveAllocation',{board:boardFixture(),expectedTerm:prior.term,expectedRevision:prior.revision},admin);assert.equal(stale.status,409);
 const b=(await h.mutation('backup',{},admin)).data.result.backup;assert(b.store.allocation);const invalid=structuredClone(b);invalid.store.allocation.grades[0].blocks[0].cells.r1.sectionId='missing';assert.equal((await h.mutation('restore',{backup:invalid},admin)).ok,false);
 const imported=await h.mutation('commitImport',{payload:{format:'timetable-import',sections:[{grade:'3',subject:'가상과학',code:'A1',room:'엑셀 이전값',shortName:'가상과학'}]},preserveManual:false},admin);assert(imported.ok,JSON.stringify(imported));assert.equal((await h.api('adminSections',{},admin)).data.sections.find(s=>s.id==='section-one').room,'새 과학실');
 assert.equal((await h.mutation('saveSection',{section:{...b.store.sections.find(s=>s.id==='section-one'),room:'우회실'}},admin)).ok,false);
 assert((await h.mutation('saveSettings',{settings:{...fixture().settings,academicYear:2027,semester:1}},admin)).ok);assert.equal((await h.api('allocation',{},teacher)).data.board,null);
 assert((await h.mutation('switchTerm',{term:'2026-2'},admin)).ok);assert((await h.mutation('restore',{backup:b},admin)).ok);assert.deepEqual((await h.api('allocation',{},teacher)).data.board,b.store.allocation);
 const empty=boardFixture();empty.grades[0].blocks[0].cells={};assert((await h.mutation('saveAllocation',{board:empty},admin)).ok);assert.equal((await h.api('adminSections',{},admin)).data.sections.find(s=>s.id==='section-one').room,'');assert.equal((await h.sql('SELECT count(*) AS n FROM assignments')).results[0].n,3);
});
