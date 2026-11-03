import Core from './core.js';
import {C} from '../vendor/class-swap/src/shared/core.js';

// Keep the original name-derived IDs so existing plans survive the shared source.
export function teacherId(name){name=C.text(name);let hash=2166136261;for(let i=0;i<name.length;i++)hash=Math.imul(hash^name.charCodeAt(i),16777619)>>>0;return 't'+hash.toString(16);}
export function datasetFromStore(store){
 const rt=Core.runtime(store),settings=store.settings;if(!rt.teachers.length)return null;
 const slots=Core.DAYS.flatMap((day,index)=>Array.from({length:settings.periods[day]},(_,p)=>({day:index,period:p+1}))),teachers=rt.teachers.map(t=>({id:teacherId(t.name),name:t.name})),lessons=[];
 rt.teachers.forEach((teacher,index)=>{
  for(const cell of Core.teacherTimetable(rt,teacher.name).cells){
   if(!cell.subject||cell.period>settings.periods[cell.day])continue;
   const source=teacher.slots.find(s=>s.day===cell.day&&s.period===cell.period);
   lessons.push({teacherId:teachers[index].id,day:Core.DAYS.indexOf(cell.day),period:cell.period,subject:cell.subject,room:cell.room,...(source?.blockId?{blockId:source.blockId}:{})});
  }
 });
 return C.validateDataset({schema:1,meta:{school:settings.schoolName,label:settings.academicYear+'학년도 '+settings.semester+'학기',sourceYear:String(settings.academicYear)},slots,teachers,lessons,electives:store.sections.map(s=>({grade:Number(s.grade),subject:s.subject,abbr:s.shortName||s.subject}))});
}

export function migratePlans(dataset,legacyDataset,plans){
 const byName=new Map((dataset?.teachers||[]).map(t=>[Core.norm(t.name),t.id])),oldNames=new Map((legacyDataset?.teachers||[]).map(t=>[t.id,t.name]));
 return plans.map(plan=>({...plan,teacherA:byName.get(Core.norm(oldNames.get(plan.teacherA)||plan.teacherAName))||plan.teacherA,items:plan.items.map(item=>({...item,teacherB:byName.get(Core.norm(oldNames.get(item.teacherB)||item.teacherBName))||item.teacherB}))}));
}
