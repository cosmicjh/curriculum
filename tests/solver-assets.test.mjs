import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {workbookData,teacherRows} from '../assets/solver/excel.js';
import '../scripts/build.mjs';

test('friendly controls serialize the existing solver option and run-setting format',async()=>{
  const {readRunSettings}=await import('../dist/solver/app.js');
  const values=xs=>xs.map(value=>({value}));
  const block=(name,cells)=>({querySelector:()=>({value:name}),querySelectorAll:()=>values(cells)});
  const dependent={querySelector:()=>({value:'주과목'}),querySelectorAll:()=>values(['따르는 과목','다른 과목'])};
  const selections={
    'input[name="buja"]:checked':values(['가상부장']),
    'input[name="gangsa"]:checked':values(['가상강사','다른강사']),
    '[data-gangsa-days]':[{dataset:{teacher:'가상강사'},value:'3'},{dataset:{teacher:'다른강사'},value:'0'},{dataset:{teacher:'선택 해제'},value:'2'}],
    '[data-pair] select':values(['과목 하나','', '과목 둘']),
    '[data-dependent]':[dependent],
    '[data-block]':[block('2A',['1,2','4,7']),block('2A',['1,2','3,3']),block('',[])],
  };
  const numbers={over4:'0',run3:'3',lunch:'6',firstlast:'10',startLimit:'0',limit1:'1800',limit2:'600',limit3:'120',workers:'4'};
  const root={querySelectorAll:selector=>selections[selector],querySelector:selector=>({value:numbers[selector.slice(1)]})};
  assert.deepEqual(readRunSettings(root),{options:{buja:['가상부장'],gangsa:['가상강사','다른강사'],weights:{over4:0,run3:3,lunch:6,firstlast:10},pairAllowList:['과목 하나','과목 둘'],gangsaDayCount:{가상강사:3},dependents:[{subject:'주과목',follows:['따르는 과목','다른 과목']}],blockTimeBan:{'2A':[[1,2],[4,7],[3,3]]},startLimit:0},limits:[1800,600,120],workers:4});
});

test('only CP-SAT runtimes ship, the server excludes browser solvers, and headers are scoped',async()=>{
  const files=(await readdir('dist/solver/lib',{recursive:true})).map(f=>f.replaceAll('\\','/'));
  assert.deepEqual(files.filter(f=>f.endsWith('.wasm')).sort(),['wasm/cp_sat_runtime.wasm','wasm/cp_sat_runtime_asyncify.wasm']);
  assert(files.includes('browser/cp-sat.js'));assert(!files.some(f=>/routing|mathopt|mp_solver|pdlp/.test(f)));
  assert.match(await readFile('dist/solver/lib/LICENSE-Apache-2.0.txt','utf8'),/Apache License/);
  assert.match(await readFile('dist/solver/lib/NOTICE.txt','utf8'),/or-tools-wasm 1\.0\.0/);
  const headers=await readFile('dist/_headers','utf8');
  assert.equal((headers.match(/Cross-Origin-Opener-Policy/g)||[]).length,3);
  assert.match(headers,/\/solver\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp/);
  assert.match(headers,/\/solver\.html\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp/);
  assert.match(headers,/\/solver\/\*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp/);
});

test('Excel retains real-time fourth periods, negative scores, summary text and column widths',()=>{
  const model={teachers:['=가상교사']},result={BAN_PLACE:[{t:'=가상교사',g:'2',d:1,p:4,cls:'1',sub:'=가상과목'},{t:'=가상교사',g:'3',d:1,p:4,cls:'2',sub:'다른과목'}],SEC_PLACE:[],UNPLACED:[],blockSlots:[],adoptedStage:'2.5',scores:{'=가상교사':-3},options:{pairAllowList:[],gangsaDayCount:{"가상'강사":2}},checker:{status:'검증 통과',errors:[]},status:'SUCCESS',stages:[{stage:'1',status:'OPTIMAL'}]};
  const rows=teacherRows('=가상교사',result);assert.equal(rows[4][2],'1 =가상과목');assert.equal(rows[5][2],'2 다른과목');
  const sheets=workbookData(model,result);assert.deepEqual(sheets.map(s=>s.widths),[[14,18,18,18,18,18],[6,18,18,18,18,18],[8,8,6,8,10,22,12],[24,32]]);
  assert.deepEqual(sheets[0].rows[0],['=가상교사']);
  const summary=new Map(sheets[3].rows);assert.equal(summary.get('최고 교사 불편 점수'),-3);assert.equal(summary.get('총 불편 점수'),-3);
  assert.equal(summary.get('강사 출근일수'),'{"가상\'강사": 2}');assert.equal(summary.get('단계 1'),'{"stage": "1", "status": "OPTIMAL"}');
});
