const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days=['월','화','수','목','금'];
const blank=()=>({rooms:Array.from({length:12},(_,i)=>({id:'room-'+i,label:(i+1)+'반',classNum:String(i+1)})),grades:['3','2'].map(grade=>({grade,homerooms:{},blocks:[]}))});
export function mountAllocation(root,initial,{admin,request,onSaved,print,loadXlsx,onError}){
 let data=initial,board=structuredClone(data.board||blank()),sections=data.sections,dirty=false,grade=board.grades[0]?.grade||'3',room='',query='',dialog,returnFocus;
 const section=c=>sections.find(s=>s.id===c?.sectionId)||c||{},current=()=>board.grades.find(g=>g.grade===grade),names=c=>(c?.teachers||[]).join(', ');
 const field=(label,id,value,extra='')=>'<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" value="'+esc(value)+'" '+extra+'></div>';
 function table(all=false){
  const grades=all?board.grades:board.grades.filter(g=>g.grade===grade);
  return grades.map(g=>{
   const matches=c=>!query||[section(c).subject,section(c).code,names(c)].join(' ').includes(query);
   const rooms=board.rooms.filter(r=>(all||!room||r.id===room)&&(all||!query||g.blocks.some(b=>b.cells[r.id]&&matches(b.cells[r.id]))));
   const blocks=g.blocks.filter(b=>all||!query||rooms.some(r=>b.cells[r.id]&&matches(b.cells[r.id])));
   if(!rooms.length||!blocks.length)return '<p class="empty">'+(query?'검색 결과가 없습니다.':g.grade+'학년의 시간블록을 추가해 주세요.')+'</p>';
   return '<section class="allocation-sheet"><h3>'+g.grade+'학년</h3><div class="allocation-scroll" tabindex="0" role="region" aria-label="'+g.grade+'학년 배치표, 가로로 스크롤"><table class="allocation-table"><caption class="sr-only">'+g.grade+'학년 이동수업 교실 배치표</caption><thead><tr><th scope="col">블록 / 교시</th>'+rooms.map(r=>'<th scope="col">'+esc(r.label)+(g.homerooms[r.id]?'<span class="allocation-teachers">'+esc(g.homerooms[r.id])+'</span>':'')+'</th>').join('')+'</tr></thead><tbody>'+blocks.map(b=>'<tr><th scope="row">'+(admin&&!all?'<button data-alloc="block" data-code="'+esc(b.code)+'" aria-label="'+esc(b.code+' '+b.slots.map(t=>t.day+t.period).join(', ')+' 시간블록 수정')+'">':'<span>')+esc(b.code)+'<span class="allocation-times">'+b.slots.map(t=>'<span class="allocation-time">'+t.day+t.period+'</span>').join(' ')+'</span>'+(admin&&!all?'</button>':'</span>')+'</th>'+rooms.map(r=>{const c=b.cells[r.id],s=section(c),content=c?'<strong>'+esc(s.subject)+' <span>'+esc(s.code)+'</span></strong><span class="allocation-teachers">'+esc(names(c))+'</span>':'<span class="allocation-vacant">'+(admin&&!all?'배치하기':'—')+'</span>';return '<td>'+(admin&&!all?'<button class="allocation-cell" data-alloc="cell" data-code="'+esc(b.code)+'" data-room="'+esc(r.id)+'" aria-label="'+g.grade+'학년 '+b.code+' '+esc(r.label+' '+(c?[s.subject,s.code,names(c)].join(' '):'빈 교실'))+' 배치 수정">'+content+'</button>':content)+'</td>';}).join('')+'</tr>').join('')+'</tbody></table></div></section>';
  }).join('');
 }
 function render(){
  const oldScroll=root.querySelector('.allocation-scroll'),position=oldScroll?{left:oldScroll.scrollLeft,top:oldScroll.scrollTop}:null,focused=document.activeElement,focusKey=focused&&root.contains(focused)?{id:focused.id,action:focused.dataset.alloc,code:focused.dataset.code,room:focused.dataset.room}:null;
  root.className='allocation-view';
  root.innerHTML='<div class="allocation-heading"><div><h2>이동수업 배치표</h2><p class="muted">'+(admin?'교실 칸을 선택해 과목·분반·교사를 배치하세요. 저장하면 시간표에 함께 반영됩니다.':'학년·교실을 선택하거나 과목·교사명으로 찾아보세요.')+'</p></div><div class="toolbar">'+(admin?'<span class="allocation-status" role="status">'+(dirty?'저장하지 않은 변경':'저장됨')+'</span><button data-alloc="save" class="primary" '+(!dirty?'disabled':'')+'>배치표 저장</button>':'')+'<button data-alloc="refresh">새로고침</button><button data-alloc="print">전체 인쇄</button></div></div><div class="allocation-filters"><div class="field"><label for="allocation-grade">학년</label><select id="allocation-grade">'+['3','2','1'].map(g=>'<option value="'+g+'" '+(g===grade?'selected':'')+'>'+g+'학년</option>').join('')+'</select></div><div class="field"><label for="allocation-room">교실</label><select id="allocation-room"><option value="">전체 교실</option>'+board.rooms.map(r=>'<option value="'+esc(r.id)+'" '+(room===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join('')+'</select></div><div class="field allocation-search">'+field('과목·교사 검색','allocation-query',query,'type="search" autocomplete="off"').replace(/^<div class="field">|<\/div>$/g,'')+'</div></div>'+(admin?'<div class="toolbar"><button data-alloc="block">시간블록 추가</button><button data-alloc="rooms">교실·담임 편집</button><button data-alloc="import">엑셀 불러오기</button><input id="allocation-file" type="file" accept=".xlsx,.xls" hidden></div>':'')+'<div id="allocation-grid">'+table()+'</div><div class="allocation-note muted">'+(admin?'담당 교사가 여러 명이면 쉼표로 구분합니다. 실제 교시의 교사는 교사 시간표와 연결합니다.':'교실·교사 정보는 관리자가 저장한 공통 자료입니다.')+'</div>';
  const scroll=root.querySelector('.allocation-scroll');if(scroll&&position){scroll.scrollLeft=position.left;scroll.scrollTop=position.top;}
  if(focusKey){const target=focusKey.id?root.querySelector('#'+CSS.escape(focusKey.id)):Array.from(root.querySelectorAll('[data-alloc]')).find(el=>el.dataset.alloc===focusKey.action&&el.dataset.code===focusKey.code&&el.dataset.room===focusKey.room);target?.focus({preventScroll:true});}
 }
 function changed(){dirty=true;render();}
 function close(){if(!dialog)return;dialog.close();dialog.remove();dialog=null;const opener=returnFocus;returnFocus=null;opener?.focus({preventScroll:true});}
 function open(title,body,save){
  close();returnFocus=document.activeElement;dialog=document.createElement('dialog');dialog.className='allocation-dialog';const titleId='allocation-dialog-'+crypto.randomUUID();dialog.setAttribute('aria-labelledby',titleId);dialog.innerHTML='<form><div class="modal-head"><h2 id="'+titleId+'">'+esc(title)+'</h2><button type="button" data-cancel aria-label="닫기">×</button></div>'+body+'<p class="error" role="alert"></p><div class="form-footer"><button type="button" data-cancel>취소</button><button type="submit" class="primary">적용</button></div></form>';root.append(dialog);
  dialog.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=close);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.querySelector('form').onsubmit=e=>{e.preventDefault();try{save(dialog);close();changed();}catch(error){dialog.querySelector('.error').textContent=error.message;}};dialog.showModal();
 }
 function editCell(code,id){
  const block=current().blocks.find(b=>b.code===code),cell=block.cells[id],s=section(cell),choices=sections.filter(s=>s.grade===grade&&/^([A-Za-z]+)/.exec(s.code)?.[1].toUpperCase()===code);
  open(grade+'학년 '+code+' · '+board.rooms.find(r=>r.id===id).label,'<div class="form-grid"><div class="field wide"><label for="allocation-existing">기존 분반 선택</label><select id="allocation-existing"><option value="">새 분반 작성</option>'+choices.map(c=>'<option value="'+esc(c.id)+'" '+(cell?.sectionId===c.id?'selected':'')+'>'+esc(c.subject+' '+c.code)+'</option>').join('')+'</select></div>'+field('과목','allocation-subject',s.subject||'','required maxlength="100"')+field('분반','allocation-code',s.code||code,'required maxlength="30"')+'<div class="wide">'+field('담당 교사','allocation-teachers',names(cell),'maxlength="1600" placeholder="예: 김교사, 이교사"')+'</div></div><label class="check-label allocation-remove"><input id="allocation-remove" type="checkbox">이 칸의 배치 삭제</label>',d=>{
   if(d.querySelector('#allocation-remove').checked){delete block.cells[id];return;}
   const sectionId=d.querySelector('#allocation-existing').value,subject=d.querySelector('#allocation-subject').value.trim(),sc=d.querySelector('#allocation-code').value.trim();if(!subject||!sc)throw Error('과목과 분반을 입력하세요.');
   const existing=sections.find(s=>s.id===sectionId);if(existing&&(existing.subject!==subject||existing.code!==sc))throw Error('기존 분반은 목록에서 선택하세요. 이름은 선택분반 메뉴에서 수정할 수 있습니다.');
   block.cells[id]={...(sectionId?{sectionId}:{}),subject,code:sc,teachers:d.querySelector('#allocation-teachers').value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean)};
  });
  dialog.querySelector('#allocation-existing').onchange=e=>{const s=sections.find(s=>s.id===e.target.value);dialog.querySelector('#allocation-subject').value=s?.subject||'';dialog.querySelector('#allocation-code').value=s?.code||code;};
 }
 function editBlock(code){
  const old=current()?.blocks.find(b=>b.code===code);
  open(old?'시간블록 수정':'시간블록 추가',field('시간블록','allocation-block',old?.code||'','required maxlength="8" placeholder="예: A"')+field('교시','allocation-slots',old?.slots.map(t=>t.day+t.period).join(', ')||'','placeholder="예: 화2, 수2, 금3"')+(old?'<label class="check-label allocation-remove"><input id="allocation-delete-block" type="checkbox">시간블록과 배치 삭제</label>':''),d=>{
   if(d.querySelector('#allocation-delete-block')?.checked){if(!confirm('이 시간블록의 배치를 모두 삭제할까요?'))throw Error('삭제를 취소했습니다.');current().blocks=current().blocks.filter(b=>b!==old);return;}
   const next=d.querySelector('#allocation-block').value.trim().toUpperCase();if(!/^[A-Z]+$/.test(next)||current()?.blocks.some(b=>b!==old&&b.code===next))throw Error('중복되지 않는 영문 시간블록을 입력하세요.');if(old&&next!==old.code&&Object.keys(old.cells).length)throw Error('배치가 있는 시간블록의 이름은 바꿀 수 없습니다.');
   const raw=d.querySelector('#allocation-slots').value.trim(),slots=raw?raw.split(/[,，\s]+/).filter(Boolean).map(v=>{const m=/^([월화수목금])([1-7])$/.exec(v);if(!m)throw Error('교시를 화2, 수2 형식으로 입력하세요.');return {day:m[1],period:Number(m[2])};}):[];
   if(!current())board.grades.push({grade,homerooms:{},blocks:[]});if(old){old.code=next;old.slots=slots;}else current().blocks.push({code:next,slots,cells:{}});
  });
 }
 function editRooms(){
  open('교실·담임 편집','<p class="muted">특별실은 반 번호를 비워 둡니다. 담임은 현재 선택한 '+grade+'학년의 정보입니다.</p><div class="allocation-room-editor">'+[...board.rooms,{id:'',label:'',classNum:''}].map((r,i)=>'<div data-room-id="'+esc(r.id)+'" class="allocation-room-row">'+field(r.id?'교실명':'새 교실명','room-label-'+i,r.label,'maxlength="100"')+field('반 번호','room-class-'+i,r.classNum,'inputmode="numeric" maxlength="2"')+field('담임','room-teacher-'+i,current()?.homerooms[r.id]||'','maxlength="80"')+(r.id?'<label class="check-label"><input type="checkbox" data-remove-room>삭제</label>':'')+'</div>').join('')+'</div>',d=>{
   const used=new Set(),homerooms={},rooms=[];d.querySelectorAll('[data-room-id]').forEach(row=>{if(row.querySelector('[data-remove-room]')?.checked)return;const inputs=row.querySelectorAll('input:not([type=checkbox])'),label=inputs[0].value.trim(),classNum=inputs[1].value.trim(),teacher=inputs[2].value.trim();if(!row.dataset.roomId&&!label)return;if(!label||used.has(label)||classNum&&!/^[1-9]\d?$/.test(classNum))throw Error('교실 이름과 반 번호를 확인하세요.');used.add(label);const r={id:row.dataset.roomId||crypto.randomUUID(),label,classNum};if(teacher)homerooms[r.id]=teacher;rooms.push(r);});
   const removed=board.rooms.filter(r=>!rooms.some(n=>n.id===r.id));if(removed.some(r=>board.grades.some(g=>g.blocks.some(b=>b.cells[r.id])))&&!confirm('삭제한 교실의 배치도 함께 삭제할까요?'))throw Error('교실 삭제를 취소했습니다.');
   board.grades.forEach(g=>{removed.forEach(r=>{delete g.homerooms[r.id];g.blocks.forEach(b=>delete b.cells[r.id]);});});if(!current())board.grades.push({grade,homerooms:{},blocks:[]});current().homerooms=homerooms;board.rooms=rooms;
  });
 }
 async function refresh(){if(dirty&&!confirm('저장하지 않은 배치표 변경을 버리고 새로고침할까요?'))return;const next=await request('allocation');data=next;board=structuredClone(next.board||blank());sections=next.sections;dirty=false;render();}
 root.addEventListener('click',e=>{const el=e.target.closest('[data-alloc]');if(!el||el.disabled)return;const action=el.dataset.alloc;
  (async()=>{
   if(action==='cell'&&admin)editCell(el.dataset.code,el.dataset.room);
   if(action==='block'&&admin)editBlock(el.dataset.code);
   if(action==='rooms'&&admin)editRooms();
   if(action==='refresh')await refresh();
   if(action==='print')await print('<h2>'+esc(data.meta.settings.academicYear+'학년도 '+data.meta.settings.semester+'학기 이동수업 교실 배치표')+'</h2>'+table(true),'allocation');
   if(action==='import'&&admin)root.querySelector('#allocation-file').click();
   if(action==='save'&&admin){el.disabled=true;root.inert=true;root.setAttribute('aria-busy','true');try{const reply=await request('saveAllocation',{board:structuredClone(board),expectedTerm:data.meta.term,expectedRevision:data.meta.revision,patch:true});dirty=false;onSaved(reply);const next=await request('allocation');data=next;board=structuredClone(next.board);sections=next.sections;render();if(reply.result.warnings.length)onError(Error(reply.result.warnings.join('\n')));}finally{root.inert=false;root.setAttribute('aria-busy','false');if(el.isConnected)el.disabled=false;}}
  })().catch(onError);
 });
 root.addEventListener('change',e=>{const el=e.target;if(el.id==='allocation-grade'){grade=el.value;render();}if(el.id==='allocation-room'){room=el.value;render();}if(el.id==='allocation-file'&&el.files[0]){(async()=>{await loadXlsx();await import('./allocation-import.js?v='+(window.TIMETABLE_CONFIG?.assetVersion||'1'));const next=await TTAllocationImport.file(el.files[0]);if((dirty||data.board)&&!confirm('불러온 파일로 현재 배치표 초안을 바꿀까요? 저장 전까지 기존 자료는 유지됩니다.'))return;board=next;grade=next.grades[0].grade;room='';query='';changed();})().catch(onError);}});
 root.addEventListener('input',e=>{if(e.target.id==='allocation-query'){query=e.target.value.trim();root.querySelector('#allocation-grid').innerHTML=table();}});
 render();return {get dirty(){return dirty;},get revision(){return data.meta.revision;},term:data.meta.term,refresh,destroy(){close();root.remove();}};
}
