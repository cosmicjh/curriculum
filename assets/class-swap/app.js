import {C} from '../../vendor/class-swap/src/shared/core.js';

export function mountClassSwap(root,initial,{request,selectedTeacher,print,notify,admin=false,cachePrefix}){
const $=id=>root.getElementById(id);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const uid=()=>{const a=new Uint32Array(4);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(8,'0')).join('');};
let busy=false;
const S={term:'',dataset:null,plans:[],reservedSlots:[],dataRev:'0',planRev:'0',view:admin?'history':'write',receipt:null,dirty:false,draft:null,sel:null,editIndex:-1,candidates:[]},termDrafts=new Map();
function resetDraft(){S.receipt=null;S.draft={id:'p_'+uid(),version:0,teacherA:'',reason:'',submitDate:today(),submitter:'',items:[]};S.dirty=false;resetSelection(false);}
function resetSelection(preserveDates=true){const d=preserveDates&&S.sel?S.sel.dateA:today(),week=preserveDates&&S.sel?S.sel.weekB:C.monday(d);S.sel={mode:S.sel?S.sel.mode:'swap',dateA:d,periodA:0,weekB:week,teacherB:'',dateB:'',periodB:0,roomA:''};S.editIndex=-1;}
function showError(error){notify(error.message||String(error));}
function setBusy(value){busy=value;root.querySelectorAll('fieldset[data-lock]').forEach(e=>{e.disabled=value;});$('appView').setAttribute('aria-busy',String(value));}
async function work(fn){if(busy)return;setBusy(true);try{return await fn();}catch(e){showError(e);}finally{setBusy(false);}}
const api=(action,payload={})=>request(action,{term:S.term,...payload});
function mergeSnapshot(v){if(v.dataset)S.dataset=v.dataset;else if(v.hasDataset===false)S.dataset=null;if(v.plans)S.plans=v.plans;if(v.reservedSlots)S.reservedSlots=v.reservedSlots;S.term=v.term||S.term;S.dataRev=v.dataRev;S.planRev=v.planRev;}
function showSnapshot(v){
 const switched=!!S.term&&v.term!==S.term;
 if(switched)termDrafts.set(S.term,{draft:S.draft,sel:S.sel,dirty:S.dirty,editIndex:S.editIndex,view:S.view,receipt:S.receipt});
 mergeSnapshot(v);
 if(switched){const previous=termDrafts.get(S.term);if(previous){Object.assign(S,previous);termDrafts.delete(S.term);}else{resetDraft();S.view=admin?'history':'write';}}
 if(!S.dirty&&!S.draft.teacherA){const teacher=S.dataset?.teachers.find(t=>t.name===selectedTeacher());if(teacher){S.draft.teacherA=teacher.id;S.draft.submitter=teacher.name;}}renderAll();
}
function markDirty(){S.dirty=true;$('dirtyLabel').hidden=false;}
function teacherPicker(id,getChoices,select,{restore,enterByName=false}={}){
 const input=$(id),list=$(id+'Options');
 let choices=[],active=-1,filter=false;
 function close(){
  list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
 }
 function highlight(index){
  list.children[active]?.setAttribute('aria-selected','false');
  active=index;
  const option=list.children[active];
  option.setAttribute('aria-selected','true');
  input.setAttribute('aria-activedescendant',option.id);
  const top=option.offsetTop,bottom=top+option.offsetHeight;
  if(top<list.scrollTop)list.scrollTop=top;
  else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=bottom-list.clientHeight;
 }
 function open(){
  const query=filter?input.value.trim():'';
  choices=getChoices().filter(choice=>choice.name.includes(query));
  if(!query&&restore?.())choices.push({name:'선택 해제',clear:true});
  active=-1;close();
  if(!choices.length)return;
  list.innerHTML=choices.map(({name,detail},index)=>'<div role="option" aria-selected="false" id="'+id+'Choice'+index+'" data-choice="'+index+'">'+esc(name)+(detail?' <small>'+esc(detail)+'</small>':'')+'</div>').join('');
  list.hidden=false;input.setAttribute('aria-expanded','true');
 }
 function choose(index){
  const choice=choices[index];
  if(!choice||busy)return;
  input.value=choice.clear?'':choice.name;filter=false;close();select(choice.clear?null:choice);
 }
 input.addEventListener('focus',()=>{filter=!restore;open();});
 input.addEventListener('click',()=>{if(list.hidden)open();});
 input.addEventListener('input',()=>{filter=true;if(!restore)select({name:input.value});open();});
 input.addEventListener('blur',()=>{close();if(restore)input.value=restore();});
 input.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229)return;
  if(event.key==='Escape'&&!list.hidden){event.preventDefault();close();if(restore)input.value=restore();filter=!restore;return;}
  if(event.key==='Enter'){
   if(!list.hidden&&active>=0){event.preventDefault();choose(active);return;}
   const query=input.value.trim();
   if(!enterByName||!query||!filter)return;
   event.preventDefault();
   const exact=choices.filter(choice=>choice.name===query);
   const matches=exact.length?exact:choices;
   if(matches.length===1)choose(choices.indexOf(matches[0]));
   else notify(matches.length?'일치하는 교사가 여러 명입니다. 목록에서 선택해 주세요.':'일치하는 교사가 없습니다.');
   return;
  }
  if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
  if(list.hidden)open();
  if(list.hidden)return;
  event.preventDefault();
  highlight(event.key==='ArrowDown'?Math.min(active+1,choices.length-1):active<0?choices.length-1:Math.max(active-1,0));
 });
 list.addEventListener('mousedown',event=>event.preventDefault());
 list.addEventListener('click',event=>{const option=event.target.closest('[data-choice]');if(option)choose(Number(option.dataset.choice));});
 return (value,disabled=false)=>{input.value=value;input.disabled=disabled;filter=false;close();};
}
function currentItems(){return S.draft.items.filter((_,i)=>i!==S.editIndex);}
function usedSlots(){return C.reservations(S.reservedSlots,S.draft.id,{teacherA:S.draft.teacherA,items:currentItems()});}
function prettyDate(d,year=false){if(!d)return '';return(year?d.replaceAll('-','.') : Number(d.slice(5,7))+'/'+Number(d.slice(8,10)))+'('+['월','화','수','목','금','토','일'][C.dayOf(d)]+')';}
function timeText(d,p){return prettyDate(d)+' '+p+'교시';}
function kindLabel(k){return{elective:'선택',review:'확인',duty:'배정',activity:'창체',block:'연속',blocked:'제한'}[k]||'';}
function timetableHtml(id,week,side){
 if(!S.dataset||!id)return'<div class="empty-state" aria-label="시간표"></div>';
 const ds=S.dataset,map=C.lessonMap(ds),used=usedSlots(),max=Math.max(...ds.slots.map(s=>s.period));
 let h='<table class="tt"><thead><tr><th>교시</th>'+C.DAYS.map((d,i)=>'<th>'+d+'<small>'+prettyDate(C.addDays(week,i)).split('(')[0]+'</small></th>').join('')+'</tr></thead><tbody>';
 for(let p=1;p<=max;p++){h+='<tr><td>'+p+'</td>';for(let d=0;d<5;d++){
  if(!C.hasSlot(ds,d,p)){h+='<td><span class="cell off">미운영</span></td>';continue;}
  const value=C.addDays(week,d),l=C.baseLesson(ds,id,value,p,map),k=C.kind(ds,l),isUsed=used.has(C.actualKey(id,value,p));
  let selected=false,choice=false,click=false,cls='cell';
  if(k==='free')cls+=' empty';else if(k!=='regular')cls+=' protected';
  if(isUsed)cls+=' reserved';
  if(side==='A'){selected=S.sel.dateA===value&&S.sel.periodA===p;click=!isUsed&&k!=='free'&&(S.sel.mode==='cover'||k==='regular');}
  if(side==='B'){const c=S.candidates.find(c=>c.teacherId===id);choice=!!c&&c.choices.some(x=>x.date===value&&x.period===p);click=choice;selected=S.sel.dateB===value&&S.sel.periodB===p;}
  if(choice)cls+=' choice';if(selected)cls+=' selected';
  const hint=isUsed?'등록됨':k==='free'?'미배정':kindLabel(k);
  const title=timeText(value,p)+' · '+(l.subject||'미배정')+(l.room?' · '+l.room:'')+(hint?' · '+hint:'');
  const content='<b>'+esc(side==='B'&&choice&&k==='free'?'보강 가능':l.subject)+'</b><small>'+esc(isUsed?'등록됨':l.room||(k!=='free'&&hint!==l.subject?hint:''))+'</small>';
  h+='<td>'+(click?'<button type="button" class="'+cls+'" title="'+esc(title)+'" aria-label="'+esc(title)+'" data-action="cell'+side+'" data-day="'+d+'" data-period="'+p+'">'+content+'</button>':'<div class="'+cls+'" title="'+esc(title)+'">'+content+'</div>')+'</td>';
 }h+='</tr>';}return h+'</tbody></table>';
}
function recomputeCandidates(){
 S.candidates=[];if(S.dataset&&S.draft.teacherA&&S.sel.periodA){S.candidates=C.findCandidates(S.dataset,S.reservedSlots,{teacherA:S.draft.teacherA,dateA:S.sel.dateA,periodA:S.sel.periodA,mode:S.sel.mode,weekB:S.sel.weekB,exceptId:S.draft.id,items:currentItems()});}
 if(!S.candidates.some(c=>c.teacherId===S.sel.teacherB)){S.sel.teacherB='';S.sel.dateB='';S.sel.periodB=0;}
}
function renderSelection(){
 recomputeCandidates();$('dateA').value=S.sel.dateA;$('weekB').value=S.sel.weekB;$('weekBField').hidden=S.sel.mode==='cover';$('sourceTeacherLabel').textContent=S.dataset?(C.teacher(S.dataset,S.draft.teacherA)?.name||'교사 미선택'):'교사 미선택';$('selectedDateSummary').textContent=prettyDate(S.sel.dateA);
 root.querySelectorAll('[data-action=mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===S.sel.mode));
 $('candidateCount').textContent=S.candidates.length+'명';$('candidateTitle').textContent=S.sel.teacherB?(S.sel.mode==='swap'?'교체할 수업을 선택하세요':'선택한 보강 교사'):S.sel.periodA?(S.candidates.length?'시간표상 가능한 교사':'조건에 맞는 교사가 없습니다'):'교체 대상';
 syncTeacherB(candidateName(),!S.candidates.length);
 $('tableA').innerHTML=timetableHtml(S.draft.teacherA,C.monday(S.sel.dateA),'A');$('tableB').innerHTML=timetableHtml(S.sel.teacherB,S.sel.mode==='cover'?C.monday(S.sel.dateA):S.sel.weekB,'B');
 const la=S.dataset&&S.sel.periodA?C.baseLesson(S.dataset,S.draft.teacherA,S.sel.dateA,S.sel.periodA):null;
 let summary='';
 if(la){summary='<strong>'+esc(timeText(S.sel.dateA,S.sel.periodA))+' · '+esc(la.subject)+' '+esc(la.room)+'</strong>';
  const b=C.teacher(S.dataset,S.sel.teacherB);if(b&&S.sel.periodB){const lb=C.baseLesson(S.dataset,b.id,S.sel.dateB,S.sel.periodB);summary+='<p>'+esc(b.name)+(S.sel.mode==='swap'?' · '+esc(timeText(S.sel.dateB,S.sel.periodB))+' · '+esc(lb.subject):' · 같은 시간 보강')+'</p>';}}
 $('selectionText').innerHTML=summary;$('roomOverride').hidden=!la||!!la.room;$('roomOverride').value=S.sel.roomA||'';$('addBtn').disabled=!(la&&S.sel.teacherB&&S.sel.periodB);$('addBtn').textContent=S.editIndex>=0?'수정 적용':'계획에 추가';$('clearSelectionBtn').hidden=!S.sel.periodA;
}
function renderItems(){
 const items=S.draft.items;$('itemCount').textContent=items.length+'건';
 if(!items.length){$('items').innerHTML='<div class="pending-empty"></div>';return;}
 $('items').innerHTML='<table class="list-table"><thead><tr><th>유형</th><th>결강 수업</th><th>학급·대상</th><th>담당 교사 / 교체 수업</th><th></th></tr></thead><tbody>'+items.map((i,n)=>'<tr data-item="'+n+'"><td><div class="item-type"><button type="button" class="drag-handle" data-drag="'+n+'" aria-label="'+(n+1)+'번째 수업 순서 변경" aria-describedby="reorder-help"'+(items.length<2?' disabled':'')+'><span aria-hidden="true"></span></button><span class="type">'+(i.mode==='swap'?'교체':'보강')+'</span></div></td><td>'+esc(timeText(i.dateA,i.periodA))+'<br><small>'+esc(i.subjectA)+'</small></td><td>'+esc(i.roomA)+'</td><td>'+esc(i.teacherBName)+(i.mode==='swap'?'<br><small>'+esc(timeText(i.dateB,i.periodB))+' · '+esc(i.subjectB)+'</small>':'')+'</td><td class="right"><button class="text-btn" data-action="editItem" data-index="'+n+'">수정</button><button class="text-btn" data-action="removeItem" data-index="'+n+'">삭제</button></td></tr>').join('')+'</tbody></table>';
}
function moveItem(from,to){
 const items=S.draft.items;
 if(to===from||to<0||to>=items.length)return;
 const editing=items[S.editIndex];
 items.splice(to,0,items.splice(from,1)[0]);
 S.editIndex=items.indexOf(editing);
 markDirty();renderItems();
 $('reorder-status').textContent=(from+1)+'번째 수업을 '+(to+1)+'번째로 이동했습니다.';
 $('items').querySelector('[data-drag="'+to+'"]').focus({preventScroll:true});
}
function renderWrite(){
 $('documentTitle').innerHTML=(localDrafts().some(p=>p.id===S.draft.id)?'저장한 초안':'새 계획서')+'<span id="dirtyLabel" class="dirty"'+(!S.dirty?' hidden':'')+'>저장 전</span>';
 $('noDataset').hidden=!!S.dataset;
 $('receipt').hidden=!S.receipt;
 syncTeacherA(sourceName(),!S.dataset);$('reason').value=S.draft.reason;$('submitDate').value=S.draft.submitDate;$('submitter').value=S.draft.submitter;
 renderSelection();renderItems();
}
function localDrafts(){
 if(admin)return [];
 try{return JSON.parse(sessionStorage.getItem(cachePrefix+S.term)||'[]');}catch{return [];}
}
function updateDrafts(drafts){sessionStorage.setItem(cachePrefix+S.term,JSON.stringify(drafts));}
function renderHistory(){
 const q=$('historySearch').value.trim(),status=$('historyStatus').value;
 const from=$('historyFrom').value,to=$('historyTo').value;
 const invalidRange=admin&&from&&to&&from>to;
 const plans=(admin?S.plans:localDrafts()).filter(p=>{
  if(!admin)return !q||((p.teacherAName||'')+' '+p.reason).includes(q);
  return !invalidRange&&(status==='all'||p.status===status)&&(!q||(p.teacherAName||'').includes(q))&&
   ((!from&&!to)||p.items.some(({dateA})=>dateA&&(!from||dateA>=from)&&(!to||dateA<=to)));
 });
 if(admin)plans.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
 $('historyList').innerHTML=plans.length?'<table class="list-table"><thead><tr><th>결강 교사</th><th>결강일</th><th>사유</th><th>수업</th><th>상태</th><th></th></tr></thead><tbody>'+plans.map(p=>
  '<tr><td><b>'+esc(p.teacherAName||'미지정')+'</b></td><td>'+esc([...new Set(p.items.map(i=>i.dateA))].sort().map(d=>prettyDate(d)).join(', '))+'</td><td>'+esc(p.reason)+'</td><td>'+p.items.length+'건</td><td><span class="type">'+(admin?(p.status==='active'?'제출됨':'취소됨'):'임시저장')+'</span></td><td class="right">'+
  '<button class="text-btn" data-action="openPlan" data-id="'+esc(p.id)+'">열기</button>'+(admin?
   '<button class="text-btn" data-action="printPlan" data-id="'+esc(p.id)+'">인쇄</button><button class="text-btn" data-action="noticePlan" data-id="'+esc(p.id)+'">학급 공지</button>'+(p.status==='active'?'<button class="text-btn" data-action="cancelPlan" data-id="'+esc(p.id)+'">취소</button>':''):
   '<button class="text-btn" data-action="deleteDraft" data-id="'+esc(p.id)+'">삭제</button>')+'</td></tr>').join('')+'</tbody></table>':'<div class="empty-state"><p>해당하는 계획서가 없습니다.</p></div>';
}
function renderAll(){
 $('historyCount').textContent=localDrafts().length||'';
 ['write','history'].forEach(v=>{$(v+'View').hidden=S.view!==v;});root.querySelectorAll('[data-action=nav]').forEach(b=>b.classList.toggle('active',b.dataset.view===S.view));
 if(S.view==='write')renderWrite();else renderHistory();
}
function draftForSave(){return Object.assign({},S.draft,{reason:$('reason').value.trim(),submitter:$('submitter').value.trim(),submitDate:$('submitDate').value});}
function addItem(){
 if(!S.dataset||!S.sel.teacherB||!S.sel.periodA||!S.sel.periodB)throw new Error('결강 수업과 대상 교사를 선택해 주세요.');
 const i={mode:S.sel.mode,dateA:S.sel.dateA,periodA:S.sel.periodA,teacherB:S.sel.teacherB,dateB:S.sel.dateB,periodB:S.sel.periodB,roomA:$('roomOverride').value.trim()};
 const raw=draftForSave(),items=raw.items.slice();if(S.editIndex>=0)items[S.editIndex]=i;else items.push(i);
 const v=C.validatePlan(S.dataset,S.reservedSlots,Object.assign({},raw,{items}));S.draft=Object.assign({},raw,v);markDirty();resetSelection();renderWrite();
}
function saveDraft(){
 if(S.editIndex>=0)throw Error('수정 중인 수업을 먼저 적용하거나 선택 취소해 주세요.');
 const draft={...draftForSave(),teacherAName:S.dataset?C.teacher(S.dataset,S.draft.teacherA)?.name||'':''};
 updateDrafts([draft,...localDrafts().filter(p=>p.id!==draft.id)]);S.draft=draft;S.dirty=false;renderWrite();notify('이 탭에 임시저장했습니다.');
}
function submitDraft(){return work(async()=>{
 if(S.editIndex>=0)throw Error('수정 중인 수업을 먼저 적용하거나 선택 취소해 주세요.');
 if(!S.dataset)throw Error('등록된 시간표가 없습니다.');
 const raw=draftForSave(),clean=C.validatePlan(S.dataset,[],raw);
 if(!confirm('계획서를 제출할까요? 제출 후 계획서와 학급 공지를 인쇄할 수 있습니다.'))return;
 const result=await api('submitPlan',{plan:raw,dataRev:S.dataRev});
 if(!result.submitted)throw Error('제출을 확인하지 못했습니다. 다시 시도하세요.');
 const drafts=localDrafts(),remaining=drafts.filter(p=>p.id!==raw.id);
 if(remaining.length!==drafts.length)updateDrafts(remaining);
 S.planRev='0';S.reservedSlots.push({status:'active',teacherA:clean.teacherA,items:clean.items});
 resetDraft();S.receipt=clean;renderWrite();notify('계획서를 제출했습니다.');
});}
function upsert(plan,rev){const i=S.plans.findIndex(p=>p.id===plan.id);if(i>=0)S.plans[i]=plan;else S.plans.push(plan);S.planRev=rev;}
function switchView(view){S.view=view;renderAll();}
async function refresh(){showSnapshot(await api('load',{dataRev:S.dataRev,planRev:S.planRev}));notify('최신 자료를 불러왔습니다. 작성 중인 내용은 학기별로 유지됩니다.');}
function openPlan(id){
 const p=(admin?S.plans:localDrafts()).find(p=>p.id===id);if(!p)return;
 if(admin){
  const detail=$('planDetail');
  $('detailTitle').textContent=p.teacherAName+' 결보강 계획서';
  $('detailContent').innerHTML='<p>'+esc(p.submitDate)+' · 제출자 '+esc(p.submitter)+'</p><p>'+esc(p.reason)+'</p><ul>'+p.items.map(i=>
   '<li>'+esc(timeText(i.dateA,i.periodA)+' · '+i.subjectA+' · '+i.roomA+' · '+i.teacherBName+(i.mode==='swap'?' · '+timeText(i.dateB,i.periodB)+' '+i.subjectB:' · 보강'))+'</li>').join('')+'</ul>';
  detail.showModal();return;
 }
 if(S.dirty&&!confirm('작성 중인 내용을 닫고 임시저장한 초안을 열겠습니까?'))return;
 S.draft=C.clone(p);S.receipt=null;S.dirty=false;resetSelection();switchView('write');
}
function editItem(index){const i=S.draft.items[index];if(!i)return;S.editIndex=index;S.sel={mode:i.mode,dateA:i.dateA,periodA:i.periodA,weekB:C.monday(i.dateB),teacherB:i.teacherB,dateB:i.dateB,periodB:i.periodB,roomA:i.roomA};renderSelection();$('tableA').scrollIntoView({behavior:'smooth',block:'center'});}
function printPlan(plan,notice){
 const items=plan.items;if(!items.length)throw new Error('출력할 수업이 없습니다.');let html='';
 if(notice){html=items.map(i=>{const line=(d,p,sa,ta,sb,tb)=>'<div class="notice-time">'+esc(timeText(d,p))+'</div><div class="notice-change"><div><b>'+esc(sa)+'</b><small>'+esc(ta)+'</small></div><span>→</span><div><b>'+esc(sb)+'</b><small>'+esc(tb)+'</small></div></div>';
 const entries=[{date:i.dateA,p:i.periodA,html:line(i.dateA,i.periodA,i.subjectA,plan.teacherAName,i.mode==='swap'?i.subjectB:i.subjectA,i.teacherBName)}];if(i.mode==='swap')entries.push({date:i.dateB,p:i.periodB,html:line(i.dateB,i.periodB,i.subjectB,i.teacherBName,i.subjectA,plan.teacherAName)});entries.sort((a,b)=>a.date.localeCompare(b.date)||a.p-b.p);
 return'<section class="print-page notice-page"><div class="notice-card"><h2>'+esc(i.roomA)+' 수업 '+(i.mode==='swap'?'교체':'보강')+' 공지</h2>'+entries.map(e=>e.html).join('')+'</div></section>';}).join('');}
 else{for(let start=0;start<items.length;start+=8){const part=items.slice(start,start+8),dates=Array.from(new Set(items.map(i=>i.dateA))).sort();html+='<section class="print-page"><h2 class="print-title">수업 교체 및 결·보강 계획서</h2><table class="approval"><tr><td rowspan="2" style="min-width:27px">결<br>재</td><td>계</td><td>부 장</td></tr><tr class="sign"><td></td><td></td></tr></table><div class="print-info">1. 결강 교사: '+esc(plan.teacherAName)+'<br>2. 결강 사유: '+esc(plan.reason)+'<br>3. 결강 일자: '+dates.map(d=>esc(prettyDate(d,true))).join(', ')+'</div><table class="print-table"><thead><tr><th colspan="3"></th><th colspan="2">수업 보강 시</th><th colspan="4">수업 교체 시</th></tr><tr><th>월/일<br>요일</th><th>학년-반<br>교시</th><th>결강과목<br>결강교사</th><th>보강교사</th><th>서명(인)</th><th>월/일<br>요일</th><th>학년-반<br>교시</th><th>교체과목<br>교체교사</th><th>서명(인)</th></tr></thead><tbody>'+part.map(i=>{const a=i.dateA,b=i.dateB;return'<tr class="pair-top"><td>'+esc(Number(a.slice(5,7))+'/'+Number(a.slice(8,10)))+'</td><td>'+esc(i.roomA)+'</td><td>'+esc(i.subjectA)+'</td><td rowspan="2">'+esc(i.mode==='cover'?i.teacherBName:'')+'</td><td rowspan="2"></td><td>'+esc(i.mode==='swap'?Number(b.slice(5,7))+'/'+Number(b.slice(8,10)):'')+'</td><td>'+esc(i.mode==='swap'?i.roomB:'')+'</td><td>'+esc(i.mode==='swap'?i.subjectB:'')+'</td><td rowspan="2"></td></tr><tr class="pair-bottom"><td>'+C.DAYS[C.dayOf(a)]+'</td><td>'+i.periodA+'</td><td>'+esc(plan.teacherAName)+'</td><td>'+esc(i.mode==='swap'?C.DAYS[C.dayOf(b)]:'')+'</td><td>'+(i.mode==='swap'?i.periodB:'')+'</td><td>'+esc(i.mode==='swap'?i.teacherBName:'')+'</td></tr>';}).join('')+'</tbody></table><div class="print-submit">'+esc(plan.submitDate.replaceAll('-','.'))+'<br>제출자: '+esc(plan.submitter||plan.teacherAName)+' (인)</div><div class="print-school">'+esc(S.dataset&&S.dataset.meta.school||'')+'장 귀하</div>'+(items.length>8?'<p style="text-align:right;font-size:9pt;margin-top:10px">'+(Math.floor(start/8)+1)+' / '+Math.ceil(items.length/8)+'</p>':'')+'</section>';}}
 print(html,root.querySelector('style').textContent,'@page{size:A4 '+(notice?'landscape':'portrait')+';margin:12mm}');
}

root.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(!b||b.disabled||busy)return;const a=b.dataset.action;try{
 if(a==='nav')switchView(b.dataset.view);
 else if(a==='mode'){S.sel.mode=b.dataset.mode;S.sel.periodA=0;S.sel.teacherB='';S.sel.periodB=0;S.editIndex=-1;renderSelection();}
 else if(a==='cellA'){S.sel.dateA=C.addDays(C.monday(S.sel.dateA),Number(b.dataset.day));S.sel.periodA=Number(b.dataset.period);S.sel.teacherB='';S.sel.periodB=0;S.sel.roomA='';renderSelection();}
 else if(a==='cellB'){S.sel.dateB=C.addDays(S.sel.mode==='cover'?C.monday(S.sel.dateA):S.sel.weekB,Number(b.dataset.day));S.sel.periodB=Number(b.dataset.period);renderSelection();}
 else if(a==='add')addItem();
 else if(a==='clearSelection'){resetSelection();renderSelection();}
 else if(a==='save')saveDraft();
 else if(a==='submit')submitDraft();
 else if(a==='refresh')work(refresh);
 else if(a==='new'){if(!S.dirty||confirm('작성 중인 내용을 닫고 새 계획서를 작성하겠습니까?')){resetDraft();renderWrite();}}
 else if(a==='removeItem'){S.draft.items.splice(Number(b.dataset.index),1);markDirty();resetSelection();renderWrite();}
 else if(a==='editItem')editItem(Number(b.dataset.index));
 else if(a==='openPlan')openPlan(b.dataset.id);
 else if(a==='deleteDraft'){if(confirm('이 탭의 임시저장본을 삭제할까요?')){updateDrafts(localDrafts().filter(p=>p.id!==b.dataset.id));renderAll();}}
 else if(a==='cancelPlan'){const p=S.plans.find(p=>p.id===b.dataset.id);if(p&&confirm('이 계획서를 취소하겠습니까? 예약된 시간은 해제되며 취소 이력은 남습니다.'))work(async()=>{const r=await api('cancelPlan',{id:p.id,version:p.version});upsert(r.plan,r.planRev);if(S.draft.id===p.id)resetDraft();renderAll();notify('계획서를 취소했습니다.');});}
 else if((a==='printReceipt'||a==='noticeReceipt')&&S.receipt)printPlan(S.receipt,a==='noticeReceipt');
 else if(a==='printPlan'||a==='noticePlan'){const p=S.plans.find(p=>p.id===b.dataset.id);if(p)printPlan(p,a==='noticePlan');}
 }catch(e){showError(e);}
});
const byName=(a,b)=>a.name.localeCompare(b.name,'ko');
const sourceName=()=>S.dataset?C.teacher(S.dataset,S.draft.teacherA)?.name||'':'';
const candidateName=()=>S.candidates.find(c=>c.teacherId===S.sel.teacherB)?.name||'';
const syncTeacherA=teacherPicker('teacherA',()=>[...(S.dataset?.teachers||[])].sort(byName),teacher=>{
 const id=teacher?.id||'';
 if(id===S.draft.teacherA)return;
 if(S.draft.items.length&&!confirm('결강 교사를 바꾸면 현재 계획 내역을 비웁니다. 변경하겠습니까?')){syncTeacherA(sourceName());return;}
 S.draft.teacherA=id;S.draft.items=[];S.draft.submitter=teacher?.name||'';markDirty();resetSelection();renderWrite();
},{restore:sourceName,enterByName:true});
const syncTeacherB=teacherPicker('teacherB',()=>S.candidates.map(c=>({...c,detail:S.sel.mode==='swap'?c.choices.length+'개 수업':'당일 '+c.load+'시간'})),teacher=>{
 const id=teacher?.teacherId||'';
 if(id===S.sel.teacherB)return;
 S.sel.teacherB=id;S.sel.dateB='';S.sel.periodB=0;
 if(S.sel.mode==='cover'&&id){S.sel.dateB=S.sel.dateA;S.sel.periodB=S.sel.periodA;}
 renderSelection();
},{restore:candidateName});
teacherPicker('historySearch',()=>{
 const plans=admin?S.plans:localDrafts();
 return [...new Set([...(S.dataset?.teachers||[]).map(t=>t.name),...plans.map(p=>p.teacherAName)].filter(Boolean))].map(name=>({name})).sort(byName);
},renderHistory);
const itemsElement=$('items');
let drag;
itemsElement.addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-drag]');
 if(!handle||handle.disabled||event.button!==0||drag||busy)return;
 const from=Number(handle.dataset.drag);
 const rows=Array.from(itemsElement.querySelectorAll('[data-item]'));
 handle.setPointerCapture(event.pointerId);
 drag={handle,id:event.pointerId,from,to:from,startY:event.clientY,rows};
});
function updateDrag(event){
 if(!drag||event.pointerId!==drag.id)return;
 if(!drag.moved&&Math.abs(event.clientY-drag.startY)<4)return;
 const {from,rows}=drag;
 drag.moved=true;
 let to=0;
 rows.forEach((row,index)=>{
  if(index===from)return;
  const bounds=row.getBoundingClientRect();
  if(event.clientY>bounds.top+bounds.height/2)to++;
 });
 rows[drag.to].classList.remove('drop-before','drop-after');
 if(to!==from)rows[to].classList.add(to<from?'drop-before':'drop-after');
 rows[from].classList.add('dragging');
 drag.to=to;
}
function finishDrag(event){
 if(!drag||event.pointerId!==drag.id)return;
 if(event.type==='pointerup')updateDrag(event);
 const {from,to,rows,moved}=drag;
 drag=null;
 rows[from].classList.remove('dragging');
 rows[to].classList.remove('drop-before','drop-after');
 if(moved&&event.type==='pointerup')moveItem(from,to);
}
itemsElement.addEventListener('pointermove',updateDrag);
['pointerup','pointercancel','lostpointercapture'].forEach(type=>itemsElement.addEventListener(type,finishDrag));
itemsElement.addEventListener('keydown',event=>{
 const handle=event.target.closest('[data-drag]');
 if(!handle||busy||!['ArrowUp','ArrowDown'].includes(event.key))return;
 event.preventDefault();
 const from=Number(handle.dataset.drag);
 moveItem(from,from+(event.key==='ArrowUp'?-1:1));
});
['reason','submitDate','submitter'].forEach(id=>$(id).addEventListener('input',()=>{S.draft[id]=$(id).value;markDirty();}));
$('dateA').addEventListener('change',()=>{try{C.date($('dateA').value);S.sel.dateA=$('dateA').value;S.sel.periodA=0;S.sel.teacherB='';S.sel.periodB=0;S.sel.weekB=C.monday(S.sel.dateA);renderSelection();}catch(e){showError(e);}});
$('weekB').addEventListener('change',()=>{try{S.sel.weekB=C.monday($('weekB').value);S.sel.teacherB='';S.sel.periodB=0;renderSelection();}catch(e){showError(e);}});
$('roomOverride').addEventListener('input',()=>{S.sel.roomA=$('roomOverride').value;});
$('historyStatus').addEventListener('change',renderHistory);
['historyFrom','historyTo'].forEach(id=>$(id).addEventListener('change',()=>{
 const from=$('historyFrom').value,to=$('historyTo').value;
 if(from&&to&&from>to)notify('끝 날짜를 시작 날짜 이후로 설정하세요.');
 renderHistory();
}));
$('swapNav').hidden=admin;
$('historyTitle').textContent=admin?'제출된 결보강 계획서':'내 임시저장 계획서';
$('historyAdminFilters').hidden=!admin;
if(admin){const search=$('historySearch');search.placeholder='결강 교사 이름 검색';search.setAttribute('aria-label',search.placeholder);}
resetDraft();showSnapshot(initial);
return Object.freeze({get dirty(){return S.dirty||S.editIndex>=0||Array.from(termDrafts.values()).some(d=>d.dirty||d.editIndex>=0);},resume(){return work(async()=>showSnapshot(await api('resume',{dataRev:S.dataRev,planRev:S.planRev})));},destroy(){termDrafts.clear();root.replaceChildren();}});
}
