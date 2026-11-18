import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import * as C from '../vendor/course-allocation/shared/domain.js';
import * as S from '../vendor/course-allocation/shared/state.js';
import {checkTimetable} from '../vendor/course-allocation/shared/timetable-checker.js';
import {exportSolverModel} from '../vendor/course-allocation/shared/timetable-model.js';
import {workbookData} from '../assets/solver/excel.js';
import '../scripts/build.mjs';

const h=await harness({course:true,staticAssets:true});let browser;
try{
  const admin=await h.login();assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
  const source={schemaVersion:1,uiVersion:3,school:{name:'가상학교',year:2026,semester:2,grades:[1,2,3].map(grade=>({grade,classCount:grade===3?1:0,movingCount:1}))},departments:[{id:'test',name:'가상교과군',status:'draft'}],teachers:[],courses:[],groups:[],assignments:[],unmapped:[],history:[],departmentRevisions:{test:7}};
  const teacher=C.addTeacher(source,'test','가상강사');
  const course=C.addCourse(source,{deptId:'test',name:'가상과목',grade:3,baseHours:31});
  const group=C.addGroup(source,course.id,'3-1','homeroom',31);C.setAssignment(source,group.slots[0].id,teacher.id,31);
  C.changeStatus(source,'test','submitted');C.changeStatus(source,'test','locked');
  await h.sql('DELETE FROM ca_sheets');
  await h.sql('UPDATE ca_workspace SET payload=? WHERE id=1',JSON.stringify(S.globalPart(source)));
  await h.sql('INSERT INTO ca_sheets(id,payload,revision) VALUES(?,?,?)','test',JSON.stringify(S.departmentPart(source,'test')),7);
  const model=exportSolverModel(source).model,base=await h.listen();
  const redirect=await fetch(base+'/solver.html',{redirect:'manual'});assert.equal(redirect.status,307);assert.equal(new URL(redirect.headers.get('location'),base).pathname,'/solver');
  for(const path of ['/solver','/solver.html','/solver/worker.js','/solver/lib/wasm/cp_sat_runtime.wasm','/solver/lib/wasm/cp_sat_runtime_asyncify.wasm']){
    const r=await fetch(base+path);assert(r.ok,path);assert.equal(r.headers.get('cross-origin-opener-policy'),'same-origin');assert.equal(r.headers.get('cross-origin-embedder-policy'),'require-corp');
  }
  for(const path of ['/','/admin','/admin.html','/teacher.html','/assets/app.js']){
    const r=await fetch(base+path);assert(r.ok);assert.equal(r.headers.get('cross-origin-opener-policy'),null);assert.equal(r.headers.get('cross-origin-embedder-policy'),null);
  }
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],requests=[],wasmRequests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);if(r.url().endsWith('.wasm'))wasmRequests.push(r.url());});
  await page.goto(base+'/solver.html');assert.equal(new URL(page.url()).pathname,'/solver');assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
  await page.locator('#login:visible').waitFor();await page.locator('#password').fill('1234');await page.locator('#login button').click();
  await page.locator('#run:enabled').waitFor();assert.match(await page.locator('#validation').innerText(),/점검 통과/);
  assert.match(await page.locator('#warm-summary').innerText(),/수십 분/);
  assert.equal(await page.locator('textarea').count(),0);assert.equal(await page.locator('#allocation-stats .stat').count(),10);
  assert.equal(await page.locator('#preset').inputValue(),'normal');
  await page.locator('#advanced summary').click();
  for(const [id,value] of Object.entries({limit1:'20',limit2:'0',limit3:'0',workers:'1'}))await page.locator('#'+id).fill(value);
  await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('result-status').textContent.includes('검증 통과'),{},{timeout:60000});
  await page.waitForFunction(()=>document.getElementById('storage-status').textContent.includes('저장했습니다'));
  const jsonDownload=page.waitForEvent('download');await page.locator('#json').click();const firstDownload=await jsonDownload;
  const result=JSON.parse(await readFile(await firstDownload.path(),'utf8'));
  assert.equal(result.status,'SUCCESS');assert.equal(result.stages[1].status,'OPTIMAL');assert.equal(checkTimetable(model,result,result.options).ok,true);assert.equal(result.BAN_PLACE.length,31);
  const excelDownload=page.waitForEvent('download');await page.locator('#excel').click();const excel=await excelDownload;assert.equal(excel.suggestedFilename(),'result.xlsx');
  const bytes=[...await readFile(await excel.path())];
  const workbook=await page.evaluate(bytes=>{const wb=XLSX.read(new Uint8Array(bytes),{type:'array',cellStyles:true});return {names:wb.SheetNames,data:wb.SheetNames.map(name=>({rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:''}),widths:wb.Sheets[name]['!cols'].map(c=>c.wch)}))};},bytes);
  const expected=workbookData(model,result);assert.deepEqual(workbook.names,expected.map(s=>s.name));
  for(let i=0;i<4;i++){
    const trim=rows=>{const copy=rows.map(r=>{const x=[...r];while(x.at(-1)==='')x.pop();return x;});while(!copy.at(-1)?.length)copy.pop();return copy;};
    assert.deepEqual(trim(workbook.data[i].rows),trim(expected[i].rows));
    assert.deepEqual(workbook.data[i].widths,expected[i].widths);
  }
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/browser-solver-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/browser-solver-mobile.png',fullPage:true});
  await page.reload();await page.locator('#run:enabled').waitFor();assert.equal(await page.locator('#warm-run').inputValue(),'saved');assert.match(await page.locator('#warm-summary').innerText(),/100%/);assert(await page.locator('#login').isHidden());
  assert.equal(await page.locator('#limit1').inputValue(),'20');assert.equal(await page.locator('#limit2').inputValue(),'0');assert.equal(await page.locator('#workers').inputValue(),'1');
  // Exercise the shipped fallback and pthread assets, even on Edge with JSPI.
  await page.route('**/solver/worker.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:'WebAssembly.promising=undefined;\n'+await response.text()});});
  await page.locator('#advanced summary').click();
  for(const [id,value] of Object.entries({limit1:'20',limit2:'0',limit3:'0',workers:'2'}))await page.locator('#'+id).fill(value);
  await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('result-status').textContent.includes('검증 통과'),{},{timeout:60000});
  const againDownload=page.waitForEvent('download');await page.locator('#json').click();const again=JSON.parse(await readFile(await(await againDownload).path(),'utf8'));assert.equal(again.warmStart.matchRate,1);assert.equal(again.stages[0].reason,'previous_result');
  assert(wasmRequests.some(url=>url.endsWith('cp_sat_runtime_asyncify.wasm')));
  await page.locator('#warm-clear').click();await page.locator('#warm-file').setInputFiles({name:'result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(result))});await page.waitForFunction(()=>document.getElementById('warm-summary').textContent.includes('100%'));
  await page.locator('#run').click();await page.locator('#cancel').click();assert.match(await page.locator('#progress').innerText(),/취소/);assert(await page.locator('#run').isEnabled());await page.waitForTimeout(1000);assert.match(await page.locator('#progress').innerText(),/취소/);
  await h.sql("UPDATE ca_sheets SET payload=json_set(payload,'$.department.status','draft') WHERE id='test'");await page.locator('#reload').click();await page.waitForFunction(()=>document.getElementById('validation').textContent.includes('오류'));assert(await page.locator('#run').isDisabled());
  for(const role of ['teacher','student']){
    const session=await h.login(role),context=await browser.newContext();
    await context.addCookies(session.cookie.split('; ').filter(Boolean).map(value=>{const i=value.indexOf('=');return {name:value.slice(0,i),value:value.slice(i+1),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'};}));
    const other=await context.newPage();await other.goto(base+'/solver.html');await other.locator('#login:visible').waitFor();assert(await other.locator('#workspace').isHidden());assert(await other.locator('#run').isDisabled());await context.close();
  }
  assert(requests.every(p=>['adminBootstrap','courseWorkspace','passwordParameters','login'].includes(p.split('/').pop())));assert.deepEqual(errors,[]);
  console.log('PASS browser solver: real Miniflare asset headers, isolation, admin cookie login, read, WASM solve/check, four Excel sheets, IndexedDB reload/warm solve, upload, cancellation, validation and non-admin denial');
}finally{await browser?.close();await h.close();}
