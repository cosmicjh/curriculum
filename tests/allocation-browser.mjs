import {clickMenu} from './navigation-helper.mjs';
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
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false');
 async function openAllocation(){
  await clickMenu(page,page.locator('[data-tab=allocation]'));
  await page.locator('.allocation-table').waitFor();await idle();
  const stylesheet=page.locator('link[rel=stylesheet][href^="assets/allocation-roster.css"]');
  assert(await stylesheet.evaluate(link=>link.sheet?.cssRules.length>0));
 }
 async function login(role,path=role+'.html'){
  await page.goto(base+'/'+path);await idle();
  await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();
  await page.locator('[data-tab=allocation]').waitFor({state:'attached'});await idle();
  await openAllocation();
 }
 async function assertAllocationPaper(paper){
  const rule=await page.evaluate(()=>{
   const name=getComputedStyle(document.documentElement).page;
   const style=document.querySelector('link[href^="assets/allocation-roster.css"]');
   const rules=[...style.sheet.cssRules].filter(r=>r instanceof CSSMediaRule&&matchMedia(r.conditionText).matches)
    .flatMap(r=>[...r.cssRules]).filter(r=>r instanceof CSSPageRule&&r.selectorText===name);
   return {name,sizes:rules.map(r=>r.style.getPropertyValue('size').toLowerCase()),margins:rules.map(r=>r.style.margin)};
  });
  assert.deepEqual(rule,{name:'allocation-'+paper.toLowerCase(),sizes:[paper.toLowerCase()+' landscape'],margins:['6mm']});
 }
 await step('administrator menus keep the same navigation and content frame',async()=>{
  await login('admin');let frame;
  assert.equal(await page.locator('.admin-nav [data-tab=links]').count(),0);
  assert.deepEqual(await page.locator('.admin-nav').locator('button,a').allTextContents(),['학생 시간표','분반배정','학생','시수배당표','시간표','이동수업 배치표','결보강','설정']);
  for(const tab of ['students','allocation','settings','sections','imports']){
   await clickMenu(page,page.locator('[data-action=admin-tab][data-tab='+tab+']'));await idle();
   const current=await page.locator('#admin-content').evaluate(el=>{const content=el.getBoundingClientRect(),nav=document.querySelector('.admin-nav').getBoundingClientRect();return [content.x,content.y,content.width,nav.x,nav.y];});
   assert.deepEqual(await page.locator('.school-heading').locator('.school-name,.term-label').allTextContents(),['첨단고등학교','2026학년도 2학기']);
   frame??=current;assert.deepEqual(current,frame,tab);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(['sections','settings'].includes(tab))await page.screenshot({path:'test-results/workspace-admin-'+tab+'.png',fullPage:true});
  }
  await clickMenu(page,page.locator('[data-tab=allocation]'));await idle();await page.screenshot({path:'test-results/workspace-admin-allocation.png',fullPage:true});
 });
 await step('admin opens the worksheet in the current tab and keeps it mounted across tools',async()=>{
  await clickMenu(page,page.locator('.admin-nav [data-tab=hours]'));await idle();
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
  await clickMenu(page,page.locator('[data-tab=students]'));await idle();
  assert(await page.locator('#course-pane').isHidden());
  await clickMenu(page,page.locator('[data-tab=hours]'));await idle();
  assert.equal(await workbook.locator('#school-form input[name=name]').inputValue(),'가상 작성 중');
  assert.equal(page.url(),initialUrl);
  await clickMenu(page,page.locator('[data-tab=allocation]'));await idle();
 });
 await step('admin edits a room without losing the draft when switching tabs',async()=>{
  assert.equal(await page.locator('#allocation-room').count(),0);await page.locator('#allocation-query').fill('가상과학');assert.equal(await page.locator('.allocation-table td.allocation-match').count(),2);assert.equal(await page.locator('.allocation-table thead th').count(),23);await page.locator('#allocation-query').fill('');
  assert.equal(await page.locator('#allocation-grade').count(),0);assert.equal(await page.locator('tbody[data-allocation-grade]').count(),2);assert.equal(await page.locator('tr[data-allocation-block]').count(),17);assert(await page.locator('.allocation-table strong').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=12));assert(await page.locator('.allocation-teachers').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=11));await page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="3"]').click();const scrollBefore=await page.locator('.allocation-scroll').evaluate(el=>el.scrollLeft);assert.equal(scrollBefore,0);assert(await page.locator('.allocation-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.equal(await page.locator('.allocation-table thead th').count(),23);assert(await page.getByRole('dialog',{name:'3학년 A · 새 과학실'}).isVisible());await page.locator('#allocation-teachers').fill('가상교사, 협력교사');await page.locator('.allocation-dialog button[type=submit]').click();assert(await page.getByText('저장하지 않은 변경',{exact:true}).isVisible());assert.equal(await page.locator('.allocation-scroll').evaluate(el=>el.scrollLeft),scrollBefore);assert.equal(await page.evaluate(()=>document.activeElement.dataset.room),'r1');assert.match(await page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="3"]').getAttribute('aria-label'),/가상과학.*협력교사/);
  await page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="2"]').click();await page.locator('#allocation-teachers').fill('2학년확인교사');await page.locator('.allocation-dialog button[type=submit]').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.grade),'2');await page.locator('[data-alloc=cell][data-room=r2][data-code=A][data-grade="3"]').click();await page.locator('.allocation-dialog button[type=submit]').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.room),'r2');await clickMenu(page,page.locator('[data-tab=students]'));await idle();await clickMenu(page,page.locator('[data-tab=allocation]'));await page.getByText('저장하지 않은 변경',{exact:true}).waitFor();assert.match(await page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="3"]').textContent(),/협력교사/);
  await page.locator('[data-alloc=rooms]').click();await page.locator('#room-label-20').fill('새 실험실');await page.locator('#room-teacher-3-20').fill('3학년담임수정');await page.locator('#room-teacher-2-20').fill('2학년담임수정');await page.locator('.allocation-dialog button[type=submit]').click();const from=actions.length;await page.locator('[data-alloc=save]').click();await page.getByText('저장됨',{exact:true}).waitFor();assert.deepEqual(actions.slice(from),['saveAllocation']);assert.match(await page.locator('.allocation-table').textContent(),/새 실험실/);const saved=(await h.api('allocation',{},admin.cookie)).data.board;assert.equal(saved.grades.find(g=>g.grade==='3').homerooms.r1,'3학년담임수정');assert.equal(saved.grades.find(g=>g.grade==='2').homerooms.r1,'2학년담임수정');assert.deepEqual(saved.grades.find(g=>g.grade==='2').blocks[0].cells.r1.teachers,['2학년확인교사']);await page.locator('[data-alloc=block][data-grade="2"][data-code=A]').click();assert(await page.getByRole('dialog',{name:'2학년 시간블록 수정'}).isVisible());await page.locator('[data-cancel]').first().click();await page.locator('[data-alloc=block]:not([data-code])').click();await page.locator('#allocation-edit-grade').selectOption('2');assert.equal(await page.locator('#allocation-edit-grade').inputValue(),'2');await page.locator('[data-cancel]').first().click();
 });
 await step('admin sees saved counts and opens the existing cell editor',async()=>{
  const cell=page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="3"]');
  const count=cell.locator('.allocation-teachers + .allocation-count');
  assert.equal(await count.textContent(),'1명');
  assert.equal(await count.evaluate(el=>getComputedStyle(el).display),'block');
  assert.equal(await cell.locator('button').count(),0);
  await cell.click();
  const editor=page.getByRole('dialog',{name:'3학년 A · 새 실험실'});
  assert(await editor.isVisible());
  await editor.getByRole('button',{name:'닫기'}).click();
 });
 await step('compact save preserves a student changed by another administrator and refreshes the list',async()=>{
  const old=(await h.api('adminStudent',{id:'student-one'},admin.cookie)).data.student;assert((await h.mutation('saveStudent',{student:{...old,note:'다른 관리자 수정 보존'}},admin.cookie)).ok);
  await page.locator('[data-alloc=refresh]').click();await page.getByText('저장됨',{exact:true}).waitFor();await page.locator('[data-alloc=rooms]').click();await page.locator('#room-teacher-3-20').fill('새 담임');await page.locator('.allocation-dialog button[type=submit]').click();await page.locator('[data-alloc=save]').click();await page.getByText('저장됨',{exact:true}).waitFor();
  await clickMenu(page,page.locator('[data-tab=students]'));await idle();assert.match(await page.locator('#student-table').textContent(),/다른 관리자 수정 보존/);await clickMenu(page,page.locator('[data-tab=allocation]'));await idle();
 });
 await step('teacher highlights lessons without changing the grid or exposing editing controls and sees the shared room',async()=>{
  await page.locator('[data-action=logout]').click();await idle();await login('teacher');await clickMenu(page,page.locator('.tabs [data-tab=hours]'));await page.locator('#modal').getByText('관리자 설정에서 시수배당표 사용을 허용한 뒤 열 수 있습니다.').waitFor();await page.locator('#modal [data-action=close-modal]').last().click();assert(await page.locator('#course-pane').isHidden());assert.equal(await page.locator('[data-alloc=save],[data-alloc=cell],[data-alloc=rooms]').count(),0);assert.equal(await page.locator('#allocation-room').count(),0);const cells=page.locator('.allocation-table tr[data-allocation-block] td'),count=await cells.count();await page.locator('#allocation-query').fill('협력교사');assert.equal(await cells.count(),count);assert.equal(await cells.and(page.locator('.allocation-match')).count(),1);assert.equal(await page.locator('.allocation-table thead .allocation-match').textContent(),'새 실험실');assert.equal(await page.locator('.allocation-table tbody th.allocation-match').count(),1);assert.equal(await page.locator('.allocation-table tbody th.allocation-match').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(230, 230, 230)');await page.screenshot({path:'test-results/allocation-search.png',fullPage:true});await page.locator('#allocation-query').fill('없는과목');assert.equal(await page.locator('.allocation-match').count(),0);assert.equal(await cells.count(),count);await page.locator('#allocation-query').fill('');
  await page.screenshot({path:'test-results/allocation-desktop.png',fullPage:true});await clickMenu(page,page.locator('[data-tab=timetable]'));await page.locator('#teacher-name').fill('가상교사');await page.locator('form[data-form=teacher] button').click();await idle();assert.match(await page.locator('.tt').textContent(),/새 실험실/);
 });
 await step('teacher opens the elective roster from its count-bearing cell',async()=>{
  await clickMenu(page,page.locator('[data-tab=allocation]'));
  const button=page.getByRole('button',{name:'3학년 가상과학 A1 명렬표 열기'});
  await button.waitFor();
  const count=button.locator('xpath=ancestor::td').locator('.allocation-teachers + .allocation-count');
  assert(await count.isVisible());
  assert.equal(await count.textContent(),'1명');
  await button.click();
  const roster=page.getByRole('dialog').filter({has:page.locator('.roster-header h2')});
  await roster.waitFor();
  assert.match(await roster.locator('h2').textContent(),/가상과학.*A1.*1명/);
  assert.equal(await count.textContent(),(await roster.locator('.roster-table tbody tr').count())+'명');
  await roster.getByRole('button',{name:'닫기'}).click();
  const student=(await h.api('adminStudent',{id:'student-one'},admin.cookie)).data.student;
  const refresh=page.locator('[data-alloc=refresh]');
  assert((await h.mutation('saveStudent',{student:{...student,status:'전출'}},admin.cookie)).ok);
  await refresh.click();
  await count.filter({hasText:/^0명$/}).waitFor();
  await button.press('Enter');
  await roster.getByText('A1 · 0명',{exact:true}).waitFor();
  assert.equal(await roster.locator('.roster-table tbody tr').count(),0);
  await roster.getByRole('button',{name:'닫기'}).click();
  assert((await h.mutation('saveStudent',{student},admin.cookie)).ok);
  await refresh.click();
  await count.filter({hasText:/^1명$/}).waitFor();
 });
 await step('opening a roster updates stale allocation counts without a manual refresh',async()=>{
  const button=page.getByRole('button',{name:'3학년 가상과학 A1 명렬표 열기'});
  const count=button.locator('xpath=ancestor::td').locator('.allocation-count');
  const roster=page.locator('#modal[open] .roster-header');
  const student=(await h.api('adminStudent',{id:'student-one'},admin.cookie)).data.student;
  for(const [status,total] of [['전출',0],['재학',1]]){
   assert((await h.mutation('saveStudent',{student:{...student,status}},admin.cookie)).ok);
   assert.equal(await count.textContent(),(1-total)+'명');
   await button.click();
   await roster.getByText('A1 · '+total+'명',{exact:true}).waitFor();
   assert.equal(await count.textContent(),total+'명');
   assert.equal(await page.locator('#modal .roster-table tbody tr').count(),total);
   await roster.getByRole('button',{name:'닫기'}).click();
  }
 });
 await step('closing a roster restores keyboard focus to its replacement section button',async()=>{
  const sectionId='section-two';
  const selector='[data-alloc=roster][data-section="'+sectionId+'"]';
  const button=page.locator(selector),original=await button.elementHandle();
  const student=(await h.api('adminStudent',{id:'student-two'},admin.cookie)).data.student;
  assert((await h.mutation('saveStudent',{student:{...student,status:'전출'}},admin.cookie)).ok);
  await button.press('Enter');
  await page.locator('#modal[open] .roster-header').getByText('A2 · 0명',{exact:true}).waitFor();
  await idle();
  assert.equal(await original.evaluate(el=>el.isConnected),false);
  await page.keyboard.press('Escape');
  await page.locator(selector+':focus').waitFor();
  assert.equal(await page.locator('#modal[open]').count(),0);
  assert((await h.mutation('saveStudent',{student},admin.cookie)).ok);
  await page.locator('[data-alloc=refresh]').click();
  await button.locator('xpath=ancestor::td').getByText('1명',{exact:true}).waitFor();
 });
 await step('mobile search preserves all rooms and all grades print counts',async()=>{
  await page.setViewportSize({width:390,height:844});await clickMenu(page,page.locator('[data-tab=allocation]'));await page.locator('.allocation-table').waitFor();await idle();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#allocation-query').fill('협력교사');assert.equal(await page.locator('.allocation-table thead th').count(),23);
  assert.equal(await page.locator('.allocation-subject').first().evaluate(el=>getComputedStyle(el).minHeight),'44px');
  assert((await page.locator('.allocation-consigned').boundingBox()).height>=44);
  assert(await page.locator('.school-heading').evaluate(el=>{
   const title=el.firstElementChild.getBoundingClientRect(),term=el.lastElementChild.getBoundingClientRect(),header=el.closest('header').getBoundingClientRect();
   return title.top>=header.top&&title.bottom<=term.top+1&&term.bottom<=header.bottom;
  }),'the program title and term fit the mobile header without overlap');
  await page.screenshot({path:'test-results/allocation-mobile.png',fullPage:true});
  await page.evaluate(()=>window.print=()=>{window.allocationPrint=document.querySelector('#print-root').textContent;});
  for(const paper of ['A3','A4']){
   await page.locator('#allocation-paper').selectOption(paper);await page.locator('[data-alloc=print]').click();await page.waitForFunction(()=>window.allocationPrint);
   assert.match(await page.evaluate(()=>window.allocationPrint),/새 실험실/);assert.match(await page.evaluate(()=>window.allocationPrint),/2학년/);assert.match(await page.evaluate(()=>window.allocationPrint),/3학년/);
   assert.equal(await page.locator('#print-root .allocation-print-table').count(),1);assert.equal(await page.locator('#print-root .allocation-print-grade').count(),2);assert.equal(await page.locator('#print-root .allocation-print-table tbody tr:not(.allocation-print-grade)').count(),17);
   const printed=page.locator('#print-root td').filter({has:page.getByText('가상과학 A1',{exact:true})});
   const printedCount=printed.locator('.allocation-print-teachers + .allocation-print-count');
   assert.equal(await printedCount.textContent(),'1명');
   assert.equal(await printedCount.evaluate(el=>getComputedStyle(el).display),'block');
   assert((await page.locator('#print-root .allocation-print-count').allTextContents()).includes('0명'));
   await page.emulateMedia({media:'print'});
   await assertAllocationPaper(paper);
   const pdf=await page.pdf({path:'test-results/allocation-'+paper+'.pdf',preferCSSPageSize:true,printBackground:true}),raw=pdf.toString('latin1'),box=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(raw);assert.equal((raw.match(/\/Type\s*\/Page\b/g)||[]).length,1,paper+' must be one page');assert(box);const [width,height]=paper==='A3'?[1191,842]:[842,595];assert(Math.abs(Number(box[1])-width)<1&&Math.abs(Number(box[2])-height)<1,paper+' landscape size');
   assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).page),'auto');
   await page.emulateMedia({media:null});
   await page.evaluate(()=>{window.allocationPrint='';});
  }

 });
 await step('a delayed successful roster is discarded after a hash navigation',async()=>{
  await page.setViewportSize({width:1920,height:1080});
  await page.evaluate(()=>{
   const modal=document.querySelector('#modal'),open=modal.showModal;
   window.openedLateRoster=false;
   modal.showModal=function(){
    if(this.querySelector('.roster-table tbody tr'))window.openedLateRoster=true;
    return open.call(this);
   };
  });
  const gate=Promise.withResolvers(),captured=Promise.withResolvers(),endpoint='**/api/roster';
  await page.route(endpoint,async route=>{
   const response=route.fetch();
   captured.resolve(response);
   await gate.promise;
   await route.fulfill({response:await response});
  },{times:1});
  try{
   await page.getByRole('button',{name:'3학년 가상과학 A1 명렬표 열기'}).click();
   const response=await captured.promise;
   assert.equal((await response.json()).data.students.length,1);
   assert(await page.locator('[data-action=logout]').isDisabled());
   await page.evaluate(()=>{location.hash='#/home';});
   const delivered=page.waitForResponse(endpoint);
   gate.resolve();
   await delivered;
   await page.locator('form[data-form=login]').waitFor();
   await idle();
   assert.equal(await page.locator('#modal[open],#modal .roster-table tbody tr').count(),0);
   assert.equal(await page.evaluate(()=>window.openedLateRoster),false);
  }finally{gate.resolve();}
 });
 await step('a roster request sent after logout returns to login without student rows',async()=>{
  await page.goto(base+'/teacher.html');
  await clickMenu(page,page.locator('[data-tab=allocation]'));
  await idle();
  const gate=Promise.withResolvers(),captured=Promise.withResolvers(),endpoint='**/api/roster';
  await page.route(endpoint,async route=>{
   captured.resolve();
   await gate.promise;
   await route.continue();
  },{times:1});
  try{
   await page.getByRole('button',{name:'3학년 가상과학 A1 명렬표 열기'}).click();
   await captured.promise;
   assert(await page.locator('[data-action=logout]').isDisabled());
   const logout=await context.request.post(base+'/api/logout',{headers:{Origin:base},data:{}});
   assert((await logout.json()).ok);
   const delivered=page.waitForResponse(endpoint);
   gate.resolve();
   assert.equal((await delivered).status(),401);
   await page.locator('form[data-form=login]').waitFor();
   await idle();
   assert.equal(await page.locator('#modal[open],#modal .roster-table tbody tr').count(),0);
  }finally{gate.resolve();}
 });
 await step('the index admin route loads allocation styles and keeps editing at the cell level',async()=>{
  await login('admin','index.html#/admin');
  const cell=page.locator('[data-alloc=cell][data-room=r1][data-code=A][data-grade="3"]');
  assert.equal(await cell.locator('.allocation-count').evaluate(el=>getComputedStyle(el).display),'block');
  await cell.click();await page.locator('.allocation-dialog[open]').waitFor();
  await page.keyboard.press('Escape');await page.locator('.allocation-dialog').waitFor({state:'detached'});
  await page.locator('[data-action=logout]').click();await idle();
 });
 await step('the index teacher route wraps a long subject like the original plain title at FHD',async()=>{
  await page.setViewportSize({width:1920,height:1080});
  await login('teacher','index.html#/teacher');
  await page.evaluate(()=>document.fonts.ready);
  const subject=page.locator('.allocation-subject').filter({hasText:'기후변화와 지속가능한 세계'}).first();
  const layout=await subject.evaluate(button=>{
   const title=button.parentElement;
   const lines=node=>{
    const range=document.createRange();range.selectNodeContents(node);
    return range.getClientRects().length;
   };
   const display=getComputedStyle(button).display;
   const codeWrap=getComputedStyle(button.querySelector('span')).whiteSpace;
   const buttonLines=lines(button.firstChild);
   title.replaceChildren(...[...button.childNodes].map(node=>node.cloneNode(true)));
   const plainLines=lines(title.firstChild);
   title.replaceChildren(button);
   return {display,codeWrap,buttonLines,plainLines};
  });
  assert.equal(layout.display,'block');
  assert.equal(layout.codeWrap,'nowrap');
  assert(layout.plainLines>1,'the long subject exercises wrapping');
  assert.equal(layout.buttonLines,layout.plainLines);
  await page.screenshot({path:'test-results/allocation-index-teacher-fhd.png'});
  await page.goto(base+'/student.html#/teacher');await idle();
  await openAllocation();
 });
 const student=(await h.api('adminStudent',{id:'student-one'},admin.cookie)).data.student;
 const changeNote=async note=>assert((await h.mutation('saveStudent',{student:{...student,note}},admin.cookie)).ok);
 await changeNote('위탁');
 for(const role of ['admin','teacher'])await step(role+' filters allocation counts and remembers the checkbox after reload',async()=>{
  await page.locator('[data-action=logout]').click();await idle();
  await login(role,'index.html#/'+role);
  const checkbox=page.getByRole('checkbox',{name:'위탁학생 제외'});
  const count=page.locator('tbody[data-allocation-grade="3"] tr[data-allocation-block="A"] td')
   .filter({hasText:'가상과학 A1'}).locator('.allocation-count');
  const printCount=async(expected,selector='[data-alloc=print]')=>{
   await page.evaluate(()=>{window.consignedPrinted=false;window.print=()=>{window.consignedPrinted=true;};});
   await page.locator(selector).click();
   await page.waitForFunction(()=>window.consignedPrinted);
   const printRoot=page.locator('#print-root');
   if(selector==='[data-alloc=print]'){
    const printed=printRoot.locator('td').filter({has:page.getByText('가상과학 A1',{exact:true})});
    assert.equal(await printed.locator('.allocation-print-count').textContent(),expected);
   }else{
    const students=printRoot.locator('.roster-table tbody tr');
    assert.equal(await students.count(),1);
    assert.match(await students.textContent(),/위탁/);
   }
   await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
  };
  assert.equal(await checkbox.isChecked(),false);
  assert.equal(await count.textContent(),'1명');
  assert((await page.locator('.allocation-consigned').boundingBox()).height>=32);
  await checkbox.press('Space');
  assert(await checkbox.isChecked());
  assert.equal(await page.locator('#allocation-exclude-consigned:focus').count(),1);
  assert.equal(await count.textContent(),'0명');
  await printCount('0명');
  await page.reload();
  await idle();await openAllocation();
  assert(await checkbox.isChecked());
  assert.equal(await count.textContent(),'0명');
  if(role==='teacher'){
   const button=page.getByRole('button',{name:'3학년 가상과학 A1 명렬표 열기'});
   const dialog=page.locator('#modal[open]');
   await button.click();
   await dialog.getByText('A1 · 1명',{exact:true}).waitFor();
   assert.match(await dialog.locator('.roster-table tbody tr').textContent(),/위탁/);
   await printCount('1명','[data-action=print-roster]');
   await dialog.getByRole('button',{name:'닫기'}).click();
   await changeNote('위탁교육');
   await button.click();
   await dialog.getByText('A1 · 1명',{exact:true}).waitFor();
   assert.equal(await count.textContent(),'1명');
   await dialog.getByRole('button',{name:'닫기'}).click();
   assert.equal(await button.evaluate(el=>el===document.activeElement),true);
   await changeNote('위탁');
   await button.press('Enter');
   await dialog.getByText('A1 · 1명',{exact:true}).waitFor();
   assert.equal(await count.textContent(),'0명');
   await dialog.getByRole('button',{name:'닫기'}).click();
  }
  await page.getByText('위탁학생 제외',{exact:true}).click();
  assert.equal(await checkbox.isChecked(),false);
  assert.equal(await count.textContent(),'1명');
  await printCount('1명');
 });
 await step('allocation filtering still works when local storage rejects reads and writes',async()=>{
  await page.addInitScript(()=>{
   for(const method of ['getItem','setItem']){
    const original=Storage.prototype[method];
    Storage.prototype[method]=function(key,...args){
     if(key==='timetable.allocation.excludeConsigned')throw new DOMException('Storage unavailable','SecurityError');
     return original.call(this,key,...args);
    };
   }
  });
  await page.reload();
  await idle();await openAllocation();
  const checkbox=page.getByRole('checkbox',{name:'위탁학생 제외'});
  const count=page.getByRole('button',{name:'3학년 가상과학 A1 명렬표 열기'})
   .locator('xpath=ancestor::td').locator('.allocation-count');
  assert.equal(await checkbox.isChecked(),false);
  await checkbox.press('Space');
  assert(await checkbox.isChecked());
  assert.equal(await count.textContent(),'0명');
  await checkbox.press('Space');
  assert.equal(await count.textContent(),'1명');
 });
 await changeNote(student.note);
 for(const scenario of [
  {name:'at-length-limit',blocks:20,teachers:Array.from({length:3},(_,i)=>'합성교사'.repeat(20).slice(0,78)+'0'+i)},
  {name:'dense',blocks:12,teachers:['합성교사가','합성교사나','합성교사다']}
 ])await step(scenario.name+' allocation fits one landscape page on either paper size',async()=>{
  const roomLabels=[...Array.from({length:12},(_,i)=>(i+1)+'반'),'컴퓨터실(2층)','온라인학습실(5층)','매체수업실(3층)','음악실(5층)','시청각실(1층)','미술실1(4층)','미술실2(4층)','강당1','강당2','스터디룸(4층)'];
  const subjects=['기후변화와 지속가능한 세계','세계 문화와 영어','음악 감상과 비평'];
  const rooms=roomLabels.map((label,i)=>({id:'print-room-'+i,label,classNum:i<12?String(i+1):''}));
  const occupiedRooms=scenario.name==='dense'?rooms:rooms.slice(0,1);
  const sections=[],counts={};
  const grades=['3','2'].map(grade=>({
   grade,
   homerooms:Object.fromEntries(rooms.slice(0,12).map((room,i)=>[room.id,'가상담임'+grade+'-'+(i+1)])),
   blocks:Array.from({length:scenario.blocks},(_,i)=>{
    const code=String.fromCharCode(65+i);
    const cells=Object.fromEntries(occupiedRooms.map((room,j)=>{
     const sectionId=grade+'-'+code+'-'+j;
     sections.push({id:sectionId,grade,subject:subjects[j%subjects.length],code:code+(j+1)});
     counts[sectionId]=j===0?0:20+j;
     return [room.id,{sectionId,teachers:scenario.teachers.slice(0,j%2===0?3:2)}];
    }));
    const slot=i+Math.min(i,10);
    return {code,slots:available.slice(slot,slot+(i<10?2:1)),cells};
   })
  }));
  await page.route('**/api/allocation',async route=>{
   const response=await route.fetch();
   const result=await response.json();
   await route.fulfill({response,json:{...result,data:{...result.data,board:{rooms,grades},sections,counts}}});
  },{times:1});
  await page.locator('[data-alloc=refresh]').click();
  await page.waitForFunction(rows=>document.querySelectorAll('.allocation-table tr[data-allocation-block]').length===rows,scenario.blocks*2);
  const pageCounts=[],sheetWidths=[];
  for(const paper of ['A3','A4']){
   await page.evaluate(()=>{window.denseAllocationPrinted=false;window.print=()=>{window.denseAllocationPrinted=true;};});
   await page.locator('#allocation-paper').selectOption(paper);
   await page.locator('[data-alloc=print]').click();
   await page.waitForFunction(()=>window.denseAllocationPrinted);
   const table=page.locator('#print-root .allocation-print-table');
   assert.equal(await table.locator('tbody tr:not(.allocation-print-grade)').count(),scenario.blocks*2);
   assert.deepEqual(await table.locator('.allocation-print-count').allTextContents(),Object.values(counts).map(count=>count+'명'));
   await page.emulateMedia({media:'print'});
   await assertAllocationPaper(paper);
   sheetWidths.push(await table.evaluate(el=>el.getBoundingClientRect().width));
   const pdf=await page.pdf({path:'test-results/allocation-'+scenario.name+'-'+paper+'.pdf',preferCSSPageSize:true,printBackground:true});
   const raw=pdf.toString('latin1');
   pageCounts.push((raw.match(/\/Type\s*\/Page\b/g)||[]).length);
   const box=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(raw);
   const [width,height]=paper==='A3'?[1191,842]:[842,595];
   assert(box&&Math.abs(Number(box[1])-width)<1&&Math.abs(Number(box[2])-height)<1,paper+' landscape size');
   await page.emulateMedia({media:null});
  }
  assert.deepEqual(pageCounts,[1,1],scenario.name+' allocation PDF page counts for A3 and A4 landscape');
  assert(sheetWidths.every((width,i)=>width>=[408,285][i]*96/25.4*.95),scenario.name+' allocation uses the available landscape width');
 });
 await step('allocation print stops when no scale fits and can be retried',async()=>{
  const styleCount=await page.locator('head style').count();
  await page.evaluate(()=>{
   const measure=Element.prototype.getBoundingClientRect;
   window.printFitMeasurements=0;
   window.printCalls=0;
   window.print=()=>{window.printCalls++;};
   Element.prototype.getBoundingClientRect=function(){
    const rect=measure.call(this);
    if(!this.matches('.allocation-measure > .allocation-print'))return rect;
    if(++window.printFitMeasurements>32)throw Error('Print fit exceeded its measurement budget');
    return new DOMRect(rect.x,rect.y,rect.width,Infinity);
   };
   window.restorePrintMeasurement=()=>{Element.prototype.getBoundingClientRect=measure;};
  });
  try{
   await page.locator('[data-alloc=print]').click({timeout:5000});
   await page.locator('#toast').getByText('배치표를 선택한 용지 한 장에 맞출 수 없어 인쇄를 중단했습니다.').waitFor({timeout:5000});
   const {measurements,prints}=await page.evaluate(()=>({measurements:window.printFitMeasurements,prints:window.printCalls}));
   assert(measurements>0&&measurements<=32);
   assert.equal(prints,0);
   assert.equal(await page.locator('#print-root.allocation-measure,#print-root .allocation-print').count(),0);
   assert.equal(await page.locator('head style').count(),styleCount);
  }finally{
   await page.evaluate(()=>window.restorePrintMeasurement());
  }
  await page.locator('[data-alloc=print]').click();
  await page.waitForFunction(()=>window.printCalls===1,undefined,{timeout:5000});
 });
 assert.deepEqual(errors,[]);await writeFile('test-results/allocation-browser.json',JSON.stringify({steps,errors},null,2));
}finally{await browser?.close();await h.close();}
