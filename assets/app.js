(function(){
  'use strict';
  const $=s=>document.querySelector(s), esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const days=['월','화','수','목','금'];
  const state={meta:null,teacherBoot:null,timetable:null,roster:null,admin:null,adminTab:'students',teacherTab:'timetable',page:0,filters:{grade:'',classNum:'',status:'',search:''},importPayload:null,importPreview:null,route:'home'};
  // Drafts remain in memory only, scoped to term/form/entity. Never retain passwords.
  const formDrafts=new Map();
  function draftKey(form){return form.dataset.draftKey||(form.dataset.draftKey=[state.meta?.term||'',form.dataset.form,form.dataset.form==='save-student'?(state.editingStudent?.id||'new'):form.dataset.form==='save-section'?(state.editingSection?.id||'new'):''].join('|'));}
  function controlKey(el){return el.dataset.subject?'choice:'+el.dataset.subject:el.id||el.dataset.fixedDay&&('fixed:'+el.dataset.fixedDay+el.dataset.fixedPeriod)||el.dataset.blockDay&&('block:'+el.dataset.blockDay+el.dataset.blockPeriod);}
  function rememberForms(){document.querySelectorAll('form[data-form]').forEach(form=>{if(['login','password'].includes(form.dataset.form)||form.dataset.skipDraft)return;const values={};form.querySelectorAll('input,select,textarea').forEach(el=>{const k=controlKey(el);if(k&&el.type!=='password')values[k]=el.type==='file'?{files:Array.from(el.files)}:el.type==='checkbox'?{checked:el.checked}:{value:el.value};});formDrafts.set(draftKey(form),values);});}
  function restoreForms(){document.querySelectorAll('form[data-form]').forEach(form=>{const values=formDrafts.get(draftKey(form));if(!values||form.dataset.skipDraft)return;if(form.dataset.form==='roster'&&state.teacherBoot){const g=values['roster-grade']?.value,subject=values['roster-subject']?.value;if(g)setRosterOptions(g,subject,values['roster-section']?.value);}if(form.dataset.form==='batch'&&state.teacherBoot){const g=values['batch-grade']?.value;if(g)$('#batch-class').innerHTML=options(state.teacherBoot.meta.classes[g]||[],values['batch-class']?.value,'선택');}form.querySelectorAll('input,select,textarea').forEach(el=>{const v=values[controlKey(el)];if(!v)return;if(v.files){const dt=new DataTransfer();v.files.forEach(f=>dt.items.add(f));el.files=dt.files;}else if('checked' in v)el.checked=v.checked;else if(el.tagName!=='SELECT'||Array.from(el.options).some(o=>o.value===v.value))el.value=v.value;});});}
  function forgetDraft(name){document.querySelectorAll('form[data-form]').forEach(form=>{if(!name||form.dataset.form===name){formDrafts.delete(draftKey(form));form.dataset.skipDraft='true';}});if(!name)formDrafts.clear();}
  function withDrafts(render){return function(...args){rememberForms();const result=render(...args);restoreForms();return result;};}
  let busyCount=0,toastTimer;
  const app=$('#app'),modal=$('#modal');
  const swapPane=document.createElement('section');swapPane.id='class-swap-pane';swapPane.className='shell';swapPane.hidden=true;swapPane.setAttribute('aria-label','결보강');app.after(swapPane);
  const swapViews=new Map();
  const swapCachePrefix="timetable.swap-drafts.";
  let firstGradeCatalog=null;
  const allocationViews=new Map();
  const studyroomViews=new Map();
  async function showStudyroom(root,role){
    let view=studyroomViews.get(role);
    if(!view){const version=window.TIMETABLE_CONFIG?.assetVersion||'1',module=await import('./studyroom.js?v='+version),host=document.createElement('div');
      view=module.mountStudyroom(host,{admin:role==='admin',request:async(action,args)=>{try{return await call(action,args,role);}catch(error){if(error.code==='AUTH_REQUIRED'){view.dispose();studyroomViews.delete(role);state.teacherBoot=null;state.admin=null;renderLogin(role);}throw error;}}});studyroomViews.set(role,view);
    }
    root.replaceChildren(view.root);await view.refresh();
  }
  function allocationDirty(){return Array.from(allocationViews.values()).some(v=>v.dirty);}
  async function showAllocation(root,role){
    const term=role==='admin'?state.admin.store.term:state.teacherBoot.meta.term,key=role+'|'+term;
    let view=allocationViews.get(key);
    if(!view){
      const version=window.TIMETABLE_CONFIG?.assetVersion||'1',host=document.createElement('div');
      const [module,data]=await Promise.all([import('./allocations.js?v='+version),call('allocation',{},role)]);
      view=module.mountAllocation(host,data,{admin:role==='admin',request:(action,args={})=>call(action,args,role),loadXlsx:()=>TTAssets.load('xlsx'),print:(html,kind,paper)=>print(html,kind,paper),onSaved:reply=>{state.admin.loaded.students=false;state.admin.store.sections=reply.allocation.sections;state.admin.sectionsRevision=reply.meta.sectionsRevision;state.admin.loaded.sections=true;state.admin.loaded.links=false;state.admin.loaded.history=false;state.admin.lessonCache={};state.teacherBoot=null;state.timetable=null;useMeta(reply.meta);toast('배치표를 저장했습니다.');},onError:error=>run(()=>{throw error;})});
      view.root=host;allocationViews.set(key,view);
    }
    root.replaceChildren(view.root);if(!view.dirty&&view.revision!==state.meta.revision)await view.refresh();
  }
  function swapDirty(){return Boolean(swapViews.get("teacher")?.view.dirty);}
  function hideSwap(){swapPane.hidden=true;app.classList.remove("teacher-tools");}
  async function showSwap(role,target){
    if(!token(role))return;
    const cached=swapViews.get(role);
    if(cached){target.replaceChildren(cached.host);await cached.view.resume();return;}
    const base=new URL('class-swap/',location.href),version=window.TIMETABLE_CONFIG?.assetVersion||'1';
    const request=(action,payload)=>requestSwap(role,action,payload);
    const [module,response,initial]=await Promise.all([import(new URL('app.js?v='+version,base)),fetch(new URL('view.html?v='+version,base)),request('resume')]);
    if(!response.ok)throw Error('결보강 화면을 불러오지 못했습니다. 다시 선택해 주세요.');
    const html=await response.text(),host=document.createElement('div'),root=host.attachShadow({mode:'open'});root.innerHTML=html;
    const view=module.mountClassSwap(root,initial,{request,admin:role==='admin',cachePrefix:swapCachePrefix,selectedTeacher:()=>state.teacherName||'',print:(html,css,page)=>run(()=>printClassSwap(html,css,page),null,false)});
    swapViews.set(role,{view,host});target.replaceChildren(host);
  }
  function discardSwap(){
    for(const {view} of swapViews.values())view.destroy();swapViews.clear();swapPane.replaceChildren();hideSwap();
    for(const key of Object.keys(sessionStorage))if(key.startsWith(swapCachePrefix))sessionStorage.removeItem(key);
  }
  async function requestSwap(role,action,payload={}){
    try{const result=await TTApi.request('classSwap',{swapAction:action,swapPayload:payload,swapScope:role});if(role==='admin'&&action==='cancelPlan'&&state.admin)state.admin.reloadAfterSwap=true;if(result.teacherBootstrap){state.teacherBoot=result.teacherBootstrap;state.timetable=null;state.roster=null;useMeta(state.teacherBoot.meta);renderTeacher();}return result;}
    catch(error){if(error.code==='AUTH_REQUIRED'){rememberForms();sessionStorage.removeItem('timetable.'+role);if(role==='admin'){swapViews.get(role)?.view.destroy();swapViews.delete(role);state.admin=null;}else{state.teacherBoot=null;state.timetable=null;}if(state.route===role)renderLogin(role);}throw error;}
  }
  async function printClassSwap(html,css,page){
    const target=$('#print-root'),host=document.createElement('div'),style=document.createElement('style');
    style.textContent=page;host.attachShadow({mode:'open'}).innerHTML='<style>'+css+'</style><div id="printRoot">'+html+'</div>';
    target.className='print-root';target.replaceChildren(style,host);await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));window.print();
  }
  window.addEventListener('beforeunload',event=>{if(swapDirty()||allocationDirty()){event.preventDefault();event.returnValue='';}});

  const surfaces=[$('#header'),app,modal,swapPane],lockedControls=new Map();
  let loadingFocus=null;
  function lockControls(){surfaces.forEach(root=>root.querySelectorAll('input,select,textarea,button').forEach(el=>{if(!lockedControls.has(el))lockedControls.set(el,el.disabled);el.disabled=true;}));}
  const loadingObserver=new MutationObserver(()=>{if(busyCount)lockControls();});
  function setLoading(loading){
    document.body.dataset.loading=String(loading);
    if(loading){loadingFocus=document.activeElement;surfaces.forEach(root=>{root.inert=true;root.setAttribute('aria-busy','true');loadingObserver.observe(root,{childList:true,subtree:true});});lockControls();}
    else{loadingObserver.disconnect();lockedControls.forEach((disabled,el)=>{el.disabled=disabled;});lockedControls.clear();surfaces.forEach(root=>{root.inert=false;root.setAttribute('aria-busy','false');});const root=modal.open?modal:app;const focus=loadingFocus&&loadingFocus.isConnected&&!loadingFocus.disabled&&(!modal.open||modal.contains(loadingFocus))?loadingFocus:root.querySelector('[autofocus]:not(:disabled)')||(modal.open?root.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)'):null);loadingFocus=null;if(focus&&focus!==document.body)focus.focus({preventScroll:true});}
  }
  for(const event of ['click','submit','beforeinput','keydown','paste','drop'])document.addEventListener(event,e=>{if(busyCount&&surfaces.some(root=>root.contains(e.target))){e.preventDefault();e.stopImmediatePropagation();}},true);
  modal.addEventListener('cancel',e=>{if(busyCount)e.preventDefault();});
  function route(){const h=location.hash.match(/^#\/(home|student|teacher|admin)/);return h?h[1]:(document.body.dataset.page||'home');}
  function href(page){return '#/'+page;}
  function session(role){try{const s=JSON.parse(sessionStorage.getItem('timetable.'+role)||'null');if(s&&s.expiresAt>Date.now()&&TTApi.hasSession(role))return s;}catch(e){}sessionStorage.removeItem('timetable.'+role);return null;}
  function token(role){return (session(role)||role==='teacher'&&session('admin')||{}).token||'';}
  async function call(action,args={},role){const writes=new Set(['saveAllocation','commitImport','saveStudent','saveSection','saveOverride','saveBlock','saveBlocks','saveSettings','switchTerm','backup','restore','changePassword']);const viewTerm=role==='admin'?state.admin?.store.term:role==='teacher'?state.teacherBoot?.meta.term:undefined;return TTApi.request(action,{...(!['adminBootstrap','teacherBootstrap','login','logout'].includes(action)&&viewTerm?{viewTerm}:{}),...(writes.has(action)?{expectedTerm:state.admin?.store.term,expectedRevision:state.admin?.meta.revision}:{}),...args});}
  function toast(message){$('#toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').textContent='',5500);}
  function date(value){return value?new Date(value).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'';}
  function options(values,selected,empty){return (empty!==undefined?'<option value="">'+esc(empty)+'</option>':'')+values.map(v=>{const a=typeof v==='object'?v:{value:v,label:v};return '<option value="'+esc(a.value)+'"'+(String(a.value)===String(selected)?' selected':'')+'>'+esc(a.label)+'</option>';}).join('');}
  function field(label,id,control,wide=false){return '<div class="field'+(wide?' wide':'')+'"><label for="'+id+'">'+esc(label)+'</label>'+control+'</div>';}
  function input(id,value='',extra=''){return '<input id="'+id+'" value="'+esc(value)+'" '+extra+'>';}
  function select(id,values,selected,empty){return '<select id="'+id+'">'+options(values,selected,empty)+'</select>';}
  async function run(fn,button,block=true){if(block&&++busyCount===1)setLoading(true);try{return await fn();}catch(e){if(e.code==='TERM_CHANGED'){rememberForms();if(modal.open)modal.close();modal.innerHTML='';state.teacherBoot=null;state.admin=null;state.timetable=null;state.roster=null;await renderRoute();}if(e.code==='AUTH_REQUIRED'){rememberForms();if(modal.open)modal.close();modal.innerHTML='';state.timetable=null;state.roster=null;sessionStorage.removeItem('timetable.admin');sessionStorage.removeItem('timetable.teacher');state.teacherBoot=null;state.admin=null;renderLogin(state.route==='admin'?'admin':'teacher');}toast(e.message||'처리하지 못했습니다.');}finally{if(block){busyCount--;if(!busyCount){setLoading(false);if(state.route!==route())run(renderRoute);}}}}
  function header(){
    const settings=state.meta&&state.meta.settings||{}, school=settings.schoolName||(window.TIMETABLE_CONFIG||{}).schoolName||'개인 시간표';
    document.body.classList.toggle('workspace',['teacher','admin'].includes(state.route)&&!!token(state.route));
    document.title=(settings.title||'개인 시간표')+' · '+school;
    $('#header').innerHTML='<a class="brand" href="'+href('home')+'">'+esc(school)+'</a><div class="top-actions">'+(state.route!=='home'?'<a class="quiet" href="'+href('home')+'">처음</a>':'')+(['teacher','admin'].includes(state.route)&&token(state.route)?'<button class="quiet" data-action="logout">로그아웃</button>':'')+'</div>';
  }
  function head(title,actions=''){return '<div class="view-head"><div><h1>'+esc(title)+'</h1>'+(state.meta?'<p class="term-label">'+state.meta.settings.academicYear+'학년도 '+state.meta.settings.semester+'학기'+'</p>':'')+'</div>'+actions+'</div>';}
  function renderHome(){
    const studentIcon='<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="10" r="5"/><path d="M5 28v-3a11 11 0 0 1 22 0v3"/></svg>';
    const teacherIcon='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 5h24v17H15M20 27h8M24 22v5"/><circle cx="8" cy="20" r="4"/><path d="M1 31v-2a7 7 0 0 1 14 0v2"/></svg>';
    app.innerHTML='<div class="landing"><h1>'+esc(state.meta&&state.meta.settings.title||'개인 시간표')+'</h1><div class="entry-grid"><a class="entry" href="'+href('student')+'">'+studentIcon+'<span class="entry-title">학생<span class="arrow">↗</span></span></a><a class="entry" href="'+href('teacher')+'">'+teacherIcon+'<span class="entry-title">교사<span class="arrow">↗</span></span></a></div><div class="landing-foot"><span class="term-label">'+(state.meta?state.meta.settings.academicYear+'학년도 '+state.meta.settings.semester+'학기':'')+'</span><a class="quiet" href="'+href('admin')+'">관리자</a></div></div>';
  }
  function renderLogin(role){hideSwap();header();const title=role==='admin'?'관리자':'교사';app.innerHTML='<div class="auth"><h1>'+title+'</h1><form data-form="login" data-role="'+role+'">'+field('비밀번호','password','<input id="password" type="password" required autocomplete="current-password" autofocus>')+'<p id="login-error" class="error" role="alert"></p><button class="primary" type="submit">입장</button></form><a class="back" href="'+href('home')+'">처음으로</a></div>';}
  function timetableHTML(tt){
    const name=tt.kind==='student'?tt.studentNumber+' '+tt.name:tt.name+' 선생님';
    let body='';for(let p=1;p<=7;p++){body+='<tr><td class="period">'+p+'</td>';days.forEach(d=>{const i=tt.cells.findIndex(c=>c.day===d&&c.period===p),c=tt.cells[i]||{},has=!!c.subject;const inner='<span class="subject">'+esc(c.subject)+(c.sectionCode?'<span class="split">'+esc(c.sectionCode)+'</span>':'')+'</span>'+(c.room?'<span class="room">'+esc(c.room)+'</span>':'')+(c.teachers?.length?'<span class="teachers">'+esc(c.teachers.join(', '))+'</span>':'');body+='<td class="'+(c.isElective?'elective ':'')+(c.warning?'warning':'')+'">'+(c.roster&&has?'<button class="cell-button" data-action="cell-roster" data-cell="'+i+'" aria-label="'+esc(c.subject+' 명렬표')+'">'+inner+'</button>':inner)+'</td>';});body+='</tr>';}
    return '<div class="capture"><h2>'+esc(name)+'</h2><table class="tt"><thead><tr><th></th>'+days.map(d=>'<th>'+d+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
  }
  function resultHTML(){return state.timetable?'<div id="capture-area" class="panel">'+timetableHTML(state.timetable)+'</div><div class="result-tools"><button data-action="save-image">이미지 저장</button><button data-action="print-single">인쇄</button></div>':'';}
  function renderStudent(){app.innerHTML='<div class="lookup">'+head('학생 시간표')+'<form class="lookup-form" data-form="student">'+field('학번','student-number',input('student-number','','inputmode="numeric" pattern="[1-3][0-9]{4}" maxlength="5" autocomplete="off" required'))+'<button class="primary" type="submit">조회</button></form><div id="lookup-result">'+(state.timetable&&state.timetable.kind==='student'?resultHTML():'')+'</div></div>';}
  async function loadTeacher(force=false){
    const cached=state.teacherBoot,data=await call('teacherBootstrap',cached&&!force?{knownRevision:cached.meta.revision,sectionsRevision:cached.meta.sectionsRevision}:{},'teacher');
    if(!data.unchanged){if(state.timetable?.meta?.revision!==data.meta.revision){state.timetable=null;state.roster=null;}if(!data.sections&&cached&&cached.meta.term===data.meta.term)data.sections=cached.sections;state.teacherBoot=data;}
    if(state.teacherTab==='roster')await ensureFirstGradeCatalog();
    useMeta(state.teacherBoot.meta);renderTeacher();
  }
  function renderTeacher(){
    const boot=state.teacherBoot;if(!boot)return;
    const tabs=[['timetable','개인 시간표'],['classSwap','결보강'],['allocation','이동수업 배치표'],['roster','교과 명렬표'],['batch','학급 인쇄'],...(boot.meta.features?.studyroom?[['studyroom','스터디룸']]:[])];
    let html='<div class="lookup">'+head('교사')+'<div class="tabs">'+tabs.map(([v,l])=>'<button data-action="teacher-tab" data-tab="'+v+'" class="'+(state.teacherTab===v?'active':'')+'">'+l+'</button>').join('')+'</div>';
    if(state.teacherTab==='timetable')html+='<form class="lookup-form" data-form="teacher">'+field('교사명','teacher-name','<input id="teacher-name" list="teacher-list" value="'+esc(state.teacherName||'')+'" autocomplete="off" required><datalist id="teacher-list">'+boot.teachers.map(n=>'<option value="'+esc(n)+'"></option>').join('')+'</datalist>')+'<button class="primary" type="submit">조회</button></form><div id="lookup-result">'+(state.timetable&&state.timetable.kind==='teacher'?resultHTML():'')+'</div>';
    if(state.teacherTab==='roster')html+='<form data-form="roster" class="lookup-form">'+field('학년','roster-grade',select('roster-grade',Object.keys(boot.meta.classes),'','선택'))+field('과목','roster-subject',select('roster-subject',[],'','선택'))+field('분반','roster-section',select('roster-section',[],'','선택'))+'<button class="primary" type="submit">조회</button></form><div id="roster-result"></div>';
    if(state.teacherTab==='batch')html+='<form data-form="batch" class="lookup-form">'+field('학년','batch-grade',select('batch-grade',Object.keys(boot.meta.classes),'','선택'))+field('학급','batch-class',select('batch-class',[],'','선택'))+'<button class="primary" type="submit">일괄 인쇄</button></form>';
    if(state.teacherTab==='classSwap')html+='<div id="teacher-swap"></div>';
    if(state.teacherTab==='allocation')html+='<div id="teacher-allocation"></div>';
    if(state.teacherTab==='studyroom')html+='<div id="teacher-studyroom"></div>';
    app.innerHTML=html+'</div>';if(state.teacherTab==='classSwap'){$('#teacher-swap').append(swapPane);swapPane.hidden=false;app.classList.add('teacher-tools');run(()=>showSwap('teacher',swapPane));}else hideSwap();if(state.teacherTab==='allocation')run(()=>showAllocation($('#teacher-allocation'),'teacher'));if(state.teacherTab==='studyroom')run(()=>showStudyroom($('#teacher-studyroom'),'teacher'));
  }
  async function ensureFirstGradeCatalog(){
    const {meta}=state.teacherBoot,key=meta.revisions.schedule;
    if(meta.classes['1']&&firstGradeCatalog?.key!==key)firstGradeCatalog={key,subjects:await call('roster',{query:{kind:'firstGradeSubjects'}},'teacher')};
  }
  function setRosterOptions(grade,subject='',section=''){
    const boot=state.teacherBoot,sections=boot.sections.filter(s=>s.grade===grade);
    const catalog=grade==='1'&&firstGradeCatalog?.key===boot.meta.revisions.schedule?firstGradeCatalog.subjects:[];
    const subjects=grade==='1'?catalog.map(s=>s.subject):[...new Set(sections.map(s=>s.subject))].sort((a,b)=>a.localeCompare(b,'ko'));
    const choices=grade==='1'?(catalog.find(s=>s.subject===subject)?.classes||[]).filter(n=>boot.meta.classes['1']?.includes(n)).map(n=>({value:n,label:n+'반'})):sections.filter(s=>s.subject===subject).map(s=>({value:s.id,label:s.code}));
    $('label[for="roster-section"]').textContent=grade==='1'?'학급':'분반';
    $('#roster-subject').innerHTML=options(subjects,subject,'선택');
    $('#roster-section').innerHTML=options(choices,section,'선택');
  }
  function rosterHTML(r){let html='<table class="roster-table"><colgroup>'+Array.from({length:21},()=>'<col>').join('')+'</colgroup><thead><tr>'+['연번','학년','반','번호','이름','비고',...Array(15).fill('')].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>';r.students.forEach((s,i)=>{html+='<tr>'+[i+1,s.grade,s.classNum,s.number,s.name,s.note,...Array(15).fill('')].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>';});return html+'</tbody></table>';}
  function showRoster(r){state.roster=r;openDialog('<div class="roster-header"><h2>'+esc(r.title)+' <small>'+esc(r.detail)+' · '+r.students.length+'명</small></h2><div><button data-action="print-roster">인쇄</button><button class="modal-close" data-action="close-modal" aria-label="닫기">×</button></div></div><div class="table-scroll">'+rosterHTML(r)+'</div>',true);}
  function openDialog(html,wide=false){modal.classList.toggle('wide',wide);modal.innerHTML=html;if(!modal.open)modal.showModal();}
  function modalHead(title){return '<div class="modal-head"><h2>'+esc(title)+'</h2><button class="modal-close" data-action="close-modal" aria-label="닫기">×</button></div>';}
  function useMeta(meta){if(!meta)return;state.meta=meta;if(state.admin&&state.route==='admin'){state.admin.meta=meta;state.admin.store.settings=meta.settings;state.admin.store.term=meta.term;}header();}
  function mergeLinks(data){Object.assign(state.admin,{warnings:data.warnings,blocks:data.blocks,teachers:data.teachers});state.admin.store.overrides=data.overrides;state.admin.store.blocks=data.manualBlocks;if(data.sections){state.admin.store.sections=data.sections;state.admin.sectionsRevision=data.meta.sectionsRevision;state.admin.loaded.sections=true;}state.admin.lessonCache={};if(data.teacher)state.admin.lessonCache[data.teacher]=data.lessons;state.admin.loaded.links=true;}
  async function ensureAdminTab(tab){
    const admin=state.admin;if(!admin.loaded)admin.loaded={};if(!admin.lessonCache)admin.lessonCache={};
    if(tab==='students'&&!admin.loaded.students){const data=await call('adminBootstrap',{},'admin');admin.store.students=data.store.students;admin.loaded.students=true;useMeta(data.meta);}
    if(tab==='sections'&&!admin.loaded.sections){const data=await call('adminSections',{},'admin');admin.store.sections=data.sections;admin.sectionsRevision=data.sectionsRevision;admin.loaded.sections=true;useMeta(data.meta);}
    if(tab==='links'&&!admin.loaded.links){const data=await call('adminLinks',{},'admin');mergeLinks(data);useMeta(data.meta);}
    if(tab==='history'&&!admin.loaded.history){const data=await call('adminHistory',{},'admin');Object.assign(admin,{history:data.history,backups:data.backups,terms:data.terms});admin.loaded.history=true;useMeta(data.meta);}
  }
  async function teacherLessons(teacher){if(!teacher||state.admin.lessonCache[teacher])return;const data=await call('adminLessons',{teacher},'admin');state.admin.lessonCache[teacher]=data.lessons;useMeta(data.meta);}
  async function loadAdmin(force=false){
    const cached=state.admin,data=await call('adminBootstrap',cached&&!force?{knownRevision:cached.meta.revision}:{},'admin');
    if(data.unchanged){
      if(cached.meta.historyRevision!==data.historyRevision)cached.loaded.history=false;
      cached.meta.historyRevision=data.historyRevision;
    }else{
      if(cached&&!force&&cached.store.term===data.store.term){
        if(cached.loaded.sections&&cached.sectionsRevision===data.meta.sectionsRevision){data.store.sections=cached.store.sections;data.sectionsRevision=cached.sectionsRevision;data.loaded.sections=true;}
        if(cached.loaded.links&&cached.meta.revisions&&cached.meta.revisions.schedule===data.meta.revisions.schedule){Object.assign(data,{warnings:cached.warnings,blocks:cached.blocks,teachers:cached.teachers,lessonCache:cached.lessonCache});data.store.overrides=cached.store.overrides;data.store.blocks=cached.store.blocks;data.loaded.links=true;}
        if(cached.loaded.history&&cached.meta.historyRevision===data.meta.historyRevision){Object.assign(data,{history:cached.history,backups:cached.backups,terms:cached.terms});data.loaded.history=true;}
      }
      state.admin=data;
    }
    useMeta(state.admin.meta);await ensureAdminTab(state.adminTab);renderAdmin();
  }
  function renderAdmin(){if(!token('admin')){renderLogin('admin');return;}const tabs=[['students','학생'],['sections','선택분반'],['allocation','이동수업 배치표'],['imports','자료 등록'],['links','수업 연결'],['settings','설정'],['history','변경 이력'],['classSwap','제출된 결보강'],...(state.admin.meta.features?.studyroom?[['studyroom','스터디룸']]:[])];app.innerHTML=head('관리자',state.adminTab==='allocation'?'':'<button data-action="refresh-admin">새로고침</button>')+'<div class="admin-layout"><nav class="admin-nav" aria-label="관리 메뉴">'+tabs.map(([v,l])=>'<button data-action="admin-tab" data-tab="'+v+'" class="'+(state.adminTab===v?'active':'')+'">'+l+'</button>').join('')+'</nav><div id="admin-content" class="admin-content"></div></div>';renderAdminContent();}
  function renderAdminContent(){const root=$('#admin-content');if(!root||!state.admin)return;if(state.adminTab==='allocation')run(()=>showAllocation(root,'admin'));if(state.adminTab==='classSwap')run(()=>showSwap('admin',root));if(state.adminTab==='studyroom')run(()=>showStudyroom(root,'admin'));if(state.adminTab==='students')renderStudents(root);if(state.adminTab==='sections')renderSections(root);if(state.adminTab==='imports')renderImports(root);if(state.adminTab==='links')renderLinks(root);if(state.adminTab==='settings')renderSettings(root);if(state.adminTab==='history')renderHistory(root);}
  function renderStudents(root){const f=state.filters;root.innerHTML='<div class="filters">'+select('filter-grade',['1','2','3'],f.grade,'학년')+select('filter-class',Array.from(new Set(state.admin.store.students.filter(s=>!f.grade||s.grade===f.grade).map(s=>s.classNum))).sort((a,b)=>a-b),f.classNum,'학급')+select('filter-status',['재학','전출','자퇴','휴학','졸업'],f.status,'학적')+input('filter-search',f.search,'placeholder="이름·학번 검색" aria-label="학생 검색"')+'<button class="primary" data-action="new-student">추가</button></div><div id="student-table"></div>';renderStudentTable();}
  function renderStudentTable(){const f=state.filters,rows=state.admin.store.students.filter(s=>(!f.grade||s.grade===f.grade)&&(!f.classNum||s.classNum===f.classNum)&&(!f.status||s.status===f.status)&&(!f.search||s.name.includes(f.search)||studentNo(s).includes(f.search))).sort((a,b)=>Number(a.grade)-Number(b.grade)||Number(a.classNum)-Number(b.classNum)||Number(a.number)-Number(b.number));const max=Math.max(0,Math.ceil(rows.length/50)-1);state.page=Math.min(state.page,max);$('#student-table').innerHTML='<div class="table-scroll"><table class="data-table"><thead><tr><th>학번</th><th>이름</th><th>학적</th><th>수강</th><th>비고</th></tr></thead><tbody>'+rows.slice(state.page*50,state.page*50+50).map(s=>'<tr class="clickable" data-action="edit-student" data-id="'+esc(s.id)+'"><td>'+studentNo(s)+'</td><td>'+esc(s.name)+'</td><td>'+esc(s.status)+'</td><td>'+(s.choiceCount==null?Object.values(s.choices||{}).filter(Boolean).length:s.choiceCount)+'</td><td>'+esc(s.note)+'</td></tr>').join('')+'</tbody></table></div><div class="pager"><small>'+rows.length+'명</small><div><button class="quiet" data-action="student-page" data-delta="-1" '+(!state.page?'disabled':'')+'>이전</button><small>'+(state.page+1)+' / '+(max+1)+'</small><button class="quiet" data-action="student-page" data-delta="1" '+(state.page>=max?'disabled':'')+'>다음</button></div></div>';}
  function studentNo(s){return s.grade+String(s.classNum).padStart(2,'0')+String(s.number).padStart(2,'0');}
  async function editStudent(id){const data=await call('adminStudent',{id:id||'',sectionsRevision:state.admin.loaded.sections?state.admin.sectionsRevision:''},'admin');if(data.sections){state.admin.store.sections=data.sections;state.admin.sectionsRevision=data.sectionsRevision;state.admin.loaded.sections=true;}state.editingRevision=data.meta.revision;const s=data.student||{grade:state.filters.grade||'2',classNum:state.filters.classNum||'1',number:'',name:'',status:'재학',note:'',choices:{}};state.editingStudent=s;openDialog(modalHead(s.id?'학생 수정':'학생 추가')+'<form data-form="save-student"><div class="form-grid">'+field('학년','edit-grade',select('edit-grade',['1','2','3'],s.grade))+field('학급','edit-class',input('edit-class',s.classNum,'type="number" min="1" max="99" required'))+field('번호','edit-number',input('edit-number',s.number,'type="number" min="1" max="99" required'))+field('이름','edit-name',input('edit-name',s.name,'required maxlength="80"'))+field('학적','edit-status',select('edit-status',['재학','전출','자퇴','휴학','졸업'],s.status))+field('비고','edit-note',input('edit-note',s.note,'maxlength="500"'))+'</div><div class="choice-list" id="student-choices"></div><div class="form-footer"><button type="button" data-action="close-modal">취소</button><button class="primary">저장</button></div></form>');renderStudentChoices(s.grade,s.choices);}
  function renderStudentChoices(grade,choices){const sections=state.admin.store.sections.filter(s=>s.grade===grade),subjects=Array.from(new Set(sections.map(s=>s.subject))).sort((a,b)=>a.localeCompare(b,'ko'));$('#student-choices').innerHTML=subjects.map((name,i)=>field(name,'choice-'+i,'<select id="choice-'+i+'" data-subject="'+esc(name)+'">'+options(sections.filter(s=>s.subject===name).map(s=>s.code).sort((a,b)=>a.localeCompare(b,'ko',{numeric:true})),choices[name],'미배정')+'</select>')).join('');}
  function renderSections(root){root.innerHTML='<div class="filters">'+select('section-grade',['1','2','3'],'','학년')+input('section-search','','placeholder="과목·분반·교실 검색" aria-label="분반 검색"')+'<button class="primary" data-action="new-section">추가</button></div><div id="section-table"></div>';renderSectionTable();}
  function renderSectionTable(){const g=$('#section-grade').value,q=$('#section-search').value;const rows=state.admin.store.sections.filter(s=>(!g||s.grade===g)&&(!q||[s.subject,s.code,s.room].join(' ').includes(q)));$('#section-table').innerHTML='<div class="table-scroll"><table class="data-table"><thead><tr><th>학년</th><th>과목</th><th>분반</th><th>축약명</th><th>교실</th></tr></thead><tbody>'+rows.map(s=>'<tr class="clickable" data-action="edit-section" data-id="'+esc(s.id)+'"><td>'+s.grade+'</td><td>'+esc(s.subject)+'</td><td>'+esc(s.code)+'</td><td>'+esc(s.shortName)+'</td><td>'+esc(s.room)+'</td></tr>').join('')+'</tbody></table></div>'}
  function editSection(id){const s=state.admin.store.sections.find(x=>x.id===id)||{grade:'2',subject:'',code:'',shortName:'',room:''};state.editingSection=s;openDialog(modalHead(s.id?'분반 수정':'분반 추가')+'<form data-form="save-section"><div class="form-grid">'+field('학년','sec-grade',select('sec-grade',['1','2','3'],s.grade))+field('분반','sec-code',input('sec-code',s.code,'required maxlength="30"'))+field('과목명','sec-subject',input('sec-subject',s.subject,'required maxlength="100"'),true)+field('축약과목명','sec-short',input('sec-short',s.shortName,'maxlength="100"'))+field('교실','sec-room',input('sec-room',s.room,'maxlength="100"'))+'</div><div class="form-footer"><button type="button" data-action="close-modal">취소</button><button class="primary">저장</button></div></form>');}
  function renderImports(root){root.innerHTML='<div class="panel"><form data-form="preview-import" class="import-grid">'+field('전체교사시간표','import-teacher','<input id="import-teacher" type="file" accept=".xlsx,.csv">')+field('선택과목정보','import-elective','<input id="import-elective" type="file" accept=".xlsx,.csv">')+field('학생 배정 자료','import-students','<input id="import-students" type="file" accept=".xlsx,.csv" multiple>')+'<label class="check-label"><input id="preserve-manual" type="checkbox" checked>웹 수정값 유지</label><div><button class="primary">미리보기</button></div></form><div id="import-preview" class="import-preview"></div></div>';}
  function renderImportPreview(p){$('#import-preview').innerHTML='<div class="stat-row"><span><strong>'+p.students+'</strong>학생</span><span><strong>'+p.teachers+'</strong>교사</span><span><strong>'+p.sections+'</strong>분반</span></div><p class="muted">학생 추가 '+p.addedStudents+' · 변경 '+p.changedStudents+' · 수정값 유지 '+p.preservedFields+'</p>'+(p.errors.length?'<ul class="notice-list">'+p.errors.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>':'')+(p.warnings.length?'<ul class="notice-list">'+p.warnings.slice(0,50).map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>':'')+'<div class="form-footer"><button class="primary" data-action="commit-import" '+(p.errors.length?'disabled':'')+'>등록</button></div>';}
  function renderLinks(root){const data=state.admin;root.innerHTML='<div class="toolbar">'+select('link-teacher',data.teachers,'','확인 필요')+'<small>'+data.warnings.length+'건</small></div><div id="link-table"></div><details class="settings-section"><summary>시간블록</summary><div class="toolbar" style="margin-top:20px">'+select('block-grade',Object.keys(data.meta.classes),'','학년')+'</div><div id="block-table"></div></details>';renderLinkTable();}
  function renderLinkTable(){const teacher=$('#link-teacher').value,source=teacher?(state.admin.lessonCache[teacher]||[]):state.admin.warnings;state.visibleLinks=source;$('#link-table').innerHTML='<div class="table-scroll"><table class="data-table"><thead><tr><th>교사</th><th>교시</th><th>원본 과목</th><th>연결 분반</th><th></th></tr></thead><tbody>'+source.map((l,i)=>{const over=state.admin.store.overrides.find(o=>o.teacher===l.teacher&&o.day===l.day&&Number(o.period)===l.period);const automatic=l.sectionId?state.admin.store.sections.find(s=>s.id===l.sectionId):null;return '<tr><td>'+esc(l.teacher)+'</td><td>'+l.day+l.period+'</td><td>'+esc(l.rawSubject)+'<br><small>'+esc(l.rawRoom)+'</small></td><td><select data-link-index="'+i+'" aria-label="연결 분반">'+options(state.admin.store.sections.map(s=>({value:s.id,label:s.grade+'학년 '+s.subject+' '+s.code})),over&&over.sectionId,'자동'+(automatic?' · '+automatic.subject+' '+automatic.code:''))+'</select></td><td><button class="mini" data-action="save-link" data-index="'+i+'">저장</button></td></tr>';}).join('')+'</tbody></table></div>';}
  function renderBlocks(){const g=$('#block-grade').value;if(!g){$('#block-table').innerHTML='';return;}const allBlocks=Array.from(new Set(state.admin.store.sections.filter(s=>s.grade===g).map(s=>(s.code.match(/^[A-Za-z]+/)||[''])[0].toUpperCase()))).filter(Boolean).sort();let html='<form data-form="save-blocks"><div class="table-scroll"><table class="data-table block-grid"><thead><tr><th></th>'+days.map(d=>'<th>'+d+'</th>').join('')+'</tr></thead><tbody>';for(let p=1;p<=7;p++){html+='<tr><th>'+p+'</th>';days.forEach(d=>{const o=state.admin.store.blocks.find(o=>o.grade===g&&o.day===d&&Number(o.period)===p),auto=(state.admin.blocks[d+'-'+p]||{})[g];html+='<td><select data-block-day="'+d+'" data-block-period="'+p+'" aria-label="'+d+p+' 시간블록">'+options(allBlocks,o?o.block:'','자동'+(auto?' · '+auto:''))+'</select></td>';});html+='</tr>';}html+='</tbody></table></div><div class="form-footer"><button class="primary">저장</button></div></form>';$('#block-table').innerHTML=html;}
  function renderSettings(root){const s=state.admin.store.settings;root.innerHTML='<div class="panel"><form data-form="settings"><div class="form-grid">'+field('학교명','set-school',input('set-school',s.schoolName,'maxlength="80"'))+field('시간표 제목','set-title',input('set-title',s.title,'maxlength="100"'))+field('학년도','set-year',input('set-year',s.academicYear,'type="number" min="2020" max="2100" required'))+field('학기','set-semester',select('set-semester',['1','2'],s.semester))+'</div><div class="settings-section"><h2>요일별 교시</h2><div class="check-grid">'+days.map(d=>field(d,'period-'+d,select('period-'+d,[1,2,3,4,5,6,7],s.periods[d]))).join('')+'</div></div><div class="settings-section"><h2>창체</h2><div class="check-grid">'+days.map(d=>'<div class="check-day"><h3>'+d+'</h3>'+[1,2,3,4,5,6,7].map(p=>'<label class="check-label"><input type="checkbox" data-fixed-day="'+d+'" data-fixed-period="'+p+'" '+(s.fixedPeriods.some(f=>f.day===d&&f.period===p)?'checked':'')+'>'+p+'교시</label>').join('')+'</div>').join('')+'</div></div><div class="form-footer"><button class="primary">저장</button></div></form><div class="settings-section"><h2>비밀번호 변경</h2><div class="toolbar"><button type="button" data-action="password-dialog" data-role="teacher">교사 비밀번호 변경</button><button type="button" data-action="password-dialog" data-role="admin">관리자 비밀번호 변경</button></div></div></div>';}
  function passwordDialog(role){const title=(role==='admin'?'관리자':'교사')+' 비밀번호 변경';openDialog(modalHead(title)+'<form data-form="password" data-role="'+role+'"><div class="form-stack">'+field('현재 관리자 비밀번호','password-current',input('password-current','','type="password" required maxlength="128" autocomplete="current-password" autofocus'))+field('새 비밀번호','password-new',input('password-new','','type="password" required minlength="4" maxlength="128" autocomplete="new-password"'))+field('새 비밀번호 확인','password-confirm',input('password-confirm','','type="password" required minlength="4" maxlength="128" autocomplete="new-password"'))+'</div><div class="form-footer"><button type="button" data-action="close-modal">취소</button><button class="primary" type="submit">비밀번호 변경</button></div></form>');}
  function historyAction(v){return ({saveAllocation:'이동수업 배치표 수정',saveStudent:'학생 수정',saveSection:'분반 수정',saveOverride:'수업 연결',saveBlock:'시간블록 수정',saveBlocks:'시간블록 수정',saveSettings:'설정 수정',switchTerm:'학기 전환',commitImport:'자료 등록',backup:'백업 생성',restore:'백업 복원',changePassword:'비밀번호 변경'})[v]||v;}
  function renderHistory(root){root.innerHTML='<div class="toolbar">'+select('switch-term',state.admin.terms,state.admin.store.term)+'<button data-action="switch-term">학기 전환</button><button data-action="backup">백업 저장</button><button data-action="restore-file">백업 불러오기</button><input type="file" id="restore-file" accept=".json" hidden></div><div class="table-scroll"><table class="data-table"><thead><tr><th>일시</th><th>작업</th><th>대상</th></tr></thead><tbody>'+state.admin.history.map(h=>'<tr><td>'+date(h.at)+'</td><td>'+esc(historyAction(h.action))+'</td><td>'+esc(h.target)+'</td></tr>').join('')+'</tbody></table></div><div class="settings-section"><h2 style="margin-bottom:18px">백업</h2><div class="table-scroll"><table class="data-table"><thead><tr><th>일시</th><th>이름</th><th></th></tr></thead><tbody>'+state.admin.backups.filter(b=>b.term===state.admin.store.term).map(b=>'<tr><td>'+date(b.at)+'</td><td>'+esc(b.label)+'</td><td><button class="mini" data-action="download-backup" data-id="'+esc(b.id)+'">다운로드</button> <button class="mini" data-action="restore-backup" data-id="'+esc(b.id)+'">복원</button></td></tr>').join('')+'</tbody></table></div></div>';}
  async function renderRoute(){hideSwap();state.route=route();header();if(state.route==='home')renderHome();if(state.route==='student')renderStudent();if(state.route==='teacher'){if(!token('teacher'))renderLogin('teacher');else await loadTeacher();}if(state.route==='admin'){if(!token('admin'))renderLogin('admin');else await loadAdmin();}}
  function download(blob,name){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;link.hidden=true;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  async function print(html,kind,paper='A3'){
    const target=$('#print-root');target.className='print-root print-'+kind;target.innerHTML=html;
    await document.fonts.load('600 12px "Pretendard Variable"',target.textContent).catch(()=>{});await document.fonts.ready;
    let pageStyle;
    try{
      if(kind==='allocation'){
        const size=paper==='A4'?{paper:'A4',width:285,height:198}:{paper:'A3',width:408,height:285},sheet=target.querySelector('.allocation-print');
        pageStyle=document.createElement('style');pageStyle.textContent='@page{size:'+size.paper+' landscape;margin:6mm}';document.head.append(pageStyle);
        target.classList.add('allocation-measure');
        const pxPerMm=sheet.getBoundingClientRect().width/408,maxWidth=size.width*pxPerMm,maxHeight=(size.height-2)*pxPerMm;let scale=1;
        // Scaled fonts can wrap differently; remeasure the fitted rows before printing.
        for(let pass=0;pass<4;pass++){
          const rect=sheet.getBoundingClientRect(),ratio=Math.min(1,maxWidth/Math.max(rect.width,sheet.scrollWidth*scale),maxHeight/Math.max(rect.height,sheet.scrollHeight*scale));
          if(ratio>=1)break;scale*=ratio;sheet.style.zoom=String(scale);
        }
        target.classList.remove('allocation-measure');
      }
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.print();
    }finally{target.classList.remove('allocation-measure');pageStyle?.remove();}
  }
  async function mutation(action,args){
    const teacher=$('#link-teacher')&&$('#link-teacher').value,grade=$('#block-grade')&&$('#block-grade').value,blocksOpen=$('#block-grade')&&$('#block-grade').closest('details').open;
    const reply=await call(action,Object.assign({expectedRevision:action==='saveStudent'?state.editingRevision:state.admin.meta.revision,patch:true,viewTeacher:teacher||''},args),'admin');
    if(action==='saveStudent')forgetDraft('save-student');if(action==='saveSection')forgetDraft('save-section');if(action==='saveSettings')forgetDraft('settings');if(action==='commitImport')forgetDraft('preview-import');
    state.teacherBoot=null;state.timetable=null;
    if(reply.bootstrap)state.admin=reply.bootstrap;
    else {
      if(reply.students)reply.students.forEach(student=>{const index=state.admin.store.students.findIndex(s=>s.id===student.id);if(index<0)state.admin.store.students.push(student);else state.admin.store.students[index]=student;});
      if(reply.section){state.admin.sectionsRevision=reply.meta.sectionsRevision;const index=state.admin.store.sections.findIndex(s=>s.id===reply.section.id);if(index<0)state.admin.store.sections.push(reply.section);else state.admin.store.sections[index]=reply.section;state.admin.loaded.links=false;state.admin.lessonCache={};}
      if(reply.links)mergeLinks(reply.links);
      state.admin.loaded.history=false;
    }
    useMeta(reply.meta);await ensureAdminTab(state.adminTab);renderAdmin();
    if(state.adminTab==='links'&&teacher){$('#link-teacher').value=teacher;renderLinkTable();}
    if(state.adminTab==='links'&&grade){$('#block-grade').value=grade;$('#block-grade').closest('details').open=!!blocksOpen;renderBlocks();}
    return reply.result;
  }
  document.addEventListener('submit',e=>{const form=e.target.closest('form[data-form]');if(!form)return;e.preventDefault();const button=e.submitter||form.querySelector('button[type=submit],button.primary');run(async()=>{
    switch(form.dataset.form){
      case 'login':{const role=form.dataset.role;try{const result=await call('login',{role,password:$('#password').value,initialize:true});sessionStorage.setItem('timetable.'+role,JSON.stringify({token:result.token,role:result.role,expiresAt:result.expiresAt}));if(role==='admin'){state.admin=result.initial;useMeta(state.admin.meta);await ensureAdminTab(state.adminTab);renderAdmin();}else{state.teacherBoot=result.initial;useMeta(state.teacherBoot.meta);if(state.teacherTab==='roster')await ensureFirstGradeCatalog();renderTeacher();}}catch(err){if($('#login-error'))$('#login-error').textContent=err.message;throw err;}break;}
      case 'student':state.timetable=await call('student',{studentNumber:$('#student-number').value.trim()});useMeta(state.timetable.meta);$('#lookup-result').innerHTML=resultHTML();break;
      case 'teacher':state.teacherName=$('#teacher-name').value.trim();state.timetable=await call('teacher',{teacher:state.teacherName},'teacher');useMeta(state.timetable.meta);$('#lookup-result').innerHTML=resultHTML();break;
      case 'roster':{const section=$('#roster-section').value,firstGrade=$('#roster-grade').value==='1';if(!section)throw Error('학년·과목·'+(firstGrade?'학급':'분반')+'을 선택하세요.');const query=firstGrade?{kind:'firstGrade',subject:$('#roster-subject').value,classNum:section}:{kind:'elective',sectionId:section};showRoster(await call('roster',{query},'teacher'));break;}
      case 'batch':{const grade=$('#batch-grade').value,classNum=$('#batch-class').value;if(!grade||!classNum)throw Error('학년과 학급을 선택하세요.');const r=await call('classBatch',{grade,classNum},'teacher');if(!r.timetables.length)throw Error('해당 학급에 학생이 없습니다.');let html='';for(let i=0;i<r.timetables.length;i+=4)html+='<div class="batch-page">'+r.timetables.slice(i,i+4).map(t=>'<div class="batch-item">'+timetableHTML(t)+'</div>').join('')+'</div>';await print(html,'batch');break;}
      case 'save-student':{const old=state.editingStudent,choices=Object.assign({},old.choices);$('#student-choices').querySelectorAll('select').forEach(el=>choices[el.dataset.subject]=el.value);await mutation('saveStudent',{student:Object.assign({},old,{grade:$('#edit-grade').value,classNum:$('#edit-class').value,number:$('#edit-number').value,name:$('#edit-name').value,status:$('#edit-status').value,note:$('#edit-note').value,choices})});modal.close();toast('저장했습니다.');break;}
      case 'save-section':await mutation('saveSection',{section:Object.assign({},state.editingSection,{grade:$('#sec-grade').value,subject:$('#sec-subject').value,code:$('#sec-code').value,shortName:$('#sec-short').value,room:$('#sec-room').value})});modal.close();toast('저장했습니다.');break;
      case 'preview-import':{const version=window.TIMETABLE_CONFIG?.assetVersion||'1';await Promise.all([TTAssets.load('xlsx'),import('./import.js?v='+version)]);const loaded=await TTImport.files($('#import-teacher').files[0],$('#import-elective').files[0],$('#import-students').files);state.importPayload=loaded.payload;state.preserveManual=$('#preserve-manual').checked;state.importPreview=await call('previewImport',{payload:loaded.payload,preserveManual:state.preserveManual},'admin');state.importPreview.warnings.push(...loaded.warnings);renderImportPreview(state.importPreview);break;}
      case 'settings':{const settings={schoolName:$('#set-school').value,title:$('#set-title').value,academicYear:Number($('#set-year').value),semester:Number($('#set-semester').value),periods:{},fixedPeriods:[]};days.forEach(d=>settings.periods[d]=Number($('#period-'+d).value));document.querySelectorAll('[data-fixed-day]:checked').forEach(el=>settings.fixedPeriods.push({day:el.dataset.fixedDay,period:Number(el.dataset.fixedPeriod),label:'창체'}));await mutation('saveSettings',{settings});toast('저장했습니다.');break;}
      case 'password':{const role=form.dataset.role;if($('#password-new').value!==$('#password-confirm').value)throw Error('새 비밀번호 확인이 다릅니다.');await call('changePassword',{role,currentPassword:$('#password-current').value,newPassword:$('#password-new').value},'admin');modal.close();modal.innerHTML='';sessionStorage.removeItem('timetable.'+role);state.admin.loaded.history=false;state.teacherBoot=null;if(role==='admin')await renderRoute();else renderSettings($('#admin-content'));toast('비밀번호를 변경했습니다.');break;}
      case 'save-blocks':{const grade=$('#block-grade').value,blocks=[];document.querySelectorAll('[data-block-day]').forEach(el=>{if(el.value)blocks.push({grade,day:el.dataset.blockDay,period:Number(el.dataset.blockPeriod),block:el.value});});await mutation('saveBlocks',{grade,blocks});toast('저장했습니다.');break;}
    }
  },button);});
  document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el||el.disabled)return;const action=el.dataset.action;e.preventDefault();run(async()=>{
    switch(action){
      case 'close-modal':modal.close();break;
      case 'password-dialog':passwordDialog(el.dataset.role);break;
      case 'logout':{const savedDrafts=Object.keys(sessionStorage).some(key=>key.startsWith(swapCachePrefix));if((savedDrafts||swapDirty()||allocationDirty())&&!confirm(savedDrafts?'이 탭의 결보강 임시저장본과 작성 중인 내용을 지우고 로그아웃할까요?':'저장하지 않은 내용을 버리고 로그아웃할까요?'))return;allocationViews.forEach(v=>v.destroy());allocationViews.clear();studyroomViews.forEach(v=>v.dispose());studyroomViews.clear();const role=state.route==='admin'?'admin':'teacher';await call('logout',{},role);discardSwap();forgetDraft();state.timetable=null;state.roster=null;state.editingStudent=null;state.editingSection=null;if(modal.open)modal.close();modal.innerHTML='';sessionStorage.removeItem('timetable.admin');sessionStorage.removeItem('timetable.teacher');if(role==='teacher'&&session('admin'))sessionStorage.removeItem('timetable.admin');state.teacherBoot=null;state.admin=null;state.adminTab='students';await renderRoute();break;}
      case 'teacher-tab':if(el.dataset.tab==='roster')await ensureFirstGradeCatalog();state.teacherTab=el.dataset.tab;renderTeacher();break;
      case 'admin-tab':state.adminTab=el.dataset.tab;if(state.admin.reloadAfterSwap){await loadAdmin();delete state.admin.reloadAfterSwap;}else{await ensureAdminTab(state.adminTab);renderAdmin();}break;
      case 'refresh-admin':await loadAdmin(true);toast('새로고침했습니다.');break;
      case 'new-student':await editStudent();break;
      case 'edit-student':await editStudent(el.dataset.id);break;
      case 'student-page':state.page+=Number(el.dataset.delta);renderStudentTable();break;
      case 'new-section':editSection();break;
      case 'edit-section':editSection(el.dataset.id);break;
      case 'commit-import':if(!state.importPayload||!state.importPreview)throw Error('미리보기를 먼저 실행하세요.');await mutation('commitImport',{payload:state.importPayload,preserveManual:state.preserveManual,expectedRevision:state.importPreview.revision});state.importPayload=null;state.importPreview=null;toast('등록했습니다.');break;
      case 'cell-roster':{const c=state.timetable.cells[Number(el.dataset.cell)],q=c&&c.roster;if(!q)break;if(q.kind==='choose'){const secs=state.teacherBoot.sections.filter(s=>q.sectionIds.includes(s.id));openDialog(modalHead('학년·분반 선택')+'<div class="form-stack">'+secs.map(s=>'<button data-action="chosen-roster" data-id="'+esc(s.id)+'">'+esc(s.grade+'학년 '+s.subject+' '+s.code)+'</button>').join('')+'</div>');}else showRoster(await call('roster',{query:q},'teacher'));break;}
      case 'chosen-roster':showRoster(await call('roster',{query:{kind:'elective',sectionId:el.dataset.id}},'teacher'));break;
      case 'print-roster':await print('<h2>'+esc(state.roster.title)+' '+esc(state.roster.detail)+'</h2>'+rosterHTML(state.roster),'roster');break;
      case 'print-single':await print(timetableHTML(state.timetable),'single');break;
      case 'save-image':{await Promise.all([TTAssets.load('image'),document.fonts.ready]);const canvas=await html2canvas($('#capture-area'),{scale:3,backgroundColor:'#ffffff',logging:false});const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('이미지를 저장하지 못했습니다.');download(blob,(state.timetable.studentNumber||state.timetable.name)+'_시간표.png');break;}
      case 'save-link':{const l=state.visibleLinks[Number(el.dataset.index)],chosen=document.querySelector('[data-link-index="'+el.dataset.index+'"]').value;await mutation('saveOverride',{override:{teacher:l.teacher,day:l.day,period:l.period,sectionId:chosen}});toast('저장했습니다.');break;}
      case 'backup':{const r=await call('backup',{expectedRevision:state.admin.meta.revision,patch:true},'admin');download(new Blob([JSON.stringify(r.result.backup,null,2)],{type:'application/json'}),'시간표_백업_'+state.admin.store.term+'.json');state.admin.backups=r.backups;renderHistory($('#admin-content'));toast('백업을 저장했습니다.');break;}
      case 'restore-file':$('#restore-file').click();break;
      case 'download-backup':{const backup=await call('downloadBackup',{backupId:el.dataset.id},'admin');download(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),'시간표_백업_'+backup.store.term+'.json');break;}
      case 'restore-backup':if(confirm('현재 학기의 자료를 이 백업으로 복원하시겠습니까?')){await mutation('restore',{backupId:el.dataset.id});toast('복원했습니다.');}break;
      case 'switch-term':await mutation('switchTerm',{term:$('#switch-term').value});toast('학기를 전환했습니다.');break;
    }
  },el.tagName==='BUTTON'?el:null,!['close-modal','password-dialog','teacher-tab','student-page','new-section','edit-section','restore-file'].includes(action));});
  document.addEventListener('change',e=>{const el=e.target;run(async()=>{
    if(['filter-grade','filter-class','filter-status'].includes(el.id)){const k={'filter-grade':'grade','filter-class':'classNum','filter-status':'status'}[el.id];state.filters[k]=el.value;state.page=0;if(k==='grade'){state.filters.classNum='';renderStudents($('#admin-content'));}else renderStudentTable();}
    if(el.id==='section-grade')renderSectionTable();
    if(el.id==='edit-grade'){const choices={};$('#student-choices').querySelectorAll('select').forEach(s=>choices[s.dataset.subject]=s.value);renderStudentChoices(el.value,choices);}
    if(el.id==='roster-grade')setRosterOptions(el.value);
    if(el.id==='roster-subject')setRosterOptions($('#roster-grade').value,el.value);
    if(el.id==='batch-grade')$('#batch-class').innerHTML=options(state.teacherBoot.meta.classes[el.value]||[],'','선택');
    if(el.id==='link-teacher'){await teacherLessons(el.value);renderLinkTable();}
    if(el.id==='block-grade')renderBlocks();
    if(el.id==='restore-file'&&el.files[0]){const file=el.files[0];if(file.size>10*1024*1024)throw Error('백업 파일 크기를 확인하세요.');const backup=JSON.parse(await file.text());if(backup.format!=='school-timetable-backup')throw Error('백업 파일 형식이 다릅니다.');if(confirm('선택한 백업으로 현재 학기의 자료를 복원하시겠습니까?')){await mutation('restore',{backup});toast('복원했습니다.');}}
  },null,['restore-file','link-teacher'].includes(el.id));});
  document.addEventListener('input',e=>{if(e.target.id==='filter-search'){state.filters.search=e.target.value;state.page=0;renderStudentTable();}if(e.target.id==='section-search')renderSectionTable();});
  window.addEventListener('hashchange',()=>{if(!busyCount)run(renderRoute);});
  window.addEventListener('afterprint',()=>{$('#print-root').innerHTML='';});
  async function start(){state.route=route();header();if(state.route==='home')renderHome();else if(state.route==='student')renderStudent();else renderLogin(state.route);if(!(['teacher','admin'].includes(state.route)&&token(state.route))){try{state.meta=await call('bootstrap');}catch(e){toast(e.message);}}await renderRoute();}
  renderStudent=withDrafts(renderStudent);renderTeacher=withDrafts(renderTeacher);renderAdmin=withDrafts(renderAdmin);renderSettings=withDrafts(renderSettings);renderImports=withDrafts(renderImports);renderSections=withDrafts(renderSections);renderStudents=withDrafts(renderStudents);renderLogin=withDrafts(renderLogin);openDialog=withDrafts(openDialog);
  run(start);
})();
