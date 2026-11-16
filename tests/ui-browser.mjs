import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {harness} from './harness.mjs';
import {backup,allocationFixture} from './fixture.mjs';
import {clickMenu} from './navigation-helper.mjs';
import '../scripts/build.mjs';

const h=await harness({studyroom:true,course:true}),results=[];let browser;
try{
 const admin=await h.login();
 assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
 assert((await h.mutation('saveAllocation',{board:allocationFixture()},admin.cookie)).ok);
 const base=await h.listen();
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const idle=()=>page.waitForFunction(()=>document.body.dataset.loading==='false');
 async function inspect(name,width){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(()=>document.fonts.ready);
  // These are interactive data cells and the explicitly retained sidebar state.
  const allowFill='#sidebar-menu button,.cell-button,.allocation-cell,.tt .cell,.sr-seat-grid button,.sr-calendar-day';
  const failures=[];
  for(const frame of page.frames()){
   failures.push(...await frame.evaluate(({width,allowFill})=>{
    const problems=[];
    if(document.documentElement.scrollWidth>innerWidth+1)problems.push('page overflow');
    if(getComputedStyle(document.documentElement).getPropertyValue('--ui-ink').trim()!=='#1f1f1f')problems.push('shared tokens missing');
    if(!getComputedStyle(document.body).fontFamily.startsWith('"Timetable UI"'))problems.push('UI subset must be first');
    function visit(root){
     for(const button of root.querySelectorAll('button')){
      const rect=button.getBoundingClientRect(),style=getComputedStyle(button);
      if(!rect.width||!rect.height||style.visibility==='hidden')continue;
      const label=button.textContent.trim()||button.getAttribute('aria-label');
      if(rect.height<(width<=640?44:32)-.5)problems.push(label+': height '+rect.height);
      if(!button.matches(allowFill)){
       if(style.backgroundColor!=='rgba(0, 0, 0, 0)'||style.backgroundImage!=='none')problems.push(label+': filled');
       if(['Top','Right','Bottom','Left'].some(side=>parseFloat(style['border'+side+'Width'])>0))problems.push(label+': border');
      }
      if(!style.fontFamily.startsWith('"Timetable UI"'))problems.push(label+': font '+style.fontFamily);
      if(button.disabled&&style.textDecorationLine.includes('underline'))problems.push(label+': disabled underline');
      if(button.classList.contains('primary')&&!button.disabled&&!style.textDecorationLine.includes('underline'))problems.push(label+': primary underline missing');
     }
     for(const host of root.querySelectorAll('*'))if(host.shadowRoot)visit(host.shadowRoot);
    }
    visit(document);return problems;
   },{width,allowFill}));
  }
  assert.deepEqual(failures,[],name+' '+width);
  results.push({name,width});
 }
 async function sizes(name){for(const width of [1440,390])await inspect(name,width);}
 await page.goto(base+'/teacher.html');await idle();await sizes('teacher login');
 assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.endsWith('/pretendard.woff2'))),false);
 await page.evaluate(async()=>{
  const sample=document.createElement('p');sample.textContent='\uac02';sample.style.fontFamily='var(--ui-font)';document.body.append(sample);
  await document.fonts.load('16px "Pretendard Variable"','\uac02');sample.remove();
 });
 assert(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.endsWith('/pretendard.woff2'))));
 await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await idle();
 for(const tab of ['studentTimetable','timetable','roster','allocation','classSwap','batch','studyroom']){
  await clickMenu(page,page.locator('[data-tab="'+tab+'"]'));await idle();
  if(tab==='classSwap')await page.locator('#class-swap-pane #appView').waitFor();
  await sizes('teacher '+tab);
 }
 await page.goto(base+'/admin.html');await idle();
 await page.locator('#password').fill('1234');await page.locator('form[data-form=login] button').click();await idle();
 for(const tab of ['sectionAssignment','students','timetable','allocation','classSwap','settings']){
  await clickMenu(page,page.locator('[data-tab="'+tab+'"]'));await idle();
  if(tab==='sectionAssignment')await page.frameLocator('#section-assignment-pane iframe').locator('#fileSelectBtn').waitFor();
  await sizes('admin '+tab);
 }
 await page.goto(base+'/studyroom-student.html?seat=1');await sizes('studyroom student');
 await page.goto(base+'/solver.html');await sizes('browser solver');
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/ui-browser.json',JSON.stringify(results,null,2));
 console.log('PASS shared UI: '+results.length+' desktop/mobile module checks');
}finally{await browser?.close();await h.close();}
