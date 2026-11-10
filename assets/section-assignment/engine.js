// Calculation and validation rules from 분반배정도구 v19.
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function missingCounts(result) {
  const partial = result.partialMisses.reduce((n, p) => n + p.missing.length, 0);
  return { total: result.cohortMissingTotal ?? (partial + result.unassigned.reduce((n, stu) => n + stu.selected.length, 0)), whole: result.unassigned.length };
}
// All stages use the same lexicographic objective; cost is diagnostic only.
function compareEvaluations(sheet, a, b) {
  if (!b) return -1;
  const am = missingCounts(a), bm = missingCounts(b);
  const av = [a.hardViolations || 0, am.total, am.whole];
  const bv = [b.hardViolations || 0, bm.total, bm.whole];
  for (let i=0; i<av.length; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
  const balance = compareBalanceSummary(courseSpreadSummary(sheet,a.sectionLoad), courseSpreadSummary(sheet,b.sectionLoad));
  return balance || (a.cost || 0) - (b.cost || 0);
}
function copyAssignmentResult(r) {
  return {...r, assignments:Object.fromEntries(Object.entries(r.assignments).map(([k,v])=>[k,v.slice()])),
    sectionLoad:r.sectionLoad.slice(), unassigned:r.unassigned.slice(),
    partialMisses:r.partialMisses.map(p=>({...p,missing:p.missing.slice()}))};
}
function rebuildAssignmentSummary(sheet, result) {
  result.unassigned=[]; result.partialMisses=[];
  result.sectionLoad=sheet.algoState.sections.map(()=>0);
  for (const stu of sheet.students) {
    const ass=result.assignments[stu.rowIndex] || stu.selected.map(()=>-1);
    const missing=stu.selected.filter((c,i)=>ass[i]===-1);
    if (missing.length && missing.length===stu.selected.length) result.unassigned.push(stu);
    else if (missing.length) result.partialMisses.push({student:stu,missing});
    for (const sid of ass) if (sid!==-1) result.sectionLoad[sid]++;
  }
  if(sheet.cohortProjection)result.cohortMissingTotal=weightedCohortMissing(sheet,result);
}
function weightedCohortMissing(sheet,result) {
  return sheet.students.reduce((sum,stu)=>sum+stu.selected.reduce((n,c,i)=>n+((result.assignments[stu.rowIndex]?.[i] ?? -1)===-1 ? sheet.cohortProjection.innerToReal[sheet.algoState.courseToSections[c][0]].length : 0),0),0);
}
function parallelLimitForCourse(course, opts) {
  if (!opts.bigsecCourses?.has(course)) return 1;
  const raw=opts.parallelLimits && Object.hasOwn(opts.parallelLimits,course) ? opts.parallelLimits[course] : 2;
  const limit=Number(raw);
  if (!['number','string'].includes(typeof raw) || String(raw).trim()==='' || !Number.isInteger(limit) || limit<1 || limit>100) {
    throw new Error(`'${course}'의 동시 분반 상한은 1–100의 정수여야 합니다.`);
  }
  return limit;
}
function courseGroupCounts(sheet, secToGroup, nGroups) {
  const counts=Object.fromEntries(Object.keys(sheet.algoState.courseToSections).map(c=>[c,Array(nGroups).fill(0)]));
  for(let sid=0;sid<sheet.algoState.sections.length;sid++) {
    const g=secToGroup[sid];
    if(Number.isInteger(g)&&g>=0&&g<nGroups)counts[sheet.algoState.sections[sid].course][g]++;
  }
  return counts;
}
function ensureParallelCapacity(sheet, opts) {
  const credits=opts.courseCredits || sheet.courseCredits || {};
  const blockCredits=opts.groupCredits || sheet.groupCredits || Array(opts.nGroups).fill(3);
  for(const [course,ids]of Object.entries(sheet.algoState.courseToSections)) {
    const limit=parallelLimitForCourse(course,opts);
    const eligible=blockCredits.slice(0,opts.nGroups).filter(cr=>Number(credits[course] || 3)<=Number(cr || 3)).length;
    if(ids.length>eligible && !opts.bigsecCourses?.has(course))throw new Error(`'${course}': ${ids.length}분반이지만 사용 가능한 시간블록은 ${eligible}개입니다. 복수 분반을 운영하려면 대분반 과목으로 지정해 주세요.`);
    if(ids.length>eligible*limit)throw new Error(`'${course}': ${ids.length}분반을 사용 가능한 ${eligible}개 시간블록에 동시 분반 상한 ${limit}개로 배치할 수 없습니다. 현재 설정에서는 최대 ${eligible*limit}분반까지 가능합니다. 분반 수·시간블록·동시 분반 상한을 확인해 주세요.`);
  }
}
// Independent audit: recompute actual assignments, never trust cached totals alone.
function validateResult(sheet, result, opts) {
  const errors=[], sections=sheet.algoState.sections, n=sections.length;
  const loads=Array(n).fill(0), members=sections.map(()=>new Set());
  const rows=new Set(sheet.students.map(stu=>String(stu.rowIndex)));
  if (!Array.isArray(result.secToGroup) || result.secToGroup.length!==n) return {ok:false,complete:false,errors:['분반 코드 배열 길이 오류']};
  for (let sid=0;sid<n;sid++) {
    const g=result.secToGroup[sid];
    if (!Number.isInteger(g) || g<0 || g>=opts.nGroups) errors.push(`분반 ${sid}: 코드 범위 오류`);
    else if (sheet.courseCredits[sections[sid].course]>sheet.groupCredits[g]) errors.push(`분반 ${sid}: 코드 학점 초과`);
  }
  let missingTotal=0; const wholeRows=[], partialRows=new Map();
  for (const stu of sheet.students) {
    const ass=result.assignments[stu.rowIndex];
    if (ass && ass.length!==stu.selected.length) errors.push(`${studentDisplay(stu)}: 배정 배열 길이 오류`);
    const used=new Map(), seen=new Set(), missing=[];
    for (let i=0;i<stu.selected.length;i++) {
      const sid=ass ? ass[i] : -1;
      if (sid===-1) {missing.push(stu.selected[i]);continue;}
      if (!Number.isInteger(sid) || sid<0 || sid>=n) {errors.push(`${stu.rowIndex}: 잘못된 분반 번호`);continue;}
      if (seen.has(sid)) errors.push(`${stu.rowIndex}: 중복 분반 배정`);
      seen.add(sid);
      if (sections[sid].course!==stu.selected[i]) errors.push(`${stu.rowIndex}: 신청 과목 불일치`);
      loads[sid]++;members[sid].add(stu.rowIndex);
      const g=result.secToGroup[sid];
      if (!used.has(g)) used.set(g,[]);
      used.get(g).push(stu.selected[i]);
    }
    for (const [g,courses] of used) {
      if (courses.reduce((sum,c)=>sum+sheet.courseCredits[c],0)>sheet.groupCredits[g]) errors.push(`${stu.rowIndex}: 코드 학점 초과`);
      if (courses.length>2 || (courses.length===2 && !(opts.creditPairs || new Set()).has(pairKey(...courses)))) errors.push(`${stu.rowIndex}: 코드 중복 수강`);
    }
    missingTotal+=missing.length;
    if (missing.length && missing.length===stu.selected.length) wholeRows.push(stu.rowIndex);
    else if (missing.length) partialRows.set(stu.rowIndex,missing.slice().sort().join('\u0001'));
  }
  for (const row of Object.keys(result.assignments)) if (!rows.has(row)) errors.push(`존재하지 않는 학생: ${row}`);
  for (let sid=0;sid<n;sid++) {
    if (loads[sid]>opts.maxPerSection) errors.push(`분반 ${sid}: 정원 초과`);
    if (loads[sid]!==result.sectionLoad[sid]) errors.push(`분반 ${sid}: 인원 집계 불일치`);
    for (const row of members[sid]) for (const other of (opts.avoidMap || {})[row] || []) if (members[sid].has(other)) errors.push(`분반 ${sid}: 기피 학생 동반 배정`);
  }
  if (result.sectionLoad.length!==n) errors.push('인원 배열 길이 오류');
  const recordedWhole=result.unassigned.map(stu=>stu.rowIndex).sort((a,b)=>a-b);
  if (JSON.stringify(recordedWhole)!==JSON.stringify(wholeRows.sort((a,b)=>a-b))) errors.push('전체 미배정 집계 불일치');
  if (new Set(result.partialMisses.map(p=>p.student.rowIndex)).size!==result.partialMisses.length || result.partialMisses.length!==partialRows.size || result.partialMisses.some(p=>partialRows.get(p.student.rowIndex)!==p.missing.slice().sort().join('\u0001'))) errors.push('부분 미배정 집계 불일치');
  const hard=hardConstraintSummary(sheet,result.secToGroup,opts);
  if (hard.total) errors.push(`구조 필수 제약 위반: ${hard.total}건`);
  const counts=courseGroupCounts(sheet,result.secToGroup,opts.nGroups);
  const parallelLimits=Object.fromEntries(Object.keys(counts).map(c=>[c,parallelLimitForCourse(c,opts)]));
  const parallelPeaks=Object.fromEntries(Object.entries(counts).map(([c,ns])=>[c,Math.max(0,...ns)]));
  for(const [c,ns]of Object.entries(counts))for(let g=0;g<ns.length;g++)if(ns[g]>parallelLimits[c]) {
    errors.push(`동시 분반 상한 초과: '${c}' ${sheet.groups?.[g] ?? g} ${ns[g]}분반 > 상한 ${parallelLimits[c]}개`);
  }
  const cohort=auditCoupledCohorts(sheet,result,opts);
  errors.push(...cohort.errors);
  return {ok:errors.length===0,complete:missingTotal===0,missingTotal,errors:[...new Set(errors)],loads,parallelLimits,parallelPeaks,cohortOk:cohort.ok,cohortLinks:cohort.links};
}

function studentDisplay(stu) {
  const bits = [];
  if (stu.studentId != null && stu.studentId !== '') bits.push(String(stu.studentId));
  else {
    if (stu.grade != null && stu.grade !== '') bits.push(String(stu.grade));
    if (stu.cls != null && stu.cls !== '') bits.push(String(stu.cls));
    if (stu.num != null && stu.num !== '') bits.push(String(stu.num));
  }
  if (stu.name) bits.push(stu.name);
  return bits.join(' ');
}

// 시드 기반 난수
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleInPlace(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// 범용 분반 코드 기본값
function alphaCode(i) {
  let n = i + 1, out = '';
  while (n > 0) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function defaultGroupsFor(sheetName, nPerStudent) {
  const n = Math.max(1, nPerStudent || 1);
  return Array.from({length: n}, (_, i) => alphaCode(i));
}

function defaultGradeFor(sheetName) {
  const m = sheetName.match(/(\d+)\s*학년/);
  return m ? parseInt(m[1], 10) : null;
}

function isSelectedValue(v) {
  if (v === 1 || v === 1.0 || v === true) return true;
  if (typeof v !== 'string') return false;
  const t = v.trim().toUpperCase();
  return t === '1' || t === 'O' || t === 'Y' || t === 'YES' || t === '○' || t === '선택';
}

function isUnselectedValue(v) {
  if (v == null || v === '' || v === 0 || v === 0.0 || v === false) return true;
  if (typeof v !== 'string') return false;
  const t = v.trim().toUpperCase();
  return t === '' || t === '0' || t === 'X' || t === 'N' || t === 'NO' || t === 'FALSE' || t === '-' || t === '미선택';
}

function parseWorkbook(wb,XLSX) {
  // 과거 형식의 '과목별분반수' 시트가 있으면 기본 분반 수에 활용하되 필수로 요구하지 않음.
  const legacyDiv = {};
  const legacyIssues = [];
  if (wb.SheetNames.includes('과목별분반수')) {
    const wsDiv = wb.Sheets['과목별분반수'];
    const rowsDiv = XLSX.utils.sheet_to_json(wsDiv, { header: 1, defval: null });
    for (let i = 1; i < rowsDiv.length; i++) {
      const r = rowsDiv[i];
      if (!r || r[0] == null || String(r[0]).trim() === '') continue;
      const name = String(r[0]).trim();
      const n = Number(r[1]);
      if (!Number.isInteger(n) || n <= 0) {
        legacyIssues.push(`과목별분반수 ${i + 1}행 '${name}': 분반 수가 올바르지 않습니다.`);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(legacyDiv, name) && legacyDiv[name] !== n) {
        legacyIssues.push(`과목별분반수에서 '${name}'이 서로 다른 분반 수(${legacyDiv[name]}, ${n})로 중복되어 있습니다.`);
        continue;
      }
      legacyDiv[name] = n;
    }
  }

  const sheetNames = wb.SheetNames.filter(n => n !== '과목별분반수');
  const sheets = [];
  const ID_HEADERS = ['학년','반','번호','학번','이름'];
  const META_HEADERS = new Set(['비고','성별','담임','담임교사','연락처','전화번호','보호자연락처']);

  for (const name of sheetNames) {
    if(Object.hasOwn(Object.prototype,name))throw new Error('사용할 수 없는 시트명: '+name);
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 2) continue;

    // 첫 5행 중 학생 식별 열이 가장 많이 나타나는 행을 헤더로 사용.
    let headerRowIdx = 0, bestMatchCount = -1;
    for (let ri = 0; ri < Math.min(5, rows.length); ri++) {
      const vals = (rows[ri] || []).map(h => h == null ? '' : String(h).trim());
      const matchCount = ID_HEADERS.filter(f => vals.includes(f)).length;
      if (matchCount > bestMatchCount) { bestMatchCount = matchCount; headerRowIdx = ri; }
    }
    const header = (rows[headerRowIdx] || []).map(h => h == null ? '' : String(h).trim());
    const fixedIdx = {};
    for (const f of ID_HEADERS) {
      const i = header.indexOf(f);
      if (i >= 0) fixedIdx[f] = i;
    }
    if (fixedIdx.이름 == null && fixedIdx.학번 == null) continue;

    const courseCols = [];
    const courseNameCounts = new Map();
    for (let i = 0; i < header.length; i++) {
      if (ID_HEADERS.includes(header[i]) || META_HEADERS.has(header[i]) || !header[i]) continue;
      const cName = header[i];
      if(Object.hasOwn(Object.prototype,cName))throw new Error('사용할 수 없는 과목명: '+cName);
      courseNameCounts.set(cName, (courseNameCounts.get(cName) || 0) + 1);
      courseCols.push({ name: cName, colIdx: i, divCount: 1 });
    }
    if (courseCols.length === 0) continue;
    const duplicateCourses = [...courseNameCounts.entries()].filter(([, n]) => n > 1).map(([c]) => c);
    if (duplicateCourses.length) {
      throw new Error(`[${name}] 동일한 과목명이 여러 열에 있습니다: ${duplicateCourses.join(', ')}`);
    }

    const students = [];
    const seenIds = new Map();
    const seenPositions = new Map();
    const perCounts = new Set();
    const applicants = Object.fromEntries(courseCols.map(cc => [cc.name, 0]));
    const unknownSelectionCells = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const nameVal = fixedIdx.이름 != null ? r[fixedIdx.이름] : null;
      const idVal = fixedIdx.학번 != null ? r[fixedIdx.학번] : null;
      if ((nameVal == null || nameVal === '') && (idVal == null || idVal === '')) continue;
      const identity = idVal == null ? '' : String(idVal).trim();
      const position = ['학년','반','번호'].every(k=>fixedIdx[k]!=null && r[fixedIdx[k]]!=null && String(r[fixedIdx[k]]).trim()!=='')
        ? ['학년','반','번호'].map(k=>String(r[fixedIdx[k]]).trim()).join('-') : '';
      for (const [key,map,label] of [[identity,seenIds,'학번'],[position,seenPositions,'학년·반·번호']]) {
        if (!key) continue;
        if (map.has(key)) throw new Error(`[${name}] ${label} 중복: ${key} (${map.get(key)}행, ${i+1}행)`);
        map.set(key,i+1);
      }
      const sel = [];
      for (const cc of courseCols) {
        const cellValue = r[cc.colIdx];
        if (isSelectedValue(cellValue)) {
          sel.push(cc.name);
          applicants[cc.name]++;
        } else if (!isUnselectedValue(cellValue)) {
          unknownSelectionCells.push({
            excelRow: i + 1,
            course: cc.name,
            value: String(cellValue),
            studentId: idVal == null ? '' : String(idVal),
            studentName: nameVal == null ? '' : String(nameVal),
          });
        }
      }
      perCounts.add(sel.length);
      students.push({
        grade: fixedIdx.학년 != null ? r[fixedIdx.학년] : defaultGradeFor(name),
        cls: fixedIdx.반 != null ? r[fixedIdx.반] : null,
        num: fixedIdx.번호 != null ? r[fixedIdx.번호] : null,
        studentId: fixedIdx.학번 != null ? r[fixedIdx.학번] : null,
        name: nameVal == null ? '' : String(nameVal),
        selected: sel,
        rowIndex: i,
        sheetName: name,
      });
    }
    if (students.length === 0) continue;
    if(students.every(stu=>stu.selected.length===0))throw new Error(`[${name}] 수강신청 과목이 하나도 없습니다. 선택 표기를 확인해 주세요.`);

    const counts = [...perCounts].filter(c => c > 0).sort((a,b)=>b-a);
    const nPerStudent = counts.length > 0 ? counts[0] : 0;
    const defaultMax = 35;
    const courses = {};
    const courseCredits = {};
    for (const cc of courseCols) {
      const autoDiv = Math.max(1, Math.ceil((applicants[cc.name] || 0) / defaultMax));
      courses[cc.name] = legacyDiv[cc.name] || autoDiv;
      courseCredits[cc.name] = 3;
      cc.divCount = courses[cc.name];
    }
    const groups = defaultGroupsFor(name, nPerStudent);
    sheets.push({
      name,
      grade: defaultGradeFor(name),
      students,
      courses,
      courseCredits,
      applicants,
      courseCols,
      header,
      rows,
      fixedIdx,
      groups,
      groupCredits: groups.map(() => 3),
      nPerStudent,
      perCounts: [...perCounts],
      expectedTotalCredits: null,
      missingCourses: [],
      dataIssues: {
        unknownSelectionCells,
        zeroApplicantCourses: Object.keys(applicants).filter(c => (applicants[c] || 0) === 0),
      },
    });
  }
  if (sheets.length === 0) {
    throw new Error('수강신청 시트를 찾지 못했습니다. 학번·이름 또는 학년·반·번호·이름 열을 확인해 주세요.');
  }
  const usedCourseNames = new Set();
  for (const sh of sheets) for (const c of Object.keys(sh.courses)) usedCourseNames.add(c);
  const unusedLegacyCourses = Object.keys(legacyDiv).filter(c => !usedCourseNames.has(c));
  return { sheets, courseToDiv: legacyDiv, legacyIssues, unusedLegacyCourses, globalMax: 35 };
}

function buildSections(sheet) {
  const sections = [];
  const courseToSections = {};
  for (const c of Object.keys(sheet.courses)) {
    courseToSections[c] = [];
    for (let i = 0; i < sheet.courses[c]; i++) {
      courseToSections[c].push(sections.length);
      sections.push({ course: c, idx: i + 1 });
    }
  }
  return { sections, courseToSections };
}

// 초기 분반-코드 배정 (대분반 과목의 중복 코드 위치는 자동 최적화)
// 교사 공유 과목 → 분반 간 충돌 매트릭스
// teacherGroups: [[courseName, courseName, ...], ...] (시트별 입력)
// 반환: secToConflictSecs[sid] = Set<other_sid> — 같은 그룹에 들어가면 안 됨
function computeConflictSections(sheet, teacherGroups) {
  const conflicts = sheet.algoState.sections.map(() => new Set());
  if (!teacherGroups || !teacherGroups.length) return conflicts;
  const { courseToSections } = sheet.algoState;
  for (const group of teacherGroups) {
    const allSecs = [];
    for (const cName of group) {
      const secs = courseToSections[cName];
      if (secs) for (const s of secs) allSecs.push(s);
    }
    for (const a of allSecs) {
      for (const b of allSecs) {
        if (a !== b) conflicts[a].add(b);
      }
    }
  }
  return conflicts;
}

function initialGroupAssignment(sections, courseToSections, nGroups, rnd, bigsecCourses, conflicts, groupCredits, courseCredits, parallelLimits, cohortPools = []) {
  const secToGroup = new Array(sections.length).fill(-1);
  const groupLoadSec = new Array(nGroups).fill(0);
  const courses = Object.keys(courseToSections).slice();
  const capOpts={nGroups,bigsecCourses,groupCredits,courseCredits,parallelLimits};
  ensureParallelCapacity({algoState:{sections,courseToSections}},capOpts);
  const courseCounts=Object.fromEntries(courses.map(c=>[c,Array(nGroups).fill(0)]));
  const limits=Object.fromEntries(courses.map(c=>[c,parallelLimitForCourse(c,capOpts)]));
  const poolCounts=cohortPools.map(()=>Array(nGroups).fill(0));
  const poolsByCourse=Object.fromEntries(courses.map(c=>[c,cohortPools.map((pool,i)=>pool.ids.some(sid=>sections[sid].course===c)?i:-1).filter(i=>i>=0)]));
  const poolFits=(c,g)=>poolsByCourse[c].every(i=>poolCounts[i][g]<cohortPools[i].limit);
  courses.sort((a, b) => courseToSections[b].length - courseToSections[a].length);

  function forbiddenFor(sid, courseName) {
    const f = new Set();
    if (conflicts) {
      for (const other of conflicts[sid]) {
        if (secToGroup[other] !== -1) f.add(secToGroup[other]);
      }
    }
    return f;
  }

  const groupsByLoad = (forbidden, courseName) => {
    const cr = Number((courseCredits && courseCredits[courseName]) || 3);
    const gs = [...Array(nGroups).keys()].filter(g => !forbidden.has(g) && courseCounts[courseName][g]<limits[courseName] && cr <= Number((groupCredits && groupCredits[g]) || 3) && poolFits(courseName,g));
    gs.sort((g1, g2) => {
      if (groupLoadSec[g1] !== groupLoadSec[g2]) return groupLoadSec[g1] - groupLoadSec[g2];
      return rnd() - 0.5;
    });
    return gs;
  };

  for (const c of courses) {
    const secs = courseToSections[c].slice();
    const usedGroups = new Set();
    let remaining = secs.slice();
    while (remaining.length > 0 && usedGroups.size < nGroups) {
      const sid = remaining[0];
      const forbidden = forbiddenFor(sid, c);
      // 이미 사용한 같은 과목 그룹도 제외
      for (const g of usedGroups) forbidden.add(g);
      let gs = groupsByLoad(forbidden, c);
      if (gs.length === 0) {
        // 초기해 생성 단계에서는 충돌을 일시적으로 허용할 수 있으며, 최종 후보에서는 hard constraint 위반 0만 채택한다.
        const soft = new Set(usedGroups);
        gs = groupsByLoad(soft, c);
      }
      if (gs.length === 0) break;
      remaining.shift();
      const g = gs[0];
      secToGroup[sid] = g;
      groupLoadSec[g]++;
      courseCounts[c][g]++;
      for(const i of poolsByCourse[c])poolCounts[i][g]++;
      usedGroups.add(g);
    }
    // 대분반 초과분: 특정 코드를 사전 지정하지 않고 탐색 가능한 코드 중 자동 선택
    while (remaining.length > 0) {
      const sid = remaining.shift();
      const forbidden = forbiddenFor(sid, c);
      let gs = groupsByLoad(forbidden, c);
      if (gs.length === 0) {
        // 교사 충돌은 복구를 시도하되 동시 분반 상한과 코드 학점은 지킨다.
        gs = groupsByLoad(new Set(), c);
      }
      if(gs.length===0)throw new Error(`'${c}': 동시 분반 상한 내에서 초기 배치를 만들 수 없습니다.`);
      const g = gs[0];
      secToGroup[sid] = g;
      groupLoadSec[g]++;
      courseCounts[c][g]++;
      for(const i of poolsByCourse[c])poolCounts[i][g]++;
    }
  }
  return secToGroup;
}

function pairKey(a, b) {
  return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
}

function findBestPartialMatching(courseOpts, courseNames, nGroups, groupCredits, courseCredits, creditPairs, sectionLoad) {
  const n=courseOpts.length;
  let bestCount=-1, bestLoadScore=Infinity, bestMaxLoad=Infinity;
  let bestResult=Array(n).fill(-1);
  const caps=Array.from({length:nGroups},(_,g)=>Number(groupCredits[g] || 3));
  const credits=courseNames.map(c=>Number(courseCredits[c] || 3));
  const paired=courseNames.map((c,i)=>courseNames.map((other,j)=>i!==j && !!creditPairs?.has(pairKey(c,other))));
  const choices=courseOpts.map(xs=>xs.map(([g,sid])=>[g,sid,Number(sectionLoad?.[sid] || 0)]));
  const suffixCount=Array(n+1).fill(0),suffixMinLoad=Array(n+1).fill(0),suffixMinMax=Array(n+1).fill(0);
  for(let i=n-1;i>=0;i--) {
    const min=choices[i].length ? Math.min(...choices[i].map(x=>x[2])) : 0;
    suffixCount[i]=suffixCount[i+1]+Number(choices[i].length>0);
    suffixMinLoad[i]=suffixMinLoad[i+1]+min;
    suffixMinMax[i]=Math.max(suffixMinMax[i+1],min);
  }
  const first=Array(nGroups).fill(-1),used=Array(nGroups).fill(0),cur=Array(n).fill(-1);
  function bt(i,count,loadScore,maxLoad) {
    const upper=count+suffixCount[i];
    if(upper<bestCount)return;
    // If the maximum count can only tie, every remaining nonempty course
    // must be included. Independent per-course minima are admissible bounds.
    if(upper===bestCount) {
      const lower=loadScore+suffixMinLoad[i];
      if(lower>bestLoadScore || (lower===bestLoadScore && Math.max(maxLoad,suffixMinMax[i])>=bestMaxLoad))return;
    }
    if(i===n) {
      if(count>bestCount || (count===bestCount && (loadScore<bestLoadScore || (loadScore===bestLoadScore && maxLoad<bestMaxLoad)))) {
        bestCount=count;bestLoadScore=loadScore;bestMaxLoad=maxLoad;bestResult=cur.slice();
      }
      return;
    }
    for(const [g,sid,load] of choices[i]) {
      if(credits[i]>caps[g] || used[g]>=2)continue;
      const prior=first[g];
      if(used[g]===1 && (!paired[i][prior] || credits[i]+credits[prior]>caps[g]))continue;
      if(used[g]===0)first[g]=i;
      used[g]++;cur[i]=sid;
      bt(i+1,count+1,loadScore+load,Math.max(maxLoad,load));
      used[g]--;first[g]=prior;cur[i]=-1;
    }
    bt(i+1,count,loadScore,maxLoad);
  }
  bt(0,0,0,0);
  return {matched:bestResult,count:Math.max(0,bestCount)};
}

function assignStudents(sheet, secToGroup, opts) {
  const { sections, courseToSections } = sheet.algoState;
  const { maxPerSection, nGroups, rnd, avoidMap, groupCredits, courseCredits, creditPairs } = opts;
  const hasAvoid = avoidMap && Object.keys(avoidMap).length > 0;

  // 대단위 분반 지원: course → group → [sids]
  const courseGroupToSecs = {};
  for (const c of Object.keys(courseToSections)) {
    courseGroupToSecs[c] = {};
    for (const s of courseToSections[c]) {
      const g = secToGroup[s];
      if (!courseGroupToSecs[c][g]) courseGroupToSecs[c][g] = [];
      courseGroupToSecs[c][g].push(s);
    }
  }

  const sectionLoad = new Array(sections.length).fill(0);
  const sectionStudents = hasAvoid ? sections.map(() => new Set()) : null;
  const assignments = {};
  const unassigned = [];
  const partialMisses = [];

  function freedom(stu) {
    let f = 1;
    for (const c of stu.selected) {
      f *= Object.keys(courseGroupToSecs[c] || {}).length || 1;
    }
    if (hasAvoid) {
      const a = avoidMap[stu.rowIndex];
      if (a && a.size > 0) f = f / (1 + a.size * 10);
    }
    return f;
  }
  const freedomByRow=new Map(sheet.students.map(stu=>[stu.rowIndex,freedom(stu)]));
  const stuOrder = sheet.students.slice();
  stuOrder.sort((a, b) => {
    const fa = freedomByRow.get(a.rowIndex), fb = freedomByRow.get(b.rowIndex);
    if (fa !== fb) return fa - fb;
    return rnd() - 0.5;
  });

  for (const stu of stuOrder) {
    if (stu.selected.length === 0) {
      assignments[stu.rowIndex] = [];
      continue;
    }
    const myAvoids = hasAvoid ? avoidMap[stu.rowIndex] : null;
    const cg = [];
    for (const c of stu.selected) {
      const opts2 = [];
      const m = courseGroupToSecs[c] || {};
      for (const gStr of Object.keys(m)) {
        const g = +gStr;
        let eligible = m[gStr].filter(s => sectionLoad[s] < maxPerSection);
        if (myAvoids && myAvoids.size > 0) {
          eligible = eligible.filter(s => {
            for (const otherRow of sectionStudents[s]) {
              if (myAvoids.has(otherRow)) return false;
            }
            return true;
          });
        }
        if (eligible.length === 0) continue;
        eligible.sort((a, b) => sectionLoad[a] - sectionLoad[b] || rnd() - 0.5);
        opts2.push([g, eligible[0]]);
      }
      if (opts2.length > 1) {
        // 균등 배정 우선: 같은 과목의 가능한 분반 중 현재 인원이 가장 적은 분반부터 검토한다.
        opts2.sort((a, b) => sectionLoad[a[1]] - sectionLoad[b[1]] || rnd() - 0.5);
      }
      cg.push(opts2);
    }

    const order = cg.map((_, i) => i).sort((a, b) => cg[a].length - cg[b].length);
    const reordered = order.map(i => cg[i]);
    const reorderedCourses = order.map(i => stu.selected[i]);
    const partial = findBestPartialMatching(reordered, reorderedCourses, nGroups, groupCredits || sheet.groupCredits, courseCredits || sheet.courseCredits, creditPairs, sectionLoad);

    const perCourse = new Array(stu.selected.length).fill(-1);
    for (let k = 0; k < order.length; k++) {
      if (partial.matched[k] !== -1) perCourse[order[k]] = partial.matched[k];
    }
    if (partial.count === 0) {
      unassigned.push(stu);
      continue;
    }
    const missing = [];
    for (let i = 0; i < stu.selected.length; i++) {
      if (perCourse[i] === -1) missing.push(stu.selected[i]);
    }
    if (missing.length > 0) partialMisses.push({ student: stu, missing });
    assignments[stu.rowIndex] = perCourse;
    for (const sid of perCourse) {
      if (sid === -1) continue;
      sectionLoad[sid]++;
      if (hasAvoid) sectionStudents[sid].add(stu.rowIndex);
    }
  }
  const result={ assignments, unassigned, partialMisses, sectionLoad };
  if(sheet.cohortProjection)result.cohortMissingTotal=weightedCohortMissing(sheet,result);
  return result;
}

// ============================================================
// 2차 학생 분반 균등화
// 1차 탐색이 만든 코드/분반 구조는 그대로 유지하고, 같은 과목 안에서 학생만 이동한다.
// 따라서 교사 공유·코드 커버리지·대분반 등 분반-코드 hard constraint에는 영향을 주지 않는다.
// ============================================================
function canStudentMoveToSection(sheet, secToGroup, result, stu, courseIdx, targetSid, opts, sectionMembers) {
  const ass = result.assignments[stu.rowIndex];
  if (!ass || ass[courseIdx] === -1) return false;
  const sourceSid = ass[courseIdx];
  if (sourceSid === targetSid) return false;

  const cName = stu.selected[courseIdx];
  const targetGroup = secToGroup[targetSid];
  const groupCredits = opts.groupCredits || sheet.groupCredits || [];
  const courseCredits = opts.courseCredits || sheet.courseCredits || {};
  const creditPairs = opts.creditPairs || new Set();
  const cap = Number(groupCredits[targetGroup] || 3);
  const cr = Number(courseCredits[cName] || 3);
  if (cr > cap) return false;

  // 이동 후 같은 코드에 존재하게 되는 다른 과목을 확인한다.
  const sameGroupCourses = [];
  for (let i = 0; i < ass.length; i++) {
    if (i === courseIdx || ass[i] === -1) continue;
    if (secToGroup[ass[i]] === targetGroup) sameGroupCourses.push(stu.selected[i]);
  }
  if (sameGroupCourses.length >= 2) return false;
  if (sameGroupCourses.length === 1) {
    const other = sameGroupCourses[0];
    const otherCr = Number(courseCredits[other] || 3);
    if (!creditPairs.has(pairKey(cName, other)) || cr + otherCr > cap) return false;
  }

  // 동일 분반 기피 조건 확인. buildAvoidMapsBySheet()는 양방향 Set을 만든다.
  const avoidMap = opts.avoidMap || {};
  const myAvoids = avoidMap[stu.rowIndex];
  if (myAvoids && myAvoids.size > 0) {
    for (const otherRow of sectionMembers[targetSid]) {
      if (myAvoids.has(otherRow)) return false;
    }
  }
  return true;
}

function courseSpreadSummary(sheet, sectionLoad) {
  if(sheet.cohortProjection)return courseSpreadSummary(sheet.cohortProjection.sheet,expandCohortLoads(sheet,sectionLoad));
  const out = {};
  let maxSpread = 0;
  let highSpreadCount = 0; // 최대-최소 편차가 3명 이상인 과목 수
  let totalSpread = 0;     // 모든 과목의 최대-최소 편차 합
  let totalExcess = 0;     // 1명을 초과하는 편차 합(기존 로그/호환용)
  let varianceScore = 0;   // 과목별 평균에서 벗어난 제곱편차 합
  const { courseToSections } = sheet.algoState;
  for (const c of Object.keys(courseToSections)) {
    const secs = courseToSections[c];
    const loads = secs.map(sid => Number(sectionLoad[sid] || 0));
    if (loads.length === 0) continue;
    const max = Math.max(...loads), min = Math.min(...loads);
    const spread = max - min;
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
    let courseVariance = 0;
    for (const l of loads) {
      const d = l - mean;
      courseVariance += d * d;
    }
    out[c] = { min, max, spread, variance: courseVariance };
    maxSpread = Math.max(maxSpread, spread);
    if (spread >= 3) highSpreadCount++;
    totalSpread += spread;
    totalExcess += Math.max(0, spread - 1);
    varianceScore += courseVariance;
  }
  return { courses: out, maxSpread, highSpreadCount, totalSpread, totalExcess, varianceScore };
}

// 분반 균형은 가중합이 아니라 사전식(lexicographic)으로 비교한다.
// 1) 전체 과목 중 최대 편차 최소화
// 2) 전체 분반의 제곱편차 합(varianceScore) 최소화
// 3) 전체 과목의 최대-최소 편차 합 최소화
// 4) 편차 3명 이상 과목 수 최소화 (보조 기준)
function compareBalanceSummary(a, b) {
  const av = [a.maxSpread, a.varianceScore, a.totalSpread, a.highSpreadCount];
  const bv = [b.maxSpread, b.varianceScore, b.totalSpread, b.highSpreadCount];
  for (let i = 0; i < av.length; i++) {
    const d = Number(av[i] || 0) - Number(bv[i] || 0);
    if (Math.abs(d) > 1e-9) return d < 0 ? -1 : 1;
  }
  return 0;
}

function courseBalanceObjective(sheet, sectionLoad, courseName, allowedDiff) {
  const secs = sheet.algoState.courseToSections[courseName] || [];
  if (secs.length <= 1) return 0;
  const loads = secs.map(sid => Number(sectionLoad[sid] || 0));
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  const max = Math.max(...loads), min = Math.min(...loads);
  const excess = Math.max(0, max - min - Number(allowedDiff || 0));
  let score = excess * excess * 25;
  for (const l of loads) {
    const d = l - mean;
    score += d * d * 0.15;
  }
  return score;
}

function rematchStudentsForBalance(sheet, secToGroup, result, opts, sectionMembers) {
  const { courseToSections } = sheet.algoState;
  const maxPerSection = Number(opts.maxPerSection || 9999);
  const groupCredits = opts.groupCredits || sheet.groupCredits || [];
  const courseCredits = opts.courseCredits || sheet.courseCredits || {};
  const creditPairs = opts.creditPairs || new Set();
  const avoidMap = opts.avoidMap || {};
  const rnd = mulberry32(((opts.seed || opts.baseSeed || 42) * 2654435761) >>> 0);
  let rematchMoves = 0;
  let passes = 0;
  const maxPasses = Math.max(2, Number(opts.rebalancePasses || 3));
  let currentBalance = courseSpreadSummary(sheet, result.sectionLoad);

  // 편차가 2 이상인 과목의 '평균보다 많은 분반'에 속한 학생만 재매칭 후보로 삼는다.
  // 균형에 직접 기여할 가능성이 거의 없는 학생 345명 전체를 반복 검사하던 비용을 줄인다.
  function buildCandidateRows() {
    const score = new Map();
    for (const c of Object.keys(courseToSections)) {
      const secs = courseToSections[c];
      if (secs.length <= 1) continue;
      const vals = secs.map(sid => Number(result.sectionLoad[sid] || 0));
      const max = Math.max(...vals), min = Math.min(...vals);
      if (max - min < 2) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const highSecs = secs.filter(sid => Number(result.sectionLoad[sid] || 0) > mean + 1e-9);
      const sources = highSecs.length ? highSecs : secs.filter(sid => Number(result.sectionLoad[sid] || 0) === max);
      for (const sid of sources) {
        for (const row of sectionMembers[sid]) score.set(row, (score.get(row) || 0) + 1);
      }
    }
    return [...score.entries()]
      .sort((a, b) => b[1] - a[1] || (rnd() - 0.5))
      .map(([row]) => row);
  }

  const studentByRow = new Map(sheet.students.map(s => [s.rowIndex, s]));

  for (let pass = 0; pass < maxPasses; pass++) {
    passes++;
    let changed = 0;
    const candidateRows = buildCandidateRows();
    if (candidateRows.length === 0) break;

    for (const rowIndex of candidateRows) {
      const stu = studentByRow.get(rowIndex);
      if (!stu) continue;
      const oldAss = result.assignments[stu.rowIndex];
      if (!oldAss || oldAss.length !== stu.selected.length || oldAss.some(s => s === -1)) continue;
      const beforeBalance = currentBalance;
      const oldCopy = oldAss.slice();

      // 학생 한 명을 잠시 빼고 현재 여유 인원을 기준으로 전체 선택과목을 다시 매칭한다.
      for (const sid of oldCopy) {
        result.sectionLoad[sid]--;
        sectionMembers[sid].delete(stu.rowIndex);
      }

      const cg = [];
      let impossible = false;
      const myAvoids = avoidMap[stu.rowIndex];
      for (const c of stu.selected) {
        // 같은 코드에 복수 분반이 있으면 가장 덜 찬 적격 분반 하나만 후보로 둔다.
        const bestByGroup = new Map();
        for (const sid of (courseToSections[c] || [])) {
          if (result.sectionLoad[sid] >= maxPerSection) continue;
          if (myAvoids && myAvoids.size > 0) {
            let blocked = false;
            for (const otherRow of sectionMembers[sid]) {
              if (myAvoids.has(otherRow)) { blocked = true; break; }
            }
            if (blocked) continue;
          }
          const g = secToGroup[sid];
          const load = Number(result.sectionLoad[sid] || 0);
          const prev = bestByGroup.get(g);
          if (!prev || load < prev.load || (load === prev.load && sid < prev.sid)) {
            bestByGroup.set(g, { sid, load });
          }
        }
        const opts2 = [...bestByGroup.entries()]
          .map(([g, x]) => [Number(g), x.sid])
          .sort((a, b) => result.sectionLoad[a[1]] - result.sectionLoad[b[1]] || a[0] - b[0]);
        if (opts2.length === 0) impossible = true;
        cg.push(opts2);
      }

      let newAss = null;
      if (!impossible) {
        const idxOrder = cg.map((_, i) => i).sort((a, b) => cg[a].length - cg[b].length);
        const reordered = idxOrder.map(i => cg[i]);
        const reorderedCourses = idxOrder.map(i => stu.selected[i]);
        const matched = findBestPartialMatching(reordered, reorderedCourses, opts.nGroups, groupCredits, courseCredits, creditPairs, result.sectionLoad);
        if (matched.count === stu.selected.length) {
          newAss = new Array(stu.selected.length).fill(-1);
          for (let k = 0; k < idxOrder.length; k++) newAss[idxOrder[k]] = matched.matched[k];
        }
      }

      if (!newAss) {
        for (const sid of oldCopy) {
          result.sectionLoad[sid]++;
          sectionMembers[sid].add(stu.rowIndex);
        }
        continue;
      }

      // 실제로 동일한 배정이면 균형 계산 자체를 생략한다.
      let same = true;
      for (let i = 0; i < newAss.length; i++) {
        if (newAss[i] !== oldCopy[i]) { same = false; break; }
      }
      if (same) {
        for (const sid of oldCopy) {
          result.sectionLoad[sid]++;
          sectionMembers[sid].add(stu.rowIndex);
        }
        continue;
      }

      for (const sid of newAss) {
        result.sectionLoad[sid]++;
        sectionMembers[sid].add(stu.rowIndex);
      }
      const afterBalance = courseSpreadSummary(sheet, result.sectionLoad);

      if (compareBalanceSummary(afterBalance, beforeBalance) < 0) {
        result.assignments[stu.rowIndex] = newAss;
        currentBalance = afterBalance;
        changed++;
        rematchMoves++;
      } else {
        for (const sid of newAss) {
          result.sectionLoad[sid]--;
          sectionMembers[sid].delete(stu.rowIndex);
        }
        for (const sid of oldCopy) {
          result.sectionLoad[sid]++;
          sectionMembers[sid].add(stu.rowIndex);
        }
      }
    }
    if (changed === 0) break;
  }
  return { rematchMoves, passes, candidateLimited: true };
}

function rebalanceStudentAssignments(sheet, secToGroup, result, opts) {
  const pmCount = result.partialMisses.reduce((a, p) => a + p.missing.length, 0);
  const before = courseSpreadSummary(sheet, result.sectionLoad);
  // 미배정이 남은 후보는 우선 배정 완성이 더 중요하므로 후처리하지 않는다.
  if (result.unassigned.length > 0 || pmCount > 0) {
    return { moves: 0, passes: 0, before, after: before, skipped: true };
  }

  const { sections, courseToSections } = sheet.algoState;
  const maxPerSection = Number(opts.maxPerSection || 9999);
  const studentByRow = new Map(sheet.students.map(s => [s.rowIndex, s]));
  const sectionMembers = sections.map(() => new Set());
  for (const stu of sheet.students) {
    const ass = result.assignments[stu.rowIndex] || [];
    for (const sid of ass) if (sid !== -1) sectionMembers[sid].add(stu.rowIndex);
  }

  let moves = 0;
  let passes = 0;
  const maxPasses = Math.max(4, Object.keys(courseToSections).length * 3);
  let changed = true;

  while (changed && passes < maxPasses) {
    changed = false;
    passes++;
    for (const c of Object.keys(courseToSections)) {
      const secs = courseToSections[c];
      if (secs.length <= 1) continue;

      // 한 과목 안에서 최대-최소 차이가 1 이하가 될 때까지 직접 이동을 반복한다.
      // 구조적 제약 때문에 이동할 수 없으면 해당 과목은 현재 상태에서 종료한다.
      let safety = sheet.students.length + secs.length * 4;
      while (safety-- > 0) {
        const sortedHigh = secs.slice().sort((a, b) => result.sectionLoad[b] - result.sectionLoad[a] || a - b);
        const sortedLow = secs.slice().sort((a, b) => result.sectionLoad[a] - result.sectionLoad[b] || a - b);
        const maxLoad = result.sectionLoad[sortedHigh[0]];
        const minLoad = result.sectionLoad[sortedLow[0]];
        if (maxLoad - minLoad <= 1) break;

        let moved = false;
        for (const sourceSid of sortedHigh) {
          for (const targetSid of sortedLow) {
            if (sourceSid === targetSid) continue;
            if (result.sectionLoad[sourceSid] - result.sectionLoad[targetSid] < 2) continue;
            if (result.sectionLoad[targetSid] >= maxPerSection) continue;

            // 현재 과목의 과밀 분반 학생 중 실제 이동 가능한 학생을 찾는다.
            const rows = [...sectionMembers[sourceSid]].sort((a, b) => a - b);
            for (const rowIndex of rows) {
              const stu = studentByRow.get(rowIndex);
              if (!stu) continue;
              const courseIdx = stu.selected.indexOf(c);
              if (courseIdx < 0) continue;
              if ((result.assignments[rowIndex] || [])[courseIdx] !== sourceSid) continue;
              if (!canStudentMoveToSection(sheet, secToGroup, result, stu, courseIdx, targetSid, opts, sectionMembers)) continue;

              result.assignments[rowIndex][courseIdx] = targetSid;
              sectionMembers[sourceSid].delete(rowIndex);
              sectionMembers[targetSid].add(rowIndex);
              result.sectionLoad[sourceSid]--;
              result.sectionLoad[targetSid]++;
              moves++;
              moved = true;
              changed = true;
              break;
            }
            if (moved) break;
          }
          if (moved) break;
        }
        if (!moved) break;
      }
    }
  }

  // 직접 이동으로 해결되지 않는 경우, 학생 한 명의 전체 선택과목을 다시 매칭해 코드 충돌 없이 추가 균등화한다.
  const rematch = rematchStudentsForBalance(sheet, secToGroup, result, opts, sectionMembers);
  const directMoves = moves;
  moves += rematch.rematchMoves;
  const after = courseSpreadSummary(sheet, result.sectionLoad);
  return { moves, directMoves, rematchMoves: rematch.rematchMoves, passes: passes + rematch.passes, before, after, skipped: false };
}

function computeAssignmentObjectiveCost(sheet, res, opts) {
  const unCost = res.unassigned.length * 1000;
  const pmCount = res.partialMisses.reduce((a, p) => a + p.missing.length, 0);
  const partialCost = pmCount * 300;
  let balCost = 0;
  const { courseToSections } = sheet.algoState;
  for (const c of Object.keys(courseToSections)) {
    balCost += courseBalanceObjective(sheet, res.sectionLoad, c, opts.allowedDiff);
  }
  return unCost + partialCost + balCost;
}

// 같은 과목의 분반들은 가능한 한 서로 다른 코드에 배치한다.
// 단, 과목 학점을 수용할 수 있는 코드만 대상이며, 대분반 과목의 초과분은 동일 코드 중복을 허용한다.
function computeGroupSpreadPenalty(sheet, secToGroup, opts) {
  const { courseToSections } = sheet.algoState;
  const nGroups = opts.nGroups;
  const groupCredits = opts.groupCredits || sheet.groupCredits || [];
  const courseCredits = opts.courseCredits || sheet.courseCredits || {};
  let penalty = 0;
  for (const c of Object.keys(courseToSections)) {
    const secs = courseToSections[c];
    if (secs.length <= 1) continue;
    const cr = Number(courseCredits[c] || 3);
    const eligibleCount = [...Array(nGroups).keys()].filter(g => cr <= Number(groupCredits[g] || 3)).length;
    const target = Math.min(secs.length, eligibleCount);
    const distinctGroups = new Set(secs.map(s => secToGroup[s])).size;
    const violation = target - distinctGroups;
    if (violation > 0) penalty += violation * 2000;
  }
  return penalty;
}

function countTeacherConflictViolations(conflicts, secToGroup) {
  let count = 0;
  if (!conflicts) return count;
  for (let s = 0; s < secToGroup.length; s++) {
    for (const other of conflicts[s]) {
      if (other > s && secToGroup[s] === secToGroup[other]) count++;
    }
  }
  return count;
}

function countCoverageViolations(coverageGroups, nGroups, secToGroup) {
  let count = 0;
  if (!coverageGroups || !coverageGroups.length) return count;
  for (const sidSet of coverageGroups) {
    const covered = new Set();
    for (const sid of sidSet) covered.add(secToGroup[sid]);
    count += Math.max(0, nGroups - covered.size);
  }
  return count;
}

// 대분반으로 지정하지 않은 과목은 같은 코드에 복수 분반을 둘 수 없다.
// 분반 수가 수용 가능한 코드 수보다 많다면 해당 과목을 대분반으로 지정해야 한다.
function countBigsecViolations(sheet, secToGroup, opts) {
  const { courseToSections } = sheet.algoState;
  const bigsecCourses = opts.bigsecCourses || new Set();
  let count = 0;
  for (const c of Object.keys(courseToSections)) {
    if (bigsecCourses.has(c)) continue;
    const seen = new Set();
    for (const sid of courseToSections[c]) {
      const g = secToGroup[sid];
      if (seen.has(g)) count++;
      else seen.add(g);
    }
  }
  return count;
}

function countParallelViolations(sheet, secToGroup, opts) {
  let violations=0;
  for(const [course,ids]of Object.entries(sheet.algoState.courseToSections)) {
    if(!opts.bigsecCourses?.has(course))continue;
    const limit=parallelLimitForCourse(course,opts),counts=Array(opts.nGroups).fill(0);
    for(const sid of ids){const g=secToGroup[sid];if(Number.isInteger(g)&&g>=0&&g<counts.length)counts[g]++;}
    for(const n of counts)violations+=Math.max(0,n-limit);
  }
  return violations;
}
function hardConstraintSummary(sheet, secToGroup, opts) {
  let conflicts=opts.conflicts;
  if(conflicts && coupledFamilies(sheet,opts).length)conflicts=conflicts.map((ids,sid)=>new Set([...ids].filter(other=>!opts.creditPairs?.has(pairKey(sheet.algoState.sections[sid].course,sheet.algoState.sections[other].course)))));
  const teacher = countTeacherConflictViolations(conflicts, secToGroup);
  const coverage = countCoverageViolations(opts.coverageGroups, opts.nGroups, secToGroup);
  const bigsec = countBigsecViolations(sheet, secToGroup, opts);
  const parallel=countParallelViolations(sheet,secToGroup,opts);
  const cohort=countCohortPoolViolations(secToGroup,opts);
  return { teacher, coverage, bigsec, parallel, cohort, total: teacher + coverage + bigsec + parallel + cohort };
}

function evaluate(sheet, secToGroup, opts, nTrials, seedBase) {
  // hard constraint는 탐색 과정에서는 매우 큰 우선순위로 유도하고, 최종 후보에서는 위반 0만 허용한다.
  const hard = hardConstraintSummary(sheet, secToGroup, opts);
  const hardPenalty = hard.total * 1000000000;
  // 동일 과목 분반의 불필요한 코드 집중은 soft objective로 유지한다.
  const spreadPenalty = computeGroupSpreadPenalty(sheet, secToGroup, opts);

  let best = null, bestCost = Infinity;
  for (let t = 0; t < nTrials; t++) {
    const rnd = mulberry32(seedBase * 9973 + t * 71 + 7);
    const res = assignStudents(sheet, secToGroup, { ...opts, rnd });
    const assignmentCost = computeAssignmentObjectiveCost(sheet, res, opts);
    const cost = hardPenalty + assignmentCost + spreadPenalty;
    if (!best || compareEvaluations(sheet, { ...res, cost, hardViolations: hard.total }, { ...best, cost: bestCost, hardViolations: hard.total }) < 0) { bestCost = cost; best = res; }
  }
  return { cost: bestCost, hardViolations: hard.total, hardDetails: hard, ...best };
}

function generateNeighbors(secToGroup, sheet, opts, maxN, rnd) {
  const moves = [];
  const { sections, courseToSections } = sheet.algoState;
  const { nGroups } = opts;
  const secToCourse = sections.map(s => s.course);
  const counts=courseGroupCounts(sheet,secToGroup,nGroups);
  const limits=Object.fromEntries(Object.keys(courseToSections).map(c=>[c,parallelLimitForCourse(c,opts)]));
  const groupCredits = opts.groupCredits || sheet.groupCredits || [];
  const courseCredits = opts.courseCredits || sheet.courseCredits || {};
  const fits = (sid, g) => Number(courseCredits[secToCourse[sid]] || 3) <= Number(groupCredits[g] || 3);

  for (let sid = 0; sid < sections.length; sid++) {
    const cur = secToGroup[sid];
    for (let g = 0; g < nGroups; g++) {
      if (g === cur || !fits(sid, g) || counts[secToCourse[sid]][g]>=limits[secToCourse[sid]]) continue;
      moves.push(['move', sid, g]);
    }
  }
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      if (secToGroup[i] === secToGroup[j]) continue;
      if (secToCourse[i] === secToCourse[j]) continue;
      if (!fits(i, secToGroup[j]) || !fits(j, secToGroup[i])) continue;
      if(counts[secToCourse[i]][secToGroup[j]]>=limits[secToCourse[i]] || counts[secToCourse[j]][secToGroup[i]]>=limits[secToCourse[j]])continue;
      moves.push(['swap_diff', i, j]);
    }
  }
  const permitted=(opts.cohortPools || []).length ? moves.filter(move=>countCohortPoolViolations(applyMove(secToGroup,move),opts)===0) : moves;
  shuffleInPlace(permitted, rnd);
  return permitted.slice(0, maxN);
}

