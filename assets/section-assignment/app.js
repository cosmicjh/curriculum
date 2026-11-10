import { escapeHtml, courseGroupCounts, ensureParallelCapacity, validateResult, studentDisplay, parseWorkbook, buildSections, computeConflictSections, pairKey, courseSpreadSummary, ensureCoupledConfiguration, auditCoupledCohorts, runSheet } from "./engine.js";

export function mountSectionAssignment(bridge){
let XLSX;
window.hasSectionAssignmentWork=()=>Boolean(loadedData||isRunning);
const main=document.querySelector('main');
new ResizeObserver(()=>{if(main.offsetHeight)bridge.resize(main.offsetHeight);}).observe(main);
// 결과 xlsx
// ============================================================

function sectionDisplayCodes(sheet,result) {
  const labels=sheet.algoState.sections.map((_,sid)=>String(sheet.groups[result.secToGroup[sid]] || '?'));
  for(const ids of Object.values(sheet.algoState.courseToSections)) {
    const byGroup=new Map();
    for(const sid of ids){const g=result.secToGroup[sid];if(!byGroup.has(g))byGroup.set(g,[]);byGroup.get(g).push(sid);}
    for(const [g,sids] of byGroup)if(sids.length>1) {
      sids.sort((a,b)=>sheet.algoState.sections[a].idx-sheet.algoState.sections[b].idx);
      for(let i=0;i<sids.length;i++)labels[sids[i]]=String(sheet.groups[g])+(i+1);
    }
  }
  const cohort=auditCoupledCohorts(sheet,result);
  if(!cohort.ok)throw new Error('2+1 동일 학생 구성 검증 실패: '+cohort.errors.slice(0,3).join('; '));
  for(const link of cohort.links)labels[link.parentSid]=labels[link.childSid];
  // User-defined base codes such as A and A1 must not collide after suffixing.
  for(const [course,ids] of Object.entries(sheet.algoState.courseToSections)) {
    const seen=new Set();for(const sid of ids){if(seen.has(labels[sid]))throw new Error(`'${course}'의 표시 코드 ${labels[sid]}가 중복됩니다. 시간블록 코드명을 변경해 주세요.`);seen.add(labels[sid]);}
  }
  return labels;
}

function buildOutputWorkbook(allSheets, allSheetResults, candidateIndex) {
  // allSheetResults[si] = { topCandidates: [...], ... }
  // candidateIndex 번째 후보를 사용
  const wb = XLSX.utils.book_new();
  function appendSheet(ws, requested) {
    let name=requested.slice(0,31), suffix=1;
    while(wb.SheetNames.includes(name)) {const tail='_'+suffix++;name=requested.slice(0,31-tail.length)+tail;}
    XLSX.utils.book_append_sheet(wb,ws,name);
  }

  const labelBySheet=allSheets.map((sh,si)=>sectionDisplayCodes(sh,allSheetResults[si].topCandidates[Math.min(candidateIndex,allSheetResults[si].topCandidates.length-1)].result));
  // 각 시트별 result를 candidateIndex 위치에서 가져옴 (없으면 마지막)
  function getResult(si) {
    const list = allSheetResults[si].topCandidates;
    const idx = Math.min(candidateIndex, list.length - 1);
    return list[idx].result;
  }
  function getSeed(si) {
    const list = allSheetResults[si].topCandidates;
    const idx = Math.min(candidateIndex, list.length - 1);
    return list[idx].seed;
  }

  for (let si = 0; si < allSheets.length; si++) {
    const sheet = allSheets[si];
    const result = getResult(si);
    const { secToGroup } = result;
    const out = sheet.rows.map(r => r ? r.slice() : []);

    for (const stu of sheet.students) {
      const ass = result.assignments[stu.rowIndex];
      const r = out[stu.rowIndex];
      if (!r) continue;
      for (const cc of sheet.courseCols) {
        r[cc.colIdx] = '';
      }
      if (!ass) {
        for (const c of stu.selected) {
          const cc = sheet.courseCols.find(x => x.name === c);
          if (cc) r[cc.colIdx] = '미배정';
        }
      } else {
        for (let i = 0; i < stu.selected.length; i++) {
          const cc = sheet.courseCols.find(x => x.name === stu.selected[i]);
          if (!cc) continue;
          const sid = ass[i];
          if (sid === -1) {
            r[cc.colIdx] = '미배정';
          } else {
            const g = secToGroup[sid];
            const groupLabel = labelBySheet[si][sid];
            r[cc.colIdx] = groupLabel;
          }
        }
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(out);
    appendSheet(ws, sheet.name);
  }

  const roster=[['시트','학번','학년','반','번호','이름','과목','분반 코드','과목 내 분반 번호','고유 분반 ID','배정 상태','시간블록 코드']];
  const audits=[['시트','후보 순위','검증','배정 상태','미배정 과목 수','최대 편차','시드','동시 분반 상한 검증','2+1 동일 학생 구성']];
  for(let si=0;si<allSheets.length;si++) {
    const sh=allSheets[si],r=getResult(si),v=r.validation;
    if(!v || !v.ok) throw new Error('검증되지 않은 결과는 출력할 수 없습니다.');
    const counts=courseGroupCounts(sh,r.secToGroup,sh.groups.length);
    const limits=v.parallelLimits;
    if(!limits || Object.entries(counts).some(([c,ns])=>!Number.isInteger(limits[c])||limits[c]<1||ns.some(n=>n>limits[c])))throw new Error('동시 분반 상한을 통과하지 않은 결과는 출력할 수 없습니다.');
    audits.push([sh.name,Math.min(candidateIndex+1,allSheetResults[si].topCandidates.length),'통과',v.complete?'완전배정':'미완성·검토용',v.missingTotal,courseSpreadSummary(sh,r.sectionLoad).maxSpread,getSeed(si),'통과',auditCoupledCohorts(sh,r).ok?'통과':'실패']);
    for(const stu of sh.students) for(let ci=0;ci<stu.selected.length;ci++) {
      const sid=r.assignments[stu.rowIndex]?.[ci] ?? -1, sec=sid===-1?null:sh.algoState.sections[sid];
      roster.push([sh.name,stu.studentId ?? '',stu.grade,stu.cls,stu.num,stu.name,stu.selected[ci],sec?labelBySheet[si][sid]:'',sec?sec.idx:'',sec?`S${si+1}-SEC${sid+1}`:'',sec?'배정':'미배정',sec?sh.groups[r.secToGroup[sid]]:'']);
    }
  }
  const wsRoster=XLSX.utils.aoa_to_sheet(roster);
  wsRoster['!cols']=[{wch:18},{wch:12},{wch:6},{wch:6},{wch:6},{wch:12},{wch:26},{wch:12},{wch:16},{wch:18},{wch:12},{wch:14}];
  appendSheet(wsRoster,'학생별 분반 명단');
  appendSheet(XLSX.utils.aoa_to_sheet(audits),'결과 검증');

  // 그룹별 시간표
  const groupRows = [['시트', '분반 코드', '코드 학점', '과목', '과목 학점', '분반 일련번호', '인원', '시간블록 코드']];
  for (let si = 0; si < allSheets.length; si++) {
    const sheet = allSheets[si];
    const result = getResult(si);
    const { sections } = sheet.algoState;
    for (let g = 0; g < sheet.groups.length; g++) {
      const items = [];
      for (let sid = 0; sid < sections.length; sid++) {
        if (result.secToGroup[sid] === g) items.push(sid);
      }
      items.sort((a, b) => sections[a].course.localeCompare(sections[b].course, 'ko'));
      for (const sid of items) {
        groupRows.push([
          sheet.name,
          labelBySheet[si][sid],
          sheet.groupCredits[g] || 3,
          sections[sid].course,
          sheet.courseCredits[sections[sid].course] || 3,
          sections[sid].idx,
          result.sectionLoad[sid],
          sheet.groups[g],
        ]);
      }
      const total = items.reduce((a, sid) => a + result.sectionLoad[sid], 0);
      groupRows.push([sheet.name, `${sheet.groups[g]} 수강건수 합계`, sheet.groupCredits[g] || 3, '', '', '', total]);
      groupRows.push(['', '', '', '', '', '', '']);
    }
  }
  const wsGroups = XLSX.utils.aoa_to_sheet(groupRows);
  wsGroups['!cols'] = [{wch:18},{wch:12},{wch:10},{wch:26},{wch:10},{wch:14},{wch:8},{wch:14}];
  appendSheet(wsGroups, '코드별 시간표');

  // 미배정 학생
  const unRows = [['시트', '학번', '학년', '반', '번호', '이름', '미배정 유형', '미배정 과목', '배정된 과목']];
  for (let si = 0; si < allSheets.length; si++) {
    const sheet = allSheets[si];
    const result = getResult(si);
    const groupLabel = (g) => `${sheet.groups[g] || '?'}`;
    for (const stu of result.unassigned) {
      unRows.push([sheet.name, stu.studentId || '', stu.grade, stu.cls, stu.num, stu.name,
        '전체 미배정', stu.selected.join(', '), '']);
    }
    for (const pm of result.partialMisses) {
      const stu = pm.student;
      const ass = result.assignments[stu.rowIndex];
      const assigned = [];
      for (let i = 0; i < stu.selected.length; i++) {
        if (ass[i] !== -1) {
          assigned.push(`${stu.selected[i]}(${labelBySheet[si][ass[i]]})`);
        }
      }
      unRows.push([sheet.name, stu.studentId || '', stu.grade, stu.cls, stu.num, stu.name,
        `부분 미배정 (${pm.missing.length}/${stu.selected.length})`,
        pm.missing.join(', '), assigned.join(', ')]);
    }
  }
  const wsUn = XLSX.utils.aoa_to_sheet(unRows);
  wsUn['!cols'] = [{wch:18},{wch:12},{wch:6},{wch:6},{wch:6},{wch:10},{wch:18},{wch:50},{wch:60}];
  appendSheet(wsUn, '미배정 학생');

  // 과목별 통계
  const statRows = [['시트', '과목', '분반수', '신청자수', '배정완료', '최대-최소 편차', '분반별 인원', '동시 분반 상한', '최대 동시 분반 수']];
  for (let si = 0; si < allSheets.length; si++) {
    const sheet = allSheets[si];
    const result = getResult(si);
    const groupLabel = (g) => `${sheet.groups[g] || '?'}`;
    const { courseToSections } = sheet.algoState;
    const parallelCounts=courseGroupCounts(sheet,result.secToGroup,sheet.groups.length);
    for (const c of Object.keys(courseToSections)) {
      const secs = courseToSections[c];
      let applicants = 0;
      for (const stu of sheet.students) if (stu.selected.includes(c)) applicants++;
      const total = secs.reduce((a, sid) => a + result.sectionLoad[sid], 0);
      const detail=secs.slice().sort((a,b)=>result.secToGroup[a]-result.secToGroup[b] || sectionsIndex(a)-sectionsIndex(b)).map(sid=>`${labelBySheet[si][sid]}: ${result.sectionLoad[sid]}`).join(', ');
      function sectionsIndex(sid){return sheet.algoState.sections[sid].idx;}
      const loads = secs.map(sid => result.sectionLoad[sid]);
      const diff = loads.length ? Math.max(...loads) - Math.min(...loads) : 0;
      statRows.push([sheet.name, c, secs.length, applicants, total, diff, detail,result.validation.parallelLimits[c],Math.max(0,...parallelCounts[c])]);
    }
  }
  const wsStat = XLSX.utils.aoa_to_sheet(statRows);
  wsStat['!cols'] = [{wch:15},{wch:24},{wch:8},{wch:10},{wch:10},{wch:14},{wch:60},{wch:18},{wch:20}];
  appendSheet(wsStat, '과목별 통계');

  // 설정 요약
  const cfgRows = [['구분','시트','항목','값1','값2','값3']];
  for (const sheet of allSheets) {
    cfgRows.push(['분반코드', sheet.name, sheet.groups.join(', '), sheet.groupCredits.join(', '), '', '']);
    cfgRows.push(['선택검증', sheet.name, '기대 총학점', sheet.expectedTotalCredits == null ? '자동' : sheet.expectedTotalCredits, '', '']);
    cfgRows.push(['공통정원', sheet.name, '분반당 최대 인원', (loadedData && loadedData.globalMax) || 35, '', '']);
    if (coverageEnabled[sheet.name]) {
      cfgRows.push(['코드커버리지', sheet.name, (coverageCourses[sheet.name] || []).join(', '), '모든 코드 커버 강제', '', '']);
    }
    for (const c of Object.keys(sheet.courses)) {
      cfgRows.push(['과목', sheet.name, c, `학점 ${sheet.courseCredits[c] || 3}`, `분반 ${sheet.courses[c]}`, '', '']);
    }
    const savedLimits=getResult(allSheets.indexOf(sheet)).validation.parallelLimits;
    for(const [c,limit]of Object.entries(savedLimits))cfgRows.push(['동시분반상한',sheet.name,c,limit,'같은 시간블록 최대 분반 수','강제조건']);
    const pairs = (sheet.creditPairList || []);
    for (const p of pairs) cfgRows.push(['2+1결합', sheet.name, p.course2, p.course1, '동일 학생 구성', '강제조건']);
    const si=allSheets.indexOf(sheet), cohort=auditCoupledCohorts(sheet,getResult(si));
    for(const link of cohort.links)cfgRows.push(['2+1분반연결',sheet.name,link.course2+' '+labelBySheet[si][link.parentSid],link.course1+' '+labelBySheet[si][link.childSid],link.count,'동일 학생 구성']);
  }
  cfgRows.push(['출력표기','','복수분반','2+1 결합: 동일 코드','A1·A2는 같은 A 시간블록','']);
  cfgRows.push(['버전','','도구','v19','','']);
  for (const [k,v] of Object.entries(lastRunSettings || {})) cfgRows.push(['실행옵션','',k,String(v),'','']);
  for (const p of avoidPairs) cfgRows.push(['기피',p.sheetName,`원본 ${p.requesterRow+1}행`,(p.targetRows||[]).map(r=>r+1).join(', '),'대상 원본 행','']);
  for (const g of teacherGroups) cfgRows.push(['교사공유',g.sheetName,(g.courses||[]).join(', '),'','','']);
  for (const e of bigsecEntries) cfgRows.push(['대분반',e.sheetName,e.course,'','','']);
  const wsCfg = XLSX.utils.aoa_to_sheet(cfgRows);
  wsCfg['!cols'] = [{wch:12},{wch:18},{wch:28},{wch:18},{wch:18},{wch:18}];
  appendSheet(wsCfg, '설정 요약');

  return wb;
}

// ============================================================
// UI 와이어링
// ============================================================
let isRunning=false, fileLoadToken=0, cancelActive=null;
let lastRunSettings=null, resultIncomplete=[];
let hoursExportResults=null;
let lockedControls=[];
function invalidateResults() {
  resultIncomplete=[];hoursExportResults=null;
  document.getElementById("hoursExportCard").classList.add("hidden");
  downloadBtn.classList.add('hidden');summary.classList.add('hidden');
}
function setBusy(busy) {
  isRunning=busy;
  if(busy) {
    lockedControls=[...document.querySelectorAll('input,select,button')].map(el=>[el,el.disabled]);
    for(const [el] of lockedControls) el.disabled=true;
  } else {
    for(const [el,disabled] of lockedControls) el.disabled=disabled;
    lockedControls=[];
  }
  document.getElementById('cancelBtn').disabled=!busy;
  document.getElementById('cancelBtn').classList.toggle('hidden',!busy);
}
function runSheetInWorker(sheet,opts,logFn) {
  return new Promise((resolve,reject)=>{
    const url=new URL('./worker.js',location.href);
    url.search=location.search;
    const worker=new Worker(url,{type:'module'});
    const finish=(error,result)=>{
      worker.terminate();cancelActive=null;
      error?reject(error):resolve(result);
    };
    cancelActive=()=>finish(new Error('사용자가 계산을 중지했습니다.'));
    worker.onerror=e=>{e.preventDefault();finish(new Error('계산 오류: '+e.message));};
    worker.onmessage=e=>{
      if(e.data.type==='log')logFn(e.data.msg,e.data.cls);
      else if(e.data.type==='error')finish(new Error(e.data.message));
      else if(e.data.type==='result')finish(null,e.data.result);
    };
    worker.onmessageerror=()=>finish(new Error('계산 결과를 읽지 못했습니다.'));
    try{worker.postMessage({sheet,opts});}catch(error){finish(error);}
  });
}
let loadedData = null;
let resultFilename = null;
let bigsecEntries = [];
let avoidPairs = []; // [{ sheetName, requesterRow, targetRows: [] }]
let teacherGroups = []; // [{ sheetName, courses: [] }]
let coverageEnabled = {}; // { sheetName: bool }
let coverageCourses = {}; // { sheetName: [courseName, ...] }
let creditPairs = []; // [{ sheetName, course2, course1 }]
let studentByLabel = new Map();
let coursesBySheet = {}; // { sheetName: Set<courseName> }

const fileArea = document.getElementById('fileArea');
const fileInput = document.getElementById('fileInput');
const fileSelectBtn = document.getElementById('fileSelectBtn');
const filename = document.getElementById('filename');
const sheetsCard = document.getElementById('sheetsCard');
const sheetsTable = document.getElementById('sheetsTable');
const optionsCard = document.getElementById('optionsCard');
const courseConfigCard = document.getElementById('courseConfigCard');
const courseConfigTable = document.getElementById('courseConfigTable');
const creditPairCard = document.getElementById('creditPairCard');
const creditPairList = document.getElementById('creditPairList');
const addCreditPairBtn = document.getElementById('addCreditPairBtn');
const creditPairHint = document.getElementById('creditPairHint');
const applyDefaultMaxBtn = document.getElementById('applyDefaultMaxBtn');
const bigsecCard = document.getElementById('bigsecCard');
const avoidCard = document.getElementById('avoidCard');
const teacherCard = document.getElementById('teacherCard');
const coverageCard = document.getElementById('coverageCard');
const runCard = document.getElementById('runCard');
const runBtn = document.getElementById('runBtn');
const downloadBtn = document.getElementById('downloadBtn');
const progress = document.getElementById('progress');
const summary = document.getElementById('summary');
const coursesList = document.getElementById('coursesList');
const bigsecList = document.getElementById('bigsecList');
const addBigsecBtn = document.getElementById('addBigsecBtn');
const bigsecHint = document.getElementById('bigsecHint');
const studentsList = document.getElementById('studentsList');
const avoidList = document.getElementById('avoidList');
const addAvoidBtn = document.getElementById('addAvoidBtn');
const avoidHint = document.getElementById('avoidHint');
const teacherList = document.getElementById('teacherList');
const addTeacherBtn = document.getElementById('addTeacherBtn');
const teacherHint = document.getElementById('teacherHint');
const coverageList = document.getElementById('coverageList');

fileSelectBtn.addEventListener('click', () => fileInput.click());
fileArea.addEventListener('dragenter', e => {
  e.preventDefault();
  fileArea.classList.add('dragging');
});
fileArea.addEventListener('dragover', e => {
  e.preventDefault();
  fileArea.classList.add('dragging');
});
fileArea.addEventListener('dragleave', e => {
  if (!fileArea.contains(e.relatedTarget)) fileArea.classList.remove('dragging');
});
fileArea.addEventListener('drop', e => {
  e.preventDefault();
  fileArea.classList.remove('dragging');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  if(isRunning)return;
  const token=++fileLoadToken;
  invalidateResults();loadedData=null;runBtn.disabled=true;filename.textContent='파일 읽는 중…';
  for(const id of ['sheetsCard','courseConfigCard','creditPairCard','optionsCard','bigsecCard','avoidCard','teacherCard','coverageCard','runCard'])document.getElementById(id).classList.add('hidden');
  fileArea.classList.remove('has-file');
  Promise.all([file.arrayBuffer(),bridge.loadXlsx()]).then(([buffer,library])=>{
    if(token!==fileLoadToken)return;
    try {
      XLSX=library;
      const data = new Uint8Array(buffer);
      const wb = XLSX.read(data, { type: 'array' });
      loadedData = parseWorkbook(wb,XLSX);
      runBtn.disabled=false;
      filename.textContent = file.name;
      fileInput.value='';
      fileArea.classList.add('has-file');
      resultFilename = file.name.replace(/\.[^.]+$/, '') + '_분반배정결과.xlsx';
      document.getElementById('optMax').value = loadedData.globalMax || 35;

      renderSheetsTable();
      renderCourseConfig();
      creditPairs = [];
      renderCreditPairs();
      sheetsCard.classList.remove('hidden');
      courseConfigCard.classList.remove('hidden');
      creditPairCard.classList.remove('hidden');
      optionsCard.classList.remove('hidden');
      bigsecCard.classList.remove('hidden');
      avoidCard.classList.remove('hidden');
      teacherCard.classList.remove('hidden');
      coverageCard.classList.remove('hidden');
      runCard.classList.remove('hidden');

      buildCourseDatalist();
      buildStudentDatalist();
      bigsecEntries = [];
      renderBigsecList();
      addBigsecBtn.disabled = false;
      bigsecHint.textContent = '';

      avoidPairs = [];
      renderAvoidPairs();
      addAvoidBtn.disabled = false;
      avoidHint.textContent = '';

      teacherGroups = [];
      renderTeacherGroups();
      addTeacherBtn.disabled = false;
      teacherHint.textContent = '';

      coverageEnabled = {};
      coverageCourses = {};
      for (const s of loadedData.sheets) {
        coverageEnabled[s.name] = false;
        coverageCourses[s.name] = [];
      }
      renderCoverage();

    } catch (err) {
      loadedData=null;filename.textContent='파일 읽기 실패';runBtn.disabled=true;
      filename.textContent='파일 읽기 실패 · '+err.message;
      fileInput.value='';
      console.error(err);
    }
  }).catch(error=>{if(token===fileLoadToken)filename.textContent='파일 읽기 실패 · '+error.message;});
}

function parseGroupSpec(text) {
  const groups = [], credits = [], seen = new Set();
  for (const raw of text.split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const parts = t.split(':');
    const code = (parts[0] || '').trim();
    const cr = parts.length > 1 ? Number(parts[1]) : 3;
    if(parts.length>2) throw new Error('코드:학점 형식을 확인해 주세요.');
    if (!code) continue;
    if (seen.has(code)) throw new Error(`중복 분반 코드: ${code}`);
    if (!Number.isInteger(cr) || cr < 1 || cr > 10) throw new Error(`${code}의 학점이 올바르지 않습니다.`);
    seen.add(code); groups.push(code); credits.push(cr);
  }
  if (groups.length === 0) throw new Error('분반 코드를 하나 이상 입력해 주세요.');
  return { groups, credits };
}

function renderSheetsTable() {
  const rows = ['<thead><tr><th>시트명</th><th>학생수</th><th>학생당 선택수</th><th>기대 총학점</th><th>분반 코드 · 학점</th></tr></thead><tbody>'];
  loadedData.sheets.forEach((s, i) => {
    const counts = [...s.perCounts].sort((a,b)=>a-b);
    const countText = counts.length === 1 ? String(counts[0]) : `${counts[0]}–${counts[counts.length-1]}`;
    const groupStr = s.groups.map((g,idx) => `${g}:${s.groupCredits[idx] || 3}`).join(', ');
    rows.push(`<tr>
      <td>${escapeHtml(s.name)}</td><td>${s.students.length}</td><td>${countText}</td>
      <td><input type="number" min="0" max="100" placeholder="자동" title="빈칸: 자동 · 0: 검증 안 함" aria-label="${escapeHtml(s.name)} 기대 총학점" data-expected-credit="${i}" value="${s.expectedTotalCredits == null ? '' : Number(s.expectedTotalCredits)}" style="min-width:78px"></td>
      <td><input type="text" placeholder="A:3, B:3, C:3" title="코드:학점, 쉼표로 구분" aria-label="${escapeHtml(s.name)} 분반 코드와 학점" data-sheet-idx="${i}" value="${escapeHtml(groupStr)}"></td>
    </tr>`);
  });
  rows.push('</tbody>');
  sheetsTable.innerHTML = rows.join('');
  sheetsTable.querySelectorAll('input[data-expected-credit]').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = +inp.dataset.expectedCredit;
      const raw = inp.value.trim();
      if (raw === '') {
        loadedData.sheets[idx].expectedTotalCredits = null;
        return;
      }
      const v = Number(raw);
      if (!Number.isInteger(v) || v < 0 || v > 100) {
        alert('기대 총학점은 빈칸(자동) 또는 0 이상의 숫자로 입력해 주세요.');
        const prev = loadedData.sheets[idx].expectedTotalCredits;
        inp.value = prev == null ? '' : prev;
        return;
      }
      loadedData.sheets[idx].expectedTotalCredits = v;
    });
  });
  sheetsTable.querySelectorAll('input[data-sheet-idx]').forEach(inp => {
    inp.addEventListener('change', () => {
      const idx = +inp.dataset.sheetIdx;
      try {
        const parsed = parseGroupSpec(inp.value);
        loadedData.sheets[idx].groups = parsed.groups;
        loadedData.sheets[idx].groupCredits = parsed.credits;
        renderCoverage();
      } catch (e) {
        alert(e.message);
        const sh = loadedData.sheets[idx];
        inp.value = sh.groups.map((g,j)=>`${g}:${sh.groupCredits[j] || 3}`).join(', ');
      }
    });
  });
}

