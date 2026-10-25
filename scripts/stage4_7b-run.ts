import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {modelRegistry} from '../src/modelRegistry/registry';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {evaluateSubstrateOpticalConstants} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {refineFreeForm} from '../src/fitting/freeFormRefine';
import {solveLeastSquaresSvd} from '../src/fitting/svd';
import {refineDiagnostic} from './stage4_6d-refine';
import {data as legacyData,evaluate,score,mean,rms} from './stage4_6d-run';
export {mean,rms};
export const prefix='.qa/stage4_7b-';
export const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export const read=(name:string)=>JSON.parse(readFileSync(prefix+name+'.json','utf8'));
export function save(name:string,value:unknown){const file=prefix+name+'.json';writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(file+'.tmp',file);}
const truth=(id:string,model:string,values:Record<string,number>,extra={})=>({id,model,values:{...Object.fromEntries(Object.entries(modelRegistry.createParameterSet(model)).map(([k,v])=>[k,v.current])),...values},...extra});
export const settings={base:'0884dcdcddf360346f563228d38deabb6c14e490',
 truths:[truth('U0','cauchy',{A:1.49,B:.0051,C:.00012,k0:0}),
  truth('U1','tauc_lorentz',{eps_inf:1.7,A:90,E0:3.6,C:1.35,Eg:1.6,A2:0,A3:0}),
  truth('U2','gaussian',{eps_inf:2.15,A:1.85,E0:2.65,sigma:.34,A2:0,A3:0}),
  truth('U3','lorentz',{eps_inf:2.05,A:2.7,E0:3.65,gamma:.62,A2:0,A3:0}),
  truth('U4','gaussian',{eps_inf:2.3,A:1.45,E0:2.7,sigma:.42,A2:1.1,E02:4.35,sigma2:.5,A3:0}),
  truth('U5','cauchy',{A:1.57,B:.0031,C:.00007,k0:0},{linearK:{start:700,end:900,max:.016}}),
  truth('U6','lorentz',{eps_inf:2.25,A:1.9,E0:2.95,gamma:.58,A2:1.25,E02:4.65,gamma2:.82,A3:0})],
 selectionSeeds:[48001,48002,48003],outSeeds:[48004,48005],counts:[40,60,80],scales:[1,.1,.01],
 wavelengths:Array.from({length:72},(_,i)=>190+10*i),aois:[65,70,75],thickness:100,sigma:.03,
 ladder:[[40,1],[40,.1],[40,.01],[60,.01],[80,.01]],rules:['R0','R1','R1a','R1b','R1c'],
 matched:['U1','U2','U3','U4','U6'],
 controls:'wavelength-uniform; lambdaN=.25s,lambdaK=.6s; n=.5..5.5,k=0..3.5,d=40..200; full training data,100 iterations,ftol=1e-5,unchanged xtol/gtol; unchanged stage4_6d-refine diagnostic copy; zero-row projection and uncapped forward metrics',
 legal:'M<=N_eq/4 before fitting/selection, N_eq=2*point count (432); production statistics.dof>0 AND converged AND status=cost; invalid trials recorded and skipped without early stop; first eligible is initial best; all invalid=>40,1 fallback flagged; R0 always40,1 with invalid/fallback flag',
 rulesDefinition:{R0:'40,1 only',R1:'fixed five-step ladder; accept if previous best BIC minus candidate BIC >10, else stop',R1a:'same; threshold strictly>2',R1b:'all five steps; minimum BIC among eligible; exact ties retain earlier',R1c:'all five steps; update only if best formal W minus candidate formal W >.05; exact ties retain earlier; BIC never decides'},
 criteriaFormula:'N ln(max(1e-12,rawRSS)/N)+2p or p lnN; p=statistics.covariance.ids.length; use unrounded numbers; regularization is excluded from rawRSS and N; oracle minimum E over nine completed fits including non-cost states, scoring only',
 data:'LCG1664525/1013904223 uint32,(state+.5)/2^32; paired Box-Muller psi/delta per AOI then ascending wavelength; direct TMM Si/100nm; output/errors all72 measured wavelengths; U5 transparent Cauchy n plus max(0,(wl-700)/200)*.016',
 physical:'one full official Automatic per each of21 selection datasets; default multi-AOI project initialization/config unchanged; all candidates same saved physical updatedLayers; U0/U5 Gaussian proxy, others matching modelId (U6 dual Lorentz is a matching Lorentz family and included in criterion3); no truth parameters in initialization; no warm starts between candidates',
 scheduling:'serial phases:0 freeze and legacy equivalence;1 all21 Automatic;2 all63 oracle refinements for48001;3 remaining70 ladder refinements for48002/3 plus all105 rule decisions and scoring;4 full verify exactly once. Total133 unique refinements. Cached results shared, no rerun of saved input/Automatic/fit/evaluation/rule dataset',
 selectionIsolation:'rules receive only setting,N,p,dof,status,converged,BIC,formal W and elapsedMs; never truth errors or holdout data; score only after choices are fixed; all nine oracle extras ignored by rules except the fixed five ladder members',
 out:'48001 every candidate evaluated on48004 and48005; arithmetic mean W and chiSquare/N; retain training p; gap=mean Wout-Win>.2 flags; holdouts never choose; no holdout Automatic',
 score:'E=sqrt((nRMS^2+kRMS^2)/2), signed thickness error; n/k max/RMS global and true k>=.001 / k<.001 regions, missing=>NA; curve values and sigma diagnostics retained as supplied, no recalibration',
 classes:'primary48001 only: near=E<=1.10*minimum nine E+1e-4; absolute=E<=minimum nine E+1e-4; secondary seeds near=NA. All21 delta=E_rule-E_R0: abs(delta)<1e-4 noise, abs(delta)>1e-4 beyond, exact equality separate; positive/negative signs retained, no rounding for decisions',
 variation:'each truth/rule across3 selection seeds; per-wavelength sample SD denominator2 then RMS over72; bias=RMS(mean curve minus truth); consistency exact same selected setting across3, fallback counted as selected and flagged separately',
 timing:'each rule sums elapsedMs of all steps it would try, including baseline, rejected and invalid fits; guard-skipped steps cost0; shared single measured calls, not repeat runs; mean and total across21 vs R0; fit walltime includes final statistics. Phase times=sum saved measured Automatic/fit/scoring calls; exclude idle/pause and unknown abandoned work, record interruptions separately',
 criteria:{one:'primary48001 near>=6/7',two:'among21 datasets, count(delta E>1e-4)=0',three:'U1/U2/U3/U4/U6 primary48001 W<=1.3 AND mean Wout<=1.3, all five required',four:'mean total rule refinement walltime <=4*mean R0 across21',five:'selected setting identical across3 seeds for>=6/7 truths'},
 winner:'only if multiple rules pass all5 criteria list lowest mean measured logical refinement time; exact time ties list all; no adoption decision',
 equivalence:'legacy T0..T5 seed45001 from4.5d saved physical updatedLayers; compare complete formal vs diagnostic40-wavelength-1 output recursively excluding only elapsedMs and extra diagnostic knots; tolerance1e-9; preflight only, never new-study data; zero-row SVD assertion',
 checkpoints:'atomic JSON writes; reuse saved results without overwriting; pause-request.json exits immediately after next saved Automatic/refinement/rule checkpoint; no partial results accepted; design/runtime error saves stopped.json and stops, no repair-and-rerun',
 verification:'pnpm run verify exactly once after complete experiments; compare names/details against stage4_7a scientific failures, separately identify new names or changed details; never change tests/tolerances/config'};
