import Core from '../src/core.js';
export function fixture(){
 const header=['순번','교사'],period=['',''];for(const d of Core.DAYS)for(let p=1;p<=7;p++){header.push(p===1?d:'');period.push(p);}
 const row=['1','가상교사'],room=['',''];for(const d of Core.DAYS)for(let p=1;p<=7;p++){row.push((d==='월'&&p===2||d==='화'&&p===2)?'가상과학A1':d==='금'&&p===3?'가상과학A':d==='화'&&p===1?'국어':'');room.push(d==='화'&&p===1?'3-1':'과학실');}
 return {term:'2026-2',settings:Core.defaultSettings(),students:[{id:'student-one',sourceKey:'3-1-1',grade:'3',classNum:'1',number:'1',name:'가상학생하나',status:'재학',note:'가상 자료',manualFields:[],updatedAt:'',choices:{가상과학:'A1',가상언어:'B1'}},{id:'student-two',sourceKey:'3-1-2',grade:'3',classNum:'1',number:'2',name:'가상학생둘',status:'재학',note:'',manualFields:[],updatedAt:'',choices:{가상과학:'A2'}}],sections:[{id:'section-one',grade:'3',subject:'가상과학',code:'A1',room:'과학실',shortName:'가상과학'},{id:'section-two',grade:'3',subject:'가상과학',code:'A2',room:'다른실',shortName:'가상과학'},{id:'section-three',grade:'3',subject:'가상언어',code:'B1',room:'어학실',shortName:'언어'}],teacherRows:[header,period,row,room],overrides:[],blocks:[]};
}
export const backup=()=>({format:'school-timetable-backup',schemaVersion:1,exportedAt:'2026-10-30T00:00:00Z',store:fixture()});

export const allocationFixture=()=>({rooms:[{id:'r1',label:'새 과학실',classNum:''},{id:'r2',label:'2반',classNum:'2'}],grades:[{grade:'3',homerooms:{r2:'담임교사'},blocks:[{code:'A',slots:[{day:'월',period:2},{day:'화',period:2},{day:'금',period:3}],cells:{r1:{sectionId:'section-one',teachers:['가상교사']},r2:{sectionId:'section-two',teachers:['다른교사']}}}]}]});
