import {writeQaFileSync as writeFileSync,readQaFileSync as readFileSync} from './qa-files.mjs';

import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {stage41Fixture} from './stage4_1-fixture';
import {modelRegistry} from '../src/modelRegistry/registry';
import {calculateSpectrum} from '../src/solver/calculator';
import {computeResidualMetrics} from '../src/fitting/residual';
import {evaluateAdaptiveSpline} from '../src/models/bspline';
import {instrument} from './stage4_2-instrumentation';

const load=(name:string)=>JSON.parse(readFileSync(`stage4_2-${name}.json`,'utf8'));
const baseline=load('baseline'),experiments=load('experiments'),family=load('family'),mc=load('montecarlo');
assert.equal(baseline.runs.length,3);assert.equal(experiments.runs.length,27);
assert.equal(family.runs.length+family.errors.length,36);assert.equal(mc.runs.length,20);
assert.ok(baseline.runs.every((r:any)=>r.bitIdentical));
const base='5d73894ce3faae3d6988eb75818abce1057206e5';
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('branch','--show-current'),'v2.2-integration');
assert.equal(git('diff',base,'--','src','wrangler.jsonc','.node-version','.github','vite.config.ts','package.json','pnpm-lock.yaml'),'');
assert.equal(git('ls-files','--others','--exclude-standard','src'),'');
await instrument();
const extended=await import(pathToFileURL(resolve('.qa/stage42-bspline.ts')).href);
const original=modelRegistry.get('bspline')!;
const audit:any={base,productionDiffEmpty:true,sourceTree:git('rev-parse',`${base}:src`),initialMetrics:[],curveChecks:[]};
const chosen=(r:any)=>r.stages.filter((s:any)=>s.accepted).at(-1);
for(const run of [...baseline.runs,...experiments.runs]){
  const {project,points}=stage41Fixture(run.scenario);
  for(const stage of run.stages){
    modelRegistry.register(stage.knots.length>20?extended.BSplineModel:original);
    const layer=stage.layers[0],p=Object.fromEntries(Object.entries(layer.parameters).map(([k,v]:any)=>[k,v.current]));
    for(const w of [190,300,400,500,600,700,800,900]){
      const actual=modelRegistry.get('bspline')!.calculate(w,p),values=stage.optimization.finalParams;
      assert.equal(actual.n,evaluateAdaptiveSpline(w,stage.knots,values.slice(1,stage.knots.length+1)));
      assert.equal(actual.k,evaluateAdaptiveSpline(w,stage.knots,values.slice(stage.knots.length+1)));
    }
    audit.curveChecks.push({scenario:run.scenario,variant:run.variant.name??'baseline',knots:stage.knots.length,bitIdentical:true});
    const initial=structuredClone(stage.layers);
    stage.variables.forEach((v:any)=>{if(v.id==='thickness')initial[0].thickness=v.value;else initial[0].parameters[v.id].current=v.value;});
    stage.initialMetrics=computeResidualMetrics(calculateSpectrum(project.ambient,initial,project.substrate,points),
      project.fittingConfig.fitWeighting,project.fittingConfig.psiWeight,project.fittingConfig.deltaWeight,stage.variables.length);
    audit.initialMetrics.push({scenario:run.scenario,variant:run.variant.name??'baseline',knots:stage.knots.length,metrics:stage.initialMetrics});
  }
}
modelRegistry.register(original);
writeFileSync('stage4_2-audit.json',JSON.stringify(audit,null,2));
const n=(x:any)=>typeof x==='number'?(Number.isInteger(x)?String(x):Math.abs(x)<1e-4||Math.abs(x)>1e5?x.toExponential(8):x.toFixed(8)):x==null?'—':String(x);
const cell=(x:any)=>String(n(x)).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const table=(headers:string[],rows:any[][])=>`| ${headers.map(cell).join(' | ')} |\n| ${headers.map(()=>'---').join(' | ')} |\n${rows.map(r=>`| ${r.map(cell).join(' | ')} |`).join('\n')}\n`;
const json=(x:any)=>`\n\`\`\`json\n${JSON.stringify(x,null,2)}\n\`\`\`\n`;
const sections:string[]=[];
const tail=(s:any)=>Math.max(...s.curve.filter((q:any)=>q.wavelength>=800).map((q:any)=>Math.abs(q.kBias)));
const improvements=experiments.runs.map((r:any)=>{
  const s=chosen(r),b=chosen(baseline.runs.find((b:any)=>b.scenario===r.scenario));
  return [r.scenario,r.variant.name,s.metrics.mseWoollam,b.metrics.mseWoollam-s.metrics.mseWoollam,s.thickness,
    Math.abs(b.thickness-100)-Math.abs(s.thickness-100),tail(s),tail(b)-tail(s),r.elapsedMs/1000];
});
sections.push(`# Stage 4.2 — Automatic 診斷\n
基準 \`${base}\`；分支 \`v2.2-integration\`。本階段只新增 scripts、報告及原始輸出，未修改正式演算法、參數、src、部署檔或既有測試期望值。下述皆為執行紀錄與診斷解讀。三個案例沿用 Stage 4.1 的 Automatic workflow 呼叫，固定 \`targetModelId='gaussian'\`，不是自動比較所有模型族的選模模式。\n
## D6：先回答問題\n
**Q1. 自由形式是否在迭代上限前收斂？** 三案例實際執行的 8、12 節點皆為 \`cost\`，迭代數均小於 22；16、20 節點未執行。這代表相對成本準則成立，不代表梯度準則成立。各次相對下降、ftol、最終投影梯度與阻尼見 D1。\n
**Q2. 真值節點初始是否離開真值？** 是。D2a 的最後接受階段如下；MSE_W 變化是該階段「真值節點取樣係數」的初始 forward 與最終值之差。三次 B-spline 初始係數都在每一個節點階段重新取真值樣本；B-spline 控制係數取樣並不等於整條真值曲線的精確插值。\n`);
sections.push(table(['案例','初始 MSE_W','最終 MSE_W','MSE_W 下降','d − 100 nm','Δn(900)','Δk(900)'],
  experiments.runs.filter((r:any)=>r.variant.truth).map((r:any)=>{const s=chosen(r),q=s.curve.at(-1);
    return [r.scenario,s.initialMetrics.mseWoollam,s.metrics.mseWoollam,s.initialMetrics.mseWoollam-s.metrics.mseWoollam,s.thickness-100,q.nBias,q.kBias];})));
