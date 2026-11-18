import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,unlink,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {parseArgs,promisify} from 'node:util';
import {Miniflare} from 'miniflare';
import {assemble,validateGlobal} from '../modules/allocation/server/validation.js';
import {identityKey} from '../modules/allocation/shared/state.js';

const root=resolve(import.meta.dirname,'..');
const cli=resolve(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),'bin/wrangler.js');
const runFile=promisify(execFile);
const sourceConfig=resolve(root,'modules/allocation/migrations/wrangler.source.json');
const targetConfig=resolve(root,'wrangler.jsonc');
const sourceId='2f1b7cde-5ea8-453b-b810-f372cf138c60';
const targetId='c4c3186c-bcfa-4bb9-959f-5086151abce8';
const tables={
 workspace:'id',
 sheets:'id',
 entity_ids:'kind,entity_id',
 operations:'id',
 write_guards:'id',
 term_archives:'term,sheet_id'
};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+value.replaceAll("'","''")+"'";
const readSql=prefix=>Object.entries(tables).map(([table,key])=>'SELECT * FROM '+prefix+table+' ORDER BY '+key).join(';\n');

function describe(rows){
 assert.equal(rows.workspace.length,1,'Expected one workspace row.');
 assert.equal(rows.write_guards.length,0,'Unexpected transient write guards.');
 const global=JSON.parse(rows.workspace[0].payload);
 const sheets=new Map(rows.sheets.map(row=>[row.id,JSON.parse(row.payload)]));
 const parts=global.departmentIds.map(id=>sheets.get(id));
 assert.equal(sheets.size,parts.length,'Workspace and sheet counts differ.');
 validateGlobal(global,parts);
 const ids=parts.flatMap(part=>JSON.parse(identityKey(part)).map(id=>[id,part.department.id]));
 const indexedIds=rows.entity_ids.map(({kind,entity_id,sheet_id})=>[kind+':'+entity_id,sheet_id]);
 assert.deepEqual(indexedIds.sort(),ids.sort(),'Entity index and sheet IDs differ.');
 const backup=assemble(global,parts);
 return {backup,report:{
  rows:Object.fromEntries(Object.entries(rows).map(([table,data])=>[table,data.length])),
  sha256:Object.fromEntries(Object.entries(rows).map(([table,data])=>[table,hash(data)])),
  globalRevision:rows.workspace[0].revision,
  revisions:Object.fromEntries(rows.sheets.map(row=>[row.id,row.revision])),
  bodySha256:hash(backup),idSetSha256:hash(indexedIds),snapshotSha256:hash(rows)
 }};
}

function importSql(rows,sourceHash){
 // Sheet INSERT triggers rebuild the ID index. The comparison checks it against the source.
 const statements=["INSERT INTO ca_import(id,source_hash,state) VALUES (1,"+literal(sourceHash)+",'paused')"];
 for(const table of ['workspace','sheets','operations','term_archives']){
  for(const row of rows[table]){
   const fields=Object.keys(row);
   statements.push('INSERT INTO ca_'+table+'('+fields.join(',')+') VALUES ('+fields.map(key=>literal(row[key])).join(',')+')');
  }
 }
 return statements.join(';\n')+';\n';
}

