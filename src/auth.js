import {validHash,passwordMatches,publicParameters,randomToken,digest,credentialFromProof} from './crypto.js';
import {pagesRequest} from './origin.js';
export function fail(status,code,message){const e=Error(message);Object.assign(e,{status,code});throw e;}
export const roles=['student','teacher','admin'];
const allowedRole=(actual,required)=>actual===required||actual==='admin'&&required==='teacher';
export const cookieName=role=>'__Host-tt_'+role;
export function cookie(role,token='',ttl=0){return `${cookieName(role)}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttl}`;}
export async function credentials(db,env){
 if(!/^[a-f0-9]{64}$/.test(env.PASSWORD_PEPPER||''))fail(503,'SETUP_REQUIRED','서버 초기 계정 설정이 필요합니다.');
 let rows=await db.all('SELECT * FROM credentials');
 if(rows.length<roles.length){
  const missing=roles.filter(role=>!rows.some(row=>row.role===role));
  const statements=[];
  for(const role of missing){
   // The initial student password is public. Stretch it offline to keep Worker CPU low.
   const hash=role==='student'?await credentialFromProof('32bb4118f1416498ab04e5e86eac61d01d2ecf8145a818e70259493b2108e5af','e19da162133c4c42bac77adf26201c97',role,env.PASSWORD_PEPPER):env['BOOTSTRAP_'+role.toUpperCase()+'_HASH'];
   if(!validHash(hash))fail(503,'SETUP_REQUIRED','서버 초기 계정 설정이 필요합니다.');
   statements.push(db.prepare('INSERT OR IGNORE INTO credentials(role,password_hash) VALUES(?,?)',role,hash));
  }
  await db.batch(statements);
  rows=await db.all('SELECT * FROM credentials');
 }return Object.fromEntries(rows.map(r=>[r.role,r]));
}
function tokens(request){const out={};for(const c of (request.headers.get('Cookie')||'').split(';')){const [key,...rest]=c.trim().split('=');out[key]=rest.join('=');}return out;}
async function bearerHash(request,env){
 if(!pagesRequest(request,env))return null;
 const match=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/);
 return match?'pages:'+request.headers.get('Origin')+':'+await digest(match[1]):null;
}
export async function authenticate(db,request,role='teacher',env={}){
 if(pagesRequest(request,env)){
  const hash=await bearerHash(request,env);
  if(hash){const s=await db.first('SELECT s.* FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch WHERE s.token_hash=? AND s.expires_at>?',hash,Date.now());if(s&&allowedRole(s.role,role))return s;}
  fail(401,'AUTH_REQUIRED','다시 로그인하세요.');
 }
 const jar=tokens(request);
 for(const r of (role==='teacher'?['admin','teacher']:[role])){
  const token=jar[cookieName(r)];if(!/^[a-f0-9]{64}$/.test(token||''))continue;
  const s=await db.first('SELECT s.* FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch WHERE s.token_hash=? AND s.expires_at>?',await digest(token),Date.now());if(s&&allowedRole(s.role,role))return s;
 }fail(401,'AUTH_REQUIRED','다시 로그인하세요.');
}
export async function revoke(db,request,env={}){const hash=await bearerHash(request,env);if(pagesRequest(request,env)){if(hash)await db.batch([db.prepare('DELETE FROM sessions WHERE token_hash=?',hash)]);return;}const jar=tokens(request),statements=[];for(const role of roles)if(jar[cookieName(role)])statements.push(db.prepare('DELETE FROM sessions WHERE token_hash=?',await digest(jar[cookieName(role)])));if(statements.length)await db.batch(statements);}
export async function rateLimit(db,request,scope,limit=10,windowMs=60000){
 const now=Date.now(),bucket=scope+':'+await digest(request.headers.get('CF-Connecting-IP')||'local');
 const [r]=await db.batch([db.prepare('INSERT INTO login_limits(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN login_limits.expires_at<=? THEN 1 ELSE login_limits.attempts+1 END,expires_at=CASE WHEN login_limits.expires_at<=? THEN excluded.expires_at ELSE login_limits.expires_at END RETURNING attempts',bucket,now+windowMs,now,now),db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? LIMIT 50)',now),db.prepare('DELETE FROM login_limits WHERE bucket IN (SELECT bucket FROM login_limits WHERE expires_at<=? LIMIT 50)',now)]);
 if(r.results[0].attempts>limit)fail(429,'RATE_LIMITED','잠시 후 다시 시도하세요.');
}
export async function login(db,env,request,req,headers){
 if(!roles.includes(req.role))fail(400,'INVALID_REQUEST','권한을 확인하세요.');
 await rateLimit(db,request,'login:'+req.role,req.role==='student'?120:10);const cred=(await credentials(db,env))[req.role];
 if(req.credentialEpoch!==cred.epoch||!await passwordMatches(req.password,cred.password_hash,env.PASSWORD_PEPPER,req.role)){
  await revoke(db,request,env);if(!pagesRequest(request,env)){for(const role of roles)headers.append('Set-Cookie',cookie(role));}fail(401,'AUTH_REQUIRED','비밀번호가 다르거나 변경되었습니다.');
 }
 const token=randomToken(),ttl=req.role==='admin'?7200:21600,expiresAt=Date.now()+ttl*1000;
 // Replace the sessions presented by this browser when switching roles.
 const pages=pagesRequest(request,env),jar=pages?{}:tokens(request),stmts=[];
 if(pages){
  const old=await bearerHash(request,env);
  if(old)stmts.push(db.prepare('DELETE FROM sessions WHERE token_hash=?',old));
 }else for(const role of roles){
  const old=jar[cookieName(role)];
  if(!/^[a-f0-9]{64}$/.test(old||''))continue;
  stmts.push(db.prepare('DELETE FROM sessions WHERE token_hash=?',await digest(old)));
 }
 const hash=pages?'pages:'+request.headers.get('Origin')+':'+await digest(token):await digest(token);
 stmts.push(db.prepare('INSERT INTO sessions(token_hash,role,epoch,expires_at) SELECT ?,role,epoch,? FROM credentials WHERE role=? AND epoch=?',hash,expiresAt,req.role,cred.epoch));
 const result=await db.batch(stmts);if(!result.at(-1).meta.changes)fail(409,'CONFLICT','비밀번호가 변경되었습니다. 다시 로그인하세요.');
 if(!pages){
  for(const role of roles)if(role!==req.role&&jar[cookieName(role)])headers.append('Set-Cookie',cookie(role));
  headers.append('Set-Cookie',cookie(req.role,token,ttl));
 }
 return {token:pages?token:'cookie',role:req.role,expiresAt};
}
export async function parameters(db,env,role){if(!roles.includes(role))fail(400,'INVALID_REQUEST','권한을 확인하세요.');return publicParameters((await credentials(db,env))[role]);}
export async function passwordChangeStatements(db,env,req){
 const cred=(await credentials(db,env)).admin;
 if(req.currentEpoch!==cred.epoch||!await passwordMatches(req.currentPassword,cred.password_hash,env.PASSWORD_PEPPER,'admin'))fail(401,'AUTH_REQUIRED','현재 관리자 비밀번호가 다릅니다.');
 if(!roles.includes(req.role)||!Number.isInteger(req.passwordLength)||req.passwordLength<4||req.passwordLength>128)fail(400,'INVALID_REQUEST','새 비밀번호는 4–128자로 입력하세요.');
 const hash=await credentialFromProof(req.passwordProof,req.passwordSalt,req.role,env.PASSWORD_PEPPER);
 return [db.prepare('UPDATE credentials SET password_hash=?,epoch=epoch+1 WHERE role=?',hash,req.role),db.prepare('DELETE FROM sessions WHERE role=?',req.role)];
}