sections.push(`**Q3. 放寬搜尋改善多少？** 見 D2 全部 27 組與下面差量表。正的改善量表示偏差／MSE 下降；負值表示變差。單一高節點階段並不保證較佳；不挑掉失敗或較差的診斷結果。\n`);
sections.push(table(['案例','變體','最終 MSE_W','MSE_W 改善','d nm','|d偏差| 改善 nm','長波最大 |k偏差|','長波 |k偏差| 改善','秒'],improvements));
sections.push(`**Q4. 節點加密是否在 MSE_W 明顯大於 1 時停止？** 是，三案例都觸發 \`stageRawMse < 0.025\`，不是 0.005 改善量門檻，也不是 LM 迭代上限。正式停止判斷的量是 deg² Raw MSE。\n`);
sections.push(table(['案例','停止節點','Raw MSE','MSE_W','Raw 改善量','改善門檻'],baseline.runs.map((r:any)=>{
  const s=chosen(r);return [r.scenario,s.knots.length,s.metrics.rawMse,s.metrics.mseWoollam,s.rawImprovement,.005];})));
sections.push(`**Q5. 物理起點最差／最佳與選中結果？** 所有初步起點以完整實驗資料 \`weightedMse = χ²/(2N)\` 排序，再對前兩名做全波段 polish；模型候選仍以 weightedMse 排序。最終選中者可因 polish 換位，不能把初步起點 MSE 當作最終輸出。完整起點、polish 呼叫及候選資料在 baseline JSON；D3 列初值／終值、邊界及來源。\n`);
sections.push(table(['案例','最差起點 MSE_W','最佳初步起點 MSE_W','最佳初步索引','選中索引','polish 後候選 MSE_W','polish 後 weightedMse'],
  baseline.runs.map((r:any)=>{const starts=[...r.starts].sort((a,b)=>a.metrics.weightedMse-b.metrics.weightedMse),c=r.candidates[0];
    return [r.scenario,Math.max(...starts.map(s=>s.metrics.mseWoollam)),starts[0].metrics.mseWoollam,starts[0].index,c.bestStartIndex,c.mseWoollam,c.weightedMse];})));
