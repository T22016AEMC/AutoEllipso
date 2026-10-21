import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const load=name=>JSON.parse(fs.readFileSync('.qa/stage4_4a3-'+name+'.json','utf8'));
const candidates=load('candidates'),selected=candidates.find(c=>c.selected),r=selected.result,d=r.diagnostic;
const experiments=load('experiments'),A=experiments.filter(x=>x.experiment==='A'),B=experiments.filter(x=>x.experiment==='B');
const diff=load('candidate-differences'),probes=load('activation-probes'),baseline=load('baseline');
const verify=JSON.parse(fs.readFileSync('.qa/verification-summary.json','utf8'));
assert.equal(verify.commands.find(c=>c.name==='typecheck').exitCode,0);
const tests=JSON.parse(fs.readFileSync('.qa/scientific-tests.json','utf8')),failures=tests.filter(t=>!t.passed);
const n=x=>typeof x==='number'?Number(x.toPrecision(12)).toString():String(x);
const top=v=>v.slice(0,3).map(x=>x.id+':'+n(x.component)).join(', ');
const last=d.iterations.at(-1),attempt=last.attempts.at(-1),trials=d.iterations.flatMap(x=>x.attempts);
const matrix=d.matrices.at(-1),bounds=d.final.parameters.filter(p=>p.nearLower||p.nearUpper);
assert.equal(d.iterations.length,100);assert.equal(d.matrices.length,11);
assert.deepEqual(d.matrices.slice(0,-1).map(m=>m.iteration),[10,20,30,40,50,60,70,80,90,100]);
for(const a of A)assert.deepEqual(a.result.diagnostic.iterations.slice(0,Math.min(a.cap,100)).map(x=>x.costAfter),
 d.iterations.slice(0,Math.min(a.cap,100)).map(x=>x.costAfter));
