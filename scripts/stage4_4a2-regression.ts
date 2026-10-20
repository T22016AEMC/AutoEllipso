import {writeQaFileSync as writeFileSync,readQaFileSync as readFileSync} from './qa-files.mjs';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {stage41Fixture} from './stage4_1-fixture';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';

const base='51546e8',root='.qa/stage44a2-before';
for(const file of execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n')) {
  const target=resolve(root,file);mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,execFileSync('git',['show',`${base}:${file}`]));
}
// Instrument only isolated copies; expressions and optimizer options are unchanged.
const optimizerFile=resolve(root,'src/fitting/optimizer.ts');
let opt=readFileSync(optimizerFile,'utf8');
opt=opt.replace('  let lambda = options.initialLambda ?? 1e-2;',`  let lambda = options.initialLambda ?? 1e-2;
  const telemetry:any={trace:[]};`);
opt=opt.replace('const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);',`const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);
  Object.assign(telemetry,{gradNorm,gradientTolerance,cost:currentCost,ftol,xtol,gtol});`);
opt=opt.replace('if (relativeImprovement < ftol || stepNorm < xtol) {',`Object.assign(telemetry,{relativeImprovement,stepNorm});
          telemetry.trace.push({iteration:iter+1,cost:trialCost,relativeImprovement});
          if (relativeImprovement < ftol || stepNorm < xtol) {`);
opt=opt.replace('  return {\n    status,','  return {\n    telemetry:{...telemetry,lambda,maxIterations},\n    status,');
writeFileSync(optimizerFile,opt);
const workflowFile=resolve(root,'src/fitting/autoWorkflow.ts');
let auto=readFileSync(workflowFile,'utf8');
auto='export const calls:any[]=[];\n'+auto.replace(/await optimizeBoundedLM\(/g,'await tracedOptimize(');
auto+=`\nasync function tracedOptimize(variables:any[],residualFn:any,options:any) {
 const initial=structuredClone(variables),start=performance.now();const result=await optimizeBoundedLM(variables,residualFn,options);
 const elapsedMs=performance.now()-start;
 calls.push({initial,elapsedMs,...result});return result;
}\n`;
writeFileSync(workflowFile,auto);
const baseline=await import(pathToFileURL(workflowFile).href);
const afterRoot=resolve('.qa/stage44a2-after');
for(const file of execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n')) {
 const target=resolve(afterRoot,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(file));
}
writeFileSync(resolve(afterRoot,'src/fitting/optimizer.ts'),opt);
// The same read-only wrapper is used on both sides, preserving optimizer expressions.
const current=readFileSync('src/fitting/autoWorkflow.ts','utf8');
const afterAuto='export const calls:any[]=[];\n'+current.replace(/await optimizeBoundedLM\(/g,'await tracedOptimize(')+auto.slice(auto.indexOf('\nasync function tracedOptimize'));
writeFileSync(resolve(afterRoot,'src/fitting/autoWorkflow.ts'),afterAuto);
const after=await import(pathToFileURL(resolve(afterRoot,'src/fitting/autoWorkflow.ts')).href);
const results:any[]=[];
for(const scenario of ['SiO2','absorbing','transparent','weak'] as const) {
 const p=createMultiAoiSiO2OnSiProject();
 const points=scenario==='SiO2'?p.experimentData!.points:stage41Fixture(scenario).points;
 const options={ambient:p.ambient,layers:p.layers,substrate:p.substrate,points,config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]};
 const outputs:any[]=[];
 for(const [label,run] of [['before',baseline.runAutomatedEllipsometryFit],['after',after.runAutomatedEllipsometryFit]] as const) {
  console.log('START '+scenario+' '+label);const trace=label==='before'?baseline:after;trace.calls.length=0;
  const out=await run(structuredClone(options));const r=out.fittingResult;
  const entry={label,mseWoollam:r.mseWoollam,rawMse:r.rawMse,thickness:out.finalThickness,
   converged:r.converged,status:r.convergenceStatus,physical:out.finalOpticalConstants,free:r.freeFormOpticalConstants,polishes:trace.calls.filter((c:any)=>[35,100].includes(c.telemetry?.maxIterations))};
  outputs.push(entry);
  if(scenario==='SiO2')writeFileSync('stage4_4a2-sio2-'+label+'.json',JSON.stringify({result:entry,calls:trace.calls},null,2));
 }
 const [a,b]=outputs;
 const diff=(key:string)=>Math.max(0,...a[key].flatMap((q:any,i:number)=>['n','k'].map(k=>Math.abs(q[k]-b[key][i][k]))));
 const differences={mseWoollam:b.mseWoollam-a.mseWoollam,thickness:b.thickness-a.thickness,physicalNk:diff('physical'),freeNk:diff('free')};
 results.push({scenario,differences,outputs});writeFileSync('stage4_4a2-comparison.json',JSON.stringify(results,null,2));
 console.log('COMPARISON '+JSON.stringify({scenario,differences,before:{...a,physical:undefined,free:undefined,polishes:undefined},after:{...b,physical:undefined,free:undefined,polishes:undefined},mseIncreased:b.mseWoollam>a.mseWoollam,polishTimeBefore:a.polishes.reduce((s:number,c:any)=>s+c.elapsedMs,0),polishTimeAfter:b.polishes.reduce((s:number,c:any)=>s+c.elapsedMs,0)}));
 assert.equal(differences.freeNk,0); // This stage does not change the free-form fit.
}
