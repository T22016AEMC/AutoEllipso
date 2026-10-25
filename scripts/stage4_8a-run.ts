import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
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
import {sha,makeSetting} from './stage4_7b-run';
export {sha,makeSetting,mean,rms};
export const prefix='.qa/stage4_8a-';
export const read=(name:string)=>JSON.parse(readFileSync(prefix+name+'.json','utf8'));
export function save(name:string,value:unknown){const file=prefix+name+'.json';writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(file+'.tmp',file);}
const truth=(id:string,model:string,values:Record<string,number>,extra={})=>({id,model,values:{...Object.fromEntries(Object.entries(modelRegistry.createParameterSet(model)).map(([k,v])=>[k,v.current])),...values},...extra});
export const settings={base:'074af67855c6be21cb5411c92efe476b60d09941',
 truths:[truth('V0','cauchy',{A:1.54,B:.0046,C:.00009,k0:0}),
  truth('V1','tauc_lorentz',{eps_inf:1.9,A:85,E0:3.75,C:1.28,Eg:1.65,A2:0,A3:0}),
  truth('V2','gaussian',{eps_inf:2.35,A:1.65,E0:2.85,sigma:.37,A2:0,A3:0}),
  truth('V3','lorentz',{eps_inf:2.18,A:2.55,E0:3.4,gamma:.66,A2:0,A3:0}),
  truth('V4','gaussian',{eps_inf:2.45,A:1.55,E0:2.6,sigma:.39,A2:1.05,E02:4.45,sigma2:.47,A3:0}),
  truth('V5','cauchy',{A:1.63,B:.0038,C:.000075,k0:0},{linearK:{start:700,end:900,max:.014}}),
  truth('V6','lorentz',{eps_inf:2.32,A:2.1,E0:3.1,gamma:.64,A2:1.15,E02:4.9,gamma2:.78,A3:0})],
 seeds:[49001,49002,49003],outSeeds:[49004,49005],validationSeed:49006,
 wavelengths:Array.from({length:72},(_,i)=>190+10*i),aois:[65,70,75],thickness:100,sigma:.03,
 counts:[40,50,60,80],scales:[1,.3,.1,.03,.01],ladder:[[40,1],[40,.1],[40,.01],[60,.01],[80,.01]],rules:['R0','R1c','C1','C2','C3','C4'],matched:['V1','V2','V3','V4','V6'],
 controls:'wavelength-uniform; lambdaN=.25s,lambdaK=.6s; n=.5..5.5,k=0..3.5,d=40..200; full available training data,100 iterations,ftol=1e-5,unchanged xtol/gtol; unchanged stage4_6d-refine zero-row projection/uncapped metrics copy',
 physical:'each of21 training datasets one complete official Automatic; default multi-AOI project initialization/config unchanged; candidates including CV start from same full-data physical updatedLayers. V0/V5 Gaussian proxy; others matching modelId, V6 matching Lorentz. No truth parameters in initialization; no sequential warm starts; no Automatic on validation/out seeds',
 crossSeed:'user clarification: every49001/2/3 independently selects all rules from own20 full fits; C2/C4 validate on the same49006 dataset, no validation training; C3 uses only current seed. Primary oracle/classification only49001; secondary truth scores only selected settings. Wout evaluated for all three training seeds on49004/5',
 legal:'pre-guard M<=N_eq/4, N_eq=2*point count; post-guard statistics.dof>0 AND converged AND status=cost. Invalid recorded/excluded; no legal=>40,1 fallback flagged; R0 fixed baseline flagged if invalid',
 ruleDefinitions:{R0:'40,1 only',R1c:'all five ladder steps, update first eligible best only if formal W drops strictly>.05; invalid skip; ties retain earlier',C1:'minimum unrounded BIC among legal20, exact tie fixed grid order',C2:'minimum validation formal W on49006 among legal20, training p retained, ties fixed grid',C3:'own-seed alternating whole-wavelength two-fold CV; both fold fits must be legal; minimize pooled sqrt(sum heldout chiSquare / sum heldout N), not dof; rank eligible CV settings by score then fixed grid order; full refit in that order until first legal; no other seed/truth/validation consulted; fallback40,1 if none',C4:'legal candidates with W_val<=legal minimum W_val+.1 inclusive; largest s first, smallest M next, fixed grid last; same current-training-seed49006 validation asC2'},
 cv:'parity=((wl-190)/10)%2, heldout parity0 then1, all3 AOIs together; complement36 wavelengths/108 points/216 equations =>M<=54, so only40/50 five scales eligible (10 candidates);60/80 are guard-skipped with no fold fit. Each fold knots uniformly cover its own training span; heldout190 or900 clamps to training endpoint. Full-data P1 initialization leakage retained by shared-P1 requirement, so strict leakage-free generalization/real-measurement replacement cannot be inferred',
 formulas:'p=statistics.covariance.ids.length; N ln(max(1e-12,rawRSS)/N)+2p or p lnN; unrounded. W=production MSE_W; chiSquare/N separately. CV heldout evaluation p=0; full/out/validation use training p',
 errors:'E=sqrt((nRMS^2+kRMS^2)/2), n/k max/RMS global and true k>=.001 / k<.001 (empty=>NA), signed thickness error; output/errors at all72 wavelengths. Primary best E and best Wout among all20 completed fits including non-cost, scoring only. No oracle classification for49002/3',
 classes:'primary near E<=1.10*minimum20 E+1e-4; delta E against R0 for all21: abs(delta)<1e-4 noise N, >1e-4 beyond B, equality EQ separately; criterion2 only positive delta>1e-4; no rounded decisions',
 out:'all20 full fits of each training seed evaluated against49004/49005, arithmetic mean Wout and chiSquare/N using training p. gap=Wout-Win>.2 flags. These seeds never choose.49006 only C2/C4, independent of training noise and reused across3 training replicates',
 variation:'per truth/rule across3 independent training selections, per-wavelength sampleSD denominator2 then RMS over72; bias RMS(mean curve minus truth); consistent iff all3 selected ids identical; fallback counted and separately flagged',
 timing:'R0 one full fit; R1c five ladder full fits including invalid; C1/C2/C4 all20 full fits, validation is forward evaluation only. C3 all eligible20 fold fits plus full refit attempts in ascending legal CV-score order until first legal full result; if none baseline full fallback charged once unless already tried. C3 does not charge all20 full fits merely because C1 cached them. All logical costs sum shared measured elapsedMs including final statistics, excluding common Automatic/forward scoring; phase total=sum saved measured calls, excludes idle/pause/unpersisted work',
 scheduling:'serial phases0 freeze+legacy equivalence;1 Automatic21;2 full refinement420 (140 primary oracle+280 secondary);3 CV420 (10*2*21), and210 skipped candidate-pairs;4 all126 rule selections and evaluation/scoring;5 verify exactly once. All inputs/Automatic/full/fold/results atomic checkpoints, no saved result rerun. Pause marker exits after next completed checkpoint',
 data:'LCG1664525/1013904223 uint32,(state+.5)/2^32; paired Box-Muller psi/delta per AOI then ascending wl; TMM with truth n/k; V5 uses transparent Cauchy n plus max(0,(wl-700)/200)*.014; all full parameters frozen',
 criteria:{one:'49001 near>=6/7',two:'21 training datasets count(E_rule-E_R0>1e-4)=0',three:'V1/V2/V3/V4/V6 49001 Win<=1.3 AND mean Wout<=1.3, all five',four:'selected setting identical across3 training seeds for>=5/7 truths',five:'mean logical total refinement time <=15*mean R0 across21; C3 all necessary folds plus final full refit attempt(s)'},
 comparisons:'C3 vs C2 selected-id equality over seven primary49001 truths, with pairs listed; evidence only, no pass threshold/replacement claim. V3/V4/V6 primary20: mean gap by M across5 scales and by s across4 counts, range and count gap>.2; full420 Win/Wout/gap table JSON. Best Wout setting and each selected Wout minus primary20 best are scoring only',
 winner:'if multiple C1..C4 pass all5, list minimum mean measured logical time (exact ties all), no adoption decision',
 equivalence:'six legacy T0..T5 seed45001 from4.5d stored updatedLayers; recursively compare formal vs40-wavelength-1 diagnostic excluding only elapsedMs/extra knots, threshold1e-9; zero-padding SVD assertion; legacy control not new-study data',
 stop:'design/runtime error saves stopped.json then stops, no repair/re-run after freeze; full verify once compares exact failure names/details with4.7b; new names/content changes separately reported; no tests/tolerances/config changed'};
