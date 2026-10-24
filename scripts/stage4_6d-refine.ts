// Diagnostic copy of freeFormRefine.ts at 522131a; custom grid/strength, wide seed projection and uncapped metrics; optimizer/statistics unchanged.
import type {Ambient,Layer,Substrate,EllipsometryDataPoint,FittingConfig,ParameterValue} from '../src/types/ellipsometry';
import {modelRegistry} from '../src/modelRegistry/registry';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {evaluateLayerOpticalConstants,evaluateSubstrateOpticalConstants} from '../src/solver/calculator';
import {cubicBasis} from '../src/models/cubicSpline';
import {solveLeastSquaresSvd} from '../src/fitting/svd';
import {optimizeBoundedLM,OptimizationVariable,OptimizerOptions} from '../src/fitting/optimizer';
import {computeFitStatistics} from '../src/fitting/statistics';
import {freeFormCurve} from '../src/fitting/freeFormOptics';
import {residualWeights,circularDifferenceDeg,computeResidualMetrics} from '../src/fitting/residual';
import {FIT_NUMERICS} from '../src/fitting/numerics';
import {effectiveSplineParameters} from '../src/fitting/splineRefinement';

/** Physical curves are only the initial guess. No penalty attracts the solution to those curves. */
export async function refineDiagnostic(setting:{count:number;distribution:string;scale:number}, options:{ambient:Ambient;layers:Layer[];substrate:Substrate;primaryLayerIndex:number;
 points:EllipsometryDataPoint[];config:FittingConfig;outputWavelengths?:number[];shouldStop?:()=>boolean;onIteration?:OptimizerOptions['onIteration']}) {
 const start=performance.now(),{ambient,substrate,primaryLayerIndex,points,config}=options;
 if(!points.length||!options.layers[primaryLayerIndex])throw new Error('Free-form refinement requires measured data and a film');
 if(options.shouldStop?.())throw new Error('使用者中止擬合');
 const wavelengths=[...new Set(points.map(p=>p.wavelength))].sort((a,b)=>a-b),lo=wavelengths[0],hi=wavelengths.at(-1)!;
 if(!(hi>lo))throw new Error('Free-form refinement requires a wavelength interval');
 const count=setting.count,lambdaN=.25*setting.scale,lambdaK=.6*setting.scale,knots=Array.from({length:count},(_,i)=>setting.distribution==='wavelength'?lo+(hi-lo)*i/(count-1):1/(1/lo+(1/hi-1/lo)*i/(count-1)));
 const layers=structuredClone(options.layers),layer=layers[primaryLayerIndex],model=modelRegistry.get(layer.modelId)!;
 const physicalParams=Object.fromEntries(Object.entries(layer.parameters).map(([k,v])=>[k,v.current]));
 const seed=wavelengths.map(w=>model.calculate(w,physicalParams)),basis=wavelengths.map(w=>cubicBasis(w,knots));
 if(seed.some(q=>![q.n,q.k].every(Number.isFinite)))throw new Error('Physical seed contains non-finite optical constants');
 // Zero equations leave the least-squares problem unchanged and permit m<n with the existing SVD.
 const padding=Array.from({length:Math.max(0,count-basis.length)},()=>Array(count).fill(0)),projection=[...basis,...padding];
 const n=solveLeastSquaresSvd(projection,[...seed.map(q=>q.n),...padding.map(()=>0)]).solution,k=solveLeastSquaresSvd(projection,[...seed.map(q=>q.k),...padding.map(()=>0)]).solution;
 const variables:OptimizationVariable[]=[{id:'thickness',name:'thickness',value:layer.thickness,min:40,max:200},
  ...n.map((value,i)=>({id:'N'+i,name:'N'+i,value:Math.max(.5,Math.min(5.5,value)),min:.5,max:5.5})),
  ...k.map((value,i)=>({id:'K'+i,name:'K'+i,value:Math.max(0,Math.min(3.5,value)),min:0,max:3.5}))];
 const ambientN=new Complex(ambient.n,ambient.k);
 const groups=wavelengths.map((w,j)=>({w,base:layers.map(l=>({thicknessNm:l.thickness,N:evaluateLayerOpticalConstants(l,w)})),
  substrate:evaluateSubstrateOpticalConstants(substrate,w),basis:basis[j],points:points.filter(p=>p.wavelength===w)}));
 const orderedPoints=groups.flatMap(g=>g.points),weighting=residualWeights(orderedPoints,config);
 const residual=(p:number[])=>groups.flatMap(g=>{
  const nv=g.basis.reduce((s,b,i)=>s+b*p[i+1],0),kv=g.basis.reduce((s,b,i)=>s+b*p[count+i+1],0);
  const states=g.base.map((state,i)=>i===primaryLayerIndex?{thicknessNm:p[0],N:new Complex(nv,kv)}:state);
  return g.points.flatMap(pt=>{const c=solveEllipsometryTMM(ambientN,states,g.substrate,g.w,pt.aoi);return[c.psiDeg-pt.psiExp,circularDifferenceDeg(c.deltaDeg,pt.deltaExp)];});
 });
 const regularization=(p:number[])=>{
  const rows:number[]=[],m=2*points.length;
  for(let i=1;i<count-1;i++)rows.push(Math.sqrt(m*lambdaN)*(p[i+2]-2*p[i+1]+p[i]));
  for(let i=1;i<count-1;i++)rows.push(Math.sqrt(m*lambdaK)*(p[count+i+2]-2*p[count+i+1]+p[count+i]));
  return rows;
 };
 const initial=variables.map(v=>Math.max(v.min,Math.min(v.max,v.value))),initialResidual=residual(initial);
 const initialMetrics=computeResidualMetrics(orderedPoints.map((pt,i)=>({...pt,psiCalc:pt.psiExp+initialResidual[2*i],deltaCalc:pt.deltaExp+initialResidual[2*i+1]})),
  config.fitWeighting,config.psiWeight,config.deltaWeight,effectiveSplineParameters(variables,initial));
 const result=await optimizeBoundedLM(variables,residual,{maxIterations:100,tolerance:1e-5,residualWeights:weighting.weights,
  regularizationResidualsFn:regularization,shouldStop:options.shouldStop,onIteration:options.onIteration});
 if(result.stopped||options.shouldStop?.())throw new Error('使用者中止擬合');
 const statistics=computeFitStatistics(variables.map(v=>({...v,splineCoefficient:/^[NK]\d+$/.test(v.id)})),result.finalParams,residual,
  {weights:weighting.weights,regularizationResidualsFn:regularization});
 const parameter=(id:string,value:number,min:number,max:number,fit=false):ParameterValue=>({id,name:id,unit:'',current:value,initial:value,min,max,fit});
 layer.modelId='bspline';layer.thickness=result.finalParams[0];layer.thicknessMin=40;layer.thicknessMax=200;
 layer.thicknessFit=true;layer.thicknessInitial=variables[0].value;
 layer.parameters={_knotCount:parameter('_knotCount',count,4,Math.max(40,count))};
 knots.forEach((w,i)=>layer.parameters['_knot'+i]=parameter('_knot'+i,w,lo,hi));
 variables.slice(1).forEach((v,i)=>layer.parameters[v.id]=parameter(v.id,result.finalParams[i+1],v.min,v.max,true));
 const curve=freeFormCurve(options.outputWavelengths??wavelengths,knots,result.finalParams.slice(1,count+1),result.finalParams.slice(count+1),statistics,weighting.mode);
 // Production registry clamps bspline to 40; use the identical residual forward path for the diagnostic grid.
 const finalResidual=residual(result.finalParams);
 const evaluated=orderedPoints.map((pt,i)=>({...pt,psiCalc:pt.psiExp+finalResidual[2*i],deltaCalc:pt.deltaExp+finalResidual[2*i+1]}));
 const metrics=computeResidualMetrics(evaluated,config.fitWeighting,config.psiWeight,config.deltaWeight,statistics.covariance.ids.length);
 const coefficientBounds=variables.filter(v=>v.id.startsWith('K')).map((v,i)=>{const value=result.finalParams[count+i+1],u=(value-v.min)/(v.max-v.min);return{id:v.id,value,min:v.min,max:v.max,boundaryHit:u<=FIT_NUMERICS.boundaryEpsilon||u>=1-FIT_NUMERICS.boundaryEpsilon};});
 return {knots,curve,statistics,metrics,initialMetrics,result,coefficientBounds,elapsedMs:performance.now()-start,
  model:{primaryLayerIndex,layers,variables:variables.map((v,i)=>({...v,value:result.finalParams[i]})),lambdaN,lambdaK}};
}
