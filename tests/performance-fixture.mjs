import Core from '../src/core.js';
export function performanceFixture(){
 const store={term:'2026-2',settings:Core.defaultSettings(),students:[],sections:[],teacherRows:[],overrides:[],blocks:[]};
 for(let grade=1;grade<=3;grade++)for(let subject=0;subject<8;subject++)for(let n=1;n<=12;n++)store.sections.push({id:`section-${grade}-${subject}-${n}`,grade:String(grade),subject:'가상과목'+subject,code:String.fromCharCode(65+subject)+n,room:`가상실${grade}-${n}`,shortName:'과목'+subject});
 for(let grade=1;grade<=3;grade++)for(let classNum=1;classNum<=10;classNum++)for(let number=1;number<=30;number++){const student={id:`student-${grade}-${classNum}-${number}`,sourceKey:`${grade}-${classNum}-${number}`,grade:String(grade),classNum:String(classNum),number:String(number),name:`가상학생${grade}-${classNum}-${number}`,status:'재학',note:'',manualFields:[],updatedAt:'',choices:{}};for(let k=0;k<8;k++)student.choices['가상과목'+k]=String.fromCharCode(65+k)+(number%12+1);store.students.push(student);}
 const header=['순번','교사'],period=['',''];for(const day of Core.DAYS)for(let p=1;p<=7;p++){header.push(p===1?day:'');period.push(p);}store.teacherRows.push(header,period);
 for(let t=0;t<120;t++){const row=[t+1,'가상교사'+t],room=['',''];for(let slot=0;slot<35;slot++){const s=store.sections[(t*7+slot)%store.sections.length];row.push(s.shortName+s.code);room.push(s.room);}store.teacherRows.push(row,room);}
 const times=Core.DAYS.flatMap(day=>Array.from({length:store.settings.periods[day]},(_,p)=>({day,period:p+1}))).filter(t=>!store.settings.fixedPeriods.some(f=>f.day===t.day&&f.period===t.period));
 const board={rooms:Array.from({length:12},(_,i)=>({id:'r'+i,label:(i+1)+'반',classNum:String(i+1)})),grades:['3','2'].map(grade=>({grade,homerooms:{},blocks:Array.from({length:8},(_,k)=>({code:String.fromCharCode(65+k),slots:times.slice(k*3,k*3+3),cells:Object.fromEntries(Array.from({length:12},(_,i)=>['r'+i,{sectionId:`section-${grade}-${k}-${i+1}`,teachers:['가상교사'+i]}]))}))}))};return {store,board};
}