function applyMove(secToGroup, move) {
  const sg = secToGroup.slice();
  if (move[0] === 'swap_same' || move[0] === 'swap_diff') {
    const a = move[1], b = move[2];
    [sg[a], sg[b]] = [sg[b], sg[a]];
  } else if (move[0] === 'move') {
    sg[move[1]] = move[2];
  }
  return sg;
}
function moveKey(m) { return m.join('|'); }
function reverseMoveKey(move, beforeState) {
  if (move[0] === 'move') {
    const sid = move[1];
    return ['move', sid, beforeState[sid]].join('|');
  }
  // swap은 동일한 두 분반을 다시 맞바꾸는 동작 자체가 역이동이다.
  return moveKey(move);
}

async function tabuSearch(sheet, opts, logFn) {
  const { maxIter, tabuTenure, nNeighbors, seed, bigsecCourses } = opts;
  const rnd = mulberry32(seed);
  const { sections, courseToSections } = sheet.algoState;
  const nGroups = opts.nGroups;
  const noImproveLimit = Math.max(8, Number(opts.noImproveLimit || 20));
  const diversifyMoves = Math.max(1, Number(opts.diversifyMoves || 2));

  let current = Array.isArray(opts.startSecToGroup)
    ? opts.startSecToGroup.slice()
    : initialGroupAssignment(sections, courseToSections, nGroups, rnd, bigsecCourses, opts.conflicts, opts.groupCredits, opts.courseCredits, opts.parallelLimits, opts.cohortPools);
  const initialEval=evaluate(sheet,current,opts,Math.max(1,Number(opts.initialTrials || 2)),seed);
  const validStart=opts.startResult && opts.startResult.secToGroup?.length===current.length && opts.startResult.secToGroup.every((g,i)=>g===current[i]) && hardConstraintSummary(sheet,current,opts).total===0;
  let curEval=validStart && compareEvaluations(sheet,opts.startResult,initialEval)<=0 ? copyAssignmentResult(opts.startResult) : initialEval;
  let best = current.slice();
  let bestEval = curEval;
  const tabu = new Map();
  const pm0 = curEval.partialMisses.reduce((a,p)=>a+p.missing.length,0);
  logFn(`초기 hard=${curEval.hardViolations} 미배정=${missingCounts(curEval).total} 최대편차=${courseSpreadSummary(sheet,curEval.sectionLoad).maxSpread} 제곱편차합=${courseSpreadSummary(sheet,curEval.sectionLoad).varianceScore.toFixed(1)} (참고비용 ${curEval.cost.toFixed(1)})`, curEval.hardViolations===0 ? 'dim' : 'warn');

  let noImprove = 0;
  let lastUiYield = performance.now();
  for (let it = 0; it < maxIter; it++) {
    const nbrs = generateNeighbors(current, sheet, opts, nNeighbors, rnd);
    let bestMove = null, bestMoveEval = null, bestTest = null, bestMoveCost = Infinity;
    for (const mv of nbrs) {
      const test = applyMove(current, mv);
      const ev = evaluate(sheet, test, opts, 1, seed + it * 17);
      // 긴 계산 중에도 브라우저 이벤트 루프에 주기적으로 제어권을 돌려 UI 멈춤을 줄인다.
      if (performance.now() - lastUiYield >= 60) {
        await new Promise(r => setTimeout(r, 0));
        lastUiYield = performance.now();
      }
      const tabuUntil = tabu.get(moveKey(mv)) || -1;
      const isTabu = tabuUntil > it;
      if (isTabu && compareEvaluations(sheet, ev, bestEval) >= 0) continue;
      if (!bestMoveEval || compareEvaluations(sheet, ev, bestMoveEval) < 0) {
        bestMove = mv; bestMoveCost = ev.cost; bestMoveEval = ev; bestTest = test;
      }
    }
    if (!bestMove) break;
    const reverseKey = reverseMoveKey(bestMove, current);
    current = bestTest; curEval = bestMoveEval;
    tabu.set(reverseKey, it + tabuTenure);
    if (compareEvaluations(sheet, curEval, bestEval) < 0) {
      best = current.slice(); bestEval = curEval; noImprove = 0;
      const pm = curEval.partialMisses.reduce((a,p)=>a+p.missing.length,0);
      logFn(`  [${it.toString().padStart(3)}] 갱신 hard=${bestEval.hardViolations} 미배정=${missingCounts(bestEval).total} 최대편차=${courseSpreadSummary(sheet,bestEval.sectionLoad).maxSpread} 제곱편차합=${courseSpreadSummary(sheet,bestEval.sectionLoad).varianceScore.toFixed(1)} (참고비용 ${bestEval.cost.toFixed(1)})`,
            (bestEval.hardViolations === 0 && bestEval.unassigned.length === 0 && pm === 0) ? 'ok' : 'warn');
    } else {
      noImprove++;
      if (noImprove >= noImproveLimit) {
        // 정체 시 소수의 임의 이동만 수행해 다른 영역을 탐색한다.
        for (let k = 0; k < diversifyMoves; k++) {
          const mvs = generateNeighbors(current, sheet, opts, Math.max(12, nNeighbors), rnd);
          if (mvs.length === 0) break;
          current = applyMove(current, mvs[0]);
        }
        curEval = evaluate(sheet, current, opts, 1, seed + it);
        if(compareEvaluations(sheet,curEval,bestEval)<0){best=current.slice();bestEval=curEval;}
        noImprove = 0;
      }
    }
    if (it % 6 === 0) await new Promise(r => setTimeout(r, 0));
  }

  // 1차 단계에서는 학생 전체 재매칭을 하지 않는다. 구조 후보를 빠르게 비교하기 위한 저비용 평가만 수행한다.
  const quickEval = evaluate(sheet, best, opts, Math.max(1, Number(opts.quickFinalTrials || 2)), seed * 13);
  return { secToGroup: best, ...(compareEvaluations(sheet, quickEval, bestEval) < 0 ? quickEval : bestEval) };
}


