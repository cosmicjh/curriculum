import {C} from '../../vendor/class-swap/src/shared/core.js';

export function mountClassSwap(root,initial,{request,selectedTeacher,print}){
const $=id=>root.getElementById(id);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const uid=()=>{const a=new Uint32Array(4);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(8,'0')).join('');};
let busy=false,toastTimer=0;
const S={dataset:null,plans:[],dataRev:'0',planRev:'0',view:'write',dirty:false,draft:null,sel:null,editIndex:-1,candidates:[]};
function resetDraft(){S.draft={id:'p_'+uid(),version:0,teacherA:'',reason:'',submitDate:today(),submitter:'',items:[]};S.dirty=false;resetSelection(false);}
function resetSelection(preserveDates=true){const d=preserveDates&&S.sel?S.sel.dateA:today(),week=preserveDates&&S.sel?S.sel.weekB:C.monday(d);S.sel={mode:S.sel?S.sel.mode:'swap',dateA:d,periodA:0,weekB:week,teacherB:'',dateB:'',periodB:0,roomA:''};S.editIndex=-1;}
function notify(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;},4500);}
function showError(error){$('appError').textContent=error.message||String(error);$('appError').hidden=false;}
function setBusy(value){busy=value;root.querySelectorAll('fieldset[data-lock]').forEach(e=>{e.disabled=value;});$('progress').hidden=!value;}
async function work(fn){if(busy)return;setBusy(true);$('appError').hidden=true;try{return await fn();}catch(e){showError(e);}finally{setBusy(false);}}
const api=(action,payload={})=>request(action,payload);
function mergeSnapshot(v){if(v.dataset)S.dataset=v.dataset;else if(v.hasDataset===false)S.dataset=null;if(v.plans)S.plans=v.plans;S.dataRev=v.dataRev;S.planRev=v.planRev;}
function showSnapshot(v){mergeSnapshot(v);if(!S.dirty&&!S.draft.teacherA){const teacher=S.dataset?.teachers.find(t=>t.name===selectedTeacher());if(teacher){S.draft.teacherA=teacher.id;S.draft.submitter=teacher.name;}}renderAll();}
function markDirty(){S.dirty=true;$('dirtyLabel').hidden=false;}
function teacherOptions(value,empty=true){return(empty?'<option value="">교사 선택</option>':'')+(S.dataset?S.dataset.teachers.slice().sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(t=>'<option value="'+esc(t.id)+'"'+(t.id===value?' selected':'')+'>'+esc(t.name)+'</option>').join(''):'');}
function currentItems(){return S.draft.items.filter((_,i)=>i!==S.editIndex);}
function usedSlots(){return C.reservations(S.plans,S.draft.id,{teacherA:S.draft.teacherA,items:currentItems()});}
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
 S.candidates=[];if(S.dataset&&S.draft.teacherA&&S.sel.periodA){S.candidates=C.findCandidates(S.dataset,S.plans,{teacherA:S.draft.teacherA,dateA:S.sel.dateA,periodA:S.sel.periodA,mode:S.sel.mode,weekB:S.sel.weekB,exceptId:S.draft.id,items:currentItems()});}
 if(!S.candidates.some(c=>c.teacherId===S.sel.teacherB)){S.sel.teacherB='';S.sel.dateB='';S.sel.periodB=0;}
}
function renderSelection(){
 recomputeCandidates();$('dateA').value=S.sel.dateA;$('weekB').value=S.sel.weekB;$('weekBField').hidden=S.sel.mode==='cover';$('sourceTeacherLabel').textContent=S.dataset?(C.teacher(S.dataset,S.draft.teacherA)?.name||'교사 미선택'):'교사 미선택';$('selectedDateSummary').textContent=prettyDate(S.sel.dateA);
 root.querySelectorAll('[data-action=mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===S.sel.mode));
 $('candidateCount').textContent=S.candidates.length+'명';$('candidateTitle').textContent=S.sel.teacherB?(S.sel.mode==='swap'?'교체할 수업을 선택하세요':'선택한 보강 교사'):S.sel.periodA?(S.candidates.length?'시간표상 가능한 교사':'조건에 맞는 교사가 없습니다'):'교체 대상';
 $('teacherB').innerHTML='<option value="">대상 교사 선택</option>'+S.candidates.map(c=>'<option value="'+esc(c.teacherId)+'"'+(S.sel.teacherB===c.teacherId?' selected':'')+'>'+esc(c.name)+(S.sel.mode==='swap'?' · '+c.choices.length+'개 수업':' · 당일 '+c.load+'시간')+'</option>').join('');
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
 $('items').innerHTML='<table class="list-table"><thead><tr><th>유형</th><th>결강 수업</th><th>학급·대상</th><th>담당 교사 / 교체 수업</th><th></th></tr></thead><tbody>'+items.map((i,n)=>'<tr><td><span class="type">'+(i.mode==='swap'?'교체':'보강')+'</span></td><td>'+esc(timeText(i.dateA,i.periodA))+'<br><small>'+esc(i.subjectA)+'</small></td><td>'+esc(i.roomA)+'</td><td>'+esc(i.teacherBName)+(i.mode==='swap'?'<br><small>'+esc(timeText(i.dateB,i.periodB))+' · '+esc(i.subjectB)+'</small>':'')+'</td><td class="right"><button class="text-btn" data-action="moveItem" data-index="'+n+'" data-direction="-1" aria-label="위로 이동"'+(n===0?' disabled':'')+'>↑</button><button class="text-btn" data-action="moveItem" data-index="'+n+'" data-direction="1" aria-label="아래로 이동"'+(n===items.length-1?' disabled':'')+'>↓</button><button class="text-btn" data-action="editItem" data-index="'+n+'">수정</button><button class="text-btn" data-action="removeItem" data-index="'+n+'">삭제</button></td></tr>').join('')+'</tbody></table>';
}
function renderWrite(){
 $('documentTitle').innerHTML=(S.draft.version?'계획서 수정':'새 계획서')+'<span id="dirtyLabel" class="dirty"'+(!S.dirty?' hidden':'')+'>저장 전</span>';
 $('noDataset').hidden=!!S.dataset;
 $('teacherA').innerHTML=teacherOptions(S.draft.teacherA);$('reason').value=S.draft.reason;$('submitDate').value=S.draft.submitDate;$('submitter').value=S.draft.submitter;
 renderSelection();renderItems();
}
function renderHistory(){
 const q=$('historySearch').value.trim(),status=$('historyStatus').value;
 const plans=S.plans.filter(p=>(status==='all'||p.status===status)&&(!q||(p.teacherAName+' '+p.reason).includes(q))).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
 if(!plans.length){$('historyList').innerHTML='<div class="empty-state"><p>해당하는 계획서가 없습니다.</p></div>';return;}
 $('historyList').innerHTML='<table class="list-table"><thead><tr><th>결강 교사</th><th>결강일</th><th>사유</th><th>수업</th><th>상태</th><th></th></tr></thead><tbody>'+plans.map(p=>'<tr><td><b>'+esc(p.teacherAName)+'</b></td><td>'+esc(Array.from(new Set(p.items.map(i=>i.dateA))).sort().map(d=>prettyDate(d)).join(', '))+'</td><td>'+esc(p.reason)+'</td><td>'+p.items.length+'건</td><td><span class="type">'+(p.status==='active'?'저장됨':'취소됨')+'</span></td><td class="right">'+(p.status==='active'?'<button class="text-btn" data-action="openPlan" data-id="'+esc(p.id)+'">열기</button><button class="text-btn" data-action="printPlan" data-id="'+esc(p.id)+'">인쇄</button><button class="text-btn" data-action="noticePlan" data-id="'+esc(p.id)+'">학급 공지</button><button class="text-btn" data-action="cancelPlan" data-id="'+esc(p.id)+'">취소</button>':'<button class="text-btn" data-action="copyPlan" data-id="'+esc(p.id)+'">새 계획으로 복사</button>')+'</td></tr>').join('')+'</tbody></table>';
}
function renderAll(){
 $('historyCount').textContent=S.plans.filter(p=>p.status==='active').length||'';
 ['write','history'].forEach(v=>{$(v+'View').hidden=S.view!==v;});root.querySelectorAll('[data-action=nav]').forEach(b=>b.classList.toggle('active',b.dataset.view===S.view));
 renderWrite();renderHistory();
}
function draftForSave(){return Object.assign({},S.draft,{reason:$('reason').value.trim(),submitter:$('submitter').value.trim(),submitDate:$('submitDate').value});}
function addItem(){
 if(!S.dataset||!S.sel.teacherB||!S.sel.periodA||!S.sel.periodB)throw new Error('결강 수업과 대상 교사를 선택해 주세요.');
 const i={mode:S.sel.mode,dateA:S.sel.dateA,periodA:S.sel.periodA,teacherB:S.sel.teacherB,dateB:S.sel.dateB,periodB:S.sel.periodB,roomA:$('roomOverride').value.trim()};
 const raw=draftForSave(),items=raw.items.slice();if(S.editIndex>=0)items[S.editIndex]=i;else items.push(i);
 const v=C.validatePlan(S.dataset,S.plans,Object.assign({},raw,{items}));S.draft=Object.assign({},raw,v);markDirty();resetSelection();renderWrite();
}
function saveDraft(){return work(async()=>{if(S.editIndex>=0)throw new Error('수정 중인 수업을 먼저 적용하거나 선택 취소해 주세요.');if(!S.dataset)throw new Error('등록된 시간표가 없습니다.');const raw=draftForSave();C.validatePlan(S.dataset,S.plans,raw);const r=await api('savePlan',{plan:raw,dataRev:S.dataRev});upsert(r.plan,r.planRev);S.draft=C.clone(r.plan);S.dirty=false;resetSelection();renderAll();notify('계획서를 저장했습니다.');});}
function upsert(plan,rev){const i=S.plans.findIndex(p=>p.id===plan.id);if(i>=0)S.plans[i]=plan;else S.plans.push(plan);S.planRev=rev;}
function switchView(view){S.view=view;renderAll();}
async function refresh(){const r=await api('load',{dataRev:S.dataRev,planRev:S.planRev});mergeSnapshot(r);renderAll();notify('최신 자료를 불러왔습니다. 작성 중인 내용은 유지됩니다.');}
function openPlan(id,copy){const p=S.plans.find(p=>p.id===id);if(!p)return;if(S.dirty&&!confirm('작성 중인 내용을 닫고 다른 계획서를 열겠습니까?'))return;S.draft=C.clone(p);if(copy){S.draft.id='p_'+uid();S.draft.version=0;S.draft.submitDate=today();delete S.draft.status;}S.dirty=!!copy;resetSelection();S.view='write';renderAll();window.scrollTo({top:0,behavior:'smooth'});}
function editItem(index){const i=S.draft.items[index];if(!i)return;S.editIndex=index;S.sel={mode:i.mode,dateA:i.dateA,periodA:i.periodA,weekB:C.monday(i.dateB),teacherB:i.teacherB,dateB:i.dateB,periodB:i.periodB,roomA:i.roomA};renderSelection();$('tableA').scrollIntoView({behavior:'smooth',block:'center'});}
function printableDraft(){if(!S.dataset)throw new Error('시간표를 먼저 등록해 주세요.');if(S.editIndex>=0)throw new Error('수정 중인 수업을 먼저 적용해 주세요.');const raw=draftForSave();return Object.assign({},raw,C.validatePlan(S.dataset,S.plans,raw));}
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
 else if(a==='refresh')work(refresh);
 else if(a==='new'){if(!S.dirty||confirm('작성 중인 내용을 닫고 새 계획서를 작성하겠습니까?')){resetDraft();renderWrite();}}
 else if(a==='removeItem'){S.draft.items.splice(Number(b.dataset.index),1);markDirty();resetSelection();renderWrite();}
 else if(a==='moveItem'){const n=Number(b.dataset.index),m=n+Number(b.dataset.direction);if(m>=0&&m<S.draft.items.length){[S.draft.items[n],S.draft.items[m]]=[S.draft.items[m],S.draft.items[n]];markDirty();resetSelection();renderWrite();}}
 else if(a==='editItem')editItem(Number(b.dataset.index));
 else if(a==='openPlan'||a==='copyPlan')openPlan(b.dataset.id,a==='copyPlan');
 else if(a==='cancelPlan'){const p=S.plans.find(p=>p.id===b.dataset.id);if(p&&confirm('이 계획서를 취소하겠습니까? 예약된 시간은 해제되며 취소 이력은 남습니다.'))work(async()=>{const r=await api('cancelPlan',{id:p.id,version:p.version});upsert(r.plan,r.planRev);if(S.draft.id===p.id)resetDraft();renderAll();notify('계획서를 취소했습니다.');});}
 else if(a==='printDraft'||a==='noticeDraft')printPlan(printableDraft(),a==='noticeDraft');
 else if(a==='printPlan'||a==='noticePlan'){const p=S.plans.find(p=>p.id===b.dataset.id);if(p)printPlan(p,a==='noticePlan');}
 }catch(e){showError(e);}
});
$('teacherA').addEventListener('change',()=>{if(S.draft.items.length&&!confirm('결강 교사를 바꾸면 현재 계획 내역을 비웁니다. 변경하겠습니까?')){$('teacherA').value=S.draft.teacherA;return;}S.draft.teacherA=$('teacherA').value;S.draft.items=[];S.draft.submitter=C.teacher(S.dataset,S.draft.teacherA)?.name||'';markDirty();resetSelection();renderWrite();});
['reason','submitDate','submitter'].forEach(id=>$(id).addEventListener('input',()=>{S.draft[id]=$(id).value;markDirty();}));
$('dateA').addEventListener('change',()=>{try{C.date($('dateA').value);S.sel.dateA=$('dateA').value;S.sel.periodA=0;S.sel.teacherB='';S.sel.periodB=0;S.sel.weekB=C.monday(S.sel.dateA);renderSelection();}catch(e){showError(e);}});
$('weekB').addEventListener('change',()=>{try{S.sel.weekB=C.monday($('weekB').value);S.sel.teacherB='';S.sel.periodB=0;renderSelection();}catch(e){showError(e);}});
$('teacherB').addEventListener('change',()=>{S.sel.teacherB=$('teacherB').value;S.sel.dateB='';S.sel.periodB=0;if(S.sel.mode==='cover'&&S.sel.teacherB){S.sel.dateB=S.sel.dateA;S.sel.periodB=S.sel.periodA;}renderSelection();});
$('roomOverride').addEventListener('input',()=>{S.sel.roomA=$('roomOverride').value;});
['historySearch','historyStatus'].forEach(id=>$(id).addEventListener(id==='historySearch'?'input':'change',renderHistory));
resetDraft();showSnapshot(initial);
return Object.freeze({get dirty(){return S.dirty||S.editIndex>=0;},resume(){return work(async()=>showSnapshot(await api('resume',{dataRev:S.dataRev,planRev:S.planRev})));},destroy(){clearTimeout(toastTimer);root.replaceChildren();}});
}