function renderCourseConfig() {
  const rows = ['<thead><tr><th>시트</th><th>과목</th><th>신청자</th><th>학점</th><th>분반 수</th><th>분반당 인원</th></tr></thead><tbody>'];
  for (let si = 0; si < loadedData.sheets.length; si++) {
    const sheet = loadedData.sheets[si];
    for (const c of Object.keys(sheet.courses)) {
      const key = encodeURIComponent(c);
      const applicants = Number(sheet.applicants[c] || 0);
      const nsec = Math.max(1, Number(sheet.courses[c] || 1));
      const lo = applicants === 0 ? 0 : Math.floor(applicants / nsec);
      const hi = applicants === 0 ? 0 : Math.ceil(applicants / nsec);
      const range = lo === hi ? `${lo}명` : `${lo}–${hi}명`;
      rows.push(`<tr>
        <td>${escapeHtml(sheet.name)}</td><td>${escapeHtml(c)}</td><td>${applicants}</td>
        <td><input type="number" min="1" max="10" value="${sheet.courseCredits[c] || 3}" aria-label="${escapeHtml(c)} 학점" data-cfg="credit" data-si="${si}" data-course="${key}" style="min-width:70px"></td>
        <td><input type="number" min="1" max="100" value="${nsec}" aria-label="${escapeHtml(c)} 분반 수" data-cfg="sections" data-si="${si}" data-course="${key}" style="min-width:70px"></td>
        <td style="white-space:nowrap;color:var(--ink-dim);">${range}</td>
      </tr>`);
    }
  }
  rows.push('</tbody>');
  courseConfigTable.innerHTML = rows.join('');
  courseConfigTable.querySelectorAll('input[data-cfg]').forEach(inp => {
    inp.addEventListener('change', () => {
      const sheet = loadedData.sheets[+inp.dataset.si];
      const c = decodeURIComponent(inp.dataset.course);
      const v = Number(inp.value);
      if (!Number.isInteger(v) || v < 1 || v > (inp.dataset.cfg === 'credit' ? 10 : 100)) { alert('학점은 1–10, 분반 수는 1–100의 정수로 입력해 주세요.'); renderCourseConfig(); return; }
      if (inp.dataset.cfg === 'credit') sheet.courseCredits[c] = v;
      else if (inp.dataset.cfg === 'sections') sheet.courses[c] = v;
      const cc = sheet.courseCols.find(x => x.name === c);
      if (cc) cc.divCount = sheet.courses[c];
      if (inp.dataset.cfg === 'credit') renderCreditPairs();
      if (inp.dataset.cfg === 'sections') renderCoverage();
      renderCourseConfig();
    });
  });
}

