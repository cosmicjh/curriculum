(function(global){
 'use strict';
 const titleLead='교육과정 편성·운영',titleTail='지원 도구',title=titleLead+' '+titleTail;
 const workspace=document.getElementById('workspace'),mobile=matchMedia('(max-width:1023px)');
 const sidebar=document.createElement('aside'),backdrop=document.createElement('div');
 sidebar.id='sidebar';sidebar.setAttribute('aria-label',title);
 sidebar.innerHTML='<div class="sidebar-heading"><a class="program-title" href="#/home">'+titleLead+' <span>'+titleTail+'</span></a><button type="button" data-sidebar-toggle aria-controls="sidebar-menu"></button></div><nav id="sidebar-menu" aria-label="주 메뉴"></nav><footer class="sidebar-credit">기획·개발: 첨단고등학교 정준홍</footer>';
 backdrop.className='sidebar-backdrop';backdrop.hidden=true;workspace.before(sidebar,backdrop);
 const menu=sidebar.querySelector('nav'),toggle=sidebar.querySelector('[data-sidebar-toggle]'),key='curriculum.navigation';
 const paths={
  sectionAssignment:'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  students:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  studentTimetable:'M4 5h16v15H4z M4 10h16 M9 3v4 M15 3v4 M9 10v10 M15 10v10',
  timetable:'M4 5h16v15H4z M4 10h16 M9 3v4 M15 3v4 M9 10v10 M15 10v10',
  roster:'M8 5h12 M8 12h12 M8 19h12 M3 5h.01 M3 12h.01 M3 19h.01',
  hours:'M4 4h16v16H4z M4 9h16 M10 4v16 M15 9v11 M4 15h16',
  allocation:'M3 4h18v16H3z M3 9h18 M9 9v11 M15 9v11',
  classSwap:'M4 7h16l-4-4 M20 17H4l4 4',
  batch:'M6 9V3h12v6 M6 17H3V9h18v8h-3 M6 14h12v7H6z M17 12h.01',
  studyroom:'M3 4h7a2 2 0 0 1 2 2v15a4 4 0 0 0-4-3H3z M21 4h-7a2 2 0 0 0-2 2v15a4 4 0 0 1 4-3h5z',
  settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6'
 };
 const icon=path=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
 let saved={};
 try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
 let collapsed=saved.collapsed===true,open=saved.mobileOpen===true,busy=false,enabled=false,returnFocus=null,scrollY=null;
 function persist(){
  try{localStorage.setItem(key,JSON.stringify({collapsed,mobileOpen:open}));}catch{}
 }
 function apply(){
  const overlay=enabled&&mobile.matches&&open;
  sidebar.hidden=!enabled;
  document.body.classList.toggle('has-sidebar',enabled);
  document.body.classList.toggle('sidebar-collapsed',enabled&&collapsed);
  document.body.classList.toggle('sidebar-open',overlay);
  sidebar.inert=!enabled||mobile.matches&&!overlay;
  sidebar.setAttribute('aria-hidden',String(sidebar.inert));
  if(overlay){
   sidebar.setAttribute('role','dialog');
   sidebar.setAttribute('aria-modal','true');
  }else{
   sidebar.removeAttribute('role');
   sidebar.removeAttribute('aria-modal');
  }
  backdrop.hidden=!overlay;
  workspace.inert=busy||overlay;
  toggle.innerHTML=icon(overlay?'M6 6l12 12 M18 6 6 18':collapsed?'M9 5l7 7-7 7':'M15 5l-7 7 7 7');
  toggle.setAttribute('aria-label',mobile.matches?'메뉴 닫기':collapsed?'메뉴 펼치기':'메뉴 접기');
  toggle.setAttribute('aria-expanded',String(mobile.matches?overlay:!collapsed));
  const opener=document.querySelector('[data-sidebar-open]');
  if(opener)opener.setAttribute('aria-expanded',String(overlay));
  if(overlay&&scrollY===null){
   scrollY=window.scrollY;
   Object.assign(document.body.style,{position:'fixed',top:-scrollY+'px',width:'100%'});
  }else if(!overlay&&scrollY!==null){
   Object.assign(document.body.style,{position:'',top:'',width:''});
   window.scrollTo(0,scrollY);
   scrollY=null;
  }
 }
 function close(restore=true){
  if(!mobile.matches||!open)return;
  open=false;
  persist();
  apply();
  if(restore)(returnFocus?.isConnected?returnFocus:document.querySelector('[data-sidebar-open]'))?.focus({preventScroll:true});
  returnFocus=null;
 }
 function show(opener){
  returnFocus=opener;
  open=true;
  persist();
  apply();
  toggle.focus({preventScroll:true});
 }
 document.addEventListener('click',event=>{
  const opener=event.target.closest('[data-sidebar-open]');
  if(opener){show(opener);return;}
  if(event.target.closest('[data-sidebar-toggle]')){
   if(mobile.matches)close();
   else{
    collapsed=!collapsed;
    persist();
    apply();
   }
   return;
  }
  if(event.target===backdrop){close();return;}
  if(mobile.matches&&open&&event.target.closest('#sidebar-menu button,.program-title')){
   close(false);
   document.getElementById('app').focus({preventScroll:true});
  }
 },true);
 document.addEventListener('keydown',event=>{
  if(!enabled||!mobile.matches||!open)return;
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key!=='Tab')return;
  const controls=[...sidebar.querySelectorAll('a,button:not(:disabled)')].filter(el=>el.getClientRects().length);
  const current=controls.indexOf(document.activeElement),direction=event.shiftKey?-1:1;
  const next=current<0?(event.shiftKey?controls.at(-1):controls[0]):controls[(current+direction+controls.length)%controls.length];
  event.preventDefault();
  next?.focus();
 },true);
 mobile.addEventListener('change',()=>{
  const focusWasInSidebar=sidebar.contains(document.activeElement);
  open=false;
  returnFocus=null;
  persist();
  apply();
  if(mobile.matches&&focusWasInSidebar)document.querySelector('[data-sidebar-open]')?.focus();
 });
 function render(items,role,current){
  enabled=items.length>0;
  const signature=JSON.stringify([items,role]);
  if(menu.dataset.signature!==signature){
   menu.dataset.signature=signature;menu.className=role==='admin'?'admin-nav':role==='teacher'?'tabs':'';
   menu.setAttribute('aria-label',role==='admin'?'관리 메뉴':role==='teacher'?'교사 메뉴':'주 메뉴');
   menu.innerHTML=items.map(([id,label])=>'<button type="button" data-action="'+role+'-tab" data-tab="'+id+'" title="'+label+'" aria-label="'+label+'">'+icon(paths[id]||paths.settings)+'<span class="nav-label">'+label+'</span></button>').join('');
  }
  for(const button of menu.children){
   if(button.dataset.tab===current)button.setAttribute('aria-current','page');
   else button.removeAttribute('aria-current');
  }
  apply();
 }
 apply();
 global.TTNavigation={
  title,menu,render,sync:apply,
  setBusy(value){
   busy=value;
   apply();
   if(enabled&&!busy&&mobile.matches&&open&&!sidebar.contains(document.activeElement))toggle.focus({preventScroll:true});
  },
  opener:()=>'<button type="button" class="sidebar-opener" data-sidebar-open aria-label="메뉴 열기" aria-controls="sidebar" aria-expanded="false">'+icon('M4 6h16 M4 12h16 M4 18h16')+'</button>'
 };
})(window);
