import {classSwap,validateSchedule} from './class-swap.js';
import Core from './core.js';
import * as D from './domain.js';
import * as S from './storage.js';
import * as Auth from './auth.js';
import {allowedRequest,pagesRequest,cors} from './origin.js';
import {prepareAllocation} from './allocations.js';
import {studyroom,runStudyroomSchedule} from './studyroom.js';
import {launchCourse,bridgeCourse,requireEnabled,storeCourseTransfer} from './course-bridge.js';
import {courseRequest} from '../vendor/course-allocation/server/api.js';
const reads=new Set(['allocation','classSwap','bootstrap','student','teacherBootstrap','teacher','roster','classBatch','adminBootstrap','adminStudent','adminSections','adminLinks','adminLessons','adminHistory','adminSettings','dashboard','previewImport','downloadBackup','courseTransfer']);
const writes=new Set(['saveAllocation','commitImport','saveStudent','saveSection','saveOverride','saveBlock','saveBlocks','saveSettings','switchTerm','backup','restore','changePassword']);
const teacherActions=new Set(['allocation','classSwap','teacherBootstrap','teacher','roster','classBatch']);
async function teacherBoot(db,ctx,req={}){
 const m=await S.metadata(db,ctx,true);if(req.knownRevision===m.revision)return {unchanged:true,revision:m.revision,historyRevision:m.historyRevision,meta:m};
 const jobs=[db.prepare('SELECT name FROM teachers WHERE term_id=? ORDER BY name',ctx.term)];
 if(req.sectionsRevision!==m.sectionsRevision)jobs.push(db.prepare('SELECT * FROM sections WHERE term_id=? ORDER BY grade,subject,code',ctx.term));
 const [teachers,sections]=await db.batch(jobs);
 return {meta:m,teachers:teachers.results.map(r=>r.name),sectionsRevision:m.sectionsRevision,...(sections?{sections:sections.results.map(S.sectionRow)}:{})};
}
async function adminBoot(db,ctx,req={}){
 const m=await S.metadata(db,ctx,true);if(req.knownRevision===m.revision)return {unchanged:true,revision:m.revision,historyRevision:m.historyRevision,meta:m};
 const [studentResult,countResult]=await db.batch([
  db.prepare('SELECT * FROM students WHERE term_id=? ORDER BY CAST(grade AS INTEGER),CAST(class_num AS INTEGER),CAST(number AS INTEGER)',ctx.term),
  db.prepare("SELECT student_id,count(*) AS choice_count FROM assignments INDEXED BY assignment_student_active WHERE term_id=? AND code!='' GROUP BY student_id",ctx.term)
 ]);
 const counts=new Map(countResult.results.map(r=>[r.student_id,r.choice_count]));
 return {meta:m,store:{term:ctx.term,settings:ctx.settings,students:studentResult.results.map(r=>({...D.studentSummary(S.studentRow(r)),choiceCount:counts.get(r.id)||0})),sections:[],overrides:[],blocks:[]},loaded:{students:true},lessonCache:{},sectionsRevision:''};
}
async function links(db,ctx,includeSections=true){const {store:st,rt}=await S.schedule(db,ctx);return {meta:await S.metadata(db,ctx,true),warnings:rt.warnings,blocks:rt.blocks,teachers:rt.teachers.map(t=>t.name),overrides:st.overrides,manualBlocks:st.blocks,...(includeSections?{sections:st.sections}:{})};}
async function read(db,ctx,req){
 const a=req.action;
 if(a==='bootstrap')return S.meta(ctx);
 if(a==='courseTransfer'){const row=await db.first('SELECT content,saved_at FROM course_transfers WHERE term_id=?',ctx.term);return row?{transfer:JSON.parse(row.content),savedAt:row.saved_at}:null;}
 if(a==='allocation'){const st=await S.load(db,ctx,['sections','allocation']);return {board:st.allocation||null,sections:st.sections,meta:S.meta(ctx)};}
 if(a==='adminBootstrap')return adminBoot(db,ctx,req);
 if(a==='teacherBootstrap')return teacherBoot(db,ctx,req);
 if(a==='adminSettings')return {meta:await S.metadata(db,ctx,true),backups:await S.backupList(db,ctx.term),terms:(await db.all('SELECT id FROM terms ORDER BY id DESC')).map(r=>r.id)};
 if(a==='adminSections'){const m=S.meta(ctx);return {meta:m,sectionsRevision:m.sectionsRevision,...(req.sectionsRevision===m.sectionsRevision?{unchanged:true}:{sections:(await db.all('SELECT * FROM sections WHERE term_id=? ORDER BY grade,subject,code',ctx.term)).map(S.sectionRow)})};}
 if(a==='adminStudent'){
  const st=await S.load(db,ctx,['students'], 'AND id=?',[req.id||'']);if(req.id&&!st.students.length)Auth.fail(404,'NOT_FOUND','학생 정보가 없습니다.');
  const m=S.meta(ctx),result={student:st.students[0]||null,meta:m,sectionsRevision:m.sectionsRevision};
  if(req.sectionsRevision!==m.sectionsRevision)result.sections=(await db.all('SELECT * FROM sections WHERE term_id=? ORDER BY grade,subject,code',ctx.term)).map(S.sectionRow);return result;
 }
 if(a==='adminLinks')return links(db,ctx);
 if(a==='adminHistory')return {meta:await S.metadata(db,ctx,true),history:await db.all('SELECT id,at,term_id AS term,action,target FROM history WHERE term_id=? ORDER BY at DESC LIMIT 100',ctx.term),backups:await S.backupList(db,ctx.term),terms:(await db.all('SELECT id FROM terms ORDER BY id DESC')).map(r=>r.id)};
 if(a==='downloadBackup')return S.readBackup(db,req.backupId);
 if(a==='student'){
  if(!/^[1-3][0-9]{4}$/.test(String(req.studentNumber||'')))Auth.fail(400,'INVALID_REQUEST','학번 5자리를 입력하세요.');
  const n=req.studentNumber,st=await S.load(db,ctx,['students'],"AND status='재학' AND grade=? AND class_num=? AND number=?",[n[0],String(Number(n.slice(1,3))),String(Number(n.slice(3)))]);
  if(!st.students.length)Auth.fail(404,'NOT_FOUND','학생 정보가 없습니다.');const {rt}=await S.schedule(db,ctx),tt=Core.studentTimetable(rt,st.students[0]);delete tt.id;return {...tt,meta:S.meta(ctx)};
 }
 if(a==='teacher'||a==='adminLessons'){
  const {rt}=await S.schedule(db,ctx);
  if(a==='teacher')return {...Core.teacherTimetable(rt,req.teacher),meta:await S.metadata(db,ctx,true)};
  return {lessons:Object.values(rt.bindings).filter(l=>l.teacher===req.teacher&&l.rawSubject).map(D.lesson),meta:S.meta(ctx)};
 }
 if(a==='classBatch'){
  if(!['1','2','3'].includes(String(req.grade))||!/^\d{1,2}$/.test(String(req.classNum)))Auth.fail(400,'INVALID_REQUEST','학년과 학급을 확인하세요.');
  const st=await S.load(db,ctx,['students'],"AND status='재학' AND grade=? AND class_num=?",[String(req.grade),String(Number(req.classNum))]),{rt}=await S.schedule(db,ctx);
  return {grade:req.grade,classNum:req.classNum,timetables:st.students.sort((a,b)=>a.number-b.number).map(s=>Core.studentTimetable(rt,s))};
 }
 if(a==='roster'){
  const q=req.query||{};
  if(['classSubjects','classSubject','firstGradeSubjects','firstGrade'].includes(q.kind)){
   const source=await S.schedule(db,ctx);
   if(!source.classSubjects){
    const byGrade={1:new Map(),2:new Map(),3:new Map()};
    for(const lesson of Object.values(source.rt.bindings)){
     if(!lesson.rawSubject||lesson.period>Number(ctx.settings.periods[lesson.day]||0))continue;
     for(const key of lesson.classKeys)if(/^[1-3]-[1-9]\d?$/.test(key)){
      const grade=key[0],subjects=byGrade[grade];
      if(grade!=='1'&&(lesson.section||lesson.candidates.length))continue;
      if(!subjects.has(lesson.rawSubject))subjects.set(lesson.rawSubject,new Set());
      subjects.get(lesson.rawSubject).add(key.slice(2));
     }
    }
    source.classSubjects=Object.fromEntries(Object.entries(byGrade).map(([grade,subjects])=>[grade,
     [...subjects].map(([subject,classes])=>({subject,classes:[...classes].sort((a,b)=>a-b)})).sort((a,b)=>a.subject.localeCompare(b.subject,'ko'))]));
   }
   if(q.kind==='classSubjects')return source.classSubjects;
   if(q.kind==='firstGradeSubjects')return source.classSubjects['1'];
   const grade=q.kind==='firstGrade'?'1':String(q.grade);
   if(!['1','2','3'].includes(grade)||!source.classSubjects[grade].some(s=>s.subject===q.subject&&s.classes.includes(q.classNum)))Auth.fail(400,'INVALID_REQUEST','학년·과목·학급을 확인하세요.');
   const students=await db.all("SELECT grade,class_num AS classNum,number,name,note FROM students WHERE term_id=? AND status='재학' AND grade=? AND class_num=? ORDER BY CAST(number AS INTEGER)",ctx.term,grade,q.classNum);
   return {title:q.subject,detail:grade+'학년 '+q.classNum+'반',students};
  }
  if(q.kind==='elective'){
   const c=await db.first('SELECT * FROM sections WHERE term_id=? AND id=?',ctx.term,q.sectionId||'');if(!c)Auth.fail(404,'NOT_FOUND','분반 정보를 찾을 수 없습니다.');
   const rows=await db.all("SELECT s.grade,s.class_num AS classNum,s.number,s.name,s.note FROM assignments a JOIN students s ON s.term_id=a.term_id AND s.id=a.student_id WHERE a.term_id=? AND a.section_id=? AND s.status='재학' ORDER BY CAST(s.grade AS INTEGER),CAST(s.class_num AS INTEGER),CAST(s.number AS INTEGER)",ctx.term,c.id);
   return {title:c.subject,detail:c.code,students:rows};
  }
  const cs=Array.isArray(q.classes)?q.classes:[];if(cs.length>30||cs.some(s=>!String(s).match(/^[1-3]-[1-9][0-9]?$/)))Auth.fail(400,'INVALID_REQUEST','학급을 확인하세요.');
  const rows=await db.all("SELECT grade,class_num AS classNum,number,name,note FROM students WHERE term_id=? AND status='재학' AND grade||'-'||class_num IN (SELECT value FROM json_each(?)) ORDER BY CAST(grade AS INTEGER),CAST(class_num AS INTEGER),CAST(number AS INTEGER)",ctx.term,JSON.stringify(cs));return {title:D.clean(q.subject),detail:D.clean(q.detail)||cs.join(', '),students:rows};
 }
 if(a==='previewImport'){const st=await S.load(db,ctx);return D.prepareImport(st,req.payload,req.preserveManual!==false,String(ctx.revision),true).summary;}
 if(a==='dashboard'){const st=await S.load(db,ctx),rt=Core.runtime(st);return {store:st,meta:await S.metadata(db,ctx,true),...(await links(db,ctx)),lessons:Object.values(rt.bindings).map(D.lesson),history:await db.all('SELECT id,at,term_id AS term,action,target FROM history WHERE term_id=? ORDER BY at DESC LIMIT 100',ctx.term),backups:await S.backupList(db,ctx.term),terms:(await db.all('SELECT id FROM terms ORDER BY id DESC')).map(r=>r.id)};}
 Auth.fail(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
}
async function mutate(db,env,ctx,session,req,headers){
 let result=true,statements=[],parts=[],before=null,after=null,target='',backupId=null,changedStudents=[],changedSection=null,bootstrap=false,activeTerm=ctx.term,historyOnly=false,nextSwapStore=null,allocationReply=null;
 const action=req.action;
 if(action==='saveAllocation'){
  const st=await S.load(db,ctx),prepared=prepareAllocation(st,req.board);before=st.allocation||null;after=prepared.board;target=ctx.term;parts=['sections','allocation'];
  const previous=new Map(st.sections.map(s=>[s.id,s])),changed=prepared.store.sections.filter(s=>{const old=previous.get(s.id);return !old||old.room!==s.room||JSON.stringify(old.manualFields||[])!==JSON.stringify(s.manualFields||[]);});
  const snap=S.snapshot(db,st,'이동수업 배치표 수정 전');backupId=snap.id;statements.push(...snap.statements,...S.writeSections(db,ctx.term,changed),...S.replaceParts(db,prepared.store,['allocation']));
  for(const s of changed)if(!previous.has(s.id))statements.push(db.prepare('UPDATE assignments SET section_id=? WHERE term_id=? AND subject=? AND code=? AND student_id IN (SELECT id FROM students WHERE term_id=? AND grade=?)',s.id,ctx.term,s.subject,s.code,ctx.term,s.grade));
  nextSwapStore=prepared.store;result={warnings:prepared.warnings};allocationReply={board:prepared.board,sections:prepared.store.sections};bootstrap=req.compact!==true;
 }else if(action==='saveStudent'){
  const st=await S.load(db,ctx,['students','sections'],'AND id=?',[req.student?.id||'']);if(req.student?.id&&!st.students.length)Auth.fail(404,'NOT_FOUND','학생 정보가 없습니다.');
  before=st.students[0]||null;result=D.student(req.student||{},before);after=result;target=Core.sid(result)+' '+result.name;parts=['students'];changedStudents=[result];
  statements=S.writeStudents(db,ctx.term,[result],st.sections,st.students);
 }else if(action==='saveSection'){
  const sections=(await db.all('SELECT * FROM sections WHERE term_id=?',ctx.term)).map(S.sectionRow),old=sections.find(s=>s.id===req.section?.id);
  if(req.section?.id&&!old)Auth.fail(404,'NOT_FOUND','분반 정보가 없습니다.');const next=D.section(req.section||{},old);before=old||null;after=next;result=next;changedSection=next;target=next.subject+' '+next.code;parts=['sections'];
  const allocation=(await S.load(db,ctx,['allocation'])).allocation;
  if(allocation?.grades.some(g=>g.blocks.some(b=>Object.values(b.cells).some(c=>c.sectionId===old?.id)))&&next.room!==old.room)throw Error('이 분반의 교실은 이동수업 배치표에서 변경하세요.');
  if(allocation?.grades.some(g=>g.blocks.some(b=>Object.values(b.cells).some(c=>c.sectionId===old?.id)))&&(next.grade!==old.grade||Core.block(next.code)!==Core.block(old.code)))throw Error('배치된 분반의 학년·시간블록은 이동수업 배치를 해제한 뒤 변경하세요.');
  if(old){
   const st=await S.load(db,ctx,['students'],"AND id IN (SELECT student_id FROM assignments WHERE term_id=? AND (section_id=? OR (subject=? AND code=?)))",[ctx.term,old.id,old.subject,old.code]);
   if(st.students.length&&next.grade!==old.grade)throw Error('수강 학생이 있는 분반의 학년은 변경할 수 없습니다.');
   if(next.subject!==old.subject||next.code!==old.code)for(const s of st.students){if(next.subject!==old.subject&&s.choices[next.subject])throw Error('변경할 과목에 이미 배정되어 있습니다.');delete s.choices[old.subject];s.choices[next.subject]=next.code;s.manualFields=[...new Set([...s.manualFields,'choice:'+old.subject,'choice:'+next.subject])];s.updatedAt=new Date().toISOString();changedStudents.push(s);}
  }
  statements.push(...S.writeSections(db,ctx.term,[next]));
  if(changedStudents.length){parts.push('students');statements.push(...S.writeStudents(db,ctx.term,changedStudents,[...sections.filter(s=>s.id!==next.id),next]));}
 }else if(action==='saveOverride'){
  const o=req.override;D.slot(o);const k=Core.slotKey(o.teacher,o.day,o.period);if(o.sectionId&&!await db.first('SELECT id FROM sections WHERE term_id=? AND id=?',ctx.term,o.sectionId))throw Error('분반을 선택하세요.');
  if(!await db.first('SELECT id FROM teachers WHERE term_id=? AND id=?',ctx.term,'teacher:'+Core.norm(o.teacher)))throw Error('교사를 확인하세요.');
  statements.push(db.prepare('DELETE FROM overrides WHERE term_id=? AND slot_key=?',ctx.term,k));if(o.sectionId)statements.push(db.prepare('INSERT INTO overrides(term_id,slot_key,teacher,day,period,section_id) VALUES(?,?,?,?,?,?)',ctx.term,k,D.clean(o.teacher,80),o.day,Number(o.period),o.sectionId));parts=['overrides'];target=k;after=o;
 }else if(action==='saveBlock'||action==='saveBlocks'){
  const bs=action==='saveBlock'?[req.block]:req.blocks;if(!Array.isArray(bs)||bs.length>35||action==='saveBlocks'&&!['1','2','3'].includes(String(req.grade)))throw Error('시간블록을 확인하세요.');
  const seen=new Set();for(const b of bs){D.block(b);const k=b.grade+'-'+b.day+'-'+b.period;if(seen.has(k)||action==='saveBlocks'&&String(b.grade)!==String(req.grade))throw Error('시간블록이 중복되거나 학년이 다릅니다.');seen.add(k);}
  if(action==='saveBlocks')statements.push(db.prepare('DELETE FROM blocks WHERE term_id=? AND grade=?',ctx.term,String(req.grade)));
  for(const b of bs){statements.push(db.prepare('DELETE FROM blocks WHERE term_id=? AND grade=? AND day=? AND period=?',ctx.term,String(b.grade),b.day,Number(b.period)));if(b.block)statements.push(db.prepare('INSERT INTO blocks(term_id,grade,day,period,block) VALUES(?,?,?,?,?)',ctx.term,String(b.grade),b.day,Number(b.period),b.block));}parts=['blocks'];after=bs;
 }else if(action==='saveSettings'){
  const s=D.settings(req.settings);activeTerm=s.academicYear+'-'+s.semester;
  bootstrap=activeTerm!==ctx.term;
  if(bootstrap){
   const defaults=D.settings({...Core.defaultSettings(),schoolName:s.schoolName,title:s.title,academicYear:s.academicYear,semester:s.semester});
   statements.push(db.prepare('INSERT OR IGNORE INTO terms(id,settings) VALUES(?,?)',activeTerm,JSON.stringify(defaults)));
  }else statements.push(db.prepare('UPDATE terms SET settings=? WHERE id=?',JSON.stringify(s),activeTerm));
  parts=['config'];result=s;before=ctx.settings;after=s;
 }else if(action==='switchTerm'){
  if(!await db.first('SELECT id FROM terms WHERE id=?',req.term||''))throw Error('학기 정보가 없습니다.');activeTerm=req.term;parts=['config'];bootstrap=true;
 }else if(action==='commitImport'||action==='restore'){
  const st=await S.load(db,ctx);let next;
  if(action==='commitImport'){const p=D.prepareImport(st,req.payload,req.preserveManual!==false,String(ctx.revision));if(p.summary.errors.length)throw Error(p.summary.errors.join('\n'));next=p.store;parts=p.parts;result=p.summary;}
  else {const raw=req.backup||await S.readBackup(db,req.backupId);if(raw.format!=='school-timetable-backup'||raw.schemaVersion!==1)throw Error('백업 형식·버전을 확인하세요.');next=structuredClone(raw.store);if(!next?.settings||String(next.settings.academicYear)+'-'+next.settings.semester!==ctx.term||next.term&&next.term!==ctx.term)throw Error('백업과 현재 학기가 다릅니다. 먼저 해당 학기로 전환하세요.');next.term=ctx.term;next.overrides??=[];next.blocks??=[];parts=['students','sections','teacherRows','overrides','blocks','allocation','config'];}
  if(next.allocation)next=prepareAllocation(next,next.allocation).store;
  D.assertStore(next);nextSwapStore=next;const snap=S.snapshot(db,st,action==='restore'?'복원 전':'자료 등록 전');backupId=snap.id;
  statements.push(...snap.statements,...S.replaceParts(db,next,parts));if(parts.includes('config'))statements.push(db.prepare('UPDATE terms SET settings=? WHERE id=?',JSON.stringify(D.settings(next.settings)),ctx.term));bootstrap=true;after=action==='commitImport'?result:{backupId:req.backupId||'파일'};target=ctx.term;
 }else if(action==='backup'){
  const snap=S.snapshot(db,await S.load(db,ctx),'수동 백업');statements.push(...snap.statements);result={id:snap.id,backup:snap.backup};backupId=snap.id;historyOnly=true;
 }else if(action==='changePassword'){
  await Auth.rateLimit(db,env.request,'password');
  try{statements=await Auth.passwordChangeStatements(db,env,req);}catch(e){if(e.code==='AUTH_REQUIRED'){await Auth.revoke(db,env.request,env);if(!pagesRequest(env.request,env)){headers.append('Set-Cookie',Auth.cookie('teacher'));headers.append('Set-Cookie',Auth.cookie('admin'));}}throw e;}
  target=req.role;historyOnly=true;
 }else Auth.fail(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
 if(action!=='switchTerm'&&!(action==='saveSettings'&&bootstrap)&&parts.some(p=>p!=='students')){
  const proposed=nextSwapStore||await S.load(db,{...ctx,term:activeTerm,settings:action==='saveSettings'?result:ctx.settings},['sections','teacherRows','overrides','blocks']);
  if(changedSection)proposed.sections=[...proposed.sections.filter(s=>s.id!==changedSection.id),changedSection];
  if(action==='saveOverride'){const o=req.override;proposed.overrides=proposed.overrides.filter(x=>Core.slotKey(x.teacher,x.day,x.period)!==Core.slotKey(o.teacher,o.day,o.period));if(o.sectionId)proposed.overrides.push(o);}
  if(action==='saveBlock'||action==='saveBlocks'){
   const blocks=action==='saveBlock'?[req.block]:req.blocks;
   proposed.blocks=proposed.blocks.filter(x=>action==='saveBlocks'?x.grade!==String(req.grade):!blocks.some(b=>String(b.grade)===x.grade&&b.day===x.day&&Number(b.period)===x.period));
   proposed.blocks.push(...blocks.filter(b=>b.block));
  }
  if(proposed.allocation&&!nextSwapStore)prepareAllocation(proposed,proposed.allocation);
  await validateSchedule(db,proposed);
 }
 await S.commit(db,ctx,session,req,statements,{parts,before,after,target,backupId,activeTerm,historyOnly});
 if(action==='changePassword'&&!pagesRequest(env.request,env))headers.append('Set-Cookie',Auth.cookie(req.role));
 const updated=await S.context(db);if(action==='changePassword')return true;
 const committedRevision=ctx.revision+(historyOnly?0:1);
 const savedRefresh=()=>Auth.fail(409,'SAVED_REFRESH_REQUIRED','저장은 완료됐지만 다른 변경이 이어졌습니다. 입력값을 보관하고 목록을 새로고침하여 결과를 확인하세요.');
 if(updated.revision!==committedRevision||updated.term!==activeTerm)savedRefresh();
 if(!req.patch)return result;
 const out={result,meta:await S.metadata(db,updated,true)};
 if(changedStudents.length)out.students=changedStudents.map(D.studentSummary);if(changedSection)out.section=changedSection;
 if(['saveOverride','saveBlock','saveBlocks'].includes(action)){out.links=await links(db,updated,false);if(req.viewTeacher){const r=await read(db,updated,{action:'adminLessons',teacher:req.viewTeacher});Object.assign(out.links,{teacher:req.viewTeacher,lessons:r.lessons});}}
 if(bootstrap)out.bootstrap=await adminBoot(db,updated);
 if(allocationReply)out.allocation=allocationReply;
 if(action==='backup')out.backups=await S.backupList(db,updated.term);
 const final=await db.first('SELECT revision,active_term FROM app_state WHERE id=1');if(final.revision!==committedRevision||final.active_term!==activeTerm)savedRefresh();
 return out;
}
async function api(request,env){
 const start=performance.now(),db=env.DB?S.database(env.DB):null,headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});let status=200,payload;
 cors(request,env,headers);
 try{
  const url=new URL(request.url),path=url.pathname;
  if(request.method==='OPTIONS'){
   const requested=(request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
   if(!pagesRequest(request,env)||request.headers.get('Access-Control-Request-Method')!=='POST'||requested.some(h=>!['content-type','authorization'].includes(h)))Auth.fail(403,'ORIGIN_REJECTED','요청 출처를 확인하세요.');
   headers.set('Access-Control-Allow-Methods','POST');headers.set('Access-Control-Allow-Headers','Content-Type, Authorization');return new Response(null,{status:204,headers});
  }
  if(path==='/api/health'&&request.method==='GET'){if(!db)Auth.fail(503,'SETUP_REQUIRED','DB 바인딩이 필요합니다.');await S.context(db);return Response.json({ok:true,data:{service:'school-timetable',storage:'D1',sharedTimetable:true}},{headers});}
  if(path==='/api/courseAllocationPolicy'&&request.method==='GET'){
   const ctx=await S.context(db);
   return Response.json({ok:true,data:{term:ctx.term,teachers:ctx.settings.courseAllocationTeachers===true}},{headers});
  }
  const action=path.slice(5);if(!reads.has(action)&&!writes.has(action)&&!['login','logout','passwordParameters','courseLaunch','courseBridge','courseWorkspace'].includes(action)&&!(action==='studyroom'&&env.STUDYROOM_ENABLED==='true'))Auth.fail(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
  if(request.method!=='POST')Auth.fail(405,'METHOD_NOT_ALLOWED','POST 요청을 사용하세요.');
  if(action!=='courseBridge'&&!allowedRequest(request,env))Auth.fail(403,'ORIGIN_REJECTED','요청 출처를 확인하세요.');
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))Auth.fail(415,'INVALID_REQUEST','JSON 요청을 사용하세요.');
  if(!db)Auth.fail(503,'SETUP_REQUIRED','DB 바인딩이 필요합니다.');
  const maxBody=['classSwap','studyroom','courseBridge'].includes(action)?256*1024:action==='courseWorkspace'?5*1024*1024:10*1024*1024;
  const length=Number(request.headers.get('Content-Length')||0);if(length>maxBody)Auth.fail(413,'TOO_LARGE','요청 크기를 확인하세요.');
  const reader=request.body?.getReader(),chunks=[];let size=0;if(reader){while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBody){await reader.cancel();Auth.fail(413,'TOO_LARGE','요청 크기를 확인하세요.');}chunks.push(value);}}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let req;try{req=JSON.parse(new TextDecoder().decode(bytes));}catch{Auth.fail(400,'INVALID_REQUEST','JSON 형식을 확인하세요.');}if(!req||typeof req!=='object'||Array.isArray(req))Auth.fail(400,'INVALID_REQUEST','요청을 확인하세요.');req.action=action;
  let data;
  if(action==='courseWorkspace'){
   if(!['admin','teacher'].includes(req.role))Auth.fail(400,'INVALID_REQUEST','권한을 확인하세요.');
   await Auth.authenticate(db,request,req.role,env);
   if(req.role==='teacher')requireEnabled(await S.context(db));
   if(!env.COURSE_DB)Auth.fail(503,'SETUP_REQUIRED','시수배당 저장소를 확인하세요.');
   if(typeof req.path!=='string'||!['GET','POST','PUT'].includes(req.method)||!req.data||typeof req.data!=='object'||Array.isArray(req.data))Auth.fail(400,'INVALID_REQUEST','시수배당 요청을 확인하세요.');
   data=await courseRequest(env.COURSE_DB,req.role,req.path,req.method,req.data,transfer=>storeCourseTransfer(db,transfer));
  }
  else if(action==='courseLaunch')data=await launchCourse(db,await S.context(db),env,request,req.role);
  else if(action==='courseBridge')data=await bridgeCourse(db,env,req);
  else if(action==='passwordParameters')data=await Auth.parameters(db,env,req.role);
  else if(action==='logout'){await Auth.revoke(db,request,env);if(!pagesRequest(request,env)){headers.append('Set-Cookie',Auth.cookie('teacher'));headers.append('Set-Cookie',Auth.cookie('admin'));}data=true;}
  else if(action==='login'){
   data=await Auth.login(db,env,request,req,headers);if(req.initialize){const ctx=await S.context(db);data.initial=req.role==='admin'?await adminBoot(db,ctx):await teacherBoot(db,ctx);}
  }else if(action==='studyroom')data=await studyroom(db,await S.context(db),env,req,request);
  else{
   const requiresAdmin=!teacherActions.has(action)||action==='classSwap'&&req.swapScope==='admin';
   const session=action==='bootstrap'||action==='student'?null:await Auth.authenticate(db,request,requiresAdmin?'admin':'teacher',env);
   if(action==='student')await Auth.rateLimit(db,request,'student',60);
   const ctx=await S.context(db);
   if(req.viewTerm&&req.viewTerm!==ctx.term)Auth.fail(409,'TERM_CHANGED','활성 학기가 변경되어 해당 학기 자료를 다시 불러옵니다. 이전 입력값은 이전 학기의 초안으로 보관합니다.');
   if(action==='classSwap'){
    data=await classSwap(db,ctx,session,req);
    if(data.role==='teacher'&&req.swapPayload.term&&req.swapPayload.term!==ctx.term){data.teacherBootstrap=await teacherBoot(db,ctx);const current=await db.first('SELECT revision,active_term FROM app_state WHERE id=1');if(current.revision!==ctx.revision||current.active_term!==ctx.term)Auth.fail(409,'READ_CHANGED','자료가 변경되었습니다. 다시 조회하세요.');}
   }
   else if(writes.has(action)){if(req.expectedTerm!==ctx.term||req.expectedRevision!==String(ctx.revision))Auth.fail(409,'CONFLICT','자료 또는 학기가 변경되었습니다. 입력값을 복사한 뒤 새로고침하여 다시 저장하세요.');data=await mutate(db,{...env,request},ctx,session,req,headers);}
   else {data=await read(db,ctx,req);const check=await db.first('SELECT revision,active_term FROM app_state WHERE id=1');if(check.revision!==ctx.revision||check.active_term!==ctx.term)Auth.fail(409,'READ_CHANGED','자료가 변경되었습니다. 다시 조회하세요.');}
  }
  for(const result of [data,data?.initial,data?.bootstrap,data?.teacherBootstrap])if(result?.meta)result.meta.features={studyroom:env.STUDYROOM_ENABLED==='true'};
  if(action==='bootstrap')data.features={studyroom:env.STUDYROOM_ENABLED==='true'};
  payload={ok:true,data};
 }catch(e){
  if(String(e.message).includes('revision_conflict')){e.status=409;e.code='CONFLICT';}
  if(String(e.message).includes('auth_required')){e.status=401;e.code='AUTH_REQUIRED';}
  if(String(e.message).includes('sr_revision_conflict')){e.status=409;e.code='SR_CONFLICT';e.message='자료가 변경되었습니다. 새로고침한 뒤 다시 시도하세요.';}
  if(String(e.message).includes('sr_record_conflict')){e.status=409;e.code='SR_CONFLICT';e.message='같은 학생의 출석이 변경되었습니다. 다시 제출하세요.';}
  if(String(e.message).includes('sr_session_closed')){e.status=409;e.code='CLOSED';e.message='회차가 마감되었습니다. 현재 회차를 확인하세요.';}
  if(String(e.message).includes('sr_staff_required')){e.status=401;e.code='STAFF_REQUIRED';e.message='출석 확인자 계정으로 다시 로그인하세요.';}
  if(String(e.message).includes('shared_migration_in_progress')){e.status=503;e.code='MIGRATING';e.message='자료 통합 중입니다. 잠시 후 다시 저장하세요. 입력 내용은 유지됩니다.';}
  if(/UNIQUE constraint failed/.test(e.message)){e.status=409;e.code='CONFLICT';}
  status=e.status||400;payload={ok:false,code:e.code||'REQUEST_ERROR',error:status>=500&&e.code!=='MIGRATING'?'서버 설정 또는 처리를 확인하세요.':e.message};if(status===429)headers.set('Retry-After','60');
 }
 headers.set('Server-Timing',`app;dur=${(performance.now()-start).toFixed(2)}, db;dur=${(db?.stats.ms||0).toFixed(2)}`);headers.set('X-D1-Rows-Read',String(db?.stats.read||0));headers.set('X-D1-Rows-Written',String(db?.stats.written||0));
 return Response.json(payload,{status,headers});
}
export default {
 async fetch(request,env){const url=new URL(request.url);if(url.pathname==='/api'||url.pathname.startsWith('/api/'))return api(request,env);return env.ASSETS.fetch(request);},
 async scheduled(event,env){if(env.STUDYROOM_ENABLED==='true'&&env.STUDYROOM_CRON_ENABLED==='true')await runStudyroomSchedule(S.database(env.DB),new Date(event.scheduledTime).toISOString());}
};
