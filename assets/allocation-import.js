(function(global){
 'use strict';
 const text=v=>v==null?'':String(v).trim();
 function fromMatrix(matrix){
  if(!Array.isArray(matrix)||matrix.length<2)throw Error('배치표 내용이 없습니다.');
  const header=matrix[0],start=header.findIndex(v=>/^1반$/.test(text(v)));if(start<1)throw Error('첫 행의 1반·교실 제목을 확인하세요.');
  const rooms=header.slice(start).map((v,i)=>({id:'room-'+i,label:text(v),classNum:/^(\d+)반$/.exec(text(v))?.[1]||''}));
  if(rooms.some(r=>!r.label))throw Error('빈 교실 제목을 확인하세요.');
  const board={rooms,grades:[]};let grade;
  matrix.slice(1).forEach((row,index)=>{
   const first=text(row[0]),m=/^([1-3])학년$/.exec(first);
   if(m){grade={grade:m[1],homerooms:{},blocks:[]};rooms.forEach((r,i)=>{if(text(row[start+i]))grade.homerooms[r.id]=text(row[start+i]);});board.grades.push(grade);return;}
   if(!row.some(v=>text(v)))return;
   if(!grade||!/^[A-Za-z]+$/.test(first))throw Error((index+2)+'행의 학년·시간블록을 확인하세요.');
   const block={code:first.toUpperCase(),slots:[],cells:{}};
   row.slice(1,start).forEach(v=>{if(!text(v))return;const time=/^([월화수목금])\s*([1-7])$/.exec(text(v));if(!time)throw Error((index+2)+'행의 교시를 확인하세요: '+text(v));block.slots.push({day:time[1],period:Number(time[2])});});
   rooms.forEach((r,i)=>{const value=text(row[start+i]);if(!value)return;const cell=/^([\s\S]+?)\s+([A-Za-z]+(?:[_-]?\d+)?)\s*(?:\(([^()]*)\))?$/.exec(value);if(!cell)throw Error((index+2)+'행 '+r.label+'의 과목·분반·교사 형식을 확인하세요.');block.cells[r.id]={subject:cell[1].trim(),code:cell[2],teachers:(cell[3]||'').split(/[,，、\n]/).map(text).filter(Boolean)};});grade.blocks.push(block);
  });
  if(!board.grades.length)throw Error('학년 제목을 확인하세요.');return board;
 }
 async function file(file){if(!file||file.size>5*1024*1024)throw Error('5MB 이하의 배치표 엑셀 파일을 선택하세요.');const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellFormula:false});if(wb.SheetNames.length!==1)throw Error('배치표 시트 하나만 포함한 파일을 선택하세요.');return fromMatrix(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''}));}
 global.TTAllocationImport={fromMatrix,file};
})(globalThis);
