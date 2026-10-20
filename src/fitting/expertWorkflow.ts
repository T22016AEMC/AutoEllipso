import {assessFitAdequacy} from './freeFormOptics';
import {createKkBsplineModel,fitKkEpsilon2,kkSplineGrid} from '../models/kkBspline';
import type {PeakInitialization} from '../models/peakInitialization';
import { computeFitStatistics, isSplineCoefficient } from './statistics';
import { EllipsometryProject, Layer, ParameterValue, EllipsometryDataPoint } from '../types/ellipsometry';
import { modelRegistry } from '../modelRegistry/registry';
import { calculatePoint, calculateSpectrum } from '../solver/calculator';
import { circularDifferenceDeg, computeMultiAoiResidualMetrics, residualWeights } from './residual';
import { ConvergenceStatus } from './numerics';
import { optimizeBoundedLM, OptimizationVariable } from './optimizer';
import { cubicBasis, cubicEvaluate } from '../models/cubicSpline';
import { generateAdaptiveKnots, computeBsplineSmoothness } from '../models/bspline';
import { peakTypes } from '../models/expertMixed';
import {validateTaucLorentzParameters} from '../models/taucLorentz';

export const stageNames = ['Data / AOI / Substrate Validation','Cauchy Initialization','B-spline / Peak Editor','Physical Oscillator Model Fitting','Global + Local Joint Optimization','Final Forward Verification'];
export type Snapshot = Omit<EllipsometryProject,'expert'>;
export interface ExpertCandidate { id:string; name:string; stage:number; snapshot:Snapshot }
export interface ExpertSession {
  initialization?:PeakInitialization;
  stage:number; smoothing:number; candidates:ExpertCandidate[];
  records:{stage:number; rawMse:number; message:string; at:string}[];
  manualSource?:Snapshot;
}
export const clone = <T,>(value:T):T => JSON.parse(JSON.stringify(value));
export function snapshot(project:EllipsometryProject):Snapshot { const {expert,...rest}=project; return clone(rest); }
export function session(project:EllipsometryProject):ExpertSession {
  return project.expert??{stage:0,smoothing:0.01,candidates:[],records:[]};
}
export function parameter(id:string,current:number,min:number,max:number,fit=true):ParameterValue {
  return {id,name:id,unit:'',current,initial:current,min,max,fit,fitSupported:true};
}
export function values(layer:Layer):Record<string,number> {return Object.fromEntries(Object.entries(layer.parameters).map(([k,p])=>[k,p.current]));}
export function splineGrid(layer:Layer):number[] {
  const p=values(layer),count=p._knotCount??8;
  if(p._knot0===undefined)return generateAdaptiveKnots(190,900,count);
  return Array.from({length:count},(_,i)=>p[`_knot${i}`]);
}
export function activePoints(project:EllipsometryProject,fullSpectrum=false):EllipsometryDataPoint[] {
  const points=project.experimentData?.points??[],config=project.fittingConfig;
  const aois=config.activeFitAois;
  return points.filter(p=>(!aois?.length||aois.includes(p.aoi)) && (fullSpectrum ||
    (p.wavelength>=(config.fitWavelengthMin??-Infinity)&&p.wavelength<=(config.fitWavelengthMax??Infinity))));
}
export function validateExpert(project:EllipsometryProject):void {
  if(!project.layers.length) throw new Error('At least one film is required');
  const points=project.experimentData?.points??[];
  if(!points.length || !activePoints(project).length) throw new Error('No experimental points in selected AOI / wavelength range');
  if(project.fittingConfig.activeFitAois?.some(a=>!points.some(p=>p.aoi===a))) throw new Error('Selected AOI is missing experimental data');
  for(const p of points) if(![p.wavelength,p.aoi,p.psiExp,p.deltaExp].every(Number.isFinite)||p.wavelength<=0||p.aoi<0||p.aoi>=90||p.psiExp<0||p.psiExp>90) throw new Error('Invalid experimental data');
  if(![project.ambient.n,project.ambient.k].every(Number.isFinite)||project.ambient.n<=0||project.ambient.k<0) throw new Error('Invalid ambient');
  for(const l of project.layers) {
    validateTaucLorentzParameters(l.modelId,values(l));
    if(l.modelId==='kk_bspline'){
      const p=values(l),grid=kkSplineGrid(p);
      if(p._uvE0<1.5*grid.at(-1)!||(p._irEnabled&&p._irE0>=grid[0]))throw new Error('KK poles must lie outside the spline range (UV ≥ 1.5 Emax)');
    }
    if(!modelRegistry.has(l.modelId)) throw new Error('Unknown film model: '+l.modelId);
    if(![l.thickness,l.thicknessMin,l.thicknessMax].every(Number.isFinite)||l.thickness<0||l.thicknessMin<0||l.thicknessMax<l.thicknessMin || (l.thicknessFit&&(l.thickness<l.thicknessMin||l.thickness>l.thicknessMax))) throw new Error('Invalid film thickness or bounds');
    if(l.modelId==='bspline'||l.modelId==='expert_mixed') {const grid=splineGrid(l);if(!Number.isInteger(l.parameters._knotCount?.current??8)||grid.length<4||grid.length>40)throw new Error('Invalid spline control count');cubicBasis(grid[0],grid);}
    if(l.modelId==='expert_mixed') {
      const count=l.parameters._peakCount?.current;
      if(!Number.isInteger(count)||count<0||count>32)throw new Error('Invalid peak count');
      for(let i=0;i<count;i++) {
        const type=l.parameters[`p${i}_type`]?.current,enabled=l.parameters[`p${i}_enabled`]?.current;
        if(!Number.isInteger(type)||type<0||type>4||![0,1].includes(enabled))throw new Error('Invalid peak type or enabled state');
        if(type!==4)for(const key of ['A','w',...(type===3?[]:['E0']),...(type===2?['Eg']:[])]) {
          const v=l.parameters[`p${i}_${key}`];
          if(!v || v.min<0 || ((key==='w'||key==='E0')&&(v.min<=0||v.current<=0)))throw new Error('Invalid physical peak bounds: '+key);
        }
      }
    }
  }
  if(!modelRegistry.has(project.substrate.modelId)) throw new Error('Unknown substrate model');
  for(const entity of [...project.layers,project.substrate]) for(const p of Object.values(entity.parameters)) {
    if(![p.current,p.min,p.max].every(Number.isFinite)||p.min>p.max||p.current<p.min||p.current>p.max) throw new Error('Invalid parameter bounds: '+p.id);
  }
}
export function freshForward(project:EllipsometryProject):EllipsometryProject {
  const p=clone(project); p.updatedAt=new Date().toISOString();p.fittingResult=null;
  if(p.experimentData) {
    p.experimentData.points=calculateSpectrum(p.ambient,p.layers,p.substrate,p.experimentData.points);
    if(p.experimentData.points.some(pt=>![pt.psiCalc,pt.deltaCalc].every(Number.isFinite))) throw new Error('Nonfinite TMM result');
  }
  return p;
}
/** Project the existing optical curve onto the cubic basis (not sample values as coefficients). */
export function projectSpline(grid:number[],fn:(w:number)=>number):number[] {
  const n=grid.length,A=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);
  for(let j=0;j<=120;j++) {
    const w=grid[0]+j/120*(grid[n-1]-grid[0]),basis=cubicBasis(w,grid),y=fn(w);
    for(let r=0;r<n;r++) { b[r]+=basis[r]*y;for(let c=0;c<n;c++) A[r][c]+=basis[r]*basis[c]; }
  }
  for(let i=0;i<n;i++) {
    let pivot=i;for(let j=i+1;j<n;j++) if(Math.abs(A[j][i])>Math.abs(A[pivot][i])) pivot=j;
    [A[i],A[pivot]]=[A[pivot],A[i]];[b[i],b[pivot]]=[b[pivot],b[i]];
    const d=A[i][i];if(Math.abs(d)<1e-12)throw new Error('Singular spline projection');
    for(let k=i;k<n;k++)A[i][k]/=d;b[i]/=d;
    for(let j=0;j<n;j++)if(j!==i){const f=A[j][i];for(let k=i;k<n;k++)A[j][k]-=f*A[i][k];b[j]-=f*b[i];}
  }
  return b;
}
export function initializeSpline(project:EllipsometryProject,index:number):EllipsometryProject {
  const p=clone(project),l=p.layers[index]; if(l.modelId==='bspline')return p;
  const old=modelRegistry.get(l.modelId)!;const params=values(l);
  const wavelengths=p.experimentData!.points.map(x=>x.wavelength);
  const grid=generateAdaptiveKnots(Math.min(...wavelengths),Math.max(...wavelengths),8);
  const n=projectSpline(grid,w=>old.calculate(w,params).n),k=projectSpline(grid,w=>old.calculate(w,params).k);
  l.modelId='bspline';l.parameters={_knotCount:parameter('_knotCount',grid.length,4,40,false)};
  grid.forEach((w,i)=>{l.parameters[`_knot${i}`]=parameter(`_knot${i}`,w,150,2500,false);
    l.parameters[`N${i}`]=parameter(`N${i}`,Math.max(0.001,n[i]),0.001,Math.max(10,n[i]*2));
    l.parameters[`K${i}`]=parameter(`K${i}`,Math.max(0,k[i]),0,Math.max(10,k[i]*2));});
  return p;
}
/** Initialize the optional KK epsilon2 model from the current optical curve, without changing stages. */
export function initializeKkSpline(project:EllipsometryProject,index:number):EllipsometryProject {
  const p=clone(project),layer=p.layers[index],source=modelRegistry.get(layer.modelId)!,old=values(layer);
  const wavelengths=[...new Set(activePoints(p,true).map(pt=>pt.wavelength))];
  const energies=wavelengths.map(w=>1239.841984/w),lo=Math.min(...energies),hi=Math.max(...energies);
  const params=modelRegistry.createParameterSet('kk_bspline');
  params._emin.current=lo;params._emax.current=hi;params._uvE0.current=1.5*hi;params._irE0.current=lo/2;
  const model=createKkBsplineModel();
  const record=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,v.current]));
  const fitted=fitKkEpsilon2(wavelengths.map(w=>{const o=source.calculate(w,old);return {energy:1239.841984/w,eps1:o.eps1??o.n*o.n-o.k*o.k,eps2:o.eps2??2*o.n*o.k};}),record,model);
  for(const [key,value] of Object.entries(fitted))if(params[key]){params[key].current=Math.max(params[key].min,Math.min(params[key].max,value));params[key].initial=params[key].current;}
  layer.modelId='kk_bspline';layer.parameters=params;return p;
}
export function changeSplineGrid(layer:Layer,grid:number[]):Layer {
  if(grid.length<4||grid.length>40)throw new Error('Control count exceeds model limit');
  cubicBasis(grid[0],grid);
  const l=clone(layer),oldGrid=splineGrid(l),old=values(l);
  const prefixes=l.modelId==='bspline'?['N','K']:[...Array.from({length:old._peakCount??0},(_,i)=>[`p${i}_R`,`p${i}_I`]).flat().filter(x=>old[x+'0']!==undefined),...(old.base_N0!==undefined?['base_N','base_K']:[])];
  if(prefixes.some(pre=>oldGrid.some((_,i)=>!l.parameters[pre+i]?.fit))) throw new Error('Unlock spline coefficients before changing control topology');
  for(const pre of prefixes){const coeff=oldGrid.map((_,i)=>old[pre+i]??0),next=projectSpline(grid,w=>cubicEvaluate(w,oldGrid,coeff));
    oldGrid.forEach((_,i)=>delete l.parameters[pre+i]);
    next.forEach((v,i)=>{const free=l.modelId==='expert_mixed'&&!pre.startsWith('base_'); const min=free?-50:pre.endsWith('N')?0.001:0;
      l.parameters[pre+i]=parameter(pre+i,Math.max(min,v),min,free?50:Math.max(10,v*2));});}
  oldGrid.forEach((_,i)=>delete l.parameters[`_knot${i}`]);
  l.parameters._knotCount=parameter('_knotCount',grid.length,4,40,false);
  grid.forEach((v,i)=>l.parameters[`_knot${i}`]=parameter(`_knot${i}`,v,150,2500,false));
  return l;
}
export function initializeMixed(project:EllipsometryProject,index:number,preserveNumerical=true):EllipsometryProject {
  const p=clone(project),l=p.layers[index];if(l.modelId==='expert_mixed')return p;
  const source=clone(l),keep=preserveNumerical&&source.modelId==='bspline';
  const wavelengths=p.experimentData!.points.map(x=>x.wavelength),grid=keep?splineGrid(source):generateAdaptiveKnots(Math.min(...wavelengths),Math.max(...wavelengths),8);
  const model=modelRegistry.get(l.modelId)!,opt=model.calculate((grid[0]+grid[grid.length-1])/2,values(l));
  p.expert={...session(p),manualSource:snapshot(p)};
  const offset=Math.max(0.01,opt.eps1??opt.n*opt.n);
  l.modelId='expert_mixed';l.parameters={eps_inf:parameter('eps_inf',offset,0.01,Math.max(50,offset*2)),_peakCount:parameter('_peakCount',0,0,32,false),_knotCount:parameter('_knotCount',grid.length,4,40,false)};
  grid.forEach((v,i)=>l.parameters[`_knot${i}`]=parameter(`_knot${i}`,v,150,2500,false));
  if(keep) {
    l.parameters._baseEnabled=parameter('_baseEnabled',1,0,1,false);
    l.parameters._baseRef=parameter('_baseRef',offset,-10000,10000,false);
    grid.forEach((_,i)=>['N','K'].forEach(pre=>{const id=`base_${pre}${i}`;l.parameters[id]={...source.parameters[pre+i],id,name:id};}));
  }
  return p;
}
export function addPeak(layer:Layer,type:number,copyIndex?:number):Layer {
  const l=clone(layer),count=l.parameters._peakCount.current;if(count>=32)throw new Error('Maximum 32 peaks');
  const pre=`p${count}_`;
  if(copyIndex!==undefined) for(const [key,p] of Object.entries(l.parameters)) if(key.startsWith(`p${copyIndex}_`)) {
    const id=key.replace(`p${copyIndex}_`,pre);l.parameters[id]={...p,id,name:id};
  } else {} // keep clone parameter metadata
  if(copyIndex===undefined) {
    l.parameters[pre+'type']=parameter(pre+'type',type,0,4,false);
    l.parameters[pre+'enabled']=parameter(pre+'enabled',1,0,1,false);
    if(type===4) splineGrid(l).forEach((_,i)=>['R','I'].forEach(s=>l.parameters[pre+s+i]=parameter(pre+s+i,0,-50,50)));
    else { l.parameters[pre+'A']=parameter(pre+'A',type===2?20:2,0,600);
      l.parameters[pre+'w']=parameter(pre+'w',0.5,0.01,10);
      if(type!==3) l.parameters[pre+'E0']=parameter(pre+'E0',3,0.1,15);
      if(type===2) l.parameters[pre+'Eg']=parameter(pre+'Eg',1,0,10); }
  }
  l.parameters._peakCount.current=count+1;return l;
}
export function deletePeak(layer:Layer,index:number):Layer {
  const l=clone(layer),params:Record<string,ParameterValue>={};
  for(const [key,p] of Object.entries(l.parameters)) {
    const match=key.match(/^p(\d+)_(.+)$/);if(!match){params[key]=p;continue;}
    const i=Number(match[1]);if(i===index)continue;
    const id=`p${i>index?i-1:i}_${match[2]}`;params[id]={...p,id,name:id};
  }
  l.parameters=params;l.parameters._peakCount.current--;return l;
}

