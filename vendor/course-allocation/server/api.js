import * as C from '../shared/domain.js';
import * as S from '../shared/state.js';
import {digest,randomToken} from '../../../src/crypto.js';
import {fail,boundedJson,revision,operationId,assemble,validatePart,validateGlobal,authorizePart} from './validation.js';
const DAY=86400000;
const termOf=global=>global.school.year+'-'+global.school.semester;
function store(db) {
  const stats={ms:0,read:0,written:0};
  const count=results=>{for(const r of results){stats.read+=r.meta?.rows_read??0;stats.written+=r.meta?.rows_written??0;}};
  const statement=(sql,args)=>db.prepare(sql).bind(...args);
  return {stats,
    async all(sql,...args){const t=performance.now();try{const r=await statement(sql,args).all();count([r]);return r.results;}finally{stats.ms+=performance.now()-t;}},
    async first(sql,...args){return (await this.all(sql,...args))[0]??null;},
    async batch(items){const t=performance.now();try{const r=await db.batch(items.map(([sql,...args])=>statement(sql,args)));count(r);return r.map(x=>x.results);}finally{stats.ms+=performance.now()-t;}}
  };
}
const requireAdmin=session=>{if(session.role!=='admin')fail(403,'admin_required','관리자 모드에서 실행하세요.');};
function guard(id,globalRevision=null,accessEpoch=null,adminEpoch=null,sheetRevisions=null){return ['INSERT INTO write_guards(id,global_revision,access_epoch,admin_epoch,sheet_revisions) VALUES (?,?,?,?,?)',id,globalRevision,accessEpoch,adminEpoch,sheetRevisions];}
async function workspace(s,options={},admin=false) {
  const all=options.all===true||options.all==='true';
  // Both results come from the same D1 batch transaction/snapshot.
  const [globals,rows]=await s.batch([
    ['SELECT payload,revision FROM workspace WHERE id=1'],
    ['SELECT id,revision,json_extract(payload,\'$.department\') AS department, CASE WHEN ? OR id=COALESCE(?,(SELECT json_extract(payload,\'$.departmentIds[0]\') FROM workspace WHERE id=1)) THEN payload ELSE NULL END AS payload FROM sheets',all?1:0,options.departmentId??null]
  ]);
  const global=JSON.parse(globals[0].payload),byId=new Map(rows.map(r=>[r.id,r]));
  const ordered=global.departmentIds.map(id=>byId.get(id));
  if(ordered.some(r=>!r))fail(500,'invalid_database','학교 설정과 교과군 자료가 일치하지 않습니다.');
  const selected=options.departmentId??global.departmentIds[0];
  if(!byId.has(selected))fail(404,'not_found','교과군을 찾을 수 없습니다.');
  const parts=ordered.filter(r=>r.payload).map(r=>JSON.parse(r.payload));
  return {partial:true,global,departments:ordered.map(r=>JSON.parse(r.department)),parts,
    selectedDepartmentId:selected,globalRevision:globals[0].revision,revisions:Object.fromEntries(ordered.map(r=>[r.id,r.revision])),admin};
}
async function priorOperation(s,id,kind,sheetId,hash) {
  const prior=await s.first('SELECT * FROM operations WHERE id=?',id);if(!prior)return null;
  if(prior.kind!==kind || prior.sheet_id!==sheetId || prior.request_hash!==hash)fail(409,'operation_conflict','저장 작업 식별자가 다른 요청에 이미 사용되었습니다.');
  return JSON.parse(prior.result);
}
async function prune(s,now) {
  // Bounded maintenance on explicit writes, with indexed expiry lookups. No polling/cron.
  await s.batch([
    ['DELETE FROM operations WHERE id IN (SELECT id FROM operations WHERE created_at<? ORDER BY created_at LIMIT 100)',now-7*DAY],
    ['DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<? LIMIT 100)',now],
    ['DELETE FROM login_limits WHERE bucket IN (SELECT bucket FROM login_limits WHERE expires_at<? LIMIT 100)',now]
  ]);
}
async function saveSheet(s,id,data,session,now) {
  revision(data.revision);revision(data.globalRevision);operationId(data.operationId);
  boundedJson(data.part,'교과군 자료');
  const hash=await digest(JSON.stringify({id,part:data.part,revision:data.revision,globalRevision:data.globalRevision}));
  const prior=await priorOperation(s,data.operationId,'sheet',id,hash);if(prior)return prior;
  const [globals,rows]=await s.batch([['SELECT * FROM workspace WHERE id=1'],['SELECT * FROM sheets WHERE id=?',id]]);
  if(!rows[0])fail(404,'not_found','교과군을 찾을 수 없습니다.');
  if(globals[0].revision!==data.globalRevision || rows[0].revision!==data.revision){
    const done=await priorOperation(s,data.operationId,'sheet',id,hash);if(done)return done;
    if(globals[0].revision!==data.globalRevision)fail(409,'global_conflict','학교 설정이 변경되었습니다. 입력을 보존하고 최신 내용을 확인하세요.');
    fail(409,'sheet_conflict','다른 사용자가 이 교과군을 저장했습니다. 입력을 보존하고 최신 내용을 확인하세요.');
  }
  const global=JSON.parse(globals[0].payload),before=JSON.parse(rows[0].payload);
  validatePart(global,data.part,id);authorizePart(global,before,data.part,session.role==='admin');
  const identityHash=await digest(S.identityKey(data.part));
  let updated;
  try{updated=await s.first(`UPDATE sheets SET payload=?, revision=revision+1, last_operation=?,request_hash=?,updated_at=?,identity_hash=?
      WHERE id=? AND revision=? AND (SELECT revision FROM workspace WHERE id=1)=? RETURNING revision`,
    JSON.stringify(data.part),data.operationId,hash,now,identityHash,id,data.revision,data.globalRevision);}
  catch(e){const done=await priorOperation(s,data.operationId,'sheet',id,hash);if(done)return done;if(String(e).includes('entity_ids'))fail(400,'duplicate_id','다른 교과군에서 사용 중인 자료 식별자입니다.');throw e;}
  if(!updated){const done=await priorOperation(s,data.operationId,'sheet',id,hash);if(done)return done;fail(409,'save_conflict','저장 중 자료가 변경되었습니다. 입력을 보존하고 최신 내용을 확인하세요.');}
  await prune(s,now);return {revision:updated.revision};
}
async function saveGlobal(s,data,session,now) {
  requireAdmin(session);revision(data.revision);operationId(data.operationId);
  const hash=await digest(JSON.stringify({global:data.global,newSheets:data.newSheets,revision:data.revision}));
  const prior=await priorOperation(s,data.operationId,'global',null,hash);if(prior)return prior;
  const [globals,rows]=await s.batch([['SELECT * FROM workspace WHERE id=1'],['SELECT * FROM sheets']]);
  if(globals[0].revision!==data.revision){const done=await priorOperation(s,data.operationId,'global',null,hash);if(done)return done;fail(409,'global_conflict','학교 설정이 변경되었습니다. 최신 내용을 확인하세요.');}
  const oldGlobal=JSON.parse(globals[0].payload),parts=new Map(rows.map(r=>[r.id,JSON.parse(r.payload)]));
  if(data.global?.school&&termOf(data.global)!==termOf(oldGlobal))fail(409,'term_mismatch','학기 전환을 먼저 실행하세요.');
  if(!data.global||!Array.isArray(data.global.departmentIds)||!Array.isArray(data.newSheets))fail(400,'invalid_global','학교 설정 형식을 확인하세요.');
  const added=data.newSheets;
  if(new Set(added.map(p=>p?.department?.id)).size!==added.length || added.some(p=>!p?.department?.id || parts.has(p.department.id) || !data.global.departmentIds.includes(p.department.id)))
    fail(400,'invalid_global','새 교과군 목록을 확인하세요.');
  // validateGlobal below checks every reference, duplicate and hours invariant together.
  // Avoid repeating the same expensive checks for each new department first.
  for(const part of added){boundedJson(part,'교과군 자료');parts.set(part.department.id,part);}
  const ordered=data.global.departmentIds.map(id=>parts.get(id));
  validateGlobal(data.global,ordered);
  if(!S.same(oldGlobal.school,data.global.school) && rows.some(r=>JSON.parse(r.payload).department.status!=='draft'))
    fail(400,'sheet_locked','제출·확정된 배당표의 입력을 다시 연 후 학교 설정을 수정하세요.');
  for(const id of oldGlobal.departmentIds.filter(id=>!data.global.departmentIds.includes(id)))
    if(parts.get(id).department.status!=='draft')fail(400,'sheet_locked','제출·확정된 교과군을 삭제할 수 없습니다.');
  const result={globalRevision:data.revision+1,newRevisions:Object.fromEntries(added.map(p=>[p.department.id,1]))};
  const addedRows=await Promise.all(added.map(async part=>({part,identityHash:await digest(S.identityKey(part))})));
  const id=randomToken();
  try{await s.batch([
    guard(id,data.revision,null,null,JSON.stringify(Object.fromEntries(rows.map(r=>[r.id,r.revision])))),
    ['UPDATE workspace SET payload=?,revision=revision+1 WHERE id=1',boundedJson(data.global,'학교 설정')],
    ['INSERT INTO sheets(id,payload,revision,updated_at,identity_hash) SELECT json_extract(value,\'$.part.department.id\'),json_extract(value,\'$.part\'),1,?,json_extract(value,\'$.identityHash\') FROM json_each(?)',now,boundedJson(addedRows,'새 교과군 자료')],
    ['DELETE FROM sheets WHERE id NOT IN (SELECT value FROM json_each(?))',JSON.stringify(data.global.departmentIds)],
    ['INSERT INTO operations(id,kind,sheet_id,request_hash,result,created_at) VALUES (?,\'global\',NULL,?,?,?)',data.operationId,hash,JSON.stringify(result),now],
    ['DELETE FROM write_guards WHERE id=?',id]
  ]);}catch(e){const done=await priorOperation(s,data.operationId,'global',null,hash);if(done)return done;if(/global_conflict|sheet_conflict/.test(String(e)))fail(409,'global_conflict','학교 설정 또는 배당표가 다른 곳에서 변경되었습니다.');throw e;}
  await prune(s,now);return result;
}
async function switchTerm(s,term,session,now){
  requireAdmin(session);
  if(!/^(?:20\d{2}|2100)-[12]$/.test(term))fail(400,'invalid_term','학기를 확인하세요.');
  const [workspaceRows,sheets,saved]=await s.batch([
    ['SELECT * FROM workspace WHERE id=1'],['SELECT id,revision FROM sheets'],['SELECT payload FROM term_archives WHERE term=? AND sheet_id=\'\'',term]
  ]);
  const current=workspaceRows[0],global=JSON.parse(current.payload),oldTerm=termOf(global);
  if(oldTerm===term)return {term};
  const [year,semester]=term.split('-').map(Number);
  const next={...global,school:{...global.school,year,semester,grades:global.school.grades.map(g=>({grade:g.grade,classCount:0,movingCount:0}))},source:{},customCatalog:[],departmentIds:['d1']};
  const blank={department:{id:'d1',name:'새 교과군',status:'draft',sourceTotal:null,note:''},teachers:[],courses:[],groups:[],assignments:[],unmapped:[]};
  const id=randomToken();
  try{await s.batch([
    guard(id,current.revision,null,null,JSON.stringify(Object.fromEntries(sheets.map(r=>[r.id,r.revision])))),
    ['DELETE FROM term_archives WHERE term=?',oldTerm],
    ['INSERT INTO term_archives(term,sheet_id,payload) VALUES (?,\'\',?)',oldTerm,current.payload],
    ['INSERT INTO term_archives(term,sheet_id,payload,identity_hash) SELECT ?,id,payload,identity_hash FROM sheets',oldTerm],
    ['DELETE FROM sheets'],
    ['UPDATE workspace SET payload=?,revision=revision+1 WHERE id=1',saved[0]?.payload||JSON.stringify(next)],
    saved.length?['INSERT INTO sheets(id,payload,identity_hash,updated_at) SELECT sheet_id,payload,identity_hash,? FROM term_archives WHERE term=? AND sheet_id!=\'\'',now,term]:['INSERT INTO sheets(id,payload,updated_at) VALUES (?,?,?)','d1',JSON.stringify(blank),now],
    ['DELETE FROM write_guards WHERE id=?',id]
  ]);}catch(error){if(/global_conflict|sheet_conflict/.test(String(error)))fail(409,'global_conflict','학기 전환 중 자료가 변경되었습니다. 다시 시도하세요.');throw error;}
  return {term};
}
export async function courseRequest(db,role,path,method,data,sendTransfer){
  const s=store(db),session={role},admin=role==='admin',now=Date.now();
  if(method==='GET'&&path==='/workspace')return workspace(s,data,admin);
  if(method==='POST'&&path==='/term')return switchTerm(s,data.term,session,now);
  if(method==='POST'&&path==='/timetable-transfer'){
    requireAdmin(session);
    const current=await workspace(s,{all:true},true),transfer=C.timetableTransfer(assemble(current.global,current.parts));
    if(data.term!==transfer.term)fail(409,'term_mismatch','시수배당 학기가 변경됐습니다. 자료를 다시 불러와 주세요.');
    return sendTransfer(transfer);
  }
  if(method==='PUT'){
    if(path==='/global')return saveGlobal(s,data,session,now);
    const sheet=/^\/sheets\/([A-Za-z0-9_-]{1,100})$/.exec(path);
    if(sheet)return saveSheet(s,sheet[1],data,session,now);
  }
  fail(404,'not_found','요청한 시수배당 API를 찾을 수 없습니다.');
}
