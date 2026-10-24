import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fixture,regional} from './stage4_5c-support';
import {refineDiagnostic} from './stage4_6d-refine';
import {refineFreeForm} from '../src/fitting/freeFormRefine';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {evaluateSubstrateOpticalConstants} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {computeResidualMetrics} from '../src/fitting/residual';
import {cubicBasis} from '../src/models/cubicSpline';
import {solveLeastSquaresSvd} from '../src/fitting/svd';

export const settings={base:'522131a4c9b22b30b627ce62a71904f26293af0a',seeds:[45001,45002,45003],truths:['T0','T1','T2','T3','T4','T5'],
 counts:[40,60,80,120],distributions:['wavelength','energy'],scales:[.01,.1,1],
 controls:'full data;100 iterations;ftol=1e-5;unchanged xtol/gtol;N=.5..5.5,K=0..3.5,d=40..200;lambdaN=.25*s,lambdaK=.6*s',
 energy:'locations uniform in 1/wavelength, ascending wavelength; cubic basis remains in wavelength; same coefficient second-difference penalty, no spacing normalization',
 effective:'production statistics.covariance.ids.length (boundary exclusions; not smoothing hat-matrix trace)',
 criteria:'unrounded production compareOpticalModels convention: N*ln(rawRSS/N)+2p or p*ln(N); ties fixed grid order',
 outOfSample:'45001 fit evaluated on independent 45002/45003; same p as training for comparable W; also chiSquare/N',
 cv:'two folds of seed45001 alternating whole wavelengths (all AOIs together); train complement, held-out chiSquare pooled; score sqrt(sumChiSquare/N), p=0; all settings start from common full-data P1; initialization leakage explicitly retained; 45002/3 never select',
 truthScore:'E=sqrt((nRMS^2+kRMS^2)/2); thickness separately; near=E<=1.10*minimumE+0.0001; diagnostic only',
 overfit:'notable if Wout-Win>0.2; variance notable if n or k RMS SD >2x current40-wavelength-1; descriptive, no acceptance assertions',
 coverage:'mean of three per-seed finite kSigma coverage fractions for abs(error)<=2sigma; availability separately; missing regions null',
 roughness:'L2 norm of second differences of n/k on common full10nm grid divided by truth norm; zero truth norm gives null plus absolute norm',
 sparse:'T2/T3/T4 seed45001;M80/120,both distributions,s=.01;190..890 by20;reuse full-grid P1;full10nm seed45002 evaluation including 900 endpoint clamp',
 timing:'serial wall clock refinement including final statistics; excludes common Automatic and evaluation; fixed grid order, JIT/cache effects'};
