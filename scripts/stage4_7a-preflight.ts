import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {data} from './stage4_6d-run';
import {refineDiagnostic} from './stage4_6d-refine';
import {refineFreeForm} from '../src/fitting/freeFormRefine';

const prefix='.qa/stage4_7a-';
const save=(name:string,value:unknown)=>writeFileSync(prefix+name+'.json',JSON.stringify(value,null,2));
function difference(a:any,b:any):number {
 if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b);
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){assert.deepEqual(a,b);return 0;}
 assert.deepEqual(Object.keys(a),Object.keys(b));
 return Math.max(0,...Object.keys(a).filter(k=>k!=='elapsedMs').map(k=>difference(a[k],b[k])));
}
assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');
mkdirSync('.qa',{recursive:true});
const start=performance.now(),checks=[];
for(const id of ['T0','T1','T2','T3','T4','T5']){
 const f=data(id,45001),old=JSON.parse(readFileSync(`.qa/stage4_5d-${id}.json`,'utf8')).output;
 const options={ambient:f.project.ambient,layers:old.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig,outputWavelengths:old.fittingResult.freeFormOpticalConstants.map((q:any)=>q.wavelength)};
 const formal=await refineFreeForm(options),{knots,...copy}=await refineDiagnostic({count:40,distribution:'wavelength',scale:1},options);
 const maxDifference=difference(formal,copy);checks.push({id,maxDifference,passed:maxDifference<=1e-9});
 save('equivalence',{checks,elapsedMs:performance.now()-start});
 console.log(JSON.stringify(checks.at(-1)));
 if(!(maxDifference<=1e-9))break;
}
const passed=checks.length===6&&checks.every(c=>c.passed);
assert.ok(passed,'Diagnostic copy must match production within 1e-9');
