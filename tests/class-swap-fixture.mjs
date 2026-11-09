import {C} from '../vendor/class-swap/src/shared/core.js';
import {today} from '../vendor/class-swap/src/shared/backup.js';
import {teacherId} from '../src/class-swap-data.js';
import {fixture} from './fixture.mjs';
const futureWeek=C.monday(C.addDays(today(),14));
export function synthetic(){return C.validateDataset({schema:1,meta:{label:'가상 검증 시간표'},slots:[0,1,2,3,4].flatMap(day=>[1,2,3].map(period=>({day,period}))),teachers:[{id:'a',name:'가교사'},{id:'b',name:'나교사'},{id:'c',name:'다교사'}],electives:[{grade:2,subject:'미적분',abbr:'미적분'},{grade:3,subject:'물리학Ⅱ',abbr:'물리Ⅱ'},{grade:3,subject:'중국 문화',abbr:'중문화'}],lessons:[{teacherId:'a',day:0,period:1,subject:'과학',room:'1-1'},{teacherId:'b',day:1,period:2,subject:'수학',room:'1-1'},{teacherId:'c',day:0,period:1,subject:'국어',room:'1-2'},{teacherId:'c',day:1,period:2,subject:'공강B',room:'스터디카'}]});}
export const ids={a:teacherId('가교사'),b:teacherId('나교사'),c:teacherId('다교사')};
export const rawPlan=(suffix='0123456789abcdef')=>({id:'p_'+suffix,version:0,teacherA:ids.a,reason:'출장',submitDate:today(),submitter:'가교사',items:[{mode:'swap',dateA:futureWeek,periodA:1,teacherB:ids.b,dateB:C.addDays(futureWeek,1),periodB:2}]});
export function sharedStore(){
 const store=fixture(),ds=synthetic(),header=['순번','교사'],period=['',''];
 for(const day of C.DAYS)for(let p=1;p<=7;p++){header.push(p===1?day:'');period.push(p);}
 store.teacherRows=[header,period];store.settings.periods=Object.fromEntries(C.DAYS.map(day=>[day,3]));store.settings.fixedPeriods=[];
 ds.teachers.forEach((teacher,index)=>{const row=[String(index+1),teacher.name],rooms=['',''];for(let day=0;day<5;day++)for(let p=1;p<=7;p++){const lesson=ds.lessons.find(l=>l.teacherId===teacher.id&&l.day===day&&l.period===p);row.push(lesson?.subject||'');rooms.push(lesson?.room||'');}store.teacherRows.push(row,rooms);});
 store.sections=ds.electives.map((e,index)=>({id:'shared-section-'+index,grade:String(e.grade),subject:e.subject,code:'A'+(index+1),shortName:e.abbr,room:'선택실',manualFields:[]}));
 store.students=[{...store.students[0],id:'first-grade',sourceKey:'1-1-1',grade:'1',choices:{}}];return store;
}
export const sharedBackup=()=>({format:'school-timetable-backup',schemaVersion:1,exportedAt:new Date().toISOString(),store:sharedStore()});