function repairIncompleteAssignments(sheet, secToGroup, result, opts) {
  if (!missingCounts(result).total) return 0;
  const members=sheet.algoState.sections.map(()=>new Set());
  for (const stu of sheet.students) for (const sid of result.assignments[stu.rowIndex] || []) if (sid!==-1) members[sid].add(stu.rowIndex);
  const detach=stu=>{for (const sid of result.assignments[stu.rowIndex] || []) if(sid!==-1){result.sectionLoad[sid]--;members[sid].delete(stu.rowIndex);}};
  const attach=(stu,ass)=>{result.assignments[stu.rowIndex]=ass;for(const sid of ass)if(sid!==-1){result.sectionLoad[sid]++;members[sid].add(stu.rowIndex);}};
  function match(stu) {
    const choices=stu.selected.map(c=>{
      const best=new Map();
      for(const sid of sheet.algoState.courseToSections[c]) {
        if(result.sectionLoad[sid]>=opts.maxPerSection)continue;
        if([...(opts.avoidMap || {})[stu.rowIndex] || []].some(row=>members[sid].has(row)))continue;
        const g=secToGroup[sid], prior=best.get(g);
        if(prior===undefined || result.sectionLoad[sid]<result.sectionLoad[prior])best.set(g,sid);
      }
      return [...best.entries()];
    });
    return findBestPartialMatching(choices,stu.selected,opts.nGroups,opts.groupCredits,opts.courseCredits,opts.creditPairs,result.sectionLoad);
  }
  let repairs=0,budget=200;
  const targets=sheet.students.filter(stu=>(result.assignments[stu.rowIndex] || []).filter(s=>s!==-1).length<stu.selected.length);
  for(const stu of targets) {
    const others=[null,...sheet.students.filter(other=>other.rowIndex!==stu.rowIndex && other.selected.some(c=>stu.selected.includes(c)))];
    for(const other of others) {
      if(--budget<0)break;
      const old=(result.assignments[stu.rowIndex] || stu.selected.map(()=>-1)).slice();
      const oldOther=other ? (result.assignments[other.rowIndex] || other.selected.map(()=>-1)).slice() : null;
      detach(stu);if(other)detach(other);
      const a=match(stu);
      if(a.count===stu.selected.length) {
        attach(stu,a.matched);
        const b=other ? match(other) : null;
        if(!other || (b.count>=oldOther.filter(s=>s!==-1).length && oldOther.every((sid,i)=>sid===-1 || b.matched[i]!==-1))) {
          if(other)attach(other,b.matched);
          repairs++;break;
        }
        detach(stu);
      }
      attach(stu,old);if(other)attach(other,oldOther);
    }
    if(budget<0)break;
  }
  rebuildAssignmentSummary(sheet,result);
  return repairs;
}

