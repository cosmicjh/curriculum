(function(global){
  'use strict';
  const fields=new Set(['순번','학년','반','번호','이름','비고','학번','학적','학생ID']);
  const str=v=>v==null?'':String(v).trim();
  const num=v=>String(Number(v));
  function fromMatrices(teacher,elective,studentMatrices){
    const payload={format:'timetable-import'},warnings=[];
    if(teacher)payload.teacherRows=teacher.map(r=>r.map(str));
    if(elective){
      const headers=elective[0].map(str),required=['학년','선택반명','교과명','수업교실','축약과목명'];
      if(required.some(h=>!headers.includes(h)))throw Error('선택과목정보의 열 제목을 확인하세요.');
      payload.sections=elective.slice(1).filter(r=>r.some(v=>str(v))).map(r=>{const get=k=>str(r[headers.indexOf(k)]);return {grade:num(get('학년')),code:get('선택반명'),subject:get('교과명'),room:get('수업교실'),shortName:get('축약과목명')};});
    }
    if(studentMatrices&&studentMatrices.length){
      const students=new Map();
      studentMatrices.forEach(matrix=>{
        const headers=matrix[0].map(str);
        if(['학년','반','번호','이름'].some(h=>!headers.includes(h))&&!['학번','이름'].every(h=>headers.includes(h)))throw Error('학생 파일의 학년·반·번호·이름 열을 확인하세요.');
        matrix.slice(1).forEach(row=>{
          const get=h=>str(row[headers.indexOf(h)]);if(!row.some(v=>str(v)))return;
          let grade=get('학년'),classNum=get('반'),number=get('번호');
          if(!grade&&/^\d{5}$/.test(get('학번'))){const n=get('학번');grade=n[0];classNum=n.slice(1,3);number=n.slice(3);}
          if(!grade||!classNum||!number)return;
          const key=[num(grade),num(classNum),num(number)].join('-'),name=get('이름'),note=get('비고');
          let student=students.get(key);
          if(student&&student.name!==name)throw Error('학생 파일의 이름이 서로 다릅니다: '+key);
          if(!student){student={grade:num(grade),classNum:num(classNum),number:num(number),name,note,choices:{}};students.set(key,student);}
          if(student.note&&note&&student.note!==note)warnings.push(key+' 비고가 서로 다릅니다.');
          if(note)student.note=note;
          headers.forEach((h,i)=>{if(!h||fields.has(h))return;const value=str(row[i]);if(Object.hasOwn(student.choices,h)&&student.choices[h]&&value&&student.choices[h]!==value)throw Error('과목 배정이 서로 다릅니다: '+key+' '+h);if(value||!Object.hasOwn(student.choices,h))student.choices[h]=value;});
        });
      });payload.students=Array.from(students.values());
    }
    return {payload,warnings};
  }
  async function matrix(file,kind,term){
    if(!file)return null;
    if(file.size>20*1024*1024)throw Error('파일 크기를 확인하세요.');
    if(/\.json$/i.test(file.name)&&kind){
      const data=JSON.parse(await file.text());
      if(data?.format==='school-course-allocation-transfer'&&(data.schemaVersion!==1||!data.term))throw Error('시수배당 전달 파일의 버전과 학기를 확인하세요.');
      if(data?.term&&data.term!==term)throw Error('파일의 학기가 현재 학기와 다릅니다.');
      if(!['timetable-import',...(kind==='sections'?['school-course-allocation-transfer']:[])].includes(data?.format)||!Array.isArray(data[kind])||!data[kind].length)throw Error('예시 JSON과 같은 자료 형식을 사용하세요.');
      if(kind==='sections')return {sections:data.sections.map(s=>({grade:s.grade,code:s.code,subject:s.subject,room:s.room,shortName:s.shortName}))};
      const subjects=[...new Set(data.students.flatMap(s=>Object.keys(s.choices||{})))];
      if(subjects.some(s=>fields.has(s)))throw Error('선택과목 이름이 기본 열 제목과 겹칩니다.');
      return [['학년','반','번호','학번','이름','비고',...subjects],...data.students.map(s=>[s.grade,s.classNum,s.number,s.studentNumber,s.name,s.note,...subjects.map(subject=>s.choices?.[subject])])];
    }
    if(!/\.(xlsx|csv)$/i.test(file.name))throw Error(kind?'XLSX, CSV 또는 JSON 파일을 선택하세요.':'XLSX 또는 CSV 파일을 선택하세요.');
    const wb=/\.csv$/i.test(file.name)?XLSX.read(await file.text(),{type:'string',raw:true}):XLSX.read(await file.arrayBuffer(),{type:'array'});
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false,defval:'',blankrows:true});
  }
  async function files(teacher,elective,students,term){
    const [teacherRows,sections,studentRows]=await Promise.all([matrix(teacher),matrix(elective,'sections',term),Promise.all(Array.from(students||[],file=>matrix(file,'students',term)))]);
    const result=fromMatrices(teacherRows,sections?.sections?null:sections,studentRows);
    if(sections?.sections)result.payload.sections=sections.sections;
    return result;
  }
  global.TTImport={fromMatrices,files};
  if(typeof module!=='undefined'&&module.exports)module.exports=global.TTImport;
})(typeof window!=='undefined'?window:globalThis);
