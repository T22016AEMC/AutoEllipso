import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {modelRegistry} from '../src/modelRegistry/registry';
import {calculatePoint} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {circularDifferenceDeg,residualWeights} from '../src/fitting/residual';
import {optimizeBoundedLM} from '../src/fitting/optimizer';

export const revisions={before:'2d8abe9',after:'9185a97'};
export const save=(name:string,value:unknown)=>writeFileSync(`.qa/stage4_5-${name}.json`,JSON.stringify(value,null,2));
export const truthCases=[
 {id:'T1',model:'tauc_lorentz',values:{eps_inf:1.8,A:100,E0:3.5,C:1.5,Eg:1.5,A2:0,A3:0}},
 {id:'T2',model:'gaussian',values:{eps_inf:2.2,A:2,E0:2.5,sigma:.3,A2:0,A3:0}},
 {id:'T3',model:'lorentz',values:{eps_inf:2.2,A:3,E0:3.5,gamma:.5,A2:0,A3:0}},
 {id:'T4',model:'gaussian',values:{eps_inf:2.2,A:2,E0:2.5,sigma:.3,A2:1.2,E02:4.5,sigma2:.4,A3:0}},
];
export function fixture(index:number) {
 const truth=truthCases[index],project=createMultiAoiSiO2OnSiProject(),layer=structuredClone(project.layers[0]);
 layer.modelId=truth.model;layer.thickness=100;layer.parameters=modelRegistry.createParameterSet(truth.model);
 for(const [key,value] of Object.entries(truth.values))layer.parameters[key].current=value;
 const values=Object.fromEntries(Object.entries(layer.parameters).map(([k,v])=>[k,v.current]));
 let seed=45001;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
 const points=[],optics=[];
 for(const aoi of [65,70,75])for(let wavelength=190;wavelength<=900;wavelength+=10) {
  const c=calculatePoint(project.ambient,[layer],project.substrate,wavelength,aoi),radius=Math.sqrt(-2*Math.log(rng())),angle=2*Math.PI*rng();
  points.push({id:`${aoi}-${wavelength}`,wavelength,aoi,psiExp:c.psiDeg+.03*radius*Math.cos(angle),deltaExp:normalizeDeltaDeg(c.deltaDeg+.03*radius*Math.sin(angle)),psiSigma:.03,deltaSigma:.03});
  if(aoi===65)optics.push({wavelength,...modelRegistry.get(truth.model)!.calculate(wavelength,values)});
 }
 return {truth,project,points,optics,values};
}
function once(s:string,anchor:string,addition:string) {assert.equal(s.split(anchor).length,2,anchor);return s.replace(anchor,addition);}
export function prepare() {
 for(const [label,rev] of Object.entries(revisions)) {
  for(const file of execFileSync('git',['ls-tree','-r','--name-only',rev,'src'],{encoding:'utf8'}).trim().split('\n')) {
   const p=resolve(`.qa/stage45-${label}`,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,execFileSync('git',['show',`${rev}:${file}`]));
  }
  const p=resolve(`.qa/stage45-${label}/src/fitting/autoWorkflow.ts`),original=readFileSync(p,'utf8');
  let s=original.replace(/await optimizeBoundedLM\(/g,(_match,offset)=>`await captureAt(${original.slice(0,offset).split('\n').length})(`);
  s=once(s,'    // Sort all 20+ starts by true full-spectrum Raw MSE ascending',`    diagnostics.push({kind:'starts',modelId:cModelId,initialization,basePhysicalParams:structuredClone(basePhysicalParams),spectrum:structuredClone(bsplineContinuousSpectrum),states:structuredClone(startStates)});
    // Sort all 20+ starts by true full-spectrum Raw MSE ascending`);
  s=once(s,'    // Update the corresponding record in multiStartRuns',`    diagnostics.push({kind:'selected',modelId:cModelId,state:structuredClone(bestStartState)});
    // Update the corresponding record in multiStartRuns`);
  s=`export const calls:any[]=[],diagnostics:any[]=[];\n`+s+`
function captureAt(line:number) {return async(variables:any[],residualFn:any,options:any)=>{
 const initial=structuredClone(variables),start=performance.now();
 const result=await optimizeBoundedLM(variables,residualFn,options);
 calls.push({line,initial,residualFn,options,elapsedMs:performance.now()-start,result});return result;
};}\n`;
  writeFileSync(p,s);
 }
}
export async function workflow(label:'before'|'after') {return import(pathToFileURL(resolve(`.qa/stage45-${label}/src/fitting/autoWorkflow.ts`)).href);}
export function summary(out:any,elapsedMs:number) {
 const r=out.fittingResult;
 return {mseWoollam:r.mseWoollam,rawMse:r.rawMse,thickness:out.finalThickness,thicknessError:out.finalThickness-100,converged:r.converged,status:r.convergenceStatus,elapsedMs,
  parameters:Object.fromEntries(Object.entries(out.updatedLayers[0].parameters).map(([k,p]:[string,any])=>[k,p.current]))};
}
export function errors(out:any,truth:any[]) {
 const free=out.fittingResult.freeFormOpticalConstants,physical=out.finalOpticalConstants;
 // Region labels are diagnostic only, derived from truth, never used by fitting.
 return ['absorbing','nearTransparent'].map(region=>{
  const points=truth.filter(t=>region==='absorbing'?t.k>=1e-3:t.k<1e-3);
  const evaluate=(curve:any[])=>{
   const rows=points.map(t=>{const q=curve.find(q=>q.wavelength===t.wavelength);assert.ok(q,'Optical grid '+t.wavelength);return {n:q.n-t.n,k:q.k-t.k,kSigma:q.kSigma,truth:t.k};});
   return {count:rows.length,nMax:rows.length?Math.max(...rows.map(r=>Math.abs(r.n))):null,nRms:rows.length?Math.sqrt(rows.reduce((s,r)=>s+r.n*r.n,0)/rows.length):null,
    kMax:rows.length?Math.max(...rows.map(r=>Math.abs(r.k))):null,kRms:rows.length?Math.sqrt(rows.reduce((s,r)=>s+r.k*r.k,0)/rows.length):null,
    sigmaAvailable:rows.filter(r=>Number.isFinite(r.kSigma)).length,coverage:rows.filter(r=>Number.isFinite(r.kSigma)).length?rows.filter(r=>Number.isFinite(r.kSigma)&&Math.abs(r.k)<=2*r.kSigma).length/rows.filter(r=>Number.isFinite(r.kSigma)).length:null};
  };
  return {region,free:evaluate(free),physical:evaluate(physical)};
 });
}
export function parameterTable(out:any,diagnostics:any[]) {
 const start=diagnostics.find(d=>d.kind==='starts'),chosen=diagnostics.find(d=>d.kind==='selected');
 const state=start.states.find((s:any)=>s.startIndex===chosen.state.startIndex),layer=chosen.state.layers[0];
 return [{id:'thickness',initial:state.initialThickness,final:out.finalThickness,min:layer.thicknessMin,max:layer.thicknessMax,fit:true},
  ...Object.entries(layer.parameters).map(([id,p]:[string,any])=>({id,initial:state.initialParamsRecord[id],final:p.current,min:p.min,max:p.max,fit:p.fit}))]
  .map(p=>({...p,u:(p.final-p.min)/(p.max-p.min),boundary:(p.final-p.min)/(p.max-p.min)<1e-3||(p.max-p.final)/(p.max-p.min)<1e-3}));
}
/** Independent full-data physical-stage replay using unchanged production optimizer and polish controls. */
export async function replay(project:any,points:any[],template:any,initial:Record<string,number>,label:string) {
 const layers=structuredClone(template.layers),layer=layers[0];
 const variables=[{id:'thickness',name:'Thickness',value:initial.thickness??layer.thickness,min:layer.thicknessMin,max:layer.thicknessMax}];
 for(const [id,p] of Object.entries(layer.parameters) as [string,any][]) {
  if(initial[id]!==undefined)p.current=initial[id];
  if(p.fit)variables.push({id,name:id,value:p.current,min:p.min,max:p.max});
 }
 const residual=(values:number[])=>{
  layer.thickness=values[0];variables.slice(1).forEach((v,i)=>layer.parameters[v.id].current=values[i+1]);
  return points.flatMap(p=>{const c=calculatePoint(project.ambient,layers,project.substrate,p.wavelength,p.aoi);return[c.psiDeg-p.psiExp,circularDifferenceDeg(c.deltaDeg,p.deltaExp)];});
 };
 const weights=residualWeights(points,project.fittingConfig).weights;
 const r=residual(variables.map(v=>v.value)),initialCost=r.reduce((s,v,i)=>s+(v*weights[i])**2,0)/r.length;
 const start=performance.now(),result=await optimizeBoundedLM(variables,residual,{maxIterations:100,tolerance:1e-6,residualWeights:weights});
 return {label,initialCost,variables,result,elapsedMs:performance.now()-start};
}
