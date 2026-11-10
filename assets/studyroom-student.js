const form=document.querySelector('form'),status=document.querySelector('#status'),confirm=document.querySelector('#confirmation'),seat=new URL(location.href).searchParams.get('seat');
let busy=false,info=null,submitted=false,pendingRequest=null;
for(const [name,max] of [['grade',3],['classNum',99],['number',99]])for(let i=1;i<=max;i++)form.elements[name].add(new Option(String(i),name==='grade'?String(i):String(i).padStart(2,'0')));
document.querySelector('#seat').textContent=/^(0[1-9]|[1-9][0-9])$/.test(seat)?seat+'번 좌석':'좌석 QR을 다시 확인하세요.';
if(!/^(0[1-9]|[1-9][0-9])$/.test(seat))form.hidden=true;
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='';try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=submitted);}}
const api=(op,args)=>TTApi.request('studyroom',{op,...args});
form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{const studentNumber=form.elements.grade.value+form.elements.classNum.value+form.elements.number.value;info=await api('studentInfo',{studentNumber,seat});document.querySelector('#student-name').textContent=info.studentNumber+' '+info.name;document.querySelector('#session').textContent=info.session.label;form.hidden=true;confirm.hidden=false;document.querySelector('#submit').focus();});});
document.querySelector('#back').onclick=()=>{confirm.hidden=true;form.hidden=false;info=null;form.elements.grade.focus();};
document.querySelector('#submit').onclick=()=>run(async()=>{
 const key='studyroom-request:'+info.session.id+':'+seat+':'+info.studentNumber;let id;try{id=sessionStorage.getItem(key);}catch{}
 if(!id)id=pendingRequest?.key===key?pendingRequest.id:crypto.randomUUID();pendingRequest={key,id};try{sessionStorage.setItem(key,id);}catch{}
 const result=await api('submit',{studentNumber:info.studentNumber,seat,requestId:id,expectedSessionId:info.session.id});document.querySelector('#session').textContent=result.session.label;submitted=true;status.textContent=result.name+' · '+result.seat+'번 출석 제출 완료';document.querySelector('#submit').textContent='제출 완료';try{sessionStorage.removeItem(key);}catch{}
});
