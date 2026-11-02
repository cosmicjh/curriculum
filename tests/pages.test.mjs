import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import '../scripts/build-pages.mjs';
test('Pages serves the original app and embedded font without redirects, private data or server code',async()=>{
 const files=await readdir('.cache/pages-site',{recursive:true});
 assert(!files.some(f=>/private|\.dev|migrations|fixture|server|^src/.test(f)));
 for(const name of ['index.html','student.html','teacher.html','admin.html']){
  const original=await readFile(name,'utf8'),built=await readFile('.cache/pages-site/'+name,'utf8'),normalize=s=>s.replace(/(\b(?:src|href)="(?:\.\/)?(?:config\.js|assets\/[^"?]+\.(?:js|css)))(?:\?[^"#]*)?(?=")/g,'$1');assert.equal(normalize(built),normalize(original));assert(!built.includes('location.replace'));assert(built.includes('embedded-pretendard'));assert.match(built,/config\.js\?v=[a-f0-9]{12}/);
 }
 const config=await readFile('.cache/pages-site/config.js','utf8');assert(config.includes('https://school-timetable.cosmicjh.workers.dev/api/'));assert(!config.includes('PASSWORD_'));
 assert(!files.includes('_headers'));assert(!files.includes('scripts/build-pages.mjs'));
});
