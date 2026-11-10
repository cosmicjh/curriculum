import * as Auth from './auth.js';
import * as D from './domain.js';
import * as S from './storage.js';
import Core from './core.js';

const encoder=new TextEncoder(),decoder=new TextDecoder();
const encode=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const decode=hex=>Uint8Array.from(hex.match(/../g),b=>parseInt(b,16));

async function key(env){
 if(!/^[a-f0-9]{64}$/.test(env.PASSWORD_PEPPER||''))Auth.fail(503,'SETUP_REQUIRED','서버 초기 계정 설정이 필요합니다.');
 const material=await crypto.subtle.digest('SHA-256',encoder.encode('timetable-course-access:'+env.PASSWORD_PEPPER));
 return crypto.subtle.importKey('raw',material,'AES-GCM',false,['encrypt','decrypt']);
}
function requireEnabled(ctx){
 if(ctx.settings.courseAllocationTeachers!==true)Auth.fail(403,'COURSE_CLOSED','시수배당표가 열려 있지 않습니다. 관리자 설정에서 시수배당표 사용을 허용해 주세요.');
}
export async function launchCourse(db,ctx,env,request,role){
 if(!['teacher','admin'].includes(role))Auth.fail(400,'INVALID_REQUEST','권한을 확인하세요.');
 const session=await Auth.authenticate(db,request,role,env);
 if(role==='teacher')requireEnabled(ctx);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=encoder.encode(JSON.stringify({session:session.token_hash,role}));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),data));
 return {token:'tt.'+encode(iv)+encode(ciphertext)};
}
async function courseSession(db,env,token){
 if(!/^tt\.(?:[a-f0-9]{2}){36,256}$/.test(token||''))Auth.fail(401,'AUTH_REQUIRED','통합시간표에서 시수배당표를 다시 열어 주세요.');
 const bytes=decode(token.slice(3)),secret=await key(env);
 let grant;
 try{grant=JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},secret,bytes.slice(12))));}
 catch{Auth.fail(401,'AUTH_REQUIRED','통합시간표에서 시수배당표를 다시 열어 주세요.');}
 const session=await db.first('SELECT s.role FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch WHERE s.token_hash=? AND s.expires_at>?',grant.session,Date.now());
 if(!session||grant.role==='admin'&&session.role!=='admin')Auth.fail(401,'AUTH_REQUIRED','통합시간표에서 시수배당표를 다시 열어 주세요.');
 if(grant.role==='teacher')requireEnabled(await S.context(db));
 return {role:grant.role};
}
export async function bridgeCourse(db,env,req){
 const session=await courseSession(db,env,req.token);
 if(!req.transfer)return session;
 if(session.role!=='admin')Auth.fail(403,'ADMIN_REQUIRED','관리자만 시간표로 전달할 수 있습니다.');
 const {term,sections}=req.transfer;
 if(!/^(?:20[2-9]\d|2100)-[12]$/.test(term)||req.transfer.format!=='school-course-allocation-transfer'||req.transfer.schemaVersion!==1||!Array.isArray(sections)||!sections.length||sections.length>3000)Auth.fail(400,'INVALID_REQUEST','전달 자료의 학기와 형식을 확인하세요.');
 const keys=new Set(),validHours=hours=>Number.isInteger(hours)&&hours>0&&hours<=40;
 const normalized=sections.map(s=>{
  const code=D.clean(s.code,30),subject=D.clean(s.subject),grade=String(s.grade),key=Core.sectionKey(grade,subject,code);
  if(!['1','2','3'].includes(grade)||!subject||!Core.block(code)||keys.has(key)||!validHours(s.weeklyHours)||!Array.isArray(s.teachers)||s.teachers.length>40)Auth.fail(400,'INVALID_REQUEST','전달 자료의 과목·분반·시수를 확인하세요.');
  const teachers=s.teachers.map(t=>({name:D.clean(t.name,80),hours:t.hours}));
  if(teachers.some(t=>!t.name||!validHours(t.hours))||teachers.reduce((sum,t)=>sum+t.hours,0)!==s.weeklyHours)Auth.fail(400,'INVALID_REQUEST','담당 교사와 시수를 확인하세요.');
  keys.add(key);return {grade,subject,code,weeklyHours:s.weeklyHours,teachers};
 });
 const ctx=await S.context(db),[academicYear,semester]=term.split('-').map(Number),at=new Date().toISOString();
 const defaults=D.settings({...Core.defaultSettings(),academicYear,semester,schoolName:ctx.settings.schoolName,title:ctx.settings.title});
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO terms(id,settings) VALUES(?,?)',term,JSON.stringify(defaults)),
  db.prepare('INSERT INTO course_transfers(term_id,content,saved_at) VALUES(?,?,?) ON CONFLICT(term_id) DO UPDATE SET content=excluded.content,saved_at=excluded.saved_at',term,JSON.stringify({format:req.transfer.format,schemaVersion:1,term,sections:normalized}),at),
  db.prepare('UPDATE app_state SET history_revision=history_revision+1 WHERE id=1')
 ]);
 return {term,sections:sections.length};
}
