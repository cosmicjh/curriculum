import {seats} from './studyroom-layout.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const timeFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'});
const time=v=>v?timeFormat.format(new Date(v)):'';
const field=(name,html)=>'<label>'+name+html+'</label>';
const button=(action,label,attrs='')=>'<button type="button" data-sr="'+action+'" '+attrs+'>'+label+'</button>';
export function mountStudyroom(root,{request,admin=false}){
 const state={view:'current',dashboard:null,person:null,query:null,students:[],pending:null},$=s=>root.querySelector(s);
 root.className='studyroom';
 root.innerHTML='<div class="sr-heading"><h2>스터디룸</h2><span data-sr-test></span></div><p data-sr-error role="alert"></p><nav class="tabs" aria-label="스터디룸 메뉴">'+[['current','현재 출석'],['query','출석 조회'],...(admin?[['members','이용 학생'],['settings','운영 설정']]:[])].map(([v,l])=>button('view',l,'data-view="'+v+'"')).join('')+'</nav><section data-sr-content></section><dialog aria-labelledby="sr-dialog-title"></dialog>';
 const content=$('[data-sr-content]'),dialog=$('dialog');let busy=false;
 async function api(op,args={}){return request('studyroom',{op,...args});}
 async function run(fn){if(busy)return;busy=true;root.setAttribute('aria-busy','true');$('[data-sr-error]').textContent='';try{await fn();}catch(e){$('[data-sr-error]').textContent=e.message;}finally{busy=false;root.setAttribute('aria-busy','false');}}
 function renderCurrent(){
  content.innerHTML='<div class="sr-toolbar"><strong data-sr-session></strong>'+button('refresh','새로고침')+button('manual','수동 등록')+field('보기','<select data-sr-view><option value="seats">좌석</option><option value="list">목록</option></select>')+field('검색','<input type="search" data-sr-filter placeholder="학번·이름">')+'</div><p class="sr-count" data-sr-count></p><div class="sr-seat-scroll" tabindex="0" aria-label="99석 배치표"><div class="sr-seat-grid"></div></div><div class="sr-table" data-sr-list hidden></div>';
  const grid=$('.sr-seat-grid');
  for(const [code,row,column] of seats){const b=document.createElement('button');b.type='button';b.dataset.sr='seat';b.dataset.seat=code;b.style.gridRow=(row-6)+' / span 4';b.style.gridColumn=column;b.innerHTML='<strong>'+code+'번</strong><span data-number></span><span data-name></span>';grid.append(b);}
  paintCurrent();
 }
 function paintCurrent(){
  const d=state.dashboard;if(!d||state.view!=='current')return;
  $('[data-sr-session]').textContent=d.current?d.current.label+' · '+d.current.date+(d.enabled?'':' · 접수 중지'):'접수 중인 회차 없음';
  $('[data-sr-count]').textContent='출석 '+d.rows.length+'명 · '+time(d.serverAt);
  $('[data-sr=manual]').disabled=!d.current||!d.enabled;const q=$('[data-sr-filter]').value.trim(),bySeat=new Map(d.rows.map(r=>[r.seat,r]));
  const matches=r=>!q||r.name.includes(q)||r.student_number.includes(q);
  for(const b of root.querySelectorAll('[data-sr="seat"]')){
   const r=bySeat.get(b.dataset.seat);b.classList.toggle('occupied',Boolean(r));b.classList.toggle('sr-dim',Boolean(r&&!matches(r)));
   b.querySelector('[data-number]').textContent=r?.student_number||'';b.querySelector('[data-name]').textContent=r?.name||'';
   b.setAttribute('aria-label',b.dataset.seat+'번 '+(r?r.student_number+' '+r.name:'빈 좌석'));
  }
  const list=$('[data-sr-list]');if(!list.hidden)list.innerHTML=table(d.rows.filter(matches));
 }
 function table(rows){
  if(!rows.length)return '<p class="sr-empty">기록 없음</p>';
  const columns=['학번','이름','좌석','제출','비고'];
  const body=rows.map(r=>{
   const cells=[r.student_number,r.name,r.seat,time(r.first_at)].map(value=>'<td>'+esc(value)+'</td>').join('');
   const record='data-id="'+esc(r.id)+'"';
   const status=r.state==='cancelled'?'<span>취소</span>':'';
   return '<tr>'+cells+'<td class="sr-note">'+esc(r.note)+'<div class="sr-table-actions">'+
    button('edit','변경',record)+button('history','이력',record)+status+'</div></td></tr>';
  }).join('');
  return '<table><thead><tr>'+columns.map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>';
 }
 function groupedTable(rows){
  const dates=new Map();
  for(const r of rows){
   if(!dates.has(r.date))dates.set(r.date,new Map());
   const groups=dates.get(r.date);if(!groups.has(r.label))groups.set(r.label,[]);groups.get(r.label).push(r);
  }
  return dates.size?[...dates].map(([date,groups])=>'<section class="sr-day"><h3>'+esc(date)+'</h3>'+[...groups].map(([label,records])=>'<h4>'+esc(label)+'</h4><div class="sr-table">'+table(records)+'</div>').join('')+'</section>').join(''):table([]);
 }
 async function refresh(){state.dashboard=await api('dashboard');$('[data-sr-test]').textContent=state.dashboard.testLabel;paintCurrent();}
 function showDialog(html){dialog.innerHTML='<div class="sr-dialog-head"><h2 id="sr-dialog-title">'+html.title+'</h2>'+button('closeDialog','닫기')+'</div>'+html.body;if(!dialog.open)dialog.showModal();}
 function edit(r,seat=''){
  const manual=!r;state.pending=null;state.editRevision=state.dashboard.revision;state.editRecordVersion=r?.version;state.editSessionId=state.dashboard.current?.id;
  const note=field('비고','<textarea name="note" rows="3" maxlength="200">'+esc(r?.note||'')+'</textarea>');
  const seatField=field('좌석','<input name="seat" value="'+esc(r?.seat||seat)+'" pattern="(0[1-9]|[1-9][0-9])" maxlength="2" required>');
  const operations=field('작업','<select name="change"><option value="note">비고만 수정</option><option value="move">좌석 이동</option>'+(r?.state==='cancelled'?'<option value="restore">출석 복원</option>':'<option value="cancel">출석 취소</option>')+'</select>')+seatField;
  showDialog({title:manual?'수동 등록':esc(r.student_number+' '+r.name),body:'<form data-sr-form="change" data-id="'+esc(r?.id||'')+'">'+
   (manual?field('학번','<input name="studentNumber" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required>')+seatField:'')+
   note+(manual?'':'<details class="sr-correction"><summary>출석 정정</summary>'+operations+'</details>')+'<button class="primary">저장</button></form>'});
 }
 function renderQuery(){
  const month=localDate().slice(0,7);
  content.innerHTML='<form data-sr-form="search" class="sr-toolbar">'+field('학생 검색','<input name="search" placeholder="학번·이름" type="search">')+'<button>검색</button>'+button('clearPerson','전체 학생')+'</form><div data-sr-students></div><h3 data-sr-person>전체 학생</h3><form data-sr-form="query" class="sr-toolbar">'+field('월 달력','<input type="month" name="month" value="'+month+'">')+field('시작일','<input type="date" name="from" value="'+month+'-01" required>')+field('종료일','<input type="date" name="to" value="'+localDate()+'" required>')+field('회차','<select name="sessionLabel"><option value="">전체 회차</option><option>오전</option><option>오후</option><option>야간</option></select>')+'<label class="sr-check"><input type="checkbox" name="includeCancelled">취소 포함</label><button>조회</button></form><div class="sr-calendar" data-sr-calendar></div><p data-sr-query-count></p><div data-sr-results></div><div class="sr-toolbar">'+button('previous','이전')+button('next','다음')+'</div>';
  state.person=null;return loadQuery();
 }
 function queryArgs(){const f=$('[data-sr-form="query"]');return {from:f.elements.from.value,to:f.elements.to.value,sessionLabel:f.elements.sessionLabel.value,includeCancelled:f.elements.includeCancelled.checked,...(state.person?{personId:state.person.person_id}:{})};}
 async function loadQuery(offset=0,day=null){state.queryDay=day;
  const args=queryArgs();const q=await api('query',{...args,...(day?{from:day,to:day}:{}),offset});state.query=q;
  $('[data-sr-results]').innerHTML=groupedTable(q.rows);$('[data-sr-query-count]').textContent=q.totals.students+'명 · '+q.totals.days+'일 · '+q.totals.records+'회';$('[data-sr="previous"]').disabled=!q.offset;$('[data-sr="next"]').disabled=q.next===null;
  if(!day){const month=$('[name="month"]').value,first=new Date(month+'-01T00:00:00Z'),length=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
   $('[data-sr-calendar]').innerHTML=['일','월','화','수','목','금','토'].map(x=>'<strong>'+x+'</strong>').join('')+'<span style="grid-column:span '+(first.getUTCDay()||7)+'" '+(!first.getUTCDay()?'hidden':'')+'></span>'+Array.from({length},(_,i)=>{const day=month+'-'+String(i+1).padStart(2,'0'),x=q.calendar.find(c=>c.date===day);return button('day','<span>'+(i+1)+'</span>'+(x?'<strong>출석 '+x.records+'</strong>':''),'data-day="'+day+'" class="'+(x?'has-record':'')+'" aria-label="'+day+(x?' 출석 '+x.records:' 기록 없음')+'"');}).join('');
  }
 }
 async function searchStudents(search){const d=await api('students',{search});state.students=d.students;const area=$('[data-sr-students]');area.innerHTML=d.students.length?d.students.map((s,i)=>'<div class="sr-student">'+button('person',esc(s.studentNumber+' '+s.name+(s.current?'':' · 과거 기록')),'data-index="'+i+'"')+(admin&&state.view==='members'&&s.current?button('membership',s.eligible?'이용 중지':'이용 허용','data-index="'+i+'"')+button('link','이전 이력 연결','data-index="'+i+'"'):'')+'</div>').join(''):'<p>학생 없음</p>';}
 async function renderMembers(){content.innerHTML='<form data-sr-form="search" class="sr-toolbar">'+field('학생 검색','<input type="search" name="search" placeholder="학번·이름">')+'<button>검색</button></form><div data-sr-students></div>';await searchStudents('');}
 async function renderSettings(){
  const settings=await api('settings'),rules=settings.schedules[0]?JSON.parse(settings.schedules[0].definitions):[];
  content.innerHTML='<h3>접수</h3><form data-sr-form="enabled" class="sr-toolbar"><label class="sr-check"><input name="enabled" type="checkbox" '+(state.dashboard.enabled?'checked':'')+'>학생 접수 허용</label><button>저장</button></form><p>자동 마감 '+(state.dashboard.cronEnabled?'설정됨':'미설정')+(state.dashboard.lastRunAt?' · '+esc(state.dashboard.lastRunAt):'')+'</p>'+(state.dashboard.lastError?'<p role="alert">'+esc(state.dashboard.lastError)+'</p>':'')+'<h3>시정</h3><form data-sr-form="schedule">'+field('적용일','<input type="date" name="effectiveDate" value="'+(rules.length?new Date(Date.now()+33*3600000).toISOString().slice(0,10):localDate())+'" required>')+'<div class="sr-rules"></div><div class="sr-toolbar">'+button('addRule','회차 추가')+'<button class="primary">시정 저장</button></div></form><h3>자료</h3>'+button('export','출석 자료 내보내기');
  for(const r of rules.length?rules:[{}])addRule(r);
 }
 function addRule(r={}){const div=document.createElement('div');div.className='sr-rule';div.dataset.id=r.id||crypto.randomUUID();div.innerHTML=field('회차 이름','<input name="label" value="'+esc(r.label==='아침'?'오전':r.label||'')+'" maxlength="30" required>')+'<fieldset><legend>요일</legend>'+['월','화','수','목','금','토','일'].map((d,i)=>'<label class="sr-check"><input type="checkbox" value="'+(i+1)+'" '+(r.days?.includes(i+1)?'checked':'')+'>'+d+'</label>').join('')+'</fieldset>'+field('접수 시작','<input name="start" type="time" value="'+esc(r.start||'')+'" required>')+field('저장·초기화','<input name="end" type="time" value="'+esc(r.end||'')+'" required>')+button('removeRule','삭제');$('.sr-rules').append(div);}
 async function show(view){state.view=view;root.querySelectorAll('[data-sr="view"]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===view?'page':'false'));if(view==='current'){renderCurrent();await refresh();}if(view==='query')await renderQuery();if(view==='members')await renderMembers();if(view==='settings'){await refresh();await renderSettings();}}
 root.addEventListener('input',e=>{if(e.target.matches('[data-sr-filter]'))paintCurrent();});
 root.addEventListener('change',e=>{if(e.target.matches('[data-sr-view]')){$('.sr-seat-scroll').hidden=e.target.value!=='seats';$('[data-sr-list]').hidden=e.target.value!=='list';paintCurrent();}if(e.target.name==='month'&&state.view==='query')run(async()=>{const month=e.target.value,f=$('[data-sr-form="query"]');f.elements.from.value=month+'-01';f.elements.to.value=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);await loadQuery();});});
 root.addEventListener('click',e=>{const b=e.target.closest('[data-sr]');if(!b)return;e.stopPropagation();run(async()=>{
  const a=b.dataset.sr;if(a==='view')return show(b.dataset.view);if(a==='refresh')return refresh();if(a==='closeDialog')return dialog.close();if(a==='addRule')return addRule();if(a==='removeRule')return b.closest('.sr-rule').remove();
  if(a==='seat'){const r=state.dashboard?.rows.find(r=>r.seat===b.dataset.seat);if(r||state.dashboard?.current&&state.dashboard.enabled)return edit(r,b.dataset.seat);return;}if(a==='manual')return edit(null);
  if(a==='edit')return edit([...(state.query?.rows||[]),...state.dashboard.rows].find(r=>r.id===b.dataset.id));
  if(a==='history'){
   const {events}=await api('history',{recordId:b.dataset.id});
   return showDialog({title:'변경 이력',body:'<ol class="sr-audit">'+events.map(x=>{
    const record=JSON.parse(x.record),detail=x.action==='note'?record.note||'비고 삭제':x.reason;
    const actor=record.actorName||record.confirmed_name||({'student':'학생 제출','scheduler':'자동 마감','role:admin':'관리자'})[x.actor]||'교사';
    return '<li>'+esc(x.at)+' · '+esc(x.action)+' · '+esc(actor)+(detail?'<p>'+esc(detail)+'</p>':'')+'</li>';
   }).join('')+'</ol>'});
  }
  if(a==='person'){state.person=state.students[Number(b.dataset.index)];if(state.view==='query'){$('[data-sr-person]').textContent=state.person.studentNumber+' '+state.person.name;return loadQuery();}return;}
  if(a==='clearPerson'){state.person=null;$('[data-sr-person]').textContent='전체 학생';return loadQuery();}
  if(a==='day')return loadQuery(0,b.dataset.day);if(a==='next')return loadQuery(state.query.next,state.queryDay);if(a==='previous')return loadQuery(Math.max(0,state.query.offset-200),state.queryDay);
  if(a==='membership'){const s=state.students[Number(b.dataset.index)];await api('setMember',{personId:s.person_id,enabled:!s.eligible,expectedRevision:state.dashboard.revision});await refresh();return searchStudents($('[name="search"]').value);}
  if(a==='link'){state.linkStudent=state.students[Number(b.dataset.index)];return showDialog({title:esc(state.linkStudent.studentNumber+' '+state.linkStudent.name+' · 이전 이력 연결'),body:'<form data-sr-form="linkSearch">'+field('이전 학번·이름','<input name="search" required>')+'<button>찾기</button></form><div data-sr-link-results></div>'});}
  if(a==='linkTarget'){const target=state.linkTargets[Number(b.dataset.index)];if(!confirm(state.linkStudent.name+' 학생을 '+target.studentNumber+' '+target.name+' 이력에 연결할까요?'))return;await api('linkStudent',{studentId:state.linkStudent.id,personId:target.person_id,expectedRevision:state.dashboard.revision});dialog.close();await refresh();return searchStudents($('[name="search"]').value);}
  if(a==='export'){const data=await api('export'),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='studyroom-'+localDate()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 });});
 root.addEventListener('submit',e=>{const f=e.target;if(!f.dataset.srForm)return;e.preventDefault();e.stopPropagation();run(async()=>{
  const kind=f.dataset.srForm;
  if(kind==='change'){const args={change:f.elements.change?.value||'manual',recordId:f.dataset.id,studentNumber:f.elements.studentNumber?.value,seat:f.elements.seat.value,note:f.elements.note.value};const signature=JSON.stringify(args);if(state.pending?.signature!==signature)state.pending={signature,id:crypto.randomUUID()};await api('change',{...args,requestId:state.pending.id,expectedRevision:state.editRevision,expectedRecordVersion:state.editRecordVersion,expectedSessionId:state.editSessionId});state.pending=null;dialog.close();await refresh();if(state.view==='query')await loadQuery(state.query.offset,state.queryDay);return;}
  if(kind==='search')return searchStudents(f.elements.search.value);if(kind==='query')return loadQuery();
  if(kind==='enabled'){await api('configuration',{enabled:f.elements.enabled.checked,expectedRevision:state.dashboard.revision});return refresh();}
  if(kind==='schedule'){const definitions=Array.from(root.querySelectorAll('.sr-rule')).map(row=>({id:row.dataset.id,label:row.querySelector('[name="label"]').value,start:row.querySelector('[name="start"]').value,end:row.querySelector('[name="end"]').value,days:Array.from(row.querySelectorAll('input[type="checkbox"]:checked')).map(x=>Number(x.value))}));await api('configuration',{enabled:state.dashboard.enabled,expectedRevision:state.dashboard.revision,schedule:{effectiveDate:f.elements.effectiveDate.value,definitions}});return refresh();}
  if(kind==='linkSearch'){state.linkTargets=(await api('students',{search:f.elements.search.value})).students.filter(s=>s.person_id!==state.linkStudent.person_id);$('[data-sr-link-results]').innerHTML=state.linkTargets.map((s,i)=>button('linkTarget',esc(s.studentNumber+' '+s.name),'data-index="'+i+'"')).join('')||'<p>이전 기록 없음</p>';}
 });});
 const timer=setInterval(()=>{if(root.isConnected&&!document.hidden&&!dialog.open&&state.view==='current'&&!busy)run(refresh);},30000);
 run(()=>show('current'));
 return {root,refresh:()=>run(refresh),dispose(){clearInterval(timer);}};
}