function finalizeCandidate(sheet, secToGroup, opts, seed, incumbent) {
  // 상위 구조 후보에 대해서만 정밀 학생 배정과 2차 균등화를 수행한다.
  const reevaluated = evaluate(sheet, secToGroup, opts, Math.max(2, Number(opts.refineTrials || 10)), seed * 13 + 991);
  const finalEval = copyAssignmentResult(incumbent && compareEvaluations(sheet, incumbent, reevaluated) <= 0 ? incumbent : reevaluated);
  finalEval.repaired = repairIncompleteAssignments(sheet, secToGroup, finalEval, opts);
  const rebalanceStats = rebalanceStudentAssignments(sheet, secToGroup, finalEval, opts);
  finalEval.rebalanceStats = rebalanceStats;
  const hard = hardConstraintSummary(sheet, secToGroup, opts);
  const hardPenalty = hard.total * 1000000000;
  const spreadPenalty = computeGroupSpreadPenalty(sheet, secToGroup, opts);
  finalEval.cost = hardPenalty + computeAssignmentObjectiveCost(sheet, finalEval, opts) + spreadPenalty;
  finalEval.hardViolations = hard.total;
  finalEval.hardDetails = hard;
  return { secToGroup: secToGroup.slice(), ...finalEval };
}

// A configured 2+1 pair is one indivisible three-credit cohort during search.
// Expansion restores the two real course records without splitting membership.
function coupledFamilies(sheet, opts = {}) {
  const byOne = new Map(), owner = new Map();
  const configured = opts.creditPairs ?? new Set((sheet.creditPairList || []).map(p => pairKey(p.course2,p.course1)));
  const names = Object.keys(sheet.courses);
  for (const two of names.filter(c => Number(sheet.courseCredits[c]) === 2)) {
    for (const one of names.filter(c => Number(sheet.courseCredits[c]) === 1)) {
      if (!configured.has(pairKey(two,one))) continue;
      if (owner.has(two) && owner.get(two) !== one) throw new Error(`'${two}'는 하나의 1학점 과목과만 결합할 수 있습니다.`);
      owner.set(two,one);
      if (!byOne.has(one)) byOne.set(one,{one,twos:[]});
      byOne.get(one).twos.push(two);
    }
  }
  return [...byOne.values()];
}

