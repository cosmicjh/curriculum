// Only these application tables belong to the pinned legacy schema. Unexpected tables stop the cutover.
const sourceTables=['workspace','sheets','entity_ids','operations','write_guards','term_archives','credentials','sessions','login_limits'];
const events=['INSERT','UPDATE','DELETE'];
const prefix='ca_source_freeze_';
const generationPattern=/^[a-f0-9]{32}$/;
export const freezeCatalogSql="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type='table' OR (type='trigger' AND name GLOB 'ca_source_freeze_*')";
export const freezeProbeSql='INSERT INTO workspace(id,payload,revision) SELECT id,payload,revision FROM workspace WHERE id=1';
export const freezeError=generation=>'ca_source_frozen:'+generation;

function definitions(generation,verb){
 if(verb==='create'&&!generationPattern.test(generation||''))throw Error('Invalid freeze generation');
 return sourceTables.flatMap(table=>events.map(event=>{
  const name=prefix+table+'_'+event.toLowerCase();
  return {name,table,sql:verb==='drop'?'DROP TRIGGER IF EXISTS '+name:
   'CREATE TRIGGER IF NOT EXISTS '+name+' BEFORE '+event+' ON '+table+" BEGIN SELECT RAISE(ABORT,'"+freezeError(generation)+"'); END"};
 }));
}
export const installFreeze=generation=>definitions(generation,'create').map(row=>row.sql);
export const removeFreeze=()=>definitions(null,'drop').map(row=>row.sql);

const normalized=sql=>sql?.trim().replace(/^CREATE TRIGGER IF NOT EXISTS /i,'CREATE TRIGGER ').replace(/;$/,'').replace(/\s+/g,' ');
export function inspectFreeze(rows){
 const tables=rows.filter(row=>row.type==='table'&&!/^(?:sqlite_|_cf_|d1_migrations$)/.test(row.name));
 if(tables.length!==sourceTables.length||!sourceTables.every(name=>tables.some(row=>row.name===name)))throw Error('Unexpected legacy schema');
 const triggers=rows.filter(row=>row.type==='trigger');
 if(!triggers.length)return {generation:null,complete:false};
 const generation=triggers[0].sql?.match(/ca_source_frozen:([a-f0-9]{32})'/)?.[1];
 const expected=new Map(definitions(generation,'create').map(row=>[row.name,row]));
 for(const row of triggers){
  const spec=expected.get(row.name);
  if(!spec||row.tbl_name!==spec.table||normalized(row.sql)!==normalized(spec.sql))throw Error('Unexpected legacy freeze trigger');
 }
 return {generation,complete:triggers.length===expected.size};
}
