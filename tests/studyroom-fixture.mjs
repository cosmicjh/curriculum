import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {backup} from './fixture.mjs';
import {harness} from './harness.mjs';
import {localTime} from '../src/studyroom-domain.js';
const today=()=>localTime(new Date()).date;
export async function setupStudyroom(h){
 const admin=await h.login(),teacher=await h.login('teacher');
 assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
 const api=(op,data={},cookie=admin.cookie,headers={})=>h.api('studyroom',{op,...data},cookie,headers);
 const revision=async()=> (await api('dashboard')).data.revision;
 const enabled=await api('configuration',{expectedRevision:await revision(),enabled:true,schedule:{effectiveDate:today(),definitions:[{id:'synthetic',label:'아침',days:[1,2,3,4,5,6,7],start:'00:00',end:'23:59'}]}});assert(enabled.ok,JSON.stringify(enabled));
 return {admin,teacher,api,revision};
}

export const studyroomFault=(phase,count=1,message='D1_ERROR: Network connection lost.',failReplayAfter)=>({'X-Test-Studyroom-Fault':JSON.stringify({phase,count,message,failReplayAfter})});
let faultWorker;
export async function studyroomFaultHarness(){
 faultWorker??=(await build({stdin:{resolveDir:process.cwd(),contents:`
  import worker from './tests/worker.mjs';
  const statements=new WeakMap();
  let reached=false,released=false;
  async function waitForGate(ready){
   const deadline=Date.now()+15000;
   while(!ready()){
    if(Date.now()>=deadline)return false;
    await scheduler.wait(10);
   }
   return true;
  }
  export default {scheduled:worker.scheduled,async fetch(request,env){
   const pathname=new URL(request.url).pathname;
   if(pathname==='/__studyroom_commit_wait'){
    const arrived=await waitForGate(()=>reached);
    return new Response(null,{status:arrived?204:504});
   }
   if(pathname==='/__studyroom_commit_release'){released=true;return new Response(null,{status:204});}
   const fault=JSON.parse(request.headers.get('X-Test-Studyroom-Fault')||'null');
   if(!fault)return worker.fetch(request,env);
   const failure=()=>typeof fault.message==='string'?Error(fault.message):new Error('D1_ERROR',{cause:Error(fault.message.cause)});
   let attempts=0,executions=0,revisionConflicts=0,replays=0,replayFailures=0;
   const db={
    prepare(sql){
     const statement=env.DB.prepare(sql);
     return {bind(...args){const bound=statement.bind(...args);statements.set(bound,sql);return bound;}};
    },
    async batch(batch){
     const sql=statements.get(batch[0]);
     const commit=sql.startsWith('INSERT INTO sr_write_guards');
     if(commit)executions++;
     const replay=sql.includes('FROM sr_events WHERE request_id=');
     if(replay&&fault.failReplayAfter!==undefined&&++replays===fault.failReplayAfter+1){replayFailures++;throw failure();}
     const match=fault.phase==='context'?sql.includes('FROM app_state a JOIN terms'):
      fault.phase==='limit'?sql.startsWith('INSERT INTO login_limits'):
      fault.phase==='replay'?replay:commit;
     const inject=match&&++attempts<=fault.count;
     if(fault.phase==='commitGate'&&inject){
      reached=true;
      if(!await waitForGate(()=>released))throw Error('Test commit gate timed out');
     }
     if(inject&&fault.phase!=='afterCommit'&&fault.phase!=='commitGate')throw failure();
     let result;
     try{result=await env.DB.batch(batch);}
     catch(error){if(commit&&error.message.includes('sr_revision_conflict'))revisionConflicts++;throw error;}
     if(inject&&fault.phase==='afterCommit')throw failure();
     return result;
    }
   };
   const response=await worker.fetch(request,{...env,DB:db}),headers=new Headers(response.headers);
   headers.set('X-Test-Studyroom-Attempts',String(attempts));
   headers.set('X-Test-Studyroom-Commits',String(executions));
   headers.set('X-Test-Studyroom-Revision-Conflicts',String(revisionConflicts));
   headers.set('X-Test-Studyroom-Replay-Failures',String(replayFailures));
   return new Response(response.body,{status:response.status,headers});
  }};
 `},bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
 const h=await harness({studyroom:true,workerScript:faultWorker});
 const gate=async action=>assert.equal((await h.mf.dispatchFetch('http://localhost/__studyroom_commit_'+action)).status,204);
 return {...h,waitForCommit:()=>gate('wait'),releaseCommit:()=>gate('release')};
}
