import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {harness} from './harness.mjs';
import {backup} from './fixture.mjs';
import '../scripts/build-pages.mjs';
// Reserved test hosts only. Every browser request is fulfilled locally or aborted.
const pages='https://timetable-pages.test',api='https://timetable-api.test',h=await harness({frontendOrigin:pages});
const cookieAdmin=await h.login();assert((await h.mutation('restore',{backup:backup()},cookieAdmin.cookie)).ok);
let browser;const errors=[],requests=[],steps=[];await mkdir('test-results',{recursive:true});
async function step(name,fn){await fn();steps.push(name);console.log('PASS '+name);}
try{
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 // An unusable third-party cookie must never be needed or sent by the Pages app.
 await context.addCookies([{name:'__Host-tt_admin',value:'0'.repeat(64),domain:'timetable-api.test',path:'/',secure:true,httpOnly:true,sameSite:'None'}]);
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===pages){
   const relative=url.pathname.replace(/^\/timetable\/?/,'')||'index.html',path=resolve('.cache/pages-site',relative);
   if(!path.startsWith(resolve('.cache/pages-site')))return route.abort();
   try{let body=await readFile(path);if(relative==='config.js'){const config=JSON.parse(body.toString().replace(/^window.TIMETABLE_CONFIG=/,'').replace(/;\s*$/,''));config.apiBase=api+'/api/';body=Buffer.from('window.TIMETABLE_CONFIG='+JSON.stringify(config)+';');}return await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream',body});}catch{return route.fulfill({status:404,body:'Not found'});}
  }
  if(url.origin===api&&url.pathname.startsWith('/api/')){
   assert.equal(req.headers().cookie,undefined);requests.push({action:url.pathname.slice(5),method:req.method(),origin:req.headers().origin,authorized:Boolean(req.headers().authorization)});
   const response=await h.mf.dispatchFetch(req.url(),{method:req.method(),headers:req.headers(),...(['GET','OPTIONS'].includes(req.method())?{}:{body:req.postData()||'{}'})});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }
  return route.abort();
 });
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false');
 const login=async()=>{await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await page.locator('[data-action=new-student]').waitFor();await idle();};
 await step('Pages displays the mobile student timetable without leaving its own origin',async()=>{
  await page.goto(pages+'/timetable/student.html');await idle();await page.locator('#student-number').fill('30101');await page.locator('form[data-form=student] button').click();await page.locator('.tt').waitFor();await idle();assert.equal(new URL(page.url()).origin,pages);assert.equal(await page.locator('.tt tbody tr').count(),7);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 });
 await step('Pages admin login, real D1 save and history work without third-party cookies',async()=>{
  await page.goto(pages+'/timetable/admin.html');await idle();await login();await page.locator('[data-action=edit-student]').first().click();await page.locator('#edit-name').waitFor();await idle();await page.locator('#edit-name').fill('Pages입력보호');await page.locator('form[data-form=save-student] button.primary').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);await idle();assert.equal((await h.api('adminStudent',{id:'student-one'},cookieAdmin.cookie)).data.student.name,'Pages입력보호');assert.equal(new URL(page.url()).origin,pages);
  const storage=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));assert(!/[a-f0-9]{64}/.test(JSON.stringify(storage)));assert.equal(JSON.parse(storage.session['timetable.admin']).token,'memory');
 });
 await step('refresh requires a new login and logout revokes the in-memory Pages session',async()=>{
  await page.reload();await idle();await page.locator('#password').waitFor();assert.equal(await page.locator('[data-action=new-student]').count(),0);await login();await page.locator('[data-action=logout]').click();await page.locator('#password').waitFor();await idle();assert.equal(await page.evaluate(()=>TTApi.hasSession('admin')),false);
 });
 // Intercepted browser requests can omit network preflights; pages-api.test covers them separately.
 assert(requests.filter(r=>r.method==='POST').every(r=>r.origin===pages));assert(requests.some(r=>r.action==='saveStudent'&&r.authorized));assert.deepEqual(errors,[]);
 await writeFile('test-results/pages-browser.json',JSON.stringify({steps,requests,errors},null,2)+'\n');
}finally{await browser?.close();await h.close();}
