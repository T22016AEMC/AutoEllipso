import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {modelRegistry} from '../src/modelRegistry/registry';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {evaluateSubstrateOpticalConstants} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {refineDiagnostic} from './stage4_6d-refine';
import {evaluate,score,rms,mean} from './stage4_6d-run';
export {rms,mean};
export const prefix='.qa/stage4_7a-';
export const save=(name:string,v:unknown)=>writeFileSync(prefix+name+'.json',JSON.stringify(v,null,2));
export const read=(name:string)=>JSON.parse(readFileSync(prefix+name+'.json','utf8'));
// Execution control only: stop after a synchronous checkpoint write, before starting another fit.
function checkpointPause(checkpoint:string){if(existsSync(prefix+'pause-request.json')){save('graceful-pause',{checkpoint,at:new Date().toISOString()});process.exit(0);}}
const parameters=(model:string,values:Record<string,number>)=>({...Object.fromEntries(Object.entries(modelRegistry.createParameterSet(model)).map(([k,v])=>[k,v.current])),...values});
const truth=(id:string,model:string,values:Record<string,number>,extra={})=>({id,model,values:parameters(model,values),...extra});
export const settings={base:'79cd9512dd20bd58e398bbbc4d3b1b21b9cae852',studyDesignFrozen:true,
 truths:[truth('T0','cauchy',{A:1.52,B:.0042,C:.00008,k0:0}),
  truth('T1','tauc_lorentz',{eps_inf:2,A:80,E0:3.8,C:1.2,Eg:1.7,A2:0,A3:0}),
  truth('T2','gaussian',{eps_inf:2.4,A:1.7,E0:2.8,sigma:.38,A2:0,A3:0}),
  truth('T3','lorentz',{eps_inf:1.9,A:2.4,E0:3.2,gamma:.7,A2:0,A3:0}),
  truth('T4','gaussian',{eps_inf:2,A:1.6,E0:2.8,sigma:.36,A2:.9,E02:4.8,sigma2:.45,A3:0}),
  truth('T5','cauchy',{A:1.6,B:.0028,C:.00006,k0:0},{linearK:{start:700,end:900,max:.018}}),
  truth('T6','lorentz',{eps_inf:2.1,A:.8,E0:3.3,gamma:.12,A2:0,A3:0},{difficult:true})],
 selectionSeeds:[46001,46002,46003],outSeeds:[46004,46005],calibrationSeeds:Array.from({length:20},(_,i)=>47001+i),
 calibrationTruths:['T0','T2','T3'],calibrationGrids:['full','S1','S2'],
 grids:{full:{start:190,end:900,step:10,count:72},S1:{start:190,end:890,step:20,count:36},S2:{start:190,end:895,step:15,count:48}},
 aois:[65,70,75],thickness:100,sigma:.03,mainCounts:[40,60,80],scales:[1,.1,.01],sparseCounts:[12,16,20,24],
 ladder:[[40,1],[40,.1],[40,.01],[60,.01],[80,.01]],sparseLadder:[[12,1],[12,.1],[12,.01],[16,.01],[20,.01],[24,.01]],
 controls:'wavelength-uniform; lambdaN=.25s,lambdaK=.6s; n=.5..5.5,k=0..3.5,d=40..200; full training data,100 iterations,ftol=1e-5,unchanged xtol/gtol; unchanged stage4_6d-refine copy',
 rule:'pre-guard M<=N_eq/4 only; post-guard production statistics.dof>0; cost eligibility=result.converged AND status=cost; invalid cost/dof trial recorded and skipped, continue to next step; first eligible becomes best; later accept and continue only if best.BIC-trial.BIC>10, else stop; no truth or holdout used',
 fallback:'main all excluded:40,1 flagged even if ineligible; sparse baseline guard/dof invalid:no available candidate,no fallback; sparse all cost excluded with valid baseline dof:12,1 flagged; guard skips do not execute',
 criteriaFormula:'N*ln(max(1e-12,rawRSS)/N)+2p or p*ln(N); p=statistics.covariance.ids.length; full precision; fixed order ties; oracle minimum E over all nine fully completed fits including non-cost states (scoring only)',
 data:'LCG1664525/1013904223 uint32,(state+.5)/2^32; paired Box-Muller psi/delta per AOI then ascending wavelength; full72 synthesized, S1 filters every other full point; S2 synthesizes its48 wavelengths with fresh same-seed stream; truth independent of initialization; all curve/error evaluations full72 grid',
 physical:'each dataset one complete official Automatic, all trials same updatedLayers; default multi-AOI project initialization/config unchanged; matching target except T0/T5 Gaussian proxy as official Automatic does not support Cauchy final target',
 scheduling:'serial; main seven truths x three selection seeds, nine oracle fits only46001; others R0 plus ladder; sparse T2/T3/T4/T6 x S1/S2 seed46001; calibration T0/T2/T3 x full/S1/S2 x20 seeds; 209 Automatic datasets total; no holdout Automatic',
 reuse:'same dataset candidate fit cached and shared by R0/oracle/ladder; R1 logical walltime=sum elapsedMs of every attempted fit including rejected/non-cost trials, baseline included; no sequential warm starts',
 out:'main46001 all nine fits scored against46004/46005, average W and chiSquare/N; sparse46001 scored only full72 seed46004 including endpoint clamp; training p retained; gap>0.2 flagged; calibration holdouts not needed',
 errors:'E=sqrt((nRMS^2+kRMS^2)/2); full72 max/RMS globally and true k>=.001 / k<.001, absent region NA; thickness signed error; truth only in scoring after selection',
 variation:'main three seeds each R0/R1; per-wavelength sample SD (denominator2), RMS over72; bias=RMS(mean curve minus truth)',
 sigmaCalibration:'20 seeds per truth/grid; full R0=40,1 and R1; sparse R0=12,1 and R1s. Per-wavelength sample k SD denominator19; retain wavelengths with finite kSigma in all20 fits; ratio=RMS(sampleSD)/RMS(all reported sigma on those wavelengths); zero denominator=>NA; coverage=mean per-seed fraction |k-trueK|<=2sigma among finite sigma including0; count missing separately; per-wavelength raw diagnostics saved; each of9 truth/grid pairs must pass, unavailable=>not passed',
 criteria:{one:'main46001 near >=6/7, near E<=1.1*oracleE+.0001',two:'R1 E<=R0 E on every one of21 main selection datasets (no numerical slack)',three:'T1..T4 main46001 W<=1.3 AND mean Wout<=1.3; T6 separate',four:'all8 sparse studies selected available and dof>0, no attempted dof<=0',five:'ratio of mean total ladder refinement time to mean R0 refinement time across21 main selection datasets <=4; sparse/calibration/oracle extras excluded',six:'each of9 calibration truth/grid pairs R1 ratio in[.6,1.4], coverage>=R0-.10; unavailable fails',seven:'each8 sparse selected full-grid Wout46004 <=1.2*same-truth S1(12,1) full-grid Wout46004; S1 baseline shared acrossS1/S2; missing fails'},
 stop:'design or execution error after freeze:save error and stop; no design repair/re-run; full verify exactly once after completed experiments; compare failure names/details against4.6d'};
