import {mkdir,readFile,writeFile,copyFile,cp,rm} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist');
// Only remove this generated directory; never touch the original HTML/assets.
if(dist!==resolve(root,'dist'))throw Error('Invalid output path');
await rm(dist,{recursive:true,force:true,maxRetries:5,retryDelay:250});await mkdir(resolve(dist,'assets'),{recursive:true});
for(const file of ['index.html','student.html','teacher.html','admin.html','studyroom-student.html','solver.html','config.js'])await copyFile(resolve(root,file),resolve(dist,file));
for(const file of ['studyroom.js','studyroom-layout.js','studyroom-student.js','studyroom.css','ui.css','font.css','timetable-ui.woff2','pretendard.woff2','app.js','navigation.js','allocations.js','allocation-import.js','transport.js','import.js','assets.js','style.css','xlsx.full.min.js','html2canvas.min.js','LICENSE-SheetJS.txt','LICENSE-Pretendard.txt','LICENSE-html2canvas.txt'])await copyFile(resolve(root,'assets',file),resolve(dist,'assets',file));
const sectionAssignment=resolve(root,'assets/section-assignment'),sectionDist=resolve(dist,'section-assignment');
await mkdir(sectionDist,{recursive:true});
for(const name of ['view.html','style.css'])await copyFile(resolve(sectionAssignment,name),resolve(sectionDist,name));
await build({entryPoints:['app.js','worker.js'].map(name=>resolve(sectionAssignment,name)),outdir:sectionDist,bundle:true,format:'esm',platform:'browser',charset:'utf8',minify:true});
await copyFile(resolve(root,'src/password.js'),resolve(dist,'assets/password.js'));
await writeFile(resolve(dist,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: SAMEORIGIN\n  Cache-Control: no-cache\n'+['/solver','/solver.html','/solver/*'].map(path=>path+'\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n').join(''));
await cp(resolve(root,'assets/solver'),resolve(dist,'solver'),{recursive:true});
// Preserve the package's relative runtime URLs, copying only CP-SAT assets.
const ortools=resolve(root,'node_modules/or-tools-wasm'),lib=resolve(dist,'solver/lib');
await mkdir(resolve(lib,'browser'),{recursive:true});await mkdir(resolve(lib,'wasm'),{recursive:true});
for(const file of ['cp-sat.js','runtime_loader.js','runtime_loader_core.js'])await copyFile(resolve(ortools,'build/javascript/browser',file),resolve(lib,'browser',file));
for(const file of ['cp_sat_runtime.js','cp_sat_runtime.wasm','cp_sat_runtime_asyncify.js','cp_sat_runtime_asyncify.wasm'])await copyFile(resolve(ortools,'build/javascript/wasm',file),resolve(lib,'wasm',file));
await copyFile(resolve(ortools,'LICENSE'),resolve(lib,'LICENSE-Apache-2.0.txt'));
await writeFile(resolve(lib,'NOTICE.txt'),'or-tools-wasm 1.0.0 and OR-Tools CP-SAT\nLicensed under the Apache License, Version 2.0. See LICENSE-Apache-2.0.txt.\nSource: https://github.com/Axelwickm/or-tools-wasm\n');
const course=resolve(root,'modules/allocation'),courseDist=resolve(dist,'course-allocation');
const workbook=await build({absWorkingDir:course,entryPoints:['app/workbook.js','app/workbook.css'],outdir:resolve(courseDist,'assets'),entryNames:'[name]-[hash]',bundle:true,minify:true,format:'esm',target:'es2022',metafile:true});
let courseHtml=await readFile(resolve(course,'index.html'),'utf8');
for(const [file,output] of Object.entries(workbook.metafile.outputs)){
 if(output.entryPoint)courseHtml=courseHtml.replace('./'+output.entryPoint,'./assets/'+basename(file));
}
await writeFile(resolve(courseDist,'view.html'),courseHtml);
await mkdir(resolve(courseDist,'shared'),{recursive:true});
for(const file of ['catalog.js','domain.js','state.js','timetable-model.js','timetable-cpsat.js','timetable-checker.js']){
 await copyFile(resolve(course,'shared',file),resolve(courseDist,'shared',file));
}
const bundle=await build({entryPoints:[resolve(root,'src/worker.js')],bundle:true,write:false,format:'esm',platform:'browser'});
if(/SpreadsheetApp|PropertiesService|google\.script|script\.google/.test(bundle.outputFiles[0].text))throw Error('Legacy server dependency found');
if(/exportSolverModel|시간표_솔버모델|or-tools-wasm|solveTimetable|buildCpModel|checkTimetable|cp_sat_runtime/.test(bundle.outputFiles[0].text))throw Error('Browser timetable solver found in Worker bundle');
console.log('Workers Static Assets build complete. Student data and server files are excluded.');

await mkdir(resolve(dist,'class-swap'),{recursive:true});
await copyFile(resolve(root,'assets/class-swap/view.html'),resolve(dist,'class-swap/view.html'));
await build({entryPoints:[resolve(root,'assets/class-swap/app.js')],outfile:resolve(dist,'class-swap/app.js'),bundle:true,format:'esm',platform:'browser',charset:'utf8'});
