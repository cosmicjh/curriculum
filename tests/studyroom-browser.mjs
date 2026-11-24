import {clickMenu} from './navigation-helper.mjs';
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {harness} from './harness.mjs';
import {setupStudyroom} from './studyroom-fixture.mjs';
import {backup} from './fixture.mjs';
import {seats} from '../assets/studyroom-layout.js';
import {localTime} from '../src/studyroom-domain.js';
import '../scripts/build.mjs';
const h=await harness({studyroom:true}),steps=[],errors=[];let browser;
const now=localTime(new Date());
await mkdir('test-results/studyroom',{recursive:true});await mkdir('.impeccable/review',{recursive:true});
async function step(name,fn){await fn();steps.push(name);console.log('PASS '+name);}
async function waitForCommit(commit){
 let timer;
 try{return await Promise.race([commit,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error('Timed out waiting for the student submit to commit')),15000);
 })]);}
 finally{clearTimeout(timer);}
}
try{
 const admin=await h.login();assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
 const api=(op,data={})=>h.api('studyroom',{op,...data},admin.cookie),rev=async()=>(await api('dashboard')).data.revision;
 assert((await api('configuration',{expectedRevision:await rev(),enabled:true,schedule:{effectiveDate:now.date,definitions:[{id:'test',label:'아침',days:[1,2,3,4,5,6,7],start:'00:00',end:'23:59'}]}})).ok);
 const url=await h.listen();browser=await (process.env.STUDYROOM_BROWSER==='webkit'?webkit:chromium).launch({headless:true,...(process.platform==='win32'&&process.env.STUDYROOM_BROWSER!=='webkit'?{channel:'msedge'}:{})});const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
 if(process.env.STUDYROOM_BROWSER==='webkit'){
  // WebKit rejects Secure cookies on this HTTP-only local harness. Relay them in test memory.
  const sessions=new WeakMap();
  await ctx.route('**/api/*',async route=>{
   const request=route.request(),page=request.frame().page(),headers={...request.headers()};
   if(sessions.has(page))headers.cookie=sessions.get(page);
   const response=await h.mf.dispatchFetch(request.url(),{method:request.method(),headers,body:request.postData()});
   const cookies=response.headers.getSetCookie();
   if(cookies.length)sessions.set(page,cookies.map(cookie=>cookie.split(';')[0]).join('; '));
   const output=Object.fromEntries(response.headers);delete output['set-cookie'];
   await route.fulfill({status:response.status,headers:output,body:Buffer.from(await response.arrayBuffer())});
  });
 }
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await step('mobile QR submission uses shared D1 roster and retries the same request after lost response',async()=>{
  await page.setViewportSize({width:390,height:844});await page.goto(url+'/studyroom-student.html?seat=99');
  await page.locator('[name=grade]').selectOption('3');await page.locator('[name=classNum]').selectOption('01');await page.locator('[name=number]').selectOption('01');await page.locator('#student-form button').click();await page.locator('#confirmation').waitFor({state:'visible'});assert.match(await page.locator('#student-name').textContent(),/가상학생하나/);
  let release;const gate=new Promise(resolve=>release=resolve),ids=[];
  await page.route('**/api/studyroom',async route=>{
   const data=route.request().postDataJSON();
   if(data.op!=='submit')return route.fallback();
   assert.match(data.studentKey,/^[a-f0-9]{64}$/);
   ids.push(data.requestId);
   if(ids.length===1){await gate;await route.fetch();return route.abort('failed');}
   if(ids.length===2)return route.fulfill({status:503,json:{ok:false,code:'SR_RETRY'}});
   if(ids.length===3)return route.fulfill({status:502,contentType:'text/html',body:'Bad gateway'});
   return route.fallback();
  });
  const live=page.getByRole('status');
  await page.locator('#submit').click();
  try{
   assert.equal(await live.textContent(),'제출 중…');
   assert(await page.locator('#submit').isDisabled());
  }finally{release();}
  await live.filter({hasText:'다시 제출하는 중…(1/4)'}).waitFor();
  await live.filter({hasText:'제출 완료'}).waitFor();
  assert.equal(ids.length,4);assert.equal(new Set(ids).size,1);
  assert.equal((await h.sql('SELECT count(*) n FROM sr_attendance')).results[0].n,1);
  assert.equal((await h.sql("SELECT count(*) n FROM sr_events WHERE action='submit'")).results[0].n,1);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.evaluate(()=>document.fonts.check('16px "Timetable UI"','한글')));await page.screenshot({path:'test-results/studyroom/student-mobile.png',fullPage:true});
 });
 await step('after two consecutive timeouts the third attempt replays the committed attendance',async()=>{
  const student=await ctx.newPage();student.on('pageerror',e=>errors.push(e.message));
  await student.clock.install();
  await student.goto(url+'/studyroom-student.html?seat=99');
  await student.locator('[name=grade]').selectOption('3');await student.locator('#student-form button').click();
  await student.locator('#confirmation').waitFor();
  const ids=[],status=student.getByRole('status');
  const original=(await h.sql('SELECT id FROM sr_attendance')).results[0].id;
  const gates=Array.from({length:2},()=>Promise.withResolvers()),firstCommit=Promise.withResolvers();
  await student.route('**/api/studyroom',async route=>{
   const attempt=ids.push(route.request().postDataJSON().requestId);
   if(attempt<=2){
    if(attempt===1)firstCommit.resolve((await route.fetch()).ok());
    await gates[attempt-1].promise;return route.abort().catch(()=>{});
   }
   return route.fallback();
  });
  try{
   await student.locator('#submit').click();assert(await waitForCommit(firstCommit.promise));
   await student.clock.fastForward(20000);
   await status.filter({hasText:'다시 제출하는 중…(1/4)'}).waitFor();
   gates[0].resolve();
   await Promise.all([student.waitForRequest(req=>req.url().endsWith('/api/studyroom')),student.clock.fastForward(1000)]);
   await student.clock.fastForward(20000);
   await status.filter({hasText:'다시 제출하는 중…(2/4)'}).waitFor();
  }finally{for(const gate of gates)gate.resolve();}
  await student.clock.fastForward(2000);
  await status.filter({hasText:'제출 완료'}).waitFor();
  assert.equal(ids.length,3);assert.equal(new Set(ids).size,1);
  assert.deepEqual((await h.sql('SELECT id FROM sr_attendance')).results,[{id:original}]);
  assert.equal((await h.sql("SELECT count(*) n FROM sr_events WHERE action='submit' AND request_id=?",ids[0])).results[0].n,1);
  await student.close();
 });
 await step('name lookup retries timeout and short Retry-After, then seat occupation is reported immediately',async()=>{
  const student=await ctx.newPage();student.on('pageerror',e=>errors.push(e.message));
  await student.clock.install();
  await student.goto(url+'/studyroom-student.html?seat=99');
  await student.evaluate(()=>{Math.random=()=>0.5;});
  await student.locator('[name=grade]').selectOption('3');await student.locator('[name=number]').selectOption('02');
  let release;const gate=new Promise(resolve=>release=resolve);
  let lookups=0,submits=0;
  await student.route('**/api/studyroom',async route=>{
   const {op}=route.request().postDataJSON();
   if(op==='submit'){submits++;return route.fallback();}
   lookups++;
   if(lookups===1){await gate;return route.abort().catch(()=>{});}
   if(lookups===2)return route.fulfill({status:429,headers:{'Retry-After':'3'},body:'Busy'});
   return route.fallback();
  });
  const lookup=()=>student.waitForRequest(req=>req.url().endsWith('/api/studyroom')&&req.postDataJSON()?.op==='studentInfo');
  const status=student.getByRole('status');
  try{
   await Promise.all([lookup(),student.locator('#student-form button').click()]);
   await student.clock.fastForward(20000);
   await status.filter({hasText:'다시 확인하는 중…(1/4)'}).waitFor();
  }finally{release();}
  await Promise.all([lookup(),student.clock.fastForward(1000)]);
  await status.filter({hasText:'다시 확인하는 중…(2/4)'}).waitFor();
  await student.clock.runFor(3200);
  assert.equal(lookups,2);
  await Promise.all([lookup(),student.clock.fastForward(500)]);
  await student.locator('#confirmation').waitFor({state:'visible'});
  await student.locator('#submit').click();
  await status.filter({hasText:'이미 사용 중인 좌석입니다.'}).waitFor();
  await student.clock.fastForward(20000);
  assert.equal(submits,1);
  await student.close();
 });
 await step('actual 429 ends beyond the budget and retries within the budget with the same request ID',async()=>{
  const student=await ctx.newPage();student.on('pageerror',e=>errors.push(e.message));
  await student.goto(url+'/studyroom-student.html?seat=99');
  await student.locator('[name=grade]').selectOption('3');
  await student.locator('#student-form button').click();await student.locator('#confirmation').waitFor();
  const bucket='sr-student:'+createHash('sha256').update('local').digest('hex');
  const prime=expiry=>h.sql('INSERT INTO login_limits(bucket,attempts,expires_at) VALUES(?,1200,?) ON CONFLICT(bucket) DO UPDATE SET attempts=excluded.attempts,expires_at=excluded.expires_at',bucket,expiry);
  const submitted=req=>req.url().endsWith('/api/studyroom')&&req.postDataJSON().op==='submit';
  const requests=[];student.on('request',req=>{if(submitted(req))requests.push({id:req.postDataJSON().requestId,at:Date.now()});});
  const status=student.getByRole('status'),submit=student.locator('#submit');
  await prime(Date.now()+75000);
  const metadata=await student.evaluate(async()=>{
   const args={op:'studentInfo',studentNumber:'30101',seat:'99'};
   const out=[];
   for(const options of [undefined,{timeoutMs:20000}]){
    try{await TTApi.request('studyroom',args,options);}
    catch(error){out.push({keys:Object.keys(error).sort(),message:error.message,status:error.status});}
   }
   return out;
  });
  assert.deepEqual(metadata,[
   {keys:['code','status'],message:'잠시 후 다시 시도하세요.',status:429},
   {keys:['code','retryAfter','status'],message:'잠시 후 다시 시도하세요.',status:429}
  ]);
  const rateLimit=()=>student.waitForResponse(res=>res.status()===429&&submitted(res.request()));
  const [long]=await Promise.all([rateLimit(),submit.click()]);
  assert(Number(await long.headerValue('Retry-After'))>60);
  await status.filter({hasText:'제출이 확인되지 않았습니다.'}).waitFor({timeout:5000});
  assert.equal(requests.length,1);
  const expiry=Date.now()+3500;
  await prime(expiry);
  const [short]=await Promise.all([rateLimit(),submit.click()]);
  const remaining=Number(await short.headerValue('Retry-After'));
  assert(remaining>=1&&remaining<=4);
  await status.filter({hasText:'다시 제출하는 중…(1/4)'}).waitFor();
  await status.filter({hasText:'제출 완료'}).waitFor();
  assert.equal(requests.length,3);assert.equal(new Set(requests.map(r=>r.id)).size,1);
  assert(requests[2].at>=expiry);
  assert.equal((await h.sql("SELECT count(*) n FROM sr_events WHERE action='submit' AND request_id=?",requests[0].id)).results[0].n,1);
  await student.close();
 });
 await step('transient failures preserve the request ID and a changed student clears it',async()=>{
  const student=await ctx.newPage();student.on('pageerror',e=>errors.push(e.message));
  await student.clock.install();
  await student.goto(url+'/studyroom-student.html?seat=99');
  await student.locator('[name=grade]').selectOption('3');await student.locator('[name=number]').selectOption('02');
  await student.locator('#student-form button').click();await student.locator('#confirmation').waitFor();
  let exhaust=true;const ids=[];
  await student.route('**/api/studyroom',async route=>{
   ids.push(route.request().postDataJSON().requestId);
   if(exhaust)return route.fulfill({status:503,json:{ok:false,code:'SR_RETRY'}});
   return route.fulfill({status:409,json:{ok:false,code:'STUDENT_CHANGED',error:'학생 정보가 변경되었습니다. 이름 확인을 다시 하세요.'}});
  });
  const submit=student.locator('#submit'),status=student.getByRole('status');
  const failure=status.filter({hasText:'제출이 확인되지 않았습니다. 출석 제출을 다시 누르세요.'});
  await submit.click();
  for(let i=0;i<4;i++){
   await status.filter({hasText:'다시 제출하는 중…('+(i+1)+'/4)'}).waitFor();
   await student.clock.fastForward(1000*2**i);
  }
  await failure.waitFor();
  assert.equal(ids.length,5);assert(await submit.isEnabled());
  exhaust=false;await submit.click();
  await status.filter({hasText:'학생 정보가 변경되었습니다. 이름 확인을 다시 하세요.'}).waitFor();
  assert(await student.locator('#student-form').isVisible());
  assert(await student.locator('#confirmation').isHidden());
  assert.equal(await student.evaluate(id=>Object.values(sessionStorage).includes(id),ids[0]),false);
  await student.clock.fastForward(60000);
  assert.equal(ids.length,6);assert.equal(new Set(ids).size,1);
  await student.close();
 });
 const teacher=await ctx.newPage();teacher.on('pageerror',e=>errors.push(e.message));await teacher.setViewportSize({width:1440,height:1000});
 const requests=[];teacher.on('request',request=>{if(request.url().endsWith('/api/studyroom'))requests.push(request.postDataJSON());});
 const sr=teacher.locator('.studyroom'),idle=()=>sr.locator('[data-sr="refresh"]').waitFor().then(()=>teacher.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false'));
 await step('common teacher login can add a note and all 99 seats fit without horizontal scrolling',async()=>{
  await teacher.clock.install();
  await teacher.goto(url+'/teacher.html');await teacher.locator('#password').fill('1234');await teacher.locator('form[data-form=login] button').click();await clickMenu(teacher,teacher.locator('[data-action=teacher-tab][data-tab=studyroom]'));await idle();assert.equal(await sr.locator('[data-sr=seat]').count(),99);assert.match(await sr.locator('[data-seat="99"]').textContent(),/30101.*가상학생하나/);
  assert.equal(await sr.locator('[data-sr-identity]').count(),0);
  assert.equal(await sr.locator('input[type=search], [data-sr-view]').count(),0);
  assert.equal(await sr.locator('[data-sr=manual]').count(),0);
  await sr.locator('[data-seat="99"]').click();await sr.locator('textarea[name=note]').fill('가상 특이사항');await sr.locator('dialog [data-sr-form=change] button').click();await idle();
  assert.equal((await h.sql('SELECT note FROM sr_attendance')).results[0].note,'가상 특이사항');
  await teacher.setViewportSize({width:320,height:760});
  const positions=await sr.locator('[data-sr="seat"]').evaluateAll(buttons=>buttons.map(button=>{
   const style=getComputedStyle(button);
   return [button.dataset.seat,Number(style.gridRowStart)+6,Number(style.gridColumnStart)];
  }));
  assert.deepEqual(positions,seats,'mobile seats follow the original layout coordinates');
  assert.equal(await sr.locator('[data-seat="98"]').textContent(),'98');
  assert.equal(await sr.locator('[data-seat="99"] > :not([hidden])').count(),2);
  assert(await sr.locator('[data-seat="99"] [data-number]').evaluate(e=>e.scrollWidth<=e.clientWidth),'mobile seat shows all five student-number digits');
  assert(await sr.locator('button').evaluateAll(buttons=>buttons.every(button=>getComputedStyle(button).borderTopWidth==='0px')));
  assert.equal(await sr.locator('.sr-seat-scroll').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  assert.equal(await sr.locator('[data-seat="98"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(245, 245, 245)');
  assert.equal(await sr.locator('[data-seat="99"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(236, 236, 236)');
  assert(await sr.locator('.sr-attendance-toolbar').evaluate(el=>{
   const refresh=el.querySelector('[data-sr=refresh]').getBoundingClientRect();
   return Math.abs(refresh.right-el.getBoundingClientRect().right)<1;
  }));
  assert(await sr.locator('.sr-seat-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth));
  assert(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await teacher.screenshot({path:'test-results/studyroom/current-mobile.png',fullPage:true});
  await sr.locator('[data-sr=display][data-value=list]').click();assert(await sr.locator('[data-sr-list]').evaluate(e=>!e.hidden&&e.scrollWidth<=e.clientWidth));
  assert.equal(await sr.locator('[data-sr-list] [data-sr=edit], [data-sr-list] [data-sr=history]').count(),0);
  await sr.locator('[data-sr-list] [data-sr=readNote]').click();
  assert.equal(await sr.locator('dialog [name=change]').count(),0);
  await sr.locator('dialog [name=note]').fill('현재 출석 비고');
  await sr.locator('dialog button.primary').click();await idle();
  await sr.locator('[data-sr-list] [data-sr=readNote]').filter({hasText:'현재 출석 비고'}).click();
  await sr.locator('dialog button[value=delete]').click();await idle();
  assert.equal(await sr.locator('[data-sr-list] [data-sr=readNote]').textContent(),'');
  await sr.locator('[data-sr-list] [data-sr=readNote]').click();
  await sr.locator('dialog [name=note]').fill('가상 특이사항');
  await sr.locator('dialog button.primary').click();await idle();
  await sr.locator('[data-sr=display][data-value=seats]').click();await teacher.setViewportSize({width:1440,height:1000});
  await teacher.screenshot({path:'.impeccable/review/desktop.png',fullPage:true});
 });
 await step('Teacher attendance refresh uses the administrator interval',async()=>{
  assert.equal(await sr.getByLabel('자동 새로고침').count(),0);
  assert.equal((await api('dashboard')).data.refreshSeconds,30);
  const teacherSession=await h.login('teacher');
  const denied=await h.api('studyroom',{op:'refreshInterval',seconds:15,expectedRevision:await rev()},teacherSession.cookie);
  assert.equal(denied.ok,false);
  assert((await api('refreshInterval',{seconds:15,expectedRevision:await rev()})).ok);
  await sr.locator('[data-sr=refresh]').click();await idle();
  const dashboard=()=>teacher.waitForRequest(req=>req.url().endsWith('/api/studyroom')&&req.postDataJSON()?.op==='dashboard');
  await Promise.all([dashboard(),teacher.clock.fastForward(15000)]);
  await idle();
  assert((await api('refreshInterval',{seconds:0,expectedRevision:await rev()})).ok);
  await sr.locator('[data-sr=refresh]').click();await idle();
  const before=await teacher.evaluate(()=>TIMETABLE_PERF.filter(r=>r.action==='studyroom').length);
  await teacher.clock.fastForward(60000);
  assert.equal(await teacher.evaluate(()=>TIMETABLE_PERF.filter(r=>r.action==='studyroom').length),before);
 });
 await step('calendars show date and student attendance, filter by session and month, and allow note edits',async()=>{
  await sr.locator('[data-seat="98"]').click();
  assert.equal(await sr.locator('dialog [name=seat]').inputValue(),'98');
  await sr.locator('dialog [name=studentNumber]').fill('30102');
  await sr.locator('dialog button.primary').click();await idle();
  assert.match(await sr.locator('[data-seat="98"]').textContent(),/30102.*가상학생둘/);
  const queryIdle=()=>teacher.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');
  await sr.locator('[data-sr=view][data-view=query]').click();await queryIdle();
  assert.equal(await sr.locator('input[type=search]').count(),1);
  assert.equal(await sr.locator('[data-sr-content]').locator('input[type=date], select, [name=includeCancelled]').count(),0);
  assert.equal(await sr.locator('[data-sr-results] tbody tr').count(),0);
  const day=sr.locator('[data-sr=day][data-day="'+now.date+'"]');
  assert.equal(await day.locator('[data-sr-count-day]').textContent(),'2');
  assert.equal(await day.evaluate(el=>getComputedStyle(el).borderTopWidth),'1px');
  assert.equal(await sr.locator('.sr-calendar').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  assert.equal(await day.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(236, 236, 236)');
  assert(await sr.locator('.sr-calendar').evaluate(el=>{
   const offset=cell=>cell.firstElementChild.getBoundingClientRect().top-cell.getBoundingClientRect().top;
   return Math.abs(offset(el.querySelector('.has-record'))-offset(el.querySelector('.sr-calendar-day:not(.has-record)')))<1;
  }));
  const search=sr.getByRole('combobox',{name:'학생 검색'}),searchForm=sr.locator('[data-sr-form=search]');
  await search.fill('학생둘');await sr.getByRole('option',{name:'30102 가상학생둘',exact:true}).waitFor();
  const matches=sr.locator('[data-sr-search-results]');
  assert.equal(await matches.getByRole('option').count(),1);
  const beforeSelection=requests.filter(r=>r.op==='query').length;
  await matches.getByRole('option',{name:'30102 가상학생둘',exact:true}).click();await queryIdle();
  assert(await sr.locator('[data-sr-person]').isHidden());assert.equal(await sr.locator('[data-sr-results] tbody tr').count(),0);
  assert.equal(requests.filter(r=>r.op==='query').length,beforeSelection,'selecting a candidate does not fetch attendance');
  assert.equal(await search.inputValue(),'30102 가상학생둘');
  await searchForm.getByRole('button',{name:'검색',exact:true}).click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-person] h3').textContent(),'30102 가상학생둘');
  assert.equal(await sr.locator('[data-sr-results] tbody tr').count(),1);
  await search.fill('30101');await searchForm.getByRole('button',{name:'검색',exact:true}).click();await queryIdle();
  await matches.getByRole('option',{name:'30101 가상학생하나',exact:true}).click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-person] h3').textContent(),'30102 가상학생둘','the previous result remains until search is submitted');
  await searchForm.getByRole('button',{name:'검색',exact:true}).click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-person] h3').textContent(),'30101 가상학생하나');
  await search.fill('없는가상학생');await searchForm.getByRole('button',{name:'검색',exact:true}).click();await queryIdle();
  await matches.getByText('검색 결과가 없습니다.',{exact:true}).waitFor();
  await searchForm.getByRole('button',{name:'초기화',exact:true}).click();await queryIdle();
  assert.equal(await search.inputValue(),'');assert(await sr.locator('[data-sr-person]').isHidden());
  assert.equal(await day.locator('[data-sr-count-day]').textContent(),'2');
  await day.click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-results] h4').textContent(),'오전');
  await sr.locator('[data-sr=session][data-value="야간"]').click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-results] tbody tr').count(),0);
  await sr.locator('[data-sr=session][data-value="오전"]').click();await queryIdle();
  assert.equal(await day.getAttribute('aria-pressed'),'true');
  await teacher.screenshot({path:'test-results/studyroom/calendar-desktop.png',fullPage:true});await teacher.setViewportSize({width:320,height:760});
  assert(await sr.locator('.sr-calendar-toolbar').evaluate(el=>{
   const [month,filters]=Array.from(el.children,child=>child.getBoundingClientRect());
   return Math.abs(month.y+month.height/2-filters.y-filters.height/2)<1;
  }));
  const results=sr.locator('[data-sr-results] .sr-table');
  assert.equal(await results.locator('tbody tr').count(),2);

  await results.getByRole('button',{name:'가상학생하나',exact:true}).click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-person] h3').textContent(),'30101 가상학생하나');
  const attended=sr.locator('.sr-calendar-day.has-record');
  assert.equal(await attended.getAttribute('data-day'),now.date);
  assert.equal(await attended.locator('[data-sr-count-day]').textContent(),'1');
  assert.equal(await results.locator('tbody tr').count(),1);
  const month=sr.locator('[name=month]'),currentMonth=await month.inputValue();
  const previousMonth=new Date(now.date.slice(0,7)+'-01T00:00:00Z');previousMonth.setUTCDate(0);
  await month.fill(previousMonth.toISOString().slice(0,7));await month.dispatchEvent('change');await queryIdle();
  assert.equal(await attended.count(),0);
  assert.match(await sr.locator('[data-sr-results]').textContent(),/기록 없음/);
  await month.fill(currentMonth);await month.dispatchEvent('change');await queryIdle();
  assert.equal(await attended.getAttribute('data-day'),now.date);
  assert.equal(await results.locator('tbody tr').count(),1);
  await sr.locator('[data-sr=session][data-value="야간"]').click();await queryIdle();
  assert.equal(await attended.count(),0);
  assert.equal(await results.count(),0);
  await sr.locator('[data-sr=session][data-value=""]').click();await queryIdle();
  assert.equal(await attended.getAttribute('data-day'),now.date);
  assert.deepEqual(await results.getByRole('columnheader').allTextContents(),['학번','이름','좌석','제출','비고']);
  assert.equal(await results.locator('tbody tr').evaluate(row=>getComputedStyle(row).display),'table-row');
  assert.match(await results.locator('tbody tr').textContent(),/30101.*가상학생하나.*99.*가상 특이사항/);
  assert.match(await results.locator('tbody td').nth(3).textContent(),/^\d{2}:\d{2}$/);
  assert.equal(await results.locator('[data-sr=edit], [data-sr=history]').count(),0);
  assert(await results.evaluate(e=>e.scrollWidth<=e.clientWidth));
  assert(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const noteFillsCell=async()=>{
   const cell=results.locator('.sr-query-note').first();await cell.scrollIntoViewIfNeeded();
   return cell.evaluate(cell=>{
    const rect=cell.getBoundingClientRect(),button=cell.querySelector('button');
    return [[2,2],[rect.width-2,2],[2,rect.height-2],[rect.width-2,rect.height-2]].every(([x,y])=>document.elementFromPoint(rect.x+x,rect.y+y)===button);
   });
  };
  assert(await noteFillsCell(),'the note button fills its entire table cell');
  const noteCell=results.locator('.sr-query-note').first();await noteCell.hover();
  assert.equal(await noteCell.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await noteCell.locator('button').evaluate(el=>getComputedStyle(el).textDecorationLine),'underline');
  await teacher.screenshot({path:'test-results/studyroom/query-search-note-mobile.png',fullPage:true});
  await teacher.screenshot({path:'.impeccable/review/mobile.png',fullPage:true});
  await results.locator('[data-sr=readNote]').click({position:{x:1,y:1}});
  const note=sr.locator('dialog textarea[name=note]');
  assert.equal(await note.inputValue(),'가상 특이사항');
  assert.equal(await sr.locator('dialog [name=change]').count(),0);
  for(const text of ['가'.repeat(51),'🙂'.repeat(38),'a'.repeat(151)]){
   await note.fill(text);assert.equal(await note.evaluate(el=>el.checkValidity()),false);
  }
  await sr.locator('dialog button.primary').click();assert(await sr.locator('dialog').isVisible(),'overlong notes cannot be submitted');
  await note.fill('가'.repeat(50));assert.equal(await note.evaluate(el=>el.checkValidity()),true);
  assert.equal(await sr.locator('#sr-note-bytes').textContent(),'150 / 150 byte');
  const editedNote=('가상 비고 수정\n'+'긴 비고 '.repeat(7)).trim();
  const beforeSave=requests.length;
  await note.fill(editedNote);await sr.locator('dialog button.primary').click();await queryIdle();
  assert.deepEqual(requests.slice(beforeSave).map(r=>r.op),['change'],'note saves update the returned row without rereading the list');
  assert(await noteFillsCell(),'a multiline note retains the full-cell click target');
  assert(await results.locator('[data-sr=readNote]').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'a multiline note is fully visible');
  await results.locator('[data-sr=readNote]').click();assert.equal(await note.inputValue(),editedNote);
  await sr.locator('dialog button[value=delete]').click();await queryIdle();
  const writeNote=results.getByRole('button',{name:'30101 가상학생하나 비고 편집',exact:true});
  assert.equal(await writeNote.count(),1);
  assert.equal(await writeNote.textContent(),'');
  assert(await noteFillsCell(),'an empty note retains the full-cell click target');
  assert.equal((await h.sql("SELECT note FROM sr_attendance WHERE student_number='30101'")).results[0].note,'');
  await writeNote.focus();await teacher.keyboard.press('Enter');
  assert.equal(await note.inputValue(),'');
  assert.equal(await sr.locator('dialog button[value=delete]').count(),0);
  await note.fill('일반 교사 신규 비고');await sr.locator('dialog button.primary').click();await queryIdle();
  assert.equal(await results.locator('[data-sr=readNote]').textContent(),'일반 교사 신규 비고');
  assert.equal((await h.sql("SELECT note FROM sr_attendance WHERE student_number='30101'")).results[0].note,'일반 교사 신규 비고');
  await searchForm.getByRole('button',{name:'초기화',exact:true}).click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-person]').isHidden(),true);
  await day.click();await queryIdle();
  assert.equal(await results.locator('tbody tr').count(),2);
  assert.equal(await sr.getByRole('button',{name:'전체 학생',exact:true}).count(),0);
  await h.sql("UPDATE students SET name='가상학생하나' WHERE id='student-two'");
  await search.fill('가상학생하나');await matches.getByRole('option').nth(1).waitFor();
  assert.deepEqual(await matches.getByRole('option').allTextContents(),['30101 가상학생하나','30102 가상학생하나']);
  assert(await sr.locator('[data-sr-person]').isHidden());
  await matches.getByRole('option',{name:'30102 가상학생하나',exact:true}).click();await queryIdle();
  assert(await sr.locator('[data-sr-person]').isHidden());
  await searchForm.getByRole('button',{name:'검색',exact:true}).click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-person] h3').textContent(),'30102 가상학생하나');
  await h.sql("UPDATE students SET name='가상학생둘' WHERE id='student-two'");
  await searchForm.getByRole('button',{name:'초기화',exact:true}).click();await queryIdle();
  await teacher.setViewportSize({width:1280,height:900});
  await day.click();await queryIdle();assert(await noteFillsCell());
  const controls=await searchForm.evaluate(form=>{
   const input=form.querySelector('input').getBoundingClientRect();
   return [...form.querySelectorAll('button')].every(b=>Math.abs(b.getBoundingClientRect().top-input.top)<=1&&Math.abs(b.getBoundingClientRect().height-input.height)<=1);
  });
  assert(controls,'search actions align with the input');
  await teacher.screenshot({path:'test-results/studyroom/ipad-query-fixed.png',fullPage:true});
  let release;const gate=new Promise(resolve=>release=resolve);
  await teacher.route('**/api/studyroom',async route=>{
   if(route.request().postDataJSON().op==='query')await gate;
   await route.fallback();
  });
  await sr.locator('[data-sr=session][data-value="야간"]').click();
  await sr.locator('[data-sr=view][data-view=current]').click();release();
  await queryIdle();assert(await sr.locator('.sr-seat-grid').isVisible(),'navigation during a slow read is retained');
  await teacher.unroute('**/api/studyroom');
 });
 await step('attendance lists keep sorting and grade selection across refresh, note saves, and history pages',async()=>{
  for(const [number,seat] of [['1','04'],['2','03']]){
   assert((await h.mutation('saveStudent',{student:{grade:'1',classNum:'1',number,name:'가상분류',choices:{}}},admin.cookie)).ok);
   assert((await api('submit',{studentNumber:'1010'+number,seat,requestId:crypto.randomUUID()})).ok);
  }
  await h.sql("UPDATE sr_attendance SET first_at=CASE student_number WHEN '30101' THEN ? WHEN '30102' THEN ? ELSE ? END",now.date+'T00:02:00+09:00',now.date+'T00:03:00+09:00',now.date+'T00:01:00+09:00');
  const grades=sr.getByRole('group',{name:'학년',exact:true}),grade=n=>grades.getByRole('button',{name:n,exact:true});
  const rowNumbers=list=>list.locator('tbody td:first-child').allTextContents();
  const header=(list,key)=>list.locator('th').filter({has:list.page().locator('[data-sr=sort][data-value='+key+']')});
  const keys={
   name:[['10101','10102','30102','30101'],['30101','30102','10101','10102']],
   seat:[['10102','10101','30102','30101'],['30101','30102','10101','10102']],
   first_at:[['10101','10102','30101','30102'],['30102','30101','10101','10102']],
   student_number:[['10101','10102','30101','30102'],['30102','30101','10102','10101']]
  };
  const verifySort=async list=>{
   assert.equal(await header(list,'student_number').getAttribute('aria-sort'),'ascending');
   for(const [key,[ascending,descending]] of Object.entries(keys)){
    const column=header(list,key),control=column.locator('button');
    await control.focus();await teacher.keyboard.press('Enter');
    assert.equal(await column.getAttribute('aria-sort'),'ascending');
    assert.deepEqual(await rowNumbers(list),ascending);
    assert(await control.evaluate(el=>document.activeElement===el),'sorting retains keyboard focus');
    await teacher.keyboard.press('Space');
    assert.equal(await column.getAttribute('aria-sort'),'descending');
    assert.equal(await list.locator('[aria-sort]').count(),1);
    assert.deepEqual(await rowNumbers(list),descending);
   }
  };
  const pads=list=>list.locator('td').evaluateAll(cells=>cells.every(cell=>{
   const s=getComputedStyle(cell);return parseFloat(s.paddingTop)<=4&&parseFloat(s.paddingBottom)<=4;
  }));
  const current=sr.locator('[data-sr-list]');
  await teacher.setViewportSize({width:1280,height:900});
  assert(await grades.isHidden());
  await sr.locator('[data-sr=display][data-value=list]').click();
  await sr.locator('[data-sr=refresh]').click();await idle();
  await verifySort(current);
  assert(await pads(current));
  await grade('1학년').focus();await teacher.keyboard.press('Space');
  assert.deepEqual(await rowNumbers(current),['10102','10101']);
  assert.match(await sr.locator('[data-sr-count]').textContent(),/^1학년 2명 \/ 전체 4명/);
  assert.equal(await grade('1학년').getAttribute('aria-pressed'),'true');
  assert((await api('refreshInterval',{seconds:15,expectedRevision:await rev()})).ok);
  await sr.locator('[data-sr=refresh]').click();await idle();
  await Promise.all([teacher.waitForResponse(res=>res.url().endsWith('/api/studyroom')&&res.request().postDataJSON()?.op==='dashboard'),teacher.clock.fastForward(15000)]);
  await idle();
  assert.deepEqual(await rowNumbers(current),['10102','10101']);
  assert.equal(await header(current,'student_number').getAttribute('aria-sort'),'descending');
  assert.equal(await grade('1학년').getAttribute('aria-pressed'),'true');
  await current.locator('[data-sr=readNote]').first().click();
  await sr.locator('dialog [name=note]').fill('가상 정렬 검증');await sr.locator('dialog button.primary').click();await idle();
  assert.deepEqual(await rowNumbers(current),['10102','10101']);
  await grade('전체').click();assert.match(await sr.locator('[data-sr-count]').textContent(),/^출석 4명/);
  assert((await api('refreshInterval',{seconds:0,expectedRevision:await rev()})).ok);
  await sr.locator('[data-sr=refresh]').click();await idle();
  await teacher.screenshot({path:'test-results/studyroom/current-list-desktop.png',fullPage:true});
  await teacher.setViewportSize({width:640,height:820});
  assert(await pads(current));
  assert(await current.evaluate(el=>el.scrollWidth<=el.clientWidth));
  assert(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await teacher.screenshot({path:'test-results/studyroom/current-list-mobile.png',fullPage:true});
  const queryIdle=()=>teacher.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');
  await sr.locator('[data-sr=view][data-view=query]').click();await queryIdle();
  const day=sr.locator('[data-sr=day][data-day="'+now.date+'"]'),history=sr.locator('[data-sr-results] .sr-table').first();
  await day.click();await queryIdle();
  await verifySort(history);
  await grade('1학년').click();
  assert.deepEqual(await rowNumbers(history),['10102','10101']);
  await grade('2학년').click();
  assert.match(await sr.locator('[data-sr-results]').textContent(),/기록 없음/);
  await grade('1학년').click();
  await history.locator('[data-sr=studentCalendar]').first().click();await queryIdle();
  assert(await grades.isHidden());
  await sr.locator('[data-sr-form=search] button[type=reset]').click();await queryIdle();
  let pageRows;
  await teacher.route('**/api/studyroom',async route=>{
   const args=route.request().postDataJSON();
   if(args.op!=='query'||!args.recordsOnly)return route.fallback();
   const response=await route.fetch(),result=await response.json();
   if(args.offset)result.data.rows=pageRows;
   else{
    pageRows=result.data.rows.map(r=>({...r,id:r.id+'-second',session_id:r.session_id+'-second'}));
    result.data.next=200;result.data.rows.push(...pageRows);
   }
   await route.fulfill({response,json:result});
  });
  await day.click();await queryIdle();
  assert.equal(await grade('1학년').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await sr.locator('[data-sr-results] h4').allTextContents(),['오전','오전']);
  for(const group of await sr.locator('[data-sr-results] .sr-table').all())assert.deepEqual(await rowNumbers(group),['10102','10101']);
  await sr.locator('[data-sr=next]').click();await queryIdle();
  assert.equal(await sr.locator('[data-sr-results] h4').textContent(),'오전');
  assert.equal(await grade('1학년').getAttribute('aria-pressed'),'true');
  assert.equal(await header(history,'student_number').getAttribute('aria-sort'),'descending');
  assert.deepEqual(await rowNumbers(history),['10102','10101']);
  await sr.locator('[data-sr=previous]').click();await queryIdle();
  assert.deepEqual(await sr.locator('[data-sr-results] h4').allTextContents(),['오전','오전']);
  await teacher.unroute('**/api/studyroom');
 });
 await step('administrator schedule form is functional, preserve shared roster editing',async()=>{
  const manager=await ctx.newPage();manager.on('pageerror',e=>errors.push(e.message));
  await manager.goto(url+'/admin.html');await manager.locator('#password').fill('1234');await manager.locator('form[data-form=login] button').click();await clickMenu(manager,manager.locator('[data-action=admin-tab][data-tab=studyroom]'));
  const m=manager.locator('.studyroom'),managerIdle=()=>manager.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');
  await managerIdle();
  await m.locator('[data-sr=display][data-value=list]').click();
  const sort=m.locator('[data-sr=sort]').first(),grade=m.getByRole('group',{name:'학년',exact:true});
  await sort.waitFor();await grade.waitFor();
  const settingsGate=Promise.withResolvers();
  const settingsRequest=request=>request.url().endsWith('/api/studyroom')&&request.postDataJSON()?.op==='settings';
  const delaySettings=async route=>{if(settingsRequest(route.request()))await settingsGate.promise;return route.fallback();};
  await manager.route('**/api/studyroom',delaySettings);
  try{
   await Promise.all([manager.waitForRequest(settingsRequest),m.locator('[data-sr=view][data-view=settings]').click()]);
   assert.equal(await m.getAttribute('aria-busy'),'true');
   assert.equal(await sort.isVisible(),false);
   assert.equal(await grade.isVisible(),false);
  }finally{settingsGate.resolve();}
  await m.locator('[data-sr-form=schedule]').waitFor();await managerIdle();assert.equal(await m.locator('.sr-rule').count(),1);
  await manager.unroute('**/api/studyroom',delaySettings);
  assert.equal(await m.locator('[data-sr-form=staff]').count(),0);
  assert.equal(await m.getByRole('button',{name:'이용 학생',exact:true}).count(),0);
  await m.locator('[data-sr-form=schedule] button:not([type=button])').click();await manager.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');assert.equal((await h.sql('SELECT count(*) n FROM sr_schedules')).results[0].n,2);
  const refreshForm=m.locator('[data-sr-form=refreshInterval]');
  assert.equal(await refreshForm.getByLabel('자동 새로고침').inputValue(),'0');
  await refreshForm.getByLabel('자동 새로고침').selectOption('60');
  await refreshForm.getByRole('button',{name:'저장'}).click();
  await manager.waitForFunction(()=>document.querySelector('.studyroom')?.getAttribute('aria-busy')==='false');
  assert.equal((await api('dashboard')).data.refreshSeconds,60);
  await manager.screenshot({path:'test-results/studyroom/settings-desktop.png',fullPage:true});await manager.close();
 });
 await step('all browser windows can close before the server-side scheduled archive runs',async()=>{
  await ctx.close();const worker=await h.mf.getWorker();await worker.scheduled({scheduledTime:new Date(now.date+'T23:59:01+09:00'),cron:'* * * * *'});assert.equal((await h.sql('SELECT count(*) n FROM sr_archives')).results[0].n,1);assert.equal((await h.sql("SELECT count(*) n FROM sr_sessions WHERE status='closed'")).results[0].n,1);assert.equal((await h.sql('SELECT count(*) n FROM sr_attendance')).results[0].n,4);
 });
 await step('the new holder of a student number can re-confirm and submit after a legacy request ID is rejected',async()=>{
  const roster=await harness({studyroom:true});
  const committed=Promise.withResolvers(),dropped=Promise.withResolvers();
  let student;
  try{
   const {api,admin}=await setupStudyroom(roster);
   const url=await roster.listen();
   student=await browser.newPage();student.on('pageerror',e=>errors.push(e.message));
   await student.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
   const submitted=[];
   await student.route('**/api/studyroom',async route=>{
    const {op,...body}=route.request().postDataJSON();
    if(op!=='submit'||submitted.push(body)>1)return route.fallback();
    const {studentKey,...legacyBody}=body;
    const response=await route.fetch({postData:{op,...legacyBody}});
    committed.resolve(await response.json());
    await dropped.promise;
    await route.abort('failed').catch(()=>{});
   });
   const confirmName=async name=>{
    await student.locator('[name=grade]').selectOption('3');
    await student.locator('#student-form button').click();
    await student.locator('#confirmation').waitFor();
    assert.equal(await student.locator('#student-name').textContent(),'30101 '+name);
   };
   await student.goto(url+'/studyroom-student.html?seat=01');
   await confirmName('가상학생하나');
   await student.locator('#submit').click();
   const original=await waitForCommit(committed.promise);assert(original.ok);
   assert.equal(original.data.name,'가상학생하나');
   const [old]=submitted,legacyKey='studyroom-request:'+old.expectedSessionId+':01:30101';
   await student.evaluate(([key,id])=>sessionStorage.setItem(key,id),[legacyKey,old.requestId]);
   await student.reload();dropped.resolve();
   for(const [id,number] of [['student-one','3'],['student-two','1']]){
    const {student:row}=(await roster.api('adminStudent',{id},admin.cookie)).data;
    const saved=await roster.mutation('saveStudent',{student:{...row,number}},admin.cookie);
    assert(saved.ok,JSON.stringify(saved));
   }
   await confirmName('가상학생둘');
   const {data:confirmed}=await api('studentInfo',old,'');
   assert.notEqual(confirmed.studentKey,old.studentKey);
   assert.deepEqual((await api('submit',old,'')).data,original.data);
   assert.deepEqual((await api('submit',{...old,studentKey:undefined},'')).data,original.data);
   const attendance=async()=>(await roster.sql('SELECT id,student_id,state FROM sr_attendance ORDER BY student_id')).results;
   assert.deepEqual(await attendance(),[{id:original.data.recordId,student_id:'student-one',state:'active'}]);
   const cancelled=await api('change',{change:'cancel',recordId:original.data.recordId,expectedRecordVersion:1,requestId:crypto.randomUUID()});
   assert(cancelled.ok,JSON.stringify(cancelled));
   const snapshotA=async()=>{
    const [record]=(await roster.sql('SELECT * FROM sr_attendance WHERE id=?',original.data.recordId)).results;
    const events=(await roster.sql('SELECT * FROM sr_events WHERE person_id=? ORDER BY seq',record.person_id)).results;
    return {record,events};
   };
   const before=await snapshotA();
   const [rejection]=await Promise.all([
    student.waitForResponse(res=>res.url().endsWith('/api/studyroom')&&res.request().postDataJSON()?.op==='submit'),
    student.locator('#submit').click()
   ]);
   const rejected=await rejection.json();
   assert.deepEqual([rejection.status(),rejected.code,rejected.data],[409,'STUDENT_CHANGED',undefined]);
   await student.getByRole('status').filter({hasText:'학생 정보가 변경되었습니다. 이름 확인을 다시 하세요.'}).waitFor();
   assert.equal(submitted[1].requestId,old.requestId);
   assert.equal(submitted[1].studentKey,confirmed.studentKey);
   const keys=[legacyKey,legacyKey+':'+confirmed.studentKey,legacyKey+':'+old.studentKey];
   assert.deepEqual(await student.evaluate(keys=>keys.map(key=>sessionStorage.getItem(key)),keys),[null,null,old.requestId]);
   assert(await student.locator('#student-form').isVisible());
   assert(await student.locator('#confirmation').isHidden());
   assert.deepEqual(await attendance(),[{id:original.data.recordId,student_id:'student-one',state:'cancelled'}]);
   assert.deepEqual(await snapshotA(),before);
   await confirmName('가상학생둘');
   await student.locator('#submit').click();
   await student.getByRole('status').filter({hasText:'가상학생둘 · 01번 출석 제출 완료'}).waitFor();
   assert.equal(submitted.length,3);
   const fresh=submitted[2];
   assert.equal(fresh.studentKey,confirmed.studentKey);
   assert.notEqual(fresh.requestId,old.requestId);
   const events=(await roster.sql("SELECT request_id,record FROM sr_events WHERE action='submit'")).results;
   assert.equal(events.length,2);
   const result=JSON.parse(events.find(e=>e.request_id===fresh.requestId).record);
   assert.equal(result.name,'가상학생둘');
   assert.deepEqual(await attendance(),[
    {id:original.data.recordId,student_id:'student-one',state:'cancelled'},
    {id:result.recordId,student_id:'student-two',state:'active'}
   ]);
   assert.deepEqual(await snapshotA(),before);
  }finally{dropped.resolve();if(student)await student.close();await roster.close();}
 });
 await step('the updated student page replays a legacy pending ID without restoring a cancelled attendance record',async()=>{
  const roster=await harness({studyroom:true}),release=Promise.withResolvers();
  let student;
  try{
   const {api,teacher}=await setupStudyroom(roster);
   const url=await roster.listen();
   const input={studentNumber:'30101',seat:'01'},requestId=crypto.randomUUID();
   const confirmed=await api('studentInfo',input,'');assert(confirmed.ok);
   const legacyKey='studyroom-request:'+confirmed.data.session.id+':01:30101';
   const key=legacyKey+':'+confirmed.data.studentKey;
   student=await browser.newPage();student.on('pageerror',e=>errors.push(e.message));
   await student.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
   await student.goto(url+'/studyroom-student.html?seat=01');
   await student.evaluate(([key,id])=>sessionStorage.setItem(key,id),[legacyKey,requestId]);
   const original=await api('submit',{...input,requestId},'');assert(original.ok);
   const cancelled=await api('change',{change:'cancel',recordId:original.data.recordId,expectedRecordVersion:1,requestId:crypto.randomUUID()},teacher.cookie);
   assert(cancelled.ok,JSON.stringify(cancelled));assert.equal(cancelled.data.state,'cancelled');
   await student.reload();
   await student.locator('[name=grade]').selectOption('3');await student.locator('#student-form button').click();
   await student.locator('#confirmation').waitFor();
   const submitRequest=request=>request.url().endsWith('/api/studyroom')&&request.postDataJSON()?.op==='submit';
   await student.route('**/api/studyroom',async route=>{if(submitRequest(route.request()))await release.promise;return route.fallback();});
   const [request]=await Promise.all([student.waitForRequest(submitRequest),student.locator('#submit').click()]);
   assert.equal(request.postDataJSON().requestId,requestId);
   assert.equal(request.postDataJSON().studentKey,confirmed.data.studentKey);
   const stored=()=>student.evaluate(keys=>keys.map(key=>sessionStorage.getItem(key)),[legacyKey,key]);
   assert.deepEqual(await stored(),[requestId,null]);
   const [response]=await Promise.all([student.waitForResponse(res=>submitRequest(res.request())),release.resolve()]);
   assert.equal(response.status(),200);
   assert.deepEqual((await response.json()).data,original.data);
   await student.getByRole('status').filter({hasText:'가상학생하나 · 01번 출석 제출 완료'}).waitFor();
   assert.deepEqual(await stored(),[null,null]);
   assert.deepEqual((await roster.sql('SELECT id,state,version FROM sr_attendance')).results,[{id:original.data.recordId,state:'cancelled',version:cancelled.data.version}]);
   assert.deepEqual((await roster.sql("SELECT request_id FROM sr_events WHERE action='submit'")).results,[{request_id:requestId}]);
  }finally{release.resolve();if(student)await student.close();await roster.close();}
 });
 assert.deepEqual(errors,[]);await writeFile('test-results/studyroom/browser.json',JSON.stringify({environment:'local Miniflare + real D1 SQLite + headless Edge; synthetic data only',steps,errors},null,2));
}finally{if(browser)await browser.close();await h.close();}
