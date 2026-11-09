import assert from 'node:assert/strict';
import {backup} from './fixture.mjs';
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
