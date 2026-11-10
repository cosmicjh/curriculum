import {seats} from './studyroom-layout.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const timeFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const time=v=>v?timeFormat.format(new Date(v)):'';
const field=(name,html)=>'<label>'+name+html+'</label>';
const button=(action,label,attrs='')=>'<button type="button" data-sr="'+action+'" '+attrs+'>'+label+'</button>';
const toggleGroup=(action,label,choices)=>'<div class="sr-toggle" role="group" aria-label="'+label+'">'+choices.map(([value,text],i)=>button(action,text,'data-value="'+value+'" aria-pressed="'+(!i)+'"')).join('')+'</div>';
function monthRange(month){
 const from=month+'-01',first=new Date(from+'T00:00:00Z');
 const length=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 return {from,to:month+'-'+length,length,start:first.getUTCDay()};
}
export function mountStudyroom(root,{request,admin=false}){
 const state={view:'current',dashboard:null,query:null,pending:null},$=s=>root.querySelector(s);
 root.className='studyroom';
 root.innerHTML='<div class="sr-heading"><h2>스터디룸</h2><span data-sr-test></span></div><p data-sr-error role="alert"></p><nav class="tabs" aria-label="스터디룸 메뉴">'+[['current','현재 출석'],['query','출석 조회'],...(admin?[['settings','운영 설정']]:[])].map(([v,l])=>button('view',l,'data-view="'+v+'"')).join('')+'</nav><section data-sr-content></section><dialog aria-labelledby="sr-dialog-title"></dialog>';
 const content=$('[data-sr-content]'),dialog=$('dialog');let busy=false;
 async function api(op,args={}){return request('studyroom',{op,...args});}
 async function run(fn){if(busy)return;busy=true;root.setAttribute('aria-busy','true');$('[data-sr-error]').textContent='';try{await fn();}catch(e){$('[data-sr-error]').textContent=e.message;}finally{busy=false;root.setAttribute('aria-busy','false');}}
 function renderCurrent(){
  content.innerHTML='<div class="sr-toolbar sr-attendance-toolbar"><div class="sr-current-status"><strong data-sr-session></strong>'+button('refresh','새로고침')+'</div>'+toggleGroup('display','보기',[['seats','좌석'],['list','목록']])+'</div><p class="sr-count" data-sr-count></p><div class="sr-seat-scroll" tabindex="0" aria-label="99석 배치표"><div class="sr-seat-grid"></div></div><div class="sr-table" data-sr-list hidden></div>';
  const grid=$('.sr-seat-grid');
  for(const [code,row,column] of seats){const b=document.createElement('button');b.type='button';b.dataset.sr='seat';b.dataset.seat=code;b.style.gridRow=(row-6)+' / span 4';b.style.gridColumn=column;b.innerHTML='<strong>'+code+'</strong><span data-number hidden></span><span data-name hidden></span>';grid.append(b);}
  paintCurrent();
 }
 function paintCurrent(){
  const d=state.dashboard;if(!d||state.view!=='current')return;
  $('[data-sr-session]').textContent=d.current?d.current.label+' · '+d.current.date+(d.enabled?'':' · 접수 중지'):'접수 중인 회차 없음';
  $('[data-sr-count]').textContent='출석 '+d.rows.length+'명 · '+time(d.serverAt);
  const bySeat=new Map(d.rows.map(r=>[r.seat,r]));
  for(const b of root.querySelectorAll('[data-sr="seat"]')){
   const r=bySeat.get(b.dataset.seat),number=b.querySelector('[data-number]'),name=b.querySelector('[data-name]');
   b.classList.toggle('occupied',Boolean(r));
   b.querySelector('strong').hidden=Boolean(r);
   number.hidden=name.hidden=!r;
   number.textContent=r?.student_number||'';
   name.textContent=r?.name||'';
   b.title='좌석 '+b.dataset.seat+' · '+(r?r.student_number+' '+r.name:'빈 좌석');
   b.setAttribute('aria-label',b.title);
  }
  const list=$('[data-sr-list]');if(!list.hidden)list.innerHTML=table(d.rows);
 }
 function table(rows,query=false){
  if(!rows.length)return '<p class="sr-empty">기록 없음</p>';
  const columns=['학번','이름','좌석','제출','비고'];
  const body=rows.map(r=>{
   const record='data-id="'+esc(r.id)+'"';
   const name=query&&!state.person?button('studentCalendar',esc(r.name),record+' class="sr-student-link"'):esc(r.name);
   const cells=[esc(r.student_number),name,esc(r.seat),time(r.first_at)].map(value=>'<td>'+value+'</td>').join('');
   if(query)return '<tr>'+cells+'<td class="sr-note sr-query-note"><button type="button" data-sr="readNote" '+record+' aria-label="'+esc(r.student_number+' '+r.name+' 비고 편집'+(r.note?' · '+r.note:''))+'" title="비고 편집">'+esc(r.note)+'</button></td></tr>';
   const status=r.state==='cancelled'?'<span>취소</span>':'';
   return '<tr>'+cells+'<td class="sr-note"><div class="sr-table-actions">'+
    button('edit','변경',record)+button('history','이력',record)+status+'</div>'+(r.note?'<p class="sr-note-text">'+esc(r.note)+'</p>':'')+'</td></tr>';
  }).join('');
  return '<table><thead><tr>'+columns.map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>';
 }
 function groupedTable(rows){
  const dates=new Map();
  for(const r of rows){
   if(!dates.has(r.date))dates.set(r.date,new Map());
   const groups=dates.get(r.date);if(!groups.has(r.label))groups.set(r.label,[]);groups.get(r.label).push(r);
  }
  return dates.size?[...dates].map(([date,groups])=>'<section class="sr-day"><h3>'+esc(date)+'</h3>'+[...groups].map(([label,records])=>'<h4>'+esc(label)+'</h4><div class="sr-table">'+table(records,true)+'</div>').join('')+'</section>').join(''):table([]);
 }
 async function refresh(){state.dashboard=await api('dashboard');$('[data-sr-test]').textContent=state.dashboard.testLabel;paintCurrent();}
 function showDialog(html){dialog.innerHTML='<div class="sr-dialog-head"><h2 id="sr-dialog-title">'+html.title+'</h2>'+button('closeDialog','닫기')+'</div>'+html.body;if(!dialog.open)dialog.showModal();}
 function edit(r,seat='',noteOnly=false){
  const manual=!r;state.pending=null;state.editRevision=state.dashboard.revision;state.editRecordVersion=r?.version;state.editSessionId=state.dashboard.current?.id;
  const note=field('비고','<textarea name="note" rows="3" maxlength="200">'+esc(r?.note||'')+'</textarea>');
  const seatField=field('좌석','<input name="seat" value="'+esc(r?.seat||seat)+'" pattern="(0[1-9]|[1-9][0-9])" maxlength="2" required>');
  const operations=field('작업','<select name="change"><option value="note">비고만 수정</option><option value="move">좌석 이동</option>'+(r?.state==='cancelled'?'<option value="restore">출석 복원</option>':'<option value="cancel">출석 취소</option>')+'</select>')+seatField;
  showDialog({title:manual?'수동 등록':esc(r.student_number+' '+r.name+' · 좌석 '+r.seat),body:'<form data-sr-form="change" data-id="'+esc(r?.id||'')+'">'+
   (manual?field('학번','<input name="studentNumber" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required>')+seatField:'')+
   note+(manual||noteOnly?'':'<details class="sr-correction"><summary>출석 정정</summary>'+operations+'</details>')+
   '<button class="primary">저장</button>'+(noteOnly&&r.note?'<button value="delete">삭제</button>':'')+'</form>'});
 }
 function renderQuery(){
  const month=localDate().slice(0,7);
  content.innerHTML='<form data-sr-form="search" class="sr-student-search">'+field('학생 검색','<input type="search" name="search" placeholder="이름 또는 학번" maxlength="80" required>')+'<button type="submit">검색</button><button type="reset">검색 초기화</button></form><div data-sr-search-results aria-live="polite"></div><div class="sr-query-person" data-sr-person hidden><h3 tabindex="-1"></h3>'+button('allStudents','전체 학생')+'</div><div class="sr-toolbar sr-attendance-toolbar sr-calendar-toolbar"><input type="month" name="month" aria-label="월 달력" value="'+month+'">'+
   toggleGroup('session','회차',[['','전체'],['오전','오전'],['오후','오후'],['야간','야간']])+
   '</div><table class="sr-calendar" data-sr-calendar aria-label="출석 달력"></table><div data-sr-results></div><div class="sr-toolbar" data-sr-pages hidden>'+button('previous','이전')+button('next','다음')+'</div>';
  state.sessionLabel='';state.queryDay=null;state.person=null;state.matches=[];
  return loadCalendar();
 }
 function clearSearch(){
  $('[name="search"]').value='';$('[data-sr-search-results]').replaceChildren();state.matches=[];
 }
 function pressButton(button){
  for(const other of content.querySelectorAll('[data-sr="'+button.dataset.sr+'"]'))other.setAttribute('aria-pressed',String(other===button));
 }
 async function loadCalendar(person=state.person){
  const monthInput=$('[name="month"]'),month=monthInput.value,{from,to,length,start}=monthRange(month);
  monthInput.disabled=true;
  let q;
  try{
   q=await api('query',{from,to,sessionLabel:state.sessionLabel,...(person?{personId:person.person_id}:{calendarOnly:true})});
  }finally{monthInput.disabled=false;}
  state.person=person;state.queryMonth=month;
  const personHeading=$('[data-sr-person]');
  personHeading.hidden=!person;
  personHeading.querySelector('h3').textContent=person?(person.student_number||person.studentNumber)+' '+person.name:'';
  const counts=new Map(q.calendar.map(x=>[x.date,x.records]));
  const weekdays=['일','월','화','수','목','금','토'];
  function dateCell(date){
   if(date<1||date>length)return '<td></td>';
   const day=month+'-'+String(date).padStart(2,'0'),count=counts.get(day);
   const label='<span>'+date+'</span>'+(count?'<strong data-sr-count-day>'+count+'</strong>':'');
   const attrs='class="sr-calendar-day'+(count?' has-record':'')+'" data-day="'+day+'"';
   return '<td>'+(person?'<div '+attrs+'>'+label+'</div>':button('day',label,attrs+' aria-pressed="'+(state.queryDay===day)+'" aria-label="'+day+(count?' 출석 '+count+'명':' 기록 없음')+'"'))+'</td>';
  }
  $('[data-sr-calendar]').innerHTML='<thead><tr>'+weekdays.map(day=>'<th scope="col">'+day+'</th>').join('')+'</tr></thead><tbody>'+
   Array.from({length:Math.ceil((start+length)/7)},(_,week)=>'<tr>'+weekdays.map((_,i)=>dateCell(week*7+i-start+1)).join('')+'</tr>').join('')+'</tbody>';
  if(person)return renderRecords(q);
  if(state.queryDay)return loadRecords();
  $('[data-sr-results]').innerHTML='<p class="sr-empty">날짜를 선택하세요.</p>';
  $('[data-sr-pages]').hidden=true;
 }
 async function loadRecords(offset=0){
  const day=state.queryDay;
  const scope=state.person?{...monthRange(state.queryMonth),personId:state.person.person_id}:{from:day,to:day};
  const {from,to,personId}=scope;
  renderRecords(await api('query',{from,to,personId,sessionLabel:state.sessionLabel,offset}));
 }
 function renderRecords(q){
  state.query=q;
  $('[data-sr-results]').innerHTML=groupedTable(q.rows);
  $('[data-sr-pages]').hidden=!q.offset&&q.next===null;
  $('[data-sr="previous"]').disabled=!q.offset;
  $('[data-sr="next"]').disabled=q.next===null;
 }
 async function renderSettings(){
  const settings=await api('settings'),rules=settings.schedules[0]?JSON.parse(settings.schedules[0].definitions):[];
  content.innerHTML='<h3>접수</h3><form data-sr-form="enabled" class="sr-toolbar"><label class="sr-check"><input name="enabled" type="checkbox" '+(state.dashboard.enabled?'checked':'')+'>학생 접수 허용</label><button>저장</button></form><p>자동 마감 '+(state.dashboard.cronEnabled?'설정됨':'미설정')+(state.dashboard.lastRunAt?' · '+esc(state.dashboard.lastRunAt):'')+'</p>'+(state.dashboard.lastError?'<p role="alert">'+esc(state.dashboard.lastError)+'</p>':'')+'<h3>시정</h3><form data-sr-form="schedule">'+field('적용일','<input type="date" name="effectiveDate" value="'+(rules.length?new Date(Date.now()+33*3600000).toISOString().slice(0,10):localDate())+'" required>')+'<div class="sr-rules"></div><div class="sr-toolbar">'+button('addRule','회차 추가')+'<button class="primary">시정 저장</button></div></form><h3>자료</h3>'+button('export','출석 자료 내보내기');
  for(const r of rules.length?rules:[{}])addRule(r);
 }
 function addRule(r={}){const div=document.createElement('div');div.className='sr-rule';div.dataset.id=r.id||crypto.randomUUID();div.innerHTML=field('회차 이름','<input name="label" value="'+esc(r.label==='아침'?'오전':r.label||'')+'" maxlength="30" required>')+'<fieldset><legend>요일</legend>'+['월','화','수','목','금','토','일'].map((d,i)=>'<label class="sr-check"><input type="checkbox" value="'+(i+1)+'" '+(r.days?.includes(i+1)?'checked':'')+'>'+d+'</label>').join('')+'</fieldset>'+field('접수 시작','<input name="start" type="time" value="'+esc(r.start||'')+'" required>')+field('저장·초기화','<input name="end" type="time" value="'+esc(r.end||'')+'" required>')+button('removeRule','삭제');$('.sr-rules').append(div);}
 async function show(view){state.view=view;root.querySelectorAll('[data-sr="view"]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===view?'page':'false'));if(view==='current'){renderCurrent();await refresh();}if(view==='query')await renderQuery();if(view==='settings'){await refresh();await renderSettings();}}
 root.addEventListener('change',e=>{if(e.target.name==='month'&&state.view==='query')run(()=>{
  if(!e.target.value)e.target.value=localDate().slice(0,7);
  state.queryDay=null;return loadCalendar();
 });});
 root.addEventListener('click',e=>{const b=e.target.closest('[data-sr]');if(!b)return;e.stopPropagation();run(async()=>{
  const a=b.dataset.sr;if(a==='view')return show(b.dataset.view);if(a==='refresh')return refresh();if(a==='closeDialog')return dialog.close();if(a==='addRule')return addRule();if(a==='removeRule')return b.closest('.sr-rule').remove();
  if(a==='display'){pressButton(b);$('.sr-seat-scroll').hidden=b.dataset.value!=='seats';$('[data-sr-list]').hidden=b.dataset.value!=='list';return paintCurrent();}
  if(a==='session'){pressButton(b);state.sessionLabel=b.dataset.value;return loadCalendar();}
  if(a==='seat'){const r=state.dashboard?.rows.find(r=>r.seat===b.dataset.seat);if(r||state.dashboard?.current&&state.dashboard.enabled)return edit(r,b.dataset.seat);return;}
  if(a==='edit'){const row=state.dashboard.rows.find(r=>r.id===b.dataset.id);if(row)return edit(row);}
  if(a==='readNote'){const row=state.query.rows.find(r=>r.id===b.dataset.id);if(row)return edit(row,'',true);}
  if(a==='history'){
   const {events}=await api('history',{recordId:b.dataset.id});
   return showDialog({title:'변경 이력',body:'<ol class="sr-audit">'+events.map(x=>{
    const record=JSON.parse(x.record),detail=x.action==='note'?record.note||'비고 삭제':x.reason;
    const actor=record.actorName||record.confirmed_name||({'student':'학생 제출','scheduler':'자동 마감','role:admin':'관리자'})[x.actor]||'교사';
    return '<li>'+esc(x.at)+' · '+esc(x.action)+' · '+esc(actor)+(detail?'<p>'+esc(detail)+'</p>':'')+'</li>';
   }).join('')+'</ol>'});
  }
  if(a==='day'){pressButton(b);state.queryDay=b.dataset.day;return loadRecords();}
  if(a==='studentCalendar'){
   const person=state.query.rows.find(r=>r.id===b.dataset.id);
   if(person){await loadCalendar(person);$('[data-sr-person] h3').focus();}
  }
  if(a==='searchStudent'){
   const person=state.matches[Number(b.dataset.index)];
   if(person){await loadCalendar(person);$('[data-sr-search-results]').replaceChildren();state.matches=[];$('[data-sr-person] h3').focus();}
  }
  if(a==='allStudents'){
   clearSearch();
   await loadCalendar(null);
   ($('[data-sr=day][aria-pressed=true]')||$('[name="month"]')).focus();
  }
  if(a==='next')return loadRecords(state.query.next);
  if(a==='previous')return loadRecords(Math.max(0,state.query.offset-200));
  if(a==='export'){const data=await api('export'),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='studyroom-'+localDate()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 });});
 root.addEventListener('reset',e=>{
  if(e.target.dataset.srForm!=='search')return;
  e.preventDefault();run(()=>{clearSearch();return loadCalendar(null);});
 });
 root.addEventListener('submit',e=>{const f=e.target;if(!f.dataset.srForm)return;e.preventDefault();e.stopPropagation();run(async()=>{
  const kind=f.dataset.srForm;
  if(kind==='search'){
   const search=f.elements.search.value.trim();
   if(!search){clearSearch();return;}
   const result=await api('students',{search});state.matches=result.students;
   $('[data-sr-search-results]').innerHTML=state.matches.length?'<ul class="sr-search-results">'+state.matches.map((person,index)=>'<li>'+button('searchStudent',esc(person.studentNumber+' '+person.name),'data-index="'+index+'"')+'</li>').join('')+'</ul>':'<p class="sr-empty">검색 결과가 없습니다.</p>';
   return;
  }
  if(kind==='change'){
   const args={change:f.elements.change?.value||(f.dataset.id?'note':'manual'),recordId:f.dataset.id,studentNumber:f.elements.studentNumber?.value,seat:f.elements.seat?.value,note:e.submitter?.value==='delete'?'':f.elements.note.value};
   const signature=JSON.stringify(args);
   if(state.pending?.signature!==signature)state.pending={signature,id:crypto.randomUUID()};
   await api('change',{...args,requestId:state.pending.id,expectedRevision:state.editRevision,expectedRecordVersion:state.editRecordVersion,expectedSessionId:state.editSessionId});
   state.pending=null;dialog.close();
   return state.view==='query'?loadRecords(state.query.offset):refresh();
  }
  if(kind==='enabled'){await api('configuration',{enabled:f.elements.enabled.checked,expectedRevision:state.dashboard.revision});return refresh();}
  if(kind==='schedule'){const definitions=Array.from(root.querySelectorAll('.sr-rule')).map(row=>({id:row.dataset.id,label:row.querySelector('[name="label"]').value,start:row.querySelector('[name="start"]').value,end:row.querySelector('[name="end"]').value,days:Array.from(row.querySelectorAll('input[type="checkbox"]:checked')).map(x=>Number(x.value))}));await api('configuration',{enabled:state.dashboard.enabled,expectedRevision:state.dashboard.revision,schedule:{effectiveDate:f.elements.effectiveDate.value,definitions}});return refresh();}
 });});
 const timer=setInterval(()=>{if(root.isConnected&&!document.hidden&&!dialog.open&&state.view==='current'&&!busy)run(refresh);},30000);
 run(()=>show('current'));
 return {root,refresh:()=>run(refresh),dispose(){clearInterval(timer);}};
}