sections.push('本次三案例的最佳初步起點均為最後選中起點（absorbing #22、transparent #2、weak #2），沒有選到排序較差的起點。\n');
sections.push(`**Q6. 搜尋失敗或模型族極限？** 下表把 Automatic 與 D4 最佳 ε 擬合直接 forward、後續 Ψ/Δ 優化相比。若同族／同數量的直接 forward 已低於 Automatic，便有「已找到較低成本參數」的搜尋證據；不同模型／數量只能說改變表示能力後可改善。有限 5 起點、160 次迭代不能證明模型族的全域下限；D4 仍有 stalled/max_iter 者必須保留此限制。\n`);
sections.push(table(['案例','Automatic 候選 MSE_W','D4 最佳直接 forward (族/數)','直接 MSE_W','D4 最佳 joint (族/數)','joint MSE_W','joint status'],
 baseline.runs.map((r:any)=>{const rows=family.runs.filter((x:any)=>x.scenario===r.scenario),a=[...rows].sort((a,b)=>a.forwardAtTruthThickness.mseWoollam-b.forwardAtTruthThickness.mseWoollam)[0],b=[...rows].sort((a,b)=>a.joint.metrics.mseWoollam-b.joint.metrics.mseWoollam)[0];
 return [r.scenario,r.candidates[0].mseWoollam,`${a.modelId}/${a.count}`,a.forwardAtTruthThickness.mseWoollam,`${b.modelId}/${b.count}`,b.joint.metrics.mseWoollam,b.joint.optimization.status];})));
sections.push(`同族、同振子數的具體比較如下。三個同族 ε 初始 forward 都未低於 Automatic，因此 D4 步驟 2 沒有單獨證明其搜尋漏掉低成本解；步驟 3 找到透明／弱吸收略低的 Gaussian 解，但仍遠高於 1。這組結果不能二選一斷言「全是搜尋問題」或「已到模型族極限」。更多振子／不同族的降低幅度則已由上表量化。\n`);
sections.push(table(['案例','同族/數量','Automatic MSE_W','ε 初始 forward MSE_W','joint MSE_W','joint status'],
  baseline.runs.map((r:any)=>{const c=r.candidates[0],count=c.parametersRecord.filter((p:any)=>/^A(?:[123])?$/.test(p.paramId)).length;
    const f=family.runs.find((f:any)=>f.scenario===r.scenario&&f.modelId===c.modelId&&f.count===count);
    return [r.scenario,`${c.modelId}/${count}`,c.mseWoollam,f.forwardAtTruthThickness.mseWoollam,f.joint.metrics.mseWoollam,f.joint.optimization.status];})));
