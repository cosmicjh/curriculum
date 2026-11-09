import * as A from './auth.js';
import * as S from './storage.js';
import * as D from './studyroom-domain.js';
import {digest,randomToken,publicParameters,credentialFromProof,passwordMatches} from './crypto.js';
const uid=()=>crypto.randomUUID(),iso=()=>new Date().toISOString();
const schedules=db=>db.all('SELECT * FROM sr_schedules ORDER BY effective_date DESC,version DESC');
const state=db=>db.first('SELECT * FROM sr_state WHERE id=1');
const recordColumns=['id','session_id','person_id','term_id','student_id','student_number','name','seat','state','first_at','last_at','confirmed_by','confirmed_name','confirmed_at','version'];
function saveRecord(db,r){return db.prepare(`INSERT INTO sr_attendance(${recordColumns}) VALUES(${recordColumns.map(()=>'?')}) ON CONFLICT(id) DO UPDATE SET seat=excluded.seat,state=excluded.state,last_at=excluded.last_at,confirmed_by=excluded.confirmed_by,confirmed_name=excluded.confirmed_name,confirmed_at=excluded.confirmed_at,version=excluded.version`,...recordColumns.map(k=>r[k]??null));}
function saveSession(db,s){const keys=['id','date','label','academic_year','schedule_id','starts_at','ends_at'];return db.prepare(`INSERT OR IGNORE INTO sr_sessions(${keys}) VALUES(${keys.map(()=>'?')})`,...keys.map(k=>s[k]));}
function event(db,{requestId=uid(),fingerprint='',action,sessionId=null,personId=null,at=iso(),actor,reason='',record}){
 return db.prepare('INSERT INTO sr_events(id,request_id,fingerprint,action,session_id,person_id,at,actor,reason,record) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),requestId,fingerprint,action,sessionId,personId,at,actor,reason,JSON.stringify(record));
}
async function commit(db,ctx,st,actor,statements){
 const id=uid();await db.batch([
  db.prepare('INSERT INTO sr_write_guards(id,revision,policy_revision,tt_revision,term_id,at,kind,token_hash,origin,record_id,record_version,session_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,st.revision,st.policy_revision,ctx.revision,ctx.term,Date.now(),actor.kind,actor.token_hash||null,actor.origin||null,actor.record_id||null,actor.record_version??null,actor.session_id||null),
  ...statements,db.prepare('UPDATE sr_state SET revision=revision+1,policy_revision=policy_revision+? WHERE id=1',actor.kind==='admin'?1:0),db.prepare('DELETE FROM sr_write_guards WHERE id=?',id)
 ]);
}
async function staffIdentity(db,req,request,required=true){
 const token=req.staffToken,origin=request.headers.get('Origin');let user=null;
 if(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token))user=await db.first('SELECT u.id,u.username,u.name,s.token_hash,s.origin FROM sr_staff_sessions s JOIN sr_staff u ON u.id=s.staff_id AND u.epoch=s.epoch WHERE s.token_hash=? AND s.origin=? AND u.enabled=1 AND s.expires_at>?',await digest(token),origin,Date.now());
 if(!user&&required)A.fail(401,'STAFF_REQUIRED','출석 확인자 계정으로 로그인하세요.');
 return user?{...user,kind:'staff'}:null;
}
function adminActor(session){return {kind:'admin',token_hash:session.token_hash};}
function requireRevision(st,req){if(req.expectedRevision!==st.revision)A.fail(409,'SR_CONFLICT','출석이나 설정이 변경되었습니다. 새로고침한 뒤 다시 저장하세요.');}
async function findStudent(db,ctx,n){
 return db.first(`SELECT s.*,l.person_id,coalesce(m.enabled,1) AS eligible FROM students s JOIN student_person_links l ON l.term_id=s.term_id AND l.student_id=s.id LEFT JOIN sr_members m ON m.person_id=l.person_id WHERE s.term_id=? AND s.grade=? AND s.class_num=? AND s.number=? AND s.status='재학'`,ctx.term,n[0],String(Number(n.slice(1,3))),String(Number(n.slice(3))));
}
async function openSession(db,ctx,st,now){
 if(!st.enabled)A.fail(409,'CLOSED','현재 출석 접수를 받지 않습니다.');
 const s=D.currentSession(await schedules(db),ctx,now);if(!s)A.fail(409,'CLOSED','현재 접수할 회차가 없습니다.');return s;
}
async function replay(db,id,fingerprint){
 const e=await db.first('SELECT fingerprint,record FROM sr_events WHERE request_id=?',id);if(!e)return null;
 if(e.fingerprint!==fingerprint)A.fail(409,'REQUEST_REUSED','요청 내용이 달라졌습니다. 입력을 다시 확인하세요.');return JSON.parse(e.record);
}
async function student(db,ctx,req,submit){
 const n=D.number(req.studentNumber),seat=D.seat(req.seat),fingerprint=await digest(JSON.stringify(['submit',n,seat]));
 if(submit){D.requestId(req.requestId);const prior=await replay(db,req.requestId,fingerprint);if(prior)return prior;}
 for(let attempt=0;attempt<3;attempt++){
  const st=await state(db),now=iso(),s=await openSession(db,ctx,st,now),person=await findStudent(db,ctx,n);
  if(!person||!person.eligible)A.fail(404,'NOT_ELIGIBLE','이용 가능한 학생 정보가 없습니다. 교사에게 확인하세요.');
  const info={studentNumber:n,name:person.name,seat,session:{id:s.id,label:s.label,date:s.date,endsAt:s.ends_at}};if(!submit)return info;
  const previous=await db.first('SELECT * FROM sr_attendance WHERE session_id=? AND person_id=?',s.id,person.person_id);
  const r={id:previous?.id||uid(),session_id:s.id,person_id:person.person_id,term_id:ctx.term,student_id:person.id,student_number:n,name:person.name,seat,state:'active',first_at:previous?.first_at||now,last_at:now,confirmed_by:previous?.seat===seat&&previous.state==='active'?previous.confirmed_by:null,confirmed_name:previous?.seat===seat&&previous.state==='active'?previous.confirmed_name:null,confirmed_at:previous?.seat===seat&&previous.state==='active'?previous.confirmed_at:null,version:(previous?.version||0)+1};
  if(previous)for(const k of ['term_id','student_id','student_number','name'])r[k]=previous[k];
  const reply={...info,recordId:r.id,submittedAt:r.first_at};
  try{await commit(db,ctx,st,{kind:'student',record_id:previous?.id,record_version:previous?.version,session_id:s.id},[saveSession(db,s),saveRecord(db,r),event(db,{requestId:req.requestId,fingerprint,action:'submit',sessionId:s.id,personId:person.person_id,at:now,actor:'student',record:reply}),event(db,{action:'recordSnapshot',sessionId:s.id,personId:person.person_id,at:now,actor:'student',record:r})]);return reply;}
  catch(e){const prior=await replay(db,req.requestId,fingerprint);if(prior)return prior;if(/sr_revision_conflict|sr_record_conflict|UNIQUE.*sr_attendance.session_id, sr_attendance.person_id/.test(e.message)&&attempt<2){ctx=await S.context(db);continue;}if(/UNIQUE.*sr_attendance.session_id, sr_attendance.seat/.test(e.message))A.fail(409,'SEAT_OCCUPIED','이미 사용 중인 좌석입니다. 교사에게 확인하세요.');throw e;}
 }
}
async function dashboard(db,ctx,env,req){
 const st=await state(db),now=iso(),rules=await schedules(db),current=D.currentSession(rules,ctx,now);
 const rows=current?await db.all("SELECT * FROM sr_attendance WHERE session_id=? AND state='active' ORDER BY student_number",current.id):[];
 return {revision:st.revision,enabled:Boolean(st.enabled),current,rows,serverAt:now,lastRunAt:st.last_run_at,lastError:st.last_error,cronEnabled:env.STUDYROOM_CRON_ENABLED==='true',testLabel:env.STUDYROOM_TEST_MODE==='true'?'가상 검증':'',term:ctx.term,academicYear:ctx.settings.academicYear,staff:req.staff||null};
}
async function students(db,ctx,req){
 const search=String(req.search||'').trim().slice(0,80),q='%'+search+'%';
 const rows=await db.all(`SELECT s.id,s.name,s.status,s.grade,s.class_num,s.number,l.person_id,coalesce(m.enabled,1) AS eligible FROM students s JOIN student_person_links l ON l.term_id=s.term_id AND l.student_id=s.id LEFT JOIN sr_members m ON m.person_id=l.person_id WHERE s.term_id=? AND (s.name LIKE ? OR s.grade||printf('%02d',s.class_num)||printf('%02d',s.number) LIKE ?) ORDER BY s.grade,CAST(s.class_num AS INTEGER),CAST(s.number AS INTEGER) LIMIT 50`,ctx.term,q,q);
 const result=rows.map(s=>({...s,studentNumber:D.studentNumber(s),current:true})),seen=new Set(result.map(s=>s.person_id));
 if(search){const history=await db.all('SELECT person_id,name,student_number FROM sr_attendance WHERE name LIKE ? OR student_number LIKE ? ORDER BY last_at DESC LIMIT 100',q,q);for(const s of history)if(!seen.has(s.person_id)){seen.add(s.person_id);result.push({person_id:s.person_id,name:s.name,studentNumber:s.student_number,current:false});}}
 return {students:result};
}
async function query(db,req){
 const from=D.date(req.from),to=D.date(req.to);D.check(from<=to&&new Date(to)-new Date(from)<=366*86400000,'조회 기간은 1년 이내로 선택하세요.');
 const offset=req.offset||0;D.check(Number.isInteger(offset)&&offset>=0&&offset<=100000,'조회 위치를 확인하세요.');
 const conditions=['s.date BETWEEN ? AND ?'],args=[from,to];
 if(req.personId){D.check(typeof req.personId==='string'&&req.personId.length<=220,'학생을 선택하세요.');conditions.push('a.person_id=?');args.push(req.personId);}
 if(req.confirmedOnly)conditions.push('a.confirmed_at IS NOT NULL');
 if(!req.includeCancelled)conditions.push("a.state='active'");
 const where=conditions.join(' AND '),base=' FROM sr_attendance a JOIN sr_sessions s ON s.id=a.session_id WHERE '+where;
 const [rows,days,totals]=await db.batch([
  db.prepare('SELECT a.*,s.date,s.label,s.academic_year'+base+' ORDER BY s.date DESC,s.starts_at DESC,a.student_number LIMIT 200 OFFSET ?',...args,offset),
  db.prepare("SELECT s.date,count(*) AS records,count(DISTINCT a.person_id) AS students,sum(CASE WHEN a.confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS confirmed"+base+' GROUP BY s.date ORDER BY s.date',...args),
  db.prepare('SELECT count(*) AS records,count(DISTINCT s.date) AS days,count(DISTINCT a.person_id) AS students'+base,...args)
 ]);
 return {rows:rows.results,calendar:days.results,totals:totals.results[0],offset,next:offset+rows.results.length<totals.results[0].records?offset+rows.results.length:null};
}
async function changeAttendance(db,ctx,req,identity){
 D.requestId(req.requestId);D.check(['confirm','unconfirm','cancel','restore','move','manual'].includes(req.change),'변경 작업을 확인하세요.');
 const reason=String(req.reason||'').trim();D.check(reason.length<=200&&(['confirm','unconfirm'].includes(req.change)||reason.length>0),'변경 사유를 입력하세요.');
 const fingerprint=await digest(JSON.stringify(['change',identity.id,req.change,req.recordId||'',req.studentNumber||'',req.seat||'',reason,req.expectedRecordVersion??null,req.expectedSessionId??null]));
 const prior=await replay(db,req.requestId,fingerprint);if(prior)return prior;
 const st=await state(db),now=iso();let r,s,expectedRecord=null;
 if(req.change==='manual'){
  s=await openSession(db,ctx,st,now);if(req.expectedSessionId!==s.id)A.fail(409,'SESSION_CHANGED','회차가 변경되었습니다. 현재 회차를 확인하고 다시 등록하세요.');
  const person=await findStudent(db,ctx,D.number(req.studentNumber));D.check(person?.eligible,'이용 가능한 학생을 선택하세요.');D.seat(req.seat);
  const old=await db.first('SELECT * FROM sr_attendance WHERE session_id=? AND person_id=?',s.id,person.person_id);D.check(!old||old.state==='cancelled','이미 제출한 학생입니다.');
  r={id:old?.id||uid(),session_id:s.id,person_id:person.person_id,term_id:ctx.term,student_id:person.id,student_number:req.studentNumber,name:person.name,seat:req.seat,state:'active',first_at:old?.first_at||now,last_at:now,version:(old?.version||0)+1,confirmed_by:null,confirmed_name:null,confirmed_at:null};
  if(old)for(const k of ['term_id','student_id','student_number','name'])r[k]=old[k];
  expectedRecord=old;
 }else{
  r=await db.first('SELECT * FROM sr_attendance WHERE id=?',req.recordId||'');D.check(r,'출석 기록이 없습니다.');
  if(req.expectedRecordVersion!==r.version)A.fail(409,'SR_RECORD_CHANGED','이 학생의 출석이 변경되었습니다. 입력을 보관하고 기록을 다시 열어 확인하세요.');
  expectedRecord={id:r.id,version:r.version};
  if(req.change==='confirm'){D.check(r.state==='active','취소된 출석은 확인할 수 없습니다.');Object.assign(r,{confirmed_by:identity.id,confirmed_name:identity.name,confirmed_at:now});}
  if(req.change==='unconfirm')Object.assign(r,{confirmed_by:null,confirmed_name:null,confirmed_at:null});
  if(req.change==='cancel'){r.state='cancelled';Object.assign(r,{confirmed_by:null,confirmed_name:null,confirmed_at:null});}
  if(['restore','move'].includes(req.change)){
   if(req.change==='move')r.seat=D.seat(req.seat);r.state='active';Object.assign(r,{confirmed_by:null,confirmed_name:null,confirmed_at:null});
  }
  r.last_at=now;r.version++;
 }
 r.actorName=identity.name;
 await commit(db,ctx,st,{...identity,record_id:expectedRecord?.id,record_version:expectedRecord?.version,session_id:s?.id},[...(s?[saveSession(db,s)]:[]),saveRecord(db,r),event(db,{requestId:req.requestId,fingerprint,action:req.change,sessionId:r.session_id,personId:r.person_id,actor:identity.id,reason,record:r})]);return r;
}
async function configure(db,ctx,req,session){
 const st=await state(db);requireRevision(st,req);D.check(typeof req.enabled==='boolean','접수 상태를 확인하세요.');const statements=[];
 if(req.schedule){const today=D.localTime(iso()).date,r=D.schedule(req.schedule,today);if((await schedules(db)).some(s=>s.effective_date<=today)&&r.effectiveDate===today)A.fail(409,'SCHEDULE_IN_USE','기존 회차를 보존하도록 새 시정은 내일 이후 적용하세요.');
  statements.push(db.prepare('INSERT INTO sr_schedules VALUES(?,?,?,?,?,?)',uid(),r.effectiveDate,JSON.stringify(r.definitions),st.revision+1,iso(),'role:admin'));
 }
 if(req.enabled)D.check(req.schedule||(await schedules(db)).length,'시정을 먼저 입력하세요.');
 statements.push(db.prepare('UPDATE sr_state SET enabled=? WHERE id=1',req.enabled?1:0),event(db,{action:'configuration',actor:'role:admin',record:{enabled:req.enabled,schedule:req.schedule||null}}));
 await commit(db,ctx,st,adminActor(session),statements);return true;
}
async function saveStaff(db,ctx,env,req,session){
 const st=await state(db);requireRevision(st,req);const u=req.staff||{};
 D.check(typeof u.username==='string'&&/^[A-Za-z0-9._@-]{3,100}$/.test(u.username)&&typeof u.name==='string'&&u.name.trim().length>0&&u.name.trim().length<=80&&typeof u.enabled==='boolean','계정·이름·사용 여부를 확인하세요.');
 const old=await db.first('SELECT * FROM sr_staff WHERE username=?',u.username);let hash=old?.password_hash;
 if(u.passwordProof){D.check(Number.isInteger(u.passwordLength)&&u.passwordLength>=8&&u.passwordLength<=128,'개별 비밀번호는 8자 이상으로 설정하세요.');hash=await credentialFromProof(u.passwordProof,u.passwordSalt,'studyroom:'+u.username,env.PASSWORD_PEPPER);}
 D.check(hash,'새 계정의 비밀번호를 입력하세요.');
 await commit(db,ctx,st,adminActor(session),[db.prepare('INSERT INTO sr_staff(id,username,name,password_hash,enabled) VALUES(?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET name=excluded.name,password_hash=excluded.password_hash,enabled=excluded.enabled,epoch=sr_staff.epoch+1',old?.id||uid(),u.username,u.name.trim(),hash,u.enabled?1:0),event(db,{action:'staff',actor:'role:admin',record:{username:u.username,name:u.name,enabled:u.enabled}})]);return true;
}
async function loginStaff(db,env,req,request){
 await A.rateLimit(db,request,'sr-staff-login',30);const u=await db.first('SELECT * FROM sr_staff WHERE username=? AND enabled=1',String(req.username||'').slice(0,100));
 if(!u||u.epoch!==req.epoch||!await passwordMatches(req.passwordProof,u.password_hash,env.PASSWORD_PEPPER,'studyroom:'+u.username))A.fail(401,'STAFF_REQUIRED','확인자 계정과 비밀번호를 확인하세요.');
 const token=randomToken(),expiresAt=Date.now()+6*3600000;
 const saved=await db.batch([db.prepare('DELETE FROM sr_staff_sessions WHERE expires_at<=?',Date.now()),db.prepare('INSERT INTO sr_staff_sessions SELECT ?,id,epoch,?,? FROM sr_staff WHERE id=? AND epoch=? AND enabled=1',await digest(token),request.headers.get('Origin'),expiresAt,u.id,u.epoch)]);
 if(!saved.at(-1).meta.changes)A.fail(409,'STAFF_REQUIRED','계정이 변경되었습니다. 다시 로그인하세요.');
 return {token,name:u.name,expiresAt};
}
export async function runStudyroomSchedule(db,now=iso()){
 let closed=0;
 // Bound each invocation for the free CPU budget; later ticks close the backlog.
 for(let attempts=0;attempts<3&&closed<1;attempts++){
  const ctx=await S.context(db),st=await state(db),s=await db.first("SELECT * FROM sr_sessions WHERE status='open' AND ends_at<=? ORDER BY ends_at LIMIT 1",now);if(!s)break;
  const rows=await db.all('SELECT * FROM sr_attendance WHERE session_id=? ORDER BY id',s.id),content=JSON.stringify(rows),sha=await digest(content);
  try{await commit(db,ctx,st,{kind:'system'},[
   db.prepare('INSERT INTO sr_archives(session_id,content,sha256,record_count,created_at) VALUES(?,?,?,?,?)',s.id,content,sha,rows.length,now),
   db.prepare("UPDATE sr_sessions SET status='closed',closed_at=? WHERE id=? AND status='open'",now,s.id),
   event(db,{requestId:'close:'+s.id,action:'close',sessionId:s.id,at:now,actor:'scheduler',record:{count:rows.length,sha256:sha}})
  ]);closed++;}catch(e){if(/sr_revision_conflict|UNIQUE.*sr_archives/.test(e.message))continue;await db.batch([db.prepare('UPDATE sr_state SET last_error=? WHERE id=1','자동 마감을 완료하지 못했습니다. 기록은 보존되며 재시도합니다.')]);throw e;}
 }
 await db.batch([db.prepare('UPDATE sr_state SET last_run_at=?,last_error=NULL WHERE id=1',now)]);return {closed};
}
export async function studyroom(db,ctx,env,req,request){
 const op=req.op;
 if(['studentInfo','submit'].includes(op)){await A.rateLimit(db,request,'sr-student',600);return student(db,ctx,req,op==='submit');}
 const adminOps=new Set(['configuration','saveStaff','staffList','setMember','linkStudent','export','closeDue']);
 const session=await A.authenticate(db,request,adminOps.has(op)?'admin':'teacher',env);
 if(op==='dashboard'){const identity=await staffIdentity(db,req,request,false);return dashboard(db,ctx,env,{staff:identity?{id:identity.id,name:identity.name}:null});}
 if(op==='students')return students(db,ctx,req);
 if(op==='query')return query(db,req);
 if(op==='history'){D.check(typeof req.recordId==='string','출석 기록을 선택하세요.');return {events:await db.all('SELECT id,action,at,actor,reason,record FROM sr_events WHERE session_id=(SELECT session_id FROM sr_attendance WHERE id=?) AND person_id=(SELECT person_id FROM sr_attendance WHERE id=?) ORDER BY seq',req.recordId,req.recordId)};}
 if(op==='change')return changeAttendance(db,ctx,req,await staffIdentity(db,req,request));
 if(op==='staffParameters'){await A.rateLimit(db,request,'sr-staff-parameters',30);const u=await db.first('SELECT password_hash,epoch FROM sr_staff WHERE username=? AND enabled=1',String(req.username||'').slice(0,100));return u?publicParameters(u):{salt:randomToken().slice(0,32),iterations:100000,epoch:0};}
 if(op==='staffLogin')return loginStaff(db,env,req,request);
 if(op==='staffLogout'){const user=await staffIdentity(db,req,request,false);if(user)await db.batch([db.prepare('DELETE FROM sr_staff_sessions WHERE token_hash=?',user.token_hash)]);return true;}
 if(op==='configuration')return configure(db,ctx,req,session);
 if(op==='settings')return {revision:(await state(db)).revision,schedules:await schedules(db)};
 if(op==='saveStaff')return saveStaff(db,ctx,env,req,session);
 if(op==='staffList')return {staff:await db.all('SELECT id,username,name,enabled FROM sr_staff ORDER BY name')};
 if(op==='setMember'){
  const st=await state(db);requireRevision(st,req);D.check(typeof req.enabled==='boolean'&&await db.first('SELECT id FROM student_people WHERE id=?',req.personId||''),'학생·이용 상태를 확인하세요.');
  await commit(db,ctx,st,adminActor(session),[db.prepare('INSERT INTO sr_members VALUES(?,?) ON CONFLICT(person_id) DO UPDATE SET enabled=excluded.enabled',req.personId,req.enabled?1:0),event(db,{action:'membership',actor:'role:admin',personId:req.personId,record:{enabled:req.enabled}})]);return true;
 }
 if(op==='linkStudent'){
  const st=await state(db);requireRevision(st,req);D.check(typeof req.studentId==='string'&&typeof req.personId==='string','연결할 학생을 선택하세요.');
  const old=await db.first('SELECT person_id FROM student_person_links WHERE term_id=? AND student_id=?',ctx.term,req.studentId);
  D.check(old&&await db.first('SELECT id FROM students WHERE term_id=? AND id=?',ctx.term,req.studentId)&&await db.first('SELECT id FROM student_people WHERE id=?',req.personId),'연결할 학생 정보가 없습니다.');
  D.check(!await db.first('SELECT id FROM sr_attendance WHERE person_id=? LIMIT 1',old.person_id),'현재 학생에게 이미 출석이 있습니다. 이력 병합을 먼저 검토하세요.');
  D.check(!await db.first('SELECT student_id FROM student_person_links WHERE term_id=? AND person_id=? AND student_id!=?',ctx.term,req.personId,req.studentId),'같은 학기의 다른 학생과 연결되어 있습니다.');
  await commit(db,ctx,st,adminActor(session),[db.prepare('UPDATE student_person_links SET person_id=? WHERE term_id=? AND student_id=?',req.personId,ctx.term,req.studentId),event(db,{action:'personLink',actor:'role:admin',personId:req.personId,record:{term:ctx.term,studentId:req.studentId,previousPersonId:old.person_id}})]);return true;
 }
 if(op==='closeDue')return runStudyroomSchedule(db);
 if(op==='export'){
  const data={};for(const table of ['student_people','student_person_links','sr_state','sr_members','sr_schedules','sr_sessions','sr_attendance','sr_events','sr_archives'])data[table]=await db.all('SELECT * FROM '+table);
  const after=await state(db),tt=await S.context(db);D.check(data.sr_state[0].revision===after.revision&&tt.revision===ctx.revision&&tt.term===ctx.term,'자료가 변경되었습니다. 다시 내보내세요.');return {format:'school-studyroom-export',schemaVersion:1,exportedAt:iso(),data,sha256:await digest(JSON.stringify(data))};
 }
 A.fail(404,'NOT_FOUND','스터디룸 요청을 찾을 수 없습니다.');
}
