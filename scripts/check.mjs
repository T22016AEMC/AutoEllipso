import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
// Execute installed CLIs directly. No automatic install or ignored-build policy changes.
const commands=[['typecheck','node_modules/typescript/bin/tsc','--noEmit'],
  ['build','node_modules/vite/bin/vite.js','build'],
  ['original-tests','node_modules/tsx/dist/cli.mjs','scripts/baseline-tests.ts','v2-original-tests.json'],
  ['scientific-tests','node_modules/tsx/dist/cli.mjs','scripts/scientific-tests.ts'],
  ['worker-tests','node_modules/tsx/dist/cli.mjs','scripts/worker-tests.ts']];
const summaries=await Promise.all(commands.map(([name,...args])=>new Promise(resolve=>{
  const child=spawn(process.execPath,args,{env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  child.on('error',e=>{output+=String(e);});
  child.on('close',code=>{writeFileSync(`v2-${name}.log`,output);console.log(name+': '+code+'\n'+output.slice(-2500));resolve({name,exitCode:code});});
})));
writeFileSync('verification-summary.json',JSON.stringify({at:new Date().toISOString(),commands:summaries},null,2));
if(summaries.some(x=>x.exitCode!==0))process.exitCode=1;
