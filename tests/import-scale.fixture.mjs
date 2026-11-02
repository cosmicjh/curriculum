// Entirely generated test data. No school/student/teacher source files.
export function importScaleFixture(){
 const subjects=Array.from({length:33},(_,i)=>'합성선택과목'+String(i+1).padStart(2,'0'));
 const sections=[2,3].flatMap(grade=>subjects.flatMap(subject=>[1,2,3].map(n=>({grade:String(grade),subject,code:'A'+n,room:grade+'-'+n,shortName:subject}))));
 const students=Array.from({length:593},(_,i)=>({grade:i<284?'2':'3',classNum:String(Math.floor((i<284?i:i-284)/30)+1),number:String(i%30+1),name:'합성학생'+String(i+1).padStart(4,'0'),note:'',choices:Object.fromEntries(subjects.map((s,n)=>[s,(i+n)%3===0?'A'+(i%3+1):'']))}));
 const header=['순번','교사'],period=['',''];for(const day of ['월','화','수','목','금'])for(let p=1;p<=7;p++){header.push(p===1?day:'');period.push(String(p));}
 const teacherRows=[header,period];for(let i=0;i<64;i++){const row=[String(i+1),'합성교사'+String(i+1).padStart(2,'0')],room=['',''];for(let p=0;p<35;p++){row.push(p%3===0?subjects[(i+p)%subjects.length]+'A1':'');room.push((i%2+2)+'-1');}teacherRows.push(row,room);}
 return {format:'timetable-import',students,sections,teacherRows};
}
