import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('small module reads stop waiting promptly while large reads and writes retain their save window',async()=>{
 const delays=[],window={};
 runInNewContext(await readFile('assets/transport.js','utf8'),{
  window,location:{href:'https://timetable.test/',origin:'https://timetable.test'},URL,AbortController,TextEncoder,performance,
  setTimeout:(_,ms)=>{delays.push(ms);return 1;},clearTimeout:()=>{},
  fetch:async()=>({headers:new Headers({'Content-Type':'application/json'}),text:async()=>'{"ok":true,"data":{}}'})
 });
 for(const [action,args,expected] of [
  ['student',{},15000],['teacher',{},15000],['roster',{},15000],['allocation',{},15000],['adminLinks',{},15000],
  ['classSwap',{swapAction:'resume'},15000],['courseWorkspace',{method:'GET'},15000],
  ['classBatch',{},110000],['previewImport',{},110000],['downloadBackup',{},110000],['saveAllocation',{},110000],
  ['classSwap',{swapAction:'submitPlan'},110000],['courseWorkspace',{method:'PUT'},110000],['studyroom',{op:'submit'},110000]
 ]){
  await window.TTApi.request(action,args);assert.equal(delays.at(-1),expected,action);
 }
});
