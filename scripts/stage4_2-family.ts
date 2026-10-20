import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {stage41Fixture,trueN,trueK,Scenario} from './stage4_1-fixture';
import {modelRegistry} from '../src/modelRegistry/registry';
import {optimizeBoundedLM,OptimizationVariable} from '../src/fitting/optimizer';
import {solveLeastSquaresSvd} from '../src/fitting/svd';
import {calculateSpectrum,calculatePoint} from '../src/solver/calculator';
import {computeResidualMetrics,circularDifferenceDeg,residualWeights} from '../src/fitting/residual';

// Fixed diagnostic search budget; not a change to Automatic and not a proof of a global family minimum.
const report:any={epsilonStarts:5,epsilonMaxIterations:160,jointMaxIterations:160,
  epsilonObjective:'mean squared (epsilon1,epsilon2), equal weights; no angular wrapping',
  jointObjective:'official interleaved degree residual and sigma weights',runs:[],errors:[]};
const wavelengths=Array.from({length:72},(_,i)=>190+10*i);
for(const scenario of ['absorbing','transparent','weak'] as Scenario[])
for(const modelId of ['gaussian','lorentz','tauc_lorentz','multi_oscillator'])
for(const count of [1,2,3]) {
  const startTime=performance.now();
  try{
    const {project,points}=stage41Fixture(scenario),model=modelRegistry.get(modelId)!;
    const truth=wavelengths.map(w=>({wavelength:w,n:trueN(w),k:trueK(scenario,w)}));
    let initialization:any;
    const templates=modelRegistry.initializePhysicalModelFromBSpline(modelId,truth,undefined,
      {maximum:count,onInitialization:v=>initialization=v});
    const mixed=modelId==='multi_oscillator';
    const amp=(j:number)=>mixed?`A${j}`:j===1?'A':`A${j}`;
    const center=(j:number)=>mixed?`E0${j}`:j===1?'E0':`E0${j}`;
    const width=(j:number)=>mixed?`w${j}`:(modelId==='gaussian'?'sigma':modelId==='lorentz'?'gamma':'C')+(j===1?'':j);
    const ids=['eps_inf',...(modelId==='tauc_lorentz'?['Eg']:[]),
      ...Array.from({length:count},(_,i)=>[amp(i+1),center(i+1),width(i+1)]).flat()];
    const defaultRecord=Object.fromEntries(Object.entries(templates).map(([id,p])=>[id,p.current]));
    for(let j=1;j<=3;j++)if(j>count)defaultRecord[amp(j)]=0;
    // Actual Multi-Oscillator default family: Gaussian, Gaussian, Lorentz. Eg1 is inactive.
    if(mixed)Object.assign(defaultRecord,{osc1_type_code:1,osc2_type_code:1,osc3_type_code:2});
    const clamp=(id:string,value:number)=>Math.max(templates[id].min,Math.min(templates[id].max,value));
    const vars=(record:Record<string,number>):OptimizationVariable[]=>ids.map(id=>({id,name:id,value:record[id],
      min:templates[id].min,max:templates[id].max}));
    const record=(values:number[])=>({...defaultRecord,...Object.fromEntries(ids.map((id,i)=>[id,values[i]]))});
    const epsilonResidual=(values:number[])=>{
      const p=record(values);
      return truth.flatMap(q=>{const e=model.calculateEpsilon(q.wavelength,p);
        return [e.eps1-(q.n*q.n-q.k*q.k),e.eps2-2*q.n*q.k];});
    };
    const starts:any[]=[];
    for(let si=0;si<report.epsilonStarts;si++){
      const seed={...defaultRecord};
      if(si>0){
        for(let j=1;j<=count;j++){
          seed[center(j)]=clamp(center(j),si===1?2.5+j:([0,0,7.4,10,13.2][si]+(j-1)*.7));
          seed[width(j)]=clamp(width(j),si===1?.7:.4+.25*j);
        }
        if(modelId==='tauc_lorentz')seed.Eg=clamp('Eg',si===1?1.0:2.0);
      }
      // Linear amplitude/background initialization at each fixed line shape; same model epsilon functions.
      const zero:Record<string,number>={...seed,eps_inf:1};
      for(let j=1;j<=3;j++)zero[amp(j)]=0;
      const design:number[][]=[],target:number[]=[];
      for(const q of truth){
        const base=model.calculateEpsilon(q.wavelength,zero);
        const units=Array.from({length:count},(_,j)=>model.calculateEpsilon(q.wavelength,{...zero,[amp(j+1)]:1}));
        design.push([1,...units.map(e=>e.eps1-base.eps1)],[0,...units.map(e=>e.eps2-base.eps2)]);
        target.push(q.n*q.n-q.k*q.k-base.eps1,2*q.n*q.k-base.eps2);
      }
      const linear=solveLeastSquaresSvd(design,target).solution;
      seed.eps_inf=clamp('eps_inf',1+linear[0]);
      for(let j=1;j<=count;j++)seed[amp(j)]=clamp(amp(j),Math.max(.02,linear[j]));
      const variables=vars(seed);
      const result=await optimizeBoundedLM(variables,epsilonResidual,{maxIterations:report.epsilonMaxIterations,isAngularResidual:()=>false});
      starts.push({index:si,initial:seed,variables,result,epsilonMse:result.finalRawMse,parameters:record(result.finalParams)});
    }
    starts.sort((a,b)=>a.epsilonMse-b.epsilonMse);
    const best=starts[0],layers=structuredClone(project.layers);
    // The fixture is a single film; retain its original layer identity, bounds and substrate.
    assert.equal(layers.length,1);
    const film=layers[0];film.modelId=modelId;film.thickness=100;film.parameters=structuredClone(templates);
    for(const [key,value] of Object.entries(best.parameters)){
      if(film.parameters[key])film.parameters[key].current=value as number;
      else film.parameters[key]={id:key,name:key,current:value as number,initial:value as number,min:value as number,max:value as number,fit:false,unit:''};
    }
    const jointVars=[{id:'thickness',name:'thickness',value:100,min:project.layers[0].thicknessMin,max:project.layers[0].thicknessMax},
      ...vars(best.parameters)];
    const metrics=()=>computeResidualMetrics(calculateSpectrum(project.ambient,layers,project.substrate,points),
      project.fittingConfig.fitWeighting,project.fittingConfig.psiWeight,project.fittingConfig.deltaWeight,jointVars.length);
    const forward=metrics();
    const residual=(p:number[])=>{
      film.thickness=p[0];ids.forEach((id,i)=>film.parameters[id].current=p[i+1]);
      return points.flatMap(q=>{const c=calculatePoint(project.ambient,layers,project.substrate,q.wavelength,q.aoi);
        return [c.psiDeg-q.psiExp,circularDifferenceDeg(c.deltaDeg,q.deltaExp)];});
    };
    const optimized=await optimizeBoundedLM(jointVars,residual,{
      maxIterations:report.jointMaxIterations,residualWeights:residualWeights(points,project.fittingConfig).weights});
    residual(optimized.finalParams);
    const final=metrics();
    const entry={scenario,modelId,count,initialization,elapsedMs:performance.now()-startTime,starts,
      bestEpsilonMse:best.epsilonMse,forwardAtTruthThickness:forward,joint:{optimization:optimized,metrics:final,
        thickness:film.thickness,parameters:Object.fromEntries(Object.entries(film.parameters).map(([id,p])=>[id,p.current]))}};
    assert.ok(Number.isFinite(final.mseWoollam));
    report.runs.push(entry);
    console.log('STAGE4_2_FAMILY '+JSON.stringify({scenario,modelId,count,epsilonMse:best.epsilonMse,
      forwardMseW:forward.mseWoollam,jointMseW:final.mseWoollam,thickness:film.thickness,status:optimized.status,elapsedMs:entry.elapsedMs}));
  }catch(e){const error={scenario,modelId,count,error:String(e instanceof Error?e.stack:e)};report.errors.push(error);console.error(error);process.exitCode=1;}
  writeFileSync('stage4_2-family.json',JSON.stringify(report,null,2));
}
