import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {harness} from './harness.mjs';
import {sharedBackup,sharedStore,synthetic,rawPlan,ids} from './class-swap-fixture.mjs';
import {datasetFromStore,migratePlans,teacherId} from '../src/class-swap-data.js';
import {C} from '../vendor/class-swap/src/shared/core.js';
import Core from '../src/core.js';
import {importStatement,freezeSql,pauseSql,parseWranglerJSON} from '../scripts/migrate-class-swap.mjs';
import legacyRedirect from '../src/legacy-class-swap.js';

test('vendored rules retain their locked upstream hashes',async()=>{const manifest=JSON.parse(await readFile('vendor/class-swap/manifest.json'));for(const [file,hash]of Object.entries(manifest.files))assert.equal(createHash('sha256').update(await readFile('vendor/class-swap/'+file)).digest('hex'),hash,file);});
test('migration output parsing and old address redirect have no independent data entry',async()=>{
 assert.deepEqual(parseWranglerJSON('├ Checking upload\n[{"success":true,"results":[]}]'),[{success:true,results:[]}]);
 const moved=legacyRedirect.fetch(new Request('https://old.test/'));assert.equal(moved.status,302);assert.equal(moved.headers.get('Location'),'https://cosmicjh.github.io/timetable/#/teacher');assert.equal(legacyRedirect.fetch(new Request('https://old.test/api',{method:'POST'})).status,410);
});

test('shared data preserves elective, duty, consecutive-class protection and stable teacher IDs',()=>{
 const store=sharedStore(),dataset=datasetFromStore(store);assert.equal(dataset.teachers[0].id,ids.a);assert.equal(dataset.teachers.length,Core.parseTeacherMatrix(store.teacherRows).teachers.length);
 assert.equal(teacherId('가교사'.normalize('NFD')),ids.a);
 const reordered={...store,teacherRows:[...store.teacherRows.slice(0,2),...store.teacherRows.slice(4,6),...store.teacherRows.slice(2,4),...store.teacherRows.slice(6)]};assert.equal(datasetFromStore(reordered).teachers.find(t=>t.name==='가교사').id,ids.a);
 store.teacherRows[2][3]='→';const next=datasetFromStore(store),first=next.lessons.find(l=>l.teacherId===ids.a&&l.day===0&&l.period===1),second=next.lessons.find(l=>l.teacherId===ids.a&&l.day===0&&l.period===2);
 assert.equal(second.subject,first.subject);assert.equal(C.kind(next,first),'block');assert.equal(C.kind(next,second),'block');assert.equal(Core.teacherTimetable(Core.runtime(store),'가교사').cells.find(c=>c.day==='월'&&c.period===2).subject,first.subject);
 store.teacherRows[2][4]='운영 제외 수업';store.teacherRows[3][4]='1-1';store.settings.periods.월=2;
 assert.equal(Core.teacherTimetable(Core.runtime(store),'가교사').cells.find(c=>c.day==='월'&&c.period===3).subject,'');assert.equal(datasetFromStore(store).lessons.some(l=>l.day===0&&l.period===3),false);
});