export const grid=settings.counts.flatMap(count=>settings.distributions.flatMap(distribution=>settings.scales.map(scale=>({count,distribution,scale,id:`${count}${distribution==='wavelength'?'W':'E'}s${scale}`}))));
export const save=(name:string,v:unknown)=>{mkdirSync('.qa',{recursive:true});writeFileSync(`.qa/stage4_6d-${name}.json`,JSON.stringify(v,null,2));};
export const read=(name:string)=>JSON.parse(readFileSync(`.qa/stage4_6d-${name}.json`,'utf8'));
export const rms=(a:number[])=>a.length?Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length):null;
export const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src','.github','wrangler.jsonc','.node-version','package.json','pnpm-lock.yaml'],{encoding:'utf8'}),'');}
export function data(id:string,seed:number){
 const f=fixture(id);let state=seed;const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 const ambient=new Complex(f.project.ambient.n,f.project.ambient.k);
 const points=f.points.map((p:any)=>{const q=f.optics.find((q:any)=>q.wavelength===p.wavelength),v=solveEllipsometryTMM(ambient,[{thicknessNm:100,N:new Complex(q.n,q.k)}],evaluateSubstrateOpticalConstants(f.project.substrate,p.wavelength),p.wavelength,p.aoi),r=Math.sqrt(-2*Math.log(rng())),a=2*Math.PI*rng();return {...p,psiExp:v.psiDeg+.03*r*Math.cos(a),deltaExp:normalizeDeltaDeg(v.deltaDeg+.03*r*Math.sin(a))};});
 if(seed===45001)for(let i=0;i<points.length;i++)for(const key of ['psiExp','deltaExp'])assert.ok(Math.abs(points[i][key]-f.points[i][key])<=1e-12,'fixture seed replay');
 // Preserve exact original arithmetic for the main seed and historical equivalence.
 return {...f,points:seed===45001?f.points:points};
}
export function evaluate(f:any,out:any,points:any[],p:number){
 const count=out.knots.length,v=out.result.finalParams,ambient=new Complex(f.project.ambient.n,f.project.ambient.k);
 const evaluated=points.map(pt=>{const b=cubicBasis(pt.wavelength,out.knots),n=b.reduce((s,x,i)=>s+x*v[i+1],0),k=b.reduce((s,x,i)=>s+x*v[count+i+1],0),c=solveEllipsometryTMM(ambient,[{thicknessNm:v[0],N:new Complex(n,k)}],evaluateSubstrateOpticalConstants(f.project.substrate,pt.wavelength),pt.wavelength,pt.aoi);return {...pt,psiCalc:c.psiDeg,deltaCalc:c.deltaDeg};});
 return computeResidualMetrics(evaluated,f.project.fittingConfig.fitWeighting,1,1,p);
}
export function score(f:any,out:any){
 const rows=out.curve.map((q:any,i:number)=>({...q,trueN:f.optics[i].n,trueK:f.optics[i].k,nError:q.n-f.optics[i].n,kError:q.k-f.optics[i].k})),regions=regional(rows),a=regions.all;
 const roughness=Object.fromEntries(['n','k'].map(key=>{const norm=(c:any[])=>Math.sqrt(c.slice(1,-1).reduce((s,q,i)=>s+(c[i+2][key]-2*q[key]+c[i][key])**2,0)),fitted=norm(out.curve),truth=norm(f.optics);return [key,{fitted,truth,ratio:truth>0?fitted/truth:null}];}));
 assert.ok(a.nRms!==null&&a.kRms!==null);
 return {regions,error:Math.sqrt((a.nRms**2+a.kRms**2)/2),thicknessError:out.result.finalParams[0]-100,roughness};
}
function maxDifference(a:any,b:any):number {
 if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b);
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){assert.deepEqual(a,b);return 0;}
 assert.deepEqual(Object.keys(a),Object.keys(b));return Math.max(0,...Object.keys(a).filter(k=>k!=='elapsedMs').map(k=>maxDifference(a[k],b[k])));
}
async function equivalence(){
 const checks=[];
 for(const id of settings.truths){const f=data(id,45001),old=JSON.parse(readFileSync(`.qa/stage4_5d-${id}.json`,'utf8')).output,o={ambient:f.project.ambient,layers:old.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig,outputWavelengths:old.fittingResult.freeFormOpticalConstants.map((q:any)=>q.wavelength)};
  const formal=await refineFreeForm(o),copy=await refineDiagnostic({count:40,distribution:'wavelength',scale:1},o);
  const {knots,...copyFormal}=copy;
  const difference=maxDifference(formal,copyFormal);
  // Compare every historical coefficient/curve point, metrics and objective, not rounded report numbers.
  const historical=old.fittingResult.freeFormModel.variables.map((v:any)=>v.value),serialized=(v:any)=>JSON.parse(JSON.stringify(v));
  const historicalDifference=Math.max(...copy.result.finalParams.map((v:number,i:number)=>Math.abs(v-historical[i])),Math.abs(copy.metrics.mseWoollam-old.fittingResult.freeFormRefinement.physicalSeeded.mseWoollam),
   maxDifference(serialized(copy.statistics),old.fittingResult.freeFormStatistics),maxDifference(serialized(copy.model),old.fittingResult.freeFormModel),
   maxDifference(serialized(copy.coefficientBounds),old.fittingResult.freeFormCoefficientBounds),
   maxDifference(serialized(copy.curve),old.fittingResult.freeFormOpticalConstants.map(({freeFormOrigin,...q}:any)=>q)));
  assert.ok(difference<=1e-9&&historicalDifference<=1e-9);checks.push({id,difference,historicalDifference});
 }
 save('equivalence',checks);console.log('EQUIVALENCE '+JSON.stringify(checks));
}
async function main(){
 guard();const mode=process.argv[2];
 if(mode==='check'){
  assert.deepEqual(read('settings'),settings);
  assert.deepEqual(solveLeastSquaresSvd([[1,0],[0,0]],[2,0]).solution,[2,0],'Zero equations preserve the minimum-norm underdetermined projection');
  await equivalence();return;
 }
 if(mode==='prepare'){
  assert.equal(grid.length,24);assert.equal(new Set(grid.map(g=>g.id)).size,24);
  assert.deepEqual(solveLeastSquaresSvd([[1,0],[0,0]],[2,0]).solution,[2,0],'Zero equations preserve the minimum-norm underdetermined projection');
  save('settings',settings);writeFileSync('STAGE4_6D_REPORT.md',`# Stage 4.6d：自由形式殘差下限診斷\n基準 ${settings.base}。以下定義於執行前固定，完整設定亦保存於 .qa/stage4_6d-settings.json。\n${Object.entries(settings).map(([k,v])=>`- ${k}: ${JSON.stringify(v)}`).join('\n')}\n結果尚未產生。\n`);
  // Exclude the extra diagnostic knots key when checking production return shape.
  await equivalence();return;
 }
 assert.deepEqual(read('settings'),settings);assert.equal(read('equivalence').length,6);
 if(mode==='automatic'){
  for(const id of settings.truths)for(const seed of settings.seeds){const f=data(id,seed),start=performance.now();console.log(`AUTO START ${id} ${seed}`);
   const output=await runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:['T0','T5'].includes(id)?'gaussian':f.truth.model,selectedAois:[65,70,75]});
   save(`${id}-${seed}-formal`,{output,elapsedMs:performance.now()-start});console.log(`AUTO DONE ${id} ${seed}`);
  }return;
 }
 assert.ok(settings.truths.includes(mode));const id=mode;
 for(const seed of settings.seeds){const f=data(id,seed),formal=read(`${id}-${seed}-formal`),options={ambient:f.project.ambient,layers:formal.output.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig,outputWavelengths:f.optics.map((q:any)=>q.wavelength)};
  for(const g of grid){const name=`${id}-${seed}-${g.id}`;if(existsSync(`.qa/stage4_6d-${name}.json`))continue;
   const out=await refineDiagnostic(g,options),p=out.statistics.covariance.ids.length,N=2*f.points.length;
   const check=evaluate(f,out,f.points,p);assert.ok(Math.abs(check.chiSquare-out.metrics.chiSquare)<1e-8*Math.max(1,check.chiSquare),'independent forward objective');
   const criteria={aic:N*Math.log(Math.max(1e-12,out.metrics.rawMse*N)/N)+2*p,bic:N*Math.log(Math.max(1e-12,out.metrics.rawMse*N)/N)+p*Math.log(N)};
   const oos=seed===45001?[45002,45003].map(s=>evaluate(f,out,data(id,s).points,p)):[];
   const cv=[];
   if(seed===45001)for(const parity of [0,1]){const training=f.points.filter((q:any)=>((q.wavelength-190)/10)%2!==parity),test=f.points.filter((q:any)=>((q.wavelength-190)/10)%2===parity),r=await refineDiagnostic(g,{...options,points:training});cv.push({metrics:evaluate(f,r,test,0),elapsedMs:r.elapsedMs,status:r.result.status,iterations:r.result.iterations,converged:r.result.converged});}
   const row={id,seed,setting:g,metrics:out.metrics,criteria,effective:p,N,totalCost:out.result.finalCost,iterations:out.result.iterations,status:out.result.status,converged:out.result.converged,elapsedMs:out.elapsedMs,score:score(f,out),oos,cv,cvScore:cv.length?Math.sqrt(cv.reduce((s,r)=>s+r.metrics.chiSquare,0)/N):null,out};
   save(name,row);console.log('FIT '+JSON.stringify({id,seed,g:g.id,W:row.metrics.mseWoollam,E:row.score.error,status:row.status,ms:row.elapsedMs}));
  }
 }
 if(['T2','T3','T4'].includes(id)){const f=data(id,45001),formal=read(`${id}-45001-formal`);for(const g of grid.filter(g=>g.count>=80&&g.scale===.01)){
  const name=`${id}-sparse-${g.id}`;if(existsSync(`.qa/stage4_6d-${name}.json`))continue;
  const out=await refineDiagnostic(g,{ambient:f.project.ambient,layers:formal.output.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points.filter((q:any)=>(q.wavelength-190)%20===0),config:f.project.fittingConfig,outputWavelengths:f.optics.map((q:any)=>q.wavelength)});
  save(name,{id,setting:g,metrics:out.metrics,score:score(f,out),oos:evaluate(f,out,data(id,45002).points,out.statistics.covariance.ids.length),elapsedMs:out.elapsedMs,out});console.log(`SPARSE ${id} ${g.id}`);
 }}guard();
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage4_6d-run.ts'))await main();
