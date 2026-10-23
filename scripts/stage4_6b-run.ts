import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {refineFreeForm} from '../src/fitting/freeFormRefine';
import {modelRegistry} from '../src/modelRegistry/registry';
import {cubicBasis} from '../src/models/cubicSpline';
import {calculateSpectrum} from '../src/solver/calculator';
import {computeResidualMetrics} from '../src/fitting/residual';
import {data,prepare,workflow} from './stage4_6a-support';
import {fixture} from './stage4_5c-support';

export const settings={base:'2b2c8a4288559e26b2ed724dc7241267b27d20e6',starts:['P1','P2','P3','P4','P5','P6','P7','P8a','P8b','P8c'],
 median:'lower median: sorted index floor((count-1)/2)',sameEndpoint:1e-3,randomSeeds:[61001,61002,61003],
 random:'LCG 1664525/1013904223, six equal-wavelength cubic controls each for n(relative +/-15%) and k(additive 0..0.1), next draw thickness +/-5nm',
 controls:'unmodified refineFreeForm: 40 nodes, full data, 100 iterations, ftol=1e-5, existing xtol/gtol, lambdaN=.25/lambdaK=.6',
 P5:'reuse formal Stage1 fitted A/B/C/thickness, k0=0; no truth',P2:'A: cached 4.6a oracle refined endpoint; B/C: P1 alias, independently refined',
 initialMse:'actual optimizer start after production SVD projection/clamping; also retain unprojected seed MSE with M=0',
 timing:'serial P1..P8c wall-clock calls including final statistics; excludes seed acquisition; fixed order, possible runtime/cache warming'};
export const groups=[...['SiO2','absorbing','transparent','weak'].map(scenario=>({id:scenario+'-gaussian',scenario,model:'gaussian',kind:'A'})),
 ...[['T1','tauc_lorentz'],['T2','gaussian'],['T3','lorentz'],['T4','gaussian'],['T0','gaussian'],['T5','gaussian']].map(([scenario,model])=>({id:scenario+'-'+model,scenario,model,kind:['T0','T5'].includes(scenario)?'C':'B'}))];
