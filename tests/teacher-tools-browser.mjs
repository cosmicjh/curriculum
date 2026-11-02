import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import '../scripts/build-pages.mjs';
import {synthetic,rawPlan} from './class-swap-fixture.mjs';
// Reserved test hosts only. Every browser request is fulfilled locally or aborted.
const pages='https://timetable-pages.test',api='https://timetable-api.test',h=await harness({frontendOrigin:pages});
const cookieAdmin=await h.login();assert((await h.mutation('restore',{backup:backup()},cookieAdmin.cookie)).ok);
await h.sqlOn('CLASS_SWAP_DB','UPDATE state SET dataset=?,revision=1,data_rev=1 WHERE id=1',JSON.stringify(synthetic()));
let browser;const errors=[],requests=[],steps=[];await mkdir('test-results',{recursive:true});
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
   assert.equal(req.headers().cookie,undefined);requests.push({action:url.pathname.slice(5),method:req.method(),origin:req.headers().origin,authorized:Boolean(req.headers().authorization)});
   const response=await h.mf.dispatchFetch(req.url(),{method:req.method(),headers:req.headers(),...(['GET','OPTIONS'].includes(req.method())?{}:{body:req.postData()||'{}'})});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }
  return route.abort();
 });
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false');
 const login=async()=>{await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await page.locator('[data-action=teacher-tab][data-tab=classSwap]').waitFor();await idle();};
 const swap=page.frameLocator('#class-swap-pane iframe');
 const swapIdle=()=>swap.locator('#uiLock:not([disabled])').waitFor();
 await step('One Pages teacher login opens both tools without a second password',async()=>{
  await page.goto(pages+'/timetable/teacher.html');await idle();await login();
  await page.locator('#teacher-name').fill('가상교사');await page.locator('form[data-form=teacher] button').click();await page.locator('.tt').waitFor();await idle();
  await page.locator('[data-tab=classSwap]').click();await swap.locator('#appView').waitFor({state:'visible'});await swapIdle();
  assert.equal(await swap.locator('#loginView').isVisible(),false);assert.equal(await swap.locator('.topbar').isVisible(),false);assert.equal(await swap.locator('.footbar').isVisible(),false);
  assert.equal(new URL(page.url()).origin,pages);assert.equal(requests.filter(r=>r.action==='login').length,1);
 });
 const plan=rawPlan();
 await step('Embedded class swap saves and cancels in the actual separate D1',async()=>{
  await swap.locator('#teacherA').selectOption('a');await swap.locator('#reason').fill('통합 검증');
  await swap.locator('#dateA').fill(plan.items[0].dateA);await swap.locator('#dateA').dispatchEvent('change');
  await swap.locator('#weekB').fill(plan.items[0].dateA);await swap.locator('#weekB').dispatchEvent('change');
  await swap.locator('[data-action=cellA][data-day="0"][data-period="1"]').click();await swap.locator('#teacherB').selectOption('b');await swap.locator('[data-action=cellB][data-day="1"][data-period="2"]').click();await swap.locator('[data-action=add]').click();
  assert.equal(await swap.locator('#itemCount').textContent(),'1건');
  await page.locator('[data-tab=timetable]').click();assert.equal(await page.locator('.tt').count(),1);await page.locator('[data-tab=classSwap]').click();await swapIdle();assert.equal(await swap.locator('#reason').inputValue(),'통합 검증');assert.equal(await swap.locator('#itemCount').textContent(),'1건');
  await swap.locator('[data-action=save]').click();await swapIdle();assert.equal((await h.sqlOn('CLASS_SWAP_DB','SELECT count(*) n FROM reservations')).results[0].n,4);
  const child=page.frames().find(f=>f.url().includes('/class-swap/'));await child.evaluate(()=>{window.print=()=>{window.printCalled=true;};});await swap.locator('[data-action=printDraft]').click();await child.waitForFunction(()=>window.printCalled);assert.equal(await swap.locator('#printRoot .print-page').count(),1);assert.match(await swap.locator('#printPageStyle').textContent(),/A4 portrait/);await child.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await swap.locator('[data-action=nav]').filter({hasText:'저장된 계획서'}).click();page.once('dialog',d=>d.accept());await swap.locator('[data-action=cancelPlan]').first().click();await swapIdle();assert.equal((await h.sqlOn('CLASS_SWAP_DB','SELECT count(*) n FROM reservations')).results[0].n,0);
  await swap.locator('[data-action=nav]').filter({hasText:'계획서 작성'}).click();
 });
 await step('Expired common login retains the embedded draft through reauthentication',async()=>{
  await swap.locator('#reason').fill('로그인 후에도 유지');await h.sql("DELETE FROM sessions WHERE role='teacher'");
  await swap.locator('#writeView [data-action=refresh]').click();await page.locator('#password').waitFor();await idle();await login();await swap.locator('#appView').waitFor({state:'visible'});await swapIdle();assert.equal(await swap.locator('#reason').inputValue(),'로그인 후에도 유지');
  assert.equal(await page.locator('#class-swap-pane iframe').count(),1);
 });
 await step('Minimal monochrome mobile and desktop views preserve Pretendard and fit the page',async()=>{
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const frame=page.frames().find(f=>f.url().includes('/class-swap/'));
  const design=await frame.evaluate(async()=>{await document.fonts.ready;return {font:getComputedStyle(document.body).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth,explanations:['schoolLabel','datasetLabel','electiveSummary','footerText'].filter(id=>document.getElementById(id))};});
  assert.match(design.font,/Pretendard/);assert.equal(design.overflow,false);await page.waitForFunction(()=>{const frame=document.querySelector('#class-swap-pane iframe');return frame.clientHeight>=frame.contentDocument.querySelector('.shell').getBoundingClientRect().height;});assert.deepEqual(design.explanations,[]);
  await page.screenshot({path:'test-results/teacher-tools-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:'test-results/teacher-tools-desktop.png',fullPage:true});
 });
 await step('Explicit logout confirms discard and removes the embedded session',async()=>{
  page.once('dialog',d=>d.dismiss());await page.locator('[data-action=logout]').click();await idle();assert.equal(await page.locator('#class-swap-pane iframe').count(),1);
  page.once('dialog',d=>d.accept());await page.locator('[data-action=logout]').click();await page.locator('#password').waitFor();await idle();assert.equal(await page.locator('#class-swap-pane iframe').count(),0);assert.equal(await page.evaluate(()=>TTApi.hasSession('teacher')),false);
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert(!/[a-f0-9]{64}/.test(storage));
 });
 // Intercepted browser requests can omit network preflights; pages-api.test covers them separately.
 assert(requests.filter(r=>r.method==='POST').every(r=>r.origin===pages));assert(requests.some(r=>r.action==='classSwap'&&r.authorized));assert.deepEqual(errors,[]);
 await writeFile('test-results/teacher-tools-browser.json',JSON.stringify({steps,requests,errors},null,2)+'\n');
}finally{await browser?.close();await h.close();}
