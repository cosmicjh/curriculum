import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSections,pairKey,runSheet,sectionCapacities,validateResult} from '../assets/section-assignment/engine.js';

test('section capacities rise only for overcrowded courses and validation rejects excess assignments',async()=>{
 const sheet={
  name:'가상 신청',courses:{가상초과:2,가상유지:1},courseCredits:{가상초과:3,가상유지:3},
  groups:['A','B'],groupCredits:[3,3],students:Array.from({length:7},(_,rowIndex)=>({
   rowIndex,selected:[rowIndex<5?'가상초과':'가상유지']
  }))
 };
 sheet.algoState=buildSections(sheet);
 const opts={
  nGroups:2,maxPerSection:2,allowedDiff:1,baseSeed:42,maxIter:5,nCandidates:1,
  courseCredits:sheet.courseCredits,groupCredits:sheet.groupCredits,bigsecCourses:new Set(),
  searchProfile:{maxAttempts:2,deepCandidates:1,deepIter:5,shortlist:1}
 };
 const logs=[];
 const {topCandidates:[{result}]}=await runSheet(sheet,opts,(message,level)=>logs.push({message,level}));
 assert(result.validation.ok&&result.validation.complete);
 const {가상초과:raised,가상유지:ordinary}=sheet.algoState.courseToSections;
 const capacities=sectionCapacities(sheet,2);
 assert.deepEqual(raised.map(sid=>capacities[sid]),[3,3]);
 assert.deepEqual(ordinary.map(sid=>capacities[sid]),[2]);
 assert.deepEqual(raised.map(sid=>result.sectionLoad[sid]).sort(),[2,3]);
 assert.equal(result.sectionLoad[ordinary[0]],2);
 assert.equal(logs.filter(({level})=>level==='warn').length,1);
 assert.match(logs.find(({level})=>level==='warn').message,/가상초과.*신청 5명.*2분반.*적용 정원 3명/);
 const target=raised.find(sid=>result.sectionLoad[sid]===3),source=raised.find(sid=>sid!==target);
 const row=sheet.students.find(s=>result.assignments[s.rowIndex][0]===source);
 result.assignments[row.rowIndex][0]=target;
 result.sectionLoad[source]--;result.sectionLoad[target]++;
 assert.deepEqual(validateResult(sheet,result,opts).errors,[`분반 ${target}: 정원 초과`]);
});

async function coupledAssignment(light,bigSection=false){
 const groups=bigSection?['A']:['A','B'];
 const sheet={
  name:'가상 배정',courses:{가상집중:1,가상소수:1,가상공통:2},courseCredits:{가상집중:2,가상소수:2,가상공통:1},
  groups,groupCredits:groups.map(()=>3),
  students:Array.from({length:8+light},(_,rowIndex)=>({rowIndex,selected:[rowIndex<8?'가상집중':'가상소수','가상공통']}))
 };
 sheet.algoState=buildSections(sheet);
 const opts={
  nGroups:groups.length,maxPerSection:5,allowedDiff:1,baseSeed:42,maxIter:5,nCandidates:1,
  courseCredits:sheet.courseCredits,groupCredits:sheet.groupCredits,
  creditPairs:new Set([pairKey('가상집중','가상공통'),pairKey('가상소수','가상공통')]),
  bigsecCourses:new Set(bigSection?['가상공통']:[]),searchProfile:{maxAttempts:2,deepCandidates:1,deepIter:5,shortlist:1}
 };
 const warnings=[];
 const {topCandidates:[{result}]}=await runSheet(sheet,opts,(msg,level)=>{if(level==='warn')warnings.push(msg);});
 return {result,warnings,sheet};
}

test('a coupled section warns when its partner limits the raised capacity',async()=>{
 const {result,warnings,sheet}=await coupledAssignment(2);
 assert(result.validation.ok);
 assert.equal(result.validation.complete,false);
 assert.equal(result.unassigned.length,3);
 assert.deepEqual(result.sectionLoad,[5,2,5,2]);
 assert.deepEqual(sectionCapacities(sheet,5,result.validation.cohortLinks),[5,5,5,5]);
 assert(warnings.some(msg=>/가상집중.*신청 8명.*적용 정원 8명으로 상향/.test(msg)));
 assert(warnings.some(msg=>/2\+1 결합.*가상집중.*가상공통.*적용 정원 5명으로 제한/.test(msg)));
});

test('raised coupled capacities keep both groups intact in parallel big sections',async()=>{
 const {result,warnings}=await coupledAssignment(8,true);
 assert(result.validation.ok&&result.validation.complete);
 assert.deepEqual(result.sectionLoad,[8,8,8,8]);
 assert.deepEqual(result.secToGroup,[0,0,0,0]);
 assert.equal(result.validation.parallelPeaks.가상공통,2);
 assert.equal(result.validation.parallelLimits.가상공통,2);
 assert.equal(result.validation.cohortLinks.length,2);
 assert.equal(warnings.filter(msg=>msg.includes('적용 정원 8명으로 상향')).length,3);
 assert(!warnings.some(msg=>msg.includes('으로 제한')));
});
