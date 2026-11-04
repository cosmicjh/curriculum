import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {backup,allocationFixture} from './fixture.mjs';
import '../scripts/build.mjs';
const h=await harness(),admin=await h.login();assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);const testBoard=allocationFixture();testBoard.rooms.unshift(...Array.from({length:20},(_,i)=>({id:'extra-'+i,label:'가상실 '+i,classNum:''})));assert((await h.mutation('saveAllocation',{board:testBoard},admin.cookie)).ok);
const base=await h.listen();let browser;const errors=[],steps=[];await mkdir('test-results',{recursive:true});
const step=async(name,fn)=>{await fn();steps.push(name);console.log('PASS '+name);};
try{
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});const context=await browser.newContext({viewport:{width:1365,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false'),login=async(role)=>{await page.goto(base+'/'+role+'.html');await idle();await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await page.locator('[data-tab=allocation]').waitFor();await idle();await page.locator('[data-tab=allocation]').click();await page.locator('.allocation-table').waitFor();await idle();};
 await step('admin edits a room without losing the draft when switching tabs',async()=>{
  await login('admin');await page.locator('[data-alloc=cell][data-room=r1]').click();const scrollBefore=await page.locator('.allocation-scroll').evaluate(el=>el.scrollLeft);assert(scrollBefore>0);assert(await page.getByRole('dialog',{name:'3학년 A · 새 과학실'}).isVisible());await page.locator('#allocation-teachers').fill('가상교사, 협력교사');await page.locator('.allocation-dialog button[type=submit]').click();assert(await page.getByText('저장하지 않은 변경',{exact:true}).isVisible());assert.equal(await page.locator('.allocation-scroll').evaluate(el=>el.scrollLeft),scrollBefore);assert.equal(await page.evaluate(()=>document.activeElement.dataset.room),'r1');assert.match(await page.locator('[data-alloc=cell][data-room=r1]').getAttribute('aria-label'),/가상과학.*협력교사/);
  await page.locator('[data-alloc=cell][data-room=r2]').click();await page.locator('.allocation-dialog button[type=submit]').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.room),'r2');await page.locator('[data-tab=students]').click();await idle();await page.locator('[data-tab=allocation]').click();await page.getByText('저장하지 않은 변경',{exact:true}).waitFor();assert.match(await page.locator('[data-alloc=cell][data-room=r1]').textContent(),/협력교사/);
  await page.locator('[data-alloc=rooms]').click();await page.locator('#room-label-20').fill('새 실험실');await page.locator('.allocation-dialog button[type=submit]').click();await page.locator('[data-alloc=save]').click();await page.getByText('저장됨',{exact:true}).waitFor();assert.match(await page.locator('.allocation-table').textContent(),/새 실험실/);
 });
 await step('teacher reads and filters the board without any editing control and sees the shared room',async()=>{
  await page.locator('[data-action=logout]').click();await idle();await login('teacher');assert.equal(await page.locator('[data-alloc=save],[data-alloc=cell],[data-alloc=rooms]').count(),0);await page.locator('#allocation-query').fill('협력교사');assert.equal(await page.locator('.allocation-table tbody td').count(),1);await page.locator('#allocation-query').fill('없는과목');assert(await page.getByText('검색 결과가 없습니다.').isVisible());await page.locator('#allocation-query').fill('');
  await page.screenshot({path:'test-results/allocation-desktop.png',fullPage:true});await page.locator('[data-tab=timetable]').click();await page.locator('#teacher-name').fill('가상교사');await page.locator('form[data-form=teacher] button').click();await idle();assert.match(await page.locator('.tt').textContent(),/새 실험실/);
 });
 await step('mobile board stays within the viewport, selected room remains readable, and all grades print',async()=>{
  await page.setViewportSize({width:390,height:844});await page.locator('[data-tab=allocation]').click();await page.locator('.allocation-table').waitFor();await idle();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#allocation-room').selectOption('r1');assert.equal(await page.locator('.allocation-table thead th').count(),2);await page.screenshot({path:'test-results/allocation-mobile.png',fullPage:true});
  await page.evaluate(()=>window.print=()=>{window.allocationPrint=document.querySelector('#print-root').textContent;});await page.locator('[data-alloc=print]').click();await page.waitForFunction(()=>window.allocationPrint);assert.match(await page.evaluate(()=>window.allocationPrint),/새 실험실/);assert.equal(await page.locator('#print-root .allocation-table thead th').count(),23);await page.emulateMedia({media:'print'});await page.setViewportSize({width:1587,height:1122});await page.screenshot({path:'test-results/allocation-print.png',fullPage:true});
 });
 assert.deepEqual(errors,[]);await writeFile('test-results/allocation-browser.json',JSON.stringify({steps,errors},null,2));
}finally{await browser?.close();await h.close();}