function ensureCoupledConfiguration(sheet, opts) {
  const families = coupledFamilies(sheet,opts);
  for (const family of families) {
    const sourceCount = family.twos.reduce((n,c) => n + sheet.courses[c],0);
    if (sourceCount !== sheet.courses[family.one]) throw new Error(`2+1 동일 학생 구성: '${family.one}'은 연결된 2학점 과목의 합계와 같은 ${sourceCount}분반이어야 합니다. 현재 ${sheet.courses[family.one]}분반입니다.`);
    const eligible = sheet.groupCredits.slice(0,opts.nGroups).filter(cr => Number(cr)>=3).length;
    const cap = parallelLimitForCourse(family.one,opts);
    if (sourceCount > eligible*cap) throw new Error(`2+1 결합 '${family.one}': 3학점 시간블록 ${eligible}개와 동시 분반 상한 ${cap}개로 ${sourceCount}분반을 배치할 수 없습니다.`);
    for (const stu of sheet.students) {
      const selected = family.twos.filter(c => stu.selected.includes(c));
      if (selected.length !== Number(stu.selected.includes(family.one))) throw new Error(`2+1 결합 선택 오류: ${studentDisplay(stu)}는 '${family.one}'과 연결된 2학점 과목을 정확히 하나씩 함께 선택해야 합니다.`);
    }
  }
  return families;
}

