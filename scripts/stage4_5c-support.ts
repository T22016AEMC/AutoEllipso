import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {makeFixture,prepare,runtime,analyze,problem} from './stage4_5b-support';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {evaluateSubstrateOpticalConstants} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {circularDifferenceDeg} from '../src/fitting/residual';
import {optimizeBoundedLM,OptimizationVariable} from '../src/fitting/optimizer';
import {computeFitStatistics} from '../src/fitting/statistics';
import {freeFormCurve} from '../src/fitting/freeFormOptics';
import {cubicBasis} from '../src/models/cubicSpline';
import {solveLeastSquaresSvd} from '../src/fitting/svd';
import {modelRegistry} from '../src/modelRegistry/registry';
export {prepare,runtime};

// Frozen before T0–T5. No settings are inferred from a truth curve.
export const settings=Object.freeze({base:'db7c133',seed:45001,knots:40,nMin:.5,nMax:5.5,kMin:0,kMax:3.5,
 gridN:41,gridK:31,gridNMax:4,gridKMax:3,branches:3,nearChiSquare:9,profileRadius:10,coarseStep:.5,fineStep:.05,
 maxIterations:100,tolerance:1e-5,lambdaN:.25,lambdaK:.6,rcond:1e-12,
 missingPointSigmaWeight:1,pointIterations:100,continuity:'minimum sum of squared n/5 and k/3.5 jumps; then chi-square',
 finalRegularization:'same second differences and mean(weight squared) scaling as production',T5Target:'gaussian'});