function recalcAllSectionsFromMax() {
  if (!loadedData) return;
  const input = document.getElementById('optMax');
  const v = Number(input.value);
  if (!Number.isInteger(v) || v < 1 || v > 100) {
    alert('공통 분반당 최대 인원은 1–100명으로 입력해 주세요.');
    input.value = loadedData.globalMax || 35;
    return;
  }
  loadedData.globalMax = v;
  for (const sheet of loadedData.sheets) {
    for (const c of Object.keys(sheet.courses)) {
      sheet.courses[c] = Math.max(1, Math.ceil((sheet.applicants[c] || 0) / v));
      const cc = sheet.courseCols.find(x => x.name === c);
      if (cc) cc.divCount = sheet.courses[c];
    }
  }
  renderCourseConfig();
  renderCoverage();
  renderBigsecList();
}

applyDefaultMaxBtn.addEventListener('click', recalcAllSectionsFromMax);
document.getElementById('optMax').addEventListener('change', recalcAllSectionsFromMax);

function renderCreditPairs() {
  creditPairList.innerHTML = '';
  creditPairs.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'bigsec-row';
    div.style.gridTemplateColumns = '1fr 1fr 1fr auto';
    const sheetOptions = loadedData.sheets.map(s => `<option value="${escapeHtml(s.name)}" ${s.name===p.sheetName?'selected':''}>${escapeHtml(s.name)}</option>`).join('');
    const sheet = loadedData.sheets.find(s => s.name === p.sheetName) || loadedData.sheets[0];
    if (!p.sheetName && sheet) p.sheetName = sheet.name;
    const twos = sheet ? Object.keys(sheet.courses).filter(c => Number(sheet.courseCredits[c]) === 2) : [];
    const ones = sheet ? Object.keys(sheet.courses).filter(c => Number(sheet.courseCredits[c]) === 1) : [];
    const opt2 = ['<option value="">2학점 과목 선택</option>'].concat(twos.map(c=>`<option value="${escapeHtml(c)}" ${c===p.course2?'selected':''}>${escapeHtml(c)}</option>`)).join('');
    const opt1 = ['<option value="">1학점 과목 선택</option>'].concat(ones.map(c=>`<option value="${escapeHtml(c)}" ${c===p.course1?'selected':''}>${escapeHtml(c)}</option>`)).join('');
    div.innerHTML = `
      <div class="avoid-field"><label>시트</label><select class="pair-sheet" style="padding:7px;border:1px solid var(--line);">${sheetOptions}</select></div>
      <div class="avoid-field"><label>2학점 과목</label><select class="pair-2" style="padding:7px;border:1px solid var(--line);">${opt2}</select></div>
      <div class="avoid-field"><label>1학점 과목</label><select class="pair-1" style="padding:7px;border:1px solid var(--line);">${opt1}</select></div>
      <button class="btn-remove-pair" title="삭제">×</button>`;
    div.querySelector('.pair-sheet').addEventListener('change', e => { p.sheetName=e.target.value; p.course2=''; p.course1=''; renderCreditPairs(); });
    div.querySelector('.pair-2').addEventListener('change', e => { p.course2=e.target.value; });
    div.querySelector('.pair-1').addEventListener('change', e => { p.course1=e.target.value; });
    div.querySelector('.btn-remove-pair').addEventListener('click', () => { creditPairs.splice(idx,1); renderCreditPairs(); });
    creditPairList.appendChild(div);
  });
  const available = loadedData.sheets.some(s => Object.values(s.courseCredits).some(v=>Number(v)===2) && Object.values(s.courseCredits).some(v=>Number(v)===1));
  creditPairHint.textContent = available ? '' : '2학점·1학점 과목을 먼저 설정하세요.';
}

addCreditPairBtn.addEventListener('click', () => {
  if (!loadedData || loadedData.sheets.length === 0) return;
  creditPairs.push({ sheetName: loadedData.sheets[0].name, course2:'', course1:'' });
  renderCreditPairs();
});

function buildCreditPairsFor(sheet) {
  const set = new Set();
  const list = [];
  for (const p of creditPairs) {
    if (p.sheetName !== sheet.name || !p.course2 || !p.course1) continue;
    if (Number(sheet.courseCredits[p.course2]) !== 2 || Number(sheet.courseCredits[p.course1]) !== 1) continue;
    set.add(pairKey(p.course2, p.course1));
    list.push({course2:p.course2, course1:p.course1});
  }
  sheet.creditPairList = list;
  return set;
}

