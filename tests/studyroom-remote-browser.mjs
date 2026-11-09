import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const release=JSON.parse(await readFile('private/studyroom-test-release.local.json','utf8')),credentials=JSON.parse(await readFile('private/studyroom-test-credentials.local.json','utf8'));
const url=release.url;if(!/^https:\/\/school-timetable-studyroom-test-20261106\.[a-z0-9-]+\.workers\.dev$/.test(url))throw Error('Only synthetic staging is allowed');
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})}),errors=[];
await mkdir('test-results/studyroom',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/teacher.html',{waitUntil:'domcontentloaded',timeout:90000});await page.locator('#password').fill(credentials.teacherPassword);await page.locator('form[data-form=login] button').click();await page.locator('[data-action=teacher-tab][data-tab=studyroom]').click();
 const root=page.locator('.studyroom'),idle=()=>page.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');await root.locator('[data-sr-session]').waitFor();await idle();
 assert.match(await root.locator('[data-sr-session]').textContent(),/회차 없음/);assert.equal(await root.locator('[data-sr=seat]').count(),99);
 await root.locator('[data-sr=view][data-view=query]').click();await idle();await root.locator('[data-sr-form=search] [name=search]').fill('30101');await root.locator('[data-sr-form=search] button:not([type=button])').click();await idle();await root.locator('[data-sr=person]').first().click();await idle();
 assert.match(await root.locator('[data-sr-calendar]').textContent(),/출석 1/);assert.equal(await root.locator('[data-sr-results] tbody tr').count(),1);assert.match(await root.locator('[data-sr-results]').textContent(),/가상 출석 비고/);
 await page.screenshot({path:'test-results/studyroom/remote-calendar-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/studyroom/remote-calendar-mobile.png',fullPage:true});
 const student=await context.newPage();await student.setViewportSize({width:390,height:844});await student.goto(url+'/studyroom-student.html?seat=99',{waitUntil:'domcontentloaded',timeout:90000});await student.locator('[name=grade]').selectOption('3');await student.locator('[name=number]').selectOption('02');await student.locator('#student-form button').click();await student.locator('#status').filter({hasText:'회차가 없습니다'}).waitFor();await student.screenshot({path:'test-results/studyroom/remote-qr-student.png',fullPage:true});
 assert.deepEqual(errors,[]);await writeFile('test-results/studyroom/remote-browser.json',JSON.stringify({environment:'isolated real Cloudflare Worker/D1 + Edge; synthetic students',url,archivedStudentMonth:true,currentEmptyAfterClosing:true,qrSeat99Preserved:true,errors},null,2));console.log('PASS remote archived calendar, attendance note, 99 seats, mobile and closed-reception QR');
}finally{await browser.close();}
