import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as C from '../shared/domain.js';
import * as S from '../shared/state.js';
import * as H from '../shared/hours-import.js';
import * as P from '../shared/print.js';
import * as Reset from '../shared/reset.js';
import {demoState,hoursFixture} from './fixtures/demo.js';

test('timetable transfer exports confirmed moving sections with semester and teacher hours',()=>{
  const state=demoState();
  assert.throws(()=>C.timetableTransfer(state),/확정/);
  state.departments[0].status='locked';
  assert.deepEqual(C.timetableTransfer(state),{format:'school-course-allocation-transfer',schemaVersion:1,term:'2026-1',sections:[{grade:'2',subject:'가상국어 과목',code:'A',weeklyHours:3,teachers:[{name:'가상교사1',hours:3}]}]});
});

test('approved shared and workbook stylesheets match the normalized baseline',async()=>{
  const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace(/\r\n/g,'\n'),baseline=JSON.parse(await readFile(new URL('./fixtures/ui-baseline.json',import.meta.url),'utf8'));
  const css=(await readFile('assets/ui.css','utf8'))+(await readFile(new URL('../app/workbook.css',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(css.replace(/\r\n/g,'\n')).digest('hex'),baseline.cssSha256);
  assert.doesNotMatch(html,/script\.google|postMessage|gasTransport|pagesBridge/);
});
test('backup roundtrip and per-department partition preserve identifiers and metadata',()=>{
  const state=demoState();state.groups[0].slots[0].importRef={sheetId:'virtual',sectionId:'virtual'};
  const copy=C.assertState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(copy,state);assert.equal(S.departmentPart(copy,'d1').groups[0].slots[0].importRef.sheetId,'virtual');
  assert.equal(C.metrics(copy,'d1').planned,3);assert.equal(C.teacherHours(copy,'teacher-d1'),3);
});
test('over-allocation and cross-department references are rejected',()=>{
  const state=demoState();assert.throws(()=>C.setAssignment(state,'section-d1','teacher-d1',4));
  assert.throws(()=>C.setAssignment(state,'section-d1','teacher-d2',1));
  state.assignments.push({sectionId:'section-d1',teacherId:'teacher-d2',hours:1});assert.throws(()=>C.assertState(state));
});
test('split sections conserve legacy hours and resolve to actual sections',()=>{
  const state=demoState();C.rebuildGroup(state,'group-d1',2,3);
  const group=state.groups[0];assert.equal(C.teacherHours(state,'teacher-d1'),3);assert.equal(group.legacy.length,1);
  C.resolvePool(state,group.id,[{teacherId:'teacher-d1',sectionId:group.slots[0].id,hours:1},{teacherId:'teacher-d1',sectionId:group.slots[1].id,hours:2}]);
  C.assertState(state);assert.equal(group.legacy.length,0);assert.equal(C.teacherHours(state,'teacher-d1'),3);
});
test('submission validation, locking and reopening preserve data',()=>{
  const state=demoState();assert.equal(C.validate(state,'d1').length,0);C.changeStatus(state,'d1','submitted');
  assert.throws(()=>C.setTeacherName(state,'teacher-d1','가상변경'));C.changeStatus(state,'d1','locked');C.changeStatus(state,'d1','draft');C.setTeacherName(state,'teacher-d1','가상변경');
});
test('course-hours JSON import validates student exclusion and preserves other department',()=>{
  const state=demoState(),raw=hoursFixture(),data=H.parse(raw),options=H.defaults(data,state);
  options.sheets[0].courses[0].deptName='가상국어';const result=H.plan(data,state,options);
  assert.equal(result.sectionCount,1);assert.equal(result.total,3);assert.deepEqual(S.departmentPart(result.state,'d2'),S.departmentPart(state,'d2'));
  raw.includesStudentData=true;assert.throws(()=>H.parse(raw));
});
test('course-hours accepts optional incomplete counts and requires both validation flags',()=>{
  const file=hoursFixture(),validation=file.sheets[0].validation;
  let [sheet]=H.parse(file).sheets;
  assert.equal(sheet.complete,true);
  for(const key of ['missingChoices','unassignedStudents'])assert(!Object.hasOwn(sheet,key));
  validation.complete=false;
  assert.equal(H.parse(file).sheets[0].complete,false);
  Object.assign(validation,{missingChoices:3,unassignedStudents:0});
  [sheet]=H.parse(file).sheets;
  assert.equal(sheet.missingChoices,3);
  assert.equal(sheet.unassignedStudents,0);
  for(const key of ['hardConstraintsPassed','coupledCohortsPassed','complete']){
    const original=validation[key];
    validation[key]=key==='complete'?'false':false;
    assert.throws(()=>H.parse(file),/배정 제약과 2\+1 결합 검증/);
    validation[key]=original;
  }
  for(const key of ['missingChoices','unassignedStudents']){
    const original=validation[key];
    validation[key]=Number.MAX_SAFE_INTEGER;
    assert.equal(H.parse(file).sheets[0][key],Number.MAX_SAFE_INTEGER);
    for(const value of [-1,1.5,'3',null,Number.MAX_SAFE_INTEGER+1,1e100]){
      validation[key]=value;
      assert.throws(()=>H.parse(file),/미배정/);
    }
    validation[key]=original;
  }
});
test('reset, CSV escaping and blank/current SVG print remain available',()=>{
  const state=demoState();state.teachers[0].name='=가상수식';assert.match(C.csv(state,'d1'),/'=가상수식/);
  assert.match(P.blankFormSvg(state,'d1'),/<svg/);assert.match(P.currentFormSvg(state,'d1',true),/가상수식/);
  const reset=Reset.apply(state,'hours','d1');assert.equal(C.teacherHours(reset.state,'teacher-d1'),0);assert.equal(C.teacherHours(reset.state,'teacher-d2'),3);
});

test('section import proposes the single valid existing weekly-hours value',()=>{
  const state=demoState(),file=hoursFixture();
  file.sheets[0].courses[0].courseName=state.courses[0].name;
  state.courses[0].baseHours=4;
  const data=H.parse(file);
  assert.equal(data.sheets[0].courses[0].hours,3);
  assert.equal(H.defaults(data,state).sheets[0].courses[0].hours,4);
});

test('section import without a grade uses the file hours',()=>{
  const state=demoState(),file=hoursFixture();
  file.sheets[0].grade=null;
  file.sheets[0].courses[0].courseName=state.courses[0].name;
  state.courses[0].baseHours=4;
  assert.equal(H.defaults(H.parse(file),state).sheets[0].courses[0].hours,3);
});
