import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {clickMenu} from '../../../tests/navigation-helper.mjs';
import {createHarness} from './harness.mjs';
import {checkUi} from './ui-contract.mjs';
import '../../../scripts/build.mjs';

const directory='test-results/allocation-term-switch';
await mkdir(directory,{recursive:true});
const h=await createHarness();
let browser;
const errors=[];
try{
  const admin=await h.login(true);
  const get=(path='/workspace')=>h.api(path,'GET',{},admin);
  const switchApi=term=>h.api('/term','POST',{term},admin);
  assert((await switchApi('2026-2')).ok);
  const {global,globalRevision}=(await get()).data;
  global.school.name='가상 보관 학교';
  global.school.grades[0].classCount=3;
  const seeded=await h.api('/global','PUT',{global,newSheets:[],revision:globalRevision,operationId:crypto.randomUUID()},admin);
  assert(seeded.ok,seeded.error);
  assert((await switchApi('2026-1')).ok);
  assert.deepEqual((await get('/term')).data,{activeTerm:'2026-2',archivedTerms:['2026-2','2026-1']});

  const origin=await h.listen();
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
  async function login(role){
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);
    await page.locator('#login-role').selectOption(role);
    await page.locator('#password').fill('1234');
    await page.getByRole('button',{name:'로그인',exact:true}).click();
    await clickMenu(page,page.locator('#sidebar [data-tab=hours]'));
    const iframe=await page.locator('#course-pane iframe:visible').elementHandle();
    const frame=await iframe.contentFrame();
    await frame.locator('.workbook-header').waitFor();
    return {page,frame};
  }

  const {page,frame}=await login('admin');
  const switchButton=frame.locator('[data-action=switch-term]');
  const dialog=frame.getByRole('dialog',{name:'학기 전환'});
  const platformTerm=frame.locator('.platform-term');
  const termLabel=frame.locator('[title="시수배당 학기"]');
  assert.equal(await platformTerm.textContent(),'통합시간표 2026-2');
  assert.equal(await termLabel.textContent(),'2026학년도 1학기');
  await checkUi(page,'term-header',directory,frame);

  await frame.getByRole('button',{name:'학교 설정',exact:true}).click();
  const schoolForm=frame.locator('#school-form');
  const schoolName=schoolForm.getByLabel('학교명'),schoolYear=schoolForm.getByLabel('학년도'),schoolSemester=schoolForm.getByLabel('학기',{exact:true});
  assert(!await schoolYear.isEditable());
  assert(!await schoolSemester.isEditable());
  await schoolName.fill('가상 설정 수정');
  await switchButton.click();
  await frame.getByText('현재 학기의 변경 내용을 먼저 저장하세요.',{exact:true}).waitFor();
  assert(!await dialog.isVisible());
  assert.equal(await schoolName.inputValue(),'가상 설정 수정');
  const mutations=[];
  page.on('request',request=>{
    if(!request.url().endsWith('/api/courseWorkspace'))return;
    const data=request.postDataJSON();
    if(data.method!=='GET')mutations.push(data);
  });
  // Alter the values programmatically to verify neither read-only field drives a save.
  await schoolYear.evaluate(input=>input.value='2030');
  await schoolSemester.evaluate(input=>input.value='2학기');
  const settingsSaved=page.waitForResponse(response=>response.request().postDataJSON()?.path==='/global');
  await schoolForm.getByRole('button',{name:'학교 설정 저장'}).click();
  assert((await settingsSaved).ok());
  await frame.locator('.header-save').filter({hasText:'저장됨'}).waitFor();
  const edited=(await get()).data.global.school;
  assert.deepEqual([edited.name,edited.year,edited.semester],['가상 설정 수정',2026,1]);
  assert.deepEqual(mutations.map(data=>[data.method,data.path]),[['PUT','/global']]);
  console.log('PASS 읽기 전용 학기, 저장 시 학기 불변, 설정 미저장 차단');

  await frame.getByRole('button',{name:'배당표',exact:true}).click();
  const teacherName=frame.locator('[data-edit=teacher-name]').first();
  await teacherName.fill('가상 저장 대기');
  await teacherName.press('Tab');
  await switchButton.click();
  await frame.getByText('현재 학기의 변경 내용을 먼저 저장하세요.',{exact:true}).waitFor();
  assert(!await dialog.isVisible());
  assert.equal(await teacherName.inputValue(),'가상 저장 대기');
  let signalSave,releaseSave;
  const saveStarted=new Promise(resolve=>signalSave=resolve);
  const resumeSave=new Promise(resolve=>releaseSave=resolve);
  const savePattern='**/api/courseWorkspace';
  await page.route(savePattern,async route=>{
    const data=route.request().postDataJSON();
    if(data.method!=='PUT'||data.path!=='/sheets/d1')return route.fallback();
    signalSave();
    await resumeSave;
    await route.continue();
  });
  const sheetSaved=page.waitForResponse(response=>response.request().postDataJSON()?.path==='/sheets/d1');
  try{
    await frame.locator('[data-action=save-sheet]').click();
    await Promise.race([saveStarted,sheetSaved.then(()=>assert.fail('Expected the pending sheet save'))]);
    assert(await switchButton.isDisabled());
    assert(!await dialog.isVisible());
  }finally{releaseSave();}
  assert((await sheetSaved).ok());
  await frame.locator('.header-save').filter({hasText:'저장됨'}).waitFor();
  await page.unroute(savePattern);
  await frame.locator('#toast.show').waitFor({state:'hidden'});
  console.log('PASS 배당표 미저장 상태와 저장 중 전환 차단');

  await switchButton.click();
  await dialog.waitFor();
  const year=dialog.getByLabel('학년도'),semester=dialog.getByLabel('학기',{exact:true}),archive=dialog.getByLabel('보관 학기');
  const confirm=dialog.getByRole('button',{name:'전환 확인'});
  assert.deepEqual([await year.inputValue(),await semester.inputValue(),await archive.inputValue()],['2026','2','2026-2']);
  assert.equal(await dialog.getByRole('status').textContent(),'2026-2 보관본을 복원합니다.');
  assert(await dialog.getByText('현재 2026-1 학기 작업본을 보관합니다.').isVisible());
  await checkUi(page,'term-switch',directory,frame);
  await confirm.click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(await frame.evaluate(()=>document.activeElement.dataset.action),'switch-term');
  assert.equal(await termLabel.textContent(),'2026학년도 2학기');
  assert(!await platformTerm.isVisible());
  const restored=(await get('/state')).data.state;
  assert.equal(restored.school.name,'가상 보관 학교');
  assert.equal(restored.school.grades[0].classCount,3);
  console.log('PASS 기본 대상 추천, 보관본 복원, 활성 학기와 같을 때 차이 숨김');

  await switchButton.click();
  await dialog.waitFor();
  assert.deepEqual([await year.inputValue(),await semester.inputValue()],['2027','1']);
  await archive.selectOption('2026-1');
  assert.deepEqual([await year.inputValue(),await semester.inputValue()],['2026','1']);
  assert.equal(await dialog.getByRole('status').textContent(),'2026-1 보관본을 복원합니다.');
  await semester.selectOption('2');
  assert(await confirm.isDisabled());
  await year.fill('2027');
  await semester.selectOption('1');
  assert.equal(await dialog.getByRole('status').textContent(),'2027-1 새 학기를 생성합니다.');
  await confirm.click();
  await dialog.waitFor({state:'hidden'});
  const fresh=(await get('/state')).data.state;
  assert.deepEqual([fresh.school.year,fresh.school.semester],[2027,1]);
  assert(fresh.school.grades.every(grade=>grade.classCount===0&&grade.movingCount===0));
  assert.equal(fresh.departments.length,1);
  assert.equal(fresh.courses.length,0);
  assert.equal((await get()).data.activeTerm,'2026-2');
  assert.equal(await platformTerm.textContent(),'통합시간표 2026-2');
  console.log('PASS 다음 학기 추천 및 새 작업본 생성, 플랫폼 활성 학기 독립');

  const teacher=await login('teacher');
  assert.equal(await teacher.frame.locator('[data-action=switch-term]').count(),0);
  assert.equal(await teacher.frame.locator('.platform-term').textContent(),'통합시간표 2026-2');
  const teacherCookie=await h.login(false);
  assert.equal((await h.api('/term','GET',{},teacherCookie)).status,403);
  assert.equal((await h.api('/term','POST',{term:'2026-1'},teacherCookie)).status,403);
  assert.equal((await get()).data.global.school.year,2027);
  console.log('PASS 교사 버튼 미표시 및 서버 거부');

  await frame.getByRole('button',{name:'학교 설정',exact:true}).click();
  await schoolName.fill('가상 미저장 설정 유지');
  await clickMenu(page,page.locator('#sidebar [data-tab=settings]'));
  await page.getByText('새 학기 만들기',{exact:true}).click();
  await page.locator('#create-year').fill('2027');
  await page.locator('#create-semester').selectOption('1');
  await page.getByRole('button',{name:'학기 생성',exact:true}).click();
  await page.locator('#switch-term').selectOption('2027-1');
  await page.getByRole('button',{name:'학기 전환',exact:true}).click();
  await page.locator('#header .term-label').filter({hasText:'2027학년도 1학기'}).waitFor();
  await clickMenu(page,page.locator('#sidebar [data-tab=hours]'));
  assert(!await platformTerm.isVisible());
  assert.equal(await schoolName.inputValue(),'가상 미저장 설정 유지');
  assert.equal(await termLabel.textContent(),'2027학년도 1학기');
  assert.deepEqual(errors,[]);
  console.log('PASS 통합시간표 학기 변경 표시 갱신 및 기존 설정 입력 보존');
}finally{
  await browser?.close();
  await h.close();
}
