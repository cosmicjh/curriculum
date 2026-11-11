(function(){
  'use strict';
  const $=s=>document.querySelector(s), esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const days=['월','화','수','목','금'],roles={student:'학생',teacher:'교사',admin:'관리자'};
  const state={meta:null,teacherBoot:null,timetable:null,roster:null,admin:null,adminTab:'sectionAssignment',teacherTab:'timetable',page:0,filters:{grade:'',classNum:'',status:'',search:''},importPayload:null,importPreview:null,route:'home'};
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
  const coursePane=document.createElement('section'),courseFrames=new Map();
  coursePane.id='course-pane';coursePane.hidden=true;app.after(coursePane);
  const sectionPane=document.createElement('section');sectionPane.id='section-assignment-pane';sectionPane.hidden=true;app.after(sectionPane);
  let sectionFrame=null;
  function showSectionAssignment(){
    if(!sectionFrame){
      sectionFrame=document.createElement('iframe');sectionFrame.title='분반배정';
      sectionFrame.src='./section-assignment/view.html?v='+encodeURIComponent(window.TIMETABLE_CONFIG?.assetVersion||'1');
      sectionPane.append(sectionFrame);
    }
    sectionPane.hidden=false;document.body.classList.add('section-assignment-workspace');
  }
  window.sectionAssignmentConnect=source=>{
    if(sectionFrame?.contentWindow!==source||state.route!=='admin'||!token('admin'))return null;
    return {
      resize:height=>{if(sectionFrame?.contentWindow===source&&Number.isFinite(height))sectionFrame.style.height=Math.ceil(height)+'px';},
      loadXlsx:()=>TTAssets.load('xlsx'),
      importHours:data=>run(()=>openAssignmentHours(source,data)),
      loadCourseSections:()=>loadAssignmentSectionCounts(source),
      previewStudents:data=>run(()=>previewAssignedStudents(source,data))
    };
  };
  function requireSectionAssignment(source){
    if(sectionFrame?.contentWindow!==source||state.route!=='admin'||state.adminTab!=='sectionAssignment'||!token('admin'))throw Error('관리자 메뉴에서 분반배정을 열어 주세요.');
  }
  async function openAssignmentHours(source,data){
    requireSectionAssignment(source);
    const saved=await call('stageToolTransfer',{term:state.admin.store.term,kind:'hours',data},'admin');
    toast(saved.term+' 학기에 시수배당 자료를 전달했습니다.');
    state.adminTab='hours';renderAdmin();
    const frame=courseFrames.get('admin');
    const open=()=>run(async()=>{
      if(state.route!=='admin'||state.adminTab!=='hours'||courseFrames.get('admin')!==frame)return;
      const receive=frame.contentWindow?.openSectionAssignmentHours;
      if(receive)await receive(saved.term,saved.id);
    },null,false);
    if(frame.contentWindow?.openSectionAssignmentHours)await open();
    else frame.addEventListener('load',open,{once:true});
  }
  async function loadAssignmentSectionCounts(source){
    requireSectionAssignment(source);
    const rows=await call('courseTransfer',{summary:'counts'},'admin');
    if(!rows.length)throw Error('현재 학기에 전달된 시수배당 확정 분반이 없습니다.');
    return rows;
  }
  async function previewAssignedStudents(source,students){
    requireSectionAssignment(source);
    const saved=await call('stageToolTransfer',{term:state.admin.store.term,kind:'students',data:students},'admin');
    await previewServerTransfer(saved);
  }
  async function previewServerTransfer(saved,kind=saved?.kind||'students'){
    const title=kind==='course'?'시수배당 전달 자료':'학생 배정 미리보기';
    if(!saved){openDialog(modalHead(title)+'<p>현재 학기에 전달된 자료가 없습니다.</p>');return;}
    const transferRef={kind,id:saved.id};
    const preview=await call('previewImport',{transferRef},'admin');
    state.importPayload=null;state.importRef=transferRef;state.importPreview=preview;state.preserveManual=true;
    const summary=kind==='course'?'분반 '+saved.count+'개':'배정 대상 '+saved.count+'명';
    openDialog(modalHead(title+' · '+saved.term)+'<p>'+summary+' · '+esc(date(saved.savedAt))+' 전달</p><div id="import-preview" data-assignment-preview class="import-preview"></div>',true);
    renderImportPreview(preview);
  }
  function courseNotice(message){openDialog(modalHead('시수배당표')+'<p>'+esc(message)+'</p><div class="form-footer"><button data-action="close-modal">확인</button></div>');}
  function hideCourse(){coursePane.hidden=true;document.body.classList.remove('course-workspace');}
  function showCourse(role){
    let frame=courseFrames.get(role);
    if(!frame){
      frame=document.createElement('iframe');
      frame.title='시수배당표';frame.hidden=true;
      frame.src='./course-allocation/view.html?v='+encodeURIComponent(window.TIMETABLE_CONFIG?.assetVersion||'1');
      courseFrames.set(role,frame);coursePane.append(frame);
    }
    for(const item of courseFrames.values())item.hidden=item!==frame;
    coursePane.hidden=false;document.body.classList.add('course-workspace');
  }
  window.courseAllocationRequest=async(source,path,method,data)=>{
    const role=[...courseFrames].find(([,frame])=>frame.contentWindow===source)?.[0];
    if(!role||!token(role))throw Error('교육과정 편성·운영 지원 도구에 다시 로그인하세요.');
    try{
      const result=await TTApi.request('courseWorkspace',{role,path,method,data});
      if(path==='/timetable-transfer'&&state.admin?.loaded)state.admin.loaded.settings=false;
      return result;
    }catch(error){
      if(state.route===role&&error.code==='AUTH_REQUIRED')await run(()=>{throw error;},null,false);
      if(state.route==='teacher'&&role==='teacher'&&state.teacherTab==='hours'&&error.code==='COURSE_CLOSED'){
        state.teacherTab='timetable';renderTeacher();courseNotice(error.message);
      }
      throw error;
    }
  };
  const swapCachePrefix="timetable.swap-drafts.";
  let classCatalog=null;
  const allocationViews=new Map();
  const studyroomViews=new Map();
  async function showStudyroom(root,role){
    let view=studyroomViews.get(role);
    if(!view){const version=window.TIMETABLE_CONFIG?.assetVersion||'1',module=await import('./studyroom.js?v='+version),host=document.createElement('div');
      view=module.mountStudyroom(host,{admin:role==='admin',request:async(action,args)=>{try{return await call(action,args,role);}catch(error){if(error.code==='TERM_CHANGED')run(()=>{throw error;});if(error.code==='AUTH_REQUIRED'){view.dispose();studyroomViews.delete(role);state.teacherBoot=null;state.admin=null;renderLogin(role);}throw error;}}});studyroomViews.set(role,view);
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
      view=module.mountAllocation(host,data,{admin:role==='admin',request:(action,args={})=>call(action,args,role),loadXlsx:()=>TTAssets.load('xlsx'),print:(html,kind,paper)=>print(html,kind,paper),onSaved:reply=>{state.admin.loaded.students=false;state.admin.store.sections=reply.allocation.sections;state.admin.sectionsRevision=reply.meta.sectionsRevision;state.admin.loaded.sections=true;state.admin.loaded.links=false;state.admin.loaded.settings=false;state.admin.lessonCache={};state.teacherBoot=null;state.timetable=null;useMeta(reply.meta);toast('배치표를 저장했습니다.');},onError:error=>run(()=>{throw error;})});
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
  window.addEventListener('beforeunload',event=>{if(swapDirty()||allocationDirty()||sectionFrame?.contentWindow?.hasSectionAssignmentWork?.()||[...courseFrames.values()].some(frame=>frame.contentWindow?.hasUnsavedCourseChanges?.())){event.preventDefault();event.returnValue='';}});

  const surfaces=[$('#header'),app,modal,swapPane,coursePane,sectionPane,TTNavigation.menu],lockedControls=new Map();
  let loadingFocus=null;
  function lockControls(){surfaces.forEach(root=>root.querySelectorAll('input,select,textarea,button').forEach(el=>{if(!lockedControls.has(el))lockedControls.set(el,el.disabled);el.disabled=true;}));}
  const loadingObserver=new MutationObserver(()=>{if(busyCount)lockControls();});
  function setLoading(loading){
    TTNavigation.setBusy(loading);
    document.body.dataset.loading=String(loading);
    if(loading){loadingFocus=document.activeElement;surfaces.forEach(root=>{root.inert=true;root.setAttribute('aria-busy','true');loadingObserver.observe(root,{childList:true,subtree:true});});lockControls();}
    else{loadingObserver.disconnect();lockedControls.forEach((disabled,el)=>{el.disabled=disabled;});lockedControls.clear();surfaces.forEach(root=>{root.inert=false;root.setAttribute('aria-busy','false');});const root=modal.open?modal:app;const focus=loadingFocus&&loadingFocus.isConnected&&!loadingFocus.disabled&&(!modal.open||modal.contains(loadingFocus))?loadingFocus:root.querySelector('[autofocus]:not(:disabled)')||(modal.open?root.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)'):null);loadingFocus=null;if(focus&&focus!==document.body)focus.focus({preventScroll:true});}
  }
  for(const event of ['click','submit','beforeinput','keydown','paste','drop'])document.addEventListener(event,e=>{if(busyCount&&surfaces.some(root=>root.contains(e.target))){e.preventDefault();e.stopImmediatePropagation();}},true);
  modal.addEventListener('cancel',e=>{if(busyCount)e.preventDefault();});
  function route(){const h=location.hash.match(/^#\/(home|student|teacher|admin)/);return h?h[1]:(document.body.dataset.page||'home');}
  function href(page){return '#/'+page;}
  function session(role){try{const s=JSON.parse(sessionStorage.getItem('timetable.'+role)||'null');if(s&&s.expiresAt>Date.now()&&TTApi.hasSession(role))return s;}catch(e){}sessionStorage.removeItem('timetable.'+role);return null;}
  function clearSessions(){for(const role of Object.keys(roles))sessionStorage.removeItem('timetable.'+role);}
  function token(role){return (session(role)||role==='teacher'&&session('admin')||{}).token||'';}
  async function call(action,args={},role){const writes=new Set(['saveAllocation','commitImport','saveStudent','saveSection','saveOverride','saveBlock','saveBlocks','saveSettings','switchTerm','createTerm','stageToolTransfer','backup','restore','changePassword']);const viewTerm=role==='admin'?state.admin?.store.term:role==='teacher'?state.teacherBoot?.meta.term:undefined;return TTApi.request(action,{...(!['adminBootstrap','teacherBootstrap','login','logout'].includes(action)&&viewTerm?{viewTerm}:{}),...(writes.has(action)?{expectedTerm:state.admin?.store.term,expectedRevision:state.admin?.meta.revision}:{}),...args});}
  function toast(message){$('#toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').textContent='',5500);}
  function date(value){return value?new Date(value).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'';}
  function options(values,selected,empty){return (empty!==undefined?'<option value="">'+esc(empty)+'</option>':'')+values.map(v=>{const a=typeof v==='object'?v:{value:v,label:v};return '<option value="'+esc(a.value)+'"'+(String(a.value)===String(selected)?' selected':'')+'>'+esc(a.label)+'</option>';}).join('');}
  function field(label,id,control,wide=false){return '<div class="field'+(wide?' wide':'')+'"><label for="'+id+'">'+esc(label)+'</label>'+control+'</div>';}
  function input(id,value='',extra=''){return '<input id="'+id+'" value="'+esc(value)+'" '+extra+'>';}
  function select(id,values,selected,empty){return '<select id="'+id+'">'+options(values,selected,empty)+'</select>';}
  async function run(fn,button,block=true){if(block&&++busyCount===1)setLoading(true);try{return await fn();}catch(e){if(e.code==='TERM_CHANGED'){rememberForms();if(modal.open)modal.close();modal.innerHTML='';state.teacherBoot=null;state.admin=null;state.timetable=null;state.roster=null;await renderRoute();}if(e.code==='AUTH_REQUIRED'){rememberForms();if(modal.open)modal.close();modal.innerHTML='';state.timetable=null;state.roster=null;clearSessions();sectionPane.replaceChildren();sectionFrame=null;coursePane.replaceChildren();courseFrames.clear();state.teacherBoot=null;state.admin=null;renderLogin(roles[state.route]?state.route:'');}toast(e.message||'처리하지 못했습니다.');}finally{if(block){busyCount--;if(!busyCount){setLoading(false);if(state.route!==route())run(renderRoute);}}}}
  function header(){
    const settings=state.meta&&state.meta.settings||{}, school=settings.schoolName||(window.TIMETABLE_CONFIG||{}).schoolName||'개인 시간표';
    document.title=TTNavigation.title;
    const term=state.meta?'<span class="term-label">'+esc(settings.academicYear+'학년도 '+settings.semester+'학기')+'</span>':'';
    $('#header').innerHTML=TTNavigation.opener()+'<div class="school-heading"><a class="brand" href="'+href('home')+'"><span class="school-name">'+esc(school)+'</span><span class="compact-program-title">'+TTNavigation.title+'</span></a>'+term+'</div><div class="top-actions">'+(state.route!=='home'?'<a class="quiet" href="'+href('home')+'">처음</a>':'')+(roles[state.route]&&token(state.route)?'<button class="quiet" data-action="logout">로그아웃</button>':'')+'</div>';TTNavigation.sync();
  }
  function head(title,actions=''){return '<div class="view-head"><div>'+(title?'<h1>'+esc(title)+'</h1>':'')+'</div>'+actions+'</div>';}
  function showScreen(html,workspace=false){hideCourse();sectionPane.hidden=true;document.body.classList.remove('section-assignment-workspace');app.innerHTML=html;document.body.classList.toggle('workspace',workspace);}
  function renderLogin(role=''){
    TTNavigation.render([],'','');
    hideSwap();header();
    const choices=Object.entries(roles).map(([value,label])=>({value,label}));
    showScreen('<div class="auth"><h1>로그인</h1><form data-form="login">'+
      field('사용자 유형','login-role','<select id="login-role" required'+(!role?' autofocus':'')+'>'+options(choices,role,'선택하세요')+'</select>')+
      field('비밀번호','password','<input id="password" type="password" required maxlength="128" autocomplete="current-password"'+(role?' autofocus':'')+'>')+
      '<p id="login-error" class="error" role="alert" hidden></p><button class="primary" type="submit">로그인</button></form></div>');
    if(role)TTApi.prepareLogin(role).catch(()=>{});
  }
  function timetableHTML(tt){
    const name=tt.kind==='student'?tt.studentNumber+' '+tt.name:tt.name+' 선생님';
    let body='';for(let p=1;p<=7;p++){body+='<tr><td class="period">'+p+'</td>';days.forEach(d=>{const i=tt.cells.findIndex(c=>c.day===d&&c.period===p),c=tt.cells[i]||{},has=!!c.subject;const inner='<span class="subject">'+esc(c.subject)+(c.sectionCode?'<span class="split">'+esc(c.sectionCode)+'</span>':'')+'</span>'+(c.room?'<span class="room">'+esc(c.room)+'</span>':'')+(c.teachers?.length?'<span class="teachers">'+esc(c.teachers.join(', '))+'</span>':'');body+='<td class="'+(c.isElective?'elective ':'')+(c.warning?'warning':'')+'">'+(c.roster&&has?'<button class="cell-button tt-slot" data-action="cell-roster" data-cell="'+i+'" aria-label="'+esc(c.subject+' 명렬표')+'">'+inner+'</button>':has?'<span class="tt-slot">'+inner+'</span>':inner)+'</td>';});body+='</tr>';}
    return '<div class="capture"><h2>'+esc(name)+'</h2><table class="tt"><thead><tr><th></th>'+days.map(d=>'<th>'+d+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
  }
  function resultHTML(){return state.timetable?'<div id="capture-area" class="panel">'+timetableHTML(state.timetable)+'</div><div class="result-tools"><button data-action="save-image">이미지 저장</button><button data-action="print-single">인쇄</button></div>':'';}
  function renderStudent(){TTNavigation.render([],'','');showScreen('<div class="lookup">'+head('학생 시간표')+'<form class="lookup-form" data-form="student">'+field('학번','student-number',input('student-number','','inputmode="numeric" pattern="[1-3][0-9]{4}" maxlength="5" autocomplete="off" required'))+'<button class="primary" type="submit">조회</button></form><div id="lookup-result">'+(state.timetable&&state.timetable.kind==='student'?resultHTML():'')+'</div></div>');}
  async function loadTeacher(force=false){
    const cached=state.teacherBoot,data=await call('teacherBootstrap',cached&&!force?{knownRevision:cached.meta.revision,sectionsRevision:cached.meta.sectionsRevision}:{},'teacher');
    if(!data.unchanged){if(state.timetable?.meta?.revision!==data.meta.revision){state.timetable=null;state.roster=null;}if(!data.sections&&cached&&cached.meta.term===data.meta.term)data.sections=cached.sections;state.teacherBoot=data;}
    if(state.teacherTab==='roster')await ensureClassCatalog();
    useMeta(state.teacherBoot.meta);renderTeacher();
  }
  function renderTeacher(){
    const boot=state.teacherBoot;if(!boot)return;
    if(state.teacherTab==='hours'&&!boot.meta.settings.courseAllocationTeachers)state.teacherTab='timetable';
    const tabs=[['timetable','개인시간표'],['roster','교과 명렬표'],['allocation','이동수업 배치표'],['classSwap','결보강'],['batch','학급별 시간표 인쇄'],['hours','시수배당표'],...(boot.meta.features?.studyroom?[['studyroom','스터디룸']]:[])];
    TTNavigation.render(tabs,'teacher',state.teacherTab);
    let html='<div class="lookup">';
    if(state.teacherTab==='timetable')html+='<form class="lookup-form" data-form="teacher">'+field('교사명','teacher-name','<input id="teacher-name" list="teacher-list" value="'+esc(state.teacherName||'')+'" autocomplete="off" required><datalist id="teacher-list">'+boot.teachers.map(n=>'<option value="'+esc(n)+'"></option>').join('')+'</datalist>')+'<button class="primary" type="submit">조회</button></form><div id="lookup-result">'+(state.timetable&&state.timetable.kind==='teacher'?resultHTML():'')+'</div>';
    if(state.teacherTab==='roster')html+='<form data-form="roster" class="lookup-form">'+field('학년','roster-grade',select('roster-grade',Object.keys(boot.meta.classes),'','선택'))+field('과목','roster-subject',select('roster-subject',[],'','선택'))+field('분반','roster-section',select('roster-section',[],'','선택'))+'<button class="primary" type="submit">조회</button></form><div id="roster-result"></div>';
    if(state.teacherTab==='batch')html+='<form data-form="batch" class="lookup-form">'+field('학년','batch-grade',select('batch-grade',Object.keys(boot.meta.classes),'','선택'))+field('학급','batch-class',select('batch-class',[],'','선택'))+'<button class="primary" type="submit">일괄 인쇄</button></form>';
    if(state.teacherTab==='classSwap')html+='<div id="teacher-swap"></div>';
    if(state.teacherTab==='allocation')html+='<div id="teacher-allocation"></div>';
    if(state.teacherTab==='studyroom')html+='<div id="teacher-studyroom"></div>';
    showScreen(html+'</div>',true);if(state.teacherTab==='classSwap'){$('#teacher-swap').append(swapPane);swapPane.hidden=false;app.classList.add('teacher-tools');run(()=>showSwap('teacher',swapPane));}else hideSwap();if(state.teacherTab==='allocation')run(()=>showAllocation($('#teacher-allocation'),'teacher'));if(state.teacherTab==='studyroom')run(()=>showStudyroom($('#teacher-studyroom'),'teacher'));if(state.teacherTab==='hours')showCourse('teacher');
  }
  async function ensureClassCatalog(){
    const {meta}=state.teacherBoot,key=meta.revisions.schedule;
    if(classCatalog?.key!==key)classCatalog={key,grades:await call('roster',{query:{kind:'classSubjects'}},'teacher')};
  }
  function setRosterOptions(grade,subject='',section=''){
    const boot=state.teacherBoot,sections=boot.sections.filter(s=>grade!=='1'&&s.grade===grade);
    const catalog=classCatalog?.key===boot.meta.revisions.schedule?classCatalog.grades[grade]||[]:[];
    const subjects=[...new Set([...catalog.map(s=>s.subject),...sections.map(s=>s.subject)])].sort((a,b)=>a.localeCompare(b,'ko'));
    const classes=(catalog.find(s=>s.subject===subject)?.classes||[]).filter(n=>boot.meta.classes[grade]?.includes(n));
    const electives=sections.filter(s=>s.subject===subject);
    const choices=[...classes.map(n=>({value:grade==='1'?n:'class:'+n,label:n+'반'})),...electives.map(s=>({value:'section:'+s.id,label:s.code}))];
    $('label[for="roster-section"]').textContent=grade==='1'||classes.length&&!electives.length?'학급':classes.length?'학급·분반':'분반';
    $('#roster-subject').innerHTML=options(subjects,subject,'선택');
    $('#roster-section').innerHTML=options(choices,section,'선택');
  }
  function rosterHTML(r){let html='<table class="roster-table"><colgroup>'+Array.from({length:21},()=>'<col>').join('')+'</colgroup><thead><tr>'+['연번','학년','반','번호','이름','비고',...Array(15).fill('')].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>';r.students.forEach((s,i)=>{html+='<tr>'+[i+1,s.grade,s.classNum,s.number,s.name,s.note,...Array(15).fill('')].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>';});return html+'</tbody></table>';}
  function showRoster(r){state.roster=r;openDialog('<div class="roster-header"><h2>'+esc(r.title)+' <small>'+esc(r.detail)+' · '+r.students.length+'명</small></h2><div><button data-action="print-roster">인쇄</button><button class="modal-close" data-action="close-modal" aria-label="닫기">×</button></div></div><div class="table-scroll">'+rosterHTML(r)+'</div>',true);}
  function openDialog(html,wide=false){modal.classList.toggle('wide',wide);modal.innerHTML=html;if(!modal.open)modal.showModal();}
  function modalHead(title){return '<div class="modal-head"><h2>'+esc(title)+'</h2><button class="modal-close" data-action="close-modal" aria-label="닫기">×</button></div>';}
  function useMeta(meta){if(!meta)return;
    if(state.meta&&state.meta.term!==meta.term){
      studyroomViews.forEach(v=>v.dispose());studyroomViews.clear();
      state.timetable=null;state.roster=null;state.importPayload=null;state.importRef=null;state.importPreview=null;state.page=0;
      state.filters={grade:'',classNum:'',status:'',search:''};if(modal.open)modal.close();modal.innerHTML='';
    }
    state.meta=meta;if(state.admin&&state.route==='admin'){state.admin.meta=meta;state.admin.store.settings=meta.settings;state.admin.store.term=meta.term;}header();}
  function mergeLinks(data){Object.assign(state.admin,{warnings:data.warnings,blocks:data.blocks,teachers:data.teachers});state.admin.store.overrides=data.overrides;state.admin.store.blocks=data.manualBlocks;if(data.sections){state.admin.store.sections=data.sections;state.admin.sectionsRevision=data.meta.sectionsRevision;state.admin.loaded.sections=true;}state.admin.lessonCache={};if(data.teacher)state.admin.lessonCache[data.teacher]=data.lessons;state.admin.loaded.links=true;}
  async function ensureAdminTab(tab){
    const admin=state.admin;if(!admin.loaded)admin.loaded={};if(!admin.lessonCache)admin.lessonCache={};
    if(tab==='students'&&!admin.loaded.students){const data=await call('adminBootstrap',{},'admin');admin.store.students=data.store.students;admin.loaded.students=true;useMeta(data.meta);}
    if(tab==='sections'&&!admin.loaded.sections){const data=await call('adminSections',{},'admin');admin.store.sections=data.sections;admin.sectionsRevision=data.sectionsRevision;admin.loaded.sections=true;useMeta(data.meta);}
    if(['imports','links'].includes(tab)&&!admin.loaded.links){const data=await call('adminLinks',{},'admin');mergeLinks(data);useMeta(data.meta);}
    if(tab==='settings'&&!admin.loaded.settings){const data=await call('adminSettings',{},'admin');Object.assign(admin,{backups:data.backups,terms:data.terms});admin.loaded.settings=true;useMeta(data.meta);}
  }
  async function teacherLessons(teacher){if(!teacher||state.admin.lessonCache[teacher])return;const data=await call('adminLessons',{teacher},'admin');state.admin.lessonCache[teacher]=data.lessons;useMeta(data.meta);}
  async function loadAdmin(force=false){
    const cached=state.admin,data=await call('adminBootstrap',{workspaceOnly:state.adminTab!=='students',...(cached&&!force?{knownRevision:cached.meta.revision}:{})},'admin');
    if(data.unchanged){
      if(cached.meta.historyRevision!==data.historyRevision)cached.loaded.settings=false;
      cached.meta.historyRevision=data.historyRevision;
    }else{
      if(cached&&!force&&cached.store.term===data.store.term){
        if(!data.loaded.students&&cached.loaded.students&&cached.meta.revisions.students===data.meta.revisions.students){data.store.students=cached.store.students;data.loaded.students=true;}
        if(cached.loaded.sections&&cached.sectionsRevision===data.meta.sectionsRevision){data.store.sections=cached.store.sections;data.sectionsRevision=cached.sectionsRevision;data.loaded.sections=true;}
        if(cached.loaded.links&&cached.meta.revisions&&cached.meta.revisions.schedule===data.meta.revisions.schedule){Object.assign(data,{warnings:cached.warnings,blocks:cached.blocks,teachers:cached.teachers,lessonCache:cached.lessonCache});data.store.overrides=cached.store.overrides;data.store.blocks=cached.store.blocks;data.loaded.links=true;}
        if(cached.loaded.settings&&cached.meta.historyRevision===data.meta.historyRevision){Object.assign(data,{backups:cached.backups,terms:cached.terms});data.loaded.settings=true;}
      }
      state.admin=data;
    }
    useMeta(state.admin.meta);await ensureAdminTab(state.adminTab);renderAdmin();
  }
  function renderAdmin(){if(!token('admin')){renderLogin('admin');return;}const tabs=[['sectionAssignment','분반배정'],['students','학생'],['hours','시수배당표'],['allocation','이동수업 배치표'],['classSwap','결보강'],...(state.admin.meta.features?.studyroom?[['studyroom','스터디룸']]:[]),['settings','설정']];TTNavigation.render(tabs,'admin',['links','imports','sections'].includes(state.adminTab)?'settings':state.adminTab);showScreen(head('',['sectionAssignment','allocation','hours'].includes(state.adminTab)?'':'<button data-action="refresh-admin">새로고침</button>')+'<div class="admin-layout"><div id="admin-content" class="admin-content"></div></div>',true);renderAdminContent();}
  function renderAdminContent(){const root=$('#admin-content');if(!root||!state.admin)return;if(state.adminTab==='sectionAssignment')showSectionAssignment();if(state.adminTab==='hours')showCourse('admin');if(state.adminTab==='allocation')run(()=>showAllocation(root,'admin'));if(state.adminTab==='classSwap')run(()=>showSwap('admin',root));if(state.adminTab==='studyroom')run(()=>showStudyroom(root,'admin'));if(state.adminTab==='students')renderStudents(root);if(state.adminTab==='sections')renderSections(root);if(state.adminTab==='imports')renderImports(root);if(state.adminTab==='links')renderLinks(root);if(state.adminTab==='settings')renderSettings(root);
    if(['settings','links','imports','sections'].includes(state.adminTab)){
      const nav=document.createElement('nav');nav.className='tabs settings-nav';nav.setAttribute('aria-label','설정 메뉴');
      nav.innerHTML=[['settings','학기·운영 설정'],['imports','자료 등록'],['sections','선택분반']].map(([v,label])=>'<button data-action="admin-tab" data-tab="'+(v==='settings'?'term-settings':v)+'"'+((state.adminTab==='links'?'imports':state.adminTab)===v?' aria-current="page"':'')+'>'+label+'</button>').join('');
      root.prepend(nav);
    }
  }
  function renderStudents(root){const f=state.filters;root.innerHTML='<div class="filters">'+select('filter-grade',['1','2','3'],f.grade,'학년')+select('filter-class',Array.from(new Set(state.admin.store.students.filter(s=>!f.grade||s.grade===f.grade).map(s=>s.classNum))).sort((a,b)=>a-b),f.classNum,'학급')+select('filter-status',['재학','전출','자퇴','휴학','졸업'],f.status,'학적')+input('filter-search',f.search,'placeholder="이름·학번 검색" aria-label="학생 검색"')+'<button class="primary" data-action="new-student">추가</button>'+'<button data-action="student-transfer-preview">서버 분반배정</button>'+importTools('students')+'</div><div id="student-table"></div>';renderStudentTable();}
  function renderStudentTable(){const f=state.filters,rows=state.admin.store.students.filter(s=>(!f.grade||s.grade===f.grade)&&(!f.classNum||s.classNum===f.classNum)&&(!f.status||s.status===f.status)&&(!f.search||s.name.includes(f.search)||studentNo(s).includes(f.search))).sort((a,b)=>Number(a.grade)-Number(b.grade)||Number(a.classNum)-Number(b.classNum)||Number(a.number)-Number(b.number));const max=Math.max(0,Math.ceil(rows.length/50)-1);state.page=Math.min(state.page,max);$('#student-table').innerHTML='<div class="table-scroll"><table class="data-table"><thead><tr><th>학번</th><th>이름</th><th>학적</th><th>수강</th><th>비고</th></tr></thead><tbody>'+rows.slice(state.page*50,state.page*50+50).map(s=>'<tr class="clickable" data-action="edit-student" data-id="'+esc(s.id)+'"><td>'+studentNo(s)+'</td><td>'+esc(s.name)+'</td><td>'+esc(s.status)+'</td><td>'+(s.choiceCount==null?Object.values(s.choices||{}).filter(Boolean).length:s.choiceCount)+'</td><td>'+esc(s.note)+'</td></tr>').join('')+'</tbody></table></div><div class="pager"><small>'+rows.length+'명</small><div><button class="quiet" data-action="student-page" data-delta="-1" '+(!state.page?'disabled':'')+'>이전</button><small>'+(state.page+1)+' / '+(max+1)+'</small><button class="quiet" data-action="student-page" data-delta="1" '+(state.page>=max?'disabled':'')+'>다음</button></div></div>';}
  function studentNo(s){return s.grade+String(s.classNum).padStart(2,'0')+String(s.number).padStart(2,'0');}
  async function editStudent(id){const data=await call('adminStudent',{id:id||'',sectionsRevision:state.admin.loaded.sections?state.admin.sectionsRevision:''},'admin');if(data.sections){state.admin.store.sections=data.sections;state.admin.sectionsRevision=data.sectionsRevision;state.admin.loaded.sections=true;}state.editingRevision=data.meta.revision;const s=data.student||{grade:state.filters.grade||'2',classNum:state.filters.classNum||'1',number:'',name:'',status:'재학',note:'',choices:{}};state.editingStudent=s;openDialog(modalHead(s.id?'학생 수정':'학생 추가')+'<form data-form="save-student"><div class="form-grid">'+field('학년','edit-grade',select('edit-grade',['1','2','3'],s.grade))+field('학급','edit-class',input('edit-class',s.classNum,'type="number" min="1" max="99" required'))+field('번호','edit-number',input('edit-number',s.number,'type="number" min="1" max="99" required'))+field('이름','edit-name',input('edit-name',s.name,'required maxlength="80"'))+field('학적','edit-status',select('edit-status',['재학','전출','자퇴','휴학','졸업'],s.status))+field('비고','edit-note',input('edit-note',s.note,'maxlength="500"'))+'</div><div class="choice-list" id="student-choices"></div><div class="form-footer"><button type="button" data-action="close-modal">취소</button><button class="primary">저장</button></div></form>');renderStudentChoices(s.grade,s.choices);}
  function renderStudentChoices(grade,choices){const sections=state.admin.store.sections.filter(s=>s.grade===grade),subjects=Array.from(new Set(sections.map(s=>s.subject))).sort((a,b)=>a.localeCompare(b,'ko'));$('#student-choices').innerHTML=subjects.map((name,i)=>field(name,'choice-'+i,'<select id="choice-'+i+'" data-subject="'+esc(name)+'">'+options(sections.filter(s=>s.subject===name).map(s=>s.code).sort((a,b)=>a.localeCompare(b,'ko',{numeric:true})),choices[name],'미배정')+'</select>')).join('');}
  function renderSections(root){root.innerHTML='<div class="filters">'+select('section-grade',['1','2','3'],'','학년')+input('section-search','','placeholder="과목·분반·교실 검색" aria-label="분반 검색"')+'<button class="primary" data-action="new-section">추가</button>'+importTools('sections')+'<button data-action="course-transfer">시수배당 전달 자료</button></div><div id="section-table"></div>';renderSectionTable();}
  function renderSectionTable(){const g=$('#section-grade').value,q=$('#section-search').value;const rows=state.admin.store.sections.filter(s=>(!g||s.grade===g)&&(!q||[s.subject,s.code,s.room].join(' ').includes(q)));$('#section-table').innerHTML='<div class="table-scroll"><table class="data-table"><thead><tr><th>학년</th><th>과목</th><th>분반</th><th>축약명</th><th>교실</th></tr></thead><tbody>'+rows.map(s=>'<tr class="clickable" data-action="edit-section" data-id="'+esc(s.id)+'"><td>'+s.grade+'</td><td>'+esc(s.subject)+'</td><td>'+esc(s.code)+'</td><td>'+esc(s.shortName)+'</td><td>'+esc(s.room)+'</td></tr>').join('')+'</tbody></table></div>'}
  function editSection(id){const s=state.admin.store.sections.find(x=>x.id===id)||{grade:'2',subject:'',code:'',shortName:'',room:''};state.editingSection=s;openDialog(modalHead(s.id?'분반 수정':'분반 추가')+'<form data-form="save-section"><div class="form-grid">'+field('학년','sec-grade',select('sec-grade',['1','2','3'],s.grade))+field('분반','sec-code',input('sec-code',s.code,'required maxlength="30"'))+field('과목명','sec-subject',input('sec-subject',s.subject,'required maxlength="100"'),true)+field('축약과목명','sec-short',input('sec-short',s.shortName,'maxlength="100"'))+field('교실','sec-room',input('sec-room',s.room,'maxlength="100"'))+'</div><div class="form-footer"><button type="button" data-action="close-modal">취소</button><button class="primary">저장</button></div></form>');}
  const importExamples={
    students:{label:'학생',key:'import-students',headers:['학번','이름','예시 선택과목'],rows:[['30101','예시학생','A1']],example:[{grade:'3',classNum:'1',number:'1',name:'예시학생',choices:{'예시 선택과목':'A1'}}]},
    sections:{label:'선택분반',key:'import-elective',headers:['학년','선택반명','교과명','수업교실','축약과목명'],rows:[['3','A1','예시 선택과목','과학실','예시']],example:[{grade:'3',code:'A1',subject:'예시 선택과목',room:'과학실',shortName:'예시'}]}
  };
  function importTools(kind){
    return '<button data-action="bulk-import" data-kind="'+kind+'">엑셀·JSON 업로드</button><button data-action="import-example" data-kind="'+kind+'" data-format="xlsx">엑셀 예시</button><button data-action="import-example" data-kind="'+kind+'" data-format="json">JSON 예시</button>';
  }
  function openBulkImport(kind){
    const spec=importExamples[kind];state.importPayload=null;state.importRef=null;state.importPreview=null;
    openDialog(modalHead(spec.label+' 업로드')+'<form data-form="preview-import" data-draft-key="'+state.admin.store.term+'|bulk-'+kind+'" class="import-grid">'+
     field(spec.label+' 파일',spec.key,'<input id="'+spec.key+'" type="file" accept=".xlsx,.csv,.json" '+(kind==='students'?'multiple ':'')+'required>')+
     '<label class="check-label"><input id="preserve-manual" type="checkbox" checked>웹 수정값 유지</label><div><button type="submit" class="primary">미리보기</button></div></form><div id="import-preview" class="import-preview"></div>',true);
  }
  async function downloadImportExample(kind,format){
    const spec=importExamples[kind];
    if(format==='json'){download(new Blob([JSON.stringify({format:'timetable-import',[kind]:spec.example},null,2)],{type:'application/json'}),spec.label+'_예시.json');return;}
    await TTAssets.load('xlsx');
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([spec.headers,...spec.rows]),spec.label);
    XLSX.writeFile(book,spec.label+'_예시.xlsx');
  }
  function renderImports(root){
    root.innerHTML='<h2>전체교사시간표 등록</h2><p class="import-intro">요일·교시와 교사별 과목·교실이 들어 있는 기존 전체교사시간표 엑셀을 사용하세요.</p>'+
     '<form data-form="preview-import" class="import-grid">'+
     field('전체교사시간표','import-teacher','<input id="import-teacher" type="file" accept=".xlsx,.csv" required>')+
     '<label class="check-label"><input id="preserve-manual" type="checkbox" checked>웹 수정값 유지</label><div><button class="primary" type="submit">미리보기</button></div></form><div id="import-preview" class="import-preview"></div>'+
     '<div id="registered-exceptions">'+exceptionLessons(state.admin.warnings,true)+'</div>';
  }
  function exceptionLessons(lessons,editable=false){
    if(!lessons?.length)return '';
    return '<section class="settings-section"><h2>예외 수업 확인</h2><ul class="notice-list">'+lessons.map(l=>'<li>'+esc([l.teacher,l.day+l.period,l.rawSubject,l.rawRoom].filter(Boolean).join(' · '))+'</li>').join('')+'</ul>'+(editable?'<button data-action="admin-tab" data-tab="links">분반 연결 편집</button>':'')+'</section>';
  }
  async function previewCourseTransfer(){
    await previewServerTransfer(await call('courseTransfer',{summary:true},'admin'),'course');
  }
  function renderImportPreview(p){const registered=$('#registered-exceptions');if(registered)registered.hidden=true;$('#import-preview').innerHTML='<div class="stat-row"><span><strong>'+p.students+'</strong>학생</span><span><strong>'+p.teachers+'</strong>교사</span><span><strong>'+p.sections+'</strong>분반</span></div><p class="muted">학생 추가 '+p.addedStudents+' · 변경 '+p.changedStudents+' · 수정값 유지 '+p.preservedFields+'</p>'+(p.inferredSections?.length?'<details open><summary>학생 배정에서 추가할 분반 '+p.inferredSections.length+'개</summary><ul class="notice-list">'+p.inferredSections.map(name=>'<li>'+esc(name)+'</li>').join('')+'</ul></details>':'')+(p.errors.length?'<ul class="notice-list">'+p.errors.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>':'')+(p.warnings.length?'<ul class="notice-list">'+p.warnings.slice(0,50).map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>':'')+exceptionLessons(p.linkExceptions)+'<div class="form-footer"><button class="primary" data-action="commit-import" '+(p.errors.length?'disabled':'')+'>등록</button></div>';}
  function renderLinks(root){const data=state.admin;root.innerHTML='<div class="toolbar"><button data-action="admin-tab" data-tab="imports">자료 등록으로</button>'+select('link-teacher',data.teachers,'','확인 필요')+'<small>'+data.warnings.length+'건</small></div><div id="link-table"></div><details class="settings-section"><summary>시간블록</summary><div class="toolbar" style="margin-top:20px">'+select('block-grade',Object.keys(data.meta.classes),'','학년')+'</div><div id="block-table"></div></details>';renderLinkTable();}
  function renderLinkTable(){const teacher=$('#link-teacher').value,source=teacher?(state.admin.lessonCache[teacher]||[]):state.admin.warnings;state.visibleLinks=source;$('#link-table').innerHTML='<div class="table-scroll"><table class="data-table"><thead><tr><th>교사</th><th>교시</th><th>원본 과목</th><th>연결 분반</th><th></th></tr></thead><tbody>'+source.map((l,i)=>{const over=state.admin.store.overrides.find(o=>o.teacher===l.teacher&&o.day===l.day&&Number(o.period)===l.period);const automatic=l.sectionId?state.admin.store.sections.find(s=>s.id===l.sectionId):null;return '<tr><td>'+esc(l.teacher)+'</td><td>'+l.day+l.period+'</td><td>'+esc(l.rawSubject)+'<br><small>'+esc(l.rawRoom)+'</small></td><td><select data-link-index="'+i+'" aria-label="연결 분반">'+options(state.admin.store.sections.map(s=>({value:s.id,label:s.grade+'학년 '+s.subject+' '+s.code})),over&&over.sectionId,'자동'+(automatic?' · '+automatic.subject+' '+automatic.code:''))+'</select></td><td><button class="mini" data-action="save-link" data-index="'+i+'">저장</button></td></tr>';}).join('')+'</tbody></table></div>';}
  function renderBlocks(){const g=$('#block-grade').value;if(!g){$('#block-table').innerHTML='';return;}const allBlocks=Array.from(new Set(state.admin.store.sections.filter(s=>s.grade===g).map(s=>(s.code.match(/^[A-Za-z]+/)||[''])[0].toUpperCase()))).filter(Boolean).sort();let html='<form data-form="save-blocks"><div class="table-scroll"><table class="data-table block-grid"><thead><tr><th></th>'+days.map(d=>'<th>'+d+'</th>').join('')+'</tr></thead><tbody>';for(let p=1;p<=7;p++){html+='<tr><th>'+p+'</th>';days.forEach(d=>{const o=state.admin.store.blocks.find(o=>o.grade===g&&o.day===d&&Number(o.period)===p),auto=(state.admin.blocks[d+'-'+p]||{})[g];html+='<td><select data-block-day="'+d+'" data-block-period="'+p+'" aria-label="'+d+p+' 시간블록">'+options(allBlocks,o?o.block:'','자동'+(auto?' · '+auto:''))+'</select></td>';});html+='</tr>';}html+='</tbody></table></div><div class="form-footer"><button class="primary">저장</button></div></form>';$('#block-table').innerHTML=html;}
  function renderSettings(root){const s=state.admin.store.settings;root.innerHTML='<div class="panel"><div class="toolbar">'+'<label for="switch-term">운영 학기</label>'+select('switch-term',state.admin.terms,state.admin.store.term)+'<button data-action="switch-term">학기 전환</button></div><details class="term-create"><summary>새 학기 만들기</summary><form data-form="create-term" data-skip-draft="true" class="toolbar">'+field('학년도','create-year',input('create-year',Math.min(2100,s.academicYear+(s.semester===2?1:0)),'type="number" min="2020" max="2100" required'))+field('학기','create-semester',select('create-semester',['1','2'],Number(s.semester)===1?'2':'1'))+'<button type="submit" class="primary">학기 생성</button></form></details><form data-form="settings"><div class="form-grid">'+field('학교명','set-school',input('set-school',s.schoolName,'maxlength="80"'))+field('시간표 제목','set-title',input('set-title',s.title,'maxlength="100"'))+'</div><label class="check-label"><input type="checkbox" id="set-course-teachers" '+(s.courseAllocationTeachers?'checked':'')+'>교사 시수배당표 사용 허용</label><div class="settings-section"><h2>요일별 교시</h2><div class="check-grid">'+days.map(d=>field(d,'period-'+d,select('period-'+d,[1,2,3,4,5,6,7],s.periods[d]))).join('')+'</div></div><div class="settings-section"><h2>창체</h2><div class="check-grid">'+days.map(d=>'<div class="check-day"><h3>'+d+'</h3>'+[1,2,3,4,5,6,7].map(p=>'<label class="check-label"><input type="checkbox" data-fixed-day="'+d+'" data-fixed-period="'+p+'" '+(s.fixedPeriods.some(f=>f.day===d&&f.period===p)?'checked':'')+'>'+p+'교시</label>').join('')+'</div>').join('')+'</div></div><div class="form-footer"><button class="primary">저장</button></div></form><div class="settings-section"><h2>비밀번호 변경</h2><div class="toolbar"><button type="button" data-action="password-dialog" data-role="student">학생 비밀번호 변경</button><button type="button" data-action="password-dialog" data-role="teacher">교사 비밀번호 변경</button><button type="button" data-action="password-dialog" data-role="admin">관리자 비밀번호 변경</button></div></div>'+backupSettings()+'</div>';}
  function passwordDialog(role){const title=roles[role]+' 비밀번호 변경';openDialog(modalHead(title)+'<form data-form="password" data-role="'+role+'"><div class="form-stack">'+field('현재 관리자 비밀번호','password-current',input('password-current','','type="password" required maxlength="128" autocomplete="current-password" autofocus'))+field('새 비밀번호','password-new',input('password-new','','type="password" required minlength="4" maxlength="128" autocomplete="new-password"'))+field('새 비밀번호 확인','password-confirm',input('password-confirm','','type="password" required minlength="4" maxlength="128" autocomplete="new-password"'))+'</div><div class="form-footer"><button type="button" data-action="close-modal">취소</button><button class="primary" type="submit">비밀번호 변경</button></div></form>');}
  function backupSettings(){return '<div class="settings-section"><h2>백업</h2><div class="toolbar"><button data-action="backup">백업 저장</button><button data-action="restore-file">백업 불러오기</button><input type="file" id="restore-file" accept=".json" hidden></div><div class="table-scroll"><table class="data-table"><thead><tr><th>일시</th><th>이름</th><th></th></tr></thead><tbody>'+state.admin.backups.filter(b=>b.term===state.admin.store.term).map(b=>'<tr><td>'+date(b.at)+'</td><td>'+esc(b.label)+'</td><td><button class="mini" data-action="download-backup" data-id="'+esc(b.id)+'">다운로드</button> <button class="mini" data-action="restore-backup" data-id="'+esc(b.id)+'">복원</button></td></tr>').join('')+'</tbody></table></div></div>';}
  async function renderRoute(){hideSwap();state.route=route();header();if(state.route==='home')renderLogin();if(state.route==='student'){if(token('student'))renderStudent();else renderLogin('student');}if(state.route==='teacher'){if(!token('teacher'))renderLogin('teacher');else await loadTeacher();}if(state.route==='admin'){if(!token('admin'))renderLogin('admin');else await loadAdmin();}}
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
    const reply=await call(action,Object.assign({expectedRevision:action==='saveStudent'?state.editingRevision:state.admin.meta.revision,patch:true,workspaceOnly:state.adminTab!=='students',viewTeacher:teacher||''},args),'admin');
    if(action==='saveStudent')forgetDraft('save-student');if(action==='saveSection')forgetDraft('save-section');if(action==='saveSettings')forgetDraft('settings');if(action==='commitImport')forgetDraft('preview-import');
    state.teacherBoot=null;state.timetable=null;
    if(reply.bootstrap)state.admin=reply.bootstrap;
    else {
      if(reply.students)reply.students.forEach(student=>{const index=state.admin.store.students.findIndex(s=>s.id===student.id);if(index<0)state.admin.store.students.push(student);else state.admin.store.students[index]=student;});
      if(reply.section){state.admin.sectionsRevision=reply.meta.sectionsRevision;const index=state.admin.store.sections.findIndex(s=>s.id===reply.section.id);if(index<0)state.admin.store.sections.push(reply.section);else state.admin.store.sections[index]=reply.section;state.admin.loaded.links=false;state.admin.lessonCache={};}
      if(reply.links)mergeLinks(reply.links);
      state.admin.loaded.settings=false;
    }
    useMeta(reply.meta);await ensureAdminTab(state.adminTab);renderAdmin();
    if(state.adminTab==='links'&&teacher){$('#link-teacher').value=teacher;renderLinkTable();}
    if(state.adminTab==='links'&&grade){$('#block-grade').value=grade;$('#block-grade').closest('details').open=!!blocksOpen;renderBlocks();}
    return reply.result;
  }
  document.addEventListener('submit',e=>{const form=e.target.closest('form[data-form]');if(!form)return;e.preventDefault();const button=e.submitter||form.querySelector('button[type=submit],button.primary');run(async()=>{
    switch(form.dataset.form){
      case 'login':{
        const role=$('#login-role').value,error=$('#login-error');error.hidden=true;
        let result;
        try{result=await call('login',{role,password:$('#password').value,initialize:true,workspaceOnly:role==='admin'&&state.adminTab==='sectionAssignment'});}
        catch(err){error.textContent=err.message;error.hidden=false;return;}
        clearSessions();
        sessionStorage.setItem('timetable.'+role,JSON.stringify({token:result.token,role:result.role,expiresAt:result.expiresAt}));
        state.route=role;location.hash=href(role);
        useMeta(result.initial.meta);
        if(role==='admin'){state.admin=result.initial;await ensureAdminTab(state.adminTab);renderAdmin();}
        else if(role==='teacher'){state.teacherBoot=result.initial;if(state.teacherTab==='roster')await ensureClassCatalog();renderTeacher();}
        else renderStudent();
        break;
      }
      case 'student':state.timetable=await call('student',{studentNumber:$('#student-number').value.trim()});useMeta(state.timetable.meta);$('#lookup-result').innerHTML=resultHTML();break;
      case 'teacher':state.teacherName=$('#teacher-name').value.trim();state.timetable=await call('teacher',{teacher:state.teacherName},'teacher');useMeta(state.timetable.meta);$('#lookup-result').innerHTML=resultHTML();break;
      case 'roster':{const grade=$('#roster-grade').value,section=$('#roster-section').value;if(!section)throw Error('학년·과목·학급 또는 분반을 선택하세요.');const query=section.startsWith('section:')?{kind:'elective',sectionId:section.slice(8)}:{kind:'classSubject',grade,subject:$('#roster-subject').value,classNum:grade==='1'?section:section.slice(6)};showRoster(await call('roster',{query},'teacher'));break;}
      case 'batch':{const grade=$('#batch-grade').value,classNum=$('#batch-class').value;if(!grade||!classNum)throw Error('학년과 학급을 선택하세요.');const r=await call('classBatch',{grade,classNum},'teacher');if(!r.timetables.length)throw Error('해당 학급에 학생이 없습니다.');let html='';for(let i=0;i<r.timetables.length;i+=4)html+='<div class="batch-page">'+r.timetables.slice(i,i+4).map(t=>'<div class="batch-item">'+timetableHTML(t)+'</div>').join('')+'</div>';await print(html,'batch');break;}
      case 'save-student':{const old=state.editingStudent,choices=Object.assign({},old.choices);$('#student-choices').querySelectorAll('select').forEach(el=>choices[el.dataset.subject]=el.value);await mutation('saveStudent',{student:Object.assign({},old,{grade:$('#edit-grade').value,classNum:$('#edit-class').value,number:$('#edit-number').value,name:$('#edit-name').value,status:$('#edit-status').value,note:$('#edit-note').value,choices})});modal.close();toast('저장했습니다.');break;}
      case 'save-section':await mutation('saveSection',{section:Object.assign({},state.editingSection,{grade:$('#sec-grade').value,subject:$('#sec-subject').value,code:$('#sec-code').value,shortName:$('#sec-short').value,room:$('#sec-room').value})});modal.close();toast('저장했습니다.');break;
      case 'preview-import':{const version=window.TIMETABLE_CONFIG?.assetVersion||'1';await Promise.all([TTAssets.load('xlsx'),import('./import.js?v='+version)]);const loaded=await TTImport.files(form.querySelector('#import-teacher')?.files[0],form.querySelector('#import-elective')?.files[0],form.querySelector('#import-students')?.files,state.admin.store.term);state.importRef=null;state.importPayload=loaded.payload;if(loaded.payload.students&&!loaded.payload.sections)state.importPayload.inferSections=true;state.preserveManual=$('#preserve-manual').checked;state.importPreview=await call('previewImport',{payload:loaded.payload,preserveManual:state.preserveManual},'admin');state.importPreview.warnings.push(...loaded.warnings);renderImportPreview(state.importPreview);break;}
      case 'create-term':{
        const term=$('#create-year').value+'-'+$('#create-semester').value;
        await mutation('createTerm',{term});$('#switch-term').value=term;toast(term+' 학기를 생성했습니다.');
        break;
      }
      case 'settings':{const settings={schoolName:$('#set-school').value,title:$('#set-title').value,academicYear:state.admin.store.settings.academicYear,semester:state.admin.store.settings.semester,courseAllocationTeachers:$('#set-course-teachers').checked,periods:{},fixedPeriods:[]};days.forEach(d=>settings.periods[d]=Number($('#period-'+d).value));document.querySelectorAll('[data-fixed-day]:checked').forEach(el=>settings.fixedPeriods.push({day:el.dataset.fixedDay,period:Number(el.dataset.fixedPeriod),label:'창체'}));await mutation('saveSettings',{settings});toast('저장했습니다.');break;}
      case 'password':{const role=form.dataset.role;if($('#password-new').value!==$('#password-confirm').value)throw Error('새 비밀번호 확인이 다릅니다.');await call('changePassword',{role,currentPassword:$('#password-current').value,newPassword:$('#password-new').value},'admin');modal.close();modal.innerHTML='';sessionStorage.removeItem('timetable.'+role);state.admin.loaded.settings=false;state.teacherBoot=null;if(role==='admin')await renderRoute();else renderSettings($('#admin-content'));toast('비밀번호를 변경했습니다.');break;}
      case 'save-blocks':{const grade=$('#block-grade').value,blocks=[];document.querySelectorAll('[data-block-day]').forEach(el=>{if(el.value)blocks.push({grade,day:el.dataset.blockDay,period:Number(el.dataset.blockPeriod),block:el.value});});await mutation('saveBlocks',{grade,blocks});toast('저장했습니다.');break;}
    }
  },button);});
  document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el||el.disabled)return;const action=el.dataset.action;e.preventDefault();run(async()=>{
    switch(action){
      case 'close-modal':modal.close();break;
      case 'password-dialog':passwordDialog(el.dataset.role);break;
      case 'logout':{
        const savedDrafts=Object.keys(sessionStorage).some(key=>key.startsWith(swapCachePrefix));
        const courseDirty=[...courseFrames.values()].some(frame=>frame.contentWindow?.hasUnsavedCourseChanges?.());
        const assignmentDirty=sectionFrame?.contentWindow?.hasSectionAssignmentWork?.();
        if((savedDrafts||swapDirty()||allocationDirty()||courseDirty||assignmentDirty)&&!confirm('이 탭에서 작업 중인 내용을 버리고 로그아웃할까요?'))return;
        await call('logout',{},state.route);
        allocationViews.forEach(v=>v.destroy());allocationViews.clear();
        studyroomViews.forEach(v=>v.dispose());studyroomViews.clear();
        coursePane.replaceChildren();courseFrames.clear();sectionPane.replaceChildren();sectionFrame=null;
        discardSwap();forgetDraft();clearSessions();
        if(modal.open)modal.close();modal.innerHTML='';
        Object.assign(state,{timetable:null,roster:null,editingStudent:null,editingSection:null,teacherBoot:null,admin:null,adminTab:'sectionAssignment',teacherTab:'timetable',importPayload:null,importRef:null,importPreview:null});
        location.hash=href('home');await renderRoute();
        break;
      }
      case 'teacher-tab':if(el.dataset.tab==='hours'&&!state.teacherBoot.meta.settings.courseAllocationTeachers){courseNotice('관리자 설정에서 시수배당표 사용을 허용한 뒤 열 수 있습니다.');return;}if(el.dataset.tab==='roster')await ensureClassCatalog();state.teacherTab=el.dataset.tab;renderTeacher();break;
      case 'admin-tab':state.adminTab=el.dataset.tab==='term-settings'?'settings':el.dataset.tab;if(state.admin.reloadAfterSwap){await loadAdmin();delete state.admin.reloadAfterSwap;}else{await ensureAdminTab(state.adminTab);renderAdmin();}break;
      case 'refresh-admin':await loadAdmin(true);toast('새로고침했습니다.');break;
      case 'course-transfer':await previewCourseTransfer();break;
      case 'bulk-import':openBulkImport(el.dataset.kind);break;
      case 'import-example':await downloadImportExample(el.dataset.kind,el.dataset.format);break;
      case 'new-student':await editStudent();break;
      case 'edit-student':await editStudent(el.dataset.id);break;
      case 'student-page':state.page+=Number(el.dataset.delta);renderStudentTable();break;
      case 'new-section':editSection();break;
      case 'edit-section':editSection(el.dataset.id);break;
      case 'student-transfer-preview':await previewServerTransfer(await call('toolTransfer',{kind:'students'},'admin'));break;
      case 'commit-import':if((!state.importPayload&&!state.importRef)||!state.importPreview)throw Error('미리보기를 먼저 실행하세요.');await mutation('commitImport',{payload:state.importPayload,transferRef:state.importRef,preserveManual:state.preserveManual,expectedRevision:state.importPreview.revision});state.importPayload=null;state.importRef=null;state.importPreview=null;if(modal.open&&modal.querySelector('[data-form=preview-import],[data-course-preview],[data-assignment-preview]')){modal.close();modal.innerHTML='';}toast('등록했습니다.');break;
      case 'cell-roster':{const c=state.timetable.cells[Number(el.dataset.cell)],q=c&&c.roster;if(!q)break;if(q.kind==='choose'){const secs=state.teacherBoot.sections.filter(s=>q.sectionIds.includes(s.id));openDialog(modalHead('학년·분반 선택')+'<div class="form-stack">'+secs.map(s=>'<button data-action="chosen-roster" data-id="'+esc(s.id)+'">'+esc(s.grade+'학년 '+s.subject+' '+s.code)+'</button>').join('')+'</div>');}else showRoster(await call('roster',{query:q},'teacher'));break;}
      case 'chosen-roster':showRoster(await call('roster',{query:{kind:'elective',sectionId:el.dataset.id}},'teacher'));break;
      case 'print-roster':await print('<h2>'+esc(state.roster.title)+' '+esc(state.roster.detail)+'</h2>'+rosterHTML(state.roster),'roster');break;
      case 'print-single':await print(timetableHTML(state.timetable),'single');break;
      case 'save-image':{await Promise.all([TTAssets.load('image'),document.fonts.ready]);const canvas=await html2canvas($('#capture-area'),{scale:3,backgroundColor:'#ffffff',logging:false});const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('이미지를 저장하지 못했습니다.');download(blob,(state.timetable.studentNumber||state.timetable.name)+'_시간표.png');break;}
      case 'save-link':{const l=state.visibleLinks[Number(el.dataset.index)],chosen=document.querySelector('[data-link-index="'+el.dataset.index+'"]').value;await mutation('saveOverride',{override:{teacher:l.teacher,day:l.day,period:l.period,sectionId:chosen}});toast('저장했습니다.');break;}
      case 'backup':{const r=await call('backup',{expectedRevision:state.admin.meta.revision,patch:true},'admin');download(new Blob([JSON.stringify(r.result.backup,null,2)],{type:'application/json'}),'시간표_백업_'+state.admin.store.term+'.json');state.admin.backups=r.backups;renderAdminContent();toast('백업을 저장했습니다.');break;}
      case 'restore-file':$('#restore-file').click();break;
      case 'download-backup':{const backup=await call('downloadBackup',{backupId:el.dataset.id},'admin');download(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),'시간표_백업_'+backup.store.term+'.json');break;}
      case 'restore-backup':if(confirm('현재 학기의 자료를 이 백업으로 복원하시겠습니까?')){await mutation('restore',{backupId:el.dataset.id});toast('복원했습니다.');}break;
      case 'switch-term':if($('#switch-term').value===state.admin.store.term)break;await mutation('switchTerm',{term:$('#switch-term').value});toast('학기를 전환했습니다.');break;
    }
  },el.tagName==='BUTTON'?el:null,!['close-modal','password-dialog','teacher-tab','student-page','new-section','edit-section','restore-file'].includes(action));});
  document.addEventListener('change',e=>{const el=e.target;run(async()=>{
    if(el.id==='login-role'&&el.value)TTApi.prepareLogin(el.value).catch(()=>{});
    if(['filter-grade','filter-class','filter-status'].includes(el.id)){const k={'filter-grade':'grade','filter-class':'classNum','filter-status':'status'}[el.id];state.filters[k]=el.value;state.page=0;if(k==='grade'){state.filters.classNum='';renderStudents($('#admin-content'));}else renderStudentTable();}
    if(el.id==='section-grade')renderSectionTable();
    if(el.id==='edit-grade'){const choices={};$('#student-choices').querySelectorAll('select').forEach(s=>choices[s.dataset.subject]=s.value);renderStudentChoices(el.value,choices);}
    if(el.closest('[data-form="preview-import"]')){state.importPayload=null;state.importRef=null;state.importPreview=null;$('#import-preview').replaceChildren();const registered=$('#registered-exceptions');if(registered)registered.hidden=false;}
    if(el.id==='roster-grade')setRosterOptions(el.value);
    if(el.id==='roster-subject')setRosterOptions($('#roster-grade').value,el.value);
    if(el.id==='batch-grade')$('#batch-class').innerHTML=options(state.teacherBoot.meta.classes[el.value]||[],'','선택');
    if(el.id==='link-teacher'){await teacherLessons(el.value);renderLinkTable();}
    if(el.id==='block-grade')renderBlocks();
    if(el.id==='restore-file'&&el.files[0]){const file=el.files[0];if(file.size>10*1024*1024)throw Error('백업 파일 크기를 확인하세요.');const backup=JSON.parse(await file.text());if(backup.format!=='school-timetable-backup')throw Error('백업 파일 형식이 다릅니다.');if(confirm('선택한 백업으로 현재 학기의 자료를 복원하시겠습니까?')){await mutation('restore',{backup});toast('복원했습니다.');}}
  },null,['restore-file','link-teacher'].includes(el.id));});
  document.addEventListener('input',e=>{if(e.target.id==='filter-search'){state.filters.search=e.target.value;state.page=0;renderStudentTable();}if(e.target.id==='section-search')renderSectionTable();});
  window.addEventListener('hashchange',()=>{if(!busyCount&&state.route!==route())run(renderRoute);});
  window.addEventListener('afterprint',()=>{$('#print-root').innerHTML='';});
  async function start(){
    state.route=route();
    await renderRoute();
    if(!roles[state.route]||!token(state.route)){
      call('bootstrap').then(meta=>{if(!state.meta)useMeta(meta);}).catch(e=>{if(!state.meta)toast(e.message);});
    }
  }
  renderStudent=withDrafts(renderStudent);renderTeacher=withDrafts(renderTeacher);renderAdmin=withDrafts(renderAdmin);renderSettings=withDrafts(renderSettings);renderImports=withDrafts(renderImports);renderSections=withDrafts(renderSections);renderStudents=withDrafts(renderStudents);renderLogin=withDrafts(renderLogin);openDialog=withDrafts(openDialog);
  run(start);
})();
