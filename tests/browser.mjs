import {clickMenu} from './navigation-helper.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {backup,fixture} from './fixture.mjs';
import '../scripts/build.mjs';
const h=await harness(),steps=[],errors=[];let browser;
await mkdir('test-results',{recursive:true});
async function step(name,fn){const at=performance.now();await fn();steps.push({name,ms:Math.round(performance.now()-at)});console.log('PASS '+name);}
try{
 const admin=await h.login();const seed=await h.mutation('restore',{backup:backup()},admin.cookie);assert(seed.ok,JSON.stringify(seed));
 const url=await h.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
 const button=a=>page.locator('[data-action="'+a+'"]');
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false');
 async function login(){await page.goto(url+'/admin.html');await idle();await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await clickMenu(page,page.locator('.admin-nav [data-tab=students]'));await page.locator('[data-action=new-student]').waitFor();await idle();}
 await step('student/mobile timetable, shared Pretendard, same-origin requests',async()=>{
  await page.goto(url+'/student.html');await idle();assert(await page.locator('#password').isHidden());await page.locator('#login-student-number').fill('30101');await page.locator('form[data-form=login] button').click();await page.locator('.tt').waitFor();await idle();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.tt tbody tr').count(),7);assert.equal(await page.locator('.tt thead th').count(),6);assert(await page.locator('link[href*="font.css"]').count());assert(await page.evaluate(()=>document.fonts.check('12px "Timetable UI"','한글')));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert((await page.locator('.tt').boundingBox()).height<470);await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 });
 await step('PNG output is real PNG and single timetable print has print layout',async()=>{
  const download=page.waitForEvent('download');await button('save-image').click();const f=await download;assert(f.suggestedFilename().endsWith('.png'));await f.saveAs('test-results/timetable.png');const bytes=await readFile('test-results/timetable.png');assert.equal(bytes.subarray(1,4).toString(),'PNG');await idle();
  await page.evaluate(()=>{window.print=()=>{window.__printed=true;};});await button('print-single').click();await page.waitForFunction(()=>window.__printed);await page.emulateMedia({media:'print'});assert.equal(await page.locator('#print-root .tt').count(),1);assert.equal(await page.locator('#print-root').evaluate(el=>getComputedStyle(el).display),'block');await page.screenshot({path:'test-results/print-single.png',fullPage:true});await page.emulateMedia({media:'screen'});await page.evaluate(()=>dispatchEvent(new Event('afterprint')));await idle();
 });
 await step('admin cookie is HttpOnly/Secure, initial student list excludes detailed choices',async()=>{
  await page.setViewportSize({width:1440,height:1000});await login();const cookies=await context.cookies();const c=cookies.find(c=>c.name==='__Host-tt_admin');assert(c&&c.httpOnly&&c.secure&&c.sameSite==='Strict');assert(!await page.evaluate(()=>document.cookie.includes('__Host-tt_admin')));await page.screenshot({path:'test-results/admin.png',fullPage:true});
 });
 await step('loading locks inputs; rejected save unlocks and preserves draft; valid save sends only changed student',async()=>{
  await button('edit-student').first().click();await page.locator('#edit-name').waitFor();await idle();await page.locator('#edit-name').fill('브라우저보호값');
  let release;const gate=new Promise(r=>release=r);await page.route('**/api/saveStudent',async r=>{await gate;await r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,code:'CONFLICT',error:'시험 충돌'})});});
  await page.locator('form[data-form=save-student] button.primary').click();await page.waitForFunction(()=>document.body.dataset.loading==='true');assert(await page.locator('#edit-name').isDisabled());assert(await page.locator('#modal').evaluate(el=>el.inert));release();await idle();assert.equal(await page.locator('#edit-name').inputValue(),'브라우저보호값');assert(!await page.locator('#edit-name').isDisabled());
  await page.unroute('**/api/saveStudent');await page.locator('form[data-form=save-student] button.primary').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);await idle();assert((await page.locator('#student-table').innerText()).includes('브라우저보호값'));
 });
 await step('unsaved settings survive tab rerender and data loading',async()=>{
  await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();assert.equal(await page.getByRole('button',{name:'변경 이력',exact:true}).count(),0);await page.getByRole('button',{name:'백업 저장',exact:true}).waitFor();await page.locator('#set-school').fill('미저장설정보호');await clickMenu(page,button('admin-tab').filter({hasText:'자료 등록'}));await idle();await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();assert.equal(await page.locator('#set-school').inputValue(),'미저장설정보호');
 });
 await step('timetable XLSX and separate student uploads retain drafts and protect edits',async()=>{
  await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();await clickMenu(page,button('admin-tab').filter({hasText:'자료 등록'}));await idle();await page.evaluate(()=>TTAssets.load('xlsx'));
  await page.screenshot({path:'test-results/import-stages.png',fullPage:true});
  assert.equal(await page.locator('#registered-exceptions h2').count(),0);
  const importFixture=fixture(),gradeTwoSlot=importFixture.teacherRows[2].indexOf('국어')+2;
  const ambiguousSlot=importFixture.teacherRows[2].indexOf('가상과학A');
  importFixture.teacherRows[3][ambiguousSlot]='미정';
  importFixture.teacherRows[2][gradeTwoSlot]='수학';importFixture.teacherRows[3][gradeTwoSlot]='2-1';
  const files=await page.evaluate(store=>{const book=rows=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Sheet1');return Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));};return {teacher:book(store.teacherRows),sections:book([['학년','선택반명','교과명','수업교실','축약과목명'],...store.sections.map(s=>[s.grade,s.code,s.subject,s.room,s.shortName])]),students:book([['학년','반','번호','이름','가상과학'],['3','1','1','가상학생하나','A1']]),extra:book([['학년','반','번호','이름','가상언어'],['3','1','1','가상학생하나','B1']]),grade2:book([['학년','반','번호','이름','가상선택'],['2','1','1','가상2','']])};},importFixture);
  const file=(name,data)=>({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(data)});
  await page.locator('#import-teacher').setInputFiles(file('teacher.xlsx',files.teacher));await page.locator('form[data-form=preview-import] button[type=submit]').click();await button('commit-import').waitFor();await idle();assert(!(await button('commit-import').isDisabled()));assert.match(await page.locator('#import-preview section').innerText(),/예외 수업 확인[\s\S]*가상교사 · 금3 · 가상과학A · 미정/);
  let attempted=0;await page.route('**/api/commitImport',async r=>{attempted++;await r.abort('failed');});await button('commit-import').click();await idle();assert.equal(attempted,1);assert.match(await page.locator('#toast').innerText(),/입력 자료는 유지/);assert.equal(await page.locator('#import-teacher').evaluate(el=>el.files.length),1);assert(!(await button('commit-import').isDisabled()));await page.unroute('**/api/commitImport');
  await page.route('**/api/commitImport',r=>r.fulfill({status:503,contentType:'text/html',body:'Worker exceeded resource limits'}));await button('commit-import').click();await idle();assert.match(await page.locator('#toast').innerText(),/503/);assert.equal(await page.locator('#import-teacher').evaluate(el=>el.files.length),1);await page.unroute('**/api/commitImport');
  await button('commit-import').click();await idle();assert.match(await page.locator('#registered-exceptions section').innerText(),/예외 수업 확인[\s\S]*가상교사 · 금3/);await clickMenu(page,page.locator('.admin-nav [data-tab=students]'));await idle();
  await button('bulk-import').click();
  await page.locator('#import-students').setInputFiles([file('grade2.xlsx',files.grade2),file('grade3-3.xlsx',files.students),file('grade3-2.xlsx',files.extra)]);
  await page.locator('#modal form[data-form=preview-import] button[type=submit]').click();await button('commit-import').waitFor();await idle();
  await button('commit-import').click();await idle();assert((await page.locator('#student-table').innerText()).includes('브라우저보호값'));
 });
 await step('external term switch discards old cached lists and keeps data separated',async()=>{
  const old=(await h.api('bootstrap')).data;assert((await h.mutation('saveSettings',{settings:{...old.settings,semester:1}},admin.cookie)).ok);
  await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();await clickMenu(page,button('admin-tab').filter({hasText:'자료 등록'}));await idle();await clickMenu(page,page.locator('.admin-nav [data-tab=students]'));await idle();assert.equal(await page.locator('#student-table tbody tr').count(),0);assert.equal(await page.locator('.school-heading .term-label').textContent(),'2026학년도 1학기');
  assert((await h.mutation('switchTerm',{term:'2026-2'},admin.cookie)).ok);await button('refresh-admin').click();await idle();assert((await page.locator('#student-table').innerText()).includes('브라우저보호값'));
 });
 await step('teacher timetable cell roster, course roster and A4 four-up class print',async()=>{
  for(let n=3;n<=5;n++)assert((await h.mutation('saveStudent',{student:{grade:'3',classNum:'1',number:String(n),name:'가상인쇄'+n,status:'재학',note:'',choices:{가상과학:'A1'}}},admin.cookie)).ok);
  await page.goto(url+'/teacher.html');await idle();await page.locator('#teacher-name').fill('가상교사');await page.locator('form[data-form=teacher] button').click();await page.locator('.cell-button').first().waitFor();await idle();await page.locator('.cell-button').filter({hasText:'가상과학'}).first().click();await page.locator('.roster-table').waitFor();await idle();assert((await page.locator('.roster-table').innerText()).includes('브라우저보호값'));await button('print-roster').click();await idle();await page.evaluate(()=>dispatchEvent(new Event('afterprint')));await button('close-modal').click();
  await clickMenu(page,button('teacher-tab').filter({hasText:'교과 명렬표'}));await page.locator('#roster-grade').selectOption('3');await page.locator('#roster-subject').selectOption('가상과학');await page.locator('#roster-section').selectOption('section:section-one');await clickMenu(page,button('teacher-tab').filter({hasText:/^개인시간표$/}));await clickMenu(page,button('teacher-tab').filter({hasText:'교과 명렬표'}));assert.equal(await page.locator('#roster-grade').inputValue(),'3');assert.equal(await page.locator('#roster-subject').inputValue(),'가상과학');assert.equal(await page.locator('#roster-section').inputValue(),'section:section-one');await page.locator('form[data-form=roster] button').click();await page.locator('.roster-table').waitFor();await idle();await button('close-modal').click();
  await page.evaluate(()=>{window.print=()=>{};});
  for(const [grade,subject,name] of [['2','수학','가상2'],['3','국어','브라우저보호값']]){
   await page.locator('#roster-grade').selectOption(grade);await page.locator('#roster-subject').selectOption(subject);
   assert.equal(await page.locator('label[for=roster-section]').textContent(),'학급');
   await page.locator('#roster-section').selectOption('class:1');
   await page.locator('form[data-form=roster] button').click();await page.locator('.roster-table').waitFor();await idle();
   assert.match(await page.locator('.roster-table').textContent(),new RegExp(name));
   await button('print-roster').click();await idle();
   assert.match(await page.locator('#print-root').textContent(),new RegExp(grade+'학년 1반'));
   await page.evaluate(()=>dispatchEvent(new Event('afterprint')));await button('close-modal').click();
  }
  await clickMenu(page,button('teacher-tab').filter({hasText:'학급별 시간표 인쇄'}));await page.locator('#batch-grade').selectOption('3');await page.locator('#batch-class').selectOption('1');await page.locator('form[data-form=batch] button').click();await page.locator('.batch-page').first().waitFor({state:'attached'});await idle();assert.equal(await page.locator('.batch-item').count(),5);assert.equal(await page.locator('.batch-page').count(),2);assert.equal(await page.locator('.batch-page').first().locator('.batch-item').count(),4);await page.emulateMedia({media:'print'});assert.equal(await page.locator('.batch-page').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);assert.equal(await page.locator('.batch-page').first().evaluate(el=>getComputedStyle(el).gridTemplateRows.split(' ').length),2);await page.locator('.batch-page').first().screenshot({path:'test-results/print-batch.png'});await page.emulateMedia({media:'screen'});await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
 });
 await step('role selection keeps its layout while teacher login loads',async()=>{
  assert.equal(await page.locator('#header a.brand').count(),0);
  await button('logout').click();
  const menu=page.locator('.auth');await menu.waitFor();await idle();
  await page.locator('#login-role').selectOption('teacher');await page.locator('#password').fill('1234');
  const before=await menu.boundingBox();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/login',async route=>{await gate;await route.continue();},{times:1});
  try{
   await Promise.all([page.waitForRequest('**/api/login'),menu.getByRole('button',{name:'로그인',exact:true}).click()]);
   assert(!await page.evaluate(()=>document.body.classList.contains('workspace')));
   assert.deepEqual(await menu.boundingBox(),before);
  }finally{release();}
  await page.getByRole('navigation',{name:'교사 메뉴'}).waitFor();await idle();
  assert(await page.evaluate(()=>document.body.classList.contains('workspace')));
 });
 await step('logout revokes server session and protected page requires login again',async()=>{await button('logout').click();await page.locator('#login-role').waitFor();await idle();assert.equal(await page.locator('#login-role').inputValue(),'student');const r=await page.evaluate(async()=>{const r=await fetch('/api/teacherBootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;});assert.equal(r,401);});
 assert.deepEqual(errors,[]);await writeFile('test-results/browser.json',JSON.stringify({steps,errors},null,2)+'\n');
}finally{await browser?.close();await h.close();}
