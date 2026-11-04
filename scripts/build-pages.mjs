import {cp,writeFile,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import './build.mjs';
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'.cache/pages-site');
if(output!==resolve(root,'.cache/pages-site'))throw Error('Invalid Pages output path');
await rm(output,{recursive:true,force:true,maxRetries:5,retryDelay:250});
await cp(resolve(root,'dist'),output,{recursive:true});
await rm(resolve(output,'_headers'),{force:true});
const apiBase='https://school-timetable.cosmicjh.workers.dev/api/';
const source=await Promise.all(['app.js','allocations.js','allocation-import.js','transport.js','assets.js','import.js','password.js','style.css','xlsx.full.min.js','html2canvas.min.js'].map(name=>readFile(resolve(output,'assets',name),'utf8')));
source.push(...await Promise.all(['app.js','view.html'].map(name=>readFile(resolve(output,'class-swap',name),'utf8'))));
const version=createHash('sha256').update(source.map(s=>s.replaceAll('\r\n','\n')).join('\n')+apiBase).digest('hex').slice(0,12);
await writeFile(resolve(output,'config.js'),"window.TIMETABLE_CONFIG="+JSON.stringify({schoolName:'첨단고등학교',apiBase,assetVersion:version})+';\n');
// A previously cached Apps Script/redirect client must not replace this release.
for(const name of ['index.html','student.html','teacher.html','admin.html']){
 const file=resolve(output,name),html=await readFile(file,'utf8');
 await writeFile(file,html.replace(/(\b(?:src|href)="(?:\.\/)?(?:config\.js|assets\/[^"?]+\.(?:js|css)))(?:\?[^"#]*)?(?=")/g,'$1?v='+version));
}
await writeFile(resolve(output,'.nojekyll'),'');
await writeFile(resolve(output,'404.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>개인 시간표</title><p>페이지를 찾을 수 없습니다. <a href="/timetable/">개인 시간표로 이동</a></p></html>');
console.log('GitHub Pages application build complete: .cache/pages-site/');