async function migrate(options){
 const {apply,release,remote}=options;
 assert(!(apply&&release),'Choose --apply or --release.');
 assert(!(remote&&options.local),'Choose --local or --remote.');
 assert(!remote||!options['persist-to'],'--persist-to is local only.');
 const persist=resolve(root,options['persist-to']??'.cache/allocation-migration');
 for(const [config,id] of [[sourceConfig,sourceId],[targetConfig,targetId]]){
  const {d1_databases}=JSON.parse(await readFile(config,'utf8'));
  assert.equal(d1_databases.length,1);
  assert.equal(d1_databases[0].database_id,id);
 }
 const mode=remote?['--remote']:['--local','--persist-to',persist];
 const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'};
 let backupDir;
 async function command(config,args){
  try{return (await runFile(process.execPath,[cli,...args,...mode,'--config',config],{
   cwd:root,env,windowsHide:true,maxBuffer:128*1024*1024
  })).stdout;}
  catch(error){throw Error('D1 '+args.slice(0,2).join(' ')+' failed ('+(error.code??'unknown')+').');}
 }
 async function exportDatabase(config,id,output){
  if(remote){
   await command(config,['d1','export','DB','--skip-confirmation','--output',output]);
   return;
  }
  // Wrangler's export command has no --persist-to option. Use the same local D1 exporter on the isolated state.
  const mf=new Miniflare({modules:true,script:'export default {}',d1Databases:{DB:id},d1Persist:resolve(persist,'v3/d1')});
  try{
   const db=await mf.getD1Database('DB');
   const [lines]=await db.prepare('PRAGMA miniflare_d1_export(?,?,?);').bind(false,false).raw();
   await writeFile(output,lines.join('\n'));
  }finally{await mf.dispose();}
 }
 async function execute(config,flag,value){
  const result=JSON.parse(await command(config,['d1','execute','DB','--json',flag,value]));
  assert(result.every(item=>item.success),'D1 statement failed.');
  return result.map(item=>item.results??[]);
 }
 async function snapshot(config,prefix){
  const results=await execute(config,'--command',readSql(prefix));
  return Object.fromEntries(Object.keys(tables).map((name,index)=>[name,results[index]]));
 }
 async function marker(){
  const [[table]]=await execute(targetConfig,'--command',"SELECT name FROM sqlite_master WHERE name='ca_import'");
  if(!table)return null;
  const [[row]]=await execute(targetConfig,'--command','SELECT * FROM ca_import WHERE id=1');
  return row??null;
 }
 const sourceRows=await snapshot(sourceConfig,'');
 const before=describe(sourceRows);
 if(!apply&&!release)return {mode:'preflight',before:before.report};
 const prior=await marker();
 if(prior?.state==='released'){
  assert.equal(prior.source_hash,before.report.snapshotSha256,'Released source has changed.');
  return {mode:'already-released',before:before.report};
 }
 if(release)assert(prior,'Complete --apply before --release.');
 if(!prior){
  const privateRoot=resolve(root,'private');
  await mkdir(privateRoot,{recursive:true});
  backupDir=await mkdtemp(resolve(privateRoot,'course-allocation-'));
  env.WRANGLER_LOG_PATH=resolve(backupDir,'wrangler.log');
  console.log('Backup directory: '+backupDir);
  await exportDatabase(sourceConfig,sourceId,resolve(backupDir,'source.sql'));
  await exportDatabase(targetConfig,targetId,resolve(backupDir,'target.sql'));
  await writeFile(resolve(backupDir,'source.json'),JSON.stringify(before.backup,null,2));
  await command(targetConfig,['d1','migrations','apply','DB']);
  const file=resolve(backupDir,'transfer.local.sql');
  await writeFile(file,importSql(sourceRows,before.report.snapshotSha256));
  try{await execute(targetConfig,'--file',file);}finally{await unlink(file);}
 }else{
  assert.equal(prior.source_hash,before.report.snapshotSha256,'Source differs from the paused import.');
 }
 const after=describe(await snapshot(targetConfig,'ca_'));
 assert.deepEqual(after.report,before.report,'Target report differs from source. Leave allocation paused.');
 assert.equal(hash(await snapshot(sourceConfig,'')),before.report.snapshotSha256,'Source changed during migration. Leave allocation paused.');
 if(release){
  if(remote){
   const response=await fetch('https://school-timetable.cosmicjh.workers.dev/api/health',{cache:'no-store',signal:AbortSignal.timeout(10000)});
   assert(response.ok&&(await response.json()).data?.courseAllocationStorage==='shared-d1','Deploy the consolidated Worker before releasing edits.');
  }
  await execute(targetConfig,'--command',"UPDATE ca_import SET state='released' WHERE id=1 AND state='paused' AND source_hash="+literal(before.report.snapshotSha256));
 }
 const report={mode:release?'released':prior?'already-imported':'applied',before:before.report,after:after.report};
 if(backupDir)await writeFile(resolve(backupDir,'comparison.json'),JSON.stringify(report,null,2));
 return report;
}

const {values}=parseArgs({options:{apply:{type:'boolean'},release:{type:'boolean'},local:{type:'boolean'},remote:{type:'boolean'},'persist-to':{type:'string'}}});
try{console.log(JSON.stringify(await migrate(values),null,2));}
catch(error){console.error(error.message);process.exitCode=1;}
