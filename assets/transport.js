(function(global){
 'use strict';
 const api=new URL(global.TIMETABLE_CONFIG?.apiBase||'/api/',location.href),cross=api.origin!==location.origin;
 if(cross&&(api.protocol!=='https:'||api.pathname!=='/api/'||api.search||api.hash||api.username||api.password))throw Error('API 주소를 확인하세요.');
 const reads=new Set(['allocation','bootstrap','student','teacherBootstrap','teacher','roster','classBatch','adminBootstrap','adminStudent','adminSections','adminLinks','adminLessons','adminHistory','adminSettings','previewImport','downloadBackup']);
 let memorySession=null;
 function hasSession(role){return !cross||Boolean(memorySession&&memorySession.expiresAt>Date.now()&&(role===memorySession.role||role==='teacher'&&memorySession.role==='admin'));}
 async function request(action,args={}){
  if(!/^[A-Za-z][A-Za-z0-9]*$/.test(action))throw Error('API 요청을 확인하세요.');
  const started=performance.now(),payload={...args};delete payload.token;
  async function send(name,data){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),110000);
   try{const response=await fetch(new URL(name,api),{method:'POST',credentials:cross?'omit':'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(cross&&memorySession?{Authorization:'Bearer '+memorySession.token}:{})},body:JSON.stringify(data),signal:controller.signal});if(!response.headers.get('Content-Type')?.includes('application/json')){const e=Error('서버 응답을 확인하지 못했습니다 ('+response.status+'). 입력 자료를 보관하고 자료 목록에서 저장 여부를 확인하세요.');e.code='UPSTREAM_ERROR';e.status=response.status;throw e;}const body=await response.text(),result=JSON.parse(body);
    const perf=global.TIMETABLE_PERF||(global.TIMETABLE_PERF=[]);perf.push({action:name,elapsedMs:Math.round(performance.now()-started),bytes:Number(response.headers.get('Content-Length'))||new TextEncoder().encode(body).length,serverTiming:response.headers.get('Server-Timing'),rowsRead:Number(response.headers.get('X-D1-Rows-Read')),rowsWritten:Number(response.headers.get('X-D1-Rows-Written'))});if(perf.length>80)perf.shift();
    if(!result.ok){if(result.code==='AUTH_REQUIRED')memorySession=null;const e=Error(result.error||'요청을 처리하지 못했습니다.');e.code=result.code;e.status=response.status;throw e;}return result.data;
   }catch(e){if(e.name==='AbortError')throw Error('응답을 확인하지 못했습니다. 입력값을 보관하고 새로고침하여 저장 결과를 확인하세요.');if(e instanceof TypeError&&/fetch|network|load failed/i.test(e.message)){const error=Error('서버에 연결하지 못했습니다. 입력 자료는 유지됩니다. 재시도 전에 자료 목록에서 저장 여부를 확인하세요.');error.code='NETWORK_ERROR';throw error;}throw e;}finally{clearTimeout(timer);}
  }
  if(action==='login'||action==='changePassword'){
   const [{stretchPassword,newSalt},p]=await Promise.all([import('./password.js'),send('passwordParameters',{role:action==='login'?payload.role:'admin'})]);
   if(action==='login'){payload.password=await stretchPassword(payload.password,p);payload.credentialEpoch=p.epoch;}
   else {const password=payload.newPassword;if(typeof password!=='string'||password.length<4||password.length>128)throw Error('새 비밀번호는 4–128자로 입력하세요.');payload.currentPassword=await stretchPassword(payload.currentPassword,p);payload.currentEpoch=p.epoch;payload.passwordSalt=newSalt();payload.passwordProof=await stretchPassword(password,{salt:payload.passwordSalt});payload.passwordLength=password.length;delete payload.newPassword;}
  }
  let data;try{data=await send(action,payload);}catch(e){if(reads.has(action)&&e.code==='READ_CHANGED')data=await send(action,payload);else throw e;}
  if(cross&&action==='login'){
   if(!/^[a-f0-9]{64}$/.test(data.token))throw Error('로그인 응답을 확인하세요.');
   memorySession={token:data.token,role:data.role,expiresAt:data.expiresAt};return {...data,token:'memory'};
  }
  if(action==='logout'||action==='changePassword'&&payload.role===memorySession?.role)memorySession=null;
  return data;
 }
 global.TTApi={request,hasSession};
})(window);
