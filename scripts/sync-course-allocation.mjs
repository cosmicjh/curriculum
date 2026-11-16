import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..'),upstream=resolve(process.argv[2]||resolve(root,'..')),vendor=resolve(root,'vendor/course-allocation');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'}).trim();
assert(commit.startsWith('eb75f3c'),'Review adaptations before changing the approved upstream commit');
assert.equal(execFileSync('git',['diff','--name-only','HEAD','--','index.html','app','shared'],{cwd:upstream,encoding:'utf8'}).trim(),'','Upstream UI sources must match the pinned commit');
function replaceOnce(source,before,after){assert.equal(source.split(before).length,2,'Upstream adaptation marker changed: '+before.slice(0,70));return source.replace(before,after);}
function adaptWorkbook(source){
 source=replaceOnce(source,'(async()=>{','const workbookReady=(async()=>{');
 source=replaceOnce(source,'<strong>교과 시수배당</strong><span>','<strong>시수배당표</strong><span title="시수배당 학기">');
 source=replaceOnce(source,"btn('hours-import','분반배정 가져오기','upload','small',cloud.saving||cloud.loading?'disabled':'')", "btn('server-hours','서버 분반배정','','small',cloud.saving||cloud.loading?'disabled':'')+btn('hours-import','분반배정 파일','upload','small',cloud.saving||cloud.loading?'disabled':'')");
 source=source.replaceAll('통합시간표로 전달','교육과정 편성·운영 지원 도구로 전달');
 source=replaceOnce(source,"'hours-import','reset-data'].includes", "'hours-import','server-hours','reset-data'].includes");
 source=source.replaceAll('{loginDialog();return;}',"{toast('관리자 모드에서 실행하세요.',true);return;}");
 source=replaceOnce(source,"'performance':showPerformance,", "'server-hours':()=>openServerHours(),'performance':showPerformance,");
 source=replaceOnce(source,"function hoursImportDialog(data,initial){",`async function openServerHours(term,id){
 requireImportAdmin();
 const saved=await api('/assignment-hours','GET',term?{term}:{});
 if(!saved)throw Error('현재 학기에 전달된 분반배정 자료가 없습니다.');
 if(id&&id!==saved.id)throw Error('더 최근 전달 자료가 있습니다. 서버 분반배정에서 확인하세요.');
 await ensureAllDepartments({stableGlobal:true});
 if(state.school.year+'-'+state.school.semester!==saved.term)throw Error('시수배당 학기가 변경되었습니다. 다시 불러오세요.');
 hoursImportDialog(saved.data);
}
function hoursImportDialog(data,initial){`);
 source=replaceOnce(source,"window.addEventListener('beforeunload',", "window.hasUnsavedCourseChanges=()=>cloud.dirty.size>0||cloud.globalDirty||cloud.saving;\nwindow.addEventListener('beforeunload',");
 source=replaceOnce(source,'})().catch(error=>','return openServerHours;\n})().catch(error=>');
 return source+`\nwindow.openSectionAssignmentHours=async(term,id)=>{const open=await workbookReady;if(!open)throw Error('시수배당표를 다시 열어 주세요.');await open(term,id);};\n`;
}
const builtHtml=await readFile(resolve(upstream,'dist/index.html'),'utf8');
const originalScript=builtHtml.match(/src="\.\/(assets\/workbook-[^"/]+\.js)"/)[1],originalCss=builtHtml.match(/href="\.\/(assets\/workbook-[^"/]+\.css)"/)[1];
const assets=resolve(vendor,'assets');assert.equal(relative(root,assets).replaceAll('\\','/'),'vendor/course-allocation/assets');
await rm(assets,{recursive:true,force:true});await mkdir(assets,{recursive:true});
const result=await build({entryPoints:[resolve(upstream,'app/workbook.js')],bundle:true,minify:true,format:'esm',target:'es2022',outdir:assets,entryNames:'workbook-[hash]',metafile:true,alias:{'course-allocation-performance':resolve(upstream,'shared/performance.js')},plugins:[{name:'timetable-iframe',setup(builder){
 builder.onLoad({filter:/[\\/]app[\\/]workbook\.js$/},async({path})=>({contents:adaptWorkbook(await readFile(path,'utf8')),loader:'js',resolveDir:dirname(path)}));
 builder.onResolve({filter:/shared\/transport\.js$/},()=>({path:resolve(root,'scripts/course-allocation-transport.js')}));
}}]});
const script=Object.keys(result.metafile.outputs).find(path=>path.endsWith('.js')).split(/[\\/]/).at(-1);
await copyFile(resolve(upstream,'dist',originalCss),resolve(vendor,originalCss));
await copyFile(resolve(upstream,'dist/shared/ui.css'),resolve(vendor,'shared/ui.css'));
let html=builtHtml.replace(/\s*<script src="\.\/config\.js"><\/script>/,'').replace(/\s*<script>const ALLOCATION_APP_ID[^<]+<\/script>/,'').replace(/\s*<link rel="preconnect"[^>]+>/,'').replace(/\s*<link rel="stylesheet" crossorigin href="https:[^>]+>/,'\n  <link rel="stylesheet" href="../assets/font.css">\n  <link rel="stylesheet" href="./shared/ui.css">');
html=html.replace('./'+originalScript,'./assets/'+script).replace('</head>','<style>@media(max-width:900px){.workbook-brand>span{display:inline}}@media(max-width:600px){.workbook-header .header-actions{width:auto;margin-left:auto}}</style>\n</head>');
html=html.replace('<html lang="ko">',`<!-- Source: course-allocation@${commit}; generated by scripts/sync-course-allocation.mjs with iframe adaptations. -->\n<html lang="ko">`);
await writeFile(resolve(vendor,'index.html'),html);
// These former browser modules are in the workbook bundle and have no other callers.
for(const name of ['transport.js','performance.js','print.js','reset.js'])await rm(resolve(vendor,'shared',name),{force:true});
const hash=async path=>createHash('sha256').update((await readFile(path,'utf8')).replaceAll('\r\n','\n')).digest('hex');
const manifest={upstreamCommit:commit,originalScript,originalScriptSha256:await hash(resolve(upstream,'dist',originalScript)),script:'assets/'+script,css:originalCss,uiCssSha256:await hash(resolve(vendor,'shared/ui.css')),artifacts:{}};
for(const file of ['index.html','shared/ui.css',manifest.script,manifest.css])manifest.artifacts[file]=await hash(resolve(vendor,file));
await writeFile(resolve(vendor,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const baselinePath=resolve(root,'tests/fixtures/ui-baseline.json'),baseline=JSON.parse(await readFile(baselinePath,'utf8'));
for(const file of Object.keys(baseline))if(file.startsWith('vendor/course-allocation/assets/'))delete baseline[file];
for(const file of ['shared/ui.css',manifest.css])baseline['vendor/course-allocation/'+file]=await hash(resolve(vendor,file));
await writeFile(baselinePath,JSON.stringify(baseline,null,2)+'\n');
console.log('Synced course allocation '+commit+' with timetable iframe adaptations');
