import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {stage41Fixture} from './stage4_1-fixture';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';

const base='ea378c5',root='.qa/stage44a-before';
for(const file of execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n')) {
  const target=resolve(root,file);mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,execFileSync('git',['show',`${base}:${file}`]));
}
// Instrument only isolated copies; expressions and optimizer options are unchanged.
const optimizerFile=resolve(root,'src/fitting/optimizer.ts');
let opt=readFileSync(optimizerFile,'utf8');
opt=opt.replace('  let lambda = options.initialLambda ?? 1e-2;',`  let lambda = options.initialLambda ?? 1e-2;
  const telemetry:any={};`);
opt=opt.replace('const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);',`const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);
  Object.assign(telemetry,{gradNorm,gradientTolerance,cost:currentCost,ftol,xtol,gtol});`);
opt=opt.replace('if (relativeImprovement < ftol || stepNorm < xtol) {',`Object.assign(telemetry,{relativeImprovement,stepNorm});
          if (relativeImprovement < ftol || stepNorm < xtol) {`);
opt=opt.replace('  return {\n    status,','  return {\n    telemetry:{...telemetry,lambda,maxIterations},\n    status,');
writeFileSync(optimizerFile,opt);
const workflowFile=resolve(root,'src/fitting/autoWorkflow.ts');
let auto=readFileSync(workflowFile,'utf8');
auto='export const calls:any[]=[];\n'+auto.replace(/await optimizeBoundedLM\(/g,'await tracedOptimize(');
auto+=`\nasync function tracedOptimize(variables:any[],residualFn:any,options:any) {
 const initial=structuredClone(variables);const result=await optimizeBoundedLM(variables,residualFn,options);
 calls.push({initial,...result});return result;
}\n`;
writeFileSync(workflowFile,auto);
const baseline=await import(pathToFileURL(workflowFile).href);
const results:any[]=[];
for(const scenario of ['SiO2','absorbing','transparent','weak'] as const) {
 const p=createMultiAoiSiO2OnSiProject();
 const points=scenario==='SiO2'?p.experimentData!.points:stage41Fixture(scenario).points;
 const options={ambient:p.ambient,layers:p.layers,substrate:p.substrate,points,config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]};
 const outputs:any[]=[];
 for(const [label,run] of [['before',baseline.runAutomatedEllipsometryFit],['after',runAutomatedEllipsometryFit]] as const) {
  console.log('START '+scenario+' '+label);baseline.calls.length=0;
  const out=await run(structuredClone(options));const r=out.fittingResult;
  const entry={label,mseWoollam:r.mseWoollam,rawMse:r.rawMse,thickness:out.finalThickness,
   converged:r.converged,status:r.convergenceStatus,physical:out.finalOpticalConstants,free:r.freeFormOpticalConstants};
  outputs.push(entry);
  if(label==='before'&&scenario==='SiO2')writeFileSync('stage4_4a-sio2-optimizer.json',JSON.stringify({result:entry,calls:baseline.calls},null,2));
 }
 const [a,b]=outputs;
 const diff=(key:string)=>Math.max(0,...a[key].flatMap((q:any,i:number)=>['n','k'].map(k=>Math.abs(q[k]-b[key][i][k]))));
 const differences={mseWoollam:b.mseWoollam-a.mseWoollam,thickness:b.thickness-a.thickness,physicalNk:diff('physical'),freeNk:diff('free')};
 results.push({scenario,differences,outputs});writeFileSync('stage4_4a-comparison.json',JSON.stringify(results,null,2));
 console.log('COMPARISON '+JSON.stringify({scenario,differences,before:{...a,physical:undefined,free:undefined},after:{...b,physical:undefined,free:undefined}}));
 assert.ok(Object.values(differences).every(v=>Math.abs(v)<=1e-9));
}
