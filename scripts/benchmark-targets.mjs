import {execFileSync} from 'node:child_process';
import {dirname,relative,resolve} from 'node:path';
import {build} from 'esbuild';
import {harness} from '../tests/harness.mjs';

// Compile a local commit in memory; never switch branches or contact a remote.
export async function benchmarkTargets(options={}){
 const index=process.argv.indexOf('--baseline');
 if(index<0)return [{variant:'current',h:await harness(options)}];
 const ref=process.argv[index+1];
 if(!/^[a-f0-9]{7,40}$/.test(ref||''))throw Error('--baseline requires a local commit hash');
 const root=resolve(import.meta.dirname,'..');
 const result=await build({entryPoints:['tests/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser',plugins:[{
  name:'local-baseline',setup(builder){builder.onLoad({filter:/\.js$/},({path})=>{
   const file=relative(root,path).replaceAll('\\','/');if(!file.startsWith('src/'))return;
   return {contents:execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8'}),loader:'js',resolveDir:dirname(path)};
  });}
 }]});
 const before=await harness({...options,workerScript:result.outputFiles[0].text});
 try{return [{variant:ref,h:before},{variant:'current',h:await harness(options)}];}
 catch(error){await before.close();throw error;}
}
