import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('workbook ships pinned bundles with the local font and retained server/solver modules',async()=>{
 const root='vendor/course-allocation/',manifest=JSON.parse(await readFile(root+'manifest.json','utf8'));
 assert.equal(manifest.upstreamCommit,'eb75f3c071cdd19b4d0ba7243d6f58da73890e14');
 for(const [file,hash] of Object.entries(manifest.artifacts)){
  const text=(await readFile(root+file,'utf8')).replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(text).digest('hex'),hash,file);
 }
 const html=await readFile(root+'index.html','utf8');
 assert(!/cdn\.jsdelivr|src="\.\/config\.js"/.test(html));
 assert(html.indexOf('../assets/font.css')<html.indexOf('./shared/ui.css'));
 assert(html.indexOf('./shared/ui.css')<html.indexOf('./'+manifest.css));
 assert(html.includes('./'+manifest.script));
 assert.deepEqual((await readdir(root+'assets')).sort(),[manifest.script.slice(7),manifest.css.slice(7)].sort());
 const shared=await readdir(root+'shared');
 for(const file of ['domain.js','state.js','catalog.js','hours-import.js','timetable-cpsat.js','timetable-checker.js','timetable-model.js'])assert(shared.includes(file),file);
 for(const file of ['transport.js','performance.js','print.js','reset.js'])assert(!shared.includes(file),file);
});
