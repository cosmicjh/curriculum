(function(global){
 'use strict';
 const api=new URL(global.TIMETABLE_CONFIG?.apiBase||'/api/',location.href),cross=api.origin!==location.origin;
 if(cross&&(api.protocol!=='https:'||api.pathname!=='/api/'||api.search||api.hash||api.username||api.password))throw Error('API 주소를 확인하세요.');
 const reads=new Set(['allocation','bootstrap','student','teacherBootstrap','teacher','roster','classBatch','adminBootstrap','adminStudent','adminSections','adminLinks','adminLessons','adminHistory','adminSettings','previewImport','downloadBackup','toolTransfer','courseTransfer']);
 let memorySession=null;
 const loginPreparations=new Map();
 function prepareLogin(role){
  if(!['teacher','admin'].includes(role))return Promise.reject(Error('사용자 유형을 선택하세요.'));
  let entry=loginPreparations.get(role);
  if(!entry||Date.now()-entry.at>30000){
   entry={at:Date.now(),promise:Promise.all([import('./password.js'),request('passwordParameters',{role})])};
   loginPreparations.set(role,entry);
   entry.promise.catch(()=>{if(loginPreparations.get(role)===entry)loginPreparations.delete(role);});
  }
  return entry.promise;
 }
 function hasSession(role){return !cross||Boolean(memorySession&&memorySession.expiresAt>Date.now()&&(role===memorySession.role||role==='teacher'&&memorySession.role==='admin'));}
 async function request(action,args={}){
  if(!/^[A-Za-z][A-Za-z0-9]*$/.test(action))throw Error('API 요청을 확인하세요.');
  const started=performance.now(),payload={...args};delete payload.token;
  async function send(name,data){
   const quickRead=name==='login'||reads.has(name)&&!['previewImport','downloadBackup','classBatch'].includes(name)||name==='passwordParameters'||name==='classSwap'&&['load','resume'].includes(data.swapAction)||name==='courseWorkspace'&&data.method==='GET'||name==='studyroom'&&['dashboard','query','students','settings','history'].includes(data.op);
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),quickRead?15000:110000);
   try{const response=await fetch(new URL(name,api),{method:'POST',credentials:cross?'omit':'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(cross&&memorySession?{Authorization:'Bearer '+memorySession.token}:{})},body:JSON.stringify(data),signal:controller.signal});if(!response.headers.get('Content-Type')?.includes('application/json')){const e=Error('서버 응답을 확인하지 못했습니다 ('+response.status+'). 입력 자료를 보관하고 자료 목록에서 저장 여부를 확인하세요.');e.code='UPSTREAM_ERROR';e.status=response.status;throw e;}const body=await response.text(),result=JSON.parse(body);
    const perf=global.TIMETABLE_PERF||(global.TIMETABLE_PERF=[]);perf.push({action:name,elapsedMs:Math.round(performance.now()-started),bytes:Number(response.headers.get('Content-Length'))||new TextEncoder().encode(body).length,serverTiming:response.headers.get('Server-Timing'),rowsRead:Number(response.headers.get('X-D1-Rows-Read')),rowsWritten:Number(response.headers.get('X-D1-Rows-Written'))});if(perf.length>80)perf.shift();
    if(!result.ok){if(result.code==='AUTH_REQUIRED')memorySession=null;const e=Error(result.error||'요청을 처리하지 못했습니다.');e.code=result.code;e.status=response.status;throw e;}return result.data;
   }catch(e){if(e.name==='AbortError')throw Error(quickRead?'조회 응답이 지연되었습니다. 다시 조회해 주세요.':'응답을 확인하지 못했습니다. 입력값을 보관하고 새로고침하여 저장 결과를 확인하세요.');if(e instanceof TypeError&&/fetch|network|load failed/i.test(e.message)){const error=Error('서버에 연결하지 못했습니다. 입력 자료는 유지됩니다. 재시도 전에 자료 목록에서 저장 여부를 확인하세요.');error.code='NETWORK_ERROR';throw error;}throw e;}finally{clearTimeout(timer);}
  }
  let data;
  if(action==='login'&&payload.role!=='student'){
   const password=payload.password,[{stretchPassword},p]=await prepareLogin(payload.role);loginPreparations.delete(payload.role);
   payload.password=await stretchPassword(password,p);payload.credentialEpoch=p.epoch;
   try{data=await send(action,payload);}catch(error){
    if(error.code!=='AUTH_REQUIRED')throw error;
    const fresh=await send('passwordParameters',{role:payload.role});
    if(fresh.epoch===p.epoch)throw error;
    payload.password=await stretchPassword(password,fresh);payload.credentialEpoch=fresh.epoch;
    data=await send(action,payload);
   }
  }else{
   if(action==='changePassword'){
    const [{stretchPassword,newSalt},p]=await Promise.all([import('./password.js'),send('passwordParameters',{role:'admin'})]);
    const password=payload.newPassword;if(typeof password!=='string'||password.length<4||password.length>128)throw Error('새 비밀번호는 4–128자로 입력하세요.');payload.currentPassword=await stretchPassword(payload.currentPassword,p);payload.currentEpoch=p.epoch;payload.passwordSalt=newSalt();payload.passwordProof=await stretchPassword(password,{salt:payload.passwordSalt});payload.passwordLength=password.length;delete payload.newPassword;
   }
   try{data=await send(action,payload);}catch(e){if(reads.has(action)&&e.code==='READ_CHANGED')data=await send(action,payload);else throw e;}
  }
  if(cross&&action==='login'){
   if(!/^[a-f0-9]{64}$/.test(data.token))throw Error('로그인 응답을 확인하세요.');
   memorySession={token:data.token,role:data.role,expiresAt:data.expiresAt};return {...data,token:'memory'};
  }
  if(action==='logout'||action==='changePassword')loginPreparations.clear();
  if(action==='logout'||action==='changePassword'&&payload.role===memorySession?.role)memorySession=null;
  return data;
 }
 global.TTApi={request,hasSession,prepareLogin};
})(window);
