import {readState,snapshot,savePlan,cancelPlan} from '../vendor/class-swap/src/server/storage.js';
import {fail} from './auth.js';
const allowed=new Set(['load','resume','savePlan','cancelPlan']);
// Only the server derives this domain-separated hash; it is never a browser token.
async function sessionHash(env,session){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.PASSWORD_PEPPER),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('timetable:class-swap:v1|'+session.token_hash+'|'+session.epoch));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function classSwap(env,session,request){
 if(!allowed.has(request.swapAction))fail(403,'FORBIDDEN','이 기능에 접근할 수 없습니다.');
 if(!request.swapPayload||typeof request.swapPayload!=='object'||Array.isArray(request.swapPayload))fail(400,'INVALID_REQUEST','요청을 확인하세요.');
 if(!env.CLASS_SWAP_DB||!/^[a-f0-9]{64}$/.test(env.PASSWORD_PEPPER||''))fail(503,'SETUP_REQUIRED','결보강 연결 설정을 확인하세요.');
 if(!session||session.expires_at<=Date.now())fail(401,'AUTH_REQUIRED','다시 로그인하세요.');
 try{
  const db=env.CLASS_SWAP_DB,tokenHash=await sessionHash(env,session);
  // Timetable administrators also receive only teacher access here.
  const result=await db.batch([
   db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires<=? LIMIT 50)').bind(Date.now()),
   db.prepare("INSERT INTO sessions(token_hash,role,epoch,expires) SELECT ?,role,epoch,? FROM credentials WHERE role='teacher' ON CONFLICT(token_hash) DO UPDATE SET epoch=excluded.epoch,expires=excluded.expires").bind(tokenHash,session.expires_at)
  ]);
  if(!result[1].meta.changes)fail(503,'SETUP_REQUIRED','결보강 교사 계정 설정을 확인하세요.');
  const state=await readState(db),auth={role:'teacher',tokenHash},payload=request.swapPayload;
  if(request.swapAction==='savePlan')return await savePlan(db,state,auth,payload);
  if(request.swapAction==='cancelPlan')return await cancelPlan(db,state,auth,payload);
  return snapshot(state,'teacher',payload);
 }catch(error){if(error.status)throw error;fail(503,'CLASS_SWAP_UNAVAILABLE','결보강 연결을 확인하세요. 작성 내용은 유지됩니다.');}
}
