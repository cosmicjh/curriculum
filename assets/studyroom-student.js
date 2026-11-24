const form=document.querySelector('form'),status=document.querySelector('#status'),confirm=document.querySelector('#confirmation'),seat=new URL(location.href).searchParams.get('seat');
let busy=false,info=null,submitted=false,pendingRequest=null;
for(const [name,max] of [['grade',3],['classNum',99],['number',99]])for(let i=1;i<=max;i++)form.elements[name].add(new Option(String(i),name==='grade'?String(i):String(i).padStart(2,'0')));
document.querySelector('#seat').textContent=/^(0[1-9]|[1-9][0-9])$/.test(seat)?seat+'번 좌석':'좌석 QR을 다시 확인하세요.';
if(!/^(0[1-9]|[1-9][0-9])$/.test(seat))form.hidden=true;
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='';try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=submitted);}}
function retryAfterMs(value){
 if(!value)return 0;
 if(/^\d+$/.test(value))return Number(value)*1000;
 return Math.max(0,Date.parse(value)-Date.now())||0;
}
async function api(op,args){
 const submit=op==='submit',maxRetries=4,timeoutMs=20000,retryDeadline=performance.now()+60000;
 status.textContent=submit?'제출 중…':'이름 확인 중…';
 for(let attempt=0;;attempt++){
  const remaining=retryDeadline-performance.now();
  if(remaining<=0)break;
  try{return await TTApi.request('studyroom',{op,...args},{timeoutMs:Math.min(timeoutMs,remaining)});}
  catch(e){
   if(!(e.code==='NETWORK_ERROR'||e.code==='TIMEOUT'||e.status===429||e.status===503&&e.code==='SR_RETRY'||e.status>=500&&e.code==='UPSTREAM_ERROR'))throw e;
   if(attempt===maxRetries)break;
   const retryAfter=e.status===429?retryAfterMs(e.retryAfter):0;
   const delay=Math.max(500*2**attempt*(1+Math.random()),retryAfter?retryAfter+1000*Math.random():0);
   if(delay>=retryDeadline-performance.now())break;
   status.textContent=(submit?'다시 제출하는 중…':'다시 확인하는 중…')+'('+(attempt+1)+'/'+maxRetries+')';
   await new Promise(resolve=>setTimeout(resolve,delay));
  }
 }
 throw Error(submit?'제출이 확인되지 않았습니다. 출석 제출을 다시 누르세요.':'이름이 확인되지 않았습니다. 이름 확인을 다시 누르세요.');
}
form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{const studentNumber=form.elements.grade.value+form.elements.classNum.value+form.elements.number.value;info=await api('studentInfo',{studentNumber,seat});status.textContent='';document.querySelector('#student-name').textContent=info.studentNumber+' '+info.name;document.querySelector('#session').textContent=info.session.label;form.hidden=true;confirm.hidden=false;document.querySelector('#submit').focus();});});
function showNameForm(){confirm.hidden=true;form.hidden=false;info=null;form.elements.grade.focus();}
document.querySelector('#back').onclick=showNameForm;
function clearPendingRequest(key,legacyKey,id){
 pendingRequest=null;
 try{for(const storedKey of [key,legacyKey])if(sessionStorage.getItem(storedKey)===id)sessionStorage.removeItem(storedKey);}catch{}
}
document.querySelector('#submit').onclick=()=>run(async()=>{
 const legacyKey='studyroom-request:'+info.session.id+':'+seat+':'+info.studentNumber,key=legacyKey+':'+info.studentKey;
 let id,legacyId;
 try{id=sessionStorage.getItem(key);if(!id)legacyId=sessionStorage.getItem(legacyKey);}catch{}
 if(!id)id=legacyId||(pendingRequest?.key===key?pendingRequest.id:crypto.randomUUID());
 pendingRequest={key,id};
 if(!legacyId)try{sessionStorage.setItem(key,id);}catch{}
 let result;
 try{result=await api('submit',{studentNumber:info.studentNumber,studentKey:info.studentKey,seat,requestId:id,expectedSessionId:info.session.id});}
 catch(e){
  if(e.status===409&&e.code==='STUDENT_CHANGED'){clearPendingRequest(key,legacyKey,id);showNameForm();}
  throw e;
 }
 clearPendingRequest(key,legacyKey,id);
 document.querySelector('#session').textContent=result.session.label;submitted=true;status.textContent=result.name+' · '+result.seat+'번 출석 제출 완료';document.querySelector('#submit').textContent='제출 완료';
});
