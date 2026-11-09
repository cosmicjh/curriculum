// Every remote mutation is restricted to this disposable test Worker and test DB.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {provisionCredential,randomToken} from '../src/crypto.js';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),cli=resolve(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
const target='school-timetable-studyroom-test-20261106',configFile=resolve(root,'.cache/studyroom-test.wrangler.json'),privateDir=resolve(root,'private'),command=process.argv[2];
const production=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
await mkdir(resolve(root,'.cache'),{recursive:true});await mkdir(privateDir,{recursive:true});
if(command==='prepare'){
 const id=process.argv[3];if(!/^[a-f0-9-]{36}$/.test(id||'')||production.d1_databases.some(d=>d.database_id===id))throw Error('A NEW test DB ID is required');
 try{await readFile(configFile);throw Error('Test configuration already exists; preserve it');}catch(e){if(e.code!=='ENOENT')throw e;}
 await writeFile(configFile,JSON.stringify({name:target,main:resolve(root,'src/worker.js'),compatibility_date:production.compatibility_date,account_id:production.account_id,workers_dev:true,preview_urls:false,assets:{directory:resolve(root,'dist'),binding:'ASSETS',run_worker_first:['/api','/api/*']},d1_databases:[{binding:'DB',database_name:target,database_id:id,migrations_dir:resolve(root,'migrations')}],vars:{STUDYROOM_ENABLED:'true',STUDYROOM_TEST_MODE:'true',STUDYROOM_CRON_ENABLED:'false'},observability:{enabled:false}},null,2));
 const credentials={adminPassword:randomToken(),teacherPassword:randomToken()};
 await writeFile(resolve(privateDir,'studyroom-test-credentials.local.json'),JSON.stringify(credentials,null,2),{flag:'wx'});
 const pepper=randomToken(),secrets={PASSWORD_PEPPER:pepper,BOOTSTRAP_ADMIN_HASH:await provisionCredential(credentials.adminPassword,pepper,'admin'),BOOTSTRAP_TEACHER_HASH:await provisionCredential(credentials.teacherPassword,pepper,'teacher')};
 await writeFile(resolve(privateDir,'studyroom-test-secrets.local.json'),JSON.stringify(secrets,null,2),{flag:'wx'});console.log('Separate synthetic-only test configuration prepared.');process.exit(0);
}
const cfg=JSON.parse(await readFile(configFile,'utf8'));
if(cfg.name!==target||cfg.name===production.name||cfg.account_id!==production.account_id||cfg.d1_databases.length!==1||cfg.d1_databases[0].database_name!==target||production.d1_databases.some(d=>d.database_id===cfg.d1_databases[0].database_id)||cfg.main!==resolve(root,'src/worker.js')||cfg.vars.STUDYROOM_TEST_MODE!=='true')throw Error('Refusing a non-test target');
async function run(args){return new Promise((resolvePromise,reject)=>{let out='';const p=spawn(process.execPath,[cli,...args,'--config',configFile],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:resolve(privateDir,'studyroom-test-wrangler.local.log')},stdio:['pipe','pipe','pipe']});for(const stream of [p.stdout,p.stderr])stream.on('data',b=>{out+=b;});p.stdin.end('y\n');p.on('error',reject);p.on('close',code=>{process.stdout.write(out.replace(/https:\/\/[^\s]*X-Amz[^\s]*/g,'[private backup URL omitted]'));code===0?resolvePromise(out):reject(Error('Test-only Wrangler failed: '+code));});});}
if(command==='migrate')await run(['d1','migrations','apply','DB','--remote']);
else if(command==='secrets')await run(['secret','bulk',resolve(privateDir,'studyroom-test-secrets.local.json')]);
else if(['deploy','cron-on','cron-off'].includes(command)){
 if(command!=='deploy'){const enabled=command==='cron-on';cfg.vars.STUDYROOM_CRON_ENABLED=String(enabled);cfg.triggers={crons:enabled?['* * * * *']:[]};await writeFile(configFile,JSON.stringify(cfg,null,2));}
 await import('./build.mjs');const out=await run(['deploy']);const match=out.match(new RegExp('https://'+target+'\\.[a-z0-9-]+\\.workers\\.dev'));
 if(match)await writeFile(resolve(privateDir,'studyroom-test-release.local.json'),JSON.stringify({url:match[0],worker:target,databaseId:cfg.d1_databases[0].database_id,cronEnabled:cfg.vars.STUDYROOM_CRON_ENABLED==='true',at:new Date().toISOString()},null,2));
}else if(command==='export')await run(['d1','export','DB','--remote','--output',resolve(privateDir,'studyroom-test-backup.local.sql')]);
else if(command!=='migrate'&&command!=='secrets')throw Error('Use prepare, migrate, deploy, secrets, cron-on, cron-off or export');
