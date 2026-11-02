import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
import {stretchPassword,newSalt} from '../src/password.js';
import {backup} from './fixture.mjs';
const origin='https://cosmicjh.github.io',headers=token=>({Origin:origin,'Sec-Fetch-Site':'cross-site',...(token?{Authorization:'Bearer '+token}:{})});
test('GitHub Pages API: exact CORS allowlist, cookie-independent authentication, D1 writes and revocation',async t=>{
 const h=await harness();t.after(()=>h.close());const native=await h.login();assert((await h.mutation('restore',{backup:backup()},native.cookie)).ok);
 async function login(role='admin',password='1234',previous){const p=await h.api('passwordParameters',{role},'',headers());const r=await h.api('login',{role,password:await stretchPassword(password,p.data),credentialEpoch:p.data.epoch,initialize:true},'',headers(previous));assert(r.ok);assert.match(r.data.token,/^[a-f0-9]{64}$/);assert.equal(r.headers.get('Set-Cookie'),null);return r.data.token;}
 await t.test('only the configured origin and safe preflight method/headers are allowed',async()=>{
  const r=await h.mf.dispatchFetch('http://localhost/api/login',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(r.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');
  for(const bad of ['https://evil.github.io','https://cosmicjh.github.io.evil.example','null']){const p=await h.api('bootstrap',{},'',{Origin:bad});assert.equal(p.status,403);assert.equal(p.headers.get('Access-Control-Allow-Origin'),null);}
  const unsafe=await h.mf.dispatchFetch('http://localhost/api/login',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'DELETE'}});assert.equal(unsafe.status,403);
 });
 const admin=await login();
 await t.test('Pages tokens are hash-stored and cannot be used as native cookies or from another origin',async()=>{
  const a=await h.api('adminBootstrap',{},'',headers(admin));assert.equal(a.status,200);assert.equal(a.headers.get('Access-Control-Allow-Origin'),origin);
  const hashes=(await h.sql("SELECT token_hash FROM sessions WHERE token_hash LIKE 'pages:%'")).results;assert(hashes.length);assert(hashes.every(h=>!h.token_hash.includes(admin)));
  assert.equal((await h.api('adminBootstrap',{},'__Host-tt_admin='+admin)).status,401);assert.equal((await h.api('adminBootstrap',{},'',{Authorization:'Bearer '+admin})).status,401);
  assert.equal((await h.api('adminBootstrap',{},native.cookie,headers())).status,401);assert.equal((await h.api('adminBootstrap',{},'',{...headers(admin),Origin:'https://evil.example'})).status,403);
 });
 await t.test('the same transactional student-save path accepts an authorized Pages session',async()=>{
  const d=(await h.api('adminStudent',{id:'student-one'},'',headers(admin))).data;
  const r=await h.api('saveStudent',{student:{...d.student,name:'Pages웹수정'},expectedTerm:d.meta.term,expectedRevision:d.meta.revision,patch:true},'',headers(admin));assert(r.ok,JSON.stringify(r));assert.equal(r.data.result.name,'Pages웹수정');
 });
 await t.test('teacher rights and password-change revocation apply equally to Pages sessions',async()=>{
  const teacher=await login('teacher');assert.equal((await h.api('adminBootstrap',{},'',headers(teacher))).status,401);assert.equal((await h.api('teacherBootstrap',{},'',headers(teacher))).status,200);
  const p=(await h.api('passwordParameters',{role:'admin'},'',headers(admin))).data,m=(await h.api('bootstrap',{},'',headers())).data,salt=newSalt(),password='교사4321';
  const r=await h.api('changePassword',{role:'teacher',currentPassword:await stretchPassword('1234',p),currentEpoch:p.epoch,passwordSalt:salt,passwordProof:await stretchPassword(password,{salt}),passwordLength:password.length,expectedTerm:m.term,expectedRevision:m.revision},'',headers(admin));assert(r.ok,JSON.stringify(r));assert.equal((await h.api('teacherBootstrap',{},'',headers(teacher))).status,401);
 });
 await t.test('failed login revokes the previous Pages token and logout leaves native sessions intact',async()=>{
  const fresh=await login('teacher','교사4321'),p=(await h.api('passwordParameters',{role:'teacher'},'',headers())).data;
  assert.equal((await h.api('login',{role:'teacher',password:'0'.repeat(64),credentialEpoch:p.epoch},'',headers(fresh))).status,401);assert.equal((await h.api('teacherBootstrap',{},'',headers(fresh))).status,401);
  assert.equal((await h.api('logout',{},'',headers(admin))).status,200);assert.equal((await h.api('adminBootstrap',{},'',headers(admin))).status,401);assert.equal((await h.api('adminBootstrap',{},native.cookie)).status,200);
 });
});
