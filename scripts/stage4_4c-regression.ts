import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {stage41Fixture} from './stage4_1-fixture';
import {modelRegistry} from '../src/modelRegistry/registry';
import {calculatePoint} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';

const base='2d8abe9',mode=process.argv[2]??'prepare';
const save=(name:string,value:unknown)=>writeFileSync(`.qa/stage4_4c-${name}.json`,JSON.stringify(value,null,2));
if(mode==='prepare') {
 for(const label of ['before','after']) {
  const files=execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n');
  for(const file of files) {
   const target=resolve(`.qa/stage44c-${label}`,file);mkdirSync(dirname(target),{recursive:true});
   writeFileSync(target,label==='before'?execFileSync('git',['show',`${base}:${file}`]):readFileSync(file));
  }
  // Only read-only call capture in isolated copies, no numerical expressions changed.
  const workflow=resolve(`.qa/stage44c-${label}/src/fitting/autoWorkflow.ts`);
  const s=readFileSync(workflow,'utf8');
  writeFileSync(workflow,`export const calls:any[]=[];\n`+s.replace(/await optimizeBoundedLM\(/g,'await captureOptimize(')+`
async function captureOptimize(variables:any[],residualFn:any,options:any) {
 const initial=structuredClone(variables),start=performance.now();
 const result=await optimizeBoundedLM(variables,residualFn,options);
 calls.push({initial,maxIterations:options.maxIterations,elapsedMs:performance.now()-start,...result});return result;
}\n`);
 }
 console.log('Prepared isolated baseline and current source snapshots');
} else {
 const before=await import(pathToFileURL(resolve('.qa/stage44c-before/src/fitting/autoWorkflow.ts')).href);
 const after=await import(pathToFileURL(resolve('.qa/stage44c-after/src/fitting/autoWorkflow.ts')).href);
 if(mode==='continuity') {
  const old=await import(pathToFileURL(resolve('.qa/stage44c-before/src/modelRegistry/registry.ts')).href);
  const rows=[];
  for(const id of ['gaussian','lorentz','tauc_lorentz','multi_oscillator']) {
   const params=Object.fromEntries(Object.entries(modelRegistry.createParameterSet(id)).map(([k,p])=>[k,p.current]));
   const keys=id==='multi_oscillator'?['A1','A2','A3']:['A','A2','A3'];
   const current=modelRegistry.get(id)!,previous=old.modelRegistry.get(id);
   let maxZeroDifference=0;
   // Preserve nonzero primary contribution while each formerly gated term is exactly zero.
   for(const key of keys) {
    const p={...params,[key]:0};
    for(let w=190;w<=900;w++) {
     const a=current.calculateEpsilon!(w,p),b=previous.calculateEpsilon(w,p);
     maxZeroDifference=Math.max(maxZeroDifference,Math.abs(a.eps1-b.eps1),Math.abs(a.eps2-b.eps2));
    }
   }
   assert.ok(maxZeroDifference<=1e-12);
   const sample=keys.map(key=>({key,values:[0,.001,.001001,1].map(amplitude=>({amplitude,...current.calculateEpsilon!(350,{...params,[key]:amplitude})}))}));
   rows.push({id,maxZeroDifference,sample});
  }
  save('continuity',rows);console.log(JSON.stringify(rows));
 } else {
  const results:any[]=[];
  for(const scenario of mode==='two'?['two']:['SiO2','absorbing','transparent','weak']) {
   const p=createMultiAoiSiO2OnSiProject();
   let points=p.experimentData!.points;
   const truth={eps_inf:2.2,A:2,E0:2.5,sigma:.3,A2:1.2,E02:4.5,sigma2:.4,A3:0,E03:5.8,sigma3:.7};
   if(scenario==='two') {
    const t=structuredClone(p);t.layers[0].modelId='gaussian';t.layers[0].thickness=100;t.layers[0].parameters=modelRegistry.createParameterSet('gaussian');
    for(const [key,value] of Object.entries(truth))t.layers[0].parameters[key].current=value;
    let seed=44003;
    const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
    points=[];
    for(const aoi of [65,70,75])for(let wavelength=190;wavelength<=900;wavelength+=10) {
     const c=calculatePoint(t.ambient,t.layers,t.substrate,wavelength,aoi),radius=Math.sqrt(-2*Math.log(rng())),angle=2*Math.PI*rng();
     points.push({id:`${aoi}-${wavelength}`,wavelength,aoi,psiExp:c.psiDeg+.03*radius*Math.cos(angle),deltaExp:normalizeDeltaDeg(c.deltaDeg+.03*radius*Math.sin(angle)),psiSigma:.03,deltaSigma:.03});
    }
   } else if(scenario!=='SiO2')points=stage41Fixture(scenario as 'absorbing'|'transparent'|'weak').points;
   const outputs=[];
   for(const [label,workflow] of [['before',before],['after',after]] as const) {
    console.log(`START ${mode} ${scenario} ${label}`);workflow.calls.length=0;const start=performance.now();
    const out=await workflow.runAutomatedEllipsometryFit({ambient:structuredClone(p.ambient),layers:structuredClone(p.layers),substrate:structuredClone(p.substrate),points:structuredClone(points),config:structuredClone(p.fittingConfig),targetModelId:mode==='two'?'gaussian':mode,selectedAois:[65,70,75]});
    const elapsedMs=performance.now()-start,r=out.fittingResult;
    const params=Object.fromEntries(Object.entries(out.updatedLayers[0].parameters).map(([key,v]:[string,any])=>[key,v.current]));
    const matching=workflow.calls.filter((c:any)=>c.initial.some((v:any)=>v.id==='A2')&&c.finalParams.every((value:number,i:number)=>Math.abs(value-(c.initial[i].id==='thickness'?out.finalThickness:params[c.initial[i].id]))<=1e-12));
    const selected=matching.at(-1);
    const entry={label,mseWoollam:r.mseWoollam,rawMse:r.rawMse,thickness:out.finalThickness,converged:r.converged,status:r.convergenceStatus,elapsedMs,parameters:params,
     selectedCall:selected??null,initialization:r.initialization,multiStartSummary:r.multiStartSummary};
    outputs.push(entry);save(`${mode}-${scenario}-${label}`,{...entry,points,truth:scenario==='two'?truth:undefined,output:out,calls:workflow.calls});
    console.log('RESULT '+JSON.stringify(entry));
   }
   results.push({scenario,outputs,mseIncreased:outputs[1].mseWoollam>outputs[0].mseWoollam});save(mode+'-comparison',results);
  }
 }
}
