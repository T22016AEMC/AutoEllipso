import {stage44aTests} from './stage4_4a-tests';
import {writeFileSync} from 'node:fs';
const results:any[]=[];
await stage44aTests(async(name,fn)=>{
 try {await fn();results.push({name,passed:true});}
 catch(error){results.push({name,passed:false,error:String(error)});process.exitCode=1;}
});
writeFileSync('stage4_4a-small-tests.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
