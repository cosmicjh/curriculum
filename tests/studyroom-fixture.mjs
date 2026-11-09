import assert from 'node:assert/strict';
import {backup} from './fixture.mjs';
import {stretchPassword,newSalt} from '../src/password.js';
import {localTime} from '../src/studyroom-domain.js';
const today=()=>localTime(new Date()).date;
export async function setupStudyroom(h){
 const admin=await h.login(),teacher=await h.login('teacher');
 assert((await h.mutation('restore',{backup:backup()},admin.cookie)).ok);
 const api=(op,data={},cookie=admin.cookie,headers={})=>h.api('studyroom',{op,...data},cookie,headers);
 const revision=async()=> (await api('dashboard')).data.revision;
 const salt=newSalt();assert((await api('saveStaff',{expectedRevision:await revision(),staff:{username:'test.teacher',name:'가상확인교사',enabled:true,passwordProof:await stretchPassword('가상교사1234',{salt}),passwordSalt:salt,passwordLength:8}})).ok);
 const params=(await api('staffParameters',{username:'test.teacher'},teacher.cookie)).data;
 const login=await api('staffLogin',{username:'test.teacher',epoch:params.epoch,passwordProof:await stretchPassword('가상교사1234',params)},teacher.cookie);assert(login.ok,JSON.stringify(login));
 const staffToken=login.data.token;
 const enabled=await api('configuration',{expectedRevision:await revision(),enabled:true,schedule:{effectiveDate:today(),definitions:[{id:'synthetic',label:'가상 검증 회차',days:[1,2,3,4,5,6,7],start:'00:00',end:'23:59'}]}});assert(enabled.ok,JSON.stringify(enabled));
 return {admin,teacher,staffToken,api,revision};
}