export const path=(name:string)=>`.qa/stage4_6b-${name}.json`;
export const save=(name:string,value:unknown)=>{mkdirSync('.qa',{recursive:true});writeFileSync(path(name),JSON.stringify(value,null,2));};
export const read=(name:string)=>JSON.parse(readFileSync(path(name),'utf8'));
function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src'],{encoding:'utf8'}),'');assert.equal(execFileSync('git',['status','--porcelain','--','src'],{encoding:'utf8'}),'');}
const parameter=(id:string,current:number)=>({id,name:id,current,initial:current,min:0,max:2500,fit:false,unit:''});
function transient(layers:any[],index:number,id:string,calculate:(w:number)=>{n:number;k:number},thickness:number){
 const base=modelRegistry.get('constant_nk')!;
 modelRegistry.register({...base,id,calculate:w=>{const p=calculate(w);return{...p,eps1:p.n*p.n-p.k*p.k,eps2:2*p.n*p.k};},calculateN:w=>calculate(w).n,calculateK:w=>calculate(w).k});
 const out=structuredClone(layers);out[index].modelId=id;out[index].parameters={};out[index].thickness=thickness;return out;
}
function perturb(seed:number,lo:number,hi:number){
 let state=seed;const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 const n=Array.from({length:6},()=>2*rng()-1),k=Array.from({length:6},()=>rng()),d=10*rng()-5,knots=n.map((_,i)=>lo+(hi-lo)*i/5);
 return {n,k,d,at:(w:number)=>{const b=cubicBasis(w,knots);return{n:b.reduce((s,v,i)=>s+v*n[i],0),k:b.reduce((s,v,i)=>s+v*k[i],0)};}};
}
export function difference(a:any[],b:any[]):{nMax:number;nRms:number;kMax:number;kRms:number}{assert.equal(a.length,b.length);return Object.fromEntries(['n','k'].flatMap(key=>{const delta=a.map((q,i)=>{assert.equal(q.wavelength,b[i].wavelength);return q[key]-b[i][key];});return[[key+'Max',Math.max(...delta.map(Math.abs))],[key+'Rms',Math.sqrt(delta.reduce((s,v)=>s+v*v,0)/delta.length)]];})) as {nMax:number;nRms:number;kMax:number;kRms:number};}
async function main(){
 guard();const id=process.argv[2];
 if(id==='prepare'){
  const p=perturb(61001,190,900),q=perturb(61001,190,900);assert.deepEqual([p.n,p.k,p.d],[q.n,q.k,q.d]);
  for(let w=190;w<=900;w++){const a=p.at(w);assert.ok(a.n>=-1&&a.n<=1&&a.k>=0&&a.k<=1);}
  assert.deepEqual(difference([{wavelength:1,n:2,k:0}],[{wavelength:1,n:1,k:0}]),{nMax:1,nRms:1,kMax:0,kRms:0});
  save('settings',settings);console.log('FROZEN '+JSON.stringify(settings));return;
 }
 assert.deepEqual(read('settings'),settings,'Rules frozen before data runs');const group=groups.find(g=>g.id===id);assert.ok(group);
 const f:any=group.kind==='A'?data(group):fixture(group.scenario),cache=`.qa/stage4_6a-${id}-formal.json`;
 let formal:any,acquisition='4.6a cached formal output; identical production src tree';
 if(existsSync(cache))formal=JSON.parse(readFileSync(cache,'utf8'));
 else {
  if(!existsSync('.qa/stage46a-source/src/fitting/autoWorkflow.ts'))prepare();const w=await workflow();w.diagnosticReset();const start=performance.now();
  const output=await w.runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:group.model,selectedAois:[65,70,75]});
  assert.equal(w.diagnosticContexts.length,1);formal={output,context:w.diagnosticContexts[0],elapsedMs:performance.now()-start};acquisition='isolated 4.6a read-only trace, production tree identical';save(id+'-formal',formal);
 }
 const ctx=formal.context,output=formal.output,index=ctx.primaryLayerIndex;
 // Cached contexts may include calculated fields; experimental inputs must still match exactly.
 const inputs=(points:any[])=>points.map(p=>[p.wavelength,p.aoi,p.psiExp,p.deltaExp,p.psiSigma,p.deltaSigma]);assert.deepEqual(inputs(ctx.points),inputs(f.points));
 assert.equal(ctx.modelId,group.model);const wavelengths=[...new Set<number>(f.points.map((p:any)=>p.wavelength))].sort((a,b)=>a-b);
 const physical=structuredClone(output.updatedLayers),p1=physical[index],definition=modelRegistry.get(p1.modelId)!,params=Object.fromEntries(Object.entries(p1.parameters).map(([k,v]:[string,any])=>[k,v.current]));
 const states=ctx.states,starts:any[]=[{id:'P1',layers:physical,source:'formal selected physical endpoint'}];
 if(group.kind==='A'){
  const file=`.qa/stage4_6a-${id}.json`;
  if(!existsSync(file)){
   if(!existsSync('.qa/stage46a-source/src/fitting/autoWorkflow.ts'))prepare();
   execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/stage4_6a-run.ts',id!],{stdio:'inherit'});
  }
  const oracle=JSON.parse(readFileSync(file,'utf8')),best=oracle.table.find((r:any)=>r.startIndex===oracle.summary.oracleIndex),layers=structuredClone(states.find((s:any)=>s.startIndex===best.startIndex).layers);
  layers[index].thickness=best.thickness;for(const [k,v] of Object.entries(best.parameters))layers[index].parameters[k].current=v;
  starts.push({id:'P2',layers,source:'4.6a oracle refined endpoint',candidate:best.startIndex,coarseRank:best.rank});
 }else starts.push({id:'P2',layers:structuredClone(physical),source:'P1 alias (B/C), independently refined'});
 for(const [id,rank] of [['P3',states.length-1],['P4',Math.floor((states.length-1)/2)]] as [string,number][]){const s=states[rank];starts.push({id,layers:structuredClone(s.layers),source:'post-coarse endpoint',candidate:s.startIndex,coarseRank:rank+1,coarseCost:s.weightedMse});}
 const cauchy=structuredClone(physical),c=output.pipelineData.cauchy0Point;cauchy[index].modelId='cauchy';cauchy[index].parameters=modelRegistry.createParameterSet('cauchy');cauchy[index].thickness=c.thicknessNm;
 for(const [key,value] of Object.entries(c.parameters))cauchy[index].parameters[key].current=value;
 if(cauchy[index].parameters.k0)cauchy[index].parameters.k0.current=0;
 assert.ok(wavelengths.every(w=>modelRegistry.get('cauchy')!.calculateK(w,Object.fromEntries(Object.entries(cauchy[index].parameters).map(([k,v]:[string,any])=>[k,v.current])))===0));
 starts.push({id:'P5',layers:cauchy,source:settings.P5});
 starts.push({id:'P6',layers:transient(physical,index,'diagnostic46b_constant',()=>({n:1.5,k:.05}),c.thicknessNm),source:'constant n=1.5,k=.05; fitted Cauchy thickness'});
 const b=output.pipelineData.bspline,ladder=structuredClone(physical);assert.ok(b.nodeWavelengths.length>=8);
 ladder[index].modelId='bspline';ladder[index].thickness=b.thicknessNm;ladder[index].parameters={_knotCount:parameter('_knotCount',b.nodeWavelengths.length)};
 b.nodeWavelengths.forEach((w:number,i:number)=>ladder[index].parameters['_knot'+i]=parameter('_knot'+i,w));
 for(const [key,value] of Object.entries(b.nodeCoefficients))ladder[index].parameters[key]=parameter(key,value as number);
 starts.push({id:'P7',layers:ladder,source:'original BIC-selected ladder endpoint; reprojected/refined by unchanged core',ladderRawMse:b.rawMse});
 for(const [j,seed] of settings.randomSeeds.entries()){
  const r=perturb(seed,wavelengths[0],wavelengths.at(-1)!);
  starts.push({id:'P8'+String.fromCharCode(97+j),layers:transient(physical,index,'diagnostic46b_random'+seed,w=>{const p=definition.calculate(w,params),q=r.at(w);return{n:p.n*(1+.15*q.n),k:p.k+.1*q.k};},p1.thickness+r.d),source:'smooth perturbation of P1',seed,controls:{n:r.n,k:r.k,thicknessDelta:r.d}});
 }
 assert.deepEqual(starts.map(s=>s.id),settings.starts);const results:any[]=[];
 for(const start of starts){
  const unprojected=computeResidualMetrics(calculateSpectrum(ctx.ambient,start.layers,ctx.substrate,f.points),ctx.config.fitWeighting,ctx.config.psiWeight,ctx.config.deltaWeight,0);
  const begin=performance.now(),out=await refineFreeForm({ambient:ctx.ambient,layers:start.layers,substrate:ctx.substrate,primaryLayerIndex:index,points:f.points,config:ctx.config,outputWavelengths:wavelengths});
  const elapsedMs=performance.now()-begin,delta=difference(out.curve,results.length?results[0].out.curve:out.curve);
  assert.ok(out.curve.every(q=>Number.isFinite(q.n)&&Number.isFinite(q.k)&&q.k>=0));
  const row={...start,unprojectedSeedMseWoollamWithM0:unprojected.mseWoollam,initialMseWoollam:out.initialMetrics.mseWoollam,mseWoollam:out.metrics.mseWoollam,totalCost:out.result.finalCost,
   iterations:out.result.iterations,converged:out.result.converged,status:out.result.status,elapsedMs,thickness:out.model.layers[index].thickness,delta,
   sameAsP1:delta.nMax<=settings.sameEndpoint&&delta.kMax<=settings.sameEndpoint,mseDeltaToP1:out.metrics.mseWoollam-(results[0]?.mseWoollam??out.metrics.mseWoollam),
   truth:group.kind==='B'?{...difference(out.curve,f.optics),thicknessError:out.model.layers[index].thickness-100}:undefined,out};
  if(start.id==='P2'&&group.kind!=='A')assert.deepEqual(out.result.finalParams,results[0].out.result.finalParams,'Independent P1 alias replay bit-identical');
  results.push(row);save(id!,{group,settings,acquisition,results});console.log('END '+JSON.stringify({group:id,start:start.id,mse:row.mseWoollam,delta,iterations:row.iterations,status:row.status,elapsedMs}));
 }
 const pairs=results.flatMap((a,i)=>results.slice(i+1).map(b=>({a:a.id,b:b.id,...difference(a.out.curve,b.out.curve)})));
 const summary={minimumMse:Math.min(...results.map(r=>r.mseWoollam)),maximumMse:Math.max(...results.map(r=>r.mseWoollam)),
  maxNDeltaToP1:Math.max(...results.map(r=>r.delta.nMax)),maxKDeltaToP1:Math.max(...results.map(r=>r.delta.kMax)),
  allPairwiseWithinThreshold:pairs.every(p=>p.nMax<=settings.sameEndpoint&&p.kMax<=settings.sameEndpoint),
  different:results.filter(r=>!r.sameAsP1).map(r=>({id:r.id,deltaMse:r.mseDeltaToP1})),elapsedMs:results.reduce((s,r)=>s+r.elapsedMs,0)};
 save(id!,{group,settings,acquisition,results,pairs,summary});guard();console.log('SUMMARY '+JSON.stringify({group:id,...summary}));
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage4_6b-run.ts'))await main();
