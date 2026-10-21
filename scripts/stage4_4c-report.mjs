import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=name=>JSON.parse(readFileSync(`.qa/${name}.json`,'utf8'));
const fmt=x=>typeof x==='number'?x.toPrecision(12):String(x);
const lines=[
'# Stage 4.4(c)：振子啟用門檻',
'',
'基準 `2d8abe9e658f42e6612d77b0bd166293a2554757`；分支 `v2.2-integration`。本報告僅記錄實作與工程測試輸出。',
'',
'## 門檻盤點（以下行號為基準版本）',
'',
'| 分類／檔案:行號 | 門檻或條件 | 處置與理由 |',
'|---|---|---|',
'| (a) gaussian.ts:246,250 | A2/A3 > 0.001 | 移除正振幅死區，直接累加兩個 ε 項 |',
'| (a) lorentz.ts:181 | A ≤ 0.001 return | 移除；現有 E≥1e-3、gamma≥1e-4 已令分母為正 |',
'| (a) taucLorentz.ts:272 | A ≤ 0.01 return | 移除；仍共用原解析函式與安全域處理 |',
'| (a) multiOscillator.ts:270,289,306 | A1/A2/A3 > 1e-5 | 改為無條件計算，保留原有型別分派與累加順序 |',
'| (b) gaussian.ts:32,47,64 | E≤0、sigma≤0、A≤0 | 有效域及精確零幅度捷徑；允許域 A≥0 無正振幅死區 |',
'| (b) multiOscillator.ts:28,33,50,66 | E/A/width≤0；den<1e-12 | 零幅度／無效域捷徑及除零保護，保留 |',
'| (b) taucLorentz.ts:17,21–22,43,49,61,63,74–75,84 | 正寬度與 C<2E0、有限性、A=0、距 Eg<1e-9、E<Eg×1e-4 | 防止複數根、log(0)、零能量相消及非有限輸出，保留 |',
'| (b) gaussian.ts:229,233,237,241；lorentz.ts:163,167,171,175；taucLorentz.ts:252–266；drude.ts:74,77 | E/width 的正下限 | 分母與寬度安全，不是振幅啟用門檻，保留 |',
'| (b) base.ts:14,22,32–33；sellmeier.ts:84,92–96；custom.ts:116,127；cauchy.ts:84 | 非正能量／波長、sqrt≥0、分母≥1e-6、波長≥0.1 | 轉換、根號及除法保護，保留 |',
'| (b) kk.ts:9,15,17,19,23,30；kkBspline.ts:23–24,35,41,64–69,89,92 | 積分誤差/深度、奇異點1e-9、端點、零欄範數、solver停止1e-10 | 積分與線性求解安全，非振幅裁切，保留 |',
'',
'以下是模型定義／明確控制／初始化政策，不冒稱數值安全，也不屬隱藏的振幅啟用死區：',
'- TL:45 的 E≤Eg（吸收邊）；TL:25–33 僅對非零振子驗證；expertMixed:13,18,21–27 的 enabled/type；kkBspline:67 的 IR 啟用。',
'- peakInitialization:34,43,61,69 的 5% prominence、4% 距離、1e-12 平坦判斷、2% onset 均為既有初始化政策，本段不動。',
'- bspline/cubicSpline 的範圍、節點與端點分支；tabulated/cauchy/custom/sellmeier 的 n/k 有效域及 Sellmeier k=0 模型定義均保留。Drude 沒有正振幅啟用門檻。',
'- 已掃描 src/models 全部 16 個檔案；完整含行號條件清單：本機 `.qa/stage4_4c-model-audit.log`，不在 repo。',
'',
'## 修改摘要與零振幅／連續性',
'',
'正式修改僅四個上述模型；新增 scripts/stage4_4c-tests.ts、stage4_4c-regression.ts、stage4_4c-report.mjs，scientific-tests.ts 僅登錄新測試。未改 optimizer、參數邊界、排序、統計、迭代上限或部署設定；既有斷言／期望／容差修改：無。',
];
const zero=read('stage4_4c-continuity');
lines.push(`隔離基準與現行模型在 190–900 nm（每 1 nm，各振幅依次設 0）ε₁/ε₂ 最大差：${zero.map(x=>x.id+'='+x.maxZeroDifference).join('；')}。`);
lines.push('新增四個模型測試以全部零幅度背景與單振子單位響應對照：A=1e-8、1e-5、0.001、0.001001、1，逐點線性誤差界 1e-12×max(1,|ε|)；並以未修改的 optimizer 驗證 A=0 的單側 Jacobian 非零。',
'原始 ε 數表：本機 `.qa/stage4_4c-continuity.json`；測試原始輸出：`.qa/v2-scientific-tests.log`，均不入 repo。',
'', '## 四案例完整 Automatic 前後對照', '',
'相同 Stage4.1 fixture、41001 種子、65/70/75°；SiO₂ 用既有 createMultiAoiSiO2OnSiProject。每側各一次完整流程；前後皆用隔離副本的相同只讀 optimizer 呼叫包裝。多組與 verify 並行，秒數為牆鐘耗時，不是獨佔效能基準。', '',
'| target／案例 | MSE_W 前 → 後 | 膜厚 nm 前 → 後 | converged 前 → 後 | 秒 前 → 後 | ΔMSE_W／上升標示 |',
'|---|---|---|---|---|---|');
for(const model of ['gaussian','lorentz'])for(const row of read(`stage4_4c-${model}-comparison`)) {
 const [a,b]=row.outputs;
 lines.push(`| ${model}/${row.scenario} | ${fmt(a.mseWoollam)} → ${fmt(b.mseWoollam)} | ${fmt(a.thickness)} → ${fmt(b.thickness)} | ${a.converged} → ${b.converged} | ${(a.elapsedMs/1000).toFixed(3)} → ${(b.elapsedMs/1000).toFixed(3)} | ${fmt(b.mseWoollam-a.mseWoollam)}${row.mseIncreased?' **上升**':''} |`);
}
lines.push('', '成本上升的兩項為 Lorentz/SiO₂（+0.500585709927）與 Lorentz/transparent（+3.84288050675）。SiO₂ 被選終點 A2 由0.00709472243815變0；被選精修起點 gamma2 由5變0.0961744118555，顯示搜尋路徑已不同，尚未進一步診斷其原因。',
'如有成本上升：移除門檻後有限差分與後續非線性搜尋路徑會改變；本次未重排候選、改起點或調參。僅由本次輸出無法判定各上升案例的更細原因。完整參數、各 optimizer 起點／終點／status：本機 `.qa/stage4_4c-{gaussian,lorentz}-{案例}-{before,after}.json`，不在 repo。',
'', '## 兩 Gaussian 振子案例', '',
'預先固定真值：eps_inf=2.2；A=2,E0=2.5,sigma=0.3；A2=1.2,E02=4.5,sigma2=0.4；A3=0。Si、100 nm、65/70/75°、190–900 nm 每10 nm、σΨ=σΔ=0.03°；LCG+Box–Muller 種子44003。保留預設 Automatic 初值與全部設定，沒有依結果調參。', '',
'| 版本 | A2 終值 | A2−1.2 | MSE_W | 膜厚 nm | converged/status | 被選優化呼叫 A2 初值／u／貼界 |',
'|---|---|---|---|---|---|');
for(const e of read('stage4_4c-two-comparison')[0].outputs) {
 const c=e.selectedCall,i=c?.initial.findIndex(v=>v.id==='A2'),v=i>=0?c.initial[i]:null;
 const u=v?(e.parameters.A2-v.min)/(v.max-v.min):null;
 lines.push(`| ${e.label} | ${fmt(e.parameters.A2)} | ${fmt(e.parameters.A2-1.2)} | ${fmt(e.mseWoollam)} | ${fmt(e.thickness)} | ${e.converged}/${e.status} | ${v?`${fmt(v.value)}／${fmt(u)}／${u<=1e-6||u>=1-1e-6}`:'未匹配到 optimizer 呼叫，詳原始輸出'} |`);
}
lines.push('此固定案例在基準已還原第二峰；前後數值相同，不能作為完整流程改善的證據。A2 是原欄位名稱，沒有為改善誤差而交換振子標號；峰位與所有起點保存在本機 `.qa/stage4_4c-two-two-{before,after}.json`。若標號交換／多振子分攤，不能由 A2 單一誤差宣稱唯一還原，未調參。',
'', '## verify 與未解決項目', '');
const verify=read('verification-summary'),tests=read('scientific-tests');
lines.push('typecheck exit 0；production build exit 0；original 29/29；worker 8/8。新增四項模型測試均通過。');
lines.push('verify 原始輸出：本機 `.qa/stage4_4c-verify.log`、`.qa/v2-*.log`、`.qa/verification-summary.json`（不入 repo）。');
lines.push('```json',JSON.stringify(verify),'```');
const failed=tests.filter(t=>!t.passed);
lines.push(`scientific：${tests.length-failed.length}/${tests.length}；新增四項：${tests.filter(t=>t.name.startsWith('Stage4.4c:')&&t.passed).length}/4。失敗逐項列出：`);
for(const f of failed) lines.push(`- ${f.name}：${f.detail.replaceAll('\n',' ')}。`);
lines.push('沒有新增失敗的測試名稱；兩個原有失敗的原因已從 converged=false 變為膜厚歷史數值斷言：本次 converged=true，膜厚100.27386919748632 nm 對照99.99715906148896 nm，差0.27671013599736 nm，超過原0.001 nm 容差。未改動或放寬。',
'基準已知失敗名稱：Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance；Stage4.1: SiO2 regression and timing against Stage3/4 baseline。既有測試若因 converged 轉 true 而進到後續數值斷言，仍保留其原斷言，不改寫期望。',
'Gaussian/transparent 的 converged 由 true 變 false（max_iter），雖 MSE_W 下降仍未收斂；Gaussian/weak 仍為 false。沒有因成本改善就改寫收斂旗標。',
'新增測試只驗證模型零值、連續性及有限差分啟用，不能據此推論所有資料的全域搜尋或參數可辨識度。未執行額外瀏覽器測試。',
'僅推 v2.2-integration；推送後對應 commit 的 GitHub Actions 狀態與連結於交付回覆回報，不更改 CI 設定。');
assert.ok(lines.length<=120,lines.length+' lines');
writeFileSync('STAGE4_4C_REPORT.md',lines.join('\n')+'\n');
console.log('Report written: '+lines.length+' lines');