function buildCourseDatalist() {
  coursesList.innerHTML = '';
  coursesBySheet = {};
  const seen = new Set();
  for (const sheet of loadedData.sheets) {
    coursesBySheet[sheet.name] = new Set(Object.keys(sheet.courses));
    for (const c of Object.keys(sheet.courses)) {
      const key = `[${sheet.name}] ${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const opt = document.createElement('option');
      opt.value = key;
      coursesList.appendChild(opt);
    }
  }
}

function studentLabel(stu) {
  const id = stu.studentId != null && stu.studentId !== ''
    ? String(stu.studentId)
    : [stu.grade, stu.cls, stu.num].filter(v => v != null && v !== '').join('-');
  return `[${stu.sheetName}] ${id ? id + ' ' : ''}${stu.name} (원본 ${stu.rowIndex+1}행)`;
}
function buildStudentDatalist() {
  studentsList.innerHTML = '';
  studentByLabel = new Map();
  for (const sheet of loadedData.sheets) {
    for (const stu of sheet.students) {
      const lbl = studentLabel(stu);
      studentByLabel.set(lbl, stu);
      const opt = document.createElement('option');
      opt.value = lbl;
      studentsList.appendChild(opt);
    }
  }
}

// ───── 기피 페어 UI ─────
function renderAvoidPairs() {
  avoidList.innerHTML = '';
  avoidPairs.forEach((pair, idx) => {
    const reqStu = pair.requesterRow != null && pair.sheetName
      ? loadedData.sheets.find(s => s.name === pair.sheetName)
          ?.students.find(s => s.rowIndex === pair.requesterRow) : null;
    const div = document.createElement('div');
    div.className = 'bigsec-row';
    div.innerHTML = `
      <div class="avoid-field">
        <label>요청 학생</label>
        <input type="text" list="studentsList" class="avoid-requester"
               placeholder="학생 검색"
               value="${escapeHtml(reqStu ? studentLabel(reqStu) : '')}">
        <div class="bigsec-hint">${escapeHtml(pair.sheetName ? '시트: '+pair.sheetName : '')}</div>
      </div>
      <div class="avoid-field">
        <label>분리할 학생</label>
        <div class="target-tags"></div>
        <input type="text" list="studentsList" class="avoid-target-input"
               placeholder="학생 검색">
      </div>
      <button class="btn-remove-pair" title="삭제">×</button>
    `;
    const tagsEl = div.querySelector('.target-tags');
    (pair.targetRows || []).forEach(trow => {
      const t = loadedData.sheets.find(s => s.name === pair.sheetName)
        ?.students.find(s => s.rowIndex === trow);
      if (!t) return;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `${escapeHtml([t.grade,t.cls,t.num].join('-')+' '+t.name)}<span class="x">×</span>`;
      tag.querySelector('.x').addEventListener('click', () => {
        pair.targetRows = pair.targetRows.filter(x => x !== trow);
        renderAvoidPairs();
      });
      tagsEl.appendChild(tag);
    });
    const reqInp = div.querySelector('.avoid-requester');
    reqInp.addEventListener('change', () => {
      const v = reqInp.value.trim();
      const stu = studentByLabel.get(v);
      if (!stu) {
        if (v) alert('학생 목록에서 정확히 선택해 주세요.');
        reqInp.value = '';
        pair.sheetName = null; pair.requesterRow = null; pair.targetRows = [];
        renderAvoidPairs();
        return;
      }
      // 시트 바뀌면 대상 목록 초기화
      if (pair.sheetName !== stu.sheetName) pair.targetRows = [];
      pair.sheetName = stu.sheetName;
      pair.requesterRow = stu.rowIndex;
      renderAvoidPairs();
    });
    const tInp = div.querySelector('.avoid-target-input');
    tInp.addEventListener('change', () => {
      const v = tInp.value.trim();
      if (!v) return;
      const stu = studentByLabel.get(v);
      if (!stu) { alert('학생 목록에서 정확히 선택해 주세요.'); tInp.value = ''; return; }
      if (!pair.sheetName) { alert('먼저 요청 학생을 선택해 주세요.'); tInp.value = ''; return; }
      if (stu.sheetName !== pair.sheetName) {
        alert(`다른 시트의 학생입니다. 요청 학생과 같은 시트(${pair.sheetName})의 학생만 추가할 수 있습니다.`);
        tInp.value = ''; return;
      }
      if (stu.rowIndex === pair.requesterRow) {
        alert('요청 학생과 동일한 학생은 추가할 수 없습니다.');
        tInp.value = ''; return;
      }
      if (!pair.targetRows) pair.targetRows = [];
      if (!pair.targetRows.includes(stu.rowIndex)) pair.targetRows.push(stu.rowIndex);
      tInp.value = '';
      renderAvoidPairs();
    });
    div.querySelector('.btn-remove-pair').addEventListener('click', () => {
      avoidPairs.splice(idx, 1);
      renderAvoidPairs();
    });
    avoidList.appendChild(div);
  });
}

addAvoidBtn.addEventListener('click', () => {
  if (!loadedData) return;
  avoidPairs.push({ sheetName: null, requesterRow: null, targetRows: [] });
  renderAvoidPairs();
});

// 시트별 avoidMap: { rowIndex → Set<otherRowIndex> }
function buildAvoidMapsBySheet() {
  const maps = {};
  for (const sheet of loadedData.sheets) maps[sheet.name] = {};
  for (const p of avoidPairs) {
    if (!p.sheetName || p.requesterRow == null) continue;
    if (!p.targetRows || p.targetRows.length === 0) continue;
    const m = maps[p.sheetName];
    if (!m) continue;
    if (!m[p.requesterRow]) m[p.requesterRow] = new Set();
    for (const trow of p.targetRows) {
      m[p.requesterRow].add(trow);
      if (!m[trow]) m[trow] = new Set();
      m[trow].add(p.requesterRow);
    }
  }
  return maps;
}

// ───── 교사 공유 과목 UI ─────
function renderTeacherGroups() {
  teacherList.innerHTML = '';
  teacherGroups.forEach((group, idx) => {
    const div = document.createElement('div');
    div.className = 'bigsec-row';
    div.style.gridTemplateColumns = '1fr auto';
    div.innerHTML = `
      <div class="avoid-field">
        <label>공유 과목</label>
        <div class="target-tags"></div>
        <input type="text" list="coursesList" class="teacher-course-input"
               placeholder="과목 검색">
        <div class="bigsec-hint">${escapeHtml(group.sheetName ? '시트: '+group.sheetName : '')}</div>
      </div>
      <button class="btn-remove-pair" title="삭제">×</button>
    `;
    const tags = div.querySelector('.target-tags');
    (group.courses || []).forEach(cName => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `${escapeHtml(cName)}<span class="x">×</span>`;
      tag.querySelector('.x').addEventListener('click', () => {
        group.courses = group.courses.filter(c => c !== cName);
        if (group.courses.length === 0) group.sheetName = null;
        renderTeacherGroups();
      });
      tags.appendChild(tag);
    });
    const inp = div.querySelector('.teacher-course-input');
    inp.addEventListener('change', () => {
      const v = inp.value.trim();
      if (!v) return;
      const m = v.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (!m) { alert('[시트] 과목명 형식으로 선택해 주세요.'); inp.value = ''; return; }
      const sName = m[1], cName = m[2];
      if (!coursesBySheet[sName] || !coursesBySheet[sName].has(cName)) {
        alert('해당 시트 또는 과목을 찾을 수 없습니다.');
        inp.value = ''; return;
      }
      if (group.sheetName && group.sheetName !== sName) {
        alert(`다른 시트의 과목입니다. 묶음 안의 과목들은 같은 시트(${group.sheetName})여야 합니다.`);
        inp.value = ''; return;
      }
      if (group.courses && group.courses.includes(cName)) {
        alert('이미 추가된 과목입니다.');
        inp.value = ''; return;
      }
      if (!group.courses) group.courses = [];
      group.courses.push(cName);
      group.sheetName = sName;
      inp.value = '';
      renderTeacherGroups();
    });
    div.querySelector('.btn-remove-pair').addEventListener('click', () => {
      teacherGroups.splice(idx, 1);
      renderTeacherGroups();
    });
    teacherList.appendChild(div);
  });
}

addTeacherBtn.addEventListener('click', () => {
  if (!loadedData) return;
  teacherGroups.push({ sheetName: null, courses: [] });
  renderTeacherGroups();
});

// 시트별 교사 묶음
function buildTeacherGroupsBySheet() {
  const map = {};
  for (const sheet of loadedData.sheets) map[sheet.name] = [];
  for (const g of teacherGroups) {
    if (!g.sheetName || !g.courses || g.courses.length < 2) continue;
    map[g.sheetName].push(g.courses.slice());
  }
  return map;
}

// ───── 사용자 선택 과목 코드 커버리지 UI ─────
function renderCoverage() {
  coverageList.innerHTML = '';
  for (const sheet of loadedData.sheets) {
    if (!coverageCourses[sheet.name]) coverageCourses[sheet.name] = [];
    coverageCourses[sheet.name] = coverageCourses[sheet.name].filter(c => c in sheet.courses);
    const selected = coverageCourses[sheet.name];
    const nSelectedSecs = selected.reduce((sum, c) => sum + Number(sheet.courses[c] || 0), 0);
    const nGroups = sheet.groups.length;
    const possible = selected.length > 0 && nSelectedSecs >= nGroups;
    if (!possible) coverageEnabled[sheet.name] = false;

    const div = document.createElement('div');
    div.style.cssText = 'padding:12px;background:#fafafa;border-radius:6px;border:1px solid var(--line);margin-bottom:10px;';
    const id = `cov_${loadedData.sheets.indexOf(sheet)}`;
    const courseChecks = Object.keys(sheet.courses).map((c, ci) => {
      const checked = selected.includes(c) ? 'checked' : '';
      const cid = `${escapeHtml(id)}_c${ci}`;
      return `<label for="${escapeHtml(cid)}" style="display:inline-flex;align-items:center;gap:4px;margin:3px 10px 3px 0;font-size:12px;cursor:pointer;">
        <input type="checkbox" id="${escapeHtml(cid)}" data-cov-course="${encodeURIComponent(c)}" ${checked}>
        <span>${escapeHtml(c)} (${sheet.courses[c]}분반)</span>
      </label>`;
    }).join('');

    div.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:${possible?'pointer':'not-allowed'};opacity:${possible?1:0.6};">
        <input type="checkbox" class="coverage-enable" id="${escapeHtml(id)}" ${coverageEnabled[sheet.name]?'checked':''} ${possible?'':'disabled'}>
        <span><b>[${escapeHtml(sheet.name)}]</b> 모든 코드에 배치</span>
      </label>
      <div class="bigsec-hint" style="margin-top:5px;">
        ${selected.length === 0 ? '과목을 선택하세요.' :
          possible ? `${nSelectedSecs}분반 · ${nGroups}코드` :
          `${nSelectedSecs}분반 · ${nGroups}코드 — 분반 부족`}
      </div>
      <div style="margin-top:8px;padding-top:7px;border-top:1px solid var(--line);">${courseChecks}</div>
    `;
    coverageList.appendChild(div);

    div.querySelector('.coverage-enable').addEventListener('change', e => {
      coverageEnabled[sheet.name] = e.target.checked;
    });
    div.querySelectorAll('input[data-cov-course]').forEach(cb => {
      cb.addEventListener('change', () => {
        const c = decodeURIComponent(cb.dataset.covCourse);
        const set = new Set(coverageCourses[sheet.name] || []);
        if (cb.checked) set.add(c); else set.delete(c);
        coverageCourses[sheet.name] = [...set];
        renderCoverage();
      });
    });
  }
}

function buildCoverageGroupsFor(sheet) {
  if (!coverageEnabled[sheet.name]) return null;
  const selected = coverageCourses[sheet.name] || [];
  const sids = [];
  const { courseToSections } = sheet.algoState;
  for (const c of selected) {
    for (const sid of (courseToSections[c] || [])) sids.push(sid);
  }
  if (sids.length < sheet.groups.length) return null;
  return [sids];
}

function renderBigsecList() {
  bigsecList.innerHTML = '';
  bigsecEntries.forEach((entry, idx) => {
    const div = document.createElement('div');
    div.className = 'bigsec-row';
    div.style.gridTemplateColumns = 'minmax(0,1fr) 150px auto';
    entry.maxParallel ??= 2;
    let needInfo = '';
    if (entry.sheetName && entry.course) {
      const sheet = loadedData.sheets.find(s => s.name === entry.sheetName);
      if (sheet) {
        const nSec = Number(sheet.courses[entry.course] || 0);
        const cr = Number(sheet.courseCredits[entry.course] || 3);
        const eligibleCodes = sheet.groups.filter((g, gi) => cr <= Number(sheet.groupCredits[gi] || 3));
        const extra = Math.max(0, nSec - eligibleCodes.length);
        needInfo = extra > 0
          ? `<span class="bigsec-need">복수 배치 필요: ${extra}분반</span> 분반 ${nSec}개 / 사용 가능 코드 ${eligibleCodes.length}개 `
          : `<span class="bigsec-need">사용 가능 코드 ${eligibleCodes.length}개</span> 현재 분반 ${nSec}개 `;
      }
    }
    div.innerHTML = `
      <div class="avoid-field">
        <label>대분반으로 운영할 과목</label>
        <input type="text" class="bigsec-course" list="coursesList"
               placeholder="과목 검색"
               value="${escapeHtml(entry.sheetName ? `[${entry.sheetName}] ${entry.course}` : '')}">
        <div class="bigsec-hint">${needInfo}</div>
      </div>
      <div class="avoid-field">
        <label>동시 분반 상한</label>
        <input type="number" class="bigsec-parallel-limit" min="1" max="100" step="1" value="${entry.maxParallel}" aria-label="${escapeHtml(entry.course || '대분반 과목')} 동시 분반 상한">

      </div>
      <button class="btn-remove-pair" title="삭제">×</button>
    `;
    const cInp = div.querySelector('.bigsec-course');
    div.querySelector('.bigsec-parallel-limit').addEventListener('change',e=>{
      const value=Number(e.target.value);
      if(!Number.isInteger(value)||value<1||value>100){alert('동시 분반 상한은 1–100의 정수로 입력해 주세요.');e.target.value=entry.maxParallel;return;}
      entry.maxParallel=value;
    });
    cInp.addEventListener('change', () => {
      const v = cInp.value.trim();
      const m = v.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (!m) {
        if (v) alert('과목 목록에서 정확히 선택해 주세요. ([시트] 과목명 형식)');
        cInp.value = '';
        entry.sheetName = null; entry.course = null;
        renderBigsecList();
        return;
      }
      const sName = m[1], cName = m[2];
      const sheet = loadedData.sheets.find(s => s.name === sName);
      if (!sheet || !(cName in sheet.courses)) {
        alert('해당 시트 또는 과목을 찾을 수 없습니다.');
        cInp.value = '';
        return;
      }
      const duplicate = bigsecEntries.some((x, j) => j !== idx && x.sheetName === sName && x.course === cName);
      if (duplicate) {
        alert('이미 대분반 과목으로 지정되어 있습니다.');
        cInp.value = ''; entry.sheetName = null; entry.course = null;
        renderBigsecList(); return;
      }
      entry.sheetName = sName; entry.course = cName;
      renderBigsecList();
    });
    div.querySelector('.btn-remove-pair').addEventListener('click', () => {
      bigsecEntries.splice(idx, 1);
      renderBigsecList();
    });
    bigsecList.appendChild(div);
  });
}

addBigsecBtn.addEventListener('click', () => {
  if (!loadedData) return;
  bigsecEntries.push({ sheetName: null, course: null, maxParallel:2 });
  renderBigsecList();
});

function buildBigsecCoursesFor(sheet) {
  const set = new Set();
  for (const entry of bigsecEntries) {
    if (entry.sheetName === sheet.name && entry.course && sheet.courses[entry.course] != null) set.add(entry.course);
  }
  return set;
}
function buildParallelLimitsFor(sheet) {
  return Object.fromEntries(bigsecEntries.filter(e=>e.sheetName===sheet.name && e.course && Object.hasOwn(sheet.courses,e.course)).map(e=>[e.course,e.maxParallel ?? 2]));
}


function validateStudentSelections(sheet) {
  const rows = sheet.students.map(stu => ({
    stu,
    totalCredits: stu.selected.reduce((sum, c) => sum + Number(sheet.courseCredits[c] || 0), 0),
    count: stu.selected.length,
  }));
  if (Number(sheet.expectedTotalCredits) === 0 && sheet.expectedTotalCredits !== null) {
    return { ok: true, expected: 0, mode: 'disabled', mismatches: [] };
  }
  let expected;
  let mode;
  if (sheet.expectedTotalCredits == null || sheet.expectedTotalCredits === '') {
    const freq = new Map();
    for (const x of rows) freq.set(x.totalCredits, (freq.get(x.totalCredits) || 0) + 1);
    const ranked = [...freq.entries()].sort((a,b) => b[1] - a[1] || a[0] - b[0]);
    expected = ranked.length ? ranked[0][0] : 0;
    mode = 'auto';
  } else {
    expected = Number(sheet.expectedTotalCredits);
    mode = 'explicit';
  }
  const mismatches = rows.filter(x => Math.abs(x.totalCredits - expected) > 1e-9);
  return { ok: mismatches.length === 0, expected, mode, mismatches };
}

let logScroll=0;
function log(msg, cls) {
  progress.classList.remove('hidden');
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = msg + '\n';
  progress.appendChild(span);
  if(!logScroll)logScroll=requestAnimationFrame(()=>{logScroll=0;progress.scrollTop=progress.scrollHeight;});
}

function getSearchProfile(mode) {
  if (mode === 'fast') {
    return { label: '빠른 탐색', maxAttempts: 4, maxIter: 32, nNeighbors: 8, quickFinalTrials: 1, refineTrials: 5, shortlist: 2, patience: 2, noImproveLimit: 12, diversifyMoves: 1, rebalancePasses: 2, refineVarianceFactor: 1.30, goodMaxSpread: 3, deepMinAttempts: 4, deepCandidates: 2, deepBalanceCount: 1, deepIter: 24, deepNeighbors: 12, deepQuickTrials: 1, deepNoImproveLimit: 12, deepDiversifyMoves: 1 };
  }
  if (mode === 'precise') {
    return { label: '정밀 탐색', maxAttempts: 8, maxIter: 60, nNeighbors: 12, quickFinalTrials: 1, refineTrials: 10, shortlist: 3, patience: 3, noImproveLimit: 18, diversifyMoves: 2, rebalancePasses: 3, refineVarianceFactor: 1.35, goodMaxSpread: 3, deepMinAttempts: 8, deepCandidates: 3, deepBalanceCount: 2, deepIter: 45, deepNeighbors: 18, deepQuickTrials: 2, deepNoImproveLimit: 18, deepDiversifyMoves: 2 };
  }
  return { label: '표준 탐색', maxAttempts: 6, maxIter: 45, nNeighbors: 10, quickFinalTrials: 1, refineTrials: 7, shortlist: 3, patience: 2, noImproveLimit: 16, diversifyMoves: 2, rebalancePasses: 3, refineVarianceFactor: 1.35, goodMaxSpread: 3, deepMinAttempts: 6, deepCandidates: 2, deepBalanceCount: 1, deepIter: 32, deepNeighbors: 15, deepQuickTrials: 1, deepNoImproveLimit: 15, deepDiversifyMoves: 2 };
}

runBtn.addEventListener('click', async () => {
  if (!loadedData || isRunning) return;
  invalidateResults();setBusy(true);
  try {
  downloadBtn.classList.add('hidden');
  summary.classList.add('hidden');
  progress.innerHTML = '';
  progress.classList.remove('hidden');

  const maxPerSection = Number(document.getElementById('optMax').value);
  if(!Number.isInteger(maxPerSection)||maxPerSection<1||maxPerSection>100)throw new Error('공통 정원은 1–100의 정수여야 합니다.');
  const allowedDiff = Number(document.getElementById('optDiff').value);
  if(!Number.isInteger(allowedDiff)||allowedDiff<0||allowedDiff>10)throw new Error('편차 목표는 0–10의 정수여야 합니다.');
  const searchMode = document.getElementById('optSearchMode').value || 'standard';
  const searchProfile = getSearchProfile(searchMode);
  const maxIter = searchProfile.maxIter;
  const baseSeed = Number(document.getElementById('optSeed').value);
  if(!Number.isInteger(baseSeed)||baseSeed<0||baseSeed>99999)throw new Error('난수 시드는 0–99999의 정수여야 합니다.');
  const nCandidates = Number(document.getElementById('optNCandidates').value);
  if(!Number.isInteger(nCandidates)||nCandidates<1||nCandidates>30)throw new Error('후보 개수는 1–30의 정수여야 합니다.');
  lastRunSettings={maxPerSection,allowedDiff,searchMode,baseSeed,nCandidates};

  for (const sheet of loadedData.sheets) {
    if (!sheet.groups.length || new Set(sheet.groups).size !== sheet.groups.length) {
      log(`✗ [${sheet.name}] 분반 코드는 1개 이상이며 서로 달라야 합니다.`, 'bad');
      runBtn.disabled = false; return;
    }
    if (sheet.groupCredits.length !== sheet.groups.length || sheet.groupCredits.some(v => !Number.isFinite(Number(v)) || Number(v) < 1)) {
      log(`✗ [${sheet.name}] 분반 코드별 학점 설정을 확인해 주세요.`, 'bad');
      runBtn.disabled = false; return;
    }
    const maxCodeCredit = Math.max(...sheet.groupCredits.map(Number));
    for (const c of Object.keys(sheet.courses)) {
      const cr = Number(sheet.courseCredits[c]);
      const nsec = Number(sheet.courses[c]);
      if((sheet.applicants[c]||0)>nsec*maxPerSection)throw new Error(`[${sheet.name}] '${c}': 신청 ${sheet.applicants[c]}명 > 수용 ${nsec*maxPerSection}명. 분반 수를 늘려 주세요.`);
      if (!Number.isFinite(cr) || cr < 1 || !Number.isFinite(nsec) || nsec < 1) {
        log(`✗ [${sheet.name}] '${c}'의 학점·분반 수 설정을 확인해 주세요.`, 'bad');
        runBtn.disabled = false; return;
      }
      if (cr > maxCodeCredit) {
        log(`✗ [${sheet.name}] '${c}' ${cr}학점을 수용할 분반 코드가 없습니다.`, 'bad');
        runBtn.disabled = false; return;
      }
    }
  }
  for (const p of creditPairs) {
    if (!p.course2 && !p.course1) continue;
    const sh = loadedData.sheets.find(s => s.name === p.sheetName);
    if (!sh || !p.course2 || !p.course1 || Number(sh.courseCredits[p.course2]) !== 2 || Number(sh.courseCredits[p.course1]) !== 1) {
      log(`✗ 2학점+1학점 결합 설정에 미완성 또는 학점이 맞지 않는 항목이 있습니다.`, 'bad');
      runBtn.disabled = false; return;
    }
    const need = 3;
    if (!sh.groupCredits.some(v => Number(v) >= need)) {
      log(`✗ [${sh.name}] 2+1 결합을 수용할 3학점 이상 분반 코드가 없습니다.`, 'bad');
      runBtn.disabled = false; return;
    }
  }

  // 파일 과목 데이터 사전 검증: 알 수 없는 선택 표기나 잘못된 구형 분반수 정보가 조용히 무시되지 않도록 차단한다.
  if (loadedData.legacyIssues && loadedData.legacyIssues.length) {
    log(`✗ '과목별분반수' 시트에 확인이 필요한 항목이 ${loadedData.legacyIssues.length}건 있습니다.`, 'bad');
    for (const msg of loadedData.legacyIssues.slice(0, 10)) log(`    · ${msg}`, 'bad');
    if (loadedData.legacyIssues.length > 10) log(`    · 외 ${loadedData.legacyIssues.length - 10}건`, 'bad');
    runBtn.disabled = false;
    return;
  }
  for (const sheet of loadedData.sheets) {
    const issues = sheet.dataIssues || {};
    const unknown = issues.unknownSelectionCells || [];
    if (unknown.length) {
      log(`✗ [${sheet.name}] 선택 여부를 해석할 수 없는 셀이 ${unknown.length}개 있습니다. 1/O/Y/YES/○/선택은 선택, 0/X/N/NO/미선택/빈칸은 미선택으로 인식합니다.`, 'bad');
      for (const x of unknown.slice(0, 10)) {
        const who = [x.studentId, x.studentName].filter(Boolean).join(' ');
        log(`    · Excel ${x.excelRow}행 ${who || '(학생 식별정보 없음)'} · ${x.course}: '${x.value}'`, 'bad');
      }
      if (unknown.length > 10) log(`    · 외 ${unknown.length - 10}개 셀`, 'bad');
      runBtn.disabled = false;
      return;
    }
    const zeroCourses = issues.zeroApplicantCourses || [];
    if (zeroCourses.length) {
      log(`  ⚠ [${sheet.name}] 신청자 0명 과목: ${zeroCourses.join(', ')} — 파일의 과목 열이 맞는지 확인 권장`, 'warn');
    }
  }
  if (loadedData.unusedLegacyCourses && loadedData.unusedLegacyCourses.length) {
    log(`  ⚠ '과목별분반수'에는 있으나 수강신청 시트에서 찾지 못한 과목: ${loadedData.unusedLegacyCourses.join(', ')}`, 'warn');
  }

  // 학생별 선택 데이터 사전 검증. 2+1 결합을 고려해 과목 수가 아니라 총학점으로 검사한다.
  for (const sheet of loadedData.sheets) {
    const capacity=sheet.groupCredits.reduce((a,b)=>a+Number(b),0);
    const over=sheet.students.find(stu=>stu.selected.reduce((a,c)=>a+Number(sheet.courseCredits[c]),0)>capacity);
    if(over)throw new Error(`[${sheet.name}] ${studentDisplay(over)}의 선택 학점이 코드 총 학점 ${capacity}을 초과합니다.`);
    const vr = validateStudentSelections(sheet);
    if (!vr.ok) {
      log(`✗ [${sheet.name}] 학생별 총 선택 학점 불일치: 기준 ${vr.expected}학점${vr.mode === 'auto' ? ' (자동 추정)' : ''}, ${vr.mismatches.length}명 확인 필요`, 'bad');
      const preview = vr.mismatches.slice(0, 10);
      for (const x of preview) {
        log(`    · ${studentDisplay(x.stu)}: ${x.totalCredits}학점 / ${x.count}과목`, 'bad');
      }
      if (vr.mismatches.length > preview.length) log(`    · 외 ${vr.mismatches.length - preview.length}명`, 'bad');
      log(`  ※ 의도된 차이라면 시트별 '기대 총학점'을 직접 입력하거나 0으로 설정해 검증을 끌 수 있습니다.`, 'dim');
      runBtn.disabled = false;
      return;
    }
  }

  for(const sheet of loadedData.sheets){
    sheet.algoState=buildSections(sheet);
    ensureParallelCapacity(sheet,{nGroups:sheet.groups.length,bigsecCourses:buildBigsecCoursesFor(sheet),parallelLimits:buildParallelLimitsFor(sheet),courseCredits:sheet.courseCredits,groupCredits:sheet.groupCredits});
  }
  log(`▶ 시작: ${searchProfile.label} · 시트 ${loadedData.sheets.length}개 · 1차 ${maxIter}회×${searchProfile.nNeighbors}이웃 · 최대 시드 ${searchProfile.maxAttempts}개 · 집중 ${searchProfile.deepCandidates}개×${searchProfile.deepIter}회 · 최종 정밀 ${searchProfile.shortlist}개 · 공통정원 ${maxPerSection}`, 'ok');
  await new Promise(r => setTimeout(r, 30));

  const t0 = performance.now();
  const allResults = [];
  let totalStudents = 0;
  let totalUnassigned = 0;
  let totalPartial = 0;

  const avoidMaps = buildAvoidMapsBySheet();
  const teacherGroupsMap = buildTeacherGroupsBySheet();

  for (const sheet of loadedData.sheets) {
    log('', 'dim');
    log(`══ [${sheet.name}] 학생 ${sheet.students.length}명, 과목 ${Object.keys(sheet.courses).length}개, 그룹 ${sheet.groups.length}개 (${sheet.groups.join(',')}) ══`, 'head');
    sheet.algoState = buildSections(sheet);
    for (const c of Object.keys(sheet.courses)) {
      const nSec = sheet.courses[c];
      if (nSec > sheet.groups.length) {
        log(`  ⓘ 대분반 지정 필요: '${c}' ${nSec}분반 > 그룹 ${sheet.groups.length} → 일부 그룹이 복수 분반 운영`, 'dim');
      }
    }
    const bigsecCourses = buildBigsecCoursesFor(sheet);
    const parallelLimits=buildParallelLimitsFor(sheet);
    const creditPairSet = buildCreditPairsFor(sheet);
    if (creditPairSet.size > 0) {
      log(`  2+1 결합 (동일 학생 구성 강제): ${sheet.creditPairList.map(p => p.course2 + ' + ' + p.course1).join(', ')}`, 'dim');
      ensureCoupledConfiguration(sheet,{nGroups:sheet.groups.length,bigsecCourses:buildBigsecCoursesFor(sheet),parallelLimits:buildParallelLimitsFor(sheet),creditPairs:creditPairSet});
    }
    if (bigsecCourses.size > 0) {
      log(`  대분반 과목: ${[...bigsecCourses].join(', ')} — 중복 배치 코드는 자동 최적화`, 'dim');
      log(`  동시 분반 상한 (강제): ${[...bigsecCourses].map(c=>`${c} ${parallelLimits[c]}개`).join(', ')} · 일반 과목 1개`, 'dim');
    }
    for (const c of Object.keys(sheet.courses)) {
      const cr = Number(sheet.courseCredits[c] || 3);
      const eligibleCount = sheet.groupCredits.filter(v => cr <= Number(v || 3)).length;
      if (Number(sheet.courses[c]) > eligibleCount && !bigsecCourses.has(c)) {
        log(`✗ [${sheet.name}] '${c}'은(는) ${sheet.courses[c]}분반이지만 사용 가능한 코드는 ${eligibleCount}개입니다. 같은 코드에 복수 분반을 두려면 대분반 과목으로 지정해 주세요.`, 'bad');
        runBtn.disabled = false;
        return;
      }
    }
    // 시트별 제약 빌드
    const avoidMap = avoidMaps[sheet.name] || {};
    const nAvoidStu = Object.keys(avoidMap).length;
    if (nAvoidStu > 0) {
      const nPairs = avoidPairs.filter(p => p.sheetName === sheet.name && p.requesterRow != null && p.targetRows && p.targetRows.length).length;
      log(`  기피 제약: ${nPairs}개 페어, ${nAvoidStu}명 관련`, 'dim');
    }
    const tgArr = teacherGroupsMap[sheet.name] || [];
    let conflicts = null;
    if (tgArr.length > 0) {
      conflicts = computeConflictSections(sheet, tgArr);
      log(`  교사 공유: ${tgArr.map(g => '[' + g.join('·') + ']').join(', ')}`, 'dim');
      for (const grp of tgArr) {
        let totalSecs = 0;
        for (const c of grp) totalSecs += sheet.courses[c] || 0;
        if (totalSecs > sheet.groups.length) {
          throw new Error(`[${sheet.name}] 교사 공유 [${grp.join('·')}]의 ${totalSecs}분반을 ${sheet.groups.length}개 코드에 분리할 수 없습니다.`);
        }
      }
    }
    const coverageGroups = buildCoverageGroupsFor(sheet);
    if (coverageGroups) {
      for(let g=0;g<sheet.groups.length;g++)if(!coverageGroups[0].some(sid=>sheet.courseCredits[sheet.algoState.sections[sid].course]<=sheet.groupCredits[g]))throw new Error(`[${sheet.name}] 커버리지 대상 과목 중 ${sheet.groups[g]} 코드에 들어갈 과목이 없습니다.`);
      log(`  코드 커버리지 강제: [${(coverageCourses[sheet.name] || []).join(' · ')}] (${coverageGroups[0].length}분반)`, 'dim');
    }

    const sheetResult = await runSheetInWorker(sheet, {
      maxPerSection, allowedDiff, nGroups: sheet.groups.length,
      maxIter, tabuTenure: 15, nNeighbors: searchProfile.nNeighbors,
      quickFinalTrials: searchProfile.quickFinalTrials,
      refineTrials: searchProfile.refineTrials,
      rebalancePasses: searchProfile.rebalancePasses,
      noImproveLimit: searchProfile.noImproveLimit,
      diversifyMoves: searchProfile.diversifyMoves,
      baseSeed, bigsecCourses, parallelLimits, searchProfile,
      avoidMap, conflicts, coverageGroups,
      groupCredits: sheet.groupCredits, courseCredits: sheet.courseCredits, creditPairs: creditPairSet,
      nCandidates,
    }, log);
    const cands = sheetResult.topCandidates;
    if (cands.length === 0) {
      log(`✗ [${sheet.name}] hard constraint를 모두 만족하는 후보를 찾지 못했습니다. 제약 조합 또는 탐색 반복·재시도 횟수를 확인해 주세요.`, 'bad');
      runBtn.disabled = false;
      return;
    }
    const best = cands[0].result;
    const bestPm = best.partialMisses.reduce((a,p)=>a+p.missing.length,0);
    log(`✓ [${sheet.name}] 완료: ${cands.length}개 최종 후보 (1차 구조 ${sheetResult.coarseFound||0}개 → 집중 탐색 ${sheetResult.deepenedCount||0}개 → 정밀 평가 ${sheetResult.refinedCount||0}개, 시드 ${sheetResult.totalAttempts}회)`, 'ok');
    log(`  최선: 비용 ${best.cost.toFixed(1)}, 전체 ${best.unassigned.length}, 부분 ${bestPm} (시드 ${cands[0].seed})`,
        (best.unassigned.length === 0 && bestPm === 0) ? 'ok' : 'warn');
    if (cands.length > 1) {
      const last = cands[cands.length - 1].result;
      const lastPm = last.partialMisses.reduce((a,p)=>a+p.missing.length,0);
      log(`  ${cands.length}순위: 비용 ${last.cost.toFixed(1)}, 전체 ${last.unassigned.length}, 부분 ${lastPm}`, 'dim');
    }

    // 제약 검증 로그 (최선 후보에 대해서만)
    const result = best;
    if (nAvoidStu > 0) {
      let violations = 0;
      for (const p of avoidPairs) {
        if (p.sheetName !== sheet.name || p.requesterRow == null) continue;
        const reqAss = result.assignments[p.requesterRow];
        if (!reqAss) continue;
        const reqSidSet = new Set(reqAss.filter(s => s !== -1));
        for (const trow of (p.targetRows || [])) {
          const tAss = result.assignments[trow];
          if (!tAss) continue;
          for (const sid of tAss) if (sid !== -1 && reqSidSet.has(sid)) { violations++; break; }
        }
      }
      log(`  기피 제약 검증 (최선): ${violations === 0 ? '✓ 모두 분리됨' : '✗ ' + violations + '쌍 위반'}`,
          violations === 0 ? 'ok' : 'bad');
    }
    if (tgArr.length > 0) {
      let allOk = true;
      for (const grp of tgArr) {
        const byGroup = {};
        for (const c of grp) {
          for (const sid of sheet.algoState.courseToSections[c] || []) {
            const g = result.secToGroup[sid];
            if (!byGroup[g]) byGroup[g] = [];
            byGroup[g].push(`${c}#${sheet.algoState.sections[sid].idx}`);
          }
        }
        let conflict = false;
        for (const g of Object.keys(byGroup)) if (byGroup[g].length > 1) conflict = true;
        if (conflict) {
          allOk = false;
          log(`  ✗ [${grp.join('·')}] 충돌 발견`, 'bad');
        }
      }
      if (allOk) log(`  교사 공유 검증 (최선): ✓ 모든 묶음 분리됨`, 'ok');
    }
    if (coverageGroups) {
      const covered = new Set();
      for (const sid of coverageGroups[0]) covered.add(result.secToGroup[sid]);
      const missing = [];
      for (let g = 0; g < sheet.groups.length; g++) {
        if (!covered.has(g)) missing.push(sheet.groups[g]);
      }
      log(`  코드 커버리지 검증 (최선): ${missing.length === 0 ? '✓ 모든 코드 커버' : '✗ 빠진 코드: '+missing.join(',')}`,
          missing.length === 0 ? 'ok' : 'bad');
    }

    for(const candidate of cands) {
      const checked=validateResult(sheet,candidate.result,{maxPerSection,nGroups:sheet.groups.length,avoidMap,conflicts,coverageGroups,bigsecCourses,parallelLimits,creditPairs:creditPairSet});
      if(!checked.ok)throw new Error('출력 전 검증 실패: '+checked.errors.slice(0,5).join('; '));
      candidate.result.validation=checked;
    }
    allResults.push(sheetResult);
    totalStudents += sheet.students.length;
    totalUnassigned += best.unassigned.length;
    totalPartial += bestPm;
  }

  const elapsed = (performance.now() - t0) / 1000;
  log('', 'dim');
  log(`═══════════════════`, 'head');
  log(`전체 완료: 총 학생 ${totalStudents}, 전체 미배정 ${totalUnassigned}명, 부분 미배정 ${totalPartial}과목, 총 ${elapsed.toFixed(1)}초`,
      (totalUnassigned === 0 && totalPartial === 0) ? 'ok' : 'warn');

  document.getElementById('statStudents').textContent = totalStudents;
  const su = document.getElementById('statUnassigned');
  if (totalUnassigned > 0 || totalPartial > 0) {
    su.textContent = `${totalUnassigned} / ${totalPartial}과목`;
    su.classList.add('bad');
  } else {
    su.textContent = '0';
    su.classList.remove('bad');
  }
  document.getElementById('statTime').textContent = elapsed.toFixed(1) + '초';
  summary.classList.remove('hidden');

  const maxN=Math.max(...allResults.map(r=>r.topCandidates.length));
  resultIncomplete=Array.from({length:maxN},(_,i)=>allResults.some(r=>!r.topCandidates[Math.min(i,r.topCandidates.length-1)].result.validation.complete));
  downloadBtn.textContent='결과 XLSX '+maxN+'개 다운로드';
  downloadBtn.classList.remove('hidden');
  hoursExportResults=allResults;
  const candidateSelect=document.getElementById('hoursCandidate');
  candidateSelect.replaceChildren();
  for(let i=0;i<maxN;i++) {
    const option=document.createElement('option');option.value=String(i);
    option.textContent=`${i+1}순위${resultIncomplete[i]?' · 미완성(내보내기 불가)':''}`;
    option.disabled=resultIncomplete[i];candidateSelect.appendChild(option);
  }
  const firstComplete=resultIncomplete.findIndex(v=>!v);
  candidateSelect.value=firstComplete<0?'':String(firstComplete);
  for(const id of ['hoursExportBtn','sendHoursBtn','previewStudentsBtn'])document.getElementById(id).disabled=firstComplete<0;
  document.getElementById('hoursExportStatus').textContent=firstComplete<0?'미배정이 있어 내보낼 수 없습니다.':'';
  document.getElementById('hoursExportCard').classList.remove('hidden');
  } catch(err) {
    invalidateResults();log('✗ '+err.message,'bad');console.error(err);
  } finally {setBusy(false);runBtn.disabled=!loadedData;}
});

downloadBtn.addEventListener('click',async ()=>{
  if(isRunning||!hoursExportResults)return;
  const results=hoursExportResults,sheets=loadedData.sheets,incomplete=resultIncomplete.slice();
  const baseName=resultFilename.replace(/.xlsx$/,'');
  const padWidth=Math.max(2,String(incomplete.length).length);
  downloadBtn.disabled=true;
  try{
    for(let i=0;i<incomplete.length;i++){
      await new Promise(resolve=>setTimeout(resolve,i?250:0));
      if(hoursExportResults!==results)break;
      const wb=buildOutputWorkbook(sheets,results,i);
      const file=XLSX.write(wb,{bookType:'xlsx',type:'array'});
      const url=URL.createObjectURL(new Blob([file],{type:'application/octet-stream'}));
      const a=document.createElement('a');
      a.href=url;
      a.download=baseName+(incomplete.length>1?'_'+String(i+1).padStart(padWidth,'0')+'순위':'')+(incomplete[i]?'_미완성_검토용':'')+'.xlsx';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  }catch(error){log('파일 생성 실패 · '+error.message,'bad');}
  finally{downloadBtn.disabled=false;}
});

// school-course-hours v1: sheets[].courses[].sections are the workload records.
// coupledCohorts describe links only; do not add them again to total hours.
function buildHoursExport(sheets, results, candidateIndex) {
  if(!Number.isInteger(candidateIndex)||candidateIndex<0)throw new Error('결과 후보를 선택하세요.');
  return {format:'school-course-hours',schemaVersion:1,exportedAt:new Date().toISOString(),
    source:{tool:'분반배정도구',toolVersion:'v19',requestedCandidateRank:candidateIndex+1},
    hoursUnit:'weekly-periods',includesStudentData:false,
    notes:['학년도·학기·대상 학년과 교과군은 시수배당도구에서 지정합니다.','weeklyHours는 학점 기준 초기값이며 실제 운영 시수 확인이 필요합니다.','결합 정보는 연결용이며 과목별 시수에 중복 합산하지 않습니다.'],
    sheets:sheets.map((sheet,si)=>{
      const candidates=results[si].topCandidates;
      const rank=Math.min(candidateIndex,candidates.length-1),result=candidates[rank].result;
      if(!result.validation?.ok||!result.validation.complete)throw new Error('검증을 통과한 완전배정 결과만 내보낼 수 있습니다.');
      const cohort=auditCoupledCohorts(sheet,result);
      if(!cohort.ok)throw new Error('2+1 결합 검증 실패');
      const labels=sectionDisplayCodes(sheet,result),state=sheet.algoState;
      const sheetId='sheet:'+encodeURIComponent(sheet.name);
      const courseId=c=>sheetId+'/course:'+encodeURIComponent(c);
      const sectionId=sid=>courseId(state.sections[sid].course)+'/section:'+state.sections[sid].idx;
      const links=cohort.links.map(l=>({cohortId:sectionId(l.parentSid)+'/coupled',
        sectionIds:[sectionId(l.parentSid),sectionId(l.childSid)],
        sectionCode:labels[l.parentSid],timeBlock:sheet.groups[result.secToGroup[l.parentSid]],
        combinedCredits:3,sameStudents:true,studentCount:l.count}));
      const linkBySection=new Map(links.flatMap(l=>l.sectionIds.map(id=>[id,l.cohortId])));
      const courses=Object.keys(sheet.courses).map(c=>{
        const credits=Number(sheet.courseCredits[c]);
        const sections=state.courseToSections[c].map(sid=>({sectionId:sectionId(sid),sectionNumber:state.sections[sid].idx,
          sectionCode:labels[sid],timeBlock:sheet.groups[result.secToGroup[sid]],studentCount:result.sectionLoad[sid],
          capacity:lastRunSettings.maxPerSection,weeklyHours:credits,cohortId:linkBySection.get(sectionId(sid))||null}));
        return {courseId:courseId(c),courseName:c,subjectGroup:null,credits,weeklyHours:credits,weeklyHoursBasis:'credits-default',
          sectionCount:sections.length,totalWeeklyHours:credits*sections.length,
          parallelSectionLimit:result.validation.parallelLimits[c],sections};
      });
      return {sheetId,sourceSheetName:sheet.name,academicYear:null,semester:null,grade:null,candidateRank:rank+1,
        studentCount:sheet.students.length,validation:{complete:true,hardConstraintsPassed:true,coupledCohortsPassed:true},
        timeBlocks:sheet.groups.map((code,i)=>({code,credits:Number(sheet.groupCredits[i])})),courses,coupledCohorts:links,
        totals:{courseCount:courses.length,sectionCount:courses.reduce((n,c)=>n+c.sectionCount,0),totalWeeklyHours:courses.reduce((n,c)=>n+c.totalWeeklyHours,0)}};
    })};
}
document.getElementById('hoursExportBtn').addEventListener('click',()=>{
  if(isRunning||!hoursExportResults)return;
  try {
    const selected=document.getElementById('hoursCandidate').value;
    if(selected==='')throw new Error('완전배정 결과 후보가 없습니다.');
    const index=Number(selected),data=buildHoursExport(loadedData.sheets,hoursExportResults,index);
    const base=resultFilename.replace(/\.xlsx$/i,'');
    downloadJson(data,base+'_시수배당연동_'+String(index+1).padStart(2,'0')+'순위.json');
    document.getElementById('hoursExportStatus').textContent='JSON 파일을 저장했습니다.';
  }catch(err){document.getElementById('hoursExportStatus').textContent='내보내기 실패: '+err.message;}
});

function selectedCandidate(){
  const selected=document.getElementById('hoursCandidate').value;
  const rank=Number(selected);
  if(!hoursExportResults||selected===''||resultIncomplete[rank]!==false)throw Error('완전배정 결과 후보가 없습니다.');
  return rank;
}

document.getElementById('sendHoursBtn').addEventListener('click',()=>{
  try{bridge.importHours(buildHoursExport(loadedData.sheets,hoursExportResults,selectedCandidate()));}
  catch(error){document.getElementById('hoursExportStatus').textContent=error.message;}
});

document.getElementById('previewStudentsBtn').addEventListener('click',()=>{
  try{
    const rank=selectedCandidate();
    const students=loadedData.sheets.flatMap((sheet,si)=>{
      const candidates=hoursExportResults[si].topCandidates;
      const result=candidates[Math.min(rank,candidates.length-1)].result;
      const labels=sectionDisplayCodes(sheet,result);
      return sheet.students.map(student=>{
        const studentNo=String(student.studentId??'').trim().match(/^([1-3])(\d{2})(\d{2})$/);
        const identity=[student.grade,student.cls,student.num].map((n,i)=>Number(n||studentNo?.[i+1]));
        if(identity[0]<1||identity[0]>3||identity.some(n=>!Number.isInteger(n)||n<1||n>99)||!student.name){
          throw Error(sheet.name+' 시트에 학년·반·번호 또는 이름이 없는 학생이 있습니다.');
        }
        return {grade:String(identity[0]),classNum:String(identity[1]),number:String(identity[2]),name:student.name,
          choices:Object.fromEntries(student.selected.map((subject,j)=>[subject,labels[result.assignments[student.rowIndex][j]]]))};
      });
    });
    bridge.previewStudents(students);
  }catch(error){document.getElementById('hoursExportStatus').textContent=error.message;}
});

document.getElementById('cancelBtn').addEventListener('click',()=>{if(cancelActive)cancelActive();});
document.addEventListener('change',e=>{
  if(!isRunning && loadedData && e.target.matches('input,select') && !['fileInput','settingsFile','hoursCandidate'].includes(e.target.id))invalidateResults();
},true);
document.addEventListener('click',e=>{
  if(!isRunning && loadedData && e.target.closest('.btn-remove-pair,.x,#addCreditPairBtn,#addBigsecBtn,#addAvoidBtn,#addTeacherBtn,#applyDefaultMaxBtn'))invalidateResults();
},true);
const optionIds=['optMax','optDiff','optSearchMode','optSeed','optNCandidates'];
function dataFingerprint() {
  const text=JSON.stringify(loadedData.sheets.map(sh=>({name:sh.name,courses:sh.courseCols.map(c=>c.name),students:sh.students.map(s=>[s.rowIndex,s.studentId,s.grade,s.cls,s.num,s.name,s.selected])})));
  let a=2166136261,b=0x9e3779b9;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),2246822519);}
  return `${text.length}:${a>>>0}:${b>>>0}`;
}
function settingsSnapshot() {
  return {schema:3,version:'v19',fingerprint:dataFingerprint(),options:Object.fromEntries(optionIds.map(id=>[id,document.getElementById(id).value])),
    sheets:loadedData.sheets.map(sh=>({name:sh.name,groups:sh.groups,groupCredits:sh.groupCredits,courses:sh.courses,courseCredits:sh.courseCredits,expectedTotalCredits:sh.expectedTotalCredits})),
    creditPairs,bigsecEntries,avoidPairs,teacherGroups,coverageEnabled,coverageCourses};
}
function restoreSettings(raw) {
  if(!loadedData || isRunning)throw new Error('먼저 수강신청 파일을 열고 계산이 끝난 상태에서 불러오세요.');
  if(!raw || ![1,2,3].includes(raw.schema) || raw.fingerprint!==dataFingerprint())throw new Error('설정 파일의 수강신청 자료가 현재 파일과 다릅니다.');
  const cfg=JSON.parse(JSON.stringify(raw));
  const integer=(v,lo,hi)=>Number.isInteger(Number(v))&&Number(v)>=lo&&Number(v)<=hi;
  for(const [id,lo,hi] of [['optMax',1,100],['optDiff',0,10],['optSeed',0,99999],['optNCandidates',1,30]])if(!integer(cfg.options?.[id],lo,hi))throw new Error('설정 숫자 범위 오류: '+id);
  if(!['fast','standard','precise'].includes(cfg.options.optSearchMode))throw new Error('탐색 모드 오류');
  if(!Array.isArray(cfg.sheets)||cfg.sheets.length!==loadedData.sheets.length)throw new Error('시트 설정 오류');
  const byName=new Map(loadedData.sheets.map(sh=>[sh.name,sh]));
  const courseExists=(name,c)=>byName.has(name)&&Object.hasOwn(byName.get(name).courses,c);
  for(let i=0;i<cfg.sheets.length;i++) {
    const c=cfg.sheets[i],sh=loadedData.sheets[i];
    if(c.name!==sh.name||!Array.isArray(c.groups)||!c.groups.length||c.groups.some(g=>typeof g!=='string'||!g.trim()||/[,:]/.test(g))||new Set(c.groups).size!==c.groups.length||!Array.isArray(c.groupCredits)||c.groupCredits.length!==c.groups.length||c.groupCredits.some(v=>!integer(v,1,10)))throw new Error('코드 설정 오류');
    for(const key of ['courses','courseCredits'])if(!c[key]||Object.keys(c[key]).length!==Object.keys(sh.courses).length||Object.keys(sh.courses).some(n=>!Object.hasOwn(c[key],n)||!integer(c[key][n],1,key==='courses'?100:10)))throw new Error('과목 설정 오류');
    if(c.expectedTotalCredits!==null&&!integer(c.expectedTotalCredits,0,100))throw new Error('기대 학점 오류');
  }
  for(const key of ['creditPairs','bigsecEntries','avoidPairs','teacherGroups'])if(!Array.isArray(cfg[key]))throw new Error('제약 설정 오류');
  for(const p of cfg.creditPairs)if(!courseExists(p.sheetName,p.course2)||!courseExists(p.sheetName,p.course1))throw new Error('결합 과목 오류');
  const bigsecKeys=new Set();
  for(const e of cfg.bigsecEntries){
    const key=JSON.stringify([e.sheetName,e.course]);
    if(!courseExists(e.sheetName,e.course)||bigsecKeys.has(key))throw new Error('대분반 과목 오류');
    bigsecKeys.add(key);
    if(cfg.schema===1 && e.maxParallel===undefined)e.maxParallel=2;
    if(e.maxParallel===null||!['number','string'].includes(typeof e.maxParallel)||String(e.maxParallel).trim()===''||!integer(e.maxParallel,1,100))throw new Error('동시 분반 상한 오류: '+e.course);
    e.maxParallel=Number(e.maxParallel);
  }
  for(const g of cfg.teacherGroups)if(!Array.isArray(g.courses)||g.courses.some(c=>!courseExists(g.sheetName,c)))throw new Error('교사 공유 오류');
  for(const p of cfg.avoidPairs) {
    const sh=byName.get(p.sheetName),rows=new Set(sh?.students.map(s=>s.rowIndex));
    if(!rows.has(p.requesterRow)||!Array.isArray(p.targetRows)||p.targetRows.some(r=>!rows.has(r)||r===p.requesterRow))throw new Error('기피 학생 오류');
  }
  if(!cfg.coverageEnabled||!cfg.coverageCourses)throw new Error('커버리지 설정 오류');
  for(const sh of loadedData.sheets)if(typeof cfg.coverageEnabled[sh.name]!=='boolean'||!Array.isArray(cfg.coverageCourses[sh.name])||cfg.coverageCourses[sh.name].some(c=>!courseExists(sh.name,c)))throw new Error('커버리지 과목 오류');
  for(let i=0;i<cfg.sheets.length;i++) {
    const c=cfg.sheets[i],sh=loadedData.sheets[i];
    sh.groups=c.groups;sh.groupCredits=c.groupCredits.map(Number);
    sh.courses=Object.fromEntries(Object.entries(c.courses).map(([k,v])=>[k,Number(v)]));
    sh.courseCredits=Object.fromEntries(Object.entries(c.courseCredits).map(([k,v])=>[k,Number(v)]));
    sh.expectedTotalCredits=c.expectedTotalCredits===null?null:Number(c.expectedTotalCredits);
    for(const cc of sh.courseCols)cc.divCount=sh.courses[cc.name];
  }
  loadedData.globalMax=Number(cfg.options.optMax);
  for(const id of optionIds)document.getElementById(id).value=cfg.options[id];
  creditPairs=cfg.creditPairs;bigsecEntries=cfg.bigsecEntries;avoidPairs=cfg.avoidPairs;teacherGroups=cfg.teacherGroups;coverageEnabled=cfg.coverageEnabled;coverageCourses=cfg.coverageCourses;
  invalidateResults();renderSheetsTable();renderCourseConfig();renderCreditPairs();renderBigsecList();renderAvoidPairs();renderTeacherGroups();renderCoverage();
}
function downloadJson(data,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.getElementById('saveSettingsBtn').addEventListener('click',()=>{
  if(!loadedData||isRunning)return;
  const data=settingsSnapshot();
  data.creditPairs=data.creditPairs.filter(p=>p.course2&&p.course1);
  data.bigsecEntries=data.bigsecEntries.filter(e=>e.course);
  data.avoidPairs=data.avoidPairs.filter(p=>p.requesterRow!=null&&p.targetRows?.length);
  data.teacherGroups=data.teacherGroups.filter(g=>g.courses?.length>=2);
  downloadJson(data,'분반배정_설정_v19.json');
});
document.getElementById('loadSettingsBtn').addEventListener('click',()=>{if(!isRunning)document.getElementById('settingsFile').click();});
document.getElementById('settingsFile').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file||isRunning)return;
  try {if(file.size>5000000)throw new Error('설정 파일이 너무 큽니다.');restoreSettings(JSON.parse(await file.text()));log('✓ 설정을 복원했습니다. 배정을 다시 실행해 주세요.','ok');}
  catch(err){alert('설정 불러오기 실패: '+err.message);} finally {e.target.value='';}
});
}
