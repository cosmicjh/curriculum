import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
import {importScaleFixture} from './import-scale.fixture.mjs';
import {prepareImport} from '../src/domain.js';
import Core from '../src/core.js';
const empty=()=>({term:'2026-2',settings:Core.defaultSettings(),students:[],sections:[],teacherRows:[],overrides:[],blocks:[]});
test('student source/natural keys stay consistent as imported numbers change',()=>{
 const store=empty(),base={grade:'3',classNum:'1',name:'합성학생',status:'재학',note:'',choices:{},manualFields:[]};
 store.students=[{...base,id:'first',number:'2',sourceKey:'3-1-1'},{...base,id:'second',number:'3',sourceKey:'3-1-2'}];
 const payload={format:'timetable-import',students:[{...base,number:'1'},{...base,number:'2'}]};
 const p=prepareImport(store,payload);assert.deepEqual(p.store.students.map(s=>[s.id,s.number]),[['first','1'],['second','2']]);assert.equal(p.summary.addedStudents,0);assert.equal(p.summary.changedStudents,2);assert.deepEqual(store.students.map(s=>s.number),['2','3']);
 assert.throws(()=>prepareImport(store,{...payload,students:[payload.students[1]]}),/학번 연결이 모호/);
 assert.throws(()=>prepareImport(empty(),{...payload,students:[payload.students[0],payload.students[0]]}),/중복/);
});
test('school-sized registration is atomic, restores exact choices and protects subsequent web edits',async t=>{
 const h=await harness();t.after(()=>h.close());const {cookie}=await h.login(),payload=importScaleFixture();
 const preview=await h.api('previewImport',{payload,preserveManual:true},cookie);assert(preview.ok);assert.equal(preview.data.students,593);assert.equal(preview.data.sections,198);assert.equal(preview.data.teachers,64);assert.deepEqual(preview.data.errors,[]);
 const saved=await h.mutation('commitImport',{payload,preserveManual:true,expectedRevision:preview.data.revision},cookie);assert(saved.ok,JSON.stringify({status:saved.status,error:saved.error}));
 assert.equal((await h.sql('SELECT count(*) AS n FROM students')).results[0].n,593);assert.equal((await h.sql('SELECT count(*) AS n FROM sections')).results[0].n,198);assert.equal((await h.sql('SELECT count(*) AS n FROM teachers')).results[0].n,64);assert.equal((await h.sql('SELECT count(*) AS n FROM backups')).results[0].n,1);
 const first=(await h.sql('SELECT id FROM students ORDER BY grade,CAST(class_num AS INTEGER),CAST(number AS INTEGER) LIMIT 1')).results[0];const detail=(await h.api('adminStudent',{id:first.id},cookie)).data.student;
 assert.deepEqual(detail.choices,payload.students[0].choices);
 const subject=Object.keys(detail.choices)[0],updated={...detail,name:'합성웹수정',status:'전출',choices:{...detail.choices,[subject]:'A2'}};assert((await h.mutation('saveStudent',{student:updated},cookie)).ok);
 const again=await h.mutation('commitImport',{payload,preserveManual:true},cookie);assert(again.ok);const preserved=(await h.api('adminStudent',{id:first.id},cookie)).data.student;assert.equal(preserved.name,updated.name);assert.equal(preserved.status,'전출');assert.equal(preserved.choices[subject],'A2');assert(again.data.result.preservedFields>=1);
 const before=(await h.api('bootstrap')).data,invalid=structuredClone(payload);invalid.students.push(invalid.students[0]);assert.equal((await h.mutation('commitImport',{payload:invalid},cookie)).ok,false);assert.equal((await h.api('bootstrap')).data.revision,before.revision);assert.equal((await h.sql('SELECT count(*) AS n FROM backups')).results[0].n,2);assert.equal((await h.api('adminStudent',{id:first.id},cookie)).data.student.name,updated.name);
});
