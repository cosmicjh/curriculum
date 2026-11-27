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
  const hoursJson=frame.locator('#hoursExportBtn');
  async function downloadFrom(button,path){
    const pending=page.waitForEvent('download');
    await button.click();
    await (await pending).saveAs(path);
    return readFile(path);
  }
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
    assert(await hoursJson.isDisabled());
    assert(await frame.locator('#downloadBtn').isEnabled());
    for(const control of [switchButton,counts,send,preview])assert(await control.isDisabled());
  }finally{initialTermGate.resolve();}
  await waitForTerm('2026학년도 1학기');
  await page.unroute('**/api/courseWorkspace',delayInitialTerm);
  assert(await counts.isEnabled());assert(await send.isEnabled());assert(await preview.isEnabled());
  assert(await hoursJson.isEnabled());
  const resolvedHours=JSON.parse(await downloadFrom(hoursJson,'test-results/section-term-resolved.json'));
  assert.equal(resolvedHours.sheets[0].grade,3);
  assert.equal(await preview.textContent(),'학생 배정 저장');
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
  const sameYearRequest=page.waitForRequest('**/api/stageToolTransfer');
  await frame.locator('#sendHoursBtn').click();
  assert.equal((await sameYearRequest).postDataJSON().data.sheets[0].grade,3);
  const hours=page.frameLocator('#course-pane iframe');
  await hours.locator('.hours-import-dialog').waitFor();
  assert.match(await hours.locator('.hours-import-dialog').textContent(),/신규 가상 과목/);
  await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
  await switchAssignment('2027','1','mobile');
  await clickMenu(page,page.locator('.admin-nav [data-tab=studentTimetable]'));await idle();
  await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
  assert.equal(await target.textContent(),'2027학년도 1학기');
  assert(await platform.isVisible());
  assert(await preview.isEnabled());
  assert.equal(await preview.textContent(),'학생 배정 저장');
  console.log('PASS selected section assignment term persists across menus and offers student staging');
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
    assert.equal(sent.data.sheets[0].grade,null);
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
  assert(await platform.isVisible());assert(await preview.isEnabled());
  assert.equal(await preview.textContent(),'학생 배정 저장');
  console.log('PASS delayed section assignment mount and later displays use the latest operating term');

  const promotion=XLSX.utils.book_new(),courseName='가상 진급 선택',otherName='가상 다른 선택';
  XLSX.utils.book_append_sheet(promotion,XLSX.utils.aoa_to_sheet([
    ['학번','이름',courseName,otherName],
    ...Array.from({length:36},(_,i)=>[10101+i,`가상진급${i+1}`,1,0]),
    [10137,'가상별도',0,1]
  ]),'2학년');
  const xlsx=(book,name)=>({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(book,{type:'array',bookType:'xlsx'}))});
  await frame.locator('#fileInput').setInputFiles(xlsx(promotion,'promotion.xlsx'));
  await frame.getByText('2학년(학적 1학년)',{exact:true}).waitFor();
  const saveSettings=frame.locator('#saveSettingsBtn'),settingsFile=frame.locator('#settingsFile');
  const codes=frame.getByRole('textbox',{name:'2학년 분반 코드와 학점'});
  const priorSettings=await downloadFrom(saveSettings,'test-results/promotion-legacy-settings.json');
  const legacyConfig=JSON.parse(priorSettings);
  // HEAD에서 같은 2학년 시트의 학생 학년을 2로 읽어 계산한 값이다.
  assert.equal(legacyConfig.fingerprint,'1708:552582304:2586373628');
  assert.equal(legacyConfig.schema,3);
  await codes.fill('1A:3');await codes.press('Tab');
  await settingsFile.setInputFiles({name:'legacy-settings.json',mimeType:'application/json',buffer:priorSettings});
  await frame.getByText('✓ 설정을 복원했습니다. 배정을 다시 실행해 주세요.',{exact:true}).waitFor();
  assert.equal(await codes.inputValue(),legacyConfig.sheets[0].groups.map((code,i)=>code+':'+legacyConfig.sheets[0].groupCredits[i]).join(', '));
  console.log('PASS legacy grade inference fingerprint and settings restore independently of roster grade');
  const courseCount=frame.getByRole('spinbutton',{name:courseName+' 분반 수'});
  assert.equal(await courseCount.inputValue(),'2');
  const countTransfer={sections:[{grade:'2',subject:courseName,code:'A'},{grade:'1',subject:courseName,code:'A'},{grade:'1',subject:courseName,code:'B'}]};
  await h.sql('INSERT INTO course_transfers(term_id,content,saved_at) VALUES(?,?,?)','2027-1',JSON.stringify(countTransfer),new Date().toISOString());
  page.once('dialog',dialog=>dialog.accept());
  await counts.click();
  await frame.getByText('1개 과목의 분반 수를 불러왔습니다.',{exact:true}).waitFor();
  assert.equal(await courseCount.inputValue(),'1');
  assert.equal(await frame.locator('#optMax').inputValue(),'35');
  await frame.locator('#runBtn').click();
  await frame.locator('#hoursExportCard').waitFor();
  await frame.locator('.progress .warn').filter({hasText:/가상 진급 선택.*신청 36명.*1분반.*적용 정원 36명/}).waitFor();
  assert.equal(await frame.locator('#statUnassigned').textContent(),'0');
  const storedRequest=page.waitForRequest('**/api/stageToolTransfer');
  await preview.press('Enter');
  const stored=(await storedRequest).postDataJSON();
  assert.equal(stored.term,'2027-1');assert.equal(stored.expectedTerm,'2026-2');
  assert.equal(stored.kind,'students');assert.equal(stored.data[0].grade,'1');
  await frame.getByText('2027-1 학생 배정 37명 저장',{exact:true}).waitFor();
  assert(await page.locator('#modal').isHidden());
  assert.equal(await preview.evaluate(button=>button.getBoundingClientRect().height>=44),true);
  console.log('PASS promotion counts and future student staging use the target term at 390px');

  await codes.fill('1A:3');await codes.press('Tab');
  await frame.locator('#runBtn').click();
  await frame.locator('#hoursExportCard').waitFor();
  const [generated]=JSON.parse(await downloadFrom(hoursJson,'test-results/promotion-hours.json')).sheets;
  assert.equal(generated.grade,2);
  assert.deepEqual(generated.courses.map(c=>c.sections.map(s=>[s.sectionCode,s.timeBlock,s.capacity,s.studentCount])),[
    [['2A','2A',36,36]],[['2A','2A',35,1]]
  ]);
  const downloadXlsx=page.waitForEvent('download');
  await frame.locator('#downloadBtn').click();
  await (await downloadXlsx).saveAs('test-results/promotion-results.xlsx');
  const exported=XLSX.read(await readFile('test-results/promotion-results.xlsx'),{type:'array'});
  const roster=XLSX.utils.sheet_to_json(exported.Sheets['학생별 분반 명단'],{header:1});
  assert.equal(roster[1][2],2);assert.equal(roster[1][7],'1A');
  const capacities=XLSX.utils.sheet_to_json(exported.Sheets['코드별 시간표'],{header:1});
  assert.equal(capacities[0][8],'적용 정원');
  assert.deepEqual(Array.from(capacities.filter(row=>row[3]===courseName||row[3]===otherName),row=>[row[3],row[8]]).sort(),[[otherName,35],[courseName,36]].sort());

  const hoursRequest=page.waitForRequest('**/api/stageToolTransfer');
  await send.click();
  const sent=(await hoursRequest).postDataJSON();
  assert.equal(sent.data.sheets[0].grade,2);assert.equal(sent.data.sheets[0].courses[0].sections[0].sectionCode,'2A');
  await hours.locator('.hours-import-dialog').waitFor();
  const importGrade=hours.getByLabel('2학년 대상 학년');
  assert.equal(await importGrade.inputValue(),'2');
  await hours.getByLabel(courseName+' 교과군').fill('가상 진급 교과군');
  await hours.getByLabel(otherName+' 교과군').fill('가상 진급 교과군');
  await hours.locator('.hours-import-dialog').getByRole('button',{name:'미리보기',exact:true}).click();
  await hours.getByRole('heading',{name:'가져오기 미리보기'}).waitFor();
  await hours.getByText('2학년 '+courseName,{exact:true}).waitFor();
  await hours.getByRole('button',{name:'확인 후 적용',exact:true}).click();
  await hours.locator('.hours-import-pending').waitFor();
  console.log('PASS promoted hours with a grade prefix import at grade two and export per-section capacities');

  await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();
  await page.locator('#switch-term').selectOption('2027-1');
  await page.getByRole('button',{name:'학기 전환',exact:true}).click();await idle();
  const changed=await h.mutation('saveStudent',{student:{grade:'2',classNum:'7',number:'11',name:'가상진급1',status:'재학',choices:{}}},admin.cookie);
  assert(changed.ok,changed.error);
  await clickMenu(page,page.locator('.admin-nav [data-tab=students]'));await idle();
  const serverStudents=page.getByRole('button',{name:'서버 분반배정',exact:true});
  await serverStudents.press('Enter');
  const file=page.getByLabel('구학번 대응 파일');
  await file.waitFor();
  const previewMapping=page.getByRole('button',{name:'미리보기',exact:true});
  assert(await file.evaluate(el=>el===document.activeElement));
  await page.setViewportSize({width:1440,height:960});
  assert(await previewMapping.evaluate(button=>button.getBoundingClientRect().height>=32));
  await page.screenshot({path:'test-results/promotion-mapping-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert(await previewMapping.evaluate(button=>button.getBoundingClientRect().height>=44));
  await file.setInputFiles({name:'oversize.csv',mimeType:'text/csv',buffer:Buffer.alloc(5*1024*1024+1)});
  await previewMapping.press('Enter');
  await page.getByText('구학번 대응 파일은 5MB까지입니다.',{exact:true}).waitFor();
  const excessRows=Array.from({length:3001},(_,i)=>`${11000+i},${21000+i},가상학생${i}`);
  await file.setInputFiles({name:'excess.csv',mimeType:'text/csv',buffer:Buffer.from(['구학번,신학번,이름',...excessRows].join('\n'))});
  await previewMapping.press('Enter');
  await page.getByText('구학번 대응표는 3,000행까지입니다.',{exact:true}).waitFor();
  await file.setInputFiles({name:'duplicate.csv',mimeType:'text/csv',buffer:Buffer.from('구학번,신학번,이름\n10101,20711,가상진급1\n10102,20711,가상진급2')});
  await previewMapping.press('Enter');
  await page.getByText('구학번 또는 신학번이 중복됩니다.',{exact:true}).waitFor();
  const correspondence=XLSX.utils.book_new();
  const sparse=XLSX.utils.aoa_to_sheet([['구학번','학번','이름'],[10101,20711,'가상진급1']]);
  XLSX.utils.sheet_add_aoa(sparse,[[10102,20712,'가상진급2']],{origin:'A65001'});
  sparse['!ref']='A1:C120000';
  XLSX.utils.book_append_sheet(correspondence,sparse,'대응');
  await file.setInputFiles(xlsx(correspondence,'mapping.xlsx'));
  const previewRequest=page.waitForRequest('**/api/previewImport');
  await previewMapping.press('Enter');
  const ref=(await previewRequest).postDataJSON().transferRef;
  const previewDialog=page.locator('[data-assignment-preview]');
  await previewDialog.getByText('연결 제외 36명',{exact:true}).waitFor();
  await previewDialog.getByText('10102 가상진급2 · 명부 없음',{exact:true}).waitFor();
  await previewDialog.getByText('10103 가상진급3 · 대응 없음',{exact:true}).waitFor();
  assert.equal(ref.studentMapping.length,2);
  console.log('PASS mapping rejects file and row limits while reading sparse workbook values');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#modal').scrollWidth<=document.querySelector('#modal').clientWidth));
  await page.screenshot({path:'test-results/promotion-mapping-mobile.png'});
  const register=previewDialog.getByRole('button',{name:'등록',exact:true});
  assert.equal(await register.evaluate(button=>button.getBoundingClientRect().height>=44),true);
  const commitRequest=page.waitForRequest('**/api/commitImport');
  await register.press('Enter');await idle();
  assert.deepEqual((await commitRequest).postDataJSON().transferRef,ref);
  const promotedStudent=await h.api('adminStudent',{id:changed.data.result.id},admin.cookie);
  assert.equal(promotedStudent.data.student.choices[courseName],stored.data[0].choices[courseName]);
  console.log('PASS promoted student mapping file, exclusions and keyboard commit at 390px');

  await clickMenu(page,page.locator('.admin-nav [data-tab=settings]'));await idle();
  await page.locator('#switch-term').selectOption('2026-2');
  await page.getByRole('button',{name:'학기 전환',exact:true}).click();await idle();
  await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
  const coupled=XLSX.utils.book_new(),coupledName='1학년';
  const parents=['가상 집중','가상 소수'],common='가상 공통';
  XLSX.utils.book_append_sheet(coupled,XLSX.utils.aoa_to_sheet([
    ['학번','이름',...parents,common],
    ...Array.from({length:16},(_,i)=>[10101+i,`가상결합${i+1}`,Number(i<8),Number(i>=8),1])
  ]),coupledName);
  await frame.locator('#fileInput').setInputFiles(xlsx(coupled,'coupled.xlsx'));
  await frame.getByText('coupled.xlsx',{exact:true}).waitFor();
  const coupledSettings=JSON.parse(await downloadFrom(saveSettings,'test-results/promotion-coupled-settings.json'));
  Object.assign(coupledSettings.sheets[0],{
    groups:['1A'],groupCredits:[3],courses:{[parents[0]]:1,[parents[1]]:1,[common]:2},
    courseCredits:{[parents[0]]:2,[parents[1]]:2,[common]:1}
  });
  coupledSettings.creditPairs=parents.map(course2=>({sheetName:coupledName,course2,course1:common}));
  coupledSettings.bigsecEntries=[{sheetName:coupledName,course:common,maxParallel:2}];
  await settingsFile.setInputFiles({name:'coupled-settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(coupledSettings))});
  await frame.getByText('✓ 설정을 복원했습니다. 배정을 다시 실행해 주세요.',{exact:true}).waitFor();
  const coupledCodes=frame.getByRole('textbox',{name:coupledName+' 분반 코드와 학점'});
  assert.equal(await coupledCodes.inputValue(),'1A:3');
  await frame.locator('#runBtn').click();
  await frame.locator('#hoursExportCard').waitFor();
  const [coupledHours]=JSON.parse(await downloadFrom(hoursJson,'test-results/promotion-coupled-hours.json')).sheets;
  const coupledStage=page.waitForRequest('**/api/stageToolTransfer');
  await send.click();
  for(const sheet of [coupledHours,(await coupledStage).postDataJSON().data.sheets[0]]){
    const blocks=sheet.timeBlocks.map(block=>block.code),sections=sheet.courses.flatMap(c=>c.sections);
    assert.deepEqual(blocks,['2A']);
    assert.deepEqual(sheet.coupledCohorts.map(link=>link.sectionCode).sort(),['2A1','2A2']);
    assert(sections.some(section=>section.sectionCode==='2A2'));
    assert([...sections,...sheet.coupledCohorts].every(item=>blocks.includes(item.timeBlock)));
  }
  await hours.locator('.hours-import-dialog').waitFor();
  console.log('PASS promoted split and coupled hours references match exported time blocks');

  await clickMenu(page,page.locator('.admin-nav [data-tab=sectionAssignment]'));await idle();
  const unequal=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(unequal,XLSX.utils.aoa_to_sheet([
    ['학번','이름',...parents,common],
    ...Array.from({length:17},(_,i)=>[10101+i,`가상결합정원${i+1}`,Number(i<12),Number(i>=12),1])
  ]),coupledName);
  await frame.locator('#fileInput').setInputFiles(xlsx(unequal,'unequal.xlsx'));
  await frame.getByText('unequal.xlsx',{exact:true}).waitFor();
  const unequalSettings=JSON.parse(await downloadFrom(saveSettings,'test-results/promotion-unequal-settings.json'));
  Object.assign(unequalSettings.sheets[0],{
    groups:['1A'],groupCredits:[3],courses:{[parents[0]]:2,[parents[1]]:1,[common]:3},
    courseCredits:coupledSettings.sheets[0].courseCredits
  });
  unequalSettings.options.optMax='5';
  unequalSettings.creditPairs=coupledSettings.creditPairs;
  unequalSettings.bigsecEntries=[{sheetName:coupledName,course:common,maxParallel:3},{sheetName:coupledName,course:parents[0],maxParallel:2}];
  await settingsFile.setInputFiles({name:'unequal-settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(unequalSettings))});
  await frame.getByText('✓ 설정을 복원했습니다. 배정을 다시 실행해 주세요.',{exact:true}).waitFor();
  await frame.locator('#runBtn').click();
  await frame.locator('#hoursExportCard').waitFor();
  await frame.locator('.progress .warn').filter({hasText:/2\+1 결합.*가상 소수.*가상 공통.*적용 정원 5명으로 제한/}).waitFor();
  assert.equal(await frame.locator('#statUnassigned').textContent(),'0');
  const [unequalHours]=JSON.parse(await downloadFrom(hoursJson,'test-results/promotion-unequal-hours.json')).sheets;
  const smallParent=unequalHours.courses.find(c=>c.courseName===parents[1]).sections[0];
  const commonSections=unequalHours.courses.find(c=>c.courseName===common).sections;
  const partner=commonSections.find(s=>s.cohortId===smallParent.cohortId);
  assert.deepEqual(commonSections.map(s=>s.capacity).sort(),[5,6,6]);
  assert.equal(smallParent.capacity,5);
  assert.equal(partner.capacity,5);
  const unequalXlsx=await downloadFrom(frame.locator('#downloadBtn'),'test-results/promotion-unequal-results.xlsx');
  const unequalBook=XLSX.read(unequalXlsx,{type:'buffer'});
  const unequalRows=XLSX.utils.sheet_to_json(unequalBook.Sheets['코드별 시간표'],{header:1});
  const partnerRow=unequalRows.find(row=>row[3]===common&&row[5]===partner.sectionNumber);
  assert.deepEqual(Array.from(partnerRow.slice(6,9)),[5,'1A',5]);
  console.log('PASS coupled hours JSON and result workbook record the paired section capacity');

  const collision=XLSX.utils.book_new(),collisionCourses=['가상 앞블록','가상 뒷블록'];
  XLSX.utils.book_append_sheet(collision,XLSX.utils.aoa_to_sheet([
    ['학번','이름',...collisionCourses],[10101,'가상선택학생',1,1]
  ]),'1학년');
  await frame.locator('#fileInput').setInputFiles(xlsx(collision,'prefix-collision.xlsx'));
  await frame.getByText('prefix-collision.xlsx',{exact:true}).waitFor();
  const collisionCodes=frame.getByRole('textbox',{name:'1학년 분반 코드와 학점'});
  await collisionCodes.fill('1A:3, 2A:3');await collisionCodes.press('Tab');
  await frame.locator('#runBtn').click();
  await frame.locator('#hoursExportCard').waitFor();
  assert.equal(await frame.locator('#statUnassigned').textContent(),'0');
  const collisionXlsx=await downloadFrom(frame.locator('#downloadBtn'),'test-results/promotion-collision-results.xlsx');
  const collisionBook=XLSX.read(collisionXlsx,{type:'buffer'});
  const collisionRoster=XLSX.utils.sheet_to_json(collisionBook.Sheets['학생별 분반 명단'],{header:1});
  assert.deepEqual(Array.from(collisionRoster.slice(1),row=>[row[1],row[7]]).sort(),[[10101,'1A'],[10101,'2A']]);
  const stageCount=requests.filter(path=>path==='/api/stageToolTransfer').length;
  const error='[1학년] 1A와 2A가 2학년 코드 2A로 겹칩니다.';
  const status=frame.locator('#hoursExportStatus');
  const downloads=[];
  const recordDownload=download=>downloads.push(download.suggestedFilename());
  page.on('download',recordDownload);
  try{
    await hoursJson.click();
    await status.filter({hasText:'내보내기 실패: '+error}).waitFor();
    await send.click();
    assert.equal(await status.textContent(),error);
    assert.equal(requests.filter(path=>path==='/api/stageToolTransfer').length,stageCount);
    assert.deepEqual(downloads,[]);
  }finally{page.off('download',recordDownload);}
  console.log('PASS promoted code collisions stop JSON downloads and hours transfers');

  const mixed=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(mixed,XLSX.utils.aoa_to_sheet([
    ['학번','이름',courseName],[10101,'가상학적1',1],[20101,'가상학적2',1]
  ]),'1학년');
  await frame.locator('#fileInput').setInputFiles(xlsx(mixed,'mixed.xlsx'));
  await frame.getByText('mixed.xlsx',{exact:true}).waitFor();
  await frame.locator('#runBtn').click();
  await frame.locator('#hoursExportCard').waitFor();
  const mixedRequest=page.waitForRequest('**/api/stageToolTransfer');
  await send.click();
  assert.equal((await mixedRequest).postDataJSON().data.sheets[0].grade,null);
  await hours.locator('.hours-import-dialog').waitFor();
  console.log('PASS mixed roster grades leave the hours import target grade unselected');

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
