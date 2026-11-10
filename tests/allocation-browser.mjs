import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {backup,allocationFixture} from './fixture.mjs';
import '../scripts/build.mjs';
const h=await harness({course:true}),admin=await h.login();assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);const testBoard=allocationFixture();testBoard.rooms.unshift(...Array.from({length:20},(_,i)=>({id:'extra-'+i,label:'가상실 '+i,classNum:''})));assert((await h.mutation('saveAllocation',{board:testBoard},admin.cookie)).ok);
const fullBoard=allocationFixture();fullBoard.rooms=testBoard.rooms;
const available=[];for(const d of ['월','화','수','목','금'])for(let period=1;period<=(d==='수'?6:7);period++)if(!(d==='월'&&period===1||d==='수'&&period>=5))available.push({day:d,period});
const first=fullBoard.grades[0].blocks[0],rest=available.filter(t=>!first.slots.some(s=>s.day===t.day&&s.period===t.period));let at=0;
fullBoard.grades[0].blocks.push(...Array.from({length:10},(_,i)=>({code:String.fromCharCode(66+i),slots:rest.slice(at,at+=(i<8?3:2)),cells:{}})));
fullBoard.grades.push({grade:'2',homerooms:{r2:'합성담임'},blocks:Array.from({length:6},(_,i)=>({code:String.fromCharCode(65+i),slots:available.slice(i*3,i*3+3),cells:{}}))});
for(const g of fullBoard.grades)for(const b of g.blocks){const rooms=[...fullBoard.rooms.slice(0,10),...fullBoard.rooms.slice(-2)];for(const [i,r] of rooms.entries())if(!b.cells[r.id]&&!(g.grade==='2'&&b.code==='F'&&i<6))b.cells[r.id]={subject:'기후변화와 지속가능한 세계',code:b.code+'_'+(i+1),teachers:['합성하나','합성둘','합성셋']};}
assert((await h.mutation('saveAllocation',{board:fullBoard},admin.cookie)).ok);
const base=await h.listen();let browser;const errors=[],steps=[],actions=[];await mkdir('test-results',{recursive:true});
const step=async(name,fn)=>{await fn();steps.push(name);console.log('PASS '+name);};
try{
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))actions.push(new URL(r.url()).pathname.slice(5));});
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false'),login=async(role)=>{await page.goto(base+'/'+role+'.html');await idle();await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await page.locator('[data-tab=allocation]').waitFor();await idle();await page.locator('[data-tab=allocation]').click();await page.locator('.allocation-table').waitFor();await idle();};
 await step('administrator menus keep the same navigation and content frame',async()=>{
  await login('admin');let frame;
  assert.equal(await page.locator('.admin-nav [data-tab=links]').count(),0);
  assert.deepEqual(await page.locator('.admin-nav').locator('button,a').allTextContents(),['분반배정','학생','시수배당표','이동수업 배치표','결보강','설정']);
  for(const tab of ['students','allocation','settings','sections','imports']){
   await page.locator('[data-action=admin-tab][data-tab='+tab+']').click();await idle();
   const current=await page.locator('#admin-content').evaluate(el=>{const content=el.getBoundingClientRect(),nav=document.querySelector('.admin-nav').getBoundingClientRect();return [content.x,content.y,content.width,nav.x,nav.y];});
   assert.deepEqual(await page.locator('.school-heading').locator('.brand,.term-label').allTextContents(),['첨단고등학교','2026학년도 2학기']);
   frame??=current;assert.deepEqual(current,frame,tab);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(['sections','settings'].includes(tab))await page.screenshot({path:'test-results/workspace-admin-'+tab+'.png',fullPage:true});
  }
  await page.locator('[data-tab=allocation]').click();await idle();await page.screenshot({path:'test-results/workspace-admin-allocation.png',fullPage:true});
 });
 await step('admin opens the worksheet in the current tab and keeps it mounted across tools',async()=>{
  await page.locator('.admin-nav [data-tab=hours]').click();await idle();
  const workbook=page.frameLocator('#course-pane iframe');
  await workbook.locator('.workbook').waitFor();
  await workbook.locator('body').evaluate(el=>{el.ownerDocument.defaultView.print=()=>{el.dataset.printed='true';};});
  await workbook.getByRole('button',{name:'양식 인쇄',exact:true}).click();
  await workbook.locator('body[data-printed=true]').waitFor();
  assert.equal(await workbook.locator('#print-root svg').count(),1);
  await workbook.getByRole('button',{name:'학교 설정',exact:true}).click();
  await workbook.locator('#school-form input[name=name]').fill('가상 작성 중');
  const initialUrl=page.url();assert.equal(context.pages().length,1);
  await page.screenshot({path:'test-results/course-desktop.png',fullPage:true});
  await page.locator('[data-tab=students]').click();await idle();
  assert(await page.locator('#course-pane').isHidden());
  await page.locator('[data-tab=hours]').click();await idle();
  assert.equal(await workbook.locator('#school-form input[name=name]').inputValue(),'가상 작성 중');
  assert.equal(page.url(),initialUrl);
  await page.locator('[data-tab=allocation]').click();await idle();
 });
 await step('admin edits a room without losing the draft when switching tabs',async()=>{
  assert.equal(await page.locator('#allocation-room').count(),0);await page.locator('#allocation-query').fill('가상과학');assert.equal(await page.locator('.allocation-table td.allocation-match').count(),2);assert.equal(await page.locator('.allocation-table thead th').count(),23);await page.locator('#allocation-query').fill('');
  assert.equal(await page.locator('#allocation-grade').count(),0);assert.equal(await page.locator('tbody[data-allocation-grade]').count(),2);assert.equal(await page.locator('tr[data-allocation-block]').count(),17);assert(await page.locator('.allocation-table strong').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=12));assert(await page.locator('.allocation-teachers').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=11));await page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="3"]').click();const scrollBefore=await page.locator('.allocation-scroll').evaluate(el=>el.scrollLeft);assert.equal(scrollBefore,0);assert(await page.locator('.allocation-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.equal(await page.locator('.allocation-table thead th').count(),23);assert(await page.getByRole('dialog',{name:'3학년 A · 새 과학실'}).isVisible());await page.locator('#allocation-teachers').fill('가상교사, 협력교사');await page.locator('.allocation-dialog button[type=submit]').click();assert(await page.getByText('저장하지 않은 변경',{exact:true}).isVisible());assert.equal(await page.locator('.allocation-scroll').evaluate(el=>el.scrollLeft),scrollBefore);assert.equal(await page.evaluate(()=>document.activeElement.dataset.room),'r1');assert.match(await page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="3"]').getAttribute('aria-label'),/가상과학.*협력교사/);
  await page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="2"]').click();await page.locator('#allocation-teachers').fill('2학년확인교사');await page.locator('.allocation-dialog button[type=submit]').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.grade),'2');await page.locator('[data-alloc=cell][data-room=r2][data-code=A][data-grade="3"]').click();await page.locator('.allocation-dialog button[type=submit]').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.room),'r2');await page.locator('[data-tab=students]').click();await idle();await page.locator('[data-tab=allocation]').click();await page.getByText('저장하지 않은 변경',{exact:true}).waitFor();assert.match(await page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="3"]').textContent(),/협력교사/);
  await page.locator('[data-alloc=rooms]').click();await page.locator('#room-label-20').fill('새 실험실');await page.locator('#room-teacher-3-20').fill('3학년담임수정');await page.locator('#room-teacher-2-20').fill('2학년담임수정');await page.locator('.allocation-dialog button[type=submit]').click();const from=actions.length;await page.locator('[data-alloc=save]').click();await page.getByText('저장됨',{exact:true}).waitFor();assert.deepEqual(actions.slice(from),['saveAllocation']);assert.match(await page.locator('.allocation-table').textContent(),/새 실험실/);const saved=(await h.api('allocation',{},admin.cookie)).data.board;assert.equal(saved.grades.find(g=>g.grade==='3').homerooms.r1,'3학년담임수정');assert.equal(saved.grades.find(g=>g.grade==='2').homerooms.r1,'2학년담임수정');assert.deepEqual(saved.grades.find(g=>g.grade==='2').blocks[0].cells.r1.teachers,['2학년확인교사']);await page.locator('[data-alloc=block][data-grade="2"][data-code=A]').click();assert(await page.getByRole('dialog',{name:'2학년 시간블록 수정'}).isVisible());await page.locator('[data-cancel]').first().click();await page.locator('[data-alloc=block]:not([data-code])').click();await page.locator('#allocation-edit-grade').selectOption('2');assert.equal(await page.locator('#allocation-edit-grade').inputValue(),'2');await page.locator('[data-cancel]').first().click();
 });
 await step('compact save preserves a student changed by another administrator and refreshes the list',async()=>{
  const old=(await h.api('adminStudent',{id:'student-one'},admin.cookie)).data.student;assert((await h.mutation('saveStudent',{student:{...old,note:'다른 관리자 수정 보존'}},admin.cookie)).ok);
  await page.locator('[data-alloc=refresh]').click();await page.getByText('저장됨',{exact:true}).waitFor();await page.locator('[data-alloc=rooms]').click();await page.locator('#room-teacher-3-20').fill('새 담임');await page.locator('.allocation-dialog button[type=submit]').click();await page.locator('[data-alloc=save]').click();await page.getByText('저장됨',{exact:true}).waitFor();
  await page.locator('[data-tab=students]').click();await idle();assert.match(await page.locator('#student-table').textContent(),/다른 관리자 수정 보존/);await page.locator('[data-tab=allocation]').click();await idle();
 });
 await step('teacher highlights lessons without changing the grid or exposing editing controls and sees the shared room',async()=>{
  await page.locator('[data-action=logout]').click();await idle();await login('teacher');await page.locator('.tabs [data-tab=hours]').click();await page.locator('#modal').getByText('관리자 설정에서 시수배당표 사용을 허용한 뒤 열 수 있습니다.').waitFor();await page.locator('#modal [data-action=close-modal]').last().click();assert(await page.locator('#course-pane').isHidden());assert.equal(await page.locator('[data-alloc=save],[data-alloc=cell],[data-alloc=rooms]').count(),0);assert.equal(await page.locator('#allocation-room').count(),0);const cells=page.locator('.allocation-table tr[data-allocation-block] td'),count=await cells.count();await page.locator('#allocation-query').fill('협력교사');assert.equal(await cells.count(),count);assert.equal(await cells.and(page.locator('.allocation-match')).count(),1);assert.equal(await page.locator('.allocation-table thead .allocation-match').textContent(),'새 실험실');assert.equal(await page.locator('.allocation-table tbody th.allocation-match').count(),1);assert.equal(await page.locator('.allocation-table tbody th.allocation-match').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(230, 230, 230)');await page.screenshot({path:'test-results/allocation-search.png',fullPage:true});await page.locator('#allocation-query').fill('없는과목');assert.equal(await page.locator('.allocation-match').count(),0);assert.equal(await cells.count(),count);await page.locator('#allocation-query').fill('');
  await page.screenshot({path:'test-results/allocation-desktop.png',fullPage:true});await page.locator('[data-tab=timetable]').click();await page.locator('#teacher-name').fill('가상교사');await page.locator('form[data-form=teacher] button').click();await idle();assert.match(await page.locator('.tt').textContent(),/새 실험실/);
 });
 await step('mobile search preserves all rooms and all grades print',async()=>{
  await page.setViewportSize({width:390,height:844});await page.locator('[data-tab=allocation]').click();await page.locator('.allocation-table').waitFor();await idle();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#allocation-query').fill('협력교사');assert.equal(await page.locator('.allocation-table thead th').count(),23);assert(await page.locator('.school-heading').evaluate(el=>el.firstElementChild.offsetTop===el.lastElementChild.offsetTop||Math.abs(el.firstElementChild.offsetTop-el.lastElementChild.offsetTop)<8));await page.screenshot({path:'test-results/allocation-mobile.png',fullPage:true});
  await page.evaluate(()=>window.print=()=>{window.allocationPrint=document.querySelector('#print-root').textContent;window.allocationPageStyle=Array.from(document.head.querySelectorAll('style')).at(-1).textContent;});
  for(const paper of ['A3','A4']){
   await page.locator('#allocation-paper').selectOption(paper);await page.locator('[data-alloc=print]').click();await page.waitForFunction(()=>window.allocationPrint);
   assert.match(await page.evaluate(()=>window.allocationPrint),/새 실험실/);assert.match(await page.evaluate(()=>window.allocationPrint),/2학년/);assert.match(await page.evaluate(()=>window.allocationPrint),/3학년/);
   assert.equal(await page.locator('#print-root .allocation-print-table').count(),1);assert.equal(await page.locator('#print-root .allocation-print-grade').count(),2);assert.equal(await page.locator('#print-root .allocation-print-table tbody tr:not(.allocation-print-grade)').count(),17);
   const style=await page.addStyleTag({content:await page.evaluate(()=>window.allocationPageStyle)});
   const pdf=await page.pdf({path:'test-results/allocation-'+paper+'.pdf',preferCSSPageSize:true,printBackground:true}),raw=pdf.toString('latin1'),box=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(raw);assert.equal((raw.match(/\/Type\s*\/Page\b/g)||[]).length,1,paper+' must be one page');assert(box);const [width,height]=paper==='A3'?[1191,842]:[842,595];assert(Math.abs(Number(box[1])-width)<1&&Math.abs(Number(box[2])-height)<1,paper+' landscape size');
   await style.evaluate(el=>el.remove());await page.evaluate(()=>{window.allocationPrint='';});
  }

 });
 assert.deepEqual(errors,[]);await writeFile('test-results/allocation-browser.json',JSON.stringify({steps,errors},null,2));
}finally{await browser?.close();await h.close();}
