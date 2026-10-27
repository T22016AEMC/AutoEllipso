import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
// Execute the existing assertions verbatim; redirect only their artifact writer.
const original=readFileSync('scripts/stage4_5d-tests.ts','utf8');
const copy=original.replace("import {writeQaFileSync as writeFileSync} from './qa-files.mjs';", "import {writeFileSync as rawWrite} from 'node:fs';\nconst writeFileSync=(name:string,...args:any[])=>rawWrite(('.qa/stage4_9c1-existing-'+name) as any,...args as [any]);")
 .replaceAll("from './","from '../scripts/");
writeFileSync('.qa/stage4_9c1-existing-tests.ts',copy);
const {stage45dTests}=await import(pathToFileURL(resolve('.qa/stage4_9c1-existing-tests.ts')).href);
const rows:any[]=[],start=performance.now();
await stage45dTests(async(name:string,fn:()=>void|Promise<void>)=>{
 try{await fn();rows.push({name,passed:true});}
 catch(error){rows.push({name,passed:false,error:String(error),stack:(error as Error).stack});throw error;}
 finally{writeFileSync('.qa/stage4_9c1-existing-related.json',JSON.stringify({rows,elapsedMs:performance.now()-start},null,2));}
});
