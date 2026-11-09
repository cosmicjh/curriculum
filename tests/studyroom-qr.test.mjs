import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('Apps Script compatibility entry preserves all 99 seat aliases and rejects user-controlled targets',async()=>{
 const source=await readFile('apps-script-bridge/Code.gs','utf8');let target='https://test.school.example/studyroom-student.html';
 const ctx=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:()=>target})},HtmlService:{createHtmlOutput:html=>html}});vm.runInContext(source,ctx);
 for(let i=1;i<=99;i++){const seat=String(i).padStart(2,'0'),html=ctx.doGet({parameter:{seat,target:'https://evil.example'}});assert(html.includes('href="'+target+'?seat='+seat+'"'));assert(!html.includes('evil.example'));assert(html.includes('target="_blank"'));}
 for(const seat of ['1','00','100','99"><script>'])assert(!ctx.doGet({parameter:{seat}}).includes('출석 화면 열기'));
 target='https://safe.example/studyroom-student.html" onclick="evil()';assert(!ctx.doGet({parameter:{seat:'01'}}).includes('출석 화면 열기'));
 assert(!/ScriptApp|onOpen|UrlFetchApp/.test(source),'entry has no trigger or data processing');
});
