import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {settings as originalSettings} from './stage4_8a-run';
import {modelRegistry} from '../src/modelRegistry/registry';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {evaluateSubstrateOpticalConstants} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {cubicBasis} from '../src/models/cubicSpline';
import {solveLeastSquaresSvd} from '../src/fitting/svd';
import {computeFitStatistics} from '../src/fitting/statistics';
import {residualWeights,circularDifferenceDeg} from '../src/fitting/residual';

export const prefix='.qa/stage4_8b-',source='.qa/stage4_8a-';
export const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export const load=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
export const old=(name:string)=>load(source+name+'.json');
export const save=(name:string,v:unknown)=>writeFileSync(prefix+name+'.json',JSON.stringify(v,null,2)+'\n');
export const auditPlan={historicalProof:'verify original4.8a settings/report/core digests; snapshot all currently existing stage4_8a-* files; this cannot prove unchanged since original completion',
 inputScope:'all42 input datasets:21 training,14 heldout,7 validation; exact ids/settings/project structure; independently replay truth n/k, LCG/Box-Muller and TMM point data, tolerance1e-12 absolute',
 fitScope:'all420 full-data checkpoints:ids/seed/count/scale/uniform knots/bounds/N/p/dof, saved final variables/curves, independently recomputed rawRSS and BIC/AIC; relative tolerance1e-8*max(1,abs(reference))',
 formalStatisticsScope:'baseline40Ws1 and endpoint80Ws0.01 in each of21 datasets,42 samples; reconstruct exact production residual/regularization, invoke official computeFitStatistics only (no optimizer); p/dof/covariance.ids exact; independently replay P1 initial projection/objective for same42 samples',
 evaluationScope:'all420 cached heldout evaluations:ids/settings and mean Wout/chiSquare/N equal the two saved components; all420 validation records match settings, saved C2 choice is legal minimum validation W. Integrity only; no validation/heldout fields passed to selectors',
 forbiddenWork:'no Automatic, optimizer or refinement rerun; audit may read original sigma/ground-truth solely for integrity, never supplied to selectors',
 provenance:'all source file bytes must still match the snapshot after analysis/sparse/verify; any mismatch stops, no repair'};