function auditCoupledCohorts(sheet, result, opts = {}) {
  const errors = [], links = [];
  const families = coupledFamilies(sheet,opts);
  if (!families.length) return {ok:true,errors,links};
  const {sections,courseToSections} = sheet.algoState;
  const members = sections.map(() => new Set());
  const targets = new Map(), sources = new Map();
  for (const stu of sheet.students) {
    const ass = result.assignments[stu.rowIndex] || stu.selected.map(() => -1);
    for (const sid of ass) if (Number.isInteger(sid) && sid>=0 && sid<sections.length) members[sid].add(stu.rowIndex);
    for (const f of families) {
      const selected = f.twos.filter(c => stu.selected.includes(c));
      const oneIdx = stu.selected.indexOf(f.one);
      if (selected.length !== Number(oneIdx>=0)) {errors.push(`2+1 결합 선택 불일치: ${studentDisplay(stu)}`);continue;}
      if (!selected.length) continue;
      const parent = ass[stu.selected.indexOf(selected[0])] ?? -1, child = ass[oneIdx] ?? -1;
      if (parent===-1 && child===-1) continue;
      if (parent===-1 || child===-1) {errors.push(`2+1 결합 일부 배정: ${studentDisplay(stu)}`);continue;}
      if (!members[parent] || !members[child]) {errors.push('2+1 결합 분반 번호 오류');continue;}
      if (!targets.has(parent)) targets.set(parent,new Set());
      if (!sources.has(child)) sources.set(child,new Set());
      targets.get(parent).add(child);sources.get(child).add(parent);
      if (result.secToGroup[parent]!==result.secToGroup[child]) errors.push(`2+1 결합 시간블록 불일치: ${studentDisplay(stu)}`);
    }
  }
  for (const f of families) {
    const parentIds = f.twos.flatMap(c => courseToSections[c]);
    if (parentIds.length !== courseToSections[f.one].length) errors.push(`2+1 결합 '${f.one}': 일대일 분반 수 불일치`);
    for (const parent of parentIds) {
      const childIds = [...(targets.get(parent) || [])];
      if (childIds.length>1) errors.push(`2+1 학생 구성 분리: '${sections[parent].course}' ${sections[parent].idx}분반이 여러 '${f.one}' 분반으로 나뉩니다.`);
      if (childIds.length!==1) continue;
      const child = childIds[0];
      if ((sources.get(child)?.size || 0)!==1) errors.push(`2+1 학생 구성 혼합: '${f.one}' ${sections[child].idx}분반에 여러 2학점 분반이 섞입니다.`);
      if (members[parent].size!==members[child].size || [...members[parent]].some(row => !members[child].has(row))) errors.push(`2+1 학생 명단 불일치: '${sections[parent].course}' ${sections[parent].idx}분반`);
      links.push({course2:sections[parent].course,course1:f.one,parentSid:parent,childSid:child,count:members[parent].size});
    }
    // Empty pairs still get a unique binding, so displayed codes stay meaningful.
    const used = new Set(links.filter(l => l.course1===f.one).map(l => l.childSid));
    for (const parent of parentIds.filter(sid => !members[sid].size)) {
      const child = courseToSections[f.one].find(sid => !used.has(sid) && !members[sid].size && result.secToGroup[sid]===result.secToGroup[parent]);
      if (child===undefined) errors.push(`2+1 빈 분반 연결 불일치: '${sections[parent].course}' ${sections[parent].idx}분반`);
      else {used.add(child);links.push({course2:sections[parent].course,course1:f.one,parentSid:parent,childSid:child,count:0});}
    }
    if (used.size!==courseToSections[f.one].length) errors.push(`2+1 결합 '${f.one}': 연결되지 않은 분반이 있습니다.`);
  }
  return {ok:errors.length===0,errors:[...new Set(errors)],links};
}

