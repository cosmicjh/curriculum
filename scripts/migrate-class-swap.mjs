import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {context,load} from '../src/storage.js';
import {datasetFromStore,migratePlans} from '../src/class-swap-data.js';
import {C} from '../vendor/class-swap/src/shared/core.js';
import {validateInput,reservationRows,today} from '../vendor/class-swap/src/shared/backup.js';
const root=resolve(import.meta.dirname,'..'),runFile=promisify(execFile),require=createRequire(import.meta.url),cli=resolve(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
const source='class-swap-db',sourceId='d4e9d2e3-35cb-475f-b128-c78d714cd354';
const literal=value=>value==null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
export function importStatement(ctx,sourceHash,plans){
 // shortcut: one transfer is limited to 1.5 MB; chunk the importer before moving a larger archive.
 const content=JSON.stringify(plans);if(Buffer.byteLength(content)>1500000)throw Error('Plan archive exceeds the single-transfer limit.');
 return 'INSERT INTO swap_imports(source_id,source_hash,term_id,expected_revision,plan_count,content,imported_at) VALUES('+[sourceId,sourceHash,ctx.term,ctx.revision,plans.length,content,new Date().toISOString()].map(literal).join(',')+');';
}
const locks=[['state','UPDATE'],...['plans','reservations'].flatMap(table=>['INSERT','UPDATE','DELETE'].map(action=>[table,action]))];
const lockName=(table,action)=>'shared_timetable_'+table+'_'+action.toLowerCase();
export const freezeSql=locks.map(([table,action])=>'CREATE TRIGGER IF NOT EXISTS '+lockName(table,action)+' BEFORE '+action+' ON '+table+" BEGIN SELECT RAISE(ABORT,'CLASS_SWAP_MOVED_TO_TIMETABLE'); END;").join('\n');
const unfreezeSql=locks.map(([table,action])=>'DROP TRIGGER IF EXISTS '+lockName(table,action)+';').join('\n');
export const pauseSql="CREATE TRIGGER IF NOT EXISTS shared_migration_pause BEFORE INSERT ON write_guards BEGIN SELECT RAISE(ABORT,'shared_migration_in_progress'); END;";
export function parseWranglerJSON(stdout){const start=stdout.search(/^\s*\[(?:\s*\{|\s*\])/m);if(start<0)throw Error('Wrangler did not return JSON.');return JSON.parse(stdout.slice(start));}
async function command(args){
 try{return await runFile(process.execPath,[cli,...args,'--config','wrangler.jsonc'],{cwd:root,windowsHide:true,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:resolve(root,'private/shared-migration.local.log')},maxBuffer:20000000});}
 catch(error){await writeFile(resolve(root,'private/shared-migration-error.local.log'),String(error.stdout||'')+'\n'+String(error.stderr||''));throw Error('D1 command failed. Details are in private/shared-migration-error.local.log.');}
}
async function query(database,sql){
 const reading=/^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql),file=reading?null:resolve(root,'private/query-'+crypto.randomUUID()+'.local.sql');if(file)await writeFile(file,sql);
 try{const {stdout}=await command(['d1','execute',database,'--remote','--json',...(reading?['--command',sql]:['--file',file])]);const result=parseWranglerJSON(stdout);assert(result.every(r=>r.success));return result.flatMap(r=>Array.isArray(r.results)?r.results:[]);}finally{if(file)await unlink(file);}
}
function targetDatabase(){
 const prepare=(sql,...params)=>{let n=0;const bound=sql.replace(/\?/g,()=>literal(params[n++]));assert.equal(n,params.length);return bound;};
 return {prepare,batch:async statements=>{const out=[];for(const sql of statements)out.push({results:await query('DB',sql)});return out;},all:(sql,...params)=>query('DB',prepare(sql,...params)),first:async(sql,...params)=>(await query('DB',prepare(sql,...params)))[0]||null};
}
export async function migrate(apply=false){
 await mkdir(resolve(root,'private'),{recursive:true});const config=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
 assert.equal(config.name,'school-timetable');assert.equal(config.d1_databases.length,1);assert.equal(config.d1_databases[0].database_id,'c4c3186c-bcfa-4bb9-959f-5086151abce8');
 if(apply){
  const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-');
  for(const database of ['DB',source]){await command(['d1','export',database,'--remote','--output',resolve(root,'private/shared-before-'+database+'-'+stamp+'.local.sql')]);console.log('PASS private backup: '+database);}
  await command(['d1','migrations','apply','DB','--remote']);console.log('PASS shared schema migration');
 }
 const db=targetDatabase(),hasSchema=await db.first("SELECT name FROM sqlite_master WHERE type='table' AND name='swap_imports'");
 if(hasSchema){const completed=await db.first('SELECT source_hash,plan_count,term_id FROM swap_imports WHERE source_id=?',sourceId);if(completed){console.log(JSON.stringify({alreadyMigrated:true,...completed}));return;}}
 let locked=false,paused=false;
 try{
  if(apply){
   paused=true;await query('DB',pauseSql);locked=true;await query(source,freezeSql);console.log('PASS timetable edits and legacy plan writes paused');
   const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-');
   for(const database of ['DB',source])await command(['d1','export',database,'--remote','--output',resolve(root,'private/shared-frozen-'+database+'-'+stamp+'.local.sql')]);
   console.log('PASS frozen business-data backups');
  }
  const ctx=await context(db),store=await load(db,ctx,['sections','teacherRows','overrides','blocks']),state=(await query(source,'SELECT * FROM state WHERE id=1'))[0],legacyDataset=JSON.parse(state.dataset),oldPlans=(await query(source,'SELECT content FROM plans ORDER BY id')).map(row=>JSON.parse(row.content));
  validateInput({type:'class-swap-backup',schema:1,dataset:legacyDataset,plans:oldPlans});
  const dataset=datasetFromStore(store),plans=migratePlans(dataset,legacyDataset,oldPlans);if(plans.length&&!dataset)throw Error('Register the shared timetable before migrating plans.');if(dataset)C.validateExisting(dataset,plans,today());
  const sourceHash=createHash('sha256').update(JSON.stringify({state,oldPlans})).digest('hex'),report={term:ctx.term,teachers:dataset?.teachers.length||0,lessons:dataset?.lessons.length||0,plans:plans.length,reservations:reservationRows(plans).length,sourceHash};
  if(!apply){console.log(JSON.stringify({apply:false,...report},null,2));return;}
  await query('DB',importStatement(ctx,sourceHash,plans));
  const copied=(await db.all('SELECT content FROM swap_plans WHERE term_id=? ORDER BY id',ctx.term)).map(row=>JSON.parse(row.content));assert.deepEqual(copied,plans);
  const reservations=await db.first('SELECT count(*) n FROM swap_reservations WHERE term_id=?',ctx.term);assert.equal(reservations.n,report.reservations);
  await writeFile(resolve(root,'private/shared-migration.local.json'),JSON.stringify({...report,completedAt:new Date().toISOString(),legacyReadOnly:true},null,2));console.log(JSON.stringify({apply:true,...report,legacyReadOnly:true,timetableEditsPausedUntilRelease:true},null,2));
 }catch(error){
  if(locked||paused){const imported=await db.first('SELECT source_hash FROM swap_imports WHERE source_id=?',sourceId);if(!imported){if(locked)await query(source,unfreezeSql);if(paused)await query('DB','DROP TRIGGER IF EXISTS shared_migration_pause;');console.log('Previous writes restored because the transfer did not commit.');}}
  throw error;
 }
}
export async function release(){
 await mkdir(resolve(root,'private'),{recursive:true});const config=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));assert.equal(config.d1_databases[0].database_id,'c4c3186c-bcfa-4bb9-959f-5086151abce8');
 const marker=await targetDatabase().first('SELECT source_hash FROM swap_imports WHERE source_id=?',sourceId);assert(marker,'Complete the plan transfer first.');
 const response=await fetch('https://school-timetable.cosmicjh.workers.dev/api/health',{cache:'no-store'});assert.equal((await response.json()).data.sharedTimetable,true,'Deploy the shared-data Worker before releasing edits.');
 await query('DB','DROP TRIGGER IF EXISTS shared_migration_pause;');console.log('PASS shared timetable edits released; legacy DB remains read-only.');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){if(process.argv.includes('--release'))await release();else await migrate(process.argv.includes('--apply'));}
