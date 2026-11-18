import {harness} from '../../../tests/harness.mjs';
import Core from '../../../src/core.js';
import {demoSeed} from './fixtures/demo.js';

export async function createHarness(){
 const h=await harness({course:true});
 try{
  for(const statement of demoSeed().trim().split(/;\s*/).filter(Boolean)){
   await h.sql(statement.replace(/\b(FROM|INTO|UPDATE) (workspace|sheets)\b/g,'$1 ca_$2'));
  }
  const admin=await h.login();
  const enabled=await h.mutation('saveSettings',{settings:{...Core.defaultSettings(),courseAllocationTeachers:true}},admin.cookie);
  if(!enabled.ok)throw Error(enabled.error);
 }catch(error){await h.close();throw error;}
 return {
  ...h,
  login:async admin=>(await h.login(admin?'admin':'teacher')).cookie,
  db:{prepare(query){
   let args=[];
   const statement={bind(...values){args=values;return statement;},run:()=>h.sql(query,...args),async first(){return (await statement.run()).results[0]??null;}};
   return statement;
  }},
  async api(url,method='GET',data,cookie){
   const {pathname,searchParams}=new URL(url,'http://localhost');
   return h.api('courseWorkspace',{role:cookie?.includes('__Host-tt_admin=')?'admin':'teacher',
    path:pathname,method,data:data??Object.fromEntries(searchParams)},cookie);
  }
 };
}
