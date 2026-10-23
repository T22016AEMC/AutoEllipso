import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fixture} from './stage4_5c-support';
import {polish} from './stage4_6a-support';
import {refineFreeForm,chooseFreeFormOrigin} from '../src/fitting/freeFormRefine';
import {calculateSpectrum} from '../src/solver/calculator';
import {computeResidualMetrics} from '../src/fitting/residual';
import {modelRegistry} from '../src/modelRegistry/registry';
import {settings,groups,save,read,guard,prepare,workflow,parameter,endpoint,distance,transient,perturb,choose,selfCheck,difference} from './stage4_6c-support';

guard();const id=process.argv[2];
if(id==='prepare'){selfCheck();prepare();console.log('FROZEN '+JSON.stringify(settings));}
else {
 assert.deepEqual(read('settings'),settings);const group=groups.find(g=>g.id===id);assert.ok(group);const f=fixture(group.truth),w=await workflow();w.diagnosticReset();const automaticStart=performance.now();
 const output=await w.runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:group.model,selectedAois:[65,70,75]});
 assert.equal(w.diagnosticContexts.length,1);const ctx=w.diagnosticContexts[0],index=ctx.primaryLayerIndex,states=ctx.states,physical=structuredClone(output.updatedLayers),p1=physical[index];
 const formalCalls=w.diagnosticCalls.filter((c:any)=>c.options.maxIterations===100&&c.options.tolerance===1e-6);assert.equal(formalCalls.length,2);
 const provenance={automaticElapsedMs:performance.now()-automaticStart,capturedPhysicalPolishes:formalCalls.length,physicalMseWoollam:output.fittingResult.mseWoollam,baselineChecked:false};
 const previous=`.qa/stage4_6a-${id}-formal.json`;
 if(existsSync(previous)){const old=JSON.parse(readFileSync(previous,'utf8')).output;assert.deepEqual(output.updatedLayers,old.updatedLayers);assert.equal(output.fittingResult.mseWoollam,old.fittingResult.mseWoollam);provenance.baselineChecked=true;}
 save(id+'-formal',{group,output,context:ctx,calls:w.diagnosticCalls,provenance});
 const wavelengths=[...new Set<number>(f.points.map((p:any)=>p.wavelength))].sort((a,b)=>a-b),definition=modelRegistry.get(p1.modelId)!,params=Object.fromEntries(Object.entries(p1.parameters).map(([k,v]:[string,any])=>[k,v.current]));
 const starts:any[]=[{id:'P1',layers:physical,source:'formal physical endpoint'}];
 const c=output.pipelineData.cauchy0Point,cauchy=structuredClone(physical);cauchy[index].modelId='cauchy';cauchy[index].parameters=modelRegistry.createParameterSet('cauchy');cauchy[index].thickness=c.thicknessNm;
 for(const [k,v] of Object.entries(c.parameters))cauchy[index].parameters[k].current=v;cauchy[index].parameters.k0.current=0;
 starts.push({id:'P5',layers:cauchy,source:'formal Stage1 Cauchy k=0'});
 const b=output.pipelineData.bspline,ladder=structuredClone(physical);ladder[index].modelId='bspline';ladder[index].thickness=b.thicknessNm;ladder[index].parameters={_knotCount:parameter('_knotCount',b.nodeWavelengths.length)};
 b.nodeWavelengths.forEach((v:number,i:number)=>ladder[index].parameters['_knot'+i]=parameter('_knot'+i,v));for(const [k,v] of Object.entries(b.nodeCoefficients))ladder[index].parameters[k]=parameter(k,v as number);
 starts.push({id:'P7',layers:ladder,source:'original BIC-selected ladder endpoint'});
 const p9:any[]=[],p9Audit:any[]=[];let p9GenerationMs=0;
 for(let rank=1;rank<=4;rank++){
  const state=states[rank-1];let values:number[],audit:any;
  if(rank<=2){values=formalCalls[rank-1].result.finalParams;audit={rank,source:'reuse formal polish',result:formalCalls[rank-1].result,extraElapsedMs:0};}
  else {const r=await polish(ctx,{...state,rank});values=r.result.finalParams;p9GenerationMs+=r.elapsedMs;audit={source:'additional physical polish',...r,extraElapsedMs:r.elapsedMs};}
  const layers=endpoint(state,values,index),distances=[{id:'P1',distance:distance(layers,physical,index,p1,ctx.tMin,ctx.tMax)},...p9.map(s=>({id:s.id,distance:distance(layers,s.layers,index,p1,ctx.tMin,ctx.tMax)}))];
  const duplicate=distances.find(q=>q.distance<1e-6),retained=!duplicate&&p9.length<3;
  if(retained)p9.push({id:'P9r'+rank,layers,source:'refined coarse rank '+rank,coarseCandidate:state.startIndex});
  p9Audit.push({...audit,distances,retained,duplicateOf:duplicate?.id,layers});
 }
 starts.push(...p9);
 for(const offset of settings.P10){const layers=structuredClone(physical);layers[index].thickness=Math.max(40,Math.min(200,p1.thickness+offset));starts.push({id:'P10'+(offset>0?'+':'')+offset,layers,source:'P1 optics with clipped thickness offset',offset});}
 const r4Ids=starts.map(s=>s.id);
 for(const [id,rank] of [['P3',states.length-1],['P4',Math.floor((states.length-1)/2)]] as [string,number][])starts.push({id,layers:structuredClone(states[rank].layers),source:'oracle-only coarse endpoint',rank:rank+1});
 starts.push({id:'P6',layers:transient(physical,index,'diagnostic46c_constant',()=>({n:1.5,k:.05}),c.thicknessNm),source:'oracle-only constant optics/Cauchy thickness'});
 for(const [j,seed] of settings.randomSeeds.entries()){
  const r=perturb(seed,wavelengths[0],wavelengths.at(-1)!);starts.push({id:'P8'+String.fromCharCode(97+j),layers:transient(physical,index,'diagnostic46c_random'+seed,v=>{const p=definition.calculate(v,params),q=r.at(v);return{n:p.n*(1+.15*q.n),k:p.k+.1*q.k};},p1.thickness+r.d),source:'oracle-only smooth perturbation',seed,controls:{n:r.n,k:r.k,thicknessDelta:r.d}});
 }
 const results:any[]=[],score=(curve:any[],thickness:number)=>({...difference(curve,f.optics),thicknessError:thickness-100});
 const selectedLadder=b.knotRefinementHistory.find((r:any)=>r.selected),freeCount=output.fittingResult.freeFormStatistics?.covariance.ids.length??output.fittingResult.opticalModelComparison?.freeForm.effectiveParameters;
 assert.ok(Number.isFinite(freeCount),'Original ladder effective parameter count available');
 const ladderMetrics=computeResidualMetrics(calculateSpectrum(ctx.ambient,ladder,ctx.substrate,f.points),ctx.config.fitWeighting,ctx.config.psiWeight,ctx.config.deltaWeight,freeCount);
 const ladderParams=Object.fromEntries(Object.entries(ladder[index].parameters).map(([k,v]:[string,any])=>[k,v.current]));
 const ladderCurve=wavelengths.map(wavelength=>({wavelength,...modelRegistry.get('bspline')!.calculate(wavelength,ladderParams)}));
 const rawLadder={id:'P7_original',mseWoollam:ladderMetrics.mseWoollam,totalCost:b.weightedTotalObjective,thickness:b.thicknessNm,iterations:selectedLadder.iterations,converged:selectedLadder.converged,status:selectedLadder.status,elapsedMs:0,truth:score(ladderCurve,b.thicknessNm),curve:ladderCurve};
 assert.ok(Math.abs(ladderMetrics.rawMse-b.rawMse)<1e-12,'Original ladder reconstruction matches saved raw residual');
 for(const start of starts){
  const begin=performance.now(),out=await refineFreeForm({ambient:ctx.ambient,layers:start.layers,substrate:ctx.substrate,primaryLayerIndex:index,points:f.points,config:ctx.config,outputWavelengths:wavelengths}),elapsedMs=performance.now()-begin;
  assert.ok(out.curve.every(q=>Number.isFinite(q.n)&&Number.isFinite(q.k)&&q.k>=0));
  const row={...start,mseWoollam:out.metrics.mseWoollam,totalCost:out.result.finalCost,thickness:out.model.layers[index].thickness,
   iterations:out.result.iterations,converged:out.result.converged,status:out.result.status,elapsedMs,initialMseWoollam:out.initialMetrics.mseWoollam,truth:score(out.curve,out.model.layers[index].thickness),out};
  results.push(row);save(id!,{group,settings,provenance,p9GenerationMs,p9Audit,rawLadder,results});console.log('REFINED '+JSON.stringify({group:id,start:row.id,mse:row.mseWoollam,status:row.status,thickness:row.thickness,elapsedMs}));
 }
 const oracle=choose(results),p1Result=results[0],strategies:any[]=[];
 const definitions={R0:['P1'],R1:['P1','P5','P7'],R2:['P1',...p9.map(s=>s.id)],R3:['P1',...r4Ids.filter(s=>s.startsWith('P10'))],R4:r4Ids,Oracle:results.map(r=>r.id)};
 for(const [name,ids] of Object.entries(definitions)){
  const pool=results.filter(r=>ids.includes(r.id)),selected=name==='R0'?(chooseFreeFormOrigin(rawLadder.mseWoollam,p1Result.mseWoollam)==='ladder'?rawLadder:p1Result):choose(pool),elapsedMs=pool.reduce((sum,r)=>sum+r.elapsedMs,0),extra=['R2','R4','Oracle'].includes(name)?p9GenerationMs:0;
  strategies.push({name,ids,selected:{id:selected.id,mseWoollam:selected.mseWoollam,totalCost:selected.totalCost,thickness:selected.thickness,iterations:selected.iterations,converged:selected.converged,status:selected.status,truth:selected.truth},
   regret:selected.mseWoollam-oracle.mseWoollam,relativeRegret:(selected.mseWoollam-oracle.mseWoollam)/oracle.mseWoollam,elapsedMs,relativeTime:elapsedMs/p1Result.elapsedMs,
   inclusiveElapsedMs:elapsedMs+extra,inclusiveRelativeTime:(elapsedMs+extra)/p1Result.elapsedMs,rescued:selected.mseWoollam<=1.01*oracle.mseWoollam});
 }
 const badP1=p1Result.mseWoollam/oracle.mseWoollam>=2&&p1Result.mseWoollam-oracle.mseWoollam>=1;
 for(const name of ['R1','R2','R3'])assert.ok(strategies.find(s=>s.name==='R4').selected.mseWoollam<=strategies.find(s=>s.name===name).selected.mseWoollam);
 save(id!,{group,settings,provenance,p9GenerationMs,p9Audit,rawLadder,results,strategies,badP1,oracleId:oracle.id});guard();console.log('DONE '+JSON.stringify({id,badP1,strategies}));
}
