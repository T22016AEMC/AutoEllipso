import assert from 'node:assert/strict';
import {settings,forward,cauchy,project,variables,finish,save} from './stage4_5c-support';
import {optimizeBoundedLM} from '../src/fitting/optimizer';
import {computeFitStatistics} from '../src/fitting/statistics';

type Candidate={n:number;k:number;chiSquare:number;result:any};
const distance=(a:Candidate,b:Candidate)=>((a.n-b.n)/5)**2+((a.k-b.k)/3.5)**2;
/** Candidates are already restricted to delta chi-square <=9; continuity breaks branch ambiguity. */
export function path(candidates:Candidate[][]) {
 const costs=candidates.map(row=>row.map(()=>Infinity)),data=candidates.map(row=>row.map(()=>Infinity)),parents=candidates.map(row=>row.map(()=>-1));
 costs[0].fill(0);
 data[0]=candidates[0].map(c=>c.chiSquare);
 for(let j=1;j<candidates.length;j++)for(let q=0;q<candidates[j].length;q++)for(let p=0;p<candidates[j-1].length;p++) {
  const cost=costs[j-1][p]+distance(candidates[j-1][p],candidates[j][q]);
  const chi=data[j-1][p]+candidates[j][q].chiSquare;
  if(cost<costs[j][q]||cost===costs[j][q]&&chi<data[j][q]){costs[j][q]=cost;data[j][q]=chi;parents[j][q]=p;}
 }
 const indices=candidates.map(()=>0);indices[indices.length-1]=candidates.at(-1)!.map((_,i)=>i).sort((a,b)=>costs.at(-1)![a]-costs.at(-1)![b]||data.at(-1)![a]-data.at(-1)![b])[0];
 for(let j=indices.length-1;j>0;j--)indices[j-1]=parents[j][indices[j]];
 return {indices,selected:indices.map((i,j)=>candidates[j][i]),changed:indices.filter(i=>i!==0).length};
}
export async function pointByPoint(f:any) {
 const fw=forward(f),initial=await cauchy(f),d0=initial.result.finalParams[0],lower=Math.max(40,d0-settings.profileRadius),upper=Math.min(200,d0+settings.profileRadius),profiles:any[]=[];
 async function at(d:number,detail=false) {
  const candidates:Candidate[][]=[];
  for(const g of fw.groups) {
   const residual=(p:number[]):number[]=>fw.residual(g,d,p[0],p[1]),weights:number[]=g.points.flatMap((p:any)=>[1/p.psiSigma,1/p.deltaSigma]);
   const chi=(p:number[])=>residual(p).reduce((s,r,i)=>s+(r*weights[i])**2,0),grid:number[][]=[];
   for(let i=0;i<settings.gridN;i++){grid[i]=[];for(let j=0;j<settings.gridK;j++)grid[i][j]=chi([settings.nMin+(settings.gridNMax-settings.nMin)*i/(settings.gridN-1),settings.gridKMax*j/(settings.gridK-1)]);}
   const minima:{i:number;j:number;cost:number}[]=[];
   for(let i=0;i<settings.gridN;i++)for(let j=0;j<settings.gridK;j++) {
    let local=true;for(let a=Math.max(0,i-1);a<=Math.min(settings.gridN-1,i+1);a++)for(let b=Math.max(0,j-1);b<=Math.min(settings.gridK-1,j+1);b++)if(grid[a][b]<grid[i][j])local=false;
    if(local)minima.push({i,j,cost:grid[i][j]});
   }
   minima.sort((a,b)=>a.cost-b.cost||a.i-b.i||a.j-b.j);
   const refined:Candidate[]=[];
   for(const m of minima.slice(0,settings.branches)) {
    const vars=[{id:'n',name:'n',value:settings.nMin+(settings.gridNMax-settings.nMin)*m.i/(settings.gridN-1),min:settings.nMin,max:settings.nMax},{id:'k',name:'k',value:settings.gridKMax*m.j/(settings.gridK-1),min:0,max:settings.kMax}];
    const result=await optimizeBoundedLM(vars,residual,{maxIterations:settings.pointIterations,tolerance:settings.tolerance,residualWeights:weights});
    const [n,k]=result.finalParams;
    if(!refined.some(c=>Math.hypot(c.n-n,c.k-k)<1e-5))refined.push({n,k,chiSquare:result.finalChiSquare,result});
   }
   refined.sort((a,b)=>a.chiSquare-b.chiSquare);assert.ok(refined.length);
   candidates.push(refined.filter(c=>c.chiSquare<=refined[0].chiSquare+settings.nearChiSquare));
  }
  const dp=path(candidates),chiSquare=dp.selected.reduce((s,c)=>s+c.chiSquare,0),report={thickness:d,chiSquare,ambiguous:candidates.filter(c=>c.length>1).length,dpChanged:dp.changed};
  if(!detail){profiles.push(report);console.log('PROFILE '+JSON.stringify(report));return report;}
  let missingN=0,missingK=0;
  const points=dp.selected.map((c,j)=>{
   const g=fw.groups[j],vars=[{id:'n',name:'n',value:c.n,min:settings.nMin,max:settings.nMax},{id:'k',name:'k',value:c.k,min:0,max:settings.kMax}],weights=g.points.flatMap((p:any)=>[1/p.psiSigma,1/p.deltaSigma]);
   const statistics=computeFitStatistics(vars,[c.n,c.k],p=>fw.residual(g,d,p[0],p[1]),{weights});
   const sn=statistics.parameters.find(p=>p.id==='n')?.stdError,sk=statistics.parameters.find(p=>p.id==='k')?.stdError;
   if(!(sn!=null&&sn>0))missingN++;if(!(sk!=null&&sk>0))missingK++;
   return {wavelength:g.wavelength,n:c.n,k:c.k,nSigma:sn,kSigma:sk,nWeight:sn!=null&&sn>0?1/sn:settings.missingPointSigmaWeight,kWeight:sk!=null&&sk>0?1/sk:settings.missingPointSigmaWeight,statistics,candidates:candidates[j],selected:dp.indices[j]};
  });
  return {...report,points,missingN,missingK};
 }
 const coarse=[];for(let d=lower;d<=upper+1e-8;d+=settings.coarseStep)coarse.push(await at(d));
 coarse.sort((a,b)=>a.chiSquare-b.chiSquare||a.thickness-b.thickness);
 const best=coarse[0],fine=[];for(let i=-10;i<=10;i++){const d=best.thickness+i*settings.fineStep;if(d>=lower-1e-8&&d<=upper+1e-8)fine.push(await at(d));}
 fine.sort((a,b)=>a.chiSquare-b.chiSquare||a.thickness-b.thickness);
 const selected:any=await at(fine[0].thickness,true),knots=Array.from({length:settings.knots},(_,i)=>190+710*i/(settings.knots-1));
 const wavelengths=selected.points.map((p:any)=>p.wavelength),n=project(wavelengths,selected.points.map((p:any)=>p.n),knots,selected.points.map((p:any)=>p.nWeight),settings.lambdaN),k=project(wavelengths,selected.points.map((p:any)=>p.k),knots,selected.points.map((p:any)=>p.kWeight),settings.lambdaK);
 const seed={cauchy:initial,scanBracket:[lower,upper],truthInBracket:100>=lower&&100<=upper,profiles,selected,projection:{nTruncated:n.truncated,kTruncated:k.truncated},uncertaintyFallback:'Boundary or unavailable point uncertainty: unit optical uncertainty (weight=1); counted explicitly; no positive k floor'};
 save(f.truth.id+'-M1-profile',seed);
 return finish(f,knots,variables(knots,selected.thickness,n.solution,k.solution),seed);
}
export function selfCheck() {
 const c=(n:number,chiSquare=0):Candidate=>({n,k:0,chiSquare,result:null});
 const result=path([[c(1),c(3)],[c(3),c(1)],[c(1),c(3)]]);
 assert.equal(result.changed,1);assert.deepEqual(result.selected.map(p=>p.n),[1,1,1]);
 assert.deepEqual(path([[c(2)],[c(2)]]).indices,[0,0]);
 console.log('SELF-CHECK: DP chooses continuous branch without modifying candidate n/k');
}