export const makeSetting=(count:number,scale:number)=>({count,scale,distribution:'wavelength',id:`${count}Ws${scale}`});
export const grid=settings.counts.flatMap(m=>settings.scales.map(s=>makeSetting(m,s)));
export const ladder=settings.ladder.map(([m,s])=>makeSetting(m,s));
export const settingsText=JSON.stringify(settings,null,2)+'\n';
export const frozenLines=[
 '# Stage 4.7b：自由形式階梯停止規則診斷','',
 `基準${settings.base}，v2.2-integration；只新增診斷腳本與報告。src/、正式容差/上限、既有斷言及部署設定不變。`,
 `新資料前固定設計；settings.json SHA256=${sha(settingsText)}；原始全在 .qa/stage4_7b-*（不入repo）。`,
 '報告設計原文frozen-report.md亦在新資料前計SHA256，見frozen.json；以下設定與判準不依結果調整，設計錯誤即停，不修後重跑。',
 'Si/100nm，AOI65/70/75°，190–900每10nm共72波長，σΨ=σΔ=.03°；選擇48001–48003，樣本外48004/5不選解；LCG/Box-Muller同4.7a。',
 '全新真值：U0 Cauchy A1.49/B.0051/C.00012/k0=0；U1 TL ε∞1.7/A90/E0=3.6/C1.35/Eg1.6；U2 Gaussian ε∞2.15/A1.85/E0=2.65/σ.34。',
 'U3 Lorentz ε∞2.05/A2.7/E0=3.65/γ.62；U4雙Gaussian ε∞2.3/A1.45/E0=2.7/σ.42，加A2=1.1/E02=4.35/σ2=.5（間距1.65eV，強度比.75862；4.7a為2eV/.5625）。',
 'U5 Cauchy A1.57/B.0031/C.00007的n，加700–900線性k至.016；U6雙Lorentz ε∞2.25/A1.9/E0=2.95/γ.58，加A2=1.25/E02=4.65/γ2=.82。無窄峰案例；完整參數含停用振子預設均在settings。',
 '21資料集各完整正式Automatic一次；U0/U5採Gaussian代理，其餘匹配modelId；U6列為匹配Lorentz族，判準3包含U1–U4及U6五例。所有候選從同一物理updatedLayers出發。',
 '候選M=40/60/80 × s=1/.1/.01共9組，波長等距；λN=.25s/λK=.6s；n=.5–5.5/k=0–3.5/d=40–200；全資料100次、ftol=1e-5、原xtol/gtol。',
 '沿用4.6d副本的零方程補足行數與避開bspline40上限；新資料前先以六個舊控制逐值重驗正式函式，僅排除elapsedMs/額外knots，門檻1e-9，未通過即停。',
 'R0=(40,1)；其餘階梯(40,1)→(40,.1)→(40,.01)→(60,.01)→(80,.01)。合法：M≤N_eq/4（N_eq=432），且正式statistics.dof>0、converged、status=cost。',
 'R1 BIC嚴格降低>10、R1a >2才接受並繼續，否則停；R1b走完五步取合法BIC最低；R1c走完五步，只有W比目前best低>.05才更新，不用BIC。',
 '首個合法解為best；無效試次記錄並跳過不早停；精確相同保留較早設定；全部無效退回(40,1)並標記。R0固定基準，無效亦標記。全部規則共用單次結果/快取。',
 'p=statistics.covariance.ids.length；AIC=N ln(max(1e-12,rawRSS)/N)+2p，BIC加p lnN，皆用未四捨五入值；N不含正則化。W為正式MSE_W，同列χ²/N。',
 '真值只評分：E=sqrt((nRMS²+kRMS²)/2)，d誤差另列；n/k max/RMS含全域/真k≥.001/近透明，無區域NA；全部曲線在72波長。規則不讀取真值誤差/樣本外。',
 '僅48001有9組E oracle（含所有完成狀態，只評分）：相近E≤1.10×最佳E+1e-4；絕對版E≤最佳E+1e-4；其餘種子相近NA。',
 '每規則對R0記ΔE；|ΔE|<1e-4記N雜訊水準，>1e-4記B超出，等於另記EQ，保留正負；判準2只數正ΔE>1e-4。',
 '48001結果對48004/5評W與χ²/N後算術平均，沿用訓練p；gap=Wout−Win>.2標記；無樣本外Automatic。三種子逐波長樣本SD（分母2）的RMS、均值曲線對真值RMS偏差、選解是否一致另列。',
 '各規則耗時加總實際會嘗試各步（含拒絕/排除、基準及最終統計），不重跑共用候選；全21資料集總計/平均與對R0倍率。階段耗時加總保存的實測牆鐘，暫停/未保存工作另記，不算入。',
 '對R1/R1a/R1b/R1c各自判準：1 相近≥6/7；2 21資料集ΔE>1e-4數=0；3 五個匹配族48001 W及平均Wout皆≤1.3；4 平均精修≤R0的4倍；5 三種子一致≥6/7。逐條通過/未通過，不放寬。',
 '若多規則全部通過，只列實測平均耗時最低者（精確相同列全部），不自行選定採用。正式verify完整僅一次；比對4.7a失敗名稱/內容，新/變更另列。',
 '階段0 凍結/一致性；1 Automatic21；2 oracle63；3 其他種子階梯70及105規則結果/樣本外；4 verify。串行；每15分鐘檢查，只在階段完成或異常回報；pause-request.json讓目前擬合存檔後停，不重跑已保存結果。','',
];
export function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src','.github','wrangler.jsonc','.node-version','package.json','pnpm-lock.yaml'],{encoding:'utf8'}),'');}
function frozen(){assert.deepEqual(read('settings'),settings);assert.equal(sha(readFileSync(prefix+'settings.json')),read('frozen').settingsSha256);assert.equal(sha(readFileSync(prefix+'frozen-report.md')),read('frozen').reportSha256);}
function pause(checkpoint:string){if(existsSync(prefix+'pause-request.json')){save('paused',{checkpoint,at:new Date().toISOString(),rerunScope:[]});process.exit(0);}}
export function fixture(id:string,seed:number){
 const name=`${id}-${seed}-data`;if(existsSync(prefix+name+'.json'))return read(name);
 const t=settings.truths.find(t=>t.id===id)!;assert.ok(t);const template=createMultiAoiSiO2OnSiProject(),{ambient,layers,substrate,fittingConfig}=template,project={ambient,layers,substrate,fittingConfig};
 const optics=settings.wavelengths.map(wavelength=>{const q=modelRegistry.get(t.model)!.calculate(wavelength,t.values);return {wavelength,...q,k:id==='U5'?Math.max(0,(wavelength-700)/200)*.016:q.k};});
 let state=seed;const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 const points=settings.aois.flatMap(aoi=>optics.map(q=>{const c=solveEllipsometryTMM(new Complex(ambient.n,ambient.k),[{thicknessNm:100,N:new Complex(q.n,q.k)}],evaluateSubstrateOpticalConstants(substrate,q.wavelength),q.wavelength,aoi),r=Math.sqrt(-2*Math.log(rng())),a=2*Math.PI*rng();return {id:`${aoi}-${q.wavelength}`,wavelength:q.wavelength,aoi,psiExp:c.psiDeg+.03*r*Math.cos(a),deltaExp:normalizeDeltaDeg(c.deltaDeg+.03*r*Math.sin(a)),psiSigma:.03,deltaSigma:.03};}));
 const f={truth:t,project,optics,points};save(name,f);return f;
}
export function select(rule:string,rows:any[],N=432){
 const byId=new Map(rows.map(r=>[r.setting.id,r])),baseline=byId.get('40Ws1');assert.ok(baseline);
 const steps=rule==='R0'?ladder.slice(0,1):ladder,trials:any[]=[];let best:any=null;
 for(const g of steps){
  if(g.count>N/4){trials.push({setting:g.id,skipped:'M>N_eq/4'});continue;}
  const r=byId.get(g.id);assert.ok(r,`missing ${g.id}`);const legal=r.converged&&r.status==='cost'&&r.dof>0;
  let accepted=false;if(legal)accepted=!best||(rule==='R1c'?best.metrics.mseWoollam-r.metrics.mseWoollam>.05:rule==='R1b'?r.bic<best.bic:best.bic-r.bic>(rule==='R1'?10:2));
  trials.push({setting:g.id,legal,accepted,dof:r.dof,status:r.status,converged:r.converged,bic:r.bic,W:r.metrics.mseWoollam,elapsedMs:r.elapsedMs});
  if(!legal)continue;
  if(accepted)best=r;else if(rule==='R1'||rule==='R1a')break;
 }
 return {rule,selected:best?.setting.id??baseline.setting.id,fallback:!best,trials,elapsedMs:trials.reduce((s,t)=>s+(t.elapsedMs??0),0)};
}
async function selfCheck(){
 assert.equal(grid.length,9);assert.equal(settings.wavelengths.length,72);assert.deepEqual(solveLeastSquaresSvd([[1,0],[0,0]],[2,0]).solution,[2,0]);
 const fake=(b:number[],w=[.1,.05,.049,.2,.001])=>ladder.map((g,i)=>({setting:g,dof:350,status:'cost',converged:true,bic:b[i],metrics:{mseWoollam:w[i]},elapsedMs:1}));
 const a=fake([100,91,88,60,40]);assert.equal(select('R1',a).selected,'40Ws1');assert.equal(select('R1a',a).selected,'80Ws0.01');assert.equal(select('R1b',a).selected,'80Ws0.01');assert.equal(select('R1c',a).selected,'40Ws0.01');
 assert.equal(select('R1',fake([100,90,80,70,60])).trials.length,2);assert.equal(select('R1a',fake([100,98,90,80,70])).trials.length,2);
 const bad=a.map(r=>({...r,dof:0}));assert.equal(select('R1b',bad).fallback,true);assert.equal(select('R1b',bad).selected,'40Ws1');assert.equal(select('R1',a,40).trials.filter(t=>t.skipped).length,5);
 const invalid=fake([100,99,80,60,40]);invalid[1].status='step';assert.equal(select('R1',invalid).selected,'80Ws0.01');
 assert.ok(Math.abs((settings.truths[4].values.E02-settings.truths[4].values.E0)-2)>1e-6);assert.ok(Math.abs(settings.truths[4].values.A2/settings.truths[4].values.A-.5625)>1e-6);
}
function difference(a:any,b:any):number{if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b);if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){assert.deepEqual(a,b);return 0;}assert.deepEqual(Object.keys(a),Object.keys(b));return Math.max(0,...Object.keys(a).filter(k=>k!=='elapsedMs').map(k=>difference(a[k],b[k])));}
async function equivalence(){
 if(existsSync(prefix+'equivalence.json')){assert.ok(read('equivalence').checks.length===6&&read('equivalence').checks.every((r:any)=>r.passed));return;}
 const start=performance.now(),checks=[];
 for(const id of ['T0','T1','T2','T3','T4','T5']){const f=legacyData(id,45001),old=JSON.parse(readFileSync(`.qa/stage4_5d-${id}.json`,'utf8')).output,o={ambient:f.project.ambient,layers:old.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig,outputWavelengths:settings.wavelengths};
  const formal=await refineFreeForm(o),{knots,...copy}=await refineDiagnostic(makeSetting(40,1),o),maxDifference=difference(formal,copy);checks.push({id,maxDifference,passed:maxDifference<=1e-9});assert.ok(maxDifference<=1e-9,`equivalence ${id} failed: ${maxDifference}`);
 }save('equivalence',{checks,elapsedMs:performance.now()-start});pause('equivalence');
}
async function automatic(id:string,seed:number){
 const name=`${id}-${seed}-automatic`;if(existsSync(prefix+name+'.json'))return read(name);pause('before '+name);
 const f=fixture(id,seed),start=performance.now(),output=await runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:['U0','U5'].includes(id)?'gaussian':f.truth.model,selectedAois:settings.aois});
 const r={id,seed,elapsedMs:performance.now()-start,output};save(name,r);pause(name);return r;
}
async function fit(id:string,seed:number,g:ReturnType<typeof makeSetting>){
 const name=`${id}-${seed}-${g.id}`;if(existsSync(prefix+name+'.json'))return read(name);pause('before '+name);
 const f=fixture(id,seed),a=read(`${id}-${seed}-automatic`),N=2*f.points.length;assert.ok(g.count<=N/4);
 const out=await refineDiagnostic(g,{ambient:f.project.ambient,layers:a.output.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig,outputWavelengths:settings.wavelengths}),p=out.statistics.covariance.ids.length;
 const check=evaluate(f,out,f.points,p);assert.ok(Math.abs(check.chiSquare-out.metrics.chiSquare)<1e-8*Math.max(1,check.chiSquare));
 const log=N*Math.log(Math.max(1e-12,out.metrics.rawMse*N)/N),r={id,seed,setting:g,N,p,dof:out.statistics.dof,aic:log+2*p,bic:log+p*Math.log(N),status:out.result.status,converged:out.result.converged,iterations:out.result.iterations,elapsedMs:out.elapsedMs,metrics:out.metrics,totalCost:out.result.finalCost,out};
 save(name,r);pause(name);return r;
}
async function decisions(id:string,seed:number){
 const name=`${id}-${seed}-rules`;if(existsSync(prefix+name+'.json'))return read(name);
 const rows:any[]=[];for(const g of ladder)rows.push(await fit(id,seed,g));
 const start=performance.now();const rules=settings.rules.map(rule=>select(rule,rows.map(({setting,N,p,dof,status,converged,bic,metrics,elapsedMs})=>({setting,N,p,dof,status,converged,bic,metrics:{mseWoollam:metrics.mseWoollam},elapsedMs}))));
 const f=fixture(id,seed),evaluations:any[]=[];
 for(const g of seed===48001?grid:ladder){const key=`${id}-${seed}-${g.id}-evaluation`;if(existsSync(prefix+key+'.json')){evaluations.push(read(key));continue;}
  const r=read(`${id}-${seed}-${g.id}`),s=score(f,r.out),oos=seed===48001?settings.outSeeds.map(seed=>evaluate(f,r.out,fixture(id,seed).points,r.p)):[],oosW=mean(oos.map(m=>m.mseWoollam));
  const e={id,seed,setting:g.id,score:s,oos,oosW,oosChiN:mean(oos.map(m=>m.weightedMse)),gap:oosW===null?null:oosW-r.metrics.mseWoollam};save(key,e);evaluations.push(e);
 }
 const r={id,seed,rules,evaluations:evaluations.map(e=>e.setting),scoringMs:performance.now()-start};save(name,r);pause(name);return r;
}
export function totals(){const automaticRows=settings.truths.flatMap(t=>settings.selectionSeeds.map(seed=>read(`${t.id}-${seed}-automatic`))),primary=settings.truths.flatMap(t=>grid.map(g=>read(`${t.id}-48001-${g.id}`))),other=settings.truths.flatMap(t=>[48002,48003].flatMap(seed=>ladder.map(g=>read(`${t.id}-${seed}-${g.id}`)))),decisions=settings.truths.flatMap(t=>settings.selectionSeeds.map(seed=>read(`${t.id}-${seed}-rules`)));return {automaticRows,primary,other,decisions,stageSeconds:[read('equivalence').elapsedMs/1000,automaticRows.reduce((s,r)=>s+r.elapsedMs/1000,0),primary.reduce((s,r)=>s+r.elapsedMs/1000,0),other.reduce((s,r)=>s+r.elapsedMs/1000,0)+decisions.reduce((s,r)=>s+r.scoringMs/1000,0)]};}
async function main(){
 guard();await selfCheck();mkdirSync('.qa',{recursive:true});const mode=process.argv[2];
 if(mode==='prepare'){assert.ok(!existsSync(prefix+'settings.json'),'design already exists');writeFileSync(prefix+'settings.json',settingsText);const text=frozenLines.join('\n')+'\n';writeFileSync(prefix+'frozen-report.md',text);writeFileSync('STAGE4_7B_REPORT.md',text+'結果尚未產生。\n');save('frozen',{base:settings.base,at:new Date().toISOString(),settingsSha256:sha(readFileSync(prefix+'settings.json')),reportSha256:sha(text),diagnosticCoreSha256:sha(readFileSync('scripts/stage4_6d-refine.ts'))});console.log('FROZEN; no data generated');return;}
 frozen();if(mode==='self-check'){console.log('SELF CHECK PASS');return;}
 try{
  if(mode==='check'){await equivalence();console.log('EQUIVALENCE PASS');return;}
  assert.equal(mode,'run');assert.ok(read('equivalence').checks.length===6&&read('equivalence').checks.every((c:any)=>c.passed));
  for(const t of settings.truths)for(const seed of settings.selectionSeeds)await automatic(t.id,seed);console.log('STAGE1 COMPLETE');
  for(const t of settings.truths)for(const g of grid)await fit(t.id,48001,g);console.log('STAGE2 COMPLETE');
  for(const t of settings.truths)for(const seed of settings.selectionSeeds)await decisions(t.id,seed);console.log('STAGE3 COMPLETE');
  const t=totals();save('execution',{datasets:21,uniqueRefinements:t.primary.length+t.other.length,stageSeconds:t.stageSeconds,finished:new Date().toISOString()});guard();frozen();
 }catch(e){save('stopped',{at:new Date().toISOString(),error:String(e),stack:(e as Error).stack});throw e;}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage4_7b-run.ts'))await main();