export const makeSetting=(count:number,scale:number)=>({count,scale,distribution:'wavelength',id:`${count}Ws${scale}`});
export const grid=settings.mainCounts.flatMap(m=>settings.scales.map(s=>makeSetting(m,s)));
export const wavelengths=(name:string)=>{const g=settings.grids[name as keyof typeof settings.grids];return Array.from({length:g.count},(_,i)=>g.start+i*g.step);};
export const frozenLines=[
 '# Stage 4.7a：自由形式精修的受限自適應選擇','',
 `基準 ${settings.base}，v2.2-integration；僅診斷腳本與報告，src/、正式容差/上限、斷言、部署設定不變。`,
 '本設計於新資料生成前固定；完整值及七真值全部參數見 .qa/stage4_7a-settings.json；固定文字副本 frozen-report.md、SHA256 frozen.json；此後不依結果調整。',
 '預檢六例副本對正式函式最大差2.9103830456733704e-11≤1e-9（僅排除elapsedMs與額外knots），27.7405197秒；equivalence.json。舊45001僅預檢，不進新研究。',
 '先前因稀疏護欄矛盾停止；本版採使用者修訂：全體僅 M≤N_eq/4、精修後正式statistics.dof>0；取消所有以波長數為上限的護欄。S2舊描述作廢。',
 'Si/100nm，AOI65/70/75°，σΨ=σΔ=.03°。主格190–900每10nm共72點；S1=190–890每20nm共36點；S2=190–895每15nm共48點。',
 '新真值（均加′）：T0 Cauchy A1.52/B.0042/C.00008/k0=0；T1 TL ε∞2/A80/E0=3.8/C1.2/Eg1.7；T2 Gaussian ε∞2.4/A1.7/E0=2.8/σ.38。',
 'T3 Lorentz ε∞1.9/A2.4/E0=3.2/γ.7；T4雙Gaussian ε∞2/A1.6/E0=2.8/σ.36及A2=.9/E02=4.8/σ2=.45；未啟用振子A=0，完整預設亦凍結。',
 'T5 Cauchy A1.6/B.0028/C.00006的n，加700–900線性k至.018；T6困難窄Lorentz ε∞2.1/A.8/E0=3.3/γ.12（比T3 γ.7窄）。均與4.5/4.5c不同。',
 '選擇種子46001–46003；樣本外46004/46005不選解。校準47001–47020。雜訊沿用LCG/Box-Muller；S1取主格隔點，S2獨立48格同種子串流。',
 '主候選40/60/80 × s=1/.1/.01共9組；波長等距，λN=.25s/λK=.6s；全資料100次、ftol=1e-5、原xtol/gtol；n=.5–5.5/k=0–3.5/d=40–200。',
 '每資料集完整正式Automatic一次；共21主選擇+8稀疏+180校準=209次，串行；全候選同updatedLayers起點。T0/T5採Gaussian代理，其餘匹配族；不從前一階梯解暖啟動。',
 '46001主資料全9組oracle只評分；R0=(40,1)。R1=(40,1)→(40,.1)→(40,.01)→(60,.01)→(80,.01)。',
 'R1/R1s：需converged且status=cost與dof>0才可接受；無效試次記錄並跳至下一步；首個合法解為best；其後BIC降低嚴格>10才接受並繼續，否則停止。',
 '主階梯全排除則退回(40,1)並標記。稀疏一律只用R1s=(12,1)→(12,.1)→(12,.01)→(16,.01)→(20,.01)→(24,.01)，不跑40/60/80。',
 '稀疏(12,1)若違反前/後護欄則無可用候選、不fallback；若全為非cost而基準dof合法，退回(12,1)並標記。護欄略過不執行。',
 'p=正式statistics.covariance.ids.length；AIC=N ln(max(1e-12,rawRSS)/N)+2p；BIC加p lnN，未四捨五入。W=正式MSE_W，並列χ²/N；護欄讀真正statistics.dof，不讀metrics夾值。',
 'E=sqrt((nRMS²+kRMS²)/2)，全72格評分；n/k max/RMS分全域、真k≥.001與近透明；無區域NA；d誤差另列，真值僅評分。',
 '主46001全9組對46004/5評W與χ²/N後平均；稀疏對完整72格46004評分含900端點夾值。均沿用訓練p；gap=Wout−Win>.2標記。',
 '三種子變異=逐波長樣本SD（分母2）的RMS；偏差=平均曲線對真值RMS。R0、R1各算；特列T3/T6。',
 'σ校準T0/T2/T3，各full/S1/S2各20種子。主R0/R1；稀疏以(12,1)為R0對R1s，以保留稀疏判準6；共9對比較。',
 'std/σ=全20次皆有有限kSigma的波長上，RMS(逐波長k樣本SD)/RMS(全部報告σ)；SD分母19；σ全0則NA。涵蓋率=每種子有限σ的±2σ涵蓋率平均，含σ=0；缺失另計，無資料不算通過。',
 '判準1：主46001至少6/7相近，E≤1.10×九組最低E+.0001（oracle含所有完成狀態，只評分）。',
 '判準2：21個主選擇資料集R1 E均不得大於R0，零額外容差。判準3：T1–T4主46001 W與平均Wout均≤1.3；T6單列不計。',
 '判準4：8稀疏案例均有選解、dof>0，且沒有試次dof≤0。判準5：21主資料平均階梯總精修牆鐘≤R0平均4倍（含所有拒絕/排除試次，與oracle共用相同單次實測，無重複計算）。',
 '判準6：9個真值×格點校準皆R1 std/σ∈[.6,1.4]且涵蓋率≥R0−.10。判準7：8稀疏Wout皆≤同真值S1(12,1)基準Wout的1.2倍；S2亦比較36點基準；缺值不通過。',
 '稀疏不納入1–3與5，納入4/6/7；其餘不放寬。候選共用快取；階梯時間按每個實際嘗試加總含基準、最終統計，不含Automatic/正向評分；總計與每資料集均留原始JSON。',
 '原始/逐點/逐設定 .qa/stage4_7a-* 不入repo；設計錯誤停止，不修後重跑；結束完整verify僅一次，比對4.6d兩項既有失敗。','',
];
export function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src','.github','wrangler.jsonc','.node-version','package.json','pnpm-lock.yaml'],{encoding:'utf8'}),'');}
export function fixture(id:string,seed:number,gridName='full'){
 const t=settings.truths.find(t=>t.id===id)!;assert.ok(t);
 const project=createMultiAoiSiO2OnSiProject(),model=modelRegistry.get(t.model)!,ambient=new Complex(project.ambient.n,project.ambient.k);
 const optical=(wavelength:number)=>{const q=model.calculate(wavelength,t.values);return {wavelength,...q,k:id==='T5'?Math.max(0,(wavelength-700)/200)*.018:q.k};};
 let state=seed;const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 const sampling=wavelengths(gridName==='S1'?'full':gridName);
 const points=settings.aois.flatMap(aoi=>sampling.map(wavelength=>{const q=optical(wavelength),v=solveEllipsometryTMM(ambient,[{thicknessNm:100,N:new Complex(q.n,q.k)}],evaluateSubstrateOpticalConstants(project.substrate,wavelength),wavelength,aoi),r=Math.sqrt(-2*Math.log(rng())),a=2*Math.PI*rng();return {id:`${aoi}-${wavelength}`,wavelength,aoi,psiExp:v.psiDeg+.03*r*Math.cos(a),deltaExp:normalizeDeltaDeg(v.deltaDeg+.03*r*Math.sin(a)),psiSigma:.03,deltaSigma:.03};})).filter(p=>gridName!=='S1'||(p.wavelength-190)%20===0);
 assert.equal(points.length,settings.grids[gridName as keyof typeof settings.grids].count*3);
 return {truth:t,project,points,optics:wavelengths('full').map(optical)};
}
// Rule decisions intentionally receive no curves, truth errors or holdout metrics.
export function eligible(r:any){return r.dof>0&&r.converged&&r.status==='cost';}
export async function choose(steps:ReturnType<typeof makeSetting>[],N:number,sparse:boolean,get:(g:ReturnType<typeof makeSetting>)=>Promise<any>){
 const trials:any[]=[];let best:any=null,baseline:any=null;
 for(const [i,g] of steps.entries()){
  if(g.count>N/4){trials.push({setting:g.id,skipped:'M>N_eq/4'});if(sparse&&i===0)return {selected:null,trials,fallback:false,reason:'no available candidate'};continue;}
  const r=await get(g);if(i===0)baseline=r;
  const accepted=eligible(r)&&(!best||best.bic-r.bic>10);
  trials.push({setting:g.id,dof:r.dof,status:r.status,converged:r.converged,bic:r.bic,eligible:eligible(r),accepted,elapsedMs:r.elapsedMs});
  if(sparse&&i===0&&r.dof<=0)return {selected:null,trials,fallback:false,reason:'no available candidate'};
  if(!eligible(r))continue;
  if(!accepted)break;best=r;
 }
 return {selected:best?.setting.id??baseline?.setting.id??null,trials,fallback:!best,reason:best?'BIC ladder':'all excluded; baseline fallback'};
}
async function selfCheck(){
 assert.equal(grid.length,9);assert.deepEqual(['full','S1','S2'].map(g=>wavelengths(g).length),[72,36,48]);assert.equal(wavelengths('S2').at(-1),895);
 const steps=settings.ladder.map(([m,s])=>makeSetting(m,s)),fake=(g:any,bic:number,status='cost',dof=350)=>({setting:g,bic,status,dof,converged:status==='cost',elapsedMs:1});
 let calls=0;const r=await choose(steps,432,false,async g=>fake(g,100-10*calls++));assert.equal(r.selected,'40Ws1');assert.equal(calls,2,'BIC delta exactly10 must stop');
 const q=await choose(steps,432,false,async g=>fake(g,1,'step'));assert.equal(q.fallback,true);assert.equal(q.trials.length,5);
 const s=await choose(settings.sparseLadder.map(([m,s])=>makeSetting(m,s)),40,true,async()=>{throw Error('guard must skip');});assert.equal(s.selected,null);
 const d=await choose(settings.sparseLadder.map(([m,s])=>makeSetting(m,s)),216,true,async g=>fake(g,1,'cost',0));assert.equal(d.selected,null);assert.equal(d.trials.length,1);
 assert.ok(settings.truths[6].values.gamma<settings.truths[3].values.gamma);
}
async function dataset(id:string,seed:number,gridName:string,oracle=false){
 const key=`${id}-${seed}-${gridName}`,file=prefix+key+'-dataset.json';if(existsSync(file))return read(key+'-dataset');
 const f=fixture(id,seed,gridName),N=2*f.points.length,start=performance.now();console.log(`START ${key}`);
 save(key+'-data',{points:f.points,optics:f.optics});
 const autoStart=performance.now(),savedAutomatic=existsSync(prefix+key+'-automatic.json')?read(key+'-automatic'):null;
 const automatic=savedAutomatic?.output??await runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:['T0','T5'].includes(id)?'gaussian':f.truth.model,selectedAois:settings.aois});
 const automaticMs=savedAutomatic?.automaticMs??performance.now()-autoStart;if(!savedAutomatic)save(key+'-automatic',{automaticMs,output:automatic});
 checkpointPause(key+'-automatic');
 const cache=new Map<string,any>();
 const get=async(g:ReturnType<typeof makeSetting>)=>{
  if(cache.has(g.id))return cache.get(g.id);
  if(existsSync(prefix+key+'-'+g.id+'.json')){const saved=read(key+'-'+g.id);cache.set(g.id,saved);return saved;}
  const out=await refineDiagnostic(g,{ambient:f.project.ambient,layers:automatic.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig,outputWavelengths:wavelengths('full')});
  const p=out.statistics.covariance.ids.length,bic=N*Math.log(Math.max(1e-12,out.metrics.rawMse*N)/N)+p*Math.log(N);
  const check=evaluate(f,out,f.points,p);assert.ok(Math.abs(check.chiSquare-out.metrics.chiSquare)<1e-8*Math.max(1,check.chiSquare),'independent forward metric');
  const r={setting:g,N,p,dof:out.statistics.dof,bic,aic:bic-p*Math.log(N)+2*p,metrics:out.metrics,totalCost:out.result.finalCost,status:out.result.status,converged:out.result.converged,iterations:out.result.iterations,elapsedMs:out.elapsedMs,out};cache.set(g.id,r);save(key+'-'+g.id,r);checkpointPause(key+'-'+g.id);return r;
 };
 const sparse=gridName!=='full',steps=(sparse?settings.sparseLadder:settings.ladder).map(([m,s])=>makeSetting(m,s));
 // Execute selection before oracle extras and all truth/holdout scoring.
 const selection=await choose(steps,N,sparse,get),r0=await get(steps[0]);
 if(oracle)for(const g of grid)await get(g);
 for(const r of cache.values()){
  const scored=score(f,r.out);const oos=seed===46001?(sparse?[46004]:settings.outSeeds).map(s=>evaluate(f,r.out,fixture(id,s).points,r.p)):[];
  Object.assign(r,{score:scored,oos,oosW:mean(oos.map(m=>m.mseWoollam)),oosChiN:mean(oos.map(m=>m.weightedMse))});
  r.gap=r.oosW===null?null:r.oosW-r.metrics.mseWoollam;save(key+'-'+r.setting.id,r);
 }
 const selected=selection.selected?cache.get(selection.selected):null;
 const result={id,seed,gridName,N,r0:r0.setting.id,selection,selected:selection.selected,automaticMs,refinementMs:[...cache.values()].reduce((s,r)=>s+r.elapsedMs,0),r0Ms:r0.elapsedMs,ladderMs:selection.trials.reduce((s,t)=>s+(t.elapsedMs??0),0),wallMs:performance.now()-start,settings:[...cache.keys()],selectedE:selected?.score.error??null};
 save(key+'-dataset',result);console.log('DONE '+JSON.stringify({...result,selection:undefined,settings:undefined}));return result;
}
async function main(){
 guard();await selfCheck();const mode=process.argv[2];
 if(mode==='prepare'){
  assert.ok(!existsSync(prefix+'frozen.json'),'already frozen');assert.ok(read('equivalence').checks.every((c:any)=>c.passed)&&read('equivalence').checks.length===6);
  mkdirSync('.qa',{recursive:true});save('settings',settings);const text=frozenLines.join('\n')+'\n';writeFileSync('STAGE4_7A_REPORT.md',text+'結果尚未產生。\n');writeFileSync(prefix+'frozen-report.md',text);
  save('frozen',{settingsSha256:createHash('sha256').update(readFileSync(prefix+'settings.json')).digest('hex'),timestamp:new Date().toISOString()});console.log('DESIGN FROZEN; no new data generated');return;
 }
 assert.deepEqual(read('settings'),settings);assert.equal(createHash('sha256').update(readFileSync(prefix+'settings.json')).digest('hex'),read('frozen').settingsSha256);
 if(mode==='self-check'){console.log('SELF CHECK PASS; no new data generated');return;}
 assert.equal(mode,'run');const start=performance.now(),all:any[]=[];
 try{
  for(const t of settings.truths)for(const seed of settings.selectionSeeds)all.push(await dataset(t.id,seed,'full',seed===46001));
  for(const id of ['T2','T3','T4','T6'])for(const g of ['S1','S2'])all.push(await dataset(id,46001,g));
  for(const id of settings.calibrationTruths)for(const g of settings.calibrationGrids)for(const seed of settings.calibrationSeeds)all.push(await dataset(id,seed,g));
  assert.equal(all.length,209);save('execution',{datasets:all,wallMs:performance.now()-start,completedDatasetWallMs:all.reduce((s,d)=>s+d.wallMs,0),finished:new Date().toISOString()});guard();console.log('EXPERIMENTS COMPLETE');
 }catch(e){save('stopped',{error:String(e),stack:(e as Error).stack,wallMs:performance.now()-start});throw e;}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage4_7a-run.ts'))await main();
