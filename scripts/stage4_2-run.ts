import {writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {instrument} from './stage4_2-instrumentation';
import {stage41Fixture,trueN,trueK,Scenario} from './stage4_1-fixture';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {centralDifferenceJacobian} from '../src/fitting/optimizer';
import {circularDifferenceDeg,residualWeights} from '../src/fitting/residual';
import {calculatePoint} from '../src/solver/calculator';
import {modelRegistry} from '../src/modelRegistry/registry';
import {evaluateAdaptiveSpline} from '../src/models/bspline';

const mode=process.argv[2]??'baseline';
const module=await instrument(),trace=module.diagnostic;
const originalSpline=modelRegistry.get('bspline')!;
const extended=await import(pathToFileURL(resolve('.qa/stage42-bspline.ts')).href);
const report:any={mode,base:'5d73894ce3faae3d6988eb75818abce1057206e5',runs:[],errors:[]};
function save(){writeFileSync(`stage4_2-${mode}.json`,JSON.stringify(report,null,2));}
function sanitize(value:any):any {
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([k])=>!['elapsedMs','executionTimeMs','timestamp','id','createdAt','updatedAt','totalTimeMs','durationMs'].includes(k))
    .map(([k,v])=>[k,sanitize(v)]));
  return value;
}
function finalGradient(s:any,context:any) {
  const {ambient,substrate,points,config,primaryLayerIndex}=context,layers=structuredClone(s.layers);
  const vars=s.variables,params=s.optimization.finalParams,count=s.knots.length,m=2*points.length;
  const weights=residualWeights(points,config).weights,meanW2=weights.reduce((a,w)=>a+w*w,0)/m;
  const f=(p:number[])=>{
    layers[primaryLayerIndex].thickness=p[0];
    vars.slice(1).forEach((v:any,i:number)=>layers[primaryLayerIndex].parameters[v.id].current=p[i+1]);
    const r=points.flatMap((q:any)=>{const c=calculatePoint(ambient,layers,substrate,q.wavelength,q.aoi);
      return [c.psiDeg-q.psiExp,circularDifferenceDeg(c.deltaDeg,q.deltaExp)];});
    for(const [offset,lambda] of [[1,s.lambdaN],[1+count,s.lambdaK]])
      for(let j=1;j<count-1;j++)r.push(Math.sqrt(m*lambda)*(p[offset+j+1]-2*p[offset+j]+p[offset+j-1]));
    return r;
  };
  const r=f(params),w=[...weights,...r.slice(m).map(()=>Math.sqrt(meanW2))];
  const J=centralDifferenceJacobian(vars,params,f,i=>i<m&&i%2===1);
  const g=vars.map((v:any,j:number)=>J.reduce((sum,row,i)=>sum+row[j]*r[i]*w[i]**2,0)/m);
  const projected=g.map((g:number,j:number)=>{
    const u=(params[j]-vars[j].min)/(vars[j].max-vars[j].min);
    return u<=1e-8&&g>0||u>=1-1e-8&&g<0?0:g;
  });
  const nPenalty=r.slice(m,m+count-2).reduce((sum:number,x:number)=>sum+x*x,0)/m*meanW2;
  const kPenalty=r.slice(m+count-2).reduce((sum:number,x:number)=>sum+x*x,0)/m*meanW2;
  assert.ok(Math.abs(nPenalty+kPenalty-s.optimization.finalRegularizationPenalty)<1e-9);
  return {projectedGradientInfinityNorm:Math.max(...projected.map(Math.abs)),
    unprojectedGradientInfinityNorm:Math.max(...g.map(Math.abs)),dataCost:s.metrics.weightedMse,nPenalty,kPenalty,
    nToData:nPenalty/s.metrics.weightedMse,kToData:kPenalty/s.metrics.weightedMse};
}
function enrich(s:any,scenario:Scenario) {
  const c=s.knots.length,p=s.optimization.finalParams,initial=s.variables.map((v:any)=>v.value);
  const curve=(v:number[])=>[300,400,500,600,700,800,900].map(w=>{
    const n=evaluateAdaptiveSpline(w,s.knots,v.slice(1,1+c)),k=evaluateAdaptiveSpline(w,s.knots,v.slice(1+c));
    return {wavelength:w,n,k,trueN:trueN(w),trueK:trueK(scenario,w),nBias:n-trueN(w),kBias:k-trueK(scenario,w)};
  });
  return {...s,finalDiagnostics:finalGradient(s,trace.context),thickness:p[0],thicknessShift:p[0]-initial[0],
    curve:curve(p),initialCurve:curve(initial)};
}
for(const scenario of ['absorbing','transparent','weak'] as Scenario[]) {
  const variants=mode==='baseline'?[{}]:[
    {name:'truth',truth:true},{name:'tight',tight:true},
    ...[24,32,40].map(knots=>({name:`knots${knots}`,knots})),
    ...[.1,10].flatMap(scale=>[{name:`lambdaN_${scale}`,nScale:scale},{name:`lambdaK_${scale}`,kScale:scale}])
  ];
  for(const variant of variants)try {
    Object.assign(trace,{options:{...variant,scenario,stopAfterSpline:mode!=='baseline'},stages:[],starts:[],calls:[],candidates:[]});
    modelRegistry.register((variant as any).knots?extended.BSplineModel:originalSpline);
    const {project,points}=stage41Fixture(scenario),args={ambient:project.ambient,layers:project.layers,substrate:project.substrate,
      points,config:project.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]};
    const start=performance.now(),out=await module.runAutomatedEllipsometryFit(structuredClone(args));
    const elapsedMs=performance.now()-start;
    let bitIdentical:any=null;
    if(mode==='baseline'){
      const official=await runAutomatedEllipsometryFit(structuredClone(args));
      // Numerical outputs only: timing, generated identifiers and human progress messages are not numerical evidence.
      const select=(r:any)=>({layers:r.updatedLayers,points:r.updatedPoints,thickness:r.finalThickness,
        optical:r.finalOpticalConstants,free:r.fittingResult.freeFormOpticalConstants,
        freeStatistics:r.fittingResult.freeFormStatistics,statistics:r.fittingResult.statistics,
        mse:r.fittingResult.mse,mseW:r.fittingResult.mseWoollam,pipeline:r.pipelineData});
      assert.deepEqual(sanitize(select(out)),sanitize(select(official)));
      bitIdentical=true;
    }
    const entry={scenario,variant,elapsedMs,bitIdentical,stages:trace.stages.map((s:any)=>enrich(s,scenario)),
      cauchy:trace.cauchy,starts:trace.starts,candidates:trace.candidates,selection:trace.selection,
      calls:trace.calls,free:trace.free,final:mode==='baseline'?{
        thickness:out.finalThickness,result:out.fittingResult,modelComparisons:out.modelComparisons,workflowLog:out.workflowLog}:undefined};
    report.runs.push(entry);
    console.log('STAGE4_2_RUN '+JSON.stringify({scenario,variant,elapsedMs,bitIdentical,
      stages:entry.stages.map((s:any)=>({knots:s.knots.length,status:s.optimization.status,iterations:s.optimization.iterations,
        mseW:s.metrics.mseWoollam,thickness:s.thickness,stopReason:s.stopReason,gradient:s.finalDiagnostics.projectedGradientInfinityNorm}))}));
    save();
  }catch(error){report.errors.push({scenario,variant,error:String(error instanceof Error?error.stack:error)});console.error(report.errors.at(-1));save();process.exitCode=1;}
}
modelRegistry.register(originalSpline);
