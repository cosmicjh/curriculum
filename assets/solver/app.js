import {exportSolverModel} from '../course-allocation/shared/timetable-model.js';
import {DEFAULT_OPTIONS,validateModel,validateWarmStart} from '../course-allocation/shared/timetable-cpsat.js';
import {checkTimetable} from '../course-allocation/shared/timetable-checker.js';
import {teacherRows,makeWorkbook} from './excel.js';
import {storedResult} from './storage.js';

const weights=['over4','run3','lunch','firstlast'];
export function readControlOptions(root){
  const all=(selector,node=root)=>[...node.querySelectorAll(selector)];
  const buja=all('input[name="buja"]:checked').map(el=>el.value),gangsa=all('input[name="gangsa"]:checked').map(el=>el.value);
  const gangsaDayCount=Object.fromEntries(all('[data-gangsa-days]').filter(el=>gangsa.includes(el.dataset.teacher)&&Number(el.value)>0).map(el=>[el.dataset.teacher,Number(el.value)]));
  const pairAllowList=all('[data-pair] select').map(el=>el.value).filter(Boolean);
  const dependents=all('[data-dependent]').map(row=>({subject:row.querySelector('select').value,follows:all('input:checked',row).map(el=>el.value)})).filter(row=>row.subject);
  const blocks=new Map();
  for(const row of all('[data-block]')){
    const block=row.querySelector('select').value;if(!block)continue;
    if(!blocks.has(block))blocks.set(block,new Map());
    for(const cell of all('input:checked:not(:disabled)',row))blocks.get(block).set(cell.value,cell.value.split(',').map(Number));
  }
  return {buja,gangsa,weights:Object.fromEntries(weights.map(k=>[k,Number(root.querySelector('#'+k).value)])),pairAllowList,gangsaDayCount,dependents,blockTimeBan:Object.fromEntries([...blocks].map(([block,cells])=>[block,[...cells.values()]])),startLimit:Number(root.querySelector('#startLimit').value)};
}
export function readRunSettings(root){
  return {options:readControlOptions(root),limits:[1,2,3].map(i=>Number(root.querySelector('#limit'+i).value)),workers:Number(root.querySelector('#workers').value)};
}