export function originalHashes(){const f=old('frozen');assert.equal(sha(readFileSync(source+'settings.json')),f.settingsSha256);assert.equal(sha(readFileSync(source+'frozen-report.md')),f.reportSha256);assert.equal(sha(readFileSync('scripts/stage4_6d-refine.ts')),f.coreSha256);assert.deepEqual(old('settings'),originalSettings);return f;}
export function snapshotCheck(){const snapshot=load(prefix+'checkpoint-snapshot.json');for(const [name,item] of Object.entries(snapshot.files) as [string,any][]){assert.equal(sha(readFileSync('.qa/'+name)),item.sha256,`source checkpoint changed: ${name}`);}originalHashes();return Object.keys(snapshot.files).length;}
function close(a:number,b:number,tolerance=1e-8){assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(b)),`${a} != ${b}`);}
function absolute(a:number,b:number){assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-12,`${a} != ${b}`);}
function problem(f:any,r:any){
 const count=r.setting.count,knots=r.out.knots,ambient=new Complex(f.project.ambient.n,f.project.ambient.k),groups=originalSettings.wavelengths.map(w=>({w,b:cubicBasis(w,knots),substrate:evaluateSubstrateOpticalConstants(f.project.substrate,w),points:f.points.filter((p:any)=>p.wavelength===w)})),points=groups.flatMap(g=>g.points),weighting=residualWeights(points,f.project.fittingConfig);
 const residual=(v:number[])=>groups.flatMap(g=>{const n=g.b.reduce((s,b,i)=>s+b*v[i+1],0),k=g.b.reduce((s,b,i)=>s+b*v[count+i+1],0);return g.points.flatMap((p:any)=>{const q=solveEllipsometryTMM(ambient,[{thicknessNm:v[0],N:new Complex(n,k)}],g.substrate,g.w,p.aoi);return [q.psiDeg-p.psiExp,circularDifferenceDeg(q.deltaDeg,p.deltaExp)];});});
 const regularization=(v:number[])=>{const rows:number[]=[],m=points.length*2,lambdaN=.25*r.setting.scale,lambdaK=.6*r.setting.scale;for(let i=1;i<count-1;i++)rows.push(Math.sqrt(m*lambdaN)*(v[i+2]-2*v[i+1]+v[i]));for(let i=1;i<count-1;i++)rows.push(Math.sqrt(m*lambdaK)*(v[count+i+2]-2*v[count+i+1]+v[count+i]));return rows;};
 return {groups,residual,regularization,weights:weighting.weights};
}
function verifyInput(id:string,seed:number){
 const f=old(`${id}-${seed}-data`),t=originalSettings.truths.find(t=>t.id===id)!;assert.deepEqual(f.truth,t);assert.equal(f.points.length,216);assert.equal(f.optics.length,72);assert.equal(f.project.layers.length,1);assert.equal(f.project.substrate.modelId,'tabulated_si');assert.equal(f.project.ambient.n,1);assert.equal(f.project.ambient.k,0);
 let state=seed;const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 for(const [i,p] of f.points.entries()){const aoi=originalSettings.aois[Math.floor(i/72)],w=originalSettings.wavelengths[i%72],q=modelRegistry.get(t.model)!.calculate(w,t.values),n=q.n,k=id==='V5'?Math.max(0,(w-700)/200)*.014:q.k,c=solveEllipsometryTMM(new Complex(1,0),[{thicknessNm:100,N:new Complex(n,k)}],evaluateSubstrateOpticalConstants(f.project.substrate,w),w,aoi),radius=Math.sqrt(-2*Math.log(rng())),angle=2*Math.PI*rng();assert.equal(p.id,`${aoi}-${w}`);assert.equal(p.wavelength,w);assert.equal(p.aoi,aoi);assert.equal(p.psiSigma,.03);assert.equal(p.deltaSigma,.03);absolute(p.psiExp,c.psiDeg+.03*radius*Math.cos(angle));absolute(p.deltaExp,normalizeDeltaDeg(c.deltaDeg+.03*radius*Math.sin(angle)));absolute(f.optics[i%72].n,n);absolute(f.optics[i%72].k,k);assert.equal(f.optics[i%72].wavelength,w);}
 return f;
}
export async function consistency(){
 const start=performance.now();originalHashes();snapshotCheck();const datasets:any[]=[],statisticsSamples:any[]=[];
 for(const t of originalSettings.truths){for(const seed of [...originalSettings.seeds,...originalSettings.outSeeds,originalSettings.validationSeed])verifyInput(t.id,seed);
  for(const seed of originalSettings.seeds){const f=old(`${t.id}-${seed}-data`),a=old(`${t.id}-${seed}-automatic`),P1=a.output.updatedLayers;assert.equal(a.id,t.id);assert.equal(a.seed,seed);assert.equal(P1.length,1);assert.equal(P1[0].modelId,['V0','V5'].includes(t.id)?'gaussian':t.model);close(P1[0].thickness,a.output.finalThickness);let checked=0;const validation:any[]=[];
   for(const count of originalSettings.counts)for(const scale of originalSettings.scales){const key=`${count}Ws${scale}`,r=old(`${t.id}-${seed}-${key}`),v=r.out.result.finalParams,p=r.out.statistics.covariance.ids.length,N=432;assert.equal(r.id,t.id);assert.equal(r.seed,seed);assert.deepEqual(r.setting,{count,scale,distribution:'wavelength',id:key});assert.equal(r.N,N);assert.equal(r.p,p);assert.equal(r.dof,r.out.statistics.dof);assert.equal(r.dof,N-p);assert.equal(v.length,2*count+1);assert.equal(r.out.model.lambdaN,.25*scale);assert.equal(r.out.model.lambdaK,.6*scale);assert.deepEqual(r.out.model.variables.map((q:any)=>q.value),v);
    for(let i=0;i<count;i++)close(r.out.knots[i],190+710*i/(count-1));
    const vars=r.out.model.variables;assert.deepEqual(vars.map((q:any)=>[q.min,q.max]),[[40,200],...Array.from({length:count},()=>[.5,5.5]),...Array.from({length:count},()=>[0,3.5])]);
    const e=old(`${t.id}-${seed}-${key}-evaluation`),val=old(`${t.id}-${seed}-${key}-validation`);assert.equal(e.id,t.id);assert.equal(e.seed,seed);assert.deepEqual(e.setting,r.setting);assert.deepEqual(val.setting,r.setting);assert.equal(e.oos.length,2);close(e.oosW,e.oos.reduce((s:number,m:any)=>s+m.mseWoollam,0)/2);close(e.oosChiN,e.oos.reduce((s:number,m:any)=>s+m.weightedMse,0)/2);close(e.gap,e.oosW-r.metrics.mseWoollam);close(val.valW,val.metrics.mseWoollam);if(r.converged&&r.status==='cost'&&r.dof>0&&count<=N/4)validation.push({id:key,value:val.valW});
    const pr=problem(f,r),residual=pr.residual(v),rawRSS=residual.reduce((s,x)=>s+x*x,0);close(rawRSS,r.metrics.rawMse*N);close(r.out.statistics.chiSquare,residual.reduce((s,x,i)=>s+(x*pr.weights[i])**2,0));close(r.bic,N*Math.log(Math.max(1e-12,rawRSS)/N)+p*Math.log(N));close(r.aic,N*Math.log(Math.max(1e-12,rawRSS)/N)+2*p);
    for(const q of r.out.curve){const b=cubicBasis(q.wavelength,r.out.knots);close(q.n,b.reduce((s,x,i)=>s+x*v[i+1],0));close(q.k,b.reduce((s,x,i)=>s+x*v[count+i+1],0));}
    if((count===40&&scale===1)||(count===80&&scale===.01)){
     const stats=computeFitStatistics(vars.map((q:any)=>({...q,splineCoefficient:/^[NK]\d+$/.test(q.id)})),v,pr.residual,{weights:pr.weights,regularizationResidualsFn:pr.regularization});assert.equal(stats.dof,r.dof);assert.deepEqual(stats.covariance.ids,r.out.statistics.covariance.ids);
     const values=Object.fromEntries(Object.entries(P1[0].parameters).map(([k,p]:[string,any])=>[k,p.current])),physical=originalSettings.wavelengths.map(w=>modelRegistry.get(P1[0].modelId)!.calculate(w,values)),basis=originalSettings.wavelengths.map(w=>cubicBasis(w,r.out.knots)),padding=Array.from({length:Math.max(0,count-72)},()=>Array(count).fill(0)),A=[...basis,...padding];
     const n=solveLeastSquaresSvd(A,[...physical.map(q=>q.n),...padding.map(()=>0)]).solution.map(x=>Math.max(.5,Math.min(5.5,x))),k=solveLeastSquaresSvd(A,[...physical.map(q=>q.k),...padding.map(()=>0)]).solution.map(x=>Math.max(0,Math.min(3.5,x))),initial=[Math.max(40,Math.min(200,P1[0].thickness)),...n,...k];close(pr.residual(initial).reduce((s,x)=>s+x*x,0)/N,r.out.initialMetrics.rawMse);
     statisticsSamples.push({id:t.id,seed,setting:key,p,dof:r.dof,rawRSS});
    }checked++;
   }const savedC2=old(`${t.id}-${seed}-rules`).rules.find((r:any)=>r.rule==='C2');assert.ok(savedC2);const expected=validation.length?validation.reduce((a,b)=>b.value<a.value?b:a).id:'40Ws1';assert.equal(savedC2.selected,expected);datasets.push({id:t.id,seed,checked});
  }
 }
 assert.equal(datasets.length,21);assert.equal(statisticsSamples.length,42);snapshotCheck();const result={passed:true,datasets,fullFits:420,inputs:42,statisticsSamples,elapsedMs:performance.now()-start,scope:auditPlan};save('consistency',result);return result;
}
async function main(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');const mode=process.argv[2];
 if(mode==='snapshot'){const original=originalHashes(),files=Object.fromEntries(readdirSync('.qa').filter(f=>f.startsWith('stage4_8a-')&&statSync('.qa/'+f).isFile()).sort().map(name=>[name,{sha256:sha(readFileSync('.qa/'+name)),bytes:statSync('.qa/'+name).size}]));assert.ok(Object.keys(files).length>420);save('checkpoint-snapshot',{created:new Date().toISOString(),original,limitation:auditPlan.historicalProof,files});save('audit-plan',{...auditPlan,sha256:sha(JSON.stringify(auditPlan))});console.log(JSON.stringify({files:Object.keys(files).length,originalHashesPassed:true,historicalCheckpointProof:false}));return;}
 if(mode==='recheck'){console.log(JSON.stringify({unchanged:snapshotCheck()}));return;}
 assert.equal(mode,'check');const r=await consistency();console.log(JSON.stringify({passed:r.passed,inputs:r.inputs,fullFits:r.fullFits,formalStatistics:r.statisticsSamples.length,seconds:r.elapsedMs/1000}));
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage4_8b-audit.ts'))await main();
