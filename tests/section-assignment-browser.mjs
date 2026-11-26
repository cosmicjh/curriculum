import {clickMenu} from './navigation-helper.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import '../scripts/build.mjs';

const scope={};runInNewContext(await readFile('assets/xlsx.full.min.js','utf8'),scope);
const {XLSX}=scope,workbook=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
  ['학번','이름','신규 가상 과목'],[30101,'가상학생하나',1],[30102,'가상학생둘',1]
]),'3학년');
const bytes=Buffer.from(XLSX.write(workbook,{type:'array',bookType:'xlsx'}));
const h=await harness({course:true});
let browser;
try{
  const admin=await h.login('admin'),anonymous=await h.api('student',{studentNumber:'30101'});
  assert.equal(anonymous.status,401);
  assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
  const course=(path,method='GET',data={})=>h.api('courseWorkspace',{role:'admin',path,method,data},admin.cookie);
  const base=await h.listen();
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:960}}),requests=[],errors=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  page.on('pageerror',error=>errors.push(error.message));
  const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false');
  async function login(role,password='1234'){
    await page.locator('#login-role').selectOption(role);
    if(role==='student'){assert(await page.locator('#password').isHidden());await page.locator('#login-student-number').fill('30101');}
    else await page.locator('#password').fill(password);
    await page.getByRole('button',{name:'로그인',exact:true}).click();
    await idle();
  }
  async function logout(){
    await page.getByRole('button',{name:'로그아웃',exact:true}).click();
    await idle();
    assert.equal(await page.locator('#login-role').inputValue(),'student');
    assert(await page.locator('#sidebar').isHidden());
  }
  await mkdir('test-results',{recursive:true});
  await page.goto(base);await idle();
  await page.screenshot({path:'test-results/role-login-desktop.png',fullPage:true});
  assert(await page.locator('#sidebar').isHidden());
  await login('student');
  await page.locator('#student-number').fill('30101');
  await page.locator('form[data-form=student] button').click();await page.locator('.tt').waitFor();
  assert.equal(await page.getByText('분반배정',{exact:true}).count(),0);
  await logout();
  await login('teacher');await page.locator('[data-action=teacher-tab]').first().waitFor({state:'attached'});
  assert.equal(await page.getByText('분반배정',{exact:true}).count(),0);
  await logout();
  assert(!requests.some(url=>url.includes('/section-assignment/')));
  await page.goto(base+'/section-assignment/view.html');
  assert(await page.locator('#access').isVisible());assert(await page.locator('main').isHidden());
  await page.goto(base);await idle();
  const initialTermGate=Promise.withResolvers();
  const delayInitialTerm=async route=>{
    const request=route.request().postDataJSON();
    if(request.path==='/term'&&request.method==='GET')await initialTermGate.promise;
    await route.continue();
  };
  await page.route('**/api/courseWorkspace',delayInitialTerm);
  await login('admin');
  assert.deepEqual((await page.locator('.admin-nav button').allTextContents()).slice(0,2),['학생 시간표','분반배정']);
  const loginPerf=await page.evaluate(()=>TIMETABLE_PERF.find(entry=>entry.action==='login'));
  assert(!requests.includes('/api/adminBootstrap'));
  const frame=page.frameLocator('#section-assignment-pane iframe');
  const target=frame.locator('#targetTerm'),platform=frame.locator('#assignmentPlatformTerm');
  const waitForTerm=(label)=>target.filter({hasText:label}).waitFor();
  const switchButton=frame.getByRole('button',{name:'학기 전환',exact:true});
  const switchDialog=frame.getByRole('dialog',{name:'학기 전환'});
  const preview=frame.locator('#previewStudentsBtn'),counts=frame.locator('#courseCountsBtn'),send=frame.locator('#sendHoursBtn');
  const loadWorkbook=()=>frame.locator('#fileInput').setInputFiles({name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
  async function switchAssignment(year,semester,screenshot){
    await switchButton.click();
    await switchDialog.getByLabel('학년도').fill(year);
    await switchDialog.getByLabel('학기',{exact:true}).selectOption(semester);
    if(screenshot)await page.screenshot({path:'test-results/section-term-'+screenshot+'.png'});
    await switchDialog.getByRole('button',{name:'전환',exact:true}).click();
    await switchDialog.waitFor({state:'hidden'});
    assert.equal(await target.textContent(),year+'학년도 '+semester+'학기');
  }
  try{
    await waitForTerm('학기 확인 중…');
    assert(await frame.locator('#fileSelectBtn').isEnabled());
    assert(await switchButton.isDisabled());
    await clickMenu(page,page.locator('.admin-nav [data-tab=studentTimetable]'));await idle();
    await page.locator('#student-number').waitFor();
    await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
    assert(!requests.includes('/assets/xlsx.full.min.js'));
    await loadWorkbook();
    await frame.locator('#optSearchMode').selectOption('fast');
    await frame.locator('#runBtn').click();
    await frame.locator('#hoursExportCard').waitFor();
    assert(await frame.locator('#hoursExportBtn').isEnabled());
    for(const control of [switchButton,counts,send,preview])assert(await control.isDisabled());
  }finally{initialTermGate.resolve();}
  await waitForTerm('2026학년도 1학기');
  await page.unroute('**/api/courseWorkspace',delayInitialTerm);
  assert(await counts.isEnabled());assert(await send.isEnabled());assert(await preview.isDisabled());
  console.log('PASS a slow term lookup leaves admin navigation, file selection and calculation usable');
  assert(await platform.isVisible());assert.equal(await platform.textContent(),'통합시간표 2026-2');
  await page.screenshot({path:'test-results/section-assignment-desktop.png',fullPage:true});
  await switchAssignment('2026','2','desktop');
  assert(await platform.isHidden());
  console.log('PASS section assignment defaults to allocation term and shows only a differing operating term');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/section-assignment-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await frame.locator('#runBtn').evaluate(button=>button.addEventListener('click',()=>{
    button.dataset.termSwitchLocked=String(document.getElementById('termSwitchBtn').disabled);
  },{once:true}));
  await frame.locator('#runBtn').click();
  await frame.locator('#hoursExportCard').waitFor();
  assert.equal(await frame.locator('#runBtn').getAttribute('data-term-switch-locked'),'true');
  await switchButton.waitFor();
  assert(await switchButton.isEnabled());
  assert.equal(await frame.locator('#statUnassigned').textContent(),'0');
  assert(requests.includes('/section-assignment/worker.js'));
  const download=page.waitForEvent('download');
  await frame.locator('#downloadBtn').click();
  assert((await download).suggestedFilename().endsWith('.xlsx'));
  await frame.locator('#previewStudentsBtn').click();
  await page.locator('[data-assignment-preview] [data-action=commit-import]').click();
  await idle();
  const detail=await h.api('adminStudent',{id:'student-one'},admin.cookie);
  assert(detail.data.student.choices['신규 가상 과목']);
  assert.equal(detail.data.student.note,'가상 자료');
  assert((await course('/term','POST',{term:'2026-2'})).ok);
  await frame.locator('#sendHoursBtn').click();
  const hours=page.frameLocator('#course-pane iframe');
  await hours.locator('.hours-import-dialog').waitFor();
  assert.match(await hours.locator('.hours-import-dialog').textContent(),/신규 가상 과목/);
  await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
  await switchAssignment('2027','1','mobile');
  await clickMenu(page,page.locator('.admin-nav [data-tab=studentTimetable]'));await idle();
  await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
  assert.equal(await target.textContent(),'2027학년도 1학기');
  assert(await platform.isVisible());
  assert(await preview.isDisabled());
  assert.match(await frame.locator('#studentPreviewStatus').textContent(),/통합시간표 운영 학기에서만/);
  console.log('PASS selected section assignment term persists across menus and restricts student preview');
  const countsRequest=page.waitForRequest('**/api/courseTransfer');
  await frame.locator('#courseCountsBtn').click();
  assert.equal((await countsRequest).postDataJSON().term,'2027-1');
  await frame.getByText('2027-1에 전달된 시수배당 확정 분반이 없습니다.',{exact:true}).waitFor();

  let permitStage;
  const pendingStage=new Promise(resolve=>{permitStage=resolve;});
  await page.route('**/api/stageToolTransfer',async route=>{
    await pendingStage;
    await route.continue();
  },{times:1});
  const stageRequest=page.waitForRequest('**/api/stageToolTransfer');
  await frame.locator('#sendHoursBtn').click();
  try{
    const sent=(await stageRequest).postDataJSON();
    assert.equal(sent.term,'2027-1');assert.equal(sent.expectedTerm,'2026-2');
    assert(await switchButton.isDisabled());
  }finally{permitStage();}
  await page.getByText('2027-1 학기로 전환한 뒤 서버 분반배정을 불러오세요.',{exact:true}).waitFor();
  assert.equal((await h.api('bootstrap')).data.term,'2026-2');
  assert((await course('/term','POST',{term:'2027-1'})).ok);
  const future=await course('/assignment-hours');
  assert.equal(future.data.term,'2027-1');
  assert.equal(future.data.data.sheets[0].courses[0].name,'신규 가상 과목');
  assert((await course('/term','POST',{term:'2026-2'})).ok);
  console.log('PASS section assignment uses the selected term for counts and hours, and locks switching while working');
  await page.reload();await idle();
  await waitForTerm('2026학년도 2학기');
  assert.equal(await target.textContent(),'2026학년도 2학기');
  await clickMenu(page,page.locator('.admin-nav [data-tab=hours]'));
  await hours.getByRole('button',{name:'서버 분반배정',exact:true}).click();
  await hours.locator('.hours-import-dialog').waitFor();
  assert.match(await hours.locator('.hours-import-dialog').textContent(),/신규 가상 과목/);
  await clickMenu(page,page.locator('.admin-nav [data-tab=students]'));await idle();
  await page.getByRole('button',{name:'서버 분반배정',exact:true}).click();
  await page.locator('[data-assignment-preview]').waitFor();
  await page.locator('#modal [data-action=close-modal]').click();
  await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();
  await page.getByText('새 학기 만들기',{exact:true}).click();
  await page.locator('#create-year').fill('2028');
  await page.locator('#create-semester').selectOption('1');
  await page.screenshot({path:'test-results/term-create-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'학기 생성',exact:true}).click();await idle();
  assert.match(await page.locator('#header .term-label').textContent(),/2026학년도 2학기/);
  assert.equal(await page.locator('#switch-term').inputValue(),'2028-1',await page.locator('#toast').textContent());
  await page.locator('#switch-term').selectOption('2027-1');
  await page.getByRole('button',{name:'학기 전환',exact:true}).click();await idle();
  assert.match(await page.locator('#header .term-label').textContent(),/2027학년도 1학기/);
  assert.equal((await h.api('toolTransfer',{kind:'students'},admin.cookie)).data,null);
  await page.locator('#switch-term').selectOption('2026-2');
  await page.getByRole('button',{name:'학기 전환',exact:true}).click();await idle();
  assert((await h.api('toolTransfer',{kind:'students'},admin.cookie)).data);
  const student=await h.login('student');
  assert.equal((await h.api('teacherBootstrap',{},student.cookie)).status,401);
  assert.equal((await h.api('adminBootstrap',{},student.cookie)).status,401);
  assert.equal(await page.getByRole('button',{name:'학생 비밀번호 변경',exact:true}).count(),0);
  await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
  await switchAssignment('2027','1');
  await logout();await login('admin');
  await waitForTerm('2026학년도 2학기');
  assert.equal(await target.textContent(),'2026학년도 2학기');
  assert((await course('/term','POST',{term:'2027-1'})).ok);
  const unavailableTerm=route=>{
    const request=route.request().postDataJSON();
    return request.path==='/term'&&request.method==='GET'
      ?route.fulfill({status:503,json:{ok:false,code:'allocation_unavailable',error:'가상 이관 상태'}})
      :route.continue();
  };
  await page.route('**/api/courseWorkspace',unavailableTerm);
  await page.reload();await idle();await waitForTerm('2026학년도 2학기');
  assert.equal(await target.textContent(),'2026학년도 2학기');
  assert(await platform.isHidden());
  console.log('PASS section assignment resets on refresh and logout and falls back for unavailable allocation');
  await page.unroute('**/api/courseWorkspace',unavailableTerm);

  const moduleGate=Promise.withResolvers();
  const moduleStarted=page.waitForRequest(request=>new URL(request.url()).pathname==='/section-assignment/app.js');
  await page.route('**/section-assignment/app.js?*',async route=>{
    await moduleGate.promise;
    await route.continue();
  },{times:1});
  try{
    await page.reload({waitUntil:'domcontentloaded'});await idle();
    await moduleStarted;
    await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();
    await page.locator('#switch-term').selectOption('2027-1');
    await page.getByRole('button',{name:'학기 전환',exact:true}).click();await idle();
    await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
    assert.match(await page.locator('#header .term-label').textContent(),/2027학년도 1학기/);
  }finally{moduleGate.resolve();}
  await waitForTerm('2027학년도 1학기');assert(await platform.isHidden());
  await loadWorkbook();
  await frame.locator('#optSearchMode').selectOption('fast');
  await frame.locator('#runBtn').click();
  await frame.locator('#hoursExportCard').waitFor();assert(await preview.isEnabled());
  await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();
  await page.locator('#switch-term').selectOption('2026-2');
  await page.getByRole('button',{name:'학기 전환',exact:true}).click();await idle();
  await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
  assert.equal(await platform.textContent(),'통합시간표 2026-2');
  assert(await platform.isVisible());assert(await preview.isDisabled());
  console.log('PASS delayed section assignment mount and later displays use the latest operating term');

  await page.route('**/api/courseWorkspace',route=>{
    const request=route.request().postDataJSON();
    return request.path==='/term'&&request.method==='GET'
      ?route.fulfill({status:401,json:{ok:false,code:'AUTH_REQUIRED',error:'가상 세션 만료'}})
      :route.continue();
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('가상 세션 만료',{exact:true}).waitFor();
  assert.equal(await page.locator('#login-role').inputValue(),'admin');
  assert(await page.locator('#sidebar').isHidden());
  assert.equal(await page.locator('#section-assignment-pane iframe').count(),0);
  console.log('PASS section assignment term authentication failure reopens the shared login');
  await login('student');
  assert(await page.locator('#student-number').isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS section assignment, role login/logout, passwordless student login and transfer',loginPerf);
}finally{await browser?.close();await h.close();}
