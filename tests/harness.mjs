import {Miniflare,Log,LogLevel} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep,extname} from 'node:path';
import {provisionCredential,randomToken} from '../src/crypto.js';
import {stretchPassword,newSalt} from '../src/password.js';
let bundle,bindings;
export async function harness({frontendOrigin='https://cosmicjh.github.io'}={}){
 bundle??=(await build({entryPoints:['tests/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
 if(!bindings){const pepper=randomToken();bindings={PASSWORD_PEPPER:pepper,BOOTSTRAP_TEACHER_HASH:await provisionCredential('1234',pepper,'teacher'),BOOTSTRAP_ADMIN_HASH:await provisionCredential('1234',pepper,'admin')};}
 const mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-07-30',d1Databases:{DB:'timetable-test-'+crypto.randomUUID()},bindings:{...bindings,FRONTEND_ORIGIN:frontendOrigin},host:'127.0.0.1',port:0,log:new Log(LogLevel.ERROR)});
 async function sql(sql,...args){const r=await mf.dispatchFetch('http://localhost/__fixture_sql',{method:'POST',body:JSON.stringify({sql,args})});if(!r.ok)throw Error(await r.text());return r.json();}
 try{for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()){
  let schema=(await readFile('migrations/'+name,'utf8')).replace(/^--.*$/gm,'');const triggers=[];
  schema=schema.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g,trigger=>{triggers.push(trigger);return '';});
  for(const statement of [...schema.split(';').map(s=>s.trim()).filter(Boolean),...triggers])await sql(statement);
 }}catch(error){await mf.dispose();throw error;}
 let seq=0,server;
 async function api(action,data={},cookie='',extraHeaders={}){
  const start=performance.now(),response=await mf.dispatchFetch('http://localhost/api/'+action,{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','CF-Connecting-IP':'test-'+(++seq),...(cookie?{Cookie:cookie}:{}),...extraHeaders},body:JSON.stringify(data)});
  const raw=await response.text();let payload;try{payload=JSON.parse(raw);}catch{throw Error(raw);}return {status:response.status,headers:response.headers,elapsed:performance.now()-start,bytes:Buffer.byteLength(raw),...payload};
 }
 async function login(role='admin',password='1234',cookie=''){
  const p=await api('passwordParameters',{role}),r=await api('login',{role,password:await stretchPassword(password,p.data),credentialEpoch:p.data.epoch,initialize:true},cookie);
  if(!r.ok)throw Error(JSON.stringify(r));return {cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),data:r.data};
 }
 async function mutation(action,data,cookie){const ctx=await api('bootstrap');return api(action,{expectedTerm:ctx.data.term,expectedRevision:ctx.data.revision,patch:true,...data},cookie);}
 async function passwordChange(role,password,cookie){const p=(await api('passwordParameters',{role:'admin'})).data,salt=newSalt();return mutation('changePassword',{role,currentPassword:await stretchPassword('1234',p),currentEpoch:p.epoch,passwordSalt:salt,passwordProof:await stretchPassword(password,{salt}),passwordLength:password.length},cookie);}
 return {mf,sql,api,login,mutation,passwordChange,
  async listen(){
   const root=resolve('dist');server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://'+req.headers.host);if(url.pathname.startsWith('/api/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await mf.dispatchFetch(url.href,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})});const heads=Object.fromEntries(response.headers);delete heads['set-cookie'];if(response.headers.getSetCookie().length)heads['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,heads);res.end(Buffer.from(await response.arrayBuffer()));return;}
   const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+sep))throw Error('path');const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream',...(extname(file)==='.woff2'?{'Cache-Control':'public, max-age=600'}:{})});res.end(body);}catch{res.writeHead(404);res.end('Not found');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;},
  async close(){if(server)await new Promise(r=>server.close(r));await mf.dispose();}
 };
}