export const save=(name:string,value:unknown)=>{mkdirSync('.qa',{recursive:true});writeFileSync(`.qa/stage4_5c-${name}.json`,JSON.stringify(value,null,2));};
export const load=(name:string)=>JSON.parse(readFileSync(`.qa/stage4_5c-${name}.json`,'utf8'));
export function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src'],{encoding:'utf8'}),'');}
export function fixture(id:string):any {
 if(id!=='T5')return makeFixture(id);
 const f=makeFixture('T0');let seed=settings.seed;
 const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
 const optics=f.optics.map((p:any)=>({...p,k:Math.max(0,(p.wavelength-700)/200)*.02}));
 const ambient=new Complex(f.project.ambient.n,f.project.ambient.k);
 const points=f.points.map((p:any)=>{const q=optics.find((q:any)=>q.wavelength===p.wavelength),v=solveEllipsometryTMM(ambient,[{thicknessNm:100,N:new Complex(q.n,q.k)}],evaluateSubstrateOpticalConstants(f.project.substrate,p.wavelength),p.wavelength,p.aoi),r=Math.sqrt(-2*Math.log(rng())),a=2*Math.PI*rng();
  return {...p,psiExp:v.psiDeg+.03*r*Math.cos(a),deltaExp:normalizeDeltaDeg(v.deltaDeg+.03*r*Math.sin(a))};});
 return {...f,truth:{id,model:'Cauchy n + linear NIR k',values:f.values},points,optics};
}
export function forward(f:any) {
 const wavelengths=[...new Set<number>(f.points.map((p:any)=>p.wavelength))],ambient=new Complex(f.project.ambient.n,f.project.ambient.k);
 const groups=wavelengths.map(wavelength=>({wavelength,substrate:evaluateSubstrateOpticalConstants(f.project.substrate,wavelength),points:f.points.filter((p:any)=>p.wavelength===wavelength)}));
 const residual=(g:typeof groups[number],d:number,n:number,k:number)=>g.points.flatMap((p:any)=>{const v=solveEllipsometryTMM(ambient,[{thicknessNm:d,N:new Complex(n,k)}],g.substrate,p.wavelength,p.aoi);return [v.psiDeg-p.psiExp,circularDifferenceDeg(v.deltaDeg,p.deltaExp)];});
 return {groups,residual};
}
export function splineProblem(f:any,knots:number[]) {
 const fw=forward(f),basis=fw.groups.map(g=>cubicBasis(g.wavelength,knots)),count=knots.length;
 const residual=(p:number[])=>fw.groups.flatMap((g,j)=>fw.residual(g,p[0],basis[j].reduce((s,b,i)=>s+b*p[i+1],0),basis[j].reduce((s,b,i)=>s+b*p[count+i+1],0)));
 const weights=fw.groups.flatMap(g=>g.points.flatMap((p:any)=>[1/p.psiSigma,1/p.deltaSigma]));
 const regularization=(p:number[])=>{const rows:number[]=[],m=weights.length;for(let i=1;i<count-1;i++)rows.push(Math.sqrt(m*settings.lambdaN)*(p[i+2]-2*p[i+1]+p[i]));for(let i=1;i<count-1;i++)rows.push(Math.sqrt(m*settings.lambdaK)*(p[count+i+2]-2*p[count+i+1]+p[count+i]));return rows;};
 return {residual,weights,regularization};
}
export function project(wavelengths:number[],values:number[],knots:number[],weights?:number[],smooth=0) {
 const A=wavelengths.map((w,j)=>cubicBasis(w,knots).map(b=>b*(weights?.[j]??1))),b=values.map((v,j)=>v*(weights?.[j]??1));
 for(let i=1;i<knots.length-1&&smooth>0;i++){const row=knots.map(()=>0);row[i-1]=Math.sqrt(smooth);row[i]=-2*Math.sqrt(smooth);row[i+1]=Math.sqrt(smooth);A.push(row);b.push(0);}
 return solveLeastSquaresSvd(A,b,settings.rcond);
}
export function variables(knots:number[],d:number,n:number[],k:number[]):OptimizationVariable[] {
 return [{id:'thickness',name:'thickness',value:d,min:40,max:200},...n.map((value,i)=>({id:'N'+i,name:'N'+i,value:Math.max(settings.nMin,Math.min(settings.nMax,value)),min:settings.nMin,max:settings.nMax})),...k.map((value,i)=>({id:'K'+i,name:'K'+i,value:Math.max(0,Math.min(settings.kMax,value)),min:0,max:settings.kMax}))];
}
export function regional(rows:any[]) {
 const summarize=(rr:any[])=>{const valid=rr.filter(r=>Number.isFinite(r.kSigma));return {count:rr.length,nMax:rr.length?Math.max(...rr.map(r=>Math.abs(r.nError))):null,nRms:rr.length?Math.sqrt(rr.reduce((s,r)=>s+r.nError*r.nError,0)/rr.length):null,kMax:rr.length?Math.max(...rr.map(r=>Math.abs(r.kError))):null,kRms:rr.length?Math.sqrt(rr.reduce((s,r)=>s+r.kError*r.kError,0)/rr.length):null,sigmaAvailable:valid.length,coverage:valid.length?valid.filter(r=>Math.abs(r.kError)<=2*r.kSigma).length/valid.length:null};};
 return {all:summarize(rows),absorbing:summarize(rows.filter(r=>r.trueK>=.001)),nearTransparent:summarize(rows.filter(r=>r.trueK<.001))};
}
export async function finish(f:any,knots:number[],vars:OptimizationVariable[],seed:any) {
 const p=splineProblem(f,knots),result=await optimizeBoundedLM(vars,p.residual,{maxIterations:settings.maxIterations,tolerance:settings.tolerance,residualWeights:p.weights,regularizationResidualsFn:p.regularization});
 const stats=computeFitStatistics(vars.map(v=>({...v,splineCoefficient:/^[NK]\d+$/.test(v.id)})),result.finalParams,p.residual,{weights:p.weights,regularizationResidualsFn:p.regularization});
 const curve=freeFormCurve(f.optics.map((q:any)=>q.wavelength),knots,result.finalParams.slice(1,knots.length+1),result.finalParams.slice(knots.length+1),stats,'sigma');
 const rows=curve.map((q,i)=>({...q,trueN:f.optics[i].n,trueK:f.optics[i].k,nError:q.n-f.optics[i].n,kError:q.k-f.optics[i].k}));
 const n=project(f.optics.map((q:any)=>q.wavelength),f.optics.map((q:any)=>q.n),knots).solution,k=project(f.optics.map((q:any)=>q.wavelength),f.optics.map((q:any)=>q.k),knots).solution;
 const witness=variables(knots,100,n,k).map(v=>v.value),wr=p.residual(witness),reg=p.regularization(witness),meanW2=p.weights.reduce((s,w)=>s+w*w,0)/wr.length;
 const witnessCost=wr.reduce((s,r,i)=>s+(r*p.weights[i])**2,0)/wr.length+meanW2*reg.reduce((s,r)=>s+r*r,0)/wr.length;
 assert.ok(rows.every(q=>q.k>=0&&Number.isFinite(q.n)&&Number.isFinite(q.k)),'Nonnegative full-precision k');
 const recomputed=p.residual(result.finalParams).reduce((s,r,i)=>s+(r*p.weights[i])**2,0)/p.weights.length;
 assert.ok(Math.abs(recomputed-result.finalWeightedCost)<1e-8*Math.max(1,recomputed),'Independent data-cost reconstruction');
 const finalReg=p.regularization(result.finalParams).reduce((s,r)=>s+r*r,0)*meanW2/p.weights.length;
 assert.ok(Math.abs(recomputed+finalReg-result.finalCost)<1e-8*Math.max(1,result.finalCost),'Full objective uses production regularization scaling');
 return {seed,knots,variables:vars,result,statistics:stats,rows,regions:regional(rows),summary:{mseWoollam:Math.sqrt(stats.chiSquare/stats.dof),thickness:result.finalParams[0],thicknessError:result.finalParams[0]-100,totalCost:result.finalCost,witnessCost,converged:result.converged,status:result.status,iterations:result.iterations,coverage:regional(rows).all.coverage}};
}
export async function control(f:any,rt:any) {
 rt.workflow.setDiagnosticThickness(undefined);rt.workflow.diagnosticCalls.length=0;
 const c=await rt.workflow.runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:f.truth.id==='T0'||f.truth.id==='T5'?'gaussian':f.truth.model,selectedAois:[65,70,75]});
 const a=analyze(c,rt,f.optics),p=problem(c,rt),n=project(f.optics.map((q:any)=>q.wavelength),f.optics.map((q:any)=>q.n),c.knots).solution,k=project(f.optics.map((q:any)=>q.wavelength),f.optics.map((q:any)=>q.k),c.knots).solution;
 const witness=[100,...n,...k].map((v,i)=>Math.max(c.variables[i].min,Math.min(c.variables[i].max,v))),r=p.residual(witness),reg=p.regularization(witness),mean=p.weights.reduce((s:number,w:number)=>s+w*w,0)/r.length;
 return {capture:c,rows:a.rows,regions:regional(a.rows),summary:{...a,rows:undefined,envelope:undefined,thicknessError:a.thickness-100,totalCost:a.dataCost+a.regularizationCost,witnessCost:r.reduce((s:number,x:number,i:number)=>s+(x*p.weights[i])**2,0)/r.length+reg.reduce((s:number,x:number)=>s+x*x,0)*mean/r.length,converged:c.history.find((s:any)=>s.selected)?.converged,status:c.history.find((s:any)=>s.selected)?.status}};
}
export async function cauchy(f:any,absorption=false) {
 const fw=forward(f),defs=modelRegistry.createParameterSet('cauchy'),keys=absorption?['A','B','C','k0']:['A','B','C'];
 const vars=[{id:'thickness',name:'thickness',value:f.project.layers[0].thickness,min:40,max:200},...keys.map(id=>({id,name:id,value:defs[id].current,min:defs[id].min,max:defs[id].max}))];
 const residual=(p:number[])=>{const dict=Object.fromEntries(keys.map((k,i)=>[k,p[i+1]]));return fw.groups.flatMap(g=>{const v=modelRegistry.get('cauchy')!.calculate(g.wavelength,dict);return fw.residual(g,p[0],v.n,v.k);});};
 const result=await optimizeBoundedLM(vars,residual,{maxIterations:100,tolerance:1e-5,residualWeights:fw.groups.flatMap(g=>g.points.flatMap((p:any)=>[1/p.psiSigma,1/p.deltaSigma]))});
 const dict=Object.fromEntries(keys.map((k,i)=>[k,result.finalParams[i+1]]));return {result,dict,curve:fw.groups.map(g=>({wavelength:g.wavelength,...modelRegistry.get('cauchy')!.calculate(g.wavelength,dict)}))};
}
