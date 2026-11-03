import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import '../scripts/build.mjs';
import '../scripts/local-config.mjs';
const require=createRequire(import.meta.url),cli=resolve(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js'),persist='test-results/wrangler-'+crypto.randomUUID();
const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:resolve('test-results/wrangler-smoke.log')},results=[];
await mkdir('test-results',{recursive:true});
function child(args){const p=spawn(process.execPath,[cli,...args,'--config','wrangler.local.json'],{env,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>out+=c);return {p,output:()=>out};}
for(const args of [['d1','migrations','apply','DB','--local','--persist-to',persist],['d1','migrations','apply','CLASS_SWAP_DB','--local','--persist-to',persist],['deploy','--dry-run','--outdir','test-results/worker-bundle']]){
 const {p,output}=child(args),code=await new Promise((r,j)=>{p.once('exit',r);p.once('error',j);});results.push({command:args.join(' '),code,output:output()});assert.equal(code,0,output());console.log('PASS Wrangler '+args.join(' '));
}
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const {p,output}=child(['dev','--local','--ip','127.0.0.1','--port',String(port),'--persist-to',persist]);
try{
 const url='http://127.0.0.1:'+port;let ready=false;
 for(let i=0;i<160;i++){if(p.exitCode!==null)throw Error(output());try{const r=await fetch(url+'/api/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,output());
 for(const path of ['/','/student.html','/teacher.html','/admin.html','/assets/app.js','/class-swap/view.html','/class-swap/app.js']){const r=await fetch(url+path);assert(r.ok,path);}
 for(const path of ['/api','/api/missing','/api/not-a-file.html']){const r=await fetch(url+path);assert.equal(r.status,404,path);assert.match(r.headers.get('Content-Type'),/json/);assert.equal((await r.json()).ok,false);}
 const r=await fetch(url+'/api/bootstrap',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:'{}'});assert(r.ok,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');
 for(const path of ['/src/worker.js','/tests/fixture.mjs','/migrations/0001_timetable.sql','/.dev.vars','/config.json','/__fixture_sql','/class-swap/index.html','/class-swap/core.js','/class-swap/xlsx.full.min.js'])assert.equal((await fetch(url+path)).status,404,path);
 console.log('PASS live Wrangler Worker: ASSETS, DB, JSON API 404, private files excluded');results.push({runtime:'wrangler dev --local',routes:'pass'});
}finally{p.kill();await new Promise(r=>p.once('exit',r));}
await writeFile('test-results/wrangler.json',JSON.stringify(results,null,2)+'\n');