export const grid=settings.counts.flatMap(m=>settings.scales.map(s=>makeSetting(m,s))),cvGrid=grid.filter(g=>g.count<=216/4),ladder=settings.ladder.map(([m,s])=>makeSetting(m,s));
export const settingsText=JSON.stringify(settings,null,2)+'\n';
export const frozenLines=[
 '# Stage 4.8a：自由形式過擬合診斷與樣本外導向選擇','',
 `基準${settings.base}，v2.2-integration；只新增診斷腳本與報告，src/、容差/上限、斷言、部署設定不變。`,
 `新資料前settings.json SHA256=${sha(settingsText)}；設計報告frozen-report.md亦先計SHA256，存frozen.json。原始 .qa/stage4_8a-* 不入repo。`,
 '設計/候選/門檻/種子/真值/判準全部在新資料前固定；錯誤即停，不修後重跑。先六例正式函式一致性重驗≤1e-9，僅排除elapsedMs與額外knots，未過即停。',
 'Si/100nm，AOI65/70/75°，190–900每10nm共72波長，σΨ=σΔ=.03°。訓練49001–49003；樣本外49004/5只評分；49006只供C2/C4驗證，同一噪音資料供三訓練種子共用。',
 '全新真值：V0 Cauchy A1.54/B.0046/C.00009/k0=0；V1 TL ε∞1.9/A85/E0=3.75/C1.28/Eg1.65；V2 Gaussian ε∞2.35/A1.65/E0=2.85/σ.37。',
 'V3 Lorentz ε∞2.18/A2.55/E0=3.4/γ.66；V4雙Gaussian ε∞2.45/A1.55/E0=2.6/σ.39，加A2=1.05/E02=4.45/σ2=.47。停用振子及全部預設參數也在settings。',
 'V5 Cauchy A1.63/B.0038/C.000075的n，加700–900線性k至.014；V6雙Lorentz ε∞2.32/A2.1/E0=3.1/γ.64，加A2=1.15/E02=4.9/γ2=.78。雜訊LCG/Box-Muller同前。',
 '每個21訓練資料集完整正式Automatic一次，全部候選及CV共用完整資料的物理updatedLayers；V0/V5 Gaussian代理，其餘匹配modelId，V6列匹配族。驗證/樣本外無Automatic。',
 'M=40/50/60/80 × s=1/.3/.1/.03/.01，共20組全波長等距；λN=.25s/λK=.6s；n=.5–5.5/k=0–3.5/d=40–200，全訓練資料100次、ftol=1e-5、原xtol/gtol。',
 '沿用零方程補行與避開bspline40上限的4.6d副本。護欄M≤N_eq/4，N_eq=2*點數；合法=converged且status=cost且正式statistics.dof>0；無合法解退回(40,1)並標記。',
 'R0=(40,1)；R1c走完(40,1)→(40,.1)→(40,.01)→(60,.01)→(80,.01)，只有Win比best低>.05才更新；首合法解為best，無效跳過。',
 'C1：20個合法全資料解中BIC最低。C2：各自訓練種子20組對49006的正式W_val最低（沿用訓練p），不得用49004/5或真值選解。',
 'C4：合法W_val≤合法最小W_val+.1（含等號）者中，先s最大、再M最小。C1/C2精確同分依固定grid順序，C4最終同分亦同。',
 'C3單獨：只用當前訓練種子，整波長兩折交錯留出，三AOI同折；訓練36波長/108點/216方程，護欄M≤54，所以只40/50共10設定做兩折，60/80共10設定略過，並非20組皆可CV。',
 'C3每折節點覆蓋該折訓練範圍；留出190或900端點夾值。以sqrt(Σχ²heldout/ΣNheldout)排序（heldout p=0），兩折皆合法才可候選；依分數順序檢查全資料refit合法性，第一合法採用。',
 'C3不讀其他種子/驗證/真值；但完整資料P1含留出資料的初始化洩漏按共用起點規定保留，嚴格無洩漏泛化能力無法判定。記錄C3與C2主種子七真值所選id一致數，無替代判準。',
 '依使用者修訂，每個49001/2/3各自重新選R0/R1c/C1–C4，全部各跑20組；C2/C4共用49006噪音但不訓練。設定一致=三訓練種子所選id完全相同。',
 'p=statistics.covariance.ids.length；AIC=N ln(max(1e-12,rawRSS)/N)+2p，BIC加p lnN，未四捨五入；W=正式MSE_W，χ²/N另列。真值只評分，E=sqrt((nRMS²+kRMS²)/2)，n/k max/RMS分全域/吸收/近透明，缺區域NA，d誤差另列。',
 '僅49001評20組E oracle與相近E≤1.10×最低E+1e-4，其餘種子只對所選設定評E不作oracle分類；各種子20組皆對49004/5算Wout及χ²/N後平均，沿用訓練p，gap>.2標記。',
 '最佳Wout（20組）與相對最佳差只評分；過擬合完整表存JSON。V3/V4/V6趨勢按M平均5個s的gap、按s平均4個M的gap，另列範圍/超.2數。ΔE對R0分類N=|Δ|<1e-4、B=>1e-4、EQ=等於，保留正負。',
 '跨三種子曲線逐波長樣本SD（分母2）的RMS；偏差=均值曲線對真值RMS；所有曲線在72波長。',
 '耗時共用單次實測快取：R0一組，R1c五組，C1/C2/C4全20組；C3全20個合法規格折內fit加CV排序後實際需檢查的完整refit（無效繼續），fallback基準至多另算一次；不因C1快取存在就把20個全fit算入C3。',
 '精修牆鐘含最終統計、不含共用Automatic/正向評分；各規則21資料集總計/平均對R0；階段時間加總保存的實測作業，暫停/未保存工作另記。',
 '對C1–C4逐條：1 主49001相近≥6/7；2 全21資料集正ΔE>1e-4數=0；3 V1–V4/V6主49001 Win與平均Wout皆≤1.3；4 三種子設定一致≥5/7；5 全21平均精修≤R0的15倍，C3含折內與必要完整refit。',
 '多個規則五項全過時，只列最低實測平均精修者，精確同時列全部，不自行選定採用；不放寬或詮釋通過。',
 '串行階段0 凍結/一致性；1 Automatic21；2 全資料420（主oracle140及其餘280）；3 CV420（另210候選對被護欄略過）；4 126規則選解/樣本外與真值評分；5 完整verify一次。每15分鐘檢查，只回報階段完成/異常。',
 '原始輸入/Automatic/全資料/折內/評分均原子檢查點，已保存不重跑；pause-request.json待當前結果寫入即停。verify與4.7b名稱/內容比對，新增/變更單獨報告；不改既有測試。','',
];
export function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src','.github','wrangler.jsonc','.node-version','package.json','pnpm-lock.yaml'],{encoding:'utf8'}),'');}
function frozen(){assert.deepEqual(read('settings'),settings);assert.equal(sha(readFileSync(prefix+'settings.json')),read('frozen').settingsSha256);assert.equal(sha(readFileSync(prefix+'frozen-report.md')),read('frozen').reportSha256);}
function pause(checkpoint:string){if(existsSync(prefix+'pause-request.json')){save('paused',{checkpoint,at:new Date().toISOString(),rerunScope:[]});process.exit(0);}}
export function fixture(id:string,seed:number){
 const key=`${id}-${seed}-data`;if(existsSync(prefix+key+'.json'))return read(key);
 const t=settings.truths.find(t=>t.id===id)!;assert.ok(t);const template=createMultiAoiSiO2OnSiProject(),{ambient,layers,substrate,fittingConfig}=template,project={ambient,layers,substrate,fittingConfig};
 const optics=settings.wavelengths.map(wavelength=>{const q=modelRegistry.get(t.model)!.calculate(wavelength,t.values);return {wavelength,n:q.n,k:id==='V5'?Math.max(0,(wavelength-700)/200)*.014:q.k};});
 let state=seed;const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 const points=settings.aois.flatMap(aoi=>optics.map(q=>{const c=solveEllipsometryTMM(new Complex(ambient.n,ambient.k),[{thicknessNm:100,N:new Complex(q.n,q.k)}],evaluateSubstrateOpticalConstants(substrate,q.wavelength),q.wavelength,aoi),r=Math.sqrt(-2*Math.log(rng())),a=2*Math.PI*rng();return {id:`${aoi}-${q.wavelength}`,wavelength:q.wavelength,aoi,psiExp:c.psiDeg+.03*r*Math.cos(a),deltaExp:normalizeDeltaDeg(c.deltaDeg+.03*r*Math.sin(a)),psiSigma:.03,deltaSigma:.03};}));
 const f={truth:t,project,optics,points};save(key,f);return f;
}
export const legal=(r:any)=>r.converged&&r.status==='cost'&&r.dof>0;
export function selectRules(rows:any[],cv:any[]){
 const base=rows.find(r=>r.setting.id==='40Ws1');assert.ok(base);const valid=rows.filter(r=>r.setting.count<=108&&legal(r));
 const min=(a:any[],key:(r:any)=>number)=>a.reduce((x,y)=>key(y)<key(x)?y:x);
 const choice=(rule:string,r:any,cost:number,extra={})=>({rule,selected:(r??base).setting.id,fallback:!r,elapsedMs:cost,...extra});
 const result:any[]=[choice('R0',legal(base)?base:null,base.elapsedMs)],five=ladder.map(g=>rows.find(r=>r.setting.id===g.id));let best:any=null;
 for(const r of five)if(legal(r)&&(!best||best.metrics.mseWoollam-r.metrics.mseWoollam>.05))best=r;
 result.push(choice('R1c',best,five.reduce((s,r)=>s+r.elapsedMs,0)));
 const allMs=rows.reduce((s,r)=>s+r.elapsedMs,0),c1=valid.length?min(valid,r=>r.bic):null,c2=valid.length?min(valid,r=>r.valW):null;
 result.push(choice('C1',c1,allMs),choice('C2',c2,allMs));
 const sorted=cv.filter(c=>!c.skipped&&c.legal).map((c,i)=>({...c,order:i})).sort((a,b)=>a.cvScore-b.cvScore||a.order-b.order),fullAttempts:string[]=[];let c3:any=null;
 for(const c of sorted){const r=rows.find(r=>r.setting.id===c.setting.id)!;fullAttempts.push(r.setting.id);if(legal(r)){c3=r;break;}}
 if(!c3&&!fullAttempts.includes(base.setting.id))fullAttempts.push(base.setting.id);
 const cvMs=cv.reduce((s,c)=>s+(c.elapsedMs??0),0),c3Ms=cvMs+fullAttempts.reduce((s,id)=>s+rows.find(r=>r.setting.id===id)!.elapsedMs,0);
 result.push(choice('C3',c3,c3Ms,{cvMs,fullAttempts,cvScores:cv.map(c=>({setting:c.setting.id,cvScore:c.cvScore??null,legal:c.legal??false,skipped:c.skipped??null}))}));
 const near=c2?valid.filter(r=>r.valW<=c2.valW+.1):[];near.sort((a,b)=>b.setting.scale-a.setting.scale||a.setting.count-b.setting.count);
 result.push(choice('C4',near[0]??null,allMs));return result;
}
async function selfCheck(){
 assert.equal(grid.length,20);assert.equal(cvGrid.length,10);assert.equal(settings.wavelengths.length,72);assert.deepEqual(solveLeastSquaresSvd([[1,0],[0,0]],[2,0]).solution,[2,0]);
 const rows=grid.map((g,i)=>({setting:g,dof:350,status:'cost',converged:true,elapsedMs:1,bic:100-i,valW:1+i*.01,metrics:{mseWoollam:2-i*.06}})),cv=cvGrid.map((g,i)=>({setting:g,legal:true,cvScore:2-i*.01,elapsedMs:2}));
 const selected=selectRules(rows,cv);assert.equal(selected.find(r=>r.rule==='C1').selected,'80Ws0.01');assert.equal(selected.find(r=>r.rule==='C2').selected,'40Ws1');assert.equal(selected.find(r=>r.rule==='C4').selected,'40Ws1');assert.equal(selected.find(r=>r.rule==='C3').selected,'50Ws0.01');assert.equal(selected.find(r=>r.rule==='C3').elapsedMs,21);
 const bad=rows.map(r=>({...r,dof:0}));assert.ok(selectRules(bad,cv).every(r=>r.fallback));
 const test=rows.map(r=>({...r,valW:10}));test[0].valW=1.1;test[4].valW=1;assert.equal(selectRules(test,cv).find(r=>r.rule==='C4').selected,'40Ws1','C4 includes exactly min+.1');
 const invalidCv=cv.map(c=>({...c,legal:false}));assert.equal(selectRules(rows,invalidCv).find(r=>r.rule==='C3').fallback,true);
 assert.equal(selectRules(rows.map(r=>({...r,valW:100-r.valW,bic:-r.bic})),cv).find(r=>r.rule==='C3').selected,selected.find(r=>r.rule==='C3').selected,'C3 ignores validation and BIC');
 const equality=rows.map(r=>({...r,metrics:{mseWoollam:1}}));equality[0].metrics.mseWoollam=.1;equality[2].metrics.mseWoollam=.05;assert.equal(selectRules(equality,cv).find(r=>r.rule==='R1c').selected,'40Ws1','strict W improvement >.05');
}
function difference(a:any,b:any):number{if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b);if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){assert.deepEqual(a,b);return 0;}assert.deepEqual(Object.keys(a),Object.keys(b));return Math.max(0,...Object.keys(a).filter(k=>k!=='elapsedMs').map(k=>difference(a[k],b[k])));}
async function equivalence(){
 if(existsSync(prefix+'equivalence.json')){assert.ok(read('equivalence').checks.length===6&&read('equivalence').checks.every((c:any)=>c.passed));return;}
 const start=performance.now(),checks=[];
 for(const id of ['T0','T1','T2','T3','T4','T5']){const f=legacyData(id,45001),old=JSON.parse(readFileSync(`.qa/stage4_5d-${id}.json`,'utf8')).output,o={ambient:f.project.ambient,layers:old.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig,outputWavelengths:settings.wavelengths};
  const formal=await refineFreeForm(o),{knots,...copy}=await refineDiagnostic(makeSetting(40,1),o),maxDifference=difference(formal,copy);checks.push({id,maxDifference,passed:maxDifference<=1e-9});assert.ok(maxDifference<=1e-9,`equivalence ${id}: ${maxDifference}`);
 }save('equivalence',{checks,elapsedMs:performance.now()-start});pause('equivalence');
}
async function automatic(id:string,seed:number){
 const key=`${id}-${seed}-automatic`;if(existsSync(prefix+key+'.json'))return read(key);pause('before '+key);
 const f=fixture(id,seed),start=performance.now(),output=await runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:['V0','V5'].includes(id)?'gaussian':f.truth.model,selectedAois:settings.aois});
 const r={id,seed,elapsedMs:performance.now()-start,output};save(key,r);pause(key);return r;
}
async function fit(id:string,seed:number,g:ReturnType<typeof makeSetting>,fold:number|null=null){
 const key=`${id}-${seed}-${g.id}${fold===null?'':`-fold${fold}`}`;if(existsSync(prefix+key+'.json'))return read(key);pause('before '+key);
 const f=fixture(id,seed),training=fold===null?f.points:f.points.filter((p:any)=>((p.wavelength-190)/10)%2!==fold),N=training.length*2;assert.ok(g.count<=N/4,'pre-fit equation guard');
 const a=read(`${id}-${seed}-automatic`),out=await refineDiagnostic(g,{ambient:f.project.ambient,layers:a.output.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points:training,config:f.project.fittingConfig,outputWavelengths:settings.wavelengths}),p=out.statistics.covariance.ids.length;
 const independent=evaluate(f,out,training,p);assert.ok(Math.abs(independent.chiSquare-out.metrics.chiSquare)<1e-8*Math.max(1,independent.chiSquare));
 const log=N*Math.log(Math.max(1e-12,out.metrics.rawMse*N)/N),heldout=fold===null?null:evaluate(f,out,f.points.filter((q:any)=>((q.wavelength-190)/10)%2===fold),0);
 const r={id,seed,setting:g,fold,N,p,dof:out.statistics.dof,status:out.result.status,converged:out.result.converged,iterations:out.result.iterations,aic:log+2*p,bic:log+p*Math.log(N),metrics:out.metrics,elapsedMs:out.elapsedMs,heldout,out};save(key,r);pause(key);return r;
}
async function cv(id:string,seed:number,g:ReturnType<typeof makeSetting>){
 const key=`${id}-${seed}-${g.id}-cv`;if(existsSync(prefix+key+'.json'))return read(key);
 if(g.count>216/4){const r={id,seed,setting:g,skipped:'M>216/4',legal:false,elapsedMs:0};save(key,r);return r;}
 const folds=[];for(const parity of [0,1])folds.push(await fit(id,seed,g,parity));
 const N=folds.reduce((s,r)=>s+2*r.heldout.totalPoints,0),r={id,seed,setting:g,folds:folds.map(f=>({fold:f.fold,dof:f.dof,status:f.status,converged:f.converged,heldout:f.heldout,elapsedMs:f.elapsedMs})),legal:folds.every(legal),cvScore:Math.sqrt(folds.reduce((s,r)=>s+r.heldout.chiSquare,0)/N),elapsedMs:folds.reduce((s,r)=>s+r.elapsedMs,0)};save(key,r);return r;
}
async function decisions(id:string,seed:number){
 const key=`${id}-${seed}-rules`;if(existsSync(prefix+key+'.json'))return read(key);pause('before '+key);
 const f=fixture(id,seed),cvRows=grid.map(g=>read(`${id}-${seed}-${g.id}-cv`)),start=performance.now(),valRows:any[]=[];
 for(const g of grid){const name=`${id}-${seed}-${g.id}-validation`;if(existsSync(prefix+name+'.json')){valRows.push(read(name));continue;}const r=read(`${id}-${seed}-${g.id}`),metrics=evaluate(f,r.out,fixture(id,49006).points,r.p),v={setting:g,metrics,valW:metrics.mseWoollam};save(name,v);valRows.push(v);}
 const rows=grid.map(g=>{const r=read(`${id}-${seed}-${g.id}`);return {setting:g,dof:r.dof,status:r.status,converged:r.converged,elapsedMs:r.elapsedMs,bic:r.bic,metrics:{mseWoollam:r.metrics.mseWoollam},valW:valRows.find(v=>v.setting.id===g.id).valW};});
 const rules=selectRules(rows,cvRows),selected=new Set(rules.map(r=>r.selected));
 for(const g of grid){const name=`${id}-${seed}-${g.id}-evaluation`;if(existsSync(prefix+name+'.json'))continue;const r=read(`${id}-${seed}-${g.id}`),oos=settings.outSeeds.map(s=>evaluate(f,r.out,fixture(id,s).points,r.p)),oosW=mean(oos.map(m=>m.mseWoollam))!;
  save(name,{id,seed,setting:g,score:seed===49001||selected.has(g.id)?score(f,r.out):null,oos,oosW,oosChiN:mean(oos.map(m=>m.weightedMse)),gap:oosW-r.metrics.mseWoollam});
 }
 const r={id,seed,rules,scoringMs:performance.now()-start};save(key,r);pause(key);return r;
}
export function totals(){
 const autos=settings.truths.flatMap(t=>settings.seeds.map(seed=>read(`${t.id}-${seed}-automatic`))),full=settings.truths.flatMap(t=>settings.seeds.flatMap(seed=>grid.map(g=>read(`${t.id}-${seed}-${g.id}`)))),folds=settings.truths.flatMap(t=>settings.seeds.flatMap(seed=>cvGrid.flatMap(g=>[0,1].map(fold=>read(`${t.id}-${seed}-${g.id}-fold${fold}`))))),rules=settings.truths.flatMap(t=>settings.seeds.map(seed=>read(`${t.id}-${seed}-rules`)));
 return {autos,full,folds,rules,stageSeconds:[read('equivalence').elapsedMs/1000,autos.reduce((s,r)=>s+r.elapsedMs/1000,0),full.reduce((s,r)=>s+r.elapsedMs/1000,0),folds.reduce((s,r)=>s+r.elapsedMs/1000,0),rules.reduce((s,r)=>s+r.scoringMs/1000,0)]};
}
async function main(){
 guard();await selfCheck();mkdirSync('.qa',{recursive:true});const mode=process.argv[2];
 if(mode==='prepare'){assert.ok(!existsSync(prefix+'settings.json'),'already frozen');writeFileSync(prefix+'settings.json',settingsText);const text=frozenLines.join('\n')+'\n';writeFileSync(prefix+'frozen-report.md',text);writeFileSync('STAGE4_8A_REPORT.md',text+'結果尚未產生。\n');save('frozen',{base:settings.base,at:new Date().toISOString(),settingsSha256:sha(readFileSync(prefix+'settings.json')),reportSha256:sha(text),coreSha256:sha(readFileSync('scripts/stage4_6d-refine.ts'))});console.log('FROZEN; no data generated');return;}
 frozen();if(mode==='self-check'){console.log('SELF CHECK PASS');return;}
 try{
  if(mode==='check'){await equivalence();console.log('EQUIVALENCE PASS');return;}
  assert.equal(mode,'run');assert.ok(read('equivalence').checks.length===6&&read('equivalence').checks.every((c:any)=>c.passed));
  for(const t of settings.truths)for(const seed of settings.seeds)await automatic(t.id,seed);console.log('STAGE1 COMPLETE');
  for(const t of settings.truths)for(const seed of settings.seeds)for(const g of grid)await fit(t.id,seed,g);console.log('STAGE2 COMPLETE');
  for(const t of settings.truths)for(const seed of settings.seeds)for(const g of grid)await cv(t.id,seed,g);console.log('STAGE3 COMPLETE');
  for(const t of settings.truths)for(const seed of settings.seeds)await decisions(t.id,seed);console.log('STAGE4 COMPLETE');
  const t=totals();assert.equal(t.full.length,420);assert.equal(t.folds.length,420);save('execution',{datasets:21,fullFits:420,foldFits:420,stageSeconds:t.stageSeconds,finished:new Date().toISOString()});guard();frozen();
 }catch(e){save('stopped',{at:new Date().toISOString(),error:String(e),stack:(e as Error).stack});throw e;}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage4_8a-run.ts'))await main();