assert.equal(execFileSync('git',['diff','10b641d','--','src'],{encoding:'utf8'}),'');
const report=`# Stage 4.4(a3)：SiO₂ 收斂診斷

基準 10b641d；同一 createMultiAoiSiO2OnSiProject 確定性 fixture，65/70/75°、gaussian、${baseline.points} 點／${baseline.points*2} 殘差。只新增 scripts 與報告，src、正式上限 100、容差、既有斷言及部署設定未改。

## 判定及支持數據

**最支持「活躍 A–sigma 病態相關」解釋慢爬，另有振子啟用門檻造成搜尋盲區；無法判定唯一因果主因。** 不能把完整矩陣的零奇異值直接當作資料本身不可辨識。

| 觀測 | 實測 | 可支持的範圍 |
|---|---|---|
| 活躍五欄局部條件 | column-normalized κ=${n(matrix.activeNonzero.normalized.condition)}；raw u-space κ=${n(matrix.activeNonzero.raw.condition)} | 幅度／寬度方向近退化；五欄在 rcond=1e-12 下未截斷 |
| 固定活躍弱方向主分量 A | 11 次 cost 停止、κ=${n(B.find(x=>x.fixedId==='A').result.diagnostic.matrices.at(-1).activeNonzero.normalized.condition)}，但成本上升 | 支持該自由方向影響迭代速度，不證明固定後估計更好 |
| 貼界／裁切 | ${bounds.map(x=>x.id).join(', ')} 距界 <1e-3 u；五個非零敏感度參數均不貼界；${trials.filter(t=>Math.abs(t.stepNorm-t.unprojectedStepNorm)>1e-10*Math.max(1,t.unprojectedStepNorm)).length} 次可分辨步長裁切（差 >1e-10·max(1,未裁切範數)） | 未見活躍參數撞界主導慢爬的證據 |
| 阻尼 | 100 輪／${trials.length} 嘗試、${trials.filter(t=>!t.accepted).length} 拒絕；每輪最多 ${Math.max(...d.iterations.map(x=>x.attemptCount))} 次；λ=${n(Math.min(...trials.map(x=>x.lambda)))}…${n(Math.max(...trials.map(x=>x.lambda)))} | 未到 λ 上限 1e6，也未碰下降下限 1e-7；沒做替代阻尼對照，不能判定策略本身為主因 |

每輪原始記錄含接受前／後成本、最後試步相對改善及 u 步長、每次試步接受／拒絕與 λ 前後值、嘗試數、全部參數值與 u、上下界距離旗標；原始資料在本機 .qa/，不在 repo。貼界標記用 1e-3；梯度投影沿用原程式 1e-8，兩者不混用。

## Jacobian 檢查點

J 為加權殘差對線性 u=(p−min)/(max−min) 的原中央差分。10S 等表示該輪求步所用的起點 J；100F 是接受第 100 步後另算的最終 J。完整 11 欄有六個零欄（${matrix.zeroColumns.join(', ')}）；完整 v_min 前三項於所有檢查點皆為 ${top(matrix.full.raw.minimumVector)}，零空間六維，此基底不唯一，不能解讀為唯一最相關參數。表內 v 是非零活躍子矩陣的 raw u-space 最小右奇異向量；整體符號可反轉。

| 輪／位置 | 完整 σ_max | 完整 σ_min | 完整 κ（欄正規化） | 活躍 κ（欄正規化） | 活躍 v_min 前三項 |
|---|---:|---:|---|---:|---|
${d.matrices.map(m=>`| ${m.iteration}${m.point==='fresh_final'?'F':'S'} | ${n(m.full.raw.maximum)} | ${n(m.full.raw.minimum)} | ${m.full.normalized.condition} | ${n(m.activeNonzero.normalized.condition)} | ${top(m.activeNonzero.raw.minimumVector)} |`).join('\n')}

最後點活躍 σ_min=${n(matrix.activeNonzero.raw.minimum)}、完整截斷數 ${matrix.full.raw.truncated}、活躍截斷數 ${matrix.activeNonzero.raw.truncated}。完整向量及所有奇異值均保存，未以有限大數取代 Infinity。

## 最後一輪收斂準則

| 準則 | 實際值 | 對應容差 | 滿足 |
|---|---:|---:|---|
| ftol（最後接受步） | ${n(attempt.relativeImprovement)} | ${d.tolerances.ftol} | ${last.criteria.ftol} |
| xtol（u 步長） | ${n(attempt.stepNorm)} | ${d.tolerances.xtol} | ${last.criteria.xtol} |
| gtol（最後輪起點） | ${n(last.gradientNorm)} | ${n(last.gradientTolerance)} | ${last.criteria.gtol} |
| gtol（最終點 fresh J） | ${n(d.final.gradientNorm)} | ${n(d.final.gradientTolerance)} | ${d.final.gradientSatisfied} |

投影梯度範數為 ||project(Jᵀr̃/m)||∞，沿用 optimizer 的半梯度定義，不另乘 2；gtol 門檻=1e-9·當前成本。第 100 輪接受步，因此 no_better_step 不成立；正式結果保持 max_iter／converged=false。

## 實驗 A：同一起點，只變診斷迭代上限

初始成本皆 ${selected.result.initialCost}；各 cap 共用前綴的逐輪成本完全相同。耗時含診斷 SVD／記錄，與 verify 並行，為本機單次觀察值，不是正式效能基準。

| 上限 | 實際迭代 | 最終成本 | Δ成本相對 100 | 耗時 ms | converged／status |
|---:|---:|---:|---:|---:|---|
${A.map(a=>`| ${a.cap} | ${a.result.iterations} | ${a.result.finalCost} | ${n(a.result.finalCost-r.finalCost)} | ${n(a.elapsedMs)} | ${a.result.converged}/${a.result.status} |`).join('\n')}

300 上限實際在 121 次停止，成本仍比 100 次低；只有成本準則成立，fresh 投影梯度 ${n(A[2].result.diagnostic.final.gradientNorm)} 仍大於 ${n(A[2].result.diagnostic.final.gradientTolerance)}。不能把 status=cost 視為已證明梯度小或全域最優；正式上限未改。

## 實驗 B：固定奇異方向主分量，其餘同起點、最多 35 次

固定值取被選候選的初值，不是真值；完整零空間選出的 sigma3 不唯一，另測活躍子矩陣 v_min 最大分量 A。降低自由度改變了可行集合，成本差必須一起看。

| 固定參數／值 | 實際迭代 | 最終成本 | Δ成本相對原 100 | 耗時 ms | converged／status |
|---|---:|---:|---:|---:|---|
${B.map(b=>`| ${b.fixedId}=${n(b.fixedValue)} | ${b.result.iterations} | ${b.result.finalCost} | ${n(b.result.finalCost-r.finalCost)} | ${n(b.elapsedMs)} | ${b.result.converged}/${b.result.status} |`).join('\n')}

固定零方向 sigma3 的 35 次成本與原 35 次完全相同，未消除慢爬；固定 A 雖 11 次 cost 停止，但成本較原 35／100 次都高，不能當成已完成修正。

## 實驗 C：兩個候選起點與終點

| 候選 | 起點成本 | 終點成本 | 迭代 | converged／status |
|---|---:|---:|---:|---|
${candidates.map(c=>`| ${c.index}${c.selected?'（被選）':''} | ${c.result.initialCost} | ${c.result.finalCost} | ${c.result.iterations} | ${c.result.converged}/${c.result.status} |`).join('\n')}

終點成本差（被選−另一候選）=${diff.finalCostDifference}。候選 1 第一輪相對下降 ${n(candidates[0].result.diagnostic.iterations[0].attempts.at(-1).relativeImprovement)} <1e-6，故 cost 停止，但其 fresh 投影梯度 ${n(candidates[0].result.diagnostic.final.gradientNorm)} 仍不滿足 gtol。以下為物理單位；膜厚 nm，E0/sigma 系列 eV。A2/A3 皆為 0，不能把其停用峰的位置差解讀成有效光學峰差異。

| 參數 | 起點 1 | 起點 2 | Δ起點（2−1） | 終點 1 | 終點 2 | Δ終點（2−1） |
|---|---:|---:|---:|---:|---:|---:|
${diff.initial.map((a,i)=>{const b=diff.final[i];return `| ${a.id} | ${n(a.first)} | ${n(a.selected)} | ${n(a.difference)} | ${n(b.first)} | ${n(b.selected)} | ${n(b.difference)} |`;}).join('\n')}

## 優化器可修正／資料可辨識度的界線

慢爬與活躍方向的病態條件相符；現有演算法多走至 121 次可達原成本準則，並不證明需更換 optimizer 本體。哪種步法能更快且維持較低成本，本次沒有對照，**無法判定**。
另有可重現的實作搜尋盲區：gaussian.ts 的 A2/A3 僅在 >0.001 時啟用；此點的幅度有限差分物理步長恰為 0.001。下列只改診斷評估點，未改模型或步長：

| 參數 | 值 | 相對原點最大殘差變化 ° | 成本 |
|---|---:|---:|---:|
${probes.filter(p=>p.value===.001||p.value===.001001).map(p=>`| ${p.id} | ${p.value} | ${n(p.maximumResidualChangeDeg)} | ${p.cost} |`).join('\n')}

A2 跨門檻後有更低成本點，但未進一步最佳化該分支。A2/A3 幅度零欄受實作門檻影響，其位置/寬度在振幅 0 時不參與本點響應，不能歸因於純量測資訊不足。活躍五欄未嚴格秩虧、但局部條件差；是否為資料本身固有限制、是否只有模型/optimizer 改動才能解決，**無法判定**。本段不修改正式行為，不建議改容差或斷言來通過。

## verify 與證據位置

最終 pnpm run verify：${verify.commands.map(c=>c.name+' exit '+c.exitCode).join('；')}。original 29/29、worker 8/8、scientific ${tests.length-failures.length}/${tests.length}；失敗如下：

${failures.map((f,i)=>`${i+1}. \`${f.name}\`：${f.detail.replace(/\s+/g,' ')}。`).join('\n')}

同一起點未插樁 production optimizer 與追蹤版的參數、成本、Raw MSE、迭代、status、converged 逐值相同。完整逐輪／逐參數／試步／奇異值：本機 \`.qa/stage4_4a3-candidates.json\`；A/B：\`stage4_4a3-experiments.json\`；C：\`stage4_4a3-candidate-differences.json\`；門檻：\`stage4_4a3-activation-probes.json\`；自洽：\`stage4_4a3-replay-check.json\`、\`stage4_4a3-checks.json\`。均為本機 .qa/，不在 repo。
verify 原始輸出為本機 \`.qa/stage4_4a3-verify-final.log\`、\`.qa/v2-*.log\`；初輪新增腳本型別錯誤已修復並重跑，初輪輸出亦保留於 .qa。未進行科學驗證。
`;
assert.ok(report.split('\n').length<=120,`Report has ${report.split('\n').length} lines`);
fs.writeFileSync('STAGE4_4A3_REPORT.md',report);
console.log(JSON.stringify({lines:report.split('\n').length,failures:failures.map(f=>f.name),sourceUnchanged:true}));
