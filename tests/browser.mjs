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
 const waitForFocus=locator=>locator.and(page.locator(':focus')).waitFor({timeout:3000});
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
 await step('admin student deletion confirms by keyboard, preserves cancel drafts, filters and page at 390px',async()=>{
  const name='가상삭제'+('A'.repeat(65));
  const students=Array.from({length:52},(_,i)=>({
   grade:'3',classNum:'9',number:String(i+1),name:i===51?name:'가상삭제 '+(i+1),
   choices:i===51?{가상과학:'A1',가상언어:'B1'}:{}
  }));
  const seeded=await h.mutation('commitImport',{payload:{format:'timetable-import',students}},admin.cookie);
  assert(seeded.ok,JSON.stringify(seeded));
  await button('refresh-admin').click();await idle();
  const opener=button('open-student-delete'),modal=page.locator('#modal');
  await button('new-student').click();await idle();
  assert.equal(await modal.locator('h2').textContent(),'학생 추가');
  assert.equal(await opener.count(),0);
  await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});

  await page.setViewportSize({width:390,height:844});
  const filters={'filter-grade':'3','filter-class':'9','filter-status':'재학','filter-search':'가상삭제'};
  for(const id of ['filter-grade','filter-class','filter-status'])await page.locator('#'+id).selectOption(filters[id]);
  await page.locator('#filter-search').fill(filters['filter-search']);
  await button('student-page').filter({hasText:'다음'}).click();
  const pager=page.locator('#student-table .pager div small'),row=button('edit-student').filter({hasText:name});
  assert.equal(await pager.textContent(),'2 / 2');
  assert.equal(await opener.count(),0);
  await row.getByRole('button').press('Enter');await idle();
  assert.equal(await modal.locator('h2').textContent(),'학생 수정');
  assert.equal(await opener.count(),1);
  await page.locator('#edit-name').fill('미저장 이름');

  let requests=0;
  const countRequest=request=>{if(new URL(request.url()).pathname==='/api/deleteStudent')requests++;};
  page.on('request',countRequest);
  const confirmation=page.getByRole('dialog',{name:'학생 삭제'}),cancel=button('cancel-student-delete'),remove=button('delete-student');
  await opener.press('Enter');await confirmation.waitFor();
  assert.equal(await confirmation.locator('p').textContent(),'30952 '+name+' · 재학 · 수강 2과목');
  await waitForFocus(cancel);
  assert(await confirmation.evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().width<=innerWidth&&document.documentElement.scrollWidth<=innerWidth));
  for(const control of [opener,cancel,remove])assert(await control.evaluate(el=>{
   const style=getComputedStyle(el);
   return el.getBoundingClientRect().height>=44&&style.borderTopWidth==='0px'&&style.backgroundColor==='rgba(0, 0, 0, 0)';
  }));
  await confirmation.screenshot({path:'test-results/student-delete-mobile.png'});
  await page.keyboard.press('Enter');await confirmation.waitFor({state:'hidden'});
  await waitForFocus(opener);assert(await modal.isVisible());
  assert.equal(await page.locator('#edit-name').inputValue(),'미저장 이름');
  assert.match(await row.textContent(),new RegExp(name));
  assert.equal(requests,0);
  await page.keyboard.press('Enter');await confirmation.waitFor();
  await page.keyboard.press('Escape');await confirmation.waitFor({state:'hidden'});
  await waitForFocus(opener);assert.equal(requests,0);

  await page.keyboard.press('Enter');await confirmation.waitFor();
  await page.keyboard.press('Tab');await waitForFocus(remove);
  await page.keyboard.press('Enter');await modal.waitFor({state:'hidden'});await idle();
  assert.equal(requests,1);page.off('request',countRequest);
  assert.equal(await row.count(),0);
  assert.equal(await pager.textContent(),'2 / 2');
  assert.equal(await button('edit-student').count(),1);
  for(const [id,value] of Object.entries(filters))assert.equal(await page.locator('#'+id).inputValue(),value);
  await waitForFocus(page.locator('#filter-search'));
  assert.equal(await page.locator('#toast').textContent(),'삭제했습니다.');
  await page.setViewportSize({width:1440,height:1000});
 });
 await step('student deletion refreshes concurrent additions and class filters on the current page',async()=>{
  const filter=page.locator('#filter-class'),pager=page.locator('#student-table .pager div small');
  const target=button('edit-student').filter({hasText:'가상삭제 51'});
  const sameClass=button('edit-student').filter({hasText:'가상삭제 53'});
  const newClass=button('edit-student').filter({hasText:'가상삭제 새학급'});
  assert.equal(await pager.textContent(),'2 / 2');
  assert.equal(await sameClass.count(),0);
  assert.equal(await filter.locator('option[value="8"]').count(),0);
  for(const [classNum,number,name] of [['9','53','가상삭제 53'],['8','1','가상삭제 새학급']]){
   const added=await h.mutation('saveStudent',{student:{grade:'3',classNum,number,name,status:'재학',choices:{}}},admin.cookie);
   assert(added.ok,JSON.stringify(added));
  }
  await target.getByRole('button').press('Enter');await idle();
  await button('open-student-delete').press('Enter');
  const deleted=page.waitForResponse('**/api/deleteStudent');
  await button('delete-student').press('Enter');assert.equal((await deleted).status(),200);await idle();
  assert.equal(await target.count(),0);
  assert(await sameClass.isVisible());
  assert.equal(await pager.textContent(),'2 / 2');
  for(const [id,value] of Object.entries({'filter-grade':'3','filter-class':'9','filter-status':'재학','filter-search':'가상삭제'})){
   assert.equal(await page.locator('#'+id).inputValue(),value);
  }
  await filter.selectOption('8');
  assert(await newClass.isVisible());
  await newClass.getByRole('button').press('Enter');await idle();
  await button('open-student-delete').press('Enter');
  await button('delete-student').press('Enter');await idle();
  assert.equal(await newClass.count(),0);
  assert.equal(await filter.inputValue(),'8');
  assert.equal(await pager.textContent(),'1 / 1');
  await filter.selectOption('9');
  await button('student-page').filter({hasText:'다음'}).click();
 });
 await step('student deletion recovers committed writes after 400, 409 and lost responses',async()=>{
  const cases=[
   [54,400,'REQUEST_ERROR'],
   [55,409,'SAVED_REFRESH_REQUIRED'],
   [56,0,'NETWORK_ERROR'],
   [57,0,'NETWORK_ERROR',true]
  ];
  const student=(number,name)=>({grade:'3',classNum:'9',number:String(number),name,status:'재학',choices:{}});
  for(const [number] of cases){
   const added=await h.mutation('saveStudent',{student:student(number,'가상삭제 '+number)},admin.cookie);
   assert(added.ok,JSON.stringify(added));
  }
  await button('refresh-admin').click();await idle();
  assert.equal(await page.locator('#student-table .pager div small').textContent(),'2 / 2');
  let requests=0;
  const countRequest=request=>{if(request.url().endsWith('/api/deleteStudent'))requests++;};
  page.on('request',countRequest);
  for(const [index,[number,status,code,refreshFails]] of cases.entries()){
   const row=button('edit-student').filter({hasText:'가상삭제 '+number});
   await row.getByRole('button').press('Enter');await idle();
   await button('open-student-delete').press('Enter');
   let committedStatus,addition;
   await page.route('**/api/deleteStudent',async route=>{
    const committed=await route.fetch();
    committedStatus=committed.status();
    if(code==='SAVED_REFRESH_REQUIRED'){
     addition=await h.mutation('saveStudent',{student:student(58,'가상삭제 58')},admin.cookie);
    }
    if(status)await route.fulfill({status,json:{ok:false,code,error:'시험 응답 실패'}});
    else await route.abort('failed');
   },{times:1});
   const probe=page.waitForResponse(response=>response.url().endsWith('/api/adminStudent')&&response.status()===404);
   let bootstrap;
   if(refreshFails)await page.route('**/api/adminBootstrap',route=>route.abort('failed'),{times:1});
   else bootstrap=page.waitForResponse('**/api/adminBootstrap');
   await button('delete-student').press('Enter');
   assert.equal((await (await probe).json()).code,'NOT_FOUND');
   if(bootstrap)assert.equal((await bootstrap).status(),200);
   await page.locator('#modal').waitFor({state:'hidden'});await idle();
   assert.equal(committedStatus,200);
   assert.equal(requests,index+1);
   assert.equal(await row.count(),0);
   assert.equal(await button('delete-student').count(),0);
   if(code==='SAVED_REFRESH_REQUIRED'){
    assert(addition.ok,JSON.stringify(addition));
    assert(await button('edit-student').filter({hasText:'가상삭제 58'}).isVisible());
   }
   assert.equal(await page.locator('#student-table .pager div small').textContent(),'2 / 2');
   for(const [id,value] of Object.entries({'filter-grade':'3','filter-class':'9','filter-status':'재학','filter-search':'가상삭제'})){
    assert.equal(await page.locator('#'+id).inputValue(),value);
   }
   await waitForFocus(page.locator('#filter-search'));
   assert.equal(await page.locator('#toast').textContent(),refreshFails?'삭제했습니다. 학생 목록을 새로고침해 주세요.':'삭제했습니다.');
   if(refreshFails){await button('refresh-admin').click();await idle();}
  }
  page.off('request',countRequest);
 });
 await step('student deletion preserves a real conflict and shows an unverified result at 390x240',async()=>{
  await page.setViewportSize({width:390,height:240});
  const row=button('edit-student').filter({hasText:'가상삭제 53'});
  await row.getByRole('button').press('Enter');await idle();
  await page.locator('#edit-name').fill('삭제 오류 시 보존할 입력');
  await button('open-student-delete').press('Enter');
  const confirmation=page.getByRole('dialog',{name:'학생 삭제'}),alert=confirmation.getByRole('alert');
  assert.equal(await alert.count(),0);
  const id=await row.getAttribute('data-id');
  const {student}=(await h.api('adminStudent',{id},admin.cookie)).data;
  const saved=await h.mutation('saveStudent',{student:{...student,note:'다른 관리자의 수정'}},admin.cookie);
  assert(saved.ok,JSON.stringify(saved));
  const conflict=page.waitForResponse('**/api/deleteStudent'),probe=page.waitForResponse('**/api/adminStudent');
  await button('delete-student').press('Enter');await idle();
  assert.equal((await conflict).status(),409);
  assert.equal((await (await conflict).json()).code,'CONFLICT');
  assert.equal((await probe).status(),200);
  async function alertFits(){
   await waitForFocus(alert);
   return alert.evaluate(el=>{
    const bounds=el.getBoundingClientRect(),dialog=el.closest('dialog').getBoundingClientRect();
    return bounds.top>=Math.max(0,dialog.top)&&bounds.bottom<=Math.min(innerHeight,dialog.bottom)&&bounds.right<=innerWidth;
   });
  }
  assert.match(await alert.textContent(),/자료가 변경되었습니다. 학생 목록을 새로고침한 뒤 다시 열어 주세요/);
  assert(await alertFits());
  await page.screenshot({path:'test-results/student-delete-error-mobile.png'});
  for(const [status,code,message] of [[404,'NOT_FOUND','학생 정보가 없습니다.'],[0,'NETWORK_ERROR','서버에 연결하지 못했습니다.']]){
   await page.route('**/api/deleteStudent',route=>status?route.fulfill({status,json:{ok:false,code,error:message}}):route.abort('failed'),{times:1});
   await button('delete-student').press('Enter');await idle();
   assert((await alert.textContent()).includes(message));
   if(status)assert.match(await alert.textContent(),/학생 목록을 새로고침한 뒤 다시 열어 주세요/);
   assert(await alertFits());
  }
  await page.route('**/api/deleteStudent',route=>route.abort('failed'),{times:1});
  await page.route('**/api/adminStudent',route=>route.abort('failed'),{times:1});
  await button('delete-student').press('Enter');await idle();
  assert.equal(await alert.textContent(),'삭제 결과를 확인하지 못했습니다. 학생 목록을 새로고침해 주세요.');
  assert(await alertFits());
  assert(await button('delete-student').isHidden());
  await button('cancel-student-delete').press('Enter');await confirmation.waitFor({state:'hidden'});
  await waitForFocus(button('open-student-delete'));
  assert.equal(await page.locator('#edit-name').inputValue(),'삭제 오류 시 보존할 입력');
  assert.equal(await row.count(),1);
  await page.keyboard.press('Escape');await page.locator('#modal').waitFor({state:'hidden'});
  await page.setViewportSize({width:1440,height:1000});
 });
 await step('closing student edit by Escape or Cancel restores focus to the name button',async()=>{
  const row=button('edit-student').filter({hasText:'가상삭제 53'}),name=row.getByRole('button');
  const modal=page.locator('#modal');
  for(const close of [()=>page.keyboard.press('Escape'),()=>modal.getByRole('button',{name:'취소',exact:true}).press('Enter')]){
   await name.press('Enter');await modal.waitFor();await idle();
   await close();await modal.waitFor({state:'hidden'});
   await waitForFocus(name);
  }
  const id=await row.getAttribute('data-id');
  await name.evaluate(el=>el.remove());
  await page.locator(`[data-action="edit-student"][data-id="${id}"] td`).first().click();await idle();
  await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
  await button('refresh-admin').click();await idle();
  assert(await name.isVisible());
 });
 await step('student deletion reloads a changed operating term and retains the previous draft',async()=>{
  const row=button('edit-student').filter({hasText:'가상삭제 53'});
  const id=await row.getAttribute('data-id');
  await row.getByRole('button').press('Enter');await idle();
  await page.locator('#edit-name').fill('이전 학기에서 보존할 입력');
  assert((await h.mutation('switchTerm',{term:'2026-1'},admin.cookie)).ok);
  await button('open-student-delete').press('Enter');
  const changed=page.waitForResponse('**/api/deleteStudent');
  await button('delete-student').press('Enter');await idle();
  assert.equal((await changed).status(),409);
  assert.equal((await (await changed).json()).code,'TERM_CHANGED');
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await button('delete-student').count(),0);
  assert.equal(await row.count(),0);
  assert.equal(await page.locator('.school-heading .term-label').textContent(),'2026학년도 1학기');
  assert((await h.mutation('switchTerm',{term:'2026-2'},admin.cookie)).ok);
  assert.equal((await h.api('adminStudent',{id},admin.cookie)).status,200);
  await button('refresh-admin').click();await idle();
  await page.locator('#filter-search').fill('가상삭제 53');
  await row.getByRole('button').press('Enter');await idle();
  assert.equal(await page.locator('#edit-name').inputValue(),'이전 학기에서 보존할 입력');
  await page.keyboard.press('Escape');await page.locator('#modal').waitFor({state:'hidden'});
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
