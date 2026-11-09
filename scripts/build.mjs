import {mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist');
// Only remove this generated directory; never touch the original HTML/assets.
if(dist!==resolve(root,'dist'))throw Error('Invalid output path');
await rm(dist,{recursive:true,force:true,maxRetries:5,retryDelay:250});await mkdir(resolve(dist,'assets'),{recursive:true});
for(const file of ['index.html','student.html','teacher.html','admin.html','studyroom-student.html','config.js'])await copyFile(resolve(root,file),resolve(dist,file));
for(const file of ['studyroom.js','studyroom-layout.js','studyroom-student.js','studyroom.css','font.css','pretendard.woff2','app.js','allocations.js','allocation-import.js','transport.js','import.js','assets.js','style.css','xlsx.full.min.js','html2canvas.min.js','LICENSE-SheetJS.txt','LICENSE-Pretendard.txt','LICENSE-html2canvas.txt'])await copyFile(resolve(root,'assets',file),resolve(dist,'assets',file));
await copyFile(resolve(root,'src/password.js'),resolve(dist,'assets/password.js'));
await writeFile(resolve(dist,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Cache-Control: no-cache\n');
const bundle=await build({entryPoints:[resolve(root,'src/worker.js')],bundle:true,write:false,format:'esm',platform:'browser'});
if(/SpreadsheetApp|PropertiesService|google\.script|script\.google/.test(bundle.outputFiles[0].text))throw Error('Legacy server dependency found');
console.log('Workers Static Assets build complete. Student data and server files are excluded.');

await mkdir(resolve(dist,'class-swap'),{recursive:true});
await copyFile(resolve(root,'assets/class-swap/view.html'),resolve(dist,'class-swap/view.html'));
await build({entryPoints:[resolve(root,'assets/class-swap/app.js')],outfile:resolve(dist,'class-swap/app.js'),bundle:true,format:'esm',platform:'browser',charset:'utf8'});
