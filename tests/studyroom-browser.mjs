import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import {stretchPassword,newSalt} from '../src/password.js';
import {localTime} from '../src/studyroom-domain.js';
import '../scripts/build.mjs';
const h=await harness({studyroom:true}),steps=[],errors=[];let browser;
const now=localTime(new Date());
await mkdir('test-results/studyroom',{recursive:true});await mkdir('.impeccable/review',{recursive:true});
async function step(name,fn){await fn();steps.push(name);console.log('PASS '+name);}
try{
 const admin=await h.login();assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
 const api=(op,data={})=>h.api('studyroom',{op,...data},admin.cookie),rev=async()=>(await api('dashboard')).data.revision;
 const salt=newSalt();assert((await api('saveStaff',{expectedRevision:await rev(),staff:{username:'test.teacher',name:'가상확인교사',enabled:true,passwordProof:await stretchPassword('가상교사1234',{salt}),passwordSalt:salt,passwordLength:8}})).ok);
 assert((await api('configuration',{expectedRevision:await rev(),enabled:true,schedule:{effectiveDate:now.date,definitions:[{id:'test',label:'가상 검증 회차',days:[1,2,3,4,5,6,7],start:'00:00',end:'23:59'}]}})).ok);
 const url=await h.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await step('mobile QR submission uses shared D1 roster and retries the same request after lost response',async()=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url+'/studyroom-student.html?seat=99');
  await page.locator('[name=grade]').selectOption('3');await page.locator('[name=classNum]').selectOption('01');await page.locator('[name=number]').selectOption('01');await page.locator('#student-form button').click();await page.locator('#confirmation').waitFor({state:'visible'});assert.match(await page.locator('#student-name').textContent(),/가상학생하나/);
  let dropped=false;const ids=[];await page.route('**/api/studyroom',async route=>{const data=route.request().postDataJSON();if(data.op==='submit'){ids.push(data.requestId);if(!dropped){dropped=true;await route.fetch();return route.abort('failed');}}return route.continue();});
  await page.locator('#submit').click();await page.locator('#status').filter({hasText:'연결'}).waitFor();await page.locator('#submit').click();await page.locator('#status').filter({hasText:'제출 완료'}).waitFor();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal((await h.sql('SELECT count(*) n FROM sr_attendance')).results[0].n,1);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.evaluate(()=>document.fonts.check('16px "Pretendard Variable"')));await page.screenshot({path:'test-results/studyroom/student-mobile.png',fullPage:true});
 });
 const teacher=await ctx.newPage();teacher.on('pageerror',e=>errors.push(e.message));await teacher.setViewportSize({width:1440,height:1000});
 const sr=teacher.locator('.studyroom'),idle=()=>sr.locator('[data-sr="refresh"]').waitFor().then(()=>teacher.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false'));
 await step('native teacher tab retains common login, displays 99 seats and verifies an individual teacher',async()=>{
  await teacher.goto(url+'/teacher.html');await teacher.locator('#password').fill('1234');await teacher.locator('form[data-form=login] button').click();await teacher.locator('[data-action=teacher-tab][data-tab=studyroom]').click();await idle();assert.equal(await sr.locator('[data-sr=seat]').count(),99);assert.match(await sr.locator('[data-seat="99"]').textContent(),/30101.*가상학생하나/);
  await sr.locator('[data-sr-identity]').click();await sr.locator('[data-sr-form=identity] [name=username]').fill('test.teacher');await sr.locator('[data-sr-form=identity] [name=password]').fill('가상교사1234');await sr.locator('[data-sr-form=identity] button:not([type=button])').click();await idle();assert.equal(await sr.locator('[data-sr-identity]').textContent(),'가상확인교사');
  await sr.locator('[data-seat="99"]').click();await sr.locator('dialog [data-sr-form=change] button').click();await idle();assert(await sr.locator('[data-seat="99"]').evaluate(e=>e.classList.contains('confirmed')));
  await teacher.screenshot({path:'.impeccable/review/desktop.png',fullPage:true});
 });
 await step('student month calendar, day records, filters and history are connected to D1',async()=>{
  await sr.locator('[data-sr=view][data-view=query]').click();await teacher.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');
  await sr.locator('[data-sr-form=search] [name=search]').fill('30101');await sr.locator('[data-sr-form=search] button:not([type=button])').click();await teacher.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');await sr.locator('[data-sr=person]').first().click();await teacher.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');
  assert.match(await sr.locator('[data-sr-day], [data-sr=day][data-day="'+now.date+'"]').textContent(),/제출 1.*확인 1/);assert.equal(await sr.locator('[data-sr-results] tbody tr').count(),1);
  await sr.locator('[data-sr=day][data-day="'+now.date+'"]').click();await teacher.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');await sr.locator('[data-sr=history]').first().click();await sr.locator('dialog').waitFor({state:'visible'});assert.match(await sr.locator('.sr-audit').textContent(),/confirm.*가상확인교사/);await sr.locator('[data-sr=closeDialog]').click();
  await teacher.screenshot({path:'test-results/studyroom/calendar-desktop.png',fullPage:true});await teacher.setViewportSize({width:390,height:844});assert(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await teacher.screenshot({path:'.impeccable/review/mobile.png',fullPage:true});
 });
 await step('administrator schedule and named staff forms are functional, preserve shared roster editing',async()=>{
  const manager=await ctx.newPage();await manager.goto(url+'/admin.html');await manager.locator('#password').fill('1234');await manager.locator('form[data-form=login] button').click();await manager.locator('[data-action=admin-tab][data-tab=studyroom]').click();const m=manager.locator('.studyroom');await manager.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');await m.locator('[data-sr=view][data-view=settings]').click();await m.locator('[data-sr-form=schedule]').waitFor();await manager.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');assert.equal(await m.locator('.sr-rule').count(),1);
  const f=m.locator('[data-sr-form=staff]');await f.locator('[name=username]').fill('second.teacher');await f.locator('[name=name]').fill('가상두번째교사');await f.locator('[name=password]').fill('두번째123456');await f.locator('button').click();await manager.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');assert.match(await m.locator('.sr-staff-list').textContent(),/가상두번째교사/);
  await m.locator('[data-sr-form=schedule] button:not([type=button])').click();await manager.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');assert.equal((await h.sql('SELECT count(*) n FROM sr_schedules')).results[0].n,2);
  await manager.screenshot({path:'test-results/studyroom/settings-desktop.png',fullPage:true});await manager.close();
 });
 await step('all browser windows can close before the server-side scheduled archive runs',async()=>{
  await ctx.close();const worker=await h.mf.getWorker();await worker.scheduled({scheduledTime:new Date(now.date+'T23:59:01+09:00'),cron:'* * * * *'});assert.equal((await h.sql('SELECT count(*) n FROM sr_archives')).results[0].n,1);assert.equal((await h.sql("SELECT count(*) n FROM sr_sessions WHERE status='closed'")).results[0].n,1);assert.equal((await h.sql('SELECT count(*) n FROM sr_attendance')).results[0].n,1);
 });
 assert.deepEqual(errors,[]);await writeFile('test-results/studyroom/browser.json',JSON.stringify({environment:'local Miniflare + real D1 SQLite + headless Edge; synthetic data only',steps,errors},null,2));
}finally{if(browser)await browser.close();await h.close();}