test('one admin source feeds both tools, protects active plans, and isolates terms',async t=>{
 const h=await harness();t.after(()=>h.close());const admin=await h.login(),teacher=await h.login('teacher');assert((await h.mutation('restore',{backup:sharedBackup()},admin.cookie)).ok);
 const swap=(action,payload={},cookie=teacher.cookie,extra={})=>h.api('classSwap',{swapAction:action,swapPayload:payload,...extra},cookie);
 const count=async table=>(await h.sql('SELECT count(*) n FROM '+table)).results[0].n;
 assert.equal((await swap('resume',{},'')).status,401);const initial=await swap('resume');assert.equal(initial.status,200);assert.equal(initial.data.dataset.teachers.length,3);
 assert.deepEqual(initial.data.dataset.teachers.map(t=>t.name).sort(),(await h.api('teacherBootstrap',{},teacher.cookie)).data.teachers.sort());
 const sessions=await count('sessions');for(const cookie of [teacher.cookie,admin.cookie])for(const action of ['login','replaceData','restoreBackup','setPassword','exportBackup'])assert.equal((await swap(action,{},cookie)).status,403);assert.equal(await count('sessions'),sessions);
 const payload={dataRev:initial.data.dataRev,plan:rawPlan()},saved=await swap('savePlan',payload);assert(saved.ok,JSON.stringify(saved));assert.equal(await count('swap_reservations'),4);assert((await swap('savePlan',payload)).ok);assert.equal(await count('swap_plans'),1);
 assert.equal((await swap('savePlan',{...payload,plan:rawPlan('second0123456789')})).status,409);
 const conflicting=sharedStore();conflicting.teacherRows[2][2]='수정 과목';const rejected=await h.mutation('commitImport',{payload:{format:'timetable-import',teacherRows:conflicting.teacherRows}},admin.cookie);assert.equal(rejected.ok,false);assert.match(rejected.error,/계획서|충돌/);assert.equal((await swap('resume')).data.dataRev,initial.data.dataRev);
 const cancelled=await swap('cancelPlan',{id:saved.data.plan.id,version:1});assert(cancelled.ok);assert.equal(await count('swap_reservations'),0);
 assert((await h.mutation('commitImport',{payload:{format:'timetable-import',teacherRows:conflicting.teacherRows}},admin.cookie)).ok);
 const changed=(await swap('resume')).data,main=(await h.api('teacher',{teacher:'가교사'},teacher.cookie)).data;assert.notEqual(changed.dataRev,initial.data.dataRev);assert.equal(changed.dataset.lessons.find(l=>l.teacherId===ids.a&&l.day===0&&l.period===1).subject,main.cells.find(c=>c.day==='월'&&c.period===1).subject);
 assert.equal((await swap('savePlan',payload)).status,409);
 const section=(await h.mutation('saveSection',{section:{grade:'1',subject:'공통 수정',code:'X1',shortName:'공통',room:'수정 교실'}},admin.cookie)).data.result;
 assert((await h.mutation('saveOverride',{override:{teacher:'가교사',day:'월',period:1,sectionId:section.id}},admin.cookie)).ok);
 const linked=(await swap('resume')).data.dataset.lessons.find(l=>l.teacherId===ids.a&&l.day===0&&l.period===1);assert.equal(linked.subject,'공통 수정');assert.equal(linked.room,'수정 교실');
 const settings={...sharedStore().settings,academicYear:2027,semester:1};assert((await h.mutation('saveSettings',{settings},admin.cookie)).ok);assert.equal((await swap('resume',{},teacher.cookie,{viewTerm:'2026-2'})).code,'TERM_CHANGED');assert.equal((await swap('resume')).data.hasDataset,false);assert.deepEqual((await swap('resume')).data.plans,[]);
 const fresh=sharedBackup();fresh.store.term='2027-1';fresh.store.settings=settings;assert((await h.mutation('restore',{backup:fresh},admin.cookie)).ok);const term=(await swap('resume')).data;
 assert.equal((await swap('savePlan',{dataRev:term.dataRev,plan:rawPlan()})).status,409);assert.equal(await count('swap_plans'),1);
 assert((await h.mutation('switchTerm',{term:'2026-2'},admin.cookie)).ok);assert.equal((await swap('resume')).data.plans[0].status,'cancelled');
 await h.api('logout',{},teacher.cookie);assert.equal((await swap('resume')).status,401);
});

