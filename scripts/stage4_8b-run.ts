import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {settings as sourceSettings,grid as sourceGrid} from './stage4_8a-run';
import {score,mean,rms} from './stage4_6d-run';
import {refineDiagnostic} from './stage4_6d-refine';
import {auditPlan,prefix,source,sha,load,old,save,originalHashes,snapshotCheck,consistency} from './stage4_8b-audit';
import {feature,choose,legal,selfCheck} from './stage4_8b-select';
export {prefix,source,sha,load,old,save,mean,rms};
export const read=(name:string)=>load(prefix+name+'.json');
export const settings={base:'c0d5abbefa9608b05bbe351c553bd4cbd3dd0924',sourceSettingsSha256:old('frozen').settingsSha256,snapshotSha256:sha(readFileSync(prefix+'checkpoint-snapshot.json')),
 truths:sourceSettings.truths,seeds:sourceSettings.seeds,outSeeds:sourceSettings.outSeeds,oracleValidationSeed:49006,
 grid:sourceGrid,ladder:[[40,1],[40,.1],[40,.01],[60,.01],[80,.01]],rules:['N0','N1','N2','N3','N4','N5','N6'],
 overallCriteria:[1,2,4,5],referenceOnlyCriterion:3,
 provenance:{original:'first validate original settings/frozen-report/core SHA256, any mismatch stops',snapshot:'all2205 existing4.8a-prefixed files captured as8b input baseline, all remain byte-identical throughout; snapshot cannot prove unchanged between4.8a completion and snapshot creation',audit:auditPlan},
 scope:'counterfactual selection without supplied sigma using already sigma-weighted fits, not a no-sigma optimization experiment; no Automatic or saved fit rerun. New sparse fits retain original sigma=.03 objective/config and P1; uniform optimization not covered, its effect unknown',
 selectorInputs:'only setting,rawRSS,rawMse,N,p,dof,converged,status,raw-RSS BIC/AIC and original refinement elapsedMs. No truth, actual sigma, weighted W/MSE_W/chiSquare, heldout or validation fields. N6 is an explicit nondeployable scoring-only stored C2 oracle id, loaded after N0..N5 decisions; never feeds selectors',
 legal:'converged AND status=cost AND statistics.dof>0 AND M<=N_eq/4; full N_eq432; invalid steps skipped, all steps traversed, ties retain earlier; all invalid full fallback40,1 flagged; N0 fixed40,1 flagged if invalid',
 definitions:{N0:'40,1 only',N1:'minimum raw-RSS BIC among legal five ladder steps',N2:'first legal best; update only if candidate rawRSS <.95*best rawRSS (strict>5% drop); same full-data N so RawMSE ratio identical',N3:'sigmaHat2=legal last80,.01 rawRSS/dof; chiHat=rawRSS/sigmaHat2, wHat=sqrt(chiHat/dof); update only if best wHat-candidate wHat>.05, no early stop',N4:'same sigmaHat2; minimum wHat+.5*p/N among legal five, penalty .5 fixed',N5:'minimum BIC over all20 full candidates, benchmark only',N6:'stored4.8a C2 selection from49006, scoring-only oracle benchmark, no validation data or weighted metric accessed by deployable selectors'},
 sigmaUnavailable:'last step is sole estimator; if illegal/guarded or variance not positive finite, N3/N4 choose baseline40,1, mark sigma unavailable; never substitute another estimator; all such datasets remain in all21 denominators and consistency/time; sparse estimator24,.01 and baseline12,1',
 sparse:{truths:['V2','V3','V4'],seed:49001,wavelengths:Array.from({length:36},(_,i)=>190+20*i),ladder:[[12,1],[12,.1],[12,.01],[16,.01],[20,.01],[24,.01]],rules:['N1','N3'],P1:'reuse full-data4.8a updatedLayers, no Automatic',objective:'original sigma-weighted .03 core, full36 training wavelengths; original100 iterations,ftol1e-5,xtol/gtol/bounds unchanged; selectors raw-only; no accuracy criterion',invalidBaseline:'if12,1 is illegal record no available candidate, no fallback, even if other steps are legal',unavailable:'24,.01 invalid or variance nonpositive/nonfinite=>fallback12,1 only if baseline legal; flag sigma unavailable'},
 formulas:'N=2*measured point count; p=statistics.covariance.ids.length; rawRSS=unweighted rawMse*N (deg^2); AIC=N ln(max(1e-12,rawRSS)/N)+2p, BIC plusp lnN; unrounded. sigmaHat estimates from training residuals only. Report both raw BIC and estimated-variance chiHat/wHat',
 scoring:'only after selection: reuse saved formal Win, mean Wout49004/5, source full curves and truth for E=sqrt((nRMS^2+kRMS^2)/2), n/kRMS/max and thickness signed error. If a newly selected secondary setting lacks saved truth score, compute from saved curve only (no fit). Best Wout among all20 completed full results for each of21 datasets, scoring only',
 variation:'per truth/rule across3 training seeds: per-wavelength sampleSD denominator2 then RMS over72; bias RMS(mean curve minus truth); consistent iff3 selected ids identical, fallback baseline counts and is separately flagged',
 timing:'N0 one fit; N1..N4 sum five original measured fit elapsedMs (including invalid/rejected, last estimator already included), N5/N6 all20 original elapsedMs. Shared saved calls, not zero-cost due cache. No common Automatic/forward scoring costs. Sparse rules sum6 newly measured fits. Actual8b audit/replay/scoring/sparse/verify phase walltimes separately',
 criteria:{one:'Wout-selected minus same-dataset20 minimum <=.05 in>=18/21',two:'count(E-selected-E-N0>1e-4)=0/21',three:'REFERENCE ONLY: exact selected-id agreement with N6>=14/21, report pass/fail but exclude from overall',four:'3 seeds selected same setting in>=5/7 truths',five:'mean logical full-data refinement time <=15*mean N0 across21'},
 winner:'overall only criteria1,2,4,5 conjunctive; criterion3 never independently or jointly gates overall. If multiple N1..N4 pass overall, list lowest mean time, all exact ties, no adoption decision',
 stages:'0 original hashes/snapshot/internal audit;1 sanitized-feature replay N0..N5 (126 decisions);2 score N0..N6 (147 cards) and variation;3 sparse18 new fits/6 decisions;4 verify exactly once. Serial,15min checks, only completion/error reports; atomic persistent results, reuse saved checkpoints; pause after completed fit only, record rerun scope',
 stop:'any input inconsistency or design/runtime error=>stop and report, no repair/re-run after freeze; no source files modified; full verify once compare exact failure names/details to4.8a, new names/content separate'};
