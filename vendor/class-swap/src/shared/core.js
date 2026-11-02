/* Shared pure rules. This file is used on the server and embedded into the browser by build.py. */
export function SwapCoreFactory_() {
  'use strict';
  const DAYS = ['월', '화', '수', '목', '금'];
  const text = v => String(v == null ? '' : v).normalize('NFC').trim();
  const compact = v => text(v).replace(/\s+/g, '');
  const fail = message => { throw new Error(message); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = (teacher, day, period) => teacher + '|' + day + '|' + period;
  const actualKey = (teacher, date, period) => teacher + '|' + date + '|' + period;
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) fail('날짜를 확인해 주세요.');
    const d = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail('올바르지 않은 날짜입니다.');
    return d;
  }
  function dayOf(value) { return (date(value).getUTCDay() + 6) % 7; }
  function addDays(value, count) { const d = date(value); d.setUTCDate(d.getUTCDate() + Number(count)); return d.toISOString().slice(0, 10); }
  function monday(value) { return addDays(value, -dayOf(value)); }
  function hasSlot(ds, day, period) { return ds.slots.some(s => s.day === day && s.period === Number(period)); }
  function teacher(ds, id) { return ds.teachers.find(t => t.id === id); }
  function lessonMap(ds) { const map = Object.create(null); ds.lessons.forEach(l => { map[key(l.teacherId, l.day, l.period)] = l; }); return map; }
  function baseLesson(ds, id, value, period, map) {
    const d = dayOf(value);
    if (!teacher(ds, id) || !hasSlot(ds, d, period)) return null;
    return (map || lessonMap(ds))[key(id, d, Number(period))] || {teacherId:id, day:d, period:Number(period), subject:'', room:''};
  }
  function kind(ds, l) {
    if (!l) return 'unavailable';
    const s = compact(l.subject), room = text(l.room);
    if (!s) return room ? 'duty' : 'free';
    if (s === '공강' && !room) return 'free';
    if (s.startsWith('공강')) return 'duty';
    if (s.includes('창체') || s.includes('창의적체험')) return 'activity';
    if ((ds.meta.blockedSubjects || []).some(x => compact(x) === s)) return 'blocked';
    const gradeMatch = room.match(/^([1-3])-/), grade = gradeMatch ? Number(gradeMatch[1]) : null;
    const es = ds.electives.filter(e => !grade || e.grade === grade);
    for (const e of es) {
      for (const name of [e.abbr, e.subject]) {
        const prefix = compact(name);
        if (!prefix || !s.startsWith(prefix)) continue;
        const suffix = s.slice(prefix.length);
        if (!suffix || /^[A-Za-z](?:[_-]?\d+)?$/.test(suffix)) return 'elective';
      }
    }
    // Inconsistent abbreviations, e.g. 중문I vs 중문화, are protected pending review.
    const stem = s.replace(/[A-Za-z](?:[_-]?\d+)?$/, '');
    if (stem !== s && stem.length >= 2 && es.some(e => compact(e.abbr).startsWith(stem))) return 'review';
    if (l.blockId) return 'block';
    return 'regular';
  }
  function validateDataset(raw) {
    if (!raw || Number(raw.schema) !== 1) fail('지원하는 자료 형식이 아닙니다.');
    if (!Array.isArray(raw.slots) || !raw.slots.length || raw.slots.length > 60) fail('요일·교시 정보가 필요합니다.');
    if (!Array.isArray(raw.teachers) || !raw.teachers.length || raw.teachers.length > 500) fail('교사 자료를 확인해 주세요.');
    if (!Array.isArray(raw.lessons) || raw.lessons.length > 30000) fail('수업 자료를 확인해 주세요.');
    if (!Array.isArray(raw.electives) || raw.electives.length > 2000) fail('선택과목 자료를 확인해 주세요.');
    const meta = raw.meta || {};
    const ds = {schema:1, meta:{school:text(meta.school).slice(0, 80), label:text(meta.label).slice(0, 100),
      sourceYear:text(meta.sourceYear).slice(0, 30), sourceFiles:(meta.sourceFiles || []).slice(0, 5).map(x => text(x).slice(0, 160)),
      warnings:(meta.warnings || []).slice(0, 80).map(x => text(x).slice(0, 250)),
      blockedSubjects:(meta.blockedSubjects || []).slice(0, 200).map(x => text(x).slice(0, 80))},
      slots:[], teachers:[], lessons:[], electives:[]};
    const slots = new Set(), ids = new Set(), names = new Set(), lessons = new Set(), electives = new Set();
    raw.slots.forEach(s => {
      const day = Number(s.day), period = Number(s.period), k = day + ':' + period;
      if (!Number.isInteger(day) || day < 0 || day > 4 || !Number.isInteger(period) || period < 1 || period > 12 || slots.has(k)) fail('요일·교시가 중복되거나 올바르지 않습니다.');
      slots.add(k); ds.slots.push({day, period});
    });
    raw.teachers.forEach(t => {
      const id = text(t.id), name = text(t.name);
      if (!/^[A-Za-z0-9_-]{1,50}$/.test(id) || !name || name.length > 40 || ids.has(id) || names.has(name)) fail('교사 ID 또는 이름의 중복을 확인해 주세요.');
      ids.add(id); names.add(name); ds.teachers.push({id, name});
    });
    raw.lessons.forEach(l => {
      const v = {teacherId:text(l.teacherId), day:Number(l.day), period:Number(l.period), subject:text(l.subject).slice(0, 100), room:text(l.room).slice(0, 80)};
      const k = key(v.teacherId, v.day, v.period);
      if (!ids.has(v.teacherId) || !slots.has(v.day + ':' + v.period) || lessons.has(k)) fail('수업의 교사·요일·교시 또는 중복을 확인해 주세요.');
      if (!v.subject && !v.room) return;
      if (!v.subject && v.room) fail('과목 없이 교실만 있는 수업이 있습니다.');
      if (v.subject === '공강' && !v.room) return;
      if (l.blockId) v.blockId = text(l.blockId).slice(0, 100);
      lessons.add(k); ds.lessons.push(v);
    });
    raw.electives.forEach(e => {
      const v = {grade:Number(e.grade), subject:text(e.subject).slice(0, 100), abbr:text(e.abbr).slice(0, 50)};
      if (![1, 2, 3].includes(v.grade) || !v.subject || !v.abbr) fail('선택과목의 학년·과목명·축약명을 확인해 주세요.');
      // 공강 is an activity marker, not an elective subject.
      if (compact(v.subject) === '공강' || compact(v.abbr) === '공강') return;
      const k = v.grade + '|' + v.subject + '|' + v.abbr;
      if (!electives.has(k)) { electives.add(k); ds.electives.push(v); }
    });
    ds.slots.sort((a,b) => a.day - b.day || a.period - b.period);
    return ds;
  }
  function normalizeTimetable(rows, electiveRows, options) {
    options = options || {};
    const hi = rows.findIndex(r => r && r.some(v => text(v) === '교사') && r.some(v => text(v) === '월') && r.some(v => text(v) === '화'));
    if (hi < 0 || !rows[hi+1]) fail('전체 교사 시간표의 요일·교시 머리글을 찾지 못했습니다.');
    const head = rows[hi], per = rows[hi+1], teacherCol = head.findIndex(v => text(v) === '교사');
    const columns = []; let day = -1;
    for (let c = teacherCol + 1; c < Math.max(head.length, per.length); c++) {
      const v = text(head[c]);
      if (DAYS.includes(v)) day = DAYS.indexOf(v);
      else if (v) day = -1;
      const p = Number(per[c]);
      if (day >= 0 && Number.isInteger(p) && p >= 1 && p <= 12) columns.push({col:c, day, period:p});
    }
    if (!columns.length) fail('시간표의 교시를 읽지 못했습니다.');
    const warnings = [], teachers = [], lessons = [];
    const identities = Object.create(null);
    for (let r = hi + 2; r < rows.length; r++) {
      const row = rows[r] || [], name = text(row[teacherCol]);
      if (!/^\d+$/.test(text(row[0])) || !name || name === '교사') continue;
      if (identities[name]) fail('교사명이 중복되어 있습니다: ' + name);
      // Stable across reordering: names are the source identity, not Excel row numbers.
      let hash = 2166136261;
      for (let i=0; i<name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
      let id = 't' + hash.toString(16);
      if (teachers.some(t => t.id === id)) fail('교사 식별자가 중복되었습니다. 관리자 확인이 필요합니다.');
      identities[name] = id; teachers.push({id, name});
      const roomRow = rows[r+1] || []; let previous = null;
      for (const col of columns) {
        let subject = text(row[col.col]), room = text(roomRow[col.col]);
        if (/^(?:[─━-]*[▷▶>→]|→)$/.test(subject)) {
          if (!previous || previous.day !== col.day || previous.period !== col.period - 1) fail(name + '의 연속수업 연결 표시를 확인해 주세요.');
          const block = previous.blockId || id + ':' + col.day + ':' + previous.period;
          previous.blockId = block;
          const l = {teacherId:id, day:col.day, period:col.period, subject:previous.subject, room:room || previous.room, blockId:block};
          lessons.push(l); previous = l; continue;
        }
        if (!subject && room) warnings.push(name + ' ' + DAYS[col.day] + col.period + '교시: 과목 없이 교실만 있어 가져오기를 중단해야 합니다.');
        if (!subject && room) fail(warnings[warnings.length-1]);
        if (!subject || (subject === '공강' && !room)) { previous = null; continue; }
        const l = {teacherId:id, day:col.day, period:col.period, subject, room};
        lessons.push(l); previous = l;
      }
    }
    const electives = [];
    if (electiveRows && electiveRows.length) {
      const eh = electiveRows.findIndex(r => r && r.some(v => text(v) === '학년') && r.some(v => /축약/.test(text(v))));
      if (eh < 0) fail('선택과목 파일은 학년·교과명·축약과목명 머리글이 필요합니다.');
      const er = electiveRows[eh], gi = er.findIndex(v => text(v) === '학년'), si = er.findIndex(v => ['교과명','과목명'].includes(text(v))), ai = er.findIndex(v => /축약/.test(text(v)));
      if (si < 0) fail('선택과목 파일의 교과명을 찾지 못했습니다.');
      for (let r = eh+1; r < electiveRows.length; r++) {
        const row = electiveRows[r] || [];
        if (!row.some(v => text(v))) continue;
        electives.push({grade:Number(row[gi]), subject:text(row[si]), abbr:text(row[ai])});
      }
    } else warnings.push('선택과목 정보가 없습니다. 선택과목 교체 제한을 확인해야 합니다.');
    const yearCell = rows.slice(0, hi).flat().map(text).find(v => /\d{4}\s*학년도/.test(v)) || '';
    const sourceYear = (yearCell.match(/\d{4}/) || [''])[0];
    const sourceFiles = options.sourceFiles || [];
    const filenameYear = ((sourceFiles[0] || '').match(/\d{4}/) || [''])[0];
    if (sourceYear && filenameYear && sourceYear !== filenameYear) warnings.push('시간표 내부 학년도(' + sourceYear + ')와 파일명 학년도(' + filenameYear + ')가 다릅니다.');
    const school = rows.slice(0, hi).flat().map(text).find(v => /(?:고등|중|초등)학교$/.test(v)) || '';
    return validateDataset({schema:1, meta:{school, label:options.label || (filenameYear ? filenameYear + '학년도 시간표' : '전체 교사 시간표'), sourceYear, sourceFiles, warnings}, slots:columns.map(c => ({day:c.day, period:c.period})), teachers, lessons, electives});
  }
  function reservations(plans, exceptId, draft) {
    const used = new Set();
    function add(t, d, p) { used.add(actualKey(t,d,p)); }
    function apply(p) {
      (p.items || []).forEach(i => {
        add(p.teacherA, i.dateA, i.periodA); add(i.teacherB, i.dateA, i.periodA);
        if (i.mode === 'swap') { add(p.teacherA, i.dateB, i.periodB); add(i.teacherB, i.dateB, i.periodB); }
      });
    }
    (plans || []).filter(p => p.status === 'active' && p.id !== exceptId).forEach(apply);
    if (draft) apply(draft);
    return used;
  }
  function canUse(ds, id, value, period, used, map) {
    const l = baseLesson(ds,id,value,period,map);
    return l && !used.has(actualKey(id,value,period)) && kind(ds,l) === 'free';
  }
  function findCandidates(ds, plans, args) {
    const map = lessonMap(ds), l = baseLesson(ds,args.teacherA,args.dateA,args.periodA,map);
    const used = reservations(plans,args.exceptId,{teacherA:args.teacherA, items:args.items || []});
    if (!l || kind(ds,l) === 'free' || used.has(actualKey(args.teacherA,args.dateA,args.periodA))) return [];
    if (args.mode === 'swap' && (kind(ds,l) !== 'regular' || !l.room)) return [];
    const week = monday(args.weekB || args.dateA), results = [];
    for (const t of ds.teachers) {
      if (t.id === args.teacherA || !canUse(ds,t.id,args.dateA,args.periodA,used,map)) continue;
      let choices = [];
      if (args.mode === 'cover') choices.push({date:args.dateA, period:Number(args.periodA)});
      else {
        for (const s of ds.slots) {
          const d = addDays(week,s.day), b = baseLesson(ds,t.id,d,s.period,map);
          if (d === args.dateA && s.period === Number(args.periodA)) continue;
          if (!b || kind(ds,b) !== 'regular' || b.room !== l.room || used.has(actualKey(t.id,d,s.period))) continue;
          if (canUse(ds,args.teacherA,d,s.period,used,map)) choices.push({date:d, period:s.period});
        }
      }
      if (choices.length) {
        const load = ds.slots.filter(s => s.day === dayOf(args.dateA)).filter(s => kind(ds,baseLesson(ds,t.id,args.dateA,s.period,map)) !== 'free').length;
        results.push({teacherId:t.id, name:t.name, choices, load});
      }
    }
    return results.sort((a,b) => a.load-b.load || a.name.localeCompare(b.name,'ko'));
  }
  function validatePlan(ds, plans, raw) {
    if (!raw || !teacher(ds,raw.teacherA)) fail('결강 교사를 선택해 주세요.');
    if (!text(raw.reason) || text(raw.reason).length > 200) fail('결강 사유를 200자 이내로 입력해 주세요.');
    if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > 24) fail('계획서에는 1–24건을 입력할 수 있습니다.');
    date(raw.submitDate);
    const a = teacher(ds,raw.teacherA), clean = {teacherA:a.id, teacherAName:a.name, reason:text(raw.reason), submitter:text(raw.submitter || a.name).slice(0,40), submitDate:raw.submitDate, items:[]};
    for (let n=0; n<raw.items.length; n++) {
      const i = raw.items[n], mode = i.mode;
      if (!['swap','cover'].includes(mode)) fail((n+1) + '번의 처리 유형을 확인해 주세요.');
      const candidates = findCandidates(ds,plans,{teacherA:a.id,dateA:i.dateA,periodA:Number(i.periodA),mode,weekB:i.dateB || i.dateA,exceptId:raw.id,items:clean.items});
      const candidate = candidates.find(c => c.teacherId === i.teacherB);
      if (!candidate || !candidate.choices.some(c => c.date === (mode === 'cover' ? i.dateA : i.dateB) && c.period === Number(mode === 'cover' ? i.periodA : i.periodB))) fail((n+1) + '번은 시간표 조건 또는 다른 계획서와 충돌합니다. 자료를 새로 불러와 확인해 주세요.');
      const la = baseLesson(ds,a.id,i.dateA,i.periodA), b = teacher(ds,i.teacherB);
      const room = la.room || text(i.roomA).slice(0,80);
      if (!room) fail((n+1) + '번의 학급·대상을 입력해 주세요.');
      const item = {mode, dateA:i.dateA, periodA:Number(i.periodA), subjectA:la.subject, roomA:room,
        teacherB:b.id, teacherBName:b.name, dateB:mode === 'cover' ? i.dateA : i.dateB, periodB:Number(mode === 'cover' ? i.periodA : i.periodB)};
      if (mode === 'swap') { const lb = baseLesson(ds,b.id,item.dateB,item.periodB); item.subjectB = lb.subject; item.roomB = lb.room; }
      clean.items.push(item);
    }
    return clean;
  }
  function validateExisting(ds, plans, cutoffDate) {
    const accepted = [];
    for (const p of plans.filter(p => p.status === 'active')) {
      // Historical documents retain their snapshots when a new term's timetable is uploaded.
      if (cutoffDate && p.items.every(i => i.dateA < cutoffDate && i.dateB < cutoffDate)) continue;
      const v = validatePlan(ds,accepted,p);
      for (let n=0;n<v.items.length;n++) for (const k of ['subjectA','roomA','subjectB','roomB']) {
        if (text(v.items[n][k]) !== text(p.items[n][k])) fail('저장된 계획서의 원래 수업과 새 자료가 다릅니다. 해당 계획서를 먼저 취소해 주세요.');
      }
      accepted.push(Object.assign({},v,{id:p.id,status:'active'}));
    }
  }
  function stats(ds) {
    const counts = {}; ds.lessons.forEach(l => { const k = kind(ds,l); counts[k] = (counts[k] || 0) + 1; });
    return {teachers:ds.teachers.length, slots:ds.slots.length, lessons:ds.lessons.length, electives:ds.electives.length, counts,
      reviewSubjects:Array.from(new Set(ds.lessons.filter(l => kind(ds,l) === 'review').map(l => l.subject)))};
  }
  return {DAYS,text,compact,clone,key,actualKey,date,dayOf,addDays,monday,hasSlot,teacher,lessonMap,baseLesson,kind,validateDataset,normalizeTimetable,reservations,findCandidates,validatePlan,validateExisting,stats};
}

export const C = SwapCoreFactory_();
