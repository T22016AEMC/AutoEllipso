import {writeQaFileSync as writeFileSync} from './qa-files.mjs';

import {stage43Tests} from './stage4_3-tests';
const results:{name:string;passed:boolean;error?:string}[]=[];
await stage43Tests(async(name,fn)=>{try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:String(error)});}});
console.log(JSON.stringify(results,null,2));writeFileSync('stage4_3-unit.json',JSON.stringify(results,null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