export const ladderIds=settings.ladder.map(([m,s])=>`${m}Ws${s}`),sparseSettings=settings.sparse.ladder.map(([count,scale])=>({count,scale,distribution:'wavelength',id:`${count}Ws${scale}`}));
export const settingsText=JSON.stringify(settings,null,2)+'\n';
export const frozenLines=[
 '# Stage 4.8b：無 σ 條件下的階梯選擇準則診斷','',
 `基準${settings.base}，v2.2-integration；只新增腳本/報告，src/、容差/上限、斷言、部署設定不變。`,
 `新資料/選擇前settings SHA256=${sha(settingsText)}；設計原文frozen-report.md另計SHA256，見frozen.json；此後不依結果調整，錯誤即停不修後重跑。`,
 '已重驗4.8a原始settings、設計報告、診斷副本三項SHA256；現存2205個stage4_8a-*檔案建立checkpoint-snapshot.json，後續不得變動。只能證明快照當下及之後一致，無法證明4.8a完成至快照前未改動。',
 '內部一致性：全42輸入重播真值/種子/TMM，絕對差≤1e-12；全21資料集420全fit核對id/參數/N/p/dof/節點/曲線/rawRSS/AIC/BIC與評分紀錄，相對差≤1e-8×max(1,|參考值|)。',
 '每資料集40Ws1與80Ws.01共42例唯讀重算正式computeFitStatistics（p/dof/ids精確相同）並重播P1初始投影/目標；不呼叫優化器。稽核可讀原σ/真值，但不送入選擇器，範圍另列audit-plan.json。',
 '重用V0–V6（全部真值參數逐值複製4.8a settings）、49001–49003、完整物理P1、420全fit及49004/5樣本外；不重跑Automatic或保存精修。N6只載入已存C2選解id作oracle評分。',
 '這是無σ「選擇器」的反事實重放，既有fit仍為σ加權；不是完全無σ精修實驗。任何N0–N5選擇都不讀實際σ、加權W/MSE_W/χ²、真值、樣本外或49006；N6不可部署且不影響其餘選擇。',
 '全資料五步固定(40,1)→(40,.1)→(40,.01)→(60,.01)→(80,.01)，走完五步、無效跳過。合法=converged且status=cost且dof>0且M≤N_eq/4（N_eq432）；無合法退回(40,1)並標記。',
 'N0固定(40,1)；N1取合法五步中raw-RSS BIC最低；N2只有rawRSS<.95×目前best才更新（嚴格降>5%，等N的RawMSE比例相同）；首合法為best，同分保留先者。',
 'N3：σ̂²只取末步(80,.01)合法解rawRSS/dof，χ²_σ̂=rawRSS/σ̂²，W_σ̂=sqrt(χ²_σ̂/dof)；較best降>.05才更新。N4最小化W_σ̂+.5×p/N，懲罰.5固定。',
 '末步不合法/護欄排除或σ̂²非正且有限，N3/N4退回(40,1)並標記「σ̂不可用」，不得改估計來源；照常納入全部21分母、時間與一致性，另列次數/id。',
 'N5全20組raw-RSS BIC最低，只作基準；N6已存4.8a C2（曾用49006驗證W）只作oracle對照，不讀該驗證資料重新選解，不納入實用規則。',
 'rawRSS=無加權rawMse×N（deg²）；p=statistics.covariance.ids.length；AIC=N ln(max(1e-12,rawRSS)/N)+2p，BIC加p lnN，均不四捨五入；同報BIC與χ²_σ̂/W_σ̂。',
 '選完後才評正式Win、平均Wout49004/5、E、d誤差、n/k RMS；新選次種子若無已存E只從保存曲線算分，不重fit。比較N6一致/ΔWout與同資料集全20最佳Wout差，最佳包含全部完成設定，只評分。',
 '三種子各自重新選設定；曲線逐波長樣本SD（分母2）的RMS及均值曲線對真值RMS偏差，一致為三個id完全相同，fallback也按基準計且標記。',
 '精修邏輯牆鐘：N0一組；N1–N4五組原單次實測（含無效/末步估計）；N5/N6二十組，不因快取計零；不含共用Automatic/正向評分。新8b實際稽核/重放/評分時間另外計。',
 '稀疏V2/V3/V4固定49001、完整資料P1，190–890每20nm共36波長；只新增(12,1)→(12,.1)→(12,.01)→(16,.01)→(20,.01)→(24,.01)共18fit，不重Automatic。',
 '稀疏沿用σΨ=σΔ=.03°核心、100次/ftol1e-5/既有xtol/gtol與邊界；N1/N3選擇只用raw量。N3只取24Ws.01估σ̂；不可用退回12Ws1；若12Ws1本身不合法則無可用候選、不fallback。',
 '稀疏只檢查所選dof>0，不做精度判準。其精修仍σ加權，不能代表真樣品完全無σ精修；uniform精修未涵蓋，影響無法判定。',
 'N1–N4逐條判準：1 與同資料集20組最佳Wout差≤.05數≥18/21；2 E比N0大>1e-4數=0；3「參考」與N6一致≥14/21；4 三種子一致≥5/7；5 平均精修≤N0的15倍。',
 '整體只以1、2、4、5共同判定；3只逐條回報實際數及通過/未通過，不參與整體。多規則整體通過時列平均時間最低者，精確同時列全部，不自行選定。',
 '串行階段0稽核；1 raw特徵/126決策；2 147評分/變異；3 18稀疏fit/6決策；4 完整verify一次。每15分鐘檢查，只報階段完成/異常；已存結果不重跑，pause-request.json於檢查點後停止。',
 '原始全在.qa/stage4_8b-*（不入repo）；verify只完整一次，比對4.8a兩項失敗名稱/內容，新增/變更單獨報告。','',
];
function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src','.github','wrangler.jsonc','.node-version','package.json','pnpm-lock.yaml'],{encoding:'utf8'}),'');}
function frozen(){assert.deepEqual(read('settings'),settings);assert.equal(sha(readFileSync(prefix+'settings.json')),read('frozen').settingsSha256);assert.equal(sha(readFileSync(prefix+'frozen-report.md')),read('frozen').reportSha256);assert.equal(sha(readFileSync(prefix+'checkpoint-snapshot.json')),settings.snapshotSha256);}
function pause(checkpoint:string){if(existsSync(prefix+'pause-request.json')){save('paused',{checkpoint,at:new Date().toISOString(),rerunScope:[]});process.exit(0);}}
export function projected(id:string,seed:number){const name=`${id}-${seed}-features`;if(existsSync(prefix+name+'.json'))return read(name);const rows=sourceGrid.map(g=>feature(old(`${id}-${seed}-${g.id}`)));save(name,rows);return rows;}
function replay(id:string,seed:number){const name=`${id}-${seed}-choices`;if(existsSync(prefix+name+'.json'))return read(name);const start=performance.now(),rows=projected(id,seed),choices=['N0','N1','N2','N3','N4','N5'].map(rule=>choose(rule,rows,ladderIds)),r={id,seed,choices,elapsedMs:performance.now()-start};save(name,r);pause(name);return r;}
function evaluate(id:string,seed:number){
 const name=`${id}-${seed}-evaluation`;if(existsSync(prefix+name+'.json'))return read(name);const start=performance.now(),chosen=read(`${id}-${seed}-choices`).choices,reference=old(`${id}-${seed}-rules`).rules.find((r:any)=>r.rule==='C2');assert.ok(reference);
 const features=projected(id,seed),f=old(`${id}-${seed}-data`),baselineFit=old(`${id}-${seed}-40Ws1`),baselineScore=score(f,baselineFit.out),evaluations=sourceGrid.map(g=>old(`${id}-${seed}-${g.id}-evaluation`)),best=evaluations.reduce((a,b)=>b.oosW<a.oosW?b:a),oracleEvaluation=old(`${id}-${seed}-${reference.selected}-evaluation`),cards:any[]=[];
 for(const c of [...chosen,{rule:'N6',selected:reference.selected,fallback:reference.fallback,reason:'stored C2 oracle only',sigmaUnavailable:false,sigmaHat2:null,elapsedMs:features.reduce((s:number,r:any)=>s+r.elapsedMs,0),scores:[]}]){
  const full=old(`${id}-${seed}-${c.selected}`),e=evaluations.find(e=>e.setting.id===c.selected),s=e.score??score(f,full.out),feat=features.find((r:any)=>r.setting.id===c.selected);assert.ok(feat);
  cards.push({id,seed,...c,feature:feat,Win:full.metrics.mseWoollam,Wout:e.oosW,E:s.error,score:s,dError:s.thicknessError,nRMS:s.regions.all.nRms,kRMS:s.regions.all.kRms,deltaE:s.error-baselineScore.error,agreementN6:c.selected===reference.selected,deltaN6:e.oosW-oracleEvaluation.oosW,best:{setting:best.setting.id,Wout:best.oosW},deltaBest:e.oosW-best.oosW,curve:full.out.curve});
 }
 const r={id,seed,cards,elapsedMs:performance.now()-start};save(name,r);pause(name);return r;
}
async function sparse(id:string){
 const name=`sparse-${id}-choices`;if(existsSync(prefix+name+'.json'))return read(name);const f=old(`${id}-49001-data`),a=old(`${id}-49001-automatic`),points=f.points.filter((p:any)=>(p.wavelength-190)%20===0);assert.equal(points.length,108);const rows:any[]=[];
 for(const g of sparseSettings){const key=`sparse-${id}-${g.id}`;if(existsSync(prefix+key+'.json')){rows.push(read(key));continue;}pause('before '+key);
  const out=await refineDiagnostic(g,{ambient:f.project.ambient,layers:a.output.updatedLayers,substrate:f.project.substrate,primaryLayerIndex:0,points,config:f.project.fittingConfig,outputWavelengths:settings.sparse.wavelengths});
  const r={id,seed:49001,setting:g,N:216,p:out.statistics.covariance.ids.length,dof:out.statistics.dof,status:out.result.status,converged:out.result.converged,elapsedMs:out.elapsedMs,metrics:out.metrics,out};save(key,r);rows.push(r);pause(key);
 }
 const features=rows.map(feature),choices=['N1','N3'].map(rule=>choose(rule,features,sparseSettings.map(g=>g.id),true)),r={id,seed:49001,features,choices,elapsedMs:rows.reduce((s,r)=>s+r.elapsedMs,0)};save(name,r);pause(name);return r;
}
async function main(){
 guard();selfCheck();const mode=process.argv[2];
 if(mode==='prepare'){assert.ok(!existsSync(prefix+'frozen.json'),'already frozen');originalHashes();assert.equal(Object.keys(load(prefix+'checkpoint-snapshot.json').files).length,2205);writeFileSync(prefix+'settings.json',settingsText);save('audit-plan',{...auditPlan,sha256:sha(JSON.stringify(auditPlan))});const text=frozenLines.join('\n')+'\n';writeFileSync(prefix+'frozen-report.md',text);writeFileSync('STAGE4_8B_REPORT.md',text+'結果尚未產生。\n');save('frozen',{base:settings.base,at:new Date().toISOString(),settingsSha256:sha(readFileSync(prefix+'settings.json')),reportSha256:sha(text),auditScriptSha256:sha(readFileSync('scripts/stage4_8b-audit.ts')),selectorScriptSha256:sha(readFileSync('scripts/stage4_8b-select.ts'))});console.log('FROZEN; no data analysis or fit started');return;}
 frozen();if(mode==='self-check'){console.log('SELF CHECK PASS');return;}assert.equal(mode,'run');
 try{
  const audit=existsSync(prefix+'consistency.json')?read('consistency'):await consistency();assert.equal(audit.passed,true);snapshotCheck();console.log('STAGE0 COMPLETE');
  for(const t of settings.truths)for(const seed of settings.seeds)replay(t.id,seed);console.log('STAGE1 COMPLETE');
  for(const t of settings.truths)for(const seed of settings.seeds)evaluate(t.id,seed);console.log('STAGE2 COMPLETE');
  for(const id of settings.sparse.truths)await sparse(id);console.log('STAGE3 COMPLETE');
  const decisions=settings.truths.flatMap(t=>settings.seeds.map(s=>read(`${t.id}-${s}-choices`))),evaluation=settings.truths.flatMap(t=>settings.seeds.map(s=>read(`${t.id}-${s}-evaluation`))),sp=settings.sparse.truths.map(id=>read(`sparse-${id}-choices`));
  const unchanged=snapshotCheck();frozen();guard();save('execution',{datasets:21,fullReplayFits:0,automaticRuns:0,newSparseFits:18,unchangedSourceFiles:unchanged,stageSeconds:[audit.elapsedMs/1000,decisions.reduce((s,r)=>s+r.elapsedMs/1000,0),evaluation.reduce((s,r)=>s+r.elapsedMs/1000,0),sp.reduce((s,r)=>s+r.elapsedMs/1000,0)],finished:new Date().toISOString()});
 }catch(e){save('stopped',{at:new Date().toISOString(),error:String(e),stack:(e as Error).stack});throw e;}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage4_8b-run.ts'))await main();