export interface ExpertProgress {iteration:number;bestMse:number;currentMse:number;start:number;totalStarts:number}
interface Ref { kind:'thickness'|'layer'|'substrate';index:number;key:string }
function collect(p:EllipsometryProject):{vars:OptimizationVariable[];refs:Ref[]} {
  const vars:OptimizationVariable[]=[],refs:Ref[]=[];
  function add(id:string,value:number,min:number,max:number,ref:Ref) {if(max===min)return;vars.push({id,name:id,value,min,max});refs.push(ref);}
  p.layers.forEach((l,index)=>{
    if(l.thicknessFit)add(l.id+'.thickness',l.thickness,l.thicknessMin,l.thicknessMax,{kind:'thickness',index,key:''});
    for(const [key,v] of Object.entries(l.parameters)) if(v.fit&& !key.startsWith('_')) {
      if(l.modelId==='kk_bspline'&&key==='ir_A'&&!l.parameters._irEnabled?.current)continue;
      if(key.startsWith('base_')&&!l.parameters._baseEnabled?.current)continue;
      const peak=key.match(/^p(\d+)_/);if(peak&&!l.parameters[`p${peak[1]}_enabled`]?.current)continue;
      add(l.id+'.'+key,v.current,v.min,v.max,{kind:'layer',index,key});
    }
  });
  for(const [key,v] of Object.entries(p.substrate.parameters))if(v.fit)add('substrate.'+key,v.current,v.min,v.max,{kind:'substrate',index:0,key});
  return {vars,refs};
}
function apply(p:EllipsometryProject,refs:Ref[],vector:number[]):void {
  refs.forEach((r,i)=>{if(r.kind==='thickness')p.layers[r.index].thickness=vector[i];
    else if(r.kind==='layer')p.layers[r.index].parameters[r.key].current=vector[i];else p.substrate.parameters[r.key].current=vector[i];});
}
function residual(p:EllipsometryProject,points:EllipsometryDataPoint[]):number[] {
  return points.flatMap(pt=>{const c=calculatePoint(p.ambient,p.layers,p.substrate,pt.wavelength,pt.aoi);
    return [c.psiDeg-pt.psiExp,circularDifferenceDeg(c.deltaDeg,pt.deltaExp)];});
}
const mse=(r:number[])=>r.reduce((s,v)=>s+v*v,0)/r.length;

