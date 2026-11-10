import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import '../scripts/build-pages.mjs';
import {sharedBackup,sharedStore,rawPlan,ids} from './class-swap-fixture.mjs';
// Reserved test hosts only. Every browser request is fulfilled locally or aborted.
const pages='https://timetable-pages.test',api='https://timetable-api.test',h=await harness({frontendOrigin:pages});
const cookieAdmin=await h.login();assert((await h.mutation('restore',{backup:sharedBackup()},cookieAdmin.cookie)).ok);
let browser,swapGate;const errors=[],requests=[],steps=[];await mkdir('test-results',{recursive:true});
async function step(name,fn){await fn();steps.push(name);console.log('PASS '+name);}
try{
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 // An unusable third-party cookie must never be needed or sent by the Pages app.
 await context.addCookies([{name:'__Host-tt_admin',value:'0'.repeat(64),domain:'timetable-api.test',path:'/',secure:true,httpOnly:true,sameSite:'None'}]);
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===pages){
   const relative=url.pathname.replace(/^\/timetable\/?/,'')||'index.html',path=resolve('.cache/pages-site',relative);
   if(!path.startsWith(resolve('.cache/pages-site')))return route.abort();
   try{let body=await readFile(path);if(relative==='config.js'){const config=JSON.parse(body.toString().replace(/^window.TIMETABLE_CONFIG=/,'').replace(/;\s*$/,''));config.apiBase=api+'/api/';body=Buffer.from('window.TIMETABLE_CONFIG='+JSON.stringify(config)+';');}return await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream',body});}catch{return route.fulfill({status:404,body:'Not found'});}
  }
  if(url.origin===api&&url.pathname.startsWith('/api/')){
   if(url.pathname==='/api/classSwap'&&swapGate)await swapGate;
   assert.equal(req.headers().cookie,undefined);requests.push({action:url.pathname.slice(5),method:req.method(),origin:req.headers().origin,authorized:Boolean(req.headers().authorization)});
   const response=await h.mf.dispatchFetch(req.url(),{method:req.method(),headers:req.headers(),...(['GET','OPTIONS'].includes(req.method())?{}:{body:req.postData()||'{}'})});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }
  return route.abort();
 });
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false');
 const login=async()=>{await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await page.locator('[data-action=teacher-tab][data-tab=classSwap]').waitFor();await idle();};
 const swap=page.locator('#class-swap-pane');
 const swapIdle=()=>swap.locator('#uiLock:not([disabled])').waitFor();
 await step('Class swap is a native timetable view with no login screen even while its data is delayed',async()=>{
  await page.goto(pages+'/timetable/teacher.html');await idle();await login();
  await page.locator('#teacher-name').fill('가교사');await page.locator('form[data-form=teacher] button').click();await page.locator('.tt').waitFor();await idle();
  let release;swapGate=new Promise(resolve=>release=resolve);
  await page.locator('[data-tab=classSwap]').click();await page.waitForFunction(()=>document.body.dataset.loading==='true');
  assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.locator('iframe').count(),0);
  release();swapGate=null;await swap.locator('#appView').waitFor({state:'visible'});await idle();await swapIdle();
  assert.equal(await swap.locator('input[type=password],#loginView,.topbar,.footbar').count(),0);
  assert.equal(await page.locator('#busy').count(),0);assert.equal(await swap.locator('#progress').count(),0);
  assert.equal(new URL(page.url()).origin,pages);assert.equal(page.frames().length,1);assert.equal(requests.filter(r=>r.action==='login').length,1);assert.equal(requests.filter(r=>r.action==='classSwap').length,1);
 });
 const plan=rawPlan();
 await step('Private draft, explicit submission, print and admin-only review',async()=>{
  await swap.locator('#teacherA').selectOption(ids.a);await swap.locator('#reason').fill('통합 검증');
  await swap.locator('#dateA').fill(plan.items[0].dateA);await swap.locator('#dateA').dispatchEvent('change');
  await swap.locator('#weekB').fill(plan.items[0].dateA);await swap.locator('#weekB').dispatchEvent('change');
  await swap.locator('[data-action=cellA][data-day="0"][data-period="1"]').click();await swap.locator('#teacherB').selectOption(ids.b);await swap.locator('[data-action=cellB][data-day="1"][data-period="2"]').click();await swap.locator('[data-action=add]').click();
  assert.equal(await swap.locator('#itemCount').textContent(),'1건');
  await page.locator('[data-tab=timetable]').click();assert.equal(await page.locator('#app .tt').count(),1);await page.locator('[data-tab=classSwap]').click();await idle();await swapIdle();assert.equal(await swap.locator('#reason').inputValue(),'통합 검증');assert.equal(await swap.locator('#itemCount').textContent(),'1건');
  assert(!(await swap.locator('[data-action=printReceipt]').isVisible()));
  await swap.locator('[data-action=save]').click();
  assert.equal((await h.sql('SELECT count(*) n FROM swap_reservations')).results[0].n,0);
  assert.equal((await h.sql('SELECT count(*) n FROM swap_plans')).results[0].n,0);
  await page.reload();await idle();await login();await page.locator('[data-tab=classSwap]').click();await idle();await swapIdle();
  await swap.locator('[data-action=nav][data-view=history]').click();
  assert.match(await swap.locator('#historyList').textContent(),/통합 검증/);await swap.locator('[data-action=openPlan]').click();
  page.once('dialog',d=>d.accept());await swap.locator('[data-action=submit]').click();await swapIdle();
  await swap.locator('#receipt').waitFor({state:'visible'});
  assert.equal((await h.sql('SELECT count(*) n FROM swap_reservations')).results[0].n,4);
  await page.evaluate(()=>{window.print=()=>{window.printCalled=true;};});await swap.locator('[data-action=printReceipt]').click();await page.waitForFunction(()=>window.printCalled);assert.equal(await page.locator('#print-root .print-page').count(),1);assert.match(await page.locator('#print-root > style').textContent(),/A4 portrait/);
  await page.setViewportSize({width:794,height:1123});await page.emulateMedia({media:'print'});assert(await page.locator('#print-root .print-page').isVisible());await page.screenshot({path:'test-results/class-swap-print.png',fullPage:true});await page.emulateMedia({media:'screen'});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await swap.locator('[data-action=noticeReceipt]').click();await page.waitForFunction(()=>document.querySelector('#print-root > style')?.textContent.includes('landscape'));assert.equal(await page.locator('#print-root .notice-page').count(),1);await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await swap.locator('[data-action=nav][data-view=history]').click();assert.doesNotMatch(await swap.locator('#historyList').textContent(),/통합 검증/);
  const manager=await context.newPage();await manager.goto(pages+'/timetable/admin.html');await manager.locator('#password').fill('1234');
  await manager.locator('form[data-form=login] button').click();await manager.locator('[data-action=admin-tab][data-tab=classSwap]').click();
  const history=manager.locator('#admin-content');await history.locator('[data-action=openPlan]').first().click();
  assert.match(await history.locator('#detailContent').textContent(),/통합 검증/);await history.locator('#planDetail button').click();
  manager.once('dialog',d=>d.accept());await history.locator('[data-action=cancelPlan]').first().click();
  await history.locator('#historyStatus').selectOption('cancelled');await history.locator('#historyList .type').filter({hasText:'취소됨'}).waitFor();
  assert.equal((await h.sql('SELECT count(*) n FROM swap_reservations')).results[0].n,0);await manager.close();
  await swap.locator('[data-action=nav]').filter({hasText:'계획서 작성'}).click();
 });
 await step('Session expiry uses only the shared login and retains the native draft through reauthentication',async()=>{
  await swap.locator('#reason').fill('로그인 후에도 유지');await h.sql("DELETE FROM sessions WHERE role='teacher'");
  await swap.locator('#writeView [data-action=refresh]').click();await page.locator('#password').waitFor();await idle();await login();await swap.locator('#appView').waitFor({state:'visible'});await swapIdle();assert.equal(await swap.locator('#reason').inputValue(),'로그인 후에도 유지');
  assert.equal(await page.locator('#class-swap-pane > div').count(),1);assert.equal(await swap.locator('input[type=password]').count(),0);
 });
 await step('One administrator XLSX update changes both the teacher timetable and class swap',async()=>{
  const manager=await context.newPage();await manager.goto(pages+'/timetable/admin.html');await manager.waitForFunction(()=>document.body.dataset.loading==='false');await manager.locator('#password').fill('1234');await manager.locator('form[data-form=login] button').click();await manager.locator('[data-action=admin-tab][data-tab=settings]').click();await manager.locator('[data-action=admin-tab][data-tab=imports]').click();await manager.waitForFunction(()=>document.body.dataset.loading==='false');
  await manager.evaluate(()=>TTAssets.load('xlsx'));const store=sharedStore();store.teacherRows[2][2]='공통 수정 과학';store.teacherRows.push(['4','추가교사'],['','']);
  const bytes=await manager.evaluate(rows=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'교사시간표');return Array.from(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));},store.teacherRows);
  await manager.locator('#import-teacher').setInputFiles({name:'shared-teachers.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});await manager.locator('form[data-form=preview-import] button[type=submit]').click();await manager.locator('[data-action=commit-import]').waitFor();await manager.waitForFunction(()=>document.body.dataset.loading==='false');await manager.locator('[data-action=commit-import]').click();await manager.waitForFunction(()=>document.body.dataset.loading==='false');
  await swap.locator('#writeView [data-action=refresh]').click();await swapIdle();assert.match(await swap.locator('#teacherA').textContent(),/추가교사/);await swap.locator('#teacherA').selectOption(ids.a);assert.match(await swap.locator('#tableA').textContent(),/공통 수정 과학/);
  await page.locator('[data-tab=timetable]').click();await page.locator('#teacher-name').fill('가교사');await page.locator('form[data-form=teacher] button').click();await idle();assert.match(await page.locator('#app .tt').textContent(),/공통 수정 과학/);await page.locator('[data-tab=classSwap]').click();await idle();await swapIdle();await manager.close();
 });
 await step('Term changes update the shared heading and keep unsaved class swap drafts per term',async()=>{
  await swap.locator('#reason').fill('이전 학기 초안');const settings={...sharedStore().settings,academicYear:2027,semester:1};assert((await h.mutation('saveSettings',{settings},cookieAdmin.cookie)).ok);
  await swap.locator('#writeView [data-action=refresh]').click();await swapIdle();await idle();assert.match(await page.locator('#header .term-label').textContent(),/2027학년도 1학기/);assert.equal(await swap.locator('#reason').inputValue(),'');assert(await swap.locator('#noDataset').isVisible());
  assert((await h.mutation('switchTerm',{term:'2026-2'},cookieAdmin.cookie)).ok);await swap.locator('#writeView [data-action=refresh]').click();await swapIdle();await idle();assert.equal(await swap.locator('#reason').inputValue(),'이전 학기 초안');assert.match(await page.locator('#header .term-label').textContent(),/2026학년도 2학기/);
 });
 await step('Minimal monochrome mobile and desktop views preserve Pretendard and fit the page',async()=>{
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const design=await page.locator('#class-swap-pane > div').evaluate(async host=>{await document.fonts.ready;return {font:getComputedStyle(host).fontFamily,overflow:host.scrollWidth>host.clientWidth,explanations:['schoolLabel','datasetLabel','electiveSummary','footerText'].filter(id=>host.shadowRoot.getElementById(id))};});
  assert.match(design.font,/Pretendard/);assert.equal(design.overflow,false);assert.deepEqual(design.explanations,[]);
  await page.waitForFunction(()=>!document.querySelector('#toast').textContent);await swap.locator('#toast').waitFor({state:'hidden'});await page.screenshot({path:'test-results/teacher-tools-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:'test-results/teacher-tools-desktop.png',fullPage:true});
 });
 await step('teacher menus retain the same FHD frame and native class-swap draft',async()=>{
  await page.setViewportSize({width:1920,height:1080});let frame;
  for(const tab of ['timetable','classSwap','allocation','roster','batch']){
   await page.locator('[data-action=teacher-tab][data-tab='+tab+']').click();await idle();if(tab==='classSwap')await swapIdle();
   const current=await page.locator('.tabs').evaluate(el=>{const r=el.getBoundingClientRect(),main=document.querySelector('#app').getBoundingClientRect();return [r.x,r.y,r.width,main.x,main.width];});
   frame??=current;assert.deepEqual(current,frame,tab);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(tab==='timetable'){await page.locator('#teacher-name').fill('가교사');await page.locator('form[data-form=teacher] button').click();await idle();await page.locator('.tt').waitFor();}
   if(tab==='classSwap')await swap.locator('#toast').waitFor({state:'hidden'});
   if(['timetable','classSwap'].includes(tab))await page.screenshot({path:'test-results/workspace-teacher-'+tab+'.png',fullPage:true});
  }
  await page.locator('[data-tab=classSwap]').click();await idle();await swapIdle();assert.equal(await swap.locator('#reason').inputValue(),'이전 학기 초안');
 });
 await step('First-grade subject roster selects a homeroom and prints its students',async()=>{
  await page.locator('[data-tab=roster]').click();await idle();
  await page.locator('#roster-grade').selectOption('1');await page.locator('#roster-subject').selectOption('공통 수정 과학');
  assert.equal(await page.locator('label[for=roster-section]').textContent(),'학급');
  await page.locator('#roster-section').selectOption('1');await page.locator('form[data-form=roster] button').click();await idle();
  assert.match(await page.locator('#modal').textContent(),/공통 수정 과학.*1학년 1반.*가상학생하나/);
  await page.locator('[data-action=print-roster]').click();await idle();
  assert.match(await page.locator('#print-root').textContent(),/1학년 1반/);await page.locator('[data-action=close-modal]').click();
  await page.locator('[data-tab=classSwap]').click();await idle();await swapIdle();
 });
 await step('Explicit logout confirms discard and removes the native view',async()=>{
  page.once('dialog',d=>d.dismiss());await page.locator('[data-action=logout]').click();await idle();assert.equal(await page.locator('#class-swap-pane > div').count(),1);
  page.once('dialog',d=>d.accept());await page.locator('[data-action=logout]').click();await page.locator('#password').waitFor();await idle();assert.equal(await page.locator('#class-swap-pane > div').count(),0);assert.equal(await page.evaluate(()=>TTApi.hasSession('teacher')),false);
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert(!/[a-f0-9]{64}/.test(storage));
 });
 // Intercepted browser requests can omit network preflights; pages-api.test covers them separately.
 assert(requests.filter(r=>r.method==='POST').every(r=>r.origin===pages));assert(requests.some(r=>r.action==='classSwap'&&r.authorized));assert.deepEqual(errors,[]);
 await writeFile('test-results/teacher-tools-browser.json',JSON.stringify({steps,requests,errors},null,2)+'\n');
}finally{await browser?.close();await h.close();}