async function start(){
const $=id=>document.getElementById(id),presets={fast:[0,120,60,30],normal:[0,1800,600,120],thorough:[0,3600,1200,300]},timeIds=['startLimit','limit1','limit2','limit3'];
let model=null,result=null,saved=null,warm=null,worker=null,wake=null,loading=false,fileReading=false,loadId=0,fileId=0,stage='준비',began=0,stageBegan=0;
let summaryModel=null,issueCounts={errors:0,warnings:0};
const drafts=new Map();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(s){$('message').textContent=s;}
function update(){
  $('run').disabled=!model||!!worker||loading||fileReading||!crossOriginIsolated;
  $('cancel').disabled=!worker;$('reload').disabled=loading||!!worker||fileReading;
  for(const el of $('form').elements)if(!['run','cancel'].includes(el.id))el.disabled=!!worker||loading||fileReading||!model||el.hasAttribute('data-unavailable');
  $('warm-run').querySelector('[value=saved]').disabled=!saved;
  $('block-add').disabled=!!worker||loading||fileReading||!model?.blocks.length;
}
const subjects=()=>[...new Set([...model.bans,...model.blocks].map(r=>r.subject))].sort((a,b)=>a.localeCompare(b,'ko'));
const blockNames=()=>[...new Set(model.blocks.map(r=>r.block))].sort((a,b)=>a.localeCompare(b,'ko'));
function selectOptions(items,current,placeholder='선택하세요'){
  const values=[...new Set([...items,...(current?[current]:[])])];
  return `<option value="">${placeholder}</option>`+values.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v)}${items.includes(v)?'':' (배당 없음)'}</option>`).join('');
}
function teacherChoices(role,selected){
  return [...model.teachers].sort((a,b)=>a.localeCompare(b,'ko')).map(t=>`<label class="teacher-choice"><input type="checkbox" name="${role}" value="${esc(t)}" ${selected.includes(t)?'checked':''}><span>${esc(t)}</span></label>`).join('');
}
function gangsaDays(o){
  $('gangsa-days').innerHTML=o.gangsa.map(t=>`<div class="gangsa-row"><span>${esc(t)} <span class="hint">주 ${[...model.bans,...model.blocks].filter(r=>r.teacher===t).reduce((n,r)=>n+r.hours,0)}시간</span></span><label>주당 출근 일수<select data-gangsa-days data-teacher="${esc(t)}" aria-label="${esc(t)} 주당 출근 일수"><option value="0">제한 없음</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${o.gangsaDayCount?.[t]===n?'selected':''}>${n}일</option>`).join('')}</select></label></div>`).join('')||'<p class="hint">지정된 강사가 없습니다.</p>';
}
function pairRow(subject=''){
  return `<div class="option-row" data-pair><label>과목<select aria-label="하루 2회 허용 과목">${selectOptions(subjects(),subject,'과목 선택')}</select></label><button type="button" data-remove aria-label="하루 2회 허용 과목 삭제">삭제</button></div>`;
}
function dependentRow(dep={subject:'',follows:[]}){
  const choices=[...new Set([...subjects(),...dep.follows])];
  return `<div class="dependent-row" data-dependent><div class="option-row"><label>주과목<select aria-label="종속 주과목">${selectOptions(subjects(),dep.subject,'주과목 선택')}</select></label><span class="relation-arrow" aria-hidden="true">←</span><button type="button" data-remove aria-label="종속 과목 삭제">삭제</button></div><fieldset class="follow-field"><legend>따르는 과목 · 여러 개 선택</legend><div class="follow-grid">${choices.map(s=>`<label class="teacher-choice"><input type="checkbox" value="${esc(s)}" ${dep.follows.includes(s)?'checked':''}><span>${esc(s)}${subjects().includes(s)?'':' (배당 없음)'}</span></label>`).join('')}</div></fieldset></div>`;
}
function blockRow(block='',cells=[]){
  const days=['월','화','수','목','금'];
  return `<div class="block-row" data-block><div class="option-row"><label>블록<select aria-label="금지 시간 블록">${selectOptions(blockNames(),block,'블록 선택')}</select></label><button type="button" data-remove aria-label="블록 금지 칸 삭제">삭제</button></div><table class="ban-grid"><caption class="hint">체크한 칸은 배치 금지</caption><thead><tr><th scope="col">교시</th>${days.map(d=>`<th scope="col">${d}</th>`).join('')}</tr></thead><tbody>${[1,2,3,4,5,6,7].map(p=>`<tr><th scope="row">${p}</th>${days.map((d,i)=>{const unavailable=i===0&&p===1||i===2&&p>=5;return `<td class="${unavailable?'unavailable':''}"><input type="checkbox" value="${i},${p}" aria-label="${d} ${p}교시 ${unavailable?'수업 없음':'금지'}" ${unavailable?'disabled data-unavailable':cells.some(([day,period])=>day===i&&period===p)?'checked':''}></td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function apply(o){
  $('buja').innerHTML=teacherChoices('buja',o.buja??[]);$('gangsa').innerHTML=teacherChoices('gangsa',o.gangsa??[]);gangsaDays(o);
  $('pairAllowList').innerHTML=(o.pairAllowList??[]).map(pairRow).join('');
  $('dependents').innerHTML=(o.dependents??[]).map(dependentRow).join('');
  $('blockTimeBan').innerHTML=Object.entries(o.blockTimeBan??{}).map(([block,cells])=>blockRow(block,cells)).join('');
  for(const k of weights){const current=o.weights?.[k]??1,choices=[[0,'없음'],[1,'약함'],[3,'보통'],[6,'강함'],[10,'매우 강함']];if(!choices.some(([v])=>v===current))choices.push([current,'불러온 값']);$(k).innerHTML=choices.map(([v,label])=>`<option value="${v}" ${v===current?'selected':''}>${label} (${v})</option>`).join('');}
  if(o.startLimit!==undefined)$('startLimit').value=o.startLimit;
  filterTeachers();renderStats();
}
function renderStats(){
  if(!summaryModel)return;const m=summaryModel,total=rows=>rows.reduce((n,r)=>n+r.hours,0),blocks=g=>[...new Map(m.blocks.filter(r=>r.grade===g).map(r=>[r.block,r.blockLen])).values()];
  const items=[['교사 수',m.teachers.length],['총 시수',total(m.bans)+total(m.blocks)],['반수업 시수',total(m.bans)],['이동수업 시수',total(m.blocks)],...['2','3'].map(g=>[g+'학년 블록',`${blocks(g).length}개 · ${blocks(g).reduce((a,b)=>a+b,0)}시간`]),['부장 수',model?document.querySelectorAll('input[name="buja"]:checked').length:m.buja.length],['강사 수',model?document.querySelectorAll('input[name="gangsa"]:checked').length:m.gangsa.length],['경고 수',issueCounts.warnings],['오류 수',issueCounts.errors]];
  $('allocation-stats').innerHTML=items.map(([label,value])=>`<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
}
function filterTeachers(){
  const search=$('buja-search').value.trim().toLocaleLowerCase();let count=0;
  for(const label of $('buja').querySelectorAll('label')){label.hidden=!label.textContent.toLocaleLowerCase().includes(search);if(!label.hidden)count++;}$('buja-empty').hidden=count>0;
}
function presetSummary(){
  const times=timeIds.map(k=>Number($(k).value));$('preset').value=Object.keys(presets).find(k=>presets[k].every((n,i)=>n===times[i]))??'custom';
  $('preset-summary').textContent=`0단계 ${times[0]}초 → 1단계 ${times[1]}초 → 2단계 ${times[2]}초 → 2.5단계 ${times[3]}초`;
}
function persist(){
  if(!model||loading)return;
  const value=readRunSettings(document);drafts.set(model.source.term,value);
  try{sessionStorage.setItem('timetable.solver.settings:'+model.source.term,JSON.stringify(value));$('draft-status').textContent='설정을 이 탭에 보관했습니다.';}
  catch{$('draft-status').textContent='설정은 메모리에만 유지됩니다. 새로고침하면 사라질 수 있습니다.';}
}
function restoreDraft(){
  let draft=drafts.get(model.source.term);
  try{draft=JSON.parse(sessionStorage.getItem('timetable.solver.settings:'+model.source.term))??draft;}catch{}
  if(draft?.options){
    const checked=validateModel(model,draft.options,draft.limits);
    if(!checked.errors.length&&Array.isArray(draft.limits)&&draft.limits.length===3&&Number.isInteger(draft.workers)&&draft.workers>=1&&draft.workers<=32){apply(draft.options);draft.limits.forEach((n,i)=>$('limit'+(i+1)).value=n);$('workers').value=draft.workers;$('draft-status').textContent='보관한 설정을 복원했습니다.';}
    else $('draft-status').textContent='이전 설정이 현재 배당과 다릅니다. 현재 배당의 기본값을 표시합니다.';
  }
  presetSummary();
}
function warmSummary(){
  if(!warm){$('warm-summary').innerHTML='시작점이 없으면 수십 분 이상 걸릴 수 있습니다. 처음부터 계산할 때는 <a href="https://github.com/cosmicjh/course-allocation/tree/main/timetable-solver" target="_blank" rel="noopener">로컬 솔버</a>도 사용할 수 있습니다.';return;}
  const current=new Set([...model.blocks,...model.bans].map(r=>r.rowId)),old=new Set([...(warm.SEC_PLACE??[]),...(warm.BAN_PLACE??[])].map(r=>r?.rowId).filter(r=>typeof r==='string'));
  const matched=[...old].filter(r=>current.has(r)).length;
  $('warm-summary').textContent=`학기 ${warm.source?.term??'정보 없음'} · 현재 학기 ${model.source.term} · rowId 대응 ${matched}/${old.size} (${old.size?Math.round(100*matched/old.size):0}%) · 0단계는 생략합니다.`;
}
async function load(){
  persist();
  const id=++loadId;loading=true;model=null;result=null;saved=null;warm=null;++fileId;fileReading=false;
  summaryModel=null;$('allocation-stats').replaceChildren();
  $('result-section').hidden=true;$('warm-file').value='';$('warm-run').value='';$('validation').textContent='확정 배당을 읽고 있습니다.';$('issues').replaceChildren();update();
  try{
    const [admin,workspace]=await Promise.all([TTApi.request('adminBootstrap',{workspaceOnly:true}),TTApi.request('courseWorkspace',{role:'admin',path:'/workspace',method:'GET',data:{all:true}})]);
    if(id!==loadId)return;
    const {global,parts,revisions}=workspace,term=global.school.year+'-'+global.school.semester;
    if(term!==admin.store.term)throw Error(`시수배당표 학기(${term})가 현재 학기(${admin.store.term})와 다릅니다. 시수배당표에서 학기를 확인하세요.`);
    const byId=new Map(parts.map(p=>[p.department.id,p])),ordered=global.departmentIds.map(key=>byId.get(key));
    if(ordered.some(p=>!p))throw Error('전체 교과군을 불러오지 못했습니다. 배당 다시 읽기를 눌러 주세요.');
    const source={school:global.school,departments:ordered.map(p=>p.department),departmentRevisions:revisions};
    for(const k of ['teachers','courses','groups','assignments','unmapped'])source[k]=ordered.flatMap(p=>p[k]);
    const exported=exportSolverModel(source,{exportedAt:new Date().toISOString()});
    summaryModel=exported.model;issueCounts={errors:exported.errors.length,warnings:exported.warnings.length};
    $('issue-summary').textContent=`오류 ${issueCounts.errors}건 · 경고 ${issueCounts.warnings}건 보기`;
    $('issues').innerHTML=[...exported.errors,...exported.warnings].map(e=>`<li>${esc(e)}</li>`).join('');
    $('validation').textContent=exported.errors.length?`오류 ${exported.errors.length}건 · 배당표를 수정한 뒤 다시 읽으세요.`:`${term} · 점검 통과`;
    renderStats();
    if(exported.errors.length)return;
    model=exported.model;apply({...DEFAULT_OPTIONS,...model.options,buja:model.buja,gangsa:model.gangsa});
    timeIds.forEach((k,i)=>$(k).value=presets.normal[i]);$('workers').value=Math.min(navigator.deviceMemory<8?4:8,navigator.hardwareConcurrency||4);restoreDraft();
    try{saved=await storedResult(term);if(saved){validateWarmStart(saved);warm=saved;$('warm-run').value='saved';}}
    catch{saved=null;message('이 브라우저의 이전 결과를 읽지 못했습니다. result.json을 선택할 수 있습니다.');}
    warmSummary();
  }catch(error){
    $('validation').textContent=error.message;
    if(error.code==='AUTH_REQUIRED')showLogin('관리자 로그인이 필요합니다.');
  }finally{if(id===loadId){loading=false;update();}}
}
function showLogin(text){++loadId;++fileId;loading=false;fileReading=false;model=null;result=null;saved=null;warm=null;$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;$('auth-message').textContent=text;update();}
async function open(){
  try{await TTApi.request('adminBootstrap',{workspaceOnly:true});$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('auth-message').textContent=crossOriginIsolated?'':'계산에 필요한 보안 헤더가 없습니다. Worker 도메인에서 이 페이지를 열어 주세요.';await load();}
  catch(error){showLogin(error.code==='AUTH_REQUIRED'?'관리자 로그인이 필요합니다.':error.message);}
}
$('login').onsubmit=async event=>{
  event.preventDefault();const button=$('login').querySelector('button');button.disabled=true;
  try{await TTApi.request('login',{role:'admin',password:$('password').value,initialize:true});$('password').value='';await open();}
  catch(error){$('auth-message').textContent=error.message;}finally{button.disabled=false;}
};
$('logout').onclick=async()=>{if(worker)stop('계산을 취소했습니다.');try{await TTApi.request('logout',{role:'admin'});showLogin('로그아웃했습니다.');}catch(e){message(e.message);}};
$('reload').onclick=load;
$('buja-search').oninput=filterTeachers;
$('preset').onchange=()=>{if(presets[$('preset').value])timeIds.forEach((k,i)=>$(k).value=presets[$('preset').value][i]);presetSummary();persist();};
$('form').addEventListener('input',event=>{
  if(timeIds.includes(event.target.id))presetSummary();
  if(event.target.id!=='buja-search'&&event.target.type!=='file')persist();
});
$('form').addEventListener('change',event=>{
  if(event.target.name==='gangsa'){gangsaDays(readControlOptions(document));update();}
  if(event.target.name==='buja'||event.target.name==='gangsa')renderStats();
  if(event.target.type!=='file')persist();
});
$('form').addEventListener('click',event=>{
  const add=event.target.closest('[data-add]'),remove=event.target.closest('[data-remove]');
  if(add){
    const target={pair:'pairAllowList',dependent:'dependents',block:'blockTimeBan'}[add.dataset.add];
    $(target).insertAdjacentHTML('beforeend',({pair:pairRow,dependent:dependentRow,block:blockRow})[add.dataset.add]());
    $(target).lastElementChild.querySelector('select').focus();update();persist();
  }else if(remove){
    const row=remove.closest('[data-pair],[data-dependent],[data-block]'),list=row.parentElement;row.remove();list.nextElementSibling.focus();persist();
  }
});
$('warm-run').onchange=()=>{++fileId;fileReading=false;$('warm-file').value='';warm=$('warm-run').value==='saved'?saved:null;warmSummary();update();};
$('warm-clear').onclick=()=>{++fileId;fileReading=false;warm=null;$('warm-run').value='';$('warm-file').value='';warmSummary();update();};
$('warm-file').onchange=async()=>{
  const file=$('warm-file').files[0],id=++fileId;warm=null;$('warm-run').value='';fileReading=!!file;update();
  try{if(file){if(file.size>32*1024*1024)throw Error('시작점 파일은 32MB 이하로 선택하세요.');const value=JSON.parse(await file.text());validateWarmStart(value);if(id===fileId)warm=value;}}
  catch(e){if(id===fileId)message(e.message);}finally{if(id===fileId){fileReading=false;warmSummary();update();}}
};
$('settings').onchange=async()=>{
  const file=$('settings').files[0];if(!file)return;const id=loadId;fileReading=true;update();
  try{
    if(file.size>1024*1024)throw Error('설정 파일은 1MB 이하로 선택하세요.');
    const value=JSON.parse(await file.text());if(value._type!=='고교학점제_설정'||value._version!==1||!value.timetable)throw Error('고교학점제_설정 버전 1 JSON을 선택하세요.');
    if(id!==loadId)return;const s=value.timetable,current=readControlOptions(document);
    const imported={...current,...s,weights:{...current.weights,...Object.fromEntries(Object.entries(s.weights??{}).map(([k,v])=>[k,Number(v)]))},...(s.pairAllow?{pairAllowList:s.pairAllow}:{}),...(s.bujaList?{buja:s.bujaList}:{}),...(s.gangsaList?{gangsa:s.gangsaList}:{}),...(s.gangsaDayCount?{gangsaDayCount:Object.fromEntries(Object.entries(s.gangsaDayCount).filter(([,n])=>Number(n)>0).map(([t,n])=>[t,Number(n)]))}:{})};
    const limits=s.limits??[1,2,3].map(i=>Number($('limit'+i).value)),checked=validateModel(model,imported,limits);
    if(checked.errors.length)throw Error(checked.errors.join(' · '));
    apply(imported);limits.forEach((n,i)=>$('limit'+(i+1)).value=n);presetSummary();persist();message('설정을 불러왔습니다.');
  }catch(e){message(e.message);}finally{fileReading=false;update();}
};
function stages(items){
  $('stages').innerHTML='<div class="table-wrap"><table><thead><tr><th>단계</th><th>상태</th><th>목적값</th><th>소요 초</th><th>채택</th></tr></thead><tbody>'+items.map(s=>`<tr><td>${esc(s.stage)}</td><td>${esc(s.status)}</td><td>${esc(s.objective??'—')}</td><td>${Number(s.wall_time).toFixed(2)}</td><td>${s.adopted?'채택':''}</td></tr>`).join('')+'</tbody></table></div>';
}
function clock(){if(worker)$('progress').textContent=`${stage} · 전체 ${Math.floor((performance.now()-began)/1000)}초 · 단계 ${Math.floor((performance.now()-stageBegan)/1000)}초`;}
setInterval(clock,1000);
async function lock(){try{if('wakeLock' in navigator){const requested=await navigator.wakeLock.request('screen');if(worker)wake=requested;else await requested.release();}}catch{/* The calculation works without a wake lock. */}}
document.addEventListener('visibilitychange',()=>{if(worker&&!document.hidden)lock();});
function stop(text){worker?.terminate();worker=null;wake?.release().catch(()=>{});wake=null;$('keep-open').hidden=true;message(text);$('progress').textContent=text;update();}
function renderResult(){
  $('result-section').hidden=false;$('result-status').textContent=`${result.status} · ${result.checker.status}`;
  $('result').innerHTML=(result.checker.errors.length?'<ul>'+result.checker.errors.map(e=>`<li>${esc(e)}</li>`).join('')+'</ul>':'')+model.teachers.map(t=>`<details><summary>${esc(t)}${result.scores?.[t]!==undefined?' · 불편 '+esc(result.scores[t]):''}</summary><div class="table-wrap"><table><tbody>${teacherRows(t,result).map((r,i)=>'<tr>'+r.map((v,j)=>`<${i===0||j===0?'th':'td'}>${esc(v)}</${i===0||j===0?'th':'td'}>`).join('')+'</tr>').join('')}</tbody></table></div></details>`).join('');
  stages(result.stages);
}
async function save(){
  const current=result,term=model.source.term;
  try{await storedResult(term,current);if(result!==current)return;saved=current;$('storage-status').textContent='이 브라우저에 저장했습니다.';update();}
  catch{if(result===current)$('storage-status').textContent='저장하지 못했습니다. result.json을 내려받아 보관하세요.';}
}
$('form').onsubmit=event=>{
  event.preventDefault();if(!model||worker||loading||fileReading)return;
  try{
    if(!crossOriginIsolated)throw Error('Worker 도메인에서 계산 페이지를 열어 주세요.');
    const {options:o,limits,workers}=readRunSettings(document),checked=validateModel(model,o,limits);
    if(checked.errors.length)throw Error(checked.errors.join('\n'));
    if(!Number.isInteger(workers)||workers<1||workers>32)throw Error('워커 수는 1~32 정수로 입력하세요.');
    if(warm)validateWarmStart(warm);
    result=null;$('result-section').hidden=true;$('storage-status').textContent='';$('stages').replaceChildren();
    worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});const active=worker;began=stageBegan=performance.now();stage='엔진 준비';
    active.onmessage=async({data})=>{
      if(worker!==active)return;
      if(data.type==='progress'){const p=data.progress;if(p.type==='stage-start'){stage=p.stage+'단계';stageBegan=performance.now();}stages(p.stages);clock();}
      else if(data.type==='error')stop(`계산 오류: ${data.message} · 메모리가 부족하면 워커 수를 줄여 다시 실행하세요.`);
      else if(data.type==='result'){
        result=data.result;
        if(result.BAN_PLACE){result.checker=checkTimetable(checked.model,result,checked.options);if(!result.checker.ok)result.status='검증 실패';}
        result.source=model.source;stop(`계산 완료 · ${result.status}`);
        if(result.BAN_PLACE){renderResult();await save();}else{stages(result.stages);message([result.status,...(result.errors??[])].join(' · '));}
      }
    };
    active.onerror=()=>stop('계산 워커가 중단되었습니다. 메모리가 부족하면 워커 수를 줄여 다시 실행하세요.');
    active.postMessage({model,options:o,limits,workers,warmStart:warm});$('keep-open').hidden=false;message('계산 중');update();clock();lock();
  }catch(e){stop(e.message);}
};
$('cancel').onclick=()=>stop('계산을 취소했습니다.');
$('save').onclick=save;
$('json').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('excel').onclick=async()=>{const button=$('excel');button.disabled=true;const current=result,currentModel=model;try{const XLSX=await TTAssets.load('xlsx');XLSX.writeFile(makeWorkbook(XLSX,currentModel,current),'result.xlsx');}catch(e){message(e.message);}finally{button.disabled=false;}};
window.addEventListener('beforeunload',event=>{if(worker){event.preventDefault();event.returnValue='';}});
$('workers').value=Math.min(navigator.deviceMemory<8?4:8,navigator.hardwareConcurrency||4);
update();await open();
}
if(typeof document!=='undefined')await start();