export async function fitExpert(project:EllipsometryProject,global=false,onProgress?:(v:ExpertProgress)=>void,shouldStop=()=>false):Promise<EllipsometryProject> {
  validateExpert(project);const p=clone(project),points=activePoints(p,true),{vars,refs}=collect(p),startTime=performance.now();
  const weights=residualWeights(points,p.fittingConfig).weights,meanW2=weights.reduce((s,w)=>s+w*w,0)/(2*points.length);
  const weighted=(r:number[])=>r.reduce((s,v,i)=>s+(weights[i]*v)**2,0)/(2*points.length);
  const woollam=(cost:number)=>Math.sqrt(cost*2*points.length/Math.max(1,2*points.length-vars.length));
  const initial=mse(residual(p,points));let best=vars.map(v=>v.value),bestMse=woollam(weighted(residual(p,points))),iterations=0,bestConverged=vars.length===0;
  let bestStatus:ConvergenceStatus=vars.length?'max_iter':'gradient';
  let starts:number[][]=[best];
  if(global && p.fittingConfig.enableMultiStart!==false) {
    // Real TMM grid across complete user thickness bounds. Retain diverse basins.
    const thicknessIndices=refs.map((r,i)=>r.kind==='thickness'?i:-1).filter(i=>i>=0);
    const coarse:{vector:number[];cost:number}[]=[];
    for(let s=0;s<64;s++) {
      if(shouldStop())break;
      const v=[...best];thicknessIndices.forEach((i,j)=>v[i]=vars[i].min+((s*(2*j+1))%64)/63*(vars[i].max-vars[i].min));
      apply(p,refs,v);let cost=Infinity;try{cost=weighted(residual(p,points));}catch{}
      coarse.push({vector:v,cost});
      if(s%8===0) {onProgress?.({iteration:0,currentMse:woollam(cost),bestMse,start:0,totalStarts:20});await new Promise(r=>setTimeout(r,0));}
    }
    starts.push(...coarse.sort((a,b)=>a.cost-b.cost).slice(0,9).map(x=>x.vector));
    for(let s=1;starts.length<20;s++) starts.push(best.map((v,i)=>Math.max(vars[i].min,Math.min(vars[i].max,v+Math.sin(s*12.9898+i*78.233)*0.12*(vars[i].max-vars[i].min)))));
  }
  const smoothing=session(p).smoothing;
  function reg(vector:number[]):number[] {
    apply(p,refs,vector);const r:number[]=[];
    for(const l of p.layers)if(l.modelId==='bspline'||l.modelId==='expert_mixed'||l.modelId==='kk_bspline') {
      if(l.modelId==='kk_bspline'){const c=kkSplineGrid(values(l)).map((_,i)=>l.parameters['c'+i].current);
        const smooth=computeBsplineSmoothness(c,[],smoothing,0);r.push(...smooth.secondDiffN.map(v=>v*Math.sqrt(smoothing*2*points.length)));continue;}
      const grid=splineGrid(l);
      const pairs=l.modelId==='bspline'?[['N','K']]:[...Array.from({length:l.parameters._peakCount.current},(_,i)=>i)
        .filter(i=>l.parameters[`p${i}_enabled`].current&&l.parameters[`p${i}_type`].current===4).map(i=>[`p${i}_R`,`p${i}_I`]),...(l.parameters._baseEnabled?.current?[['base_N','base_K']]:[])];
      for(const [a,b] of pairs) {
        const smooth=computeBsplineSmoothness(grid.map((_,i)=>l.parameters[a+i].current),grid.map((_,i)=>l.parameters[b+i].current),smoothing,smoothing);
        r.push(...[...smooth.secondDiffN,...smooth.secondDiffK].map(v=>v*Math.sqrt(smoothing*2*points.length)));
      }
    }
    return r;
  }
  const objective=(vector:number[])=>{apply(p,refs,vector);try{return weighted(residual(p,points))+reg(vector).reduce((s,x)=>s+x*x,0)/(2*points.length)*meanW2;}catch{return Infinity;}};
  let bestObjective=objective(best),validStarts=0,bestStartIndex=0;
  const initialObjective=bestObjective;
  for(let s=0;s<starts.length&&!shouldStop();s++) {
    if(!vars.length)break;
    if(!Number.isFinite(objective(starts[s])))continue;
    validStarts++;
    const out=await optimizeBoundedLM(vars.map((v,i)=>({...v,value:starts[s][i]})),vector=>{
      apply(p,refs,vector);try{return residual(p,points);}catch{return points.flatMap(()=>[1e6,1e6]);}
    },{maxIterations:p.fittingConfig.maxIterations,tolerance:p.fittingConfig.tolerance,initialLambda:p.fittingConfig.dampingFactor,
      residualWeights:weights,isAngularResidual:i=>i%2===1,regularizationResidualsFn:reg,shouldStop,
      onIteration:(i,_c,_prev,v)=>{apply(p,refs,v);const raw=woollam(weighted(residual(p,points)));bestMse=Math.min(bestMse,raw);
        onProgress?.({iteration:i,currentMse:raw,bestMse,start:s+1,totalStarts:starts.length});}});
    iterations+=out.iterations;const obj=objective(out.finalParams);
    if(obj<bestObjective || (obj===bestObjective&&out.converged)){bestObjective=obj;best=[...out.finalParams];bestStartIndex=s;bestConverged=out.converged;bestStatus=out.status;}
  }
  apply(p,refs,best);
  const final=freshForward(p),metrics=computeMultiAoiResidualMetrics(final.experimentData!.points,p.fittingConfig.activeFitAois,p.fittingConfig.fitWeighting,p.fittingConfig.psiWeight,p.fittingConfig.deltaWeight,vars.length);
  // Independent fresh full-spectrum pass, using exactly the saved best vector.
  const check=calculateSpectrum(final.ambient,final.layers,final.substrate,final.experimentData!.points);
  const verified=check.every((v,i)=>v.psiCalc===final.experimentData!.points[i].psiCalc&&v.deltaCalc===final.experimentData!.points[i].deltaCalc);
  if(!verified)throw new Error('Final forward verification failed');
  const statistics=shouldStop()?undefined:computeFitStatistics(vars.map((v,i)=>({...v,splineCoefficient:isSplineCoefficient(refs[i].key)||/^c\d+$/.test(refs[i].key)})),best,
    vector=>{apply(p,refs,vector);return residual(p,points);},{weights,regularizationResidualsFn:reg(best).length?reg:undefined});
  final.fittingResult={fitAdequacy:assessFitAdequacy(statistics,metrics.weightingMode).fitAdequacy,fitAdequacyWarning:assessFitAdequacy(statistics,metrics.weightingMode).warning,initialization:session(p).initialization??project.fittingResult?.initialization,statistics,mseWoollam:metrics.mseWoollam,reducedChiSquare:metrics.reducedChiSquare,chiSquare:metrics.chiSquare,dof:metrics.dof,
        weightingMode:metrics.weightingMode,weightingWarning:metrics.weightingWarning,
    convergenceStatus:shouldStop()?'cancelled':bestStatus,improved:bestObjective<initialObjective,converged:!shouldStop()&&bestConverged,numParameters:vars.length,perAoiMseWoollam:Object.fromEntries(Object.entries(metrics.perAoi).map(([a,m])=>[a,m.mseWoollam])),status:shouldStop()?'stopped':metrics.rawMse<10?'target_achieved':'target_not_achieved',iterations,
    initialMse:initial,finalMse:metrics.rawMse,initialRmse:Math.sqrt(initial),finalRmse:metrics.rawRmse,
    rawMse:metrics.rawMse,rawRmse:metrics.rawRmse,psiRmse:Math.sqrt(metrics.psiMse),deltaRmse:Math.sqrt(metrics.deltaMse),
    targetMse:10,targetAchieved:metrics.rawMse<10,freshCalculationVerified:verified,executionTimeMs:performance.now()-startTime,
    selectedAois:metrics.selectedAois,fittingMode:metrics.fittingMode,perAoiMse:Object.fromEntries(Object.entries(metrics.perAoi).map(([a,m])=>[a,m.mse])),
    multiStartSummary:{totalStarts:vars.length?starts.length:0,validStarts,bestStartIndex,bestRawMse:metrics.rawMse,bestMseWoollam:metrics.mseWoollam},
    parameters:refs.map((r,i)=>({layerId:r.kind==='substrate'?'substrate':p.layers[r.index].id,layerName:r.kind==='substrate'?'Substrate':p.layers[r.index].name,
      paramId:r.key||'thickness',paramName:vars[i].name,initialValue:vars[i].value,finalValue:best[i],min:vars[i].min,max:vars[i].max,unit:'',fitted:true})),
    message:'Expert fit; full spectrum fresh TMM verified. Raw MSE is unweighted degrees squared.'};
  return final;
}
export async function preparePhysical(project:EllipsometryProject,index:number):Promise<EllipsometryProject> {
  if(['expert_mixed','kk_bspline'].includes(project.layers[index].modelId))return clone(project);
  // Project the manual source through TMM at measured wavelengths/AOIs, in degrees.
  const points=activePoints(project,true).map(pt=>{
    const c=calculatePoint(project.ambient,project.layers,project.substrate,pt.wavelength,pt.aoi);
    return {...pt,psiExp:c.psiDeg,deltaExp:c.deltaDeg};
  });
  const source=modelRegistry.get(project.layers[index].modelId)!;
  const wavelengths=[...new Set(points.map(pt=>pt.wavelength))];
  const spectrum=wavelengths.map(wavelength=>({wavelength,...source.calculate(wavelength,values(project.layers[index]))}));
  let initialization:PeakInitialization|undefined;
  const seed=modelRegistry.initializePhysicalModelFromBSpline('gaussian',spectrum,undefined,{maximum:project.fittingConfig.maxOscillators??4,onInitialization:v=>initialization=v});
  let p=initializeMixed(project,index,false);
  const keys=['eps_inf'];
  for(let i=0;i<(initialization?.oscillatorsUsed??1);i++) {
    p.layers[index]=addPeak(p.layers[index],0);const suffix=i===0?'':String(i+1);
    for(const [key,sourceKey] of [['A','A'+suffix],['E0','E0'+suffix],['w','sigma'+suffix]]) {
      p.layers[index].parameters[`p${i}_${key}`].current=seed[sourceKey].current;
      keys.push(`p${i}_${key}`);
    }
  }
  const l=p.layers[index];l.parameters.eps_inf.current=seed.eps_inf.current;
  p.expert={...session(p),initialization};
  const out=await optimizeBoundedLM(keys.map(key=>{const v=l.parameters[key];return {id:key,name:key,value:v.current,min:v.min,max:v.max};}),vec=>{
    keys.forEach((key,i)=>l.parameters[key].current=vec[i]);return residual(p,points);
  },{maxIterations:60,residualWeights:residualWeights(points,p.fittingConfig).weights});
  keys.forEach((key,i)=>l.parameters[key].current=out.finalParams[i]);return p;
}
export async function runExpertStage(project:EllipsometryProject,stage:number,index:number,onProgress?:(v:ExpertProgress)=>void,shouldStop=()=>false):Promise<EllipsometryProject> {
  validateExpert(project);let p=clone(project);if(!p.layers[index])throw new Error('Select a film layer');
  if(stage===1){const l=p.layers[index]; if(l.modelId!=='cauchy') {
    p.expert={...session(p),manualSource:snapshot(p)};l.modelId='cauchy';l.parameters=modelRegistry.createParameterSet('cauchy');
  } p=await fitExpert(p,true,onProgress,shouldStop);}
  if(stage===2){if(!['expert_mixed','kk_bspline'].includes(p.layers[index].modelId))p=initializeSpline(p,index);p=await fitExpert(p,false,onProgress,shouldStop);}
  if(stage===3){p=await preparePhysical(p,index);p=await fitExpert(p,false,onProgress,shouldStop);}
  if(stage===4)p=await fitExpert(p,true,onProgress,shouldStop);
  if(stage===0||stage===5)p=freshForward(p);
  if(stage===5){const m=computeMultiAoiResidualMetrics(p.experimentData!.points,p.fittingConfig.activeFitAois,p.fittingConfig.fitWeighting,p.fittingConfig.psiWeight,p.fittingConfig.deltaWeight,collect(p).vars.length);
    p.fittingResult={...(project.fittingResult??{iterations:0,initialMse:m.rawMse,initialRmse:m.rawRmse,executionTimeMs:0,parameters:[]}),
      mseWoollam:m.mseWoollam,reducedChiSquare:m.reducedChiSquare,chiSquare:m.chiSquare,dof:m.dof,
        weightingMode:m.weightingMode,weightingWarning:m.weightingWarning,
      converged:project.fittingResult?.converged??false,numParameters:collect(p).vars.length,perAoiMseWoollam:Object.fromEntries(Object.entries(m.perAoi).map(([a,v])=>[a,v.mseWoollam])),
      status:m.rawMse<10?'target_achieved':'target_not_achieved',finalMse:m.rawMse,finalRmse:m.rawRmse,rawMse:m.rawMse,
      psiRmse:Math.sqrt(m.psiMse),deltaRmse:Math.sqrt(m.deltaMse),freshCalculationVerified:true,message:'Independent complete-spectrum TMM verification',perAoiMse:Object.fromEntries(Object.entries(m.perAoi).map(([a,v])=>[a,v.mse]))};}
  const m=computeMultiAoiResidualMetrics(p.experimentData!.points,p.fittingConfig.activeFitAois,p.fittingConfig.fitWeighting,p.fittingConfig.psiWeight,p.fittingConfig.deltaWeight,collect(p).vars.length),s=session(p);
  p.expert={...s,stage,records:[...s.records,{stage,rawMse:m.rawMse,message:stageNames[stage],at:new Date().toISOString()}]};
  return p;
}