test('schedule editing and plan creation cannot commit over each other',async t=>{
 const h=await harness();t.after(()=>h.close());const admin=await h.login(),teacher=await h.login('teacher');assert((await h.mutation('restore',{backup:sharedBackup()},admin.cookie)).ok);
 const snapshot=(await h.api('classSwap',{swapAction:'resume',swapPayload:{}},teacher.cookie)).data,meta=(await h.api('bootstrap')).data,store=sharedStore();store.teacherRows[2][2]='다른 수업';
 const [plan,edit]=await Promise.all([
  h.api('classSwap',{swapAction:'savePlan',swapPayload:{dataRev:snapshot.dataRev,plan:rawPlan()}},teacher.cookie),
  h.api('commitImport',{expectedTerm:meta.term,expectedRevision:meta.revision,payload:{format:'timetable-import',teacherRows:store.teacherRows}},admin.cookie)
 ]);
 assert.equal([plan,edit].filter(r=>r.ok).length,1,JSON.stringify([plan,edit]));
 const after=(await h.api('classSwap',{swapAction:'resume',swapPayload:{}},teacher.cookie)).data;
 if(after.plans.length)C.validateExisting(after.dataset,after.plans);
});

test('the cutover pause blocks admin writes without changing source data',async t=>{
 const h=await harness();t.after(()=>h.close());const admin=await h.login();await h.sql(pauseSql);
 const before=(await h.api('bootstrap')).data.revision,blocked=await h.mutation('saveSettings',{settings:sharedStore().settings},admin.cookie);assert.equal(blocked.status,503);assert.equal(blocked.code,'MIGRATING');assert.equal((await h.api('bootstrap')).data.revision,before);
 await h.sql('DROP TRIGGER shared_migration_pause');assert((await h.mutation('saveSettings',{settings:sharedStore().settings},admin.cookie)).ok);
});

test('legacy plans migrate atomically with their snapshots, reservations and identity preserved',async t=>{
 const h=await harness();t.after(()=>h.close());const admin=await h.login();assert((await h.mutation('restore',{backup:sharedBackup()},admin.cookie)).ok);
 const legacy=synthetic(),raw={...rawPlan(),teacherA:'a',items:rawPlan().items.map(i=>({...i,teacherB:'b'}))},clean=C.validatePlan(legacy,[],raw),plan={...clean,id:raw.id,version:1,status:'active',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const migrated=migratePlans(datasetFromStore(sharedStore()),legacy,[plan]);assert.equal(migrated[0].id,plan.id);assert.equal(migrated[0].teacherA,ids.a);assert.equal(migrated[0].items[0].teacherB,ids.b);assert.equal(migrated[0].items[0].subjectA,plan.items[0].subjectA);
 migrated[0].reason="교사의 '이관' 검증";
 const revision=(await h.api('bootstrap')).data.revision,insert=plans=>h.sql(importStatement({term:'2026-2',revision:Number(revision)},'checksum',plans));
 await assert.rejects(insert([...migrated,{...migrated[0],id:'p_duplicate_0123456789'}]));assert.equal((await h.sql('SELECT count(*) n FROM swap_plans')).results[0].n,0);assert.equal((await h.api('bootstrap')).data.revision,revision);
 await insert(migrated);assert.equal((await h.sql('SELECT count(*) n FROM swap_reservations')).results[0].n,4);assert.equal((await h.sql('SELECT content FROM swap_imports')).results[0].content,null);assert.deepEqual(JSON.parse((await h.sql('SELECT content FROM swap_plans')).results[0].content),migrated[0]);
 for(const statement of ['CREATE TABLE state(id INTEGER PRIMARY KEY,value TEXT)','CREATE TABLE plans(id TEXT)','CREATE TABLE reservations(id TEXT)',"INSERT INTO state(id,value) VALUES(1,'preserved')",...freezeSql.split('\n')])await h.sql(statement);
 await assert.rejects(h.sql("UPDATE state SET value='changed'"));await assert.rejects(h.sql("INSERT INTO plans(id) VALUES('blocked')"));assert.equal((await h.sql('SELECT value FROM state')).results[0].value,'preserved');
});
