import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import '../scripts/build-pages.mjs';
test('Pages serves the app and shared Pretendard font without redirects, private data or server code',async()=>{
 const files=await readdir('.cache/pages-site',{recursive:true});
 assert(!files.some(f=>/private|\.dev|migrations|fixture|server|^src/.test(f)));
 for(const name of ['index.html','student.html','teacher.html','admin.html','studyroom-student.html']){
  const original=await readFile(name,'utf8'),built=await readFile('.cache/pages-site/'+name,'utf8'),normalize=s=>s.replace(/(\b(?:src|href)="(?:\.\/)?(?:config\.js|assets\/[^"?]+\.(?:js|css)))(?:\?[^"#]*)?(?=")/g,'$1');assert.equal(normalize(built),normalize(original));assert(!built.includes('location.replace'));assert(built.includes('assets/font.css'));assert(!built.includes('rel="preload" href="assets/pretendard.woff2"'));assert(!built.includes('data:font'));assert.match(built,/config\.js\?v=[a-f0-9]{12}/);
  assert.match(built,/<title>교육과정 편성·운영 지원 도구<\/title>/);
  assert(built.includes('rel="preload" href="assets/timetable-ui.woff2"'));
 }
 assert(files.some(f=>f.replaceAll('\\','/')==='assets/pretendard.woff2'));
 assert(files.some(f=>f.replaceAll('\\','/')==='assets/timetable-ui.woff2'));
 assert.match(await readFile('.cache/pages-site/assets/font.css','utf8'),/font-display:swap;src:url\("pretendard\.woff2"\)/);
 const config=await readFile('.cache/pages-site/config.js','utf8');assert(config.includes('https://school-timetable.cosmicjh.workers.dev/api/'));assert(!config.includes('PASSWORD_'));
 assert(!files.includes('_headers'));assert(!files.includes('scripts/build-pages.mjs'));
 assert(!files.includes('solver.html'));assert(!files.some(f=>f.replaceAll('\\','/').startsWith('solver/')));
 assert.match(await readFile('.cache/pages-site/404.html','utf8'),/href="\/curriculum\/"/);
 assert.deepEqual(files.filter(f=>f.replaceAll('\\','/').startsWith('class-swap/')).map(f=>f.replaceAll('\\','/').slice('class-swap/'.length)).sort(),['app.js','view.html']);
 const view=await readFile('.cache/pages-site/class-swap/view.html','utf8'),client=await readFile('.cache/pages-site/class-swap/app.js','utf8');
 assert(!/password|loginView|<iframe|<script|<body|@font-face/.test(view));assert.match(client,/export \{/);assert(!/initTransport|TimetableClassSwap|ClassSwapEmbed|fetch\(/.test(client));
});

test('Pages workbook uses source-built hashed entries and the same UI and solver sources',async()=>{
 const root='.cache/pages-site/',view=await readFile(root+'course-allocation/view.html','utf8');
 assert.match(view,/href="\.\.\/assets\/ui\.css\?v=[a-f0-9]{12}"/);
 for(const extension of ['css','js']){
  const path=view.match(new RegExp('\\./(assets/workbook-[A-Z0-9]+\\.'+extension+')'))?.[1];
  assert(path,extension);
  const bundle=await readFile(root+'course-allocation/'+path,'utf8');
  assert.doesNotMatch(bundle,/\/access\/login|\/auth\/password|COURSE_DB/);
 }
 for(const file of ['timetable-model.js','timetable-cpsat.js','timetable-checker.js']){
  assert.equal(await readFile(root+'course-allocation/shared/'+file,'utf8'),await readFile('modules/allocation/shared/'+file,'utf8'));
 }
});