function compileCoupledProblem(sheet, opts) {
  const families = ensureCoupledConfiguration(sheet,opts);
  if (!families.length) return null;
  const ones = new Set(families.map(f => f.one));
  const twos = new Set(families.flatMap(f => f.twos));
  const inner = {...sheet,courses:{...sheet.courses},courseCredits:{...sheet.courseCredits},creditPairList:[]};
  for (const one of ones) {delete inner.courses[one];delete inner.courseCredits[one];}
  for (const two of twos) inner.courseCredits[two]=3;
  inner.students=sheet.students.map(stu => ({...stu,selected:stu.selected.filter(c => !ones.has(c))}));
  inner.nPerStudent=Math.max(0,...inner.students.map(s=>s.selected.length));
  inner.perCounts=[...new Set(inner.students.map(s=>s.selected.length))];
  inner.algoState=buildSections(inner);
  const realToInner=Array(sheet.algoState.sections.length).fill(-1);
  const innerToReal=inner.algoState.sections.map(s => [sheet.algoState.courseToSections[s.course][s.idx-1]]);
  for (let sid=0;sid<innerToReal.length;sid++) realToInner[innerToReal[sid][0]]=sid;
  const pools=[];
  for (const family of families) {
    const parents=family.twos.flatMap(c=>inner.algoState.courseToSections[c]);
    const children=sheet.algoState.courseToSections[family.one];
    parents.forEach((sid,i) => {innerToReal[sid].push(children[i]);realToInner[children[i]]=sid;});
    pools.push({name:family.one,ids:parents,limit:parallelLimitForCourse(family.one,opts)});
  }
  inner.cohortProjection={sheet,innerToReal,realToInner};
  const innerOpts={...opts,courseCredits:inner.courseCredits,creditPairs:new Set(),bigsecCourses:new Set([...opts.bigsecCourses || []].filter(c=>!ones.has(c))),cohortPools:pools};
  innerOpts.coverageGroups=opts.coverageGroups?.map(ids => [...new Set(ids.map(sid=>realToInner[sid]))]);
  if (opts.conflicts) {
    innerOpts.conflicts=inner.algoState.sections.map(()=>new Set());
    for (let sid=0;sid<opts.conflicts.length;sid++) for (const other of opts.conflicts[sid]) {
      if ((opts.creditPairs || new Set()).has(pairKey(sheet.algoState.sections[sid].course,sheet.algoState.sections[other].course))) continue;
      if (realToInner[sid]!==realToInner[other]) innerOpts.conflicts[realToInner[sid]].add(realToInner[other]);
    }
  }
  // Legacy split cohorts never become trusted incumbents of the atomic problem.
  delete innerOpts.startResult;delete innerOpts.startSecToGroup;
  return {sheet:inner,opts:innerOpts};
}

function expandCohortLoads(sheet, loads) {
  const {sheet:real,innerToReal}=sheet.cohortProjection;
  const expanded=Array(real.algoState.sections.length).fill(0);
  innerToReal.forEach((ids,sid)=>ids.forEach(realSid=>{expanded[realSid]=loads[sid] || 0;}));
  return expanded;
}

function expandCohortResult(inner, result) {
  const {sheet:real,innerToReal,realToInner}=inner.cohortProjection;
  const out={...result,secToGroup:Array(real.algoState.sections.length).fill(-1),assignments:{},sectionLoad:expandCohortLoads(inner,result.sectionLoad),unassigned:[],partialMisses:[]};
  innerToReal.forEach((ids,sid)=>ids.forEach(realSid=>{out.secToGroup[realSid]=result.secToGroup[sid];}));
  const innerStudents=new Map(inner.students.map(stu=>[stu.rowIndex,stu]));
  for (const stu of real.students) {
    const converted=innerStudents.get(stu.rowIndex), ass=result.assignments[stu.rowIndex] || converted.selected.map(()=>-1);
    const original=stu.selected.map(c=>{
      const representative=realToInner[real.algoState.courseToSections[c][0]];
      // For the shared one-credit course the student's selected two-credit course owns its cohort.
      const source=Number(real.courseCredits[c])===1 && !converted.selected.includes(c)
        ? converted.selected.find(other=>innerToReal[inner.algoState.courseToSections[other][0]].some(sid=>real.algoState.sections[sid].course===c)) : c;
      const sid=ass[converted.selected.indexOf(source)];
      if (!Number.isInteger(sid) || sid<0) return -1;
      return innerToReal[sid].find(realSid=>real.algoState.sections[realSid].course===c) ?? -1;
    });
    out.assignments[stu.rowIndex]=original;
  }
  delete out.validation;delete out.cohortMissingTotal;
  rebuildAssignmentSummary(real,out);
  return out;
}

function countCohortPoolViolations(secToGroup, opts) {
  let count=0;
  for (const pool of opts.cohortPools || []) {
    const counts=Array(opts.nGroups).fill(0);
    for (const sid of pool.ids) if(secToGroup[sid]>=0) counts[secToGroup[sid]]++;
    count+=counts.reduce((n,x)=>n+Math.max(0,x-pool.limit),0);
  }
  return count;
}

async function runSheet(sheet, opts, logFn) {
  ensureParallelCapacity(sheet,opts);
  const compiled=compileCoupledProblem(sheet,opts);
  if (!compiled) return runSheetCore(sheet,opts,logFn);
  logFn('  2+1 동일 학생 구성 (강제): 결합 과목을 하나의 3학점 단위로 배정·이동·균등화합니다.','dim');
  const result=await runSheetCore(compiled.sheet,compiled.opts,logFn);
  result.topCandidates=result.topCandidates.map(candidate=>{
    const expanded=expandCohortResult(compiled.sheet,candidate.result);
    expanded.validation=validateResult(sheet,expanded,opts);
    if (!expanded.validation.ok) throw new Error('2+1 결합 최종 검증 실패: '+expanded.validation.errors.slice(0,5).join('; '));
    expanded.hardDetails=hardConstraintSummary(sheet,expanded.secToGroup,opts);
    expanded.hardViolations=expanded.hardDetails.total;
    return {...candidate,result:expanded};
  });
  return result;
}

