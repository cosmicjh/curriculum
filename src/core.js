/* Timetable domain logic. No network, storage, credentials or personal seed data. */
var TTCore = (function () {
  'use strict';
  var DAYS = ['월', '화', '수', '목', '금'];
  var DEFAULT_COLUMNS = {월:[2,3,4,5,6,7,8],화:[9,10,11,12,13,14,15],수:[16,17,18,19,20,21],목:[22,23,24,25,26,27,28],금:[29,30,31,32,33,34,35]};
  function text(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return text(v).normalize('NFKC').replace(/[\s_\-]/g, '').toUpperCase(); }
  function code(v) { return norm(v); }
  function block(v) { var m=code(v).match(/^[A-Z]+/); return m ? m[0] : ''; }
  function number(v) { var n=Number(v); return Number.isInteger(n)&&n>0 ? String(n) : ''; }
  function key(s) { return [number(s.grade),number(s.classNum),number(s.number)].join('-'); }
  function sid(s) { return number(s.grade)+number(s.classNum).padStart(2,'0')+number(s.number).padStart(2,'0'); }
  function active(s) { return !s.status || s.status === '재학'; }
  function sectionKey(g, subject, sc) { return number(g)+'|'+norm(subject)+'|'+code(sc); }
  function slotKey(name, day, period) { return norm(name)+'|'+day+'|'+Number(period); }
  function classes(room) { return Array.from(text(room).matchAll(/([1-3])\s*-\s*0*(\d+)/g)).map(function(m){return m[1]+'-'+Number(m[2]);}); }
  function defaultSettings() {
    return {title:'개인 시간표',schoolName:'첨단고등학교',academicYear:2026,semester:2,periods:{월:7,화:7,수:6,목:7,금:7},fixedPeriods:[{day:'월',period:1,label:'창체'},{day:'수',period:5,label:'창체'},{day:'수',period:6,label:'창체'}]};
  }
  function parseTeacherMatrix(rows) {
    var header=-1, nameColumn=1, columns=DEFAULT_COLUMNS;
    for(var h=0;h<Math.min(rows.length,12);h++) {
      if(rows[h].some(function(x){return text(x)==='월';}) && rows[h].some(function(x){return text(x)==='금';})) { header=h; break; }
    }
    if(header>=0) {
      var nc=rows[header].findIndex(function(x){return text(x)==='교사';});
      if(nc>=0) nameColumn=nc;
      var detected={}, day='';
      for(var c=nameColumn+1;c<rows[header].length;c++) {
        if(DAYS.indexOf(text(rows[header][c]))>=0) day=text(rows[header][c]);
        var p=Number((rows[header+1]||[])[c]);
        if(day && p>=1 && p<=12 && Number.isInteger(p)) { if(!detected[day])detected[day]=[]; detected[day][p-1]=c; }
      }
      if(DAYS.every(function(d){return detected[d]&&detected[d].length;}))columns=detected;
    }
    var body=header>=0 ? header+2 : 4, teachers=[], seen={};
    for(var i=body;i<rows.length;i+=2) {
      var name=text((rows[i]||[])[nameColumn]); if(!name)continue;
      if(seen[norm(name)])throw Error('교사명이 중복됩니다: '+name);
      seen[norm(name)]=true;
      var slots=[];
      DAYS.forEach(function(d){var previous=null;(columns[d]||[]).forEach(function(col,p){
        var slot={day:d,period:p+1,rawSubject:text((rows[i]||[])[col]),rawRoom:text((rows[i+1]||[])[col])};
        if(/^(?:[─━-]*[▷▶>→]|→)$/.test(slot.rawSubject)){
          if(!previous)throw Error(name+'의 연속수업 연결 표시를 확인하세요.');
          previous.blockId=previous.blockId||'teacher:'+norm(name)+':'+d+':'+previous.period;
          slot.rawSubject=previous.rawSubject;slot.rawRoom=slot.rawRoom||previous.rawRoom;slot.blockId=previous.blockId;
        }
        slots.push(slot);previous=slot.rawSubject&&!(slot.rawSubject==='공강'&&!slot.rawRoom)?slot:null;
      });});
      teachers.push({id:'teacher:'+norm(name),name:name,slots:slots});
    }
    return {teachers:teachers,columns:columns};
  }
  function runtime(store) {
    var sections=store.sections||[], sectionById={}, byKey={}, exact={}, prefixes={};
    sections.forEach(function(s){
      sectionById[s.id]=s; byKey[sectionKey(s.grade,s.subject,s.code)]=s;
      [s.subject,s.shortName].filter(Boolean).forEach(function(n){
        var k=norm(n+s.code); if(!exact[k])exact[k]=[]; if(exact[k].indexOf(s)<0)exact[k].push(s);
        var p=norm(n)+block(s.code); if(!prefixes[p])prefixes[p]=[]; if(prefixes[p].indexOf(s)<0)prefixes[p].push(s);
      });
    });
    var parsed=parseTeacherMatrix(store.teacherRows||[]), overrides={}, bindings={}, slots={}, warnings=[], counts={}, allocations={}, allocationBlocks={};
    (store.allocation&&store.allocation.grades||[]).forEach(function(g){g.blocks.forEach(function(b){b.slots.forEach(function(time){
      var sp=time.day+'-'+time.period;if(!allocationBlocks[sp])allocationBlocks[sp]={};allocationBlocks[sp][g.grade]=b.code;
      Object.keys(b.cells).forEach(function(id){var c=b.cells[id],s=sectionById[c.sectionId];if(!s)return;c.teachers.forEach(function(name){var key=slotKey(name,time.day,time.period);if(!allocations[key])allocations[key]=[];allocations[key].push(s);});});
    });});});
    (store.overrides||[]).forEach(function(o){overrides[slotKey(o.teacher,o.day,o.period)]=o;});
    parsed.teachers.forEach(function(t){t.slots.forEach(function(l){
      var sk=slotKey(t.name,l.day,l.period), label=norm(l.rawSubject), options=exact[label]||[];
      if(!options.length && /^[^0-9]+$/.test(label))options=prefixes[label]||[];
      options=options.slice();
      var chosen=null, override=overrides[sk];
      var assigned=(allocations[sk]||[]).filter(function(s){return options.indexOf(s)>=0;});
      if(override && sectionById[override.sectionId])chosen=sectionById[override.sectionId];
      else if(assigned.length===1)chosen=assigned[0];
      else if(options.length===1)chosen=options[0];
      else if(options.length>1) {
        var roomNorm=norm(l.rawRoom), rooms=text(l.rawRoom).split(/[,，]/).map(norm);
        var byRoom=options.filter(function(s){return norm(s.room) && (norm(s.room)===roomNorm||rooms.indexOf(norm(s.room))>=0);});
        if(byRoom.length===1)chosen=byRoom[0];
        else {
          var gs=Array.from(new Set(classes(l.rawRoom).map(function(c){return c.split('-')[0];})));
          if(gs.length===1) {var byGrade=options.filter(function(s){return String(s.grade)===gs[0];});if(byGrade.length===1)chosen=byGrade[0];}
        }
      }
      var binding={teacher:t.name,day:l.day,period:l.period,rawSubject:l.rawSubject,rawRoom:l.rawRoom,section:chosen,candidates:options,classKeys:classes(l.rawRoom),key:sk};
      bindings[sk]=binding;
      var sp=l.day+'-'+l.period; if(!slots[sp])slots[sp]=[];slots[sp].push(binding);
      if(!chosen && options.length>1)warnings.push({key:sk,teacher:t.name,day:l.day,period:l.period,rawSubject:l.rawSubject,rawRoom:l.rawRoom,candidateIds:options.map(function(s){return s.id;})});
      if(chosen) {
        if(!counts[sp])counts[sp]={}; if(!counts[sp][chosen.grade])counts[sp][chosen.grade]={};
        var b=block(chosen.code);counts[sp][chosen.grade][b]=(counts[sp][chosen.grade][b]||0)+1;
      }
    });});
    var blocks={};
    Object.keys(counts).forEach(function(sp){blocks[sp]={};Object.keys(counts[sp]).forEach(function(g){
      var bs=Object.keys(counts[sp][g]).sort(function(a,b){return counts[sp][g][b]-counts[sp][g][a]||a.localeCompare(b);});
      blocks[sp][g]=bs[0]||null;
    });});
    (store.blocks||[]).forEach(function(o){var sp=o.day+'-'+o.period;if(!blocks[sp])blocks[sp]={};blocks[sp][o.grade]=o.block||null;});
    Object.keys(allocationBlocks).forEach(function(sp){blocks[sp]=Object.assign(blocks[sp]||{},allocationBlocks[sp]);});
    // Resolve shared labels using the independently established block grid, then
    // the same teacher/course/room combination. Retain these in the review list.
    for(var pass=0;pass<3;pass++)Object.keys(bindings).forEach(function(k){
      var l=bindings[k];if(l.section||l.candidates.length<2)return;
      var viable=l.candidates.filter(function(s){return (blocks[l.day+'-'+l.period]||{})[s.grade]===block(s.code);});
      if(viable.length===1){l.section=viable[0];l.inferred=true;return;}
      var peers=Object.keys(bindings).map(function(key){return bindings[key];}).filter(function(p){return p.section&&norm(p.teacher)===norm(l.teacher)&&norm(p.rawRoom)===norm(l.rawRoom)&&l.candidates.some(function(s){return norm(s.subject)===norm(p.section.subject);});});
      var grades=Array.from(new Set(peers.map(function(p){return p.section.grade;})));
      if(grades.length===1){var match=l.candidates.filter(function(s){return s.grade===grades[0];});if(match.length===1){l.section=match[0];l.inferred=true;}}
    });
    warnings=Object.keys(bindings).map(function(k){return bindings[k];}).filter(function(l){return l.candidates.length>1&&(!l.section||l.inferred)&&!overrides[l.key];}).map(function(l){return {key:l.key,teacher:l.teacher,day:l.day,period:l.period,rawSubject:l.rawSubject,rawRoom:l.rawRoom,sectionId:l.section?l.section.id:'',candidateIds:l.candidates.map(function(s){return s.id;}),inferred:!!l.inferred};});
    return {store:store,teachers:parsed.teachers,sectionById:sectionById,byKey:byKey,bindings:bindings,slots:slots,blocks:blocks,warnings:warnings};
  }
  function packRuntime(rt) {
    return {teachers:rt.teachers.map(function(t){return [t.id,t.name,t.slots.map(function(s){var l=rt.bindings[slotKey(t.name,s.day,s.period)];return [s.day,s.period,s.rawSubject,s.rawRoom,l.section?l.section.id:'',l.candidates.map(function(c){return c.id;}),l.classKeys,!!l.inferred];})];}),blocks:rt.blocks,warnings:rt.warnings};
  }
  function unpackRuntime(store,packed) {
    var byKey={},sectionById={},bindings={},slots={};
    (store.sections||[]).forEach(function(s){byKey[sectionKey(s.grade,s.subject,s.code)]=s;sectionById[s.id]=s;});
    var teachers=packed.teachers.map(function(t){return {id:t[0],name:t[1],slots:t[2].map(function(r){var sk=slotKey(t[1],r[0],r[1]),sp=r[0]+'-'+r[1],l={key:sk,teacher:t[1],day:r[0],period:r[1],rawSubject:r[2],rawRoom:r[3],section:sectionById[r[4]]||null,candidates:r[5].map(function(id){return sectionById[id];}).filter(Boolean),classKeys:r[6],inferred:r[7]};bindings[sk]=l;if(!slots[sp])slots[sp]=[];slots[sp].push(l);return {day:r[0],period:r[1],rawSubject:r[2],rawRoom:r[3]};})};});
    return {store:store,teachers:teachers,sectionById:sectionById,byKey:byKey,bindings:bindings,slots:slots,blocks:packed.blocks,warnings:packed.warnings};
  }
  function blank(day,p) { return {day:day,period:p,subject:'',sectionCode:'',room:'',isElective:false}; }
  function electiveCell(day,p,s) { return {day:day,period:p,subject:s.subject,sectionCode:s.code,room:s.room||'',isElective:true}; }
  function studentTimetable(rt, student) {
    var settings=rt.store.settings||defaultSettings(), own=[];
    Object.keys(student.choices||{}).forEach(function(subject){var s=rt.byKey[sectionKey(student.grade,subject,student.choices[subject])];if(s)own.push(s);});
    var cells=[];
    DAYS.forEach(function(day){for(var p=1;p<=7;p++){
      var empty=blank(day,p); if(p>Number(settings.periods[day]||0)){cells.push(empty);continue;}
      var fixed=(settings.fixedPeriods||[]).find(function(f){return f.day===day&&Number(f.period)===p;});
      if(fixed){empty.subject=fixed.label||'창체';cells.push(empty);continue;}
      var ls=rt.slots[day+'-'+p]||[], boardBlock=null;
      if(rt.store.allocation)(rt.store.allocation.grades||[]).forEach(function(g){if(g.grade===String(student.grade))g.blocks.forEach(function(b){if(b.slots.some(function(t){return t.day===day&&t.period===p;}))boardBlock=b.code;});});
      var exactOwn=own.filter(function(s){return (!boardBlock||block(s.code)===boardBlock)&&ls.some(function(l){return l.section&&l.section.id===s.id;});});
      if(exactOwn.length===1){cells.push(electiveCell(day,p,exactOwn[0]));continue;}
      if(exactOwn.length>1){empty.subject='배정 확인';empty.warning=true;cells.push(empty);continue;}
      var b=(rt.blocks[day+'-'+p]||{})[student.grade], matched=b?own.filter(function(s){return block(s.code)===b;}):[];
      if(matched.length===1){cells.push(electiveCell(day,p,matched[0]));continue;}
      if(matched.length>1){empty.subject='배정 확인';empty.warning=true;cells.push(empty);continue;}
      var common=ls.find(function(l){return !l.section && l.classKeys.indexOf(number(student.grade)+'-'+number(student.classNum))>=0;});
      if(common)empty.subject=common.rawSubject;
      cells.push(empty);
    }});
    if(rt.store.allocation)cells.forEach(function(c){if(!c.isElective)return;var section=rt.byKey[sectionKey(student.grade,c.subject,c.sectionCode)],names=[];
      (rt.store.allocation.grades||[]).forEach(function(g){g.blocks.forEach(function(b){Object.keys(b.cells).forEach(function(id){if(b.cells[id].sectionId===section.id)names=names.concat(b.cells[id].teachers);});});});
      var actual=(rt.slots[c.day+'-'+c.period]||[]).filter(function(l){return l.section&&l.section.id===section.id&&(!names.length||names.some(function(n){return norm(n)===norm(l.teacher);}));}).map(function(l){return l.teacher;});
      c.teachers=Array.from(new Set(actual.length?actual:names));
    });
    return {kind:'student',id:student.id,studentNumber:sid(student),name:student.name,grade:student.grade,classNum:student.classNum,number:student.number,cells:cells};
  }
  function teacherLesson(binding) {
    var s=binding.section;
    return {subject:s?s.subject:binding.rawSubject,room:(s&&s.room)||binding.rawRoom};
  }
  function teacherTimetable(rt, name) {
    var teacher=rt.teachers.find(function(t){return norm(t.name)===norm(name);});
    if(!teacher)throw Error('교사 정보를 찾을 수 없습니다.');
    return {kind:'teacher',name:teacher.name,cells:teacher.slots.map(function(l){
      var binding=rt.bindings[slotKey(teacher.name,l.day,l.period)], s=binding.section, cell=blank(l.day,l.period);
      if(l.period>Number((rt.store.settings||defaultSettings()).periods[l.day]||0))return cell;
      Object.assign(cell,teacherLesson(binding));cell.sectionCode=s?s.code:'';cell.isElective=!!s;
      if(s)cell.roster={kind:'elective',sectionId:s.id};
      else if(binding.candidates.length>1)cell.roster={kind:'choose',sectionIds:binding.candidates.map(function(c){return c.id;})};
      else if(binding.classKeys.length&&l.rawSubject)cell.roster={kind:'common',classes:binding.classKeys,subject:l.rawSubject,detail:l.rawRoom};
      return cell;
    })};
  }
  function roster(rt, query) {
    var students=(rt.store.students||[]).filter(active), title='', detail='';
    if(query.kind==='elective') {
      var s=rt.sectionById[query.sectionId];if(!s)throw Error('분반 정보를 찾을 수 없습니다.');
      title=s.subject;detail=s.code;
      students=students.filter(function(st){return String(st.grade)===String(s.grade)&&code((st.choices||{})[s.subject])===code(s.code);});
    } else {
      var cs=Array.isArray(query.classes)?query.classes:[];
      title=text(query.subject);detail=text(query.detail)||cs.join(', ');
      students=students.filter(function(st){return cs.indexOf(number(st.grade)+'-'+number(st.classNum))>=0;});
    }
    students.sort(function(a,b){return Number(a.grade)-Number(b.grade)||Number(a.classNum)-Number(b.classNum)||Number(a.number)-Number(b.number);});
    return {title:title,detail:detail,students:students.map(function(s){return {grade:s.grade,classNum:s.classNum,number:s.number,name:s.name,note:s.note||''};})};
  }
  function validate(store) {
    var errors=[], warnings=[], seen={}, ids={};
    (store.students||[]).forEach(function(s){
      if(!s.id||ids[s.id])errors.push('학생 ID 중복 또는 누락'); ids[s.id]=true;
      if(!['1','2','3'].includes(number(s.grade))||!number(s.classNum)||!number(s.number)||Number(s.classNum)>99||Number(s.number)>99||!text(s.name))errors.push('학생 기본정보 확인: '+text(s.name));
      var k=key(s);if(active(s)&&seen[k])errors.push('재학생 학번 중복: '+sid(s));if(active(s))seen[k]=true;
    });
    var sk={};(store.sections||[]).forEach(function(s){var k=sectionKey(s.grade,s.subject,s.code);if(sk[k])errors.push('선택분반 중복: '+s.grade+'학년 '+s.subject+' '+s.code);sk[k]=true;if(!block(s.code)||!s.subject)errors.push('선택분반 정보 확인: '+s.subject);});
    (store.students||[]).forEach(function(s){Object.keys(s.choices||{}).forEach(function(subject){if(s.choices[subject]&&!sk[sectionKey(s.grade,subject,s.choices[subject])])warnings.push(sid(s)+' '+subject+' '+s.choices[subject]+'의 분반정보 없음');});});
    try{parseTeacherMatrix(store.teacherRows||[]);}catch(e){errors.push(e.message);}
    return {errors:Array.from(new Set(errors)),warnings:warnings};
  }
  return {DAYS:DAYS,text:text,norm:norm,code:code,block:block,number:number,key:key,sid:sid,active:active,sectionKey:sectionKey,slotKey:slotKey,classes:classes,defaultSettings:defaultSettings,parseTeacherMatrix:parseTeacherMatrix,runtime:runtime,packRuntime:packRuntime,unpackRuntime:unpackRuntime,studentTimetable:studentTimetable,teacherTimetable:teacherTimetable,teacherLesson:teacherLesson,roster:roster,validate:validate};
})();


export default TTCore;
