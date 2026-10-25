import type {Ambient,Layer,Substrate,EllipsometryDataPoint,FittingConfig,ParameterValue} from '../types/ellipsometry';
import {modelRegistry} from '../modelRegistry/registry';
import {Complex} from '../optics/complex';
import {solveEllipsometryTMM} from '../solver/transferMatrix';
import {evaluateLayerOpticalConstants,evaluateSubstrateOpticalConstants,calculateSpectrum} from '../solver/calculator';
import {cubicBasis} from '../models/cubicSpline';
import {solveLeastSquaresSvd} from './svd';
import {optimizeBoundedLM,OptimizationVariable,OptimizerOptions} from './optimizer';
import {computeFitStatistics} from './statistics';
import {freeFormCurve} from './freeFormOptics';
import {residualWeights,circularDifferenceDeg,computeResidualMetrics} from './residual';
import {FIT_NUMERICS} from './numerics';
import {effectiveSplineParameters} from './splineRefinement';

export type FreeFormOrigin='ladder'|'physical_seeded'|'ladder_v2';
export interface FreeFormRefinement {
 origin?:FreeFormOrigin;skipped?:boolean;warning?:string;
 ladderV2?:import('./freeFormLadder').LadderSelection;
 selectedSetting?:{count:number;scale:number};
 comparisonScores?:{ladder:number|null;physical_seeded:number|null;ladder_v2:number|null};
 ladder?:{mseWoollam:number;rawMse:number};
 physicalSeeded?:{mseWoollam:number;rawMse:number;thickness:number;converged:boolean;status:string;iterations:number;elapsedMs:number};
}
/** Compare full measured-data scores; a relative tie deliberately selects the refined result. */
export function chooseFreeFormOrigin(ladder:number,refined:number):FreeFormOrigin {
 if(!Number.isFinite(refined))return 'ladder';
 return refined<=ladder||Math.abs(ladder-refined)<=1e-6*Math.max(Math.abs(ladder),Math.abs(refined),Number.MIN_VALUE)?'physical_seeded':'ladder';
}

/** Physical curves are only the initial guess. No penalty attracts the solution to those curves. */
export async function refineFreeForm(options:{ambient:Ambient;layers:Layer[];substrate:Substrate;primaryLayerIndex:number;
 points:EllipsometryDataPoint[];config:FittingConfig;outputWavelengths?:number[];shouldStop?:()=>boolean;onIteration?:OptimizerOptions['onIteration'];
 ladderSetting?:{count:number;scale:number}}) {
 const start=performance.now(),{ambient,substrate,primaryLayerIndex,points,config}=options;
 if(!points.length||!options.layers[primaryLayerIndex])throw new Error('Free-form refinement requires measured data and a film');
 if(options.shouldStop?.())throw new Error('使用者中止擬合');
 const wavelengths=[...new Set(points.map(p=>p.wavelength))].sort((a,b)=>a-b),lo=wavelengths[0],hi=wavelengths.at(-1)!;
 if(!(hi>lo))throw new Error('Free-form refinement requires a wavelength interval');
 const count=options.ladderSetting?.count??40,scale=options.ladderSetting?.scale??1;
 if(!Number.isInteger(count)||count<4||count>80||![1,.1,.01].includes(scale))throw new Error('Invalid free-form ladder setting');
 const lambdaN=.25*scale,lambdaK=.6*scale,knots=Array.from({length:count},(_,i)=>lo+(hi-lo)*i/(count-1));
 const layers=structuredClone(options.layers),layer=layers[primaryLayerIndex],model=modelRegistry.get(layer.modelId)!;
 const physicalParams=Object.fromEntries(Object.entries(layer.parameters).map(([k,v])=>[k,v.current]));
 const seed=wavelengths.map(w=>model.calculate(w,physicalParams)),basis=wavelengths.map(w=>cubicBasis(w,knots));
 if(seed.some(q=>![q.n,q.k].every(Number.isFinite)))throw new Error('Physical seed contains non-finite optical constants');
 // Zero equations preserve the diagnostic's wide least-squares projection; legacy callers stay unchanged.
 const padding=options.ladderSetting?Array.from({length:Math.max(0,count-basis.length)},()=>Array(count).fill(0)):[];
 const projection=[...basis,...padding];
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
 layer.parameters={_knotCount:parameter('_knotCount',count,4,options.ladderSetting?80:40)};
 if(options.ladderSetting)layer.parameters._freeFormLadderV2=parameter('_freeFormLadderV2',1,1,1);
 knots.forEach((w,i)=>layer.parameters['_knot'+i]=parameter('_knot'+i,w,lo,hi));
 variables.slice(1).forEach((v,i)=>layer.parameters[v.id]=parameter(v.id,result.finalParams[i+1],v.min,v.max,true));
 const curve=freeFormCurve(options.outputWavelengths??wavelengths,knots,result.finalParams.slice(1,count+1),result.finalParams.slice(count+1),statistics,weighting.mode);
 const evaluated=calculateSpectrum(ambient,layers,substrate,points);
 const metrics=computeResidualMetrics(evaluated,config.fitWeighting,config.psiWeight,config.deltaWeight,statistics.covariance.ids.length);
 const coefficientBounds=variables.filter(v=>v.id.startsWith('K')).map((v,i)=>{const value=result.finalParams[count+i+1],u=(value-v.min)/(v.max-v.min);return{id:v.id,value,min:v.min,max:v.max,boundaryHit:u<=FIT_NUMERICS.boundaryEpsilon||u>=1-FIT_NUMERICS.boundaryEpsilon};});
 return {curve,statistics,metrics,initialMetrics,result,coefficientBounds,elapsedMs:performance.now()-start,
  model:{primaryLayerIndex,layers,variables:variables.map((v,i)=>({...v,value:result.finalParams[i]})),lambdaN,lambdaK}};
}
