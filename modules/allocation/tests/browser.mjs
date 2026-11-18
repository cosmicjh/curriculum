import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHarness} from './harness.mjs';
import {hoursFixture} from './fixtures/demo.js';
import {checkUi} from './ui-contract.mjs';
import '../../../scripts/build.mjs';
import {clickMenu} from '../../../tests/navigation-helper.mjs';

const artifactDirectory='test-results/allocation-workbook';
await mkdir(artifactDirectory,{recursive:true});
const h=await createHarness();let browser;
const revision=async()=>(await h.sql("SELECT revision FROM ca_sheets WHERE id='d1'")).results[0].revision;
const sheetSave=request=>request.url().endsWith('/api/courseWorkspace')&&request.postDataJSON()?.path==='/sheets/d1'&&request.postDataJSON()?.method==='PUT';
const steps=[],errors=[];
async function step(name,fn){const start=performance.now();await fn();steps.push({name,ms:Math.round(performance.now()-start)});console.log('PASS '+name);}
try{
  const url=await h.listen();
  const configureRoutes=context=>context.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await configureRoutes(context);
  let frame;
  const button=action=>frame.locator('[data-action="'+action+'"]');
  const submit=label=>frame.locator('#dialog button[type=submit]').filter({hasText:label}).click();
  const save=async()=>{const response=page.waitForResponse(r=>sheetSave(r.request()));await button('save-sheet').click();assert.equal((await response).status(),200);await frame.waitForFunction(()=>document.querySelector('.header-save')?.textContent==='저장됨');};
  const workbook=async target=>{
    const iframe=target.locator('#course-pane iframe:visible');
    await iframe.waitFor();
    const documentFrame=await (await iframe.elementHandle()).contentFrame();
    await documentFrame.locator('[data-edit=teacher-name]').first().waitFor();
    return documentFrame;
  };
  const login=async(target,role)=>{
    await target.locator('#login-role').selectOption(role);
    await target.locator('#password').fill('1234');
    await target.getByRole('button',{name:'로그인',exact:true}).click();
    await clickMenu(target,target.locator('#sidebar [data-tab=hours]'));
    return workbook(target);
  };
  await step('접속 및 기존 배당표 표시',async()=>{await page.goto(url);frame=await login(page,"teacher");await page.screenshot({path:artifactDirectory+'/01-workbook.png',fullPage:true});assert.equal(await frame.locator('.plan-table').count(),1);assert.equal(await frame.locator('.teacher-table').count(),1);await checkUi(page,'sheet',artifactDirectory,frame);});
  const otherContext=await browser.newContext(),other=await otherContext.newPage();
  await configureRoutes(otherContext);await other.goto(url);const otherFrame=await login(other,"teacher");
  await step('교사 편집·저장 및 충돌 시 로컬 입력 보존',async()=>{
    await frame.locator('[data-edit=teacher-name]').first().fill('가상브라우저교사');await frame.locator('[data-edit=teacher-name]').first().press('Tab');await save();
    await otherFrame.locator('[data-edit=teacher-name]').first().fill('가상충돌보존');await otherFrame.locator('[data-edit=teacher-name]').first().press('Tab');
    const pending=other.waitForResponse(r=>sheetSave(r.request()));await otherFrame.locator('[data-action=save-sheet]').click();assert.equal((await pending).status(),409);assert.equal(await otherFrame.locator('[data-edit=teacher-name]').first().inputValue(),'가상충돌보존');
    await otherContext.close();
  });
  await step('교과군 전환 및 저장본 재조회',async()=>{await frame.locator('[data-sheet=d2]').click();await frame.locator('[data-edit=teacher-name][data-id=teacher-d2]').waitFor();await frame.locator('[data-sheet=d1]').click();assert.equal(await frame.locator('[data-edit=teacher-name]').first().inputValue(),'가상브라우저교사');await page.reload();await clickMenu(page,page.locator('#sidebar [data-tab=hours]'));frame=await workbook(page);assert.equal(await frame.locator('[data-edit=teacher-name]').first().inputValue(),'가상브라우저교사');});
  await step('저장 응답 유실 후 같은 작업 ID로 안전하게 재시도',async()=>{
    const before=await revision();
    let firstId;let finish;const failed=new Promise(resolve=>finish=resolve);
    await page.route('**/api/courseWorkspace',async route=>{
      if(!sheetSave(route.request()))return route.fallback();
      firstId=route.request().postDataJSON().data.operationId;
      const response=await route.fetch();assert.equal(response.status(),200);await route.abort();finish();
    });
    await frame.locator('[data-edit=teacher-name]').first().fill('가상재시도교사');await frame.locator('[data-edit=teacher-name]').first().press('Tab');await button('save-sheet').click();await failed;
    await frame.waitForFunction(()=>!document.querySelector('[data-action=save-sheet]').disabled);await page.unroute('**/api/courseWorkspace');
    const request=page.waitForRequest(sheetSave);await save();assert.equal((await request).postDataJSON().data.operationId,firstId);
    assert.equal(await revision(),before+1);
  });
  await step('교사 제출·관리자 확정·입력 재개',async()=>{
    await frame.locator('[data-view=validation]').click();await checkUi(page,'validation',artifactDirectory,frame);
    await button('submit').click();await checkUi(page,'dialog',artifactDirectory,frame);await submit('제출');await save();
    await page.locator('[data-action=logout]').click();frame=await login(page,'admin');
    assert.equal(await frame.locator('input[type=password]').count(),0);
    await checkUi(page,'admin-sheet',artifactDirectory,frame);
    await frame.locator('[data-view=validation]').click();await button('approve').click();await save();await button('reopen').click();await save();await frame.locator('[data-view=sheet]').click();
  });
  await step('분반배정 JSON 가져오기·미리보기·저장',async()=>{
    await frame.locator('#hours-import-file').setInputFiles({name:'virtual-course-hours.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(hoursFixture()))});
    await frame.locator('#dialog [name=dept-0-0]').fill('가상국어');await submit('미리보기');await submit('확인 후 적용');await save();assert.ok((await frame.locator('.plan-table tbody').innerText()).includes('가상추가 과목'));
  });
  let backup;
  await step('JSON 백업 및 CSV 다운로드',async()=>{
    let event=page.waitForEvent('download');await button('backup').click();let download=await event;backup=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(backup.schemaVersion,1);assert.equal(backup.departments.length,2);
    event=page.waitForEvent('download');await button('csv').click();download=await event;assert.match(await readFile(await download.path(),'utf8'),/가상재시도교사/);
  });
  await step('JSON 백업 복원',async()=>{
    backup.teachers.find(t=>t.id==='teacher-d1').name='가상복원교사';await frame.locator('#backup-file').setInputFiles({name:'virtual-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await submit('확인');await save();assert.equal(await frame.locator('[data-edit=teacher-name]').first().inputValue(),'가상복원교사');
  });
  await step('현재 입력 내용·빈 양식 인쇄 SVG',async()=>{
    await frame.evaluate(()=>{window.__virtualPrintCount=0;window.print=()=>{window.__virtualPrintCount++;};});
    await button('print-current').click();await frame.waitForFunction(()=>window.__virtualPrintCount===1);assert.equal(await frame.locator('#print-root svg').count(),1);await writeFile(artifactDirectory+'/current-print.svg',await frame.locator('#print-root').innerHTML());
    await button('print-form').click();await frame.waitForFunction(()=>window.__virtualPrintCount===2);assert.equal(await frame.locator('#print-root svg').count(),1);
  });
  await step('교과군 생성·학교 설정·성능 측정',async()=>{
    await button('new-dept').click();await frame.locator('#dialog [name=name]').fill('가상시험교과');await submit('시트 추가');await button('save-sheet').click();await frame.waitForFunction(()=>document.querySelector('.header-save')?.textContent==='저장됨');
    await frame.locator('[data-view=settings]').click();await checkUi(page,'settings',artifactDirectory,frame);await frame.locator('#school-form [name=name]').fill('가상시험학교');await frame.locator('#school-form button[type=submit]').click();await frame.waitForFunction(()=>document.querySelector('.header-save')?.textContent==='저장됨');
    await button('performance').click();assert.match(await frame.locator('#dialog').innerText(),/클라이언트/);await frame.locator('[data-perf=close]').click();
    await page.screenshot({path:artifactDirectory+'/02-settings.png',fullPage:true});
  });
  const performanceReport=await frame.evaluate(()=>window.ALLOCATION_PERFORMANCE.snapshot());
  assert.ok(performanceReport.samples.some(s=>s.action==='load'));assert.ok(performanceReport.samples.some(s=>s.action==='save'));assert.deepEqual(errors,[]);
  assert.doesNotMatch(JSON.stringify(performanceReport),/virtual-access-2026|virtual-admin-2026|가상복원교사|Bearer/);
  assert.equal(new URL(page.url()).origin,new URL(url).origin);
  const report={environment:'platform login + local Miniflare D1 + headless Chromium; synthetic data only',steps,errors,performance:performanceReport};
  await writeFile(artifactDirectory+'/browser.json',JSON.stringify(report,null,2)+'\n');
  console.log(`브라우저 시험 ${steps.length}개 통과`);
}finally{await browser?.close();await h.close();}
