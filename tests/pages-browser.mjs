import {clickMenu} from './navigation-helper.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import '../scripts/build-pages.mjs';
// Reserved test hosts only. Every browser request is fulfilled locally or aborted.
const pages='https://timetable-pages.test',api='https://timetable-api.test',h=await harness({frontendOrigin:pages,course:true});
const cookieAdmin=await h.login();assert((await h.mutation('restore',{backup:backup()},cookieAdmin.cookie)).ok);
let browser,bootstrapGate;const errors=[],requests=[],steps=[];await mkdir('test-results',{recursive:true});
async function step(name,fn){await fn();steps.push(name);console.log('PASS '+name);}
try{
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 // An unusable third-party cookie must never be needed or sent by the Pages app.
 await context.addCookies([{name:'__Host-tt_admin',value:'0'.repeat(64),domain:'timetable-api.test',path:'/',secure:true,httpOnly:true,sameSite:'None'}]);
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===pages){
   const relative=url.pathname.replace(/^\/curriculum\/?/,'')||'index.html',path=resolve('.cache/pages-site',relative);
   if(!path.startsWith(resolve('.cache/pages-site')))return route.abort();
   try{let body=await readFile(path);if(relative==='config.js'){const config=JSON.parse(body.toString().replace(/^window.TIMETABLE_CONFIG=/,'').replace(/;\s*$/,''));config.apiBase=api+'/api/';body=Buffer.from('window.TIMETABLE_CONFIG='+JSON.stringify(config)+';');}return await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream',body});}catch{return route.fulfill({status:404,body:'Not found'});}
  }
  if(url.origin===api&&url.pathname.startsWith('/api/')){
   if(url.pathname==='/api/bootstrap'&&bootstrapGate)await bootstrapGate;
   assert.equal(req.headers().cookie,undefined);requests.push({action:url.pathname.slice(5),method:req.method(),origin:req.headers().origin,authorized:Boolean(req.headers().authorization)});
   const response=await h.mf.dispatchFetch(req.url(),{method:req.method(),headers:req.headers(),...(['GET','OPTIONS'].includes(req.method())?{}:{body:req.postData()||'{}'})});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }
  return route.abort();
 });
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false');
 const login=async()=>{await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await clickMenu(page,page.locator('.admin-nav [data-tab=students]'));await page.locator('[data-action=new-student]').waitFor();await idle();};
 await step('desktop and mobile sidebar preserve navigation, focus, scroll and display preferences',async()=>{
  const title='교육과정 편성·운영 지원 도구',credit='기획·개발: 첨단고등학교 정준홍';
  const panel=page.locator('#sidebar'),opener=page.locator('[data-sidebar-open]'),toggle=panel.locator('[data-sidebar-toggle]');
  const selected=panel.locator('[data-tab=students]');
  await page.setViewportSize({width:1920,height:1080});
  await page.goto(pages+'/curriculum/admin.html');await idle();assert(await panel.isHidden());assert(await opener.isHidden());await login();
  assert.equal(await page.title(),title);assert.equal(await panel.locator('.program-title').innerText(),title);
  assert.equal(await panel.locator('.sidebar-credit').innerText(),credit);
  assert.deepEqual(await panel.locator('nav button').allTextContents(),['학생 시간표','분반배정','학생','시수배당표','이동수업 배치표','결보강','설정']);
  assert.equal(await selected.getAttribute('aria-current'),'page');
  await page.screenshot({path:'test-results/curriculum-sidebar-desktop.png'});
  const expanded=await page.locator('#workspace').evaluate(el=>el.clientWidth);
  await toggle.click();await page.waitForFunction(()=>document.getElementById('sidebar').clientWidth===63);
  assert(await page.locator('#workspace').evaluate(el=>el.clientWidth)>expanded);
  assert(await selected.locator('svg').isVisible());assert.equal(await selected.getAttribute('title'),'학생');
  assert(await selected.locator('.nav-label').isHidden());assert(await panel.locator('.sidebar-credit').isHidden());
  await page.reload();await idle();assert(await panel.isHidden());await login();
  assert.equal(await toggle.getAttribute('aria-label'),'메뉴 펼치기');await toggle.click();
  await page.setViewportSize({width:390,height:844});await opener.waitFor();
  await page.waitForFunction(()=>document.getElementById('sidebar').getAttribute('aria-hidden')==='true');
  assert(await page.locator('.compact-program-title').isVisible());
  await opener.click();assert.equal(await panel.getAttribute('aria-modal'),'true');
  assert(await page.locator('#workspace').evaluate(el=>el.inert));assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');
  assert(await toggle.evaluate(el=>el===document.activeElement));assert.equal(await panel.locator('.sidebar-credit').innerText(),credit);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'settings');
  await page.setViewportSize({width:390,height:320});
  assert(await panel.locator('nav').evaluate(el=>el.scrollHeight>el.clientHeight));
  const footerY=await panel.locator('footer').evaluate(el=>el.getBoundingClientRect().y);
  await panel.locator('nav').evaluate(el=>el.scrollTop=el.scrollHeight);
  assert.equal(await panel.locator('footer').evaluate(el=>el.getBoundingClientRect().y),footerY);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/curriculum-sidebar-mobile.png'});
  await page.keyboard.press('Escape');assert(await opener.evaluate(el=>el===document.activeElement));
  await opener.click();await page.locator('.sidebar-backdrop').click({position:{x:370,y:80}});
  assert.equal(await opener.getAttribute('aria-expanded'),'false');
  await opener.click();await toggle.click();assert.equal(await opener.getAttribute('aria-expanded'),'false');
  await clickMenu(page,selected);await idle();assert.equal(await opener.getAttribute('aria-expanded'),'false');
  assert(await page.locator('#student-table').isVisible());
  await clickMenu(page,panel.locator('nav button').first());
  await page.locator('#student-number').fill('30101');await page.locator('form[data-form=student] button').click();
  await page.locator('.tt').waitFor();await idle();assert(await page.evaluate(()=>TTApi.hasSession('admin')));
  await opener.click();await page.reload();await idle();
  assert(await panel.isHidden());assert(await opener.isHidden());assert.equal(await page.evaluate(()=>document.body.style.position),'');
  await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();
  await panel.and(page.locator('[aria-modal=true]')).waitFor();await idle();
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.body.style.position),'');
  await page.setViewportSize({width:820,height:760});await opener.click();
  await page.setViewportSize({width:1920,height:1080});
  await page.waitForFunction(()=>!document.getElementById('workspace').inert&&document.body.style.position==='');
  await page.setViewportSize({width:390,height:844});
 });
 await step('a slow public bootstrap never blocks typing or login; prepared credentials are used once',async()=>{
  let release;bootstrapGate=new Promise(resolve=>release=resolve);
  await page.goto(pages+'/curriculum/teacher.html');await idle();
  assert(await page.locator('#password').isEnabled());
  await page.waitForFunction(()=>window.TIMETABLE_PERF?.some(r=>r.action==='passwordParameters'));
  const prepared=requests.filter(r=>r.action==='passwordParameters').length;
  await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();
  await page.locator('[data-action=teacher-tab]').first().waitFor({state:'attached'});await idle();
  assert.equal(requests.filter(r=>r.action==='passwordParameters').length,prepared,'login consumes the prefetched public parameters');
  release();bootstrapGate=null;
  await page.waitForFunction(()=>window.TIMETABLE_PERF?.some(r=>r.action==='bootstrap'));
  assert(await page.locator('form[data-form=teacher]').isVisible());
  const first=page.locator('#sidebar-menu button').first();assert.equal(await first.textContent(),'학생 시간표');
  await clickMenu(page,first);await page.locator('#student-number').fill('30101');
  await page.locator('form[data-form=student] button').click();await page.locator('.tt').waitFor();await idle();
  assert(await page.evaluate(()=>TTApi.hasSession('teacher')));
  await clickMenu(page,page.locator('[data-action=teacher-tab][data-tab=timetable]'));
  assert(await page.locator('form[data-form=teacher]').isVisible());
 });
 await step('Pages displays the mobile student timetable without leaving its own origin',async()=>{
  await page.goto(pages+'/curriculum/');await idle();assert(await page.locator('#sidebar').isHidden());
  const before=requests.filter(r=>r.action==='passwordParameters').length;
  assert.equal(await page.locator('#login-role').inputValue(),'student');assert(await page.locator('#password').isHidden());
  await page.locator('#login-student-number').fill('30101');await page.locator('form[data-form=login] button').click();await page.locator('.tt').waitFor();await idle();
  assert.equal(await page.locator('#header .top-actions').innerText(),'로그아웃');
  assert.equal(requests.filter(r=>r.action==='passwordParameters').length,before);
  assert.deepEqual(await page.locator('#sidebar-menu button').allTextContents(),['학생 시간표']);await idle();assert.equal(new URL(page.url()).origin,pages);assert.equal(await page.locator('.tt tbody tr').count(),7);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 });
 await step('Teacher can resume from a new tab and logout removes the remembered session',async()=>{
  const teacher=await context.newPage();
  await teacher.goto(pages+'/curriculum/');
  await teacher.locator('#login-role').selectOption('teacher');
  await teacher.locator('#remember-teacher').check();
  await teacher.locator('#password').fill('1234');
  await teacher.locator('form[data-form=login] button').click();
  await teacher.locator('[data-action=logout]').waitFor();
  const remaining=await teacher.evaluate(()=>JSON.parse(localStorage.getItem('timetable.rememberedTeacher')).expiresAt-Date.now());
  assert(remaining>399*86400000&&remaining<=400*86400000);
  await clickMenu(teacher,teacher.locator('[data-tab=studentTimetable]'));
  await teacher.locator('#student-number').waitFor();
  await teacher.close();
  const resumed=await context.newPage();
  await resumed.goto(pages+'/curriculum/');
  await resumed.locator('#student-number').waitFor();
  assert.equal(await resumed.locator('#header a, #sidebar a.program-title').count(),0);
  await resumed.locator('[data-action=logout]').click();
  await resumed.locator('#login-role').waitFor();
  assert.equal(await resumed.evaluate(()=>localStorage.getItem('timetable.rememberedTeacher')),null);
  await resumed.close();
 });
 await step('Pages admin login, real D1 save and history work without third-party cookies',async()=>{
  await page.locator('[data-action=logout]').click();await idle();assert.equal(await page.locator('#login-role').inputValue(),'student');assert(await page.locator('#sidebar').isHidden());assert(await page.locator('[data-sidebar-open]').isHidden());
  await page.goto(pages+'/curriculum/admin.html');await idle();await login();await page.locator('[data-action=edit-student]').first().click();await page.locator('#edit-name').waitFor();await idle();await page.locator('#edit-name').fill('Pages입력보호');await page.locator('form[data-form=save-student] button.primary').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);await idle();assert.equal((await h.api('adminStudent',{id:'student-one'},cookieAdmin.cookie)).data.student.name,'Pages입력보호');assert.equal(new URL(page.url()).origin,pages);
  const storage=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));assert(!/[a-f0-9]{64}/.test(JSON.stringify(storage)));assert.equal(JSON.parse(storage.session['timetable.admin']).token,'memory');
 });
 await step('Pages opens the course allocation worksheet with the same in-memory admin session',async()=>{
  await clickMenu(page,page.locator('.admin-nav [data-tab=hours]'));await idle();
  const workbook=page.frameLocator('#course-pane iframe');
  await workbook.locator('.workbook').waitFor();
  assert(await workbook.getByRole('button',{name:'학교 설정',exact:true}).isVisible());
  assert(await workbook.locator('.workbook-brand span').isVisible());
  assert.equal(await workbook.locator('input[type=password]').count(),0);
  assert.equal(new URL(page.url()).origin,pages);
  assert(requests.some(r=>r.action==='courseWorkspace'&&r.authorized));
  await page.screenshot({path:'test-results/course-mobile.png',fullPage:true});
 });
 await step('refresh requires a new login and logout revokes the in-memory Pages session',async()=>{
  await page.reload();await idle();await page.locator('#password').waitFor();assert.equal(await page.locator('[data-action=new-student]').count(),0);await login();await page.locator('[data-action=logout]').click();await page.locator('#login-role').waitFor();await idle();assert.equal(await page.evaluate(()=>TTApi.hasSession('admin')),false);await page.locator('#login-role').selectOption('admin');
 });
 await step('Separate password buttons select the intended role and preserve unsaved settings',async()=>{
  await login();await clickMenu(page,page.locator('[data-action=admin-tab]').filter({hasText:'설정',exact:true}));await idle();
  assert.equal(await page.locator('#password-role').count(),0);assert.equal(await page.locator('[data-action=password-dialog]').count(),2);
  const teacher=await h.login('teacher');
  const preparedTeacher=await context.newPage();
  await preparedTeacher.goto(pages+'/curriculum/teacher.html');
  await preparedTeacher.waitForFunction(()=>window.TIMETABLE_PERF?.some(r=>r.action==='passwordParameters'));
  await page.locator('#set-school').fill('비밀번호 변경 중 설정 유지');
  await page.getByRole('button',{name:'교사 비밀번호 변경',exact:true}).click();
  assert.equal(await page.locator('#modal h2').textContent(),'교사 비밀번호 변경');
  assert.equal(await page.locator('form[data-form=password]').getAttribute('data-role'),'teacher');
  await page.locator('#password-current').fill('1234');await page.locator('#password-new').fill('교사5678');await page.locator('#password-confirm').fill('다른비밀번호');
  const before=requests.filter(r=>r.action==='changePassword').length;
  await page.locator('form[data-form=password] button.primary').click();await idle();
  assert.match(await page.locator('#toast').textContent(),/확인이 다릅니다/);assert.equal(requests.filter(r=>r.action==='changePassword').length,before);
  await page.locator('#password-confirm').fill('교사5678');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'test-results/password-teacher-mobile.png',fullPage:true});
  await page.locator('form[data-form=password] button.primary').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);await idle();
  assert.equal(await page.locator('#set-school').inputValue(),'비밀번호 변경 중 설정 유지');assert.equal(await page.locator('#password-new').count(),0);
  assert.equal((await h.api('teacherBootstrap',{},teacher.cookie)).status,401);await h.login('teacher','교사5678');assert.equal((await h.api('adminBootstrap',{},cookieAdmin.cookie)).status,200);
  await preparedTeacher.locator('#password').fill('교사5678');await preparedTeacher.locator('form[data-form=login] button').click();
  await preparedTeacher.locator('[data-action=teacher-tab]').first().waitFor({state:'attached'});
  assert.equal(await preparedTeacher.evaluate(()=>TIMETABLE_PERF.filter(r=>r.action==='login').length),2,'changed credentials refresh the prepared epoch and retry once');
  await preparedTeacher.close();
 });
 await step('Admin password button requires a fresh login and revokes existing admin sessions',async()=>{
  const teacher=await h.login('teacher','교사5678');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'관리자 비밀번호 변경',exact:true}).click();
  assert.equal(await page.locator('#modal h2').textContent(),'관리자 비밀번호 변경');
  assert.equal(await page.locator('form[data-form=password]').getAttribute('data-role'),'admin');assert.equal(await page.locator('#password-new').inputValue(),'');
  await page.locator('#password-current').fill('1234');await page.locator('#password-new').fill('관리자5678');await page.locator('#password-confirm').fill('관리자5678');
  await page.screenshot({path:'test-results/password-admin-desktop.png',fullPage:true});
  await page.locator('form[data-form=password] button.primary').click();await page.locator('#password').waitFor();await idle();
  assert.equal((await h.api('adminBootstrap',{},cookieAdmin.cookie)).status,401);assert.equal((await h.api('teacherBootstrap',{},teacher.cookie)).status,200);
  assert.equal(await page.evaluate(()=>TTApi.hasSession('admin')),false);await page.locator('#password').fill('관리자5678');await page.locator('form[data-form=login] button').click();await page.locator('[data-action=password-dialog]').first().waitFor();await idle();
 });
 // Intercepted browser requests can omit network preflights; pages-api.test covers them separately.
 assert(requests.filter(r=>r.method==='POST').every(r=>r.origin===pages));assert(requests.some(r=>r.action==='saveStudent'&&r.authorized));assert.deepEqual(errors,[]);
 await writeFile('test-results/pages-browser.json',JSON.stringify({steps,requests,errors},null,2)+'\n');
}finally{await browser?.close();await h.close();}
