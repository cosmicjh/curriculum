import {metrics} from './performance.js';

export function createTransport(){
  const pending=new Map();
  async function request(path,method='GET',data={}){
    const start=performance.now();
    let status=0;
    try{
      if(window.parent===window||typeof window.parent.courseAllocationRequest!=='function')
        throw new Error('통합시간표의 시수배당표 메뉴에서 열어 주세요.');
      if(method==='PUT'){
        const {operationId:ignored,...content}=data;
        const fingerprint=JSON.stringify(content);
        if(pending.get(path)?.fingerprint!==fingerprint)pending.set(path,{fingerprint,id:'save-'+crypto.randomUUID()});
        data={...content,operationId:pending.get(path).id};
      }
      const result=await window.parent.courseAllocationRequest(window,path,method,data);
      status=200;
      pending.delete(path);
      return result;
    }catch(error){
      status=error.status||0;
      if(status>=400&&status<500)pending.delete(path);
      throw error;
    }finally{
      metrics.request({action:method==='GET'?'load':method==='PUT'?'save':'operation',path:path.replace(/\/sheets\/[^/]+/,'/sheets/:id'),method,status,ms:performance.now()-start,serverTiming:''});
    }
  }
  return {request};
}