sections.push(`透明案例的 Cauchy 對照 MSE_W=${baseline.runs.find((r:any)=>r.scenario==='transparent').cauchy.metrics.mseWoollam}，明顯低於固定 Gaussian 的最終候選；這是不同模型表示／固定選模設定的對照證據，不表示已證明 Gaussian 的全域最小值。未把 Cauchy 改為正式最終模型。\n`);
sections.push(`**Q7. σ_k 是否可信？** D5 以 20 組（未減為 10）種子 41001–41020，逐點比較樣本標準差與平均 σ_k，並計算相對真值零的 ±2σ 覆蓋率。樣本散布、系統偏差與局部共變異是不同量，不能只看 std/σ 接近與否。\n`);
sections.push(table(['λ nm','平均 k','樣本 std(k)','平均 σ_k','std/平均σ','±2σ 覆蓋率'],mc.summary.map((s:any)=>[s.wavelength,s.kMean,s.kSampleStd,s.meanSigma,s.stdToMeanSigma,s.coverage])));
sections.push(`本次五個波長的覆蓋率均為 0%；平均 σ_k 大於樣本散布約 2.1–2.4 倍，但仍未包含相對真值的偏差。因此不能把這些局部 σ_k 當成真值誤差的可靠覆蓋區間。自由形式最後接受階段收斂 ${mc.runs.filter((r:any)=>r.splineStages.filter((s:any)=>s.accepted).at(-1).converged).length}/20；物理模型 converged=true 為 ${mc.runs.filter((r:any)=>r.physicalConverged).length}/20。\n`);
sections.push(`**Q8. 無法診斷或限制？** 正式 16、20 節點未執行，沒有其迭代終態；D2c 僅實驗 24、32、40 單階，不冒充正式階段。有限多起點不能證明全域最小值。最後一次線性化梯度與最終參數點梯度分別記錄，後者以複製的圖層獨立重算。擬合的 \`status\` 與高階 \`target_achieved\` 不是同一收斂定義。時間是本機同時執行診斷時的 wall time，不可用作嚴格效能比較。執行失敗清單見末節；沒有因結果不好而修改任何門檻。\n
## 方法、範圍與重現\n
- \`pnpm exec tsx scripts/stage4_2-run.ts baseline\`：D1/D3，正式與隔離數值逐值 assert。
- \`pnpm exec tsx scripts/stage4_2-run.ts experiments\`：D2 共 27 組。
- \`pnpm exec tsx scripts/stage4_2-family.ts\`：D4 共 36 個族／數量／案例組合，每組 5 個 ε 起點及 1 次 joint。
- \`pnpm exec tsx scripts/stage4_2-montecarlo.ts\`：D5，20 組。
- \`pnpm run verify\`；保存各子程序原始 log 後執行 \`pnpm exec tsx scripts/stage4_2-report.ts\` 產生本報告。
- \`pnpm exec tsx scripts/stage4_2-regression.ts\` 逐一比對基準測試名稱／通過狀態，另存新輸出並還原 Stage 4.1 的追蹤產物。
- fixture 直接沿用 Stage 4.1；D5 將同一 fixture 原碼複製至 .qa，只把 seed 改為參數，seed=41001 的 points 與原 fixture deepEqual。
- instrumentation 僅寫入 .qa；每個替換錨點要求只出現一次。正式 src 未寫入。24–40 節點副本只提高模型節點上限至 40，在該診斷程序暫時註冊，程序結束還原；其他變體用正式模型。
- D2b：B-spline maxIterations 22→110，實際 ftol 1e-5→1e-7，xtol/gtol 1e-9→1e-11；保留相對成本尺度、正則化、權重與停止加密規則。D2d 單獨變動 λN 或 λK，並非同時變動。
- 基準六個 B-spline 階段的梯度均在獨立複製圖層的最終點重算；中央差分、角度折返、權重及 active-set 投影與原 optimizer 同式。成本 N/K 分項與 optimizer 正則化總和 assert 差 <1e-9。
- baseline 比對包括更新圖層、點、最終厚度／光學常數、自由形式曲線與統計、最終統計、MSE、pipeline audit；忽略計時、隨機 ID、時間戳，不忽略數值精度。三例皆逐值一致。全部診斷節點模型的 n/k 與直接 cubicEvaluate 在 8 個波長逐值一致，見 audit。
- D4 ε 殘差順序 [ε1,ε2]，等權，不做角度折返；joint 使用正式 degree residual、σ 權重、完整 216 點、厚度與該族的所有作用中連續參數自由。Multi-Oscillator 使用現有 G/G/L 型別組合；不用無作用的 Eg1 作自由參數。ε 五起點含峰初始化與資料範圍內／VUV 中心，背景與振幅先用同一模型 ε 的線性 SVD 求初值，再用正式 bounded LM。所有 min/max 保留於 JSON。未擴張正式參數域。
- D1/D2、D3 候選與 D4 的 MSE_W 使用該次 optimizer 變數數；正式最後統計與自由形式比較會排除邊界自由度，因此同一 χ² 的 MSE_W 可略有差異。原始 χ²、dof、weightedMse 同時保存；選優依 weightedMse，未改定義。
- 既有測試期望值變更：**無**。\n
## D1：正式自由形式軌跡\n`);
for(const r of baseline.runs){
  sections.push(`### ${r.scenario}\n`);
  sections.push(table(['knots','iterations/max','status','limitHit','MSE_W','χ²ᵣ','最終投影梯度∞','最後接受步長 u','LM λ','相對下降','ftol','停止原因'],
    r.stages.map((s:any)=>[s.knots.length,`${s.optimization.iterations}/${s.optimization.telemetry.maxIterations}`,s.optimization.status,
      s.optimization.telemetry.limitHit,s.metrics.mseWoollam,s.metrics.reducedChiSquare,s.finalDiagnostics.projectedGradientInfinityNorm,
      s.optimization.telemetry.lastAcceptedStepNorm,s.optimization.telemetry.lambda,s.optimization.telemetry.relativeImprovement,s.optimization.telemetry.ftol,s.stopReason])));
  sections.push('16、20 節點：未執行；12 節點先觸發 Raw MSE < 0.025。\n');
  sections.push(table(['knots','λN','λK','data cost','N penalty','K penalty','N/data','K/data','前一 objective','Raw 改善量'],
    r.stages.map((s:any)=>[s.knots.length,s.lambdaN,s.lambdaK,s.finalDiagnostics.dataCost,s.finalDiagnostics.nPenalty,
      s.finalDiagnostics.kPenalty,s.finalDiagnostics.nToData,s.finalDiagnostics.kToData,s.previousObjective,s.rawImprovement])));
  for(const s of r.stages){
    sections.push(`#### ${s.knots.length} 節點，膜厚 ${s.thickness} nm\n`);
    sections.push(table(['λ nm','n','真值 n','Δn','k','真值 k','Δk'],s.curve.map((q:any)=>[q.wavelength,q.n,q.trueN,q.nBias,q.k,q.trueK,q.kBias])));
  }
}
sections.push('## D2：所有診斷變體\n\n各階段初始係數、bounds、最終係數、成本與 optimizer telemetry 全列於 experiments JSON；初始 MSE 另見 audit JSON。\n');
for(const r of experiments.runs){
  const s=chosen(r);
  sections.push(`### ${r.scenario} / ${r.variant.name}\n`);
  sections.push(table(['接受節點','MSE_W','χ²ᵣ','厚度 nm','相對該階段初值 Δd','status','迭代','秒'],
    [[s.knots.length,s.metrics.mseWoollam,s.metrics.reducedChiSquare,s.thickness,s.thicknessShift,s.optimization.status,s.optimization.iterations,r.elapsedMs/1000]]));
  sections.push(table(['λ nm','n','Δn','k','Δk','初始 n','初始 k','n 移動','k 移動'],
    s.curve.map((q:any,i:number)=>[q.wavelength,q.n,q.nBias,q.k,q.kBias,s.initialCurve[i].n,s.initialCurve[i].k,q.n-s.initialCurve[i].n,q.k-s.initialCurve[i].k])));
}
sections.push('## D3：物理多起點與 Cauchy\n');
for(const r of baseline.runs){
  sections.push(`### ${r.scenario}\n\nCauchy 階段結果即保留此 Cauchy 作最終模型的完整 216 點 forward 評估，未重新擬合或改選模。\n`);
  const cauchyLong=r.cauchy.layers[0].thickness!==r.cauchy.optimization.finalParams[0],cauchyOpt=r.calls[cauchyLong?0:1];
  sections.push(table(['Cauchy d nm','MSE_W(全波段)','Raw MSE(全波段)','保留來源','converged','LM status'],
    [[r.cauchy.layers[0].thickness,r.cauchy.metrics.mseWoollam,r.cauchy.metrics.rawMse,cauchyLong?'long wavelength':'full spectrum',cauchyOpt.converged,cauchyOpt.status]]));
  sections.push('baseline JSON 的 cauchy.optimization 記錄第二次全波段優化；若保留長波解，本表以 calls[0] 的終態列收斂狀態，MSE 仍由所保留的解完整 forward 計算。\n');
  sections.push(table(['index','source','作用中振子數','MSE_W(全光譜)','converged/status','iterations','貼界參數'],
    r.starts.map((s:any)=>[s.index,s.source,s.variables.filter((v:any)=>/^A(?:[123])?$/.test(v.id)).length,s.metrics.mseWoollam,
      `${s.optimization.converged}/${s.optimization.status}`,s.optimization.iterations,
      s.variables.flatMap((v:any,i:number)=>{const u=(s.optimization.finalParams[i]-v.min)/(v.max-v.min);return u<=1e-6?[`${v.id}:lower`]:u>=1-1e-6?[`${v.id}:upper`]:[];}).join(', ')||'無'])));
  sections.push('峰初始化（該模型的共用峰偵測結果；後續起點可增加振子）：'+json(r.starts[0].initialization));
  sections.push(table(['index','完整初始參數（含 d）','完整最終參數（含 d）'],r.starts.map((s:any)=>[s.index,
    JSON.stringify({...s.initialParams,thickness:s.variables[0].value}),
    JSON.stringify({...Object.fromEntries(Object.entries(s.layers[0].parameters).map(([id,p]:any)=>[id,p.current])),thickness:s.layers[0].thickness})])));
  sections.push(`最終候選排序依據：${r.selection}。選中 ${r.candidates[0].modelId}，起點 ${r.candidates[0].bestStartIndex}，weightedMse=${r.candidates[0].weightedMse}。polish 及全部中間 optimizer 呼叫（包含初值、終值、數據筆數）保留於 baseline JSON 的 calls。\n`);
}
sections.push('## D4：模型族 ε 擬合 → 固定真值膜厚 forward → joint\n');
sections.push(table(['案例','族','振子數','最佳 ε MSE','直接 MSE_W(d=100)','joint MSE_W','joint d','converged/status','iterations','秒'],
 family.runs.map((r:any)=>[r.scenario,r.modelId,r.count,r.bestEpsilonMse,r.forwardAtTruthThickness.mseWoollam,r.joint.metrics.mseWoollam,
   r.joint.thickness,`${r.joint.optimization.converged}/${r.joint.optimization.status}`,r.joint.optimization.iterations,r.elapsedMs/1000])));
