import {runSheet} from './engine.js';

self.onmessage=async ({data:{sheet,opts}})=>{
  try{
    const result=await runSheet(sheet,opts,(msg,cls)=>self.postMessage({type:'log',msg,cls}));
    self.postMessage({type:'result',result});
  }catch(error){
    self.postMessage({type:'error',message:error.message});
  }
};
