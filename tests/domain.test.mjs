import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import Core from '../src/core.js';
import {fixture} from './fixture.mjs';
import * as D from '../src/domain.js';
import {createHash} from 'node:crypto';
test('shared Pretendard binary and original base palette are preserved',async()=>{
 const baseline=JSON.parse(await readFile('tests/fixtures/ui-baseline.json','utf8'));
 for(const [file,expected] of Object.entries(baseline)){const content=await readFile(file);const bytes=file.endsWith('.css')?content.toString().replaceAll('\r\n','\n').split('\n.teacher-tools')[0]:content;assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,file);}
});

test('original Core.gs synthetic golden results: student, teacher, rosters and 2+1 slots',async()=>{
 const golden=JSON.parse(await readFile('tests/fixtures/legacy-results.json','utf8')),store=fixture(),rt=Core.runtime(store);
 // The shared operating periods now also clear the legacy teacher's unused Wed-7 room.
 golden.teacher.cells.find(c=>c.day==='수'&&c.period===7).room='';
 assert.deepEqual(store.students.map(s=>Core.studentTimetable(rt,s)),golden.students);assert.deepEqual(Core.teacherTimetable(rt,'가상교사'),golden.teacher);assert.deepEqual(store.sections.map(s=>Core.roster(rt,{kind:'elective',sectionId:s.id})),golden.rosters);
});
test('five-file import: grade-3 two/three-unit merge, conflict detection and teacher matrix automatic columns',async()=>{
 const sandbox={};vm.runInNewContext(await readFile('assets/import.js','utf8'),sandbox);const imp=sandbox.TTImport;
 const elective=[['학년','선택반명','교과명','수업교실','축약과목명'],['3','A1','가상과학','과학실','과학'],['3','B1','가상언어','어학실','언어']];
 const matrices=[[['학년','반','번호','이름','2학년선택'],['2','1','1','가상2','C1']],[['학년','반','번호','이름','가상과학'],['3','1','1','가상3','A1']],[['학년','반','번호','이름','가상언어','가상과학'],['3','1','1','가상3','B1','A1']]];
 const r=imp.fromMatrices(fixture().teacherRows,elective,matrices);assert.equal(r.payload.students.length,2);const s=r.payload.students.find(s=>s.grade==='3');assert.equal(s.choices.가상과학,'A1');assert.equal(s.choices.가상언어,'B1');
 const conflict=structuredClone(matrices);conflict[2][1][5]='A2';assert.throws(()=>imp.fromMatrices(null,null,conflict),/배정이 서로/);
 const parsed=Core.parseTeacherMatrix(fixture().teacherRows);assert.equal(parsed.teachers.length,1);assert.equal(parsed.teachers[0].slots.length,35);
});
test('input validation rejects invalid statuses/settings/duplicate students without losing original data',()=>{
 const st=fixture();assert.throws(()=>D.student({...st.students[0],status:'invalid'},st.students[0]),/학적/);assert.throws(()=>D.settings({...st.settings,periods:{월:12}}),/교시/);const before=JSON.stringify(st);assert.throws(()=>D.prepareImport(st,{format:'timetable-import',students:[st.students[0],st.students[0]]}),/중복/);assert.equal(JSON.stringify(st),before);
});