sections.push('每組五個 ε 起點之初始／最終參數、最佳 ε 參數、各收斂狀態，以及 joint 最終參數均原樣保存於 family JSON。不能將表內最佳值稱為已證明的 family limit。\n');
sections.push('## D5：20 種子透明案例\n');
sections.push(table(['seed','d nm','free reduced χ²','自由形式 LM','物理 converged/status'],mc.runs.map((r:any)=>[r.seed,r.freeFormThickness,
 r.reducedChiSquare,r.splineStages.map((s:any)=>`${s.knots}:${s.converged}/${s.status}`).join('; '),`${r.physicalConverged}/${r.physicalStatus}`])));
sections.push('高階 physicalStatus 可能是 target_achieved，但 physicalConverged=false；兩者如實列出，不將 Raw MSE 目標達標當作 LM 收斂。\n');
sections.push(table(['seed','λ nm','k','σ_k','|k|≤2σ','flag'],mc.runs.flatMap((r:any)=>r.curve.map((q:any)=>[r.seed,q.wavelength,q.k,q.kSigma,
 Number.isFinite(q.kSigma)?Math.abs(q.k)<=2*q.kSigma:'不可計算',q.belowDetection?'below_detection':'']))));
sections.push('## 未完成／執行錯誤與限制\n'+json({baseline:baseline.errors,experiments:experiments.errors,family:family.errors,mc:mc.runs.filter((r:any)=>r.error)}));
sections.push(`未修復 Stage 4.1 的 below_detection 失敗。沒有執行新的瀏覽器測試或替使用者作科學驗證；本次只有診斷、工程比對與既有 verify。數字表格僅顯示格式化，原始 JSON 保留完整數值。未產生壓縮檔。\n
## 正式測試原始輸出\n
本次預期仍為 scientific 72/73，唯一失敗 \`Stage4.1: Automatic transparent k and propagated uncertainty\`，不應把 verify exit 1 寫成通過。下面保留主程序與各子程序原始輸出。\n`);
for(const file of ['stage4_2-verify.log','stage4_2-verify-typecheck.log','stage4_2-verify-build.log','stage4_2-verify-original-tests.log','stage4_2-verify-scientific-tests.log','stage4_2-verify-worker-tests.log'])
  sections.push(`### ${file}\n\n\`\`\`text\n${readFileSync(file,'utf8')}\n\`\`\`\n`);
sections.push(`## 檔案與原始輸出\n\n新增 \`scripts/stage4_2-instrumentation.ts\`、\`stage4_2-run.ts\`、\`stage4_2-family.ts\`、\`stage4_2-montecarlo.ts\`、\`stage4_2-report.ts\`、\`stage4_2-regression.ts\`；根目錄 \`stage4_2-*.json/log\` 為原始紀錄與 audit。本報告由上述 report 腳本產生。src tree=${audit.sourceTree}，相對基準 diff 為空；沒有正式程式或既有測試期望值修改。\n`);
writeFileSync('STAGE4_2_DIAGNOSTICS.md',sections.join('\n'));
console.log('STAGE4_2_AUDIT '+JSON.stringify({baselineIdentity:baseline.runs.every((r:any)=>r.bitIdentical),
  curveChecks:audit.curveChecks.length,productionDiffEmpty:audit.productionDiffEmpty,experiments:experiments.runs.length,families:family.runs.length,monteCarlo:mc.runs.length}));
