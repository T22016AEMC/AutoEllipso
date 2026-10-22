import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from './stage4_5-support';
import {modelRegistry} from '../src/modelRegistry/registry';
import {calculatePoint} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {optimizeBoundedLM,centralDifferenceJacobian} from '../src/fitting/optimizer';
import {computeFitStatistics} from '../src/fitting/statistics';
import {computeResidualMetrics,circularDifferenceDeg,residualWeights} from '../src/fitting/residual';
import {effectiveSplineParameters} from '../src/fitting/splineRefinement';
import {freeFormCurve} from '../src/fitting/freeFormOptics';
import {cubicBasis,cubicEvaluate} from '../src/models/cubicSpline';

export const base='d539582a88533357a32c48dd7f6dc5f074aaec21';
const root=resolve('.qa/stage45b-source');
export const path=(name:string)=>`.qa/stage4_5b-${name}.json`;
export const save=(name:string,value:unknown)=>writeFileSync(path(name),JSON.stringify(value,null,2));
export const read=(name:string)=>JSON.parse(readFileSync(path(name),'utf8'));
export const exists=(name:string)=>existsSync(path(name));
export function makeFixture(id:string) {
 if(id!=='T0')return fixture(Number(id.slice(1))-1);
 const f=fixture(0),layer=structuredClone(f.project.layers[0]);layer.modelId='cauchy';layer.thickness=100;layer.parameters=modelRegistry.createParameterSet('cauchy');
 const values=Object.fromEntries(Object.entries(layer.parameters).map(([k,v])=>[k,v.current]));
 let seed=45001;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
 const points=[],optics=[];
 for(const aoi of [65,70,75])for(let wavelength=190;wavelength<=900;wavelength+=10) {
  const c=calculatePoint(f.project.ambient,[layer],f.project.substrate,wavelength,aoi),r=Math.sqrt(-2*Math.log(rng())),theta=2*Math.PI*rng();
  points.push({id:`${aoi}-${wavelength}`,wavelength,aoi,psiExp:c.psiDeg+.03*r*Math.cos(theta),deltaExp:normalizeDeltaDeg(c.deltaDeg+.03*r*Math.sin(theta)),psiSigma:.03,deltaSigma:.03});
  if(aoi===65)optics.push({wavelength,...modelRegistry.get('cauchy')!.calculate(wavelength,values)});
 }
 return {...f,truth:{id,model:'cauchy',values},values,points,optics};
}
function once(s:string,needle:string,next:string){assert.equal(s.split(needle).length,2,needle);return s.replace(needle,next);}
export function prepare() {
 assert.equal(execFileSync('git',['diff',base,'--','src'],{encoding:'utf8'}),'');
 for(const file of execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n')) {
  const p=resolve(root,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,execFileSync('git',['show',`${base}:${file}`]));
 }
 // Diagnostic-only +one-level test at 48. The normal ladder remains capped at 40.
 const model=resolve(root,'src/models/bspline.ts');writeFileSync(model,once(readFileSync(model,'utf8'),'export const MAX_BSPLINE_NODES = 40;','export const MAX_BSPLINE_NODES = 48;'));
 const p=resolve(root,'src/fitting/autoWorkflow.ts');let s=readFileSync(p,'utf8');
 s=s.replace(/await optimizeBoundedLM\(/g,'await captureOptimize(');
 s=once(s,'    bsplineLayers[primaryLayerIndex].parameters = stageParamDict;',`    if(diagnosticFixedThickness!==undefined){
      stageVars[0]={...stageVars[0],value:diagnosticFixedThickness,min:diagnosticFixedThickness,max:diagnosticFixedThickness};
      activeBsplineThickness=diagnosticFixedThickness;
    }
    bsplineLayers[primaryLayerIndex].parameters = stageParamDict;`);
 const anchor='  // =========================================================================\n  // STEP 4: B-spline Diagnostic';
 s=once(s,anchor,`  return {diagnosticOnly:true,history:knotRefinementHistory,knots:activeKnots,params:splineVector,
    variables:bestSplineVariables,model:freeFormModel,statistics:freeFormStatistics,curve:freeFormOpticalConstants,
    points:fittingPoints,ambient,substrate,config,lambdaN,lambdaK,calls:diagnosticCalls} as any;
${anchor}`);
 s=`export let diagnosticFixedThickness:number|undefined;
export function setDiagnosticThickness(value:number|undefined){diagnosticFixedThickness=value;}
export const diagnosticCalls:any[]=[];\n`+s+`
async function captureOptimize(variables:any[],residualFn:any,options:any) {
 const initial=structuredClone(variables),result=await optimizeBoundedLM(variables,residualFn,options);
 if(variables.some(v=>v.id==='N0'))diagnosticCalls.push({initial,result,options,points:options.residualWeights.length/2});
 return result;
}\n`;
 writeFileSync(p,s);
}
export async function runtime() {
 return {workflow:await import(pathToFileURL(resolve(root,'src/fitting/autoWorkflow.ts')).href),
  calculator:await import(pathToFileURL(resolve(root,'src/solver/calculator.ts')).href),
  spline:await import(pathToFileURL(resolve(root,'src/models/bspline.ts')).href)};
}
export function problem(c:any,rt:any,factor=1) {
 const layers=structuredClone(c.model.layers),layer=layers[c.model.primaryLayerIndex],count=c.knots.length,points=c.points;
 const residual=(p:number[])=>{
  layer.thickness=p[0];for(let i=0;i<count;i++){layer.parameters['N'+i].current=p[i+1];layer.parameters['K'+i].current=p[i+count+1];}
  return points.flatMap((pt:any)=>{const v=rt.calculator.calculatePoint(c.ambient,layers,c.substrate,pt.wavelength,pt.aoi);return[v.psiDeg-pt.psiExp,circularDifferenceDeg(v.deltaDeg,pt.deltaExp)];});
 };
 const regularization=(p:number[])=>{
  const rows=[],n=Math.sqrt(2*points.length*c.lambdaN*factor),k=Math.sqrt(2*points.length*c.lambdaK*factor);
  for(let i=1;i<count-1;i++)rows.push(n*(p[i+2]-2*p[i+1]+p[i]));
  for(let i=1;i<count-1;i++)rows.push(k*(p[i+count+2]-2*p[i+count+1]+p[i+count]));
  return rows;
 };
 return {layers,residual,regularization,weights:residualWeights(points,c.config).weights};
}
export function analyze(c:any,rt:any,truth:any[],statistics=c.statistics) {
 const p=problem(c,rt),r=p.residual(c.params),evaluated=c.points.map((pt:any)=>({...pt,...(()=>{const v=rt.calculator.calculatePoint(c.ambient,p.layers,c.substrate,pt.wavelength,pt.aoi);return {psiCalc:v.psiDeg,deltaCalc:v.deltaDeg};})()}));
 const effective=effectiveSplineParameters(c.variables,c.params),metrics=computeResidualMetrics(evaluated,c.config.fitWeighting,c.config.psiWeight,c.config.deltaWeight,effective);
 const n=c.params.slice(1,1+c.knots.length),k=c.params.slice(1+c.knots.length),curve=freeFormCurve(truth.map(t=>t.wavelength),c.knots,n,k,statistics,'sigma');
 const rows=truth.map((t,i)=>({...curve[i],trueN:t.n,trueK:t.k,nError:curve[i].n-t.n,kError:curve[i].k-t.k}));
 const finite=rows.filter(q=>Number.isFinite(q.kSigma));
 const envelope=truth.map(t=>{const b=cubicBasis(t.wavelength,c.knots);assert.ok(Math.abs(b.reduce((s,x)=>s+x,0)-1)<1e-12&&b.every(x=>x>=0));
  const nMin=b.reduce((s,x,i)=>s+x*c.variables[i+1].min,0),nMax=b.reduce((s,x,i)=>s+x*c.variables[i+1].max,0),kMax=b.reduce((s,x,i)=>s+x*c.variables[i+1+c.knots.length].max,0);
  return {wavelength:t.wavelength,nMin,nMax,kMax,nViolation:Math.max(0,nMin-t.n,t.n-nMax),kViolation:Math.max(0,t.k-kMax)};});
 const reg=p.regularization(c.params),meanW2=p.weights.reduce((s,w)=>s+w*w,0)/r.length;
 return {knots:c.knots.length,thickness:c.params[0],mseWoollam:metrics.mseWoollam,reducedChiSquare:metrics.reducedChiSquare,
  dataCost:r.reduce((s:number,x:number,i:number)=>s+(x*p.weights[i])**2,0)/r.length,regularizationCost:reg.reduce((s,x)=>s+x*x,0)*meanW2/r.length,
  nMax:Math.max(...rows.map(q=>Math.abs(q.nError))),nRms:Math.sqrt(rows.reduce((s,q)=>s+q.nError*q.nError,0)/rows.length),
  kMax:Math.max(...rows.map(q=>Math.abs(q.kError))),kRms:Math.sqrt(rows.reduce((s,q)=>s+q.kError*q.kError,0)/rows.length),
  sigmaAvailable:finite.length,meanSigma:finite.length?finite.reduce((s,q)=>s+q.kSigma!,0)/finite.length:null,
  coverage:finite.length?finite.filter(q=>Math.abs(q.kError)<=2*q.kSigma!).length/finite.length:null,
  thicknessInCovariance:statistics.covariance.ids.includes('thickness'),conditionNumber:statistics.conditionNumber,truncated:statistics.truncatedSingularValues,
  bounds:{nExcluded:envelope.filter(q=>q.nViolation>0).length,nMaxViolation:Math.max(...envelope.map(q=>q.nViolation)),kExcluded:envelope.filter(q=>q.kViolation>0).length,kMaxViolation:Math.max(...envelope.map(q=>q.kViolation))},rows,envelope};
}
export function statistics(c:any,rt:any,lockedThickness=false,factor=1) {
 const p=problem(c,rt,factor);
 return computeFitStatistics(c.variables.map((v:any)=>({...v,splineCoefficient:/^[NK]\d+$/.test(v.id),locked:lockedThickness&&v.id==='thickness'})),c.params,p.residual,{weights:p.weights,regularizationResidualsFn:p.regularization});
}
export async function refit(c:any,rt:any,truth:any[],options:{iterations:number;factor?:number}) {
 const start=performance.now(),p=problem(c,rt,options.factor??1),variables=c.variables.map((v:any,i:number)=>({...v,value:c.params[i]}));
 const result=await optimizeBoundedLM(variables,p.residual,{maxIterations:options.iterations,tolerance:1e-5,residualWeights:p.weights,regularizationResidualsFn:p.regularization});
 const updated={...c,variables,params:result.finalParams};updated.statistics=statistics(updated,rt,false,options.factor??1);
 const report=analyze(updated,rt,truth);
 // analyze() uses the formal strength; replace the explicitly varied objective term only.
 report.regularizationCost*=options.factor??1;
 assert.ok(Math.abs(report.dataCost-result.finalWeightedCost)<1e-9*Math.max(1,report.dataCost),'Refit data objective agrees');
 assert.ok(Math.abs(report.regularizationCost-result.finalRegularizationPenalty)<1e-9*Math.max(1,report.regularizationCost),'Refit regularization agrees');
 return {settings:options,result,summary:{...report,rows:undefined,envelope:undefined},capture:updated,elapsedMs:performance.now()-start};
}
export function regrid(c:any,rt:any,count:number) {
 if(count===c.knots.length)return structuredClone(c);
 const knots=rt.spline.generateAdaptiveKnots(c.knots[0],c.knots.at(-1),count);assert.equal(knots.length,count);
 const n=knots.map((w:number)=>Math.max(1,cubicEvaluate(w,c.knots,c.params.slice(1,1+c.knots.length)))),k=knots.map((w:number)=>Math.max(1e-12,cubicEvaluate(w,c.knots,c.params.slice(1+c.knots.length))));
 const variables=[{...c.variables[0]},...n.map((value:number,i:number)=>({id:'N'+i,name:'N'+i,value,min:Math.max(1,value-.8),max:Math.min(5.5,value+.8)})),...k.map((value:number,i:number)=>({id:'K'+i,name:'K'+i,value,min:0,max:Math.min(3.5,Math.max(.4,value+1.2))}))];
 const model=structuredClone(c.model),layer=model.layers[model.primaryLayerIndex];
 for(const key of Object.keys(layer.parameters))if(/^[NK]\d+$/.test(key)||/^_knot\d+$/.test(key))delete layer.parameters[key];
 layer.parameters._knotCount.current=count;
 knots.forEach((w:number,i:number)=>layer.parameters['_knot'+i]={id:'_knot'+i,current:w,fit:false,min:150,max:2500});
 variables.slice(1).forEach((v:any)=>layer.parameters[v.id]={...v,current:v.value,fit:true});
 return {...c,knots,params:[c.params[0],...n,...k],variables,model};
}
export function correlations(c:any,rt:any) {
 const p=problem(c,rt),free=c.variables.map((v:any,i:number)=>({v,i})).filter(({v,i}:any)=>{const u=(c.params[i]-v.min)/(v.max-v.min);return v.max>v.min&&u>1e-6&&u<1-1e-6;}),d=free.findIndex((x:any)=>x.v.id==='thickness');
 if(d<0)return {warning:'Thickness is fixed or on its boundary; no free thickness Jacobian column'};
 const J=centralDifferenceJacobian(free.map((x:any)=>x.v),free.map((x:any)=>c.params[x.i]),values=>{
  const all=[...c.params];free.forEach((x:any,j:number)=>all[x.i]=values[j]);return [...p.residual(all),...p.regularization(all)];
 },i=>i<2*c.points.length&&i%2===1);
 const meanW2=p.weights.reduce((s,w)=>s+w*w,0)/p.weights.length;
 const full=J.map((row,i)=>row.map(x=>x*(i<p.weights.length?p.weights[i]:Math.sqrt(meanW2))));
 const pairs=(matrix:number[][])=>{const norms=free.map((_:any,j:number)=>Math.hypot(...matrix.map(row=>row[j])));
  return free.map((x:any,j:number)=>({id:x.v.id,r:norms[d]*norms[j]>0?matrix.reduce((s,row)=>s+row[d]*row[j],0)/(norms[d]*norms[j]):null})).filter((x:any)=>x.id!=='thickness'&&x.r!==null).sort((a:any,b:any)=>Math.abs(b.r)-Math.abs(a.r)).slice(0,5);};
 const st=c.statistics,i=st.correlation.ids.indexOf('thickness');
 return {dataOnly:pairs(full.slice(0,p.weights.length)),dataAndRegularization:pairs(full),covariance:i<0?[]:st.correlation.ids.map((id:string,j:number)=>({id,r:st.correlation.matrix[i][j]})).filter((q:any)=>q.id!=='thickness'&&q.r!==null).sort((a:any,b:any)=>Math.abs(b.r)-Math.abs(a.r)).slice(0,5)};
}
