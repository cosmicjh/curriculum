import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('approved monochrome CSS baseline and original font remain locked',async()=>{
 const baseline=JSON.parse(await readFile('tests/fixtures/ui-baseline.json','utf8'));
 for(const [file,hash] of Object.entries(baseline)){
  const bytes=await readFile(file);
  assert.equal(createHash('sha256').update(file.endsWith('.woff2')?bytes:bytes.toString().replaceAll('\r\n','\n')).digest('hex'),hash,file);
  if(file.endsWith('.woff2'))continue;
  for(const match of bytes.toString().matchAll(/#[\da-f]{3,8}\b/gi)){
   const hex=match[0].slice(1),rgb=hex.length<=4?hex.slice(0,3).split(''):hex.slice(0,6).match(/../g);
   if(![3,4,6,8].includes(hex.length))continue;
   assert(rgb.every(value=>value===rgb[0]),file+': '+match[0]);
  }
 }
});

test('fallback font excludes common UI glyphs and keeps rare Hangul eligible',async()=>{
 const css=await readFile('assets/font.css','utf8');
 const ranges=css.match(/unicode-range:([^}]+)/)[1].split(',').map(range=>range.slice(2).split('-').map(n=>parseInt(n,16)));
 const eligible=char=>ranges.some(([start,end=start])=>char.codePointAt(0)>=start&&char.codePointAt(0)<=end);
 for(const char of '한글ABC123')assert.equal(eligible(char),false,char);
 assert.equal(eligible('\uac02'),true);
});
