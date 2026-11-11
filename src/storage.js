import Core from './core.js';
let scheduleCache,classCache;
// One entry per isolate; versions come from D1 on every authenticated request.
export async function schedule(db,ctx){
 const key=ctx.term+':'+ctx.schedule_revision;
 if(scheduleCache?.key!==key){
  const entry={key,promise:load(db,ctx,['sections','teacherRows','overrides','blocks']).then(store=>({store,rt:Core.runtime(store)}))};scheduleCache=entry;
  entry.promise.catch(()=>{if(scheduleCache===entry)scheduleCache=null;});
 }
 return scheduleCache.promise;
}
export function database(DB){
 const stats={ms:0,read:0,written:0};
 const prepare=(sql,...args)=>DB.prepare(sql).bind(...args);
 async function batch(statements){const at=performance.now();const results=await DB.batch(statements);stats.ms+=performance.now()-at;for(const r of results){stats.read+=r.meta?.rows_read||0;stats.written+=r.meta?.rows_written||0;}return results;}
 async function all(sql,...args){return (await batch([prepare(sql,...args)]))[0].results;}
 async function first(sql,...args){return (await all(sql,...args))[0]||null;}
 return {stats,prepare,batch,all,first};
}
export async function context(db){
 const r=await db.first('SELECT a.*,t.settings,t.sections_revision,t.schedule_revision,t.students_revision,t.updated_at FROM app_state a JOIN terms t ON t.id=a.active_term WHERE a.id=1');
 if(!r)throw Error('D1 마이그레이션이 필요합니다.');return {...r,settings:JSON.parse(r.settings),term:r.active_term};
}
export function studentRow(r){return {id:r.id,sourceKey:r.source_key,grade:r.grade,classNum:r.class_num,number:r.number,name:r.name,status:r.status,note:r.note,manualFields:JSON.parse(r.manual_fields),updatedAt:r.updated_at,choices:{}};}
export function sectionRow(r){return {id:r.id,grade:r.grade,subject:r.subject,code:r.code,room:r.room,shortName:r.short_name,sourceKey:r.source_key,manualFields:JSON.parse(r.manual_fields)};}
export async function load(db,ctx,parts=['students','sections','teacherRows','overrides','blocks'],where='',args=[]){
 const store={term:ctx.term,settings:ctx.settings,students:[],sections:[],teacherRows:[],overrides:[],blocks:[]},jobs=[];
 function add(kind,sql,...params){jobs.push({kind,stmt:db.prepare(sql,...params)});}
 if(parts.includes('students')){
  add('students','SELECT * FROM students WHERE term_id=? '+where,ctx.term,...args);
  // Filter students first so a class lookup does not scan every assignment in the term.
  add('assignments','SELECT a.* FROM students s CROSS JOIN assignments a ON a.term_id=s.term_id AND a.student_id=s.id WHERE s.term_id=? '+where.replaceAll(/(?<![\w.])(id|status|grade|class_num|number)(?=\s*[=?])/g,'s.$1'),ctx.term,...args);
 }
 if(parts.includes('sections'))add('sections','SELECT * FROM sections WHERE term_id=? ORDER BY grade,subject,code',ctx.term);
 if(parts.includes('teacherRows'))add('teacherRows','SELECT cells FROM teacher_rows WHERE term_id=? ORDER BY row_number',ctx.term);
 if(parts.includes('overrides'))add('overrides','SELECT teacher,day,period,section_id AS sectionId FROM overrides WHERE term_id=?',ctx.term);
 if(parts.includes('blocks'))add('blocks','SELECT grade,day,period,block FROM blocks WHERE term_id=?',ctx.term);
 if(parts.some(p=>['sections','teacherRows','blocks','allocation'].includes(p)))add('allocation','SELECT content FROM room_allocations WHERE term_id=?',ctx.term);
 if(!jobs.length)return store;
 const out=await db.batch(jobs.map(j=>j.stmt)),choices=[];
 for(let i=0;i<jobs.length;i++){const k=jobs[i].kind,rows=out[i].results;if(k==='students')store.students=rows.map(studentRow);else if(k==='assignments')choices.push(...rows);else if(k==='sections')store.sections=rows.map(sectionRow);else if(k==='teacherRows')store.teacherRows=rows.map(r=>JSON.parse(r.cells));else if(k==='allocation'){if(rows[0])store.allocation=JSON.parse(rows[0].content);}else store[k]=rows;}
 const byId=new Map(store.students.map(s=>[s.id,s]));for(const a of choices)if(byId.has(a.student_id))byId.get(a.student_id).choices[a.subject]=a.code;return store;
}
export function meta(ctx,classes={}){
 const term=ctx.term;return {term,settings:ctx.settings,revision:String(ctx.revision),updatedAt:ctx.updated_at,classes,
 sectionsRevision:term+':'+ctx.sections_revision,historyRevision:String(ctx.history_revision),
 revisions:{config:term+':'+ctx.revision,students:term+':'+ctx.students_revision,sections:term+':'+ctx.sections_revision,schedule:term+':'+ctx.schedule_revision}};
}
export async function metadata(db,ctx,includeClasses=false){
 if(!includeClasses)return meta(ctx);
 const key=ctx.term+':'+ctx.students_revision;
 if(classCache?.key!==key){
  const entry={key,promise:db.all("SELECT DISTINCT grade,class_num FROM students WHERE term_id=? AND status='재학' ORDER BY CAST(grade AS INTEGER),CAST(class_num AS INTEGER)",ctx.term).then(rows=>{const classes={};for(const r of rows)(classes[r.grade]??=[]).push(r.class_num);return classes;})};classCache=entry;
  entry.promise.catch(()=>{if(classCache===entry)classCache=null;});
 }
 return meta(ctx,await classCache.promise);
}
function jsonInserts(db,table,columns,rows){
 const statements=[];for(let i=0;i<rows.length;i+=100){const chunk=rows.slice(i,i+100);statements.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map((_,n)=>`json_extract(value,'$[${n}]')`).join(',')} FROM json_each(?)`,JSON.stringify(chunk)));}return statements;
}
export function writeStudents(db,term,students,sections,oldStudents=[]){
 const index=new Map(sections.map(s=>[Core.sectionKey(s.grade,s.subject,s.code),s.id]));
 const previous=new Map(oldStudents.map(s=>[s.id,s]));
 const statements=[];
 for(const s of students){
  statements.push(db.prepare(`INSERT INTO students(term_id,id,source_key,grade,class_num,number,name,status,note,manual_fields,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(term_id,id) DO UPDATE SET source_key=excluded.source_key,grade=excluded.grade,class_num=excluded.class_num,number=excluded.number,name=excluded.name,status=excluded.status,note=excluded.note,manual_fields=excluded.manual_fields,updated_at=excluded.updated_at`,term,s.id,s.sourceKey||Core.key(s),s.grade,s.classNum,s.number,s.name,s.status||'재학',s.note||'',JSON.stringify(s.manualFields||[]),s.updatedAt||''));
  const old=previous.get(s.id),changed=old?new Set([...Object.keys(old.choices||{}),...Object.keys(s.choices||{})].filter(subject=>old.choices[subject]!==s.choices[subject]||old.grade!==s.grade)):null;
  if(changed)for(const subject of changed)statements.push(db.prepare('DELETE FROM assignments WHERE term_id=? AND student_id=? AND subject=?',term,s.id,subject));
  else statements.push(db.prepare('DELETE FROM assignments WHERE term_id=? AND student_id=?',term,s.id));
  const rows=Object.entries(s.choices||{}).filter(([subject])=>!changed||changed.has(subject)).map(([subject,code])=>[term,s.id,subject,code,index.get(Core.sectionKey(s.grade,subject,code))||null]);
  statements.push(...jsonInserts(db,'assignments',['term_id','student_id','subject','code','section_id'],rows));
 }return statements;
}
export function writeSections(db,term,sections){return sections.map(s=>db.prepare(`INSERT INTO sections(term_id,id,grade,subject,code,normalized_key,source_key,room,short_name,manual_fields) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(term_id,id) DO UPDATE SET grade=excluded.grade,subject=excluded.subject,code=excluded.code,normalized_key=excluded.normalized_key,room=excluded.room,short_name=excluded.short_name,manual_fields=excluded.manual_fields`,term,s.id,s.grade,s.subject,s.code,Core.sectionKey(s.grade,s.subject,s.code),s.sourceKey,s.room,s.shortName,JSON.stringify(s.manualFields||[])));}
export function replaceParts(db,store,parts){
 const t=store.term,statements=[];
 if(parts.includes('allocation')){statements.push(db.prepare('DELETE FROM room_allocations WHERE term_id=?',t));if(store.allocation)statements.push(db.prepare('INSERT INTO room_allocations(term_id,content) VALUES(?,?)',t,JSON.stringify(store.allocation)));}
 if(parts.includes('sections')){
  statements.push(db.prepare('DELETE FROM sections WHERE term_id=?',t));
  statements.push(...jsonInserts(db,'sections',['term_id','id','grade','subject','code','normalized_key','source_key','room','short_name','manual_fields'],store.sections.map(s=>[t,s.id,String(s.grade),s.subject,s.code,Core.sectionKey(s.grade,s.subject,s.code),s.sourceKey||Core.sectionKey(s.grade,s.subject,s.code),s.room||'',s.shortName||'',JSON.stringify(s.manualFields||[])])));
 }
 if(parts.includes('students')){
  statements.push(db.prepare('DELETE FROM students WHERE term_id=?',t));
  statements.push(...jsonInserts(db,'students',['term_id','id','source_key','grade','class_num','number','name','status','note','manual_fields','updated_at'],store.students.map(s=>[t,s.id,s.sourceKey||Core.key(s),s.grade,s.classNum,s.number,s.name,s.status||'재학',s.note||'',JSON.stringify(s.manualFields||[]),s.updatedAt||''])));
  const index=new Map(store.sections.map(s=>[Core.sectionKey(s.grade,s.subject,s.code),s.id]));
  const rows=store.students.flatMap(s=>Object.entries(s.choices||{}).map(([subject,code])=>[t,s.id,subject,String(code),index.get(Core.sectionKey(s.grade,subject,code))||null]));
  statements.push(...jsonInserts(db,'assignments',['term_id','student_id','subject','code','section_id'],rows));
 }else if(parts.includes('sections'))statements.push(db.prepare(`UPDATE assignments SET section_id=(SELECT c.id FROM sections c JOIN students s ON s.term_id=c.term_id AND s.grade=c.grade WHERE c.term_id=assignments.term_id AND s.id=assignments.student_id AND c.subject=assignments.subject AND c.code=assignments.code) WHERE term_id=?`,t));
 if(parts.includes('teacherRows')){
  statements.push(db.prepare('DELETE FROM teacher_rows WHERE term_id=?',t),db.prepare('DELETE FROM teachers WHERE term_id=?',t));
  statements.push(...jsonInserts(db,'teacher_rows',['term_id','row_number','cells'],store.teacherRows.map((r,i)=>[t,i,JSON.stringify(r)])));
  const teachers=Core.parseTeacherMatrix(store.teacherRows).teachers;
  statements.push(...jsonInserts(db,'teachers',['term_id','id','name'],teachers.map(s=>[t,s.id,s.name])));
  statements.push(...jsonInserts(db,'lessons',['term_id','teacher_id','day','period','subject','room'],teachers.flatMap(s=>s.slots.map(l=>[t,s.id,l.day,l.period,l.rawSubject,l.rawRoom]))));
 }
 if(parts.includes('overrides')){statements.push(db.prepare('DELETE FROM overrides WHERE term_id=?',t));statements.push(...jsonInserts(db,'overrides',['term_id','slot_key','teacher','day','period','section_id'],store.overrides.map(o=>[t,Core.slotKey(o.teacher,o.day,o.period),o.teacher,o.day,Number(o.period),o.sectionId])));}
 if(parts.includes('blocks')){statements.push(db.prepare('DELETE FROM blocks WHERE term_id=?',t));statements.push(...jsonInserts(db,'blocks',['term_id','grade','day','period','block'],store.blocks.map(o=>[t,String(o.grade),o.day,Number(o.period),o.block])));}
 return statements;
}
export function snapshot(db,store,label){
 const id=crypto.randomUUID(),at=new Date().toISOString(),backup={format:'school-timetable-backup',schemaVersion:1,exportedAt:at,store},body=JSON.stringify(backup),parts=[];
 for(let i=0;i<body.length;i+=15000)parts.push(body.slice(i,i+15000));
 const statements=[db.prepare('INSERT INTO backups(id,at,term_id,label,bytes,parts) VALUES(?,?,?,?,?,?)',id,at,store.term,label,new TextEncoder().encode(body).length,parts.length)];
 statements.push(...jsonInserts(db,'backup_parts',['backup_id','part','body'],parts.map((p,i)=>[id,i,p])));return {id,backup,statements};
}
export async function readBackup(db,id){
 const rows=await db.all('SELECT p.part,p.body,b.parts FROM backup_parts p JOIN backups b ON b.id=p.backup_id WHERE b.id=? ORDER BY p.part',id);
 if(!rows.length||rows.length!==rows[0].parts||rows.some((r,i)=>r.part!==i))throw Error('백업 데이터가 불완전합니다.');return JSON.parse(rows.map(r=>r.body).join(''));
}
export const prepareBackupList=(db,term)=>db.prepare('SELECT id,at,term_id AS term,label,bytes FROM backups WHERE term_id=? ORDER BY at DESC LIMIT 200',term);
export const backupList=async(db,term)=>(await db.batch([prepareBackupList(db,term)]))[0].results;
export async function commit(db,ctx,session,req,statements,{action=req.action,target='',before=null,after=null,backupId=null,parts=[],activeTerm=ctx.term,historyOnly=false}={}){
 if(req.expectedTerm!==ctx.term||req.expectedRevision!==String(ctx.revision)){const e=Error('다른 변경이나 학기 전환이 있습니다. 입력값을 복사한 뒤 새로고침하여 다시 저장하세요.');e.status=409;e.code='CONFLICT';throw e;}
 const id=crypto.randomUUID(),at=new Date().toISOString();
 await db.batch([
  db.prepare('INSERT INTO write_guards(id,expected_revision,expected_term,token_hash,at) VALUES(?,?,?,?,?)',id,ctx.revision,ctx.term,session.token_hash,Date.now()),
  ...statements,
  db.prepare('INSERT INTO history(id,at,term_id,action,target,before_value,after_value,backup_id) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),at,ctx.term,action,target,JSON.stringify(before),JSON.stringify(after),backupId),
  db.prepare('UPDATE app_state SET revision=revision+?,history_revision=history_revision+1,active_term=? WHERE id=1',historyOnly?0:1,activeTerm),
  db.prepare('UPDATE terms SET updated_at=?,students_revision=students_revision+?,sections_revision=sections_revision+?,schedule_revision=schedule_revision+? WHERE id=?',at,parts.includes('students')?1:0,parts.includes('sections')?1:0,parts.some(p=>p!=='students')?1:0,activeTerm),
  db.prepare('DELETE FROM write_guards WHERE id=?',id)
 ]);
}