async function runSheetCore(sheet, opts, logFn) {
  ensureParallelCapacity(sheet,opts);
  const { baseSeed, nCandidates = 1 } = opts;
  const profile = opts.searchProfile || {};
  const totalAttempts = Math.max(Number(profile.maxAttempts || 7), nCandidates * 2);
  const shortlistCount = Math.max(Number(profile.shortlist || 3), nCandidates);
  const patience = Math.max(1, Number(profile.patience || 3));
  const seedSequence = [baseSeed];
  for (let k = 1; k < totalAttempts; k++) {
    seedSequence.push((baseSeed + k * 2147 + k * k * 31) % 100000);
  }

  function score(r) { return missingCounts(r).total; }
  function structureSignature(result) {
    return Object.keys(sheet.algoState.courseToSections).map(c => sheet.algoState.courseToSections[c].map(sid=>result.secToGroup[sid]).sort((a,b)=>a-b).join(',')).join('|');
  }
  function finalSignature(result) { return structureSignature(result); }
  function balanceOf(r) { return courseSpreadSummary(sheet,r.sectionLoad); }
  function compareResults(a,b) { return compareEvaluations(sheet,a,b); }

  // ── 1단계: 여러 시드를 넓고 빠르게 탐색 ──
  const coarse = [];
  const seenStructures = new Set();
  let attempt = 0;
  let bestCoarse = null;
  let stagnant = 0;

  logFn(`  1차 넓은 탐색: 최대 ${totalAttempts}개 시드 · 반복 ${opts.maxIter}회 · 이웃 ${opts.nNeighbors}개`, 'dim');
  for (const seed of seedSequence) {
    attempt++;
    if (attempt > 1) {
      logFn(`▶ 1차 시도 ${attempt}/${seedSequence.length} (시드 ${seed})`, 'dim');
      await new Promise(r => setTimeout(r, 12));
    }
    const res = await tabuSearch(sheet, { ...opts, seed }, logFn);
    const sig = structureSignature(res);
    if (seenStructures.has(sig)) {
      const prior=coarse.find(c=>structureSignature(c.result)===sig);
      if(prior && compareResults(res,prior.result)<0) {prior.result=res;prior.seed=seed;coarse.sort((a,b)=>compareResults(a.result,b.result));bestCoarse=coarse[0].result;stagnant=0;} else stagnant++;
      logFn(`  ↺ 시드 ${seed}: 동일 구조의 더 좋은 배정만 보존`, 'dim');
      continue;
    }
    seenStructures.add(sig);
    if (res.hardViolations > 0) {
      const h = res.hardDetails || {};
      logFn(`  ✗ 시드 ${seed}: hard constraint 위반 ${res.hardViolations}건 (교사 ${h.teacher||0}, 커버리지 ${h.coverage||0}, 대분반 ${h.bigsec||0}, 동시 분반 상한 ${h.parallel||0}) — 1차 후보 제외`, 'bad');
      stagnant++;
      continue;
    }
    coarse.push({ result: res, seed, attempt, source: 'coarse' });
    coarse.sort((a,b)=>compareResults(a.result,b.result));

    const prevBest = bestCoarse;
    bestCoarse = coarse[0].result;
    if (!prevBest || compareResults(bestCoarse, prevBest) < 0) stagnant = 0;
    else stagnant++;

    const pm = res.partialMisses.reduce((a,p)=>a+p.missing.length,0);
    const bs = courseSpreadSummary(sheet, res.sectionLoad);
    logFn(`  · 시드 ${seed}: 전체 ${res.unassigned.length}, 부분 ${pm}, 최대편차 ${bs.maxSpread}, 제곱편차합 ${bs.varianceScore.toFixed(1)}, 편차합 ${bs.totalSpread}, 편차≥3 ${bs.highSpreadCount}`, score(res)===0 ? 'ok' : 'warn');

    const complete = coarse.filter(c => score(c.result) === 0).length;
    // 정밀 모드는 저비용 잠재 후보까지 확보하기 위해 최소 deepMinAttempts 만큼은 확인한다.
    const minAttempts = Math.max(shortlistCount, Number(profile.deepMinAttempts || shortlistCount));
    if (attempt >= minAttempts && complete >= shortlistCount && stagnant >= patience) {
      logFn(`  ✓ 상위 후보 ${shortlistCount}개 이상 확보 + ${stagnant}회 연속 개선 없음 — ${attempt<seedSequence.length?'1차 조기 종료':'1차 탐색 한도 도달'}`, 'ok');
      break;
    }
  }

  if (coarse.length === 0) {
    return { topCandidates: [], totalAttempts: attempt, distinctFound: 0, coarseFound: 0, deepenedCount: 0, refinedCount: 0 };
  }

  // ── 2단계: 유망 구조만 집중 Tabu Search ──
  // 균형 상위 후보만 고르면 v11에서 좋았던 '저비용 잠재 후보'를 놓칠 수 있어,
  // 균형 상위 N개 + 완전배정 후보 중 비용 최저 1개를 합쳐 최대 deepCandidates개를 선택한다.
  const completeCoarse = coarse.filter(c => score(c.result) === 0);
  const deepPool = completeCoarse.length ? completeCoarse : coarse.slice();
  const deepSelected = [];
  const deepSeen = new Set();
  const addDeep = (item, reason) => {
    if (!item) return;
    const sig = structureSignature(item.result);
    if (deepSeen.has(sig)) return;
    deepSeen.add(sig);
    deepSelected.push({ ...item, reason });
  };

  const byBalance = deepPool.slice().sort((a,b)=>compareResults(a.result,b.result));
  const balanceCount = Math.max(1, Number(profile.deepBalanceCount || 2));
  for (const item of byBalance.slice(0, balanceCount)) addDeep(item, '균형 상위');
  const byCost = deepPool.slice().sort((a,b)=>compareResults(a.result,b.result));
  addDeep(byCost[0], '우선순위 상위');
  for (const item of byBalance) {
    if (deepSelected.length >= Math.max(1, Number(profile.deepCandidates || 3))) break;
    addDeep(item, '보완');
  }

  const deepLimit = Math.max(1, Number(profile.deepCandidates || 3));
  deepSelected.splice(deepLimit);
  const deepened = [];
  if (deepSelected.length > 0 && Number(profile.deepIter || 0) > 0) {
    logFn(`  2차 집중 탐색: ${deepSelected.length}개 후보 · 추가 반복 ${profile.deepIter}회 · 이웃 ${profile.deepNeighbors}개`, 'head');
  }
  for (let i = 0; i < deepSelected.length; i++) {
    const item = deepSelected[i];
    const beforeBal = balanceOf(item.result);
    logFn(`  ↳ 집중 ${i+1}/${deepSelected.length}: 시드 ${item.seed} (${item.reason}) · 시작 최대편차 ${beforeBal.maxSpread}, 제곱편차합 ${beforeBal.varianceScore.toFixed(1)}, 비용 ${item.result.cost.toFixed(1)}`, 'dim');
    const deepSeed = (item.seed + 50021 + i * 7919) % 100000;
    const res = await tabuSearch(sheet, {
      ...opts,
      seed: deepSeed,
      startSecToGroup: item.result.secToGroup,
      startResult: item.result,
      maxIter: Math.max(1, Number(profile.deepIter || 45)),
      nNeighbors: Math.max(4, Number(profile.deepNeighbors || 18)),
      noImproveLimit: Math.max(8, Number(profile.deepNoImproveLimit || 18)),
      diversifyMoves: Math.max(1, Number(profile.deepDiversifyMoves || 2)),
      quickFinalTrials: Math.max(1, Number(profile.deepQuickTrials || 2)),
      initialTrials: 1,
    }, logFn);
    if (res.hardViolations === 0) {
      const afterBal = courseSpreadSummary(sheet, res.sectionLoad);
      logFn(`     집중 결과: 최대편차 ${beforeBal.maxSpread}→${afterBal.maxSpread}, 제곱편차합 ${beforeBal.varianceScore.toFixed(1)}→${afterBal.varianceScore.toFixed(1)}, 편차합 ${beforeBal.totalSpread}→${afterBal.totalSpread}`, compareResults(res, item.result) < 0 ? 'ok' : 'dim');
      const preserved=compareResults(res,item.result)<0 ? res : item.result;
      deepened.push({ result: preserved, seed: item.seed, attempt: item.attempt, source: 'deep' });
    }
    await new Promise(r => setTimeout(r, 0));
  }

  // 1차와 집중탐색 결과를 함께 놓고 최종 정밀평가 후보를 다시 선정한다.
  const structurePool = [];
  const poolSeen = new Set();
  for (const item of [...coarse, ...deepened].sort((a,b)=>compareResults(a.result,b.result))) {
    const sig = structureSignature(item.result);
    if (poolSeen.has(sig) || item.result.hardViolations > 0) continue;
    poolSeen.add(sig);
    structurePool.push(item);
  }
  structurePool.sort((a,b)=>compareResults(a.result,b.result));
  const shortlist = structurePool.slice(0, Math.min(shortlistCount, structurePool.length));
  logFn(`  3차 정밀 평가: 구조 후보 ${structurePool.length}개 중 상위 ${shortlist.length}개만 학생 재배정·균등화`, 'head');

  // ── 3단계: 상위 구조만 정밀 학생 배정 및 균등화 ──
  const candidates = [];
  const seenFinal = new Set();
  let refinedCount = 0;
  for (let i = 0; i < shortlist.length; i++) {
    const item = shortlist[i];

    await new Promise(r => setTimeout(r, 0));
    const res = finalizeCandidate(sheet, item.result.secToGroup, opts, item.seed, item.result);
    refinedCount++;
    if (res.hardViolations > 0) continue;
    const audit = validateResult(sheet, res, opts);
    if (!audit.ok) throw new Error('최종 후보 검증 실패: ' + audit.errors.slice(0,5).join('; '));
    res.validation = audit;
    const sig = finalSignature(res);
    if (seenFinal.has(sig)) continue;
    seenFinal.add(sig);
    const rb = res.rebalanceStats;
    if (rb && !rb.skipped) {
      logFn(`  ↳ 정밀 ${i+1}/${shortlist.length}: 직접이동 ${rb.directMoves||0} + 재매칭 ${rb.rematchMoves||0}, 최대편차 ${rb.before.maxSpread}→${rb.after.maxSpread}, 제곱편차합 ${rb.before.varianceScore.toFixed(1)}→${rb.after.varianceScore.toFixed(1)}, 편차합 ${rb.before.totalSpread}→${rb.after.totalSpread}`, 'dim');
    }
    candidates.push({ result: res, seed: item.seed, attempt: item.attempt });
  }

  candidates.sort((a,b)=>compareResults(a.result,b.result));
  const topN = candidates.slice(0, nCandidates);
  return {
    topCandidates: topN,
    totalAttempts: attempt,
    distinctFound: candidates.length,
    coarseFound: coarse.length,
    deepenedCount: deepened.length,
    refinedCount,
  };
}

// ============================================================

export { escapeHtml, courseGroupCounts, ensureParallelCapacity, validateResult, studentDisplay, parseWorkbook, buildSections, computeConflictSections, pairKey, courseSpreadSummary, ensureCoupledConfiguration, auditCoupledCohorts, runSheet };
