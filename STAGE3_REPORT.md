# AutoEllipso 整合第 3 段工程實作報告

基準 commit：`f7a0859577ede40969ddc758914b99b06d7cb3a7`。分支：`v2.2-integration`。
本報告記錄程式實作、固定案例與工程測試輸出；量測與模型的判讀由使用者另行進行。

## A：收斂與狀態

- `src/fitting/numerics.ts`：唯一預設設定物件 `FIT_NUMERICS`，共用 `convergenceSettings`。
- 預設 ftol=1e-9、xtol=1e-9、gtol=1e-9、成本尺度 ε=1e-15；梯度為 u-space 投影梯度的無窮範數，門檻為 gtol×max(C,ε)。
- 成本準則為 (C_old−C_new)/max(C_old,ε) < ftol；步長為接受且投影後的 u-space 步長範數。
- **相容處理：呼叫端明確傳入的既有 `tolerance` 現在代表相對成本 ftol；只有未指定時才使用預設 1e-9。** 未修改既有 Automatic/Expert 的容差設定值；Automatic 最終 polish 仍為 tolerance=1e-6、35 次上限。Expert 沿用專案所指定的 tolerance。xtol 與 gtol 共用預設。
- 阻尼上限 1e6；在上限仍無下降時，梯度 <100×gtol×成本尺度才回報 `no_better_step`，否則為 `stalled`。沒有因 improved 而設定 converged。
- Optimizer 的 `status`：cost / step / gradient / no_better_step / stalled / max_iter / cancelled。結果透過 `FittingResult.convergenceStatus` 保存同一原因；既有 `FittingResult.status` 保留達標、停止等 UI 相容狀態，並非收斂原因。`converged` 與 `improved` 分開傳遞。
- `engine.runAutoFit`、`autoWorkflow.runAutomatedEllipsometryFit`、`expertWorkflow.fitExpert`：傳遞最終選中解的狀態，不以 MSE 是否小於 10 代替收斂。

## B：擴增最小平方 SVD

- `src/fitting/svd.ts`：TypeScript 薄型單邊 Jacobi SVD 與 `solveLeastSquaresSvd`，支援 m≥n，最多 100 sweep；未達 Jacobi 正交準則會報錯，不靜默使用未完成分解。
- LM 實際解 `[J/√m; √λD] δ ≈ [-r/√m; 0]`，等價於原成本正規化後的擴增最小平方。
- 保留原 Marquardt 欄尺度：D_jj²=max(1e-6,H_jj)+1e-4；H_jj=ΣJ_ij²/m。沒有藉由 JᵀJ 求解線性步。原主動邊界集合、u-space 線性變換、Δ 圓周差分後才套 σ 權重均保留。
- rcond=1e-12；σ<rcond×σmax 或 σ=0 的方向截斷。SVD 回傳截斷個數；Optimizer 記錄本次迭代各線性步中最多截斷的個數。
- 沒有新增套件或相依授權。

## C：唯一最終點統計

- 唯一型別 `FitStatistics`、唯一計算入口 `computeFitStatistics` 位於 `src/fitting/statistics.ts`；另有 `studentT975` 與樣條係數辨識。
- Automatic 在選出最終模型與最佳起點、完整 forward 完成後呼叫一次；Expert 在全部起點選擇完成後呼叫一次；engine 的擬合完成後呼叫一次。迭代及未選中的起點不計算統計。Expert Stage 5 同參數的 fresh forward 保留先前統計，不另算一次。
- 最終點重新取得未加權度數殘差，使用既有中央差分，Δ 分子先作圓周差分，再乘 σ 權重。位於差分邊界時退單側；未重用迭代 Jacobian。
- 統計自由集合：未鎖定、span>0、1e-6<u<1−1e-6；邊界參數保留 boundaryHit，標準誤與 CI 為 null；鎖定與零 span 參數不列入統計。
- 所有現有 u↔p 變換為線性，dp/du=max−min，每個物理參數輸出 transform=`linear` 與實際 derivative。
- C_u=s²VΣ⁻²Vᵀ；C_p=S C_u Sᵀ，S=diag(span)；χ²=Σ(wr)²；dof=資料殘差數−內部自由參數數；s²=χ²/dof。輸出 scaleFactor、未縮放共變異、物理共變異及 stdErrorUnscaled。
- 若 Expert 擬合使用平滑殘差，統計的 Jacobian 包含相同正則化殘差與 mean(w²) 尺度；χ²/dof 僅來自實驗殘差，並在 warnings 明示局部曲率包含正則化。
- dof≤0：available=false，不產生個別參數統計、scaleFactor/reducedChiSquare=null，附警告。
- CI95=value±t(0.975,dof)×stdError。t 分位數以 Lanczos log-gamma、regularized incomplete beta 連分式及二分反解；整數 dof>1000 使用 1.959963984540054。
- 欄正規化 Jacobian 的原始奇異值比為 κ；κ>1e3 為 caution、κ>1e5 為 severe。零最小奇異值的 κ 以 null 表示，等級 severe，UI 顯示奇異，不輸出 JSON Infinity。
- 未正規化的加權 u-space Jacobian 中，截斷方向或 σ/σmax<1e-8 的方向，其右奇異向量分量 |v|>0.3 的參數標記 nonIdentifiable，stdError/stdErrorUnscaled/CI 為 null。這些方向的相關係數以 null 表示。
- 所有內部自由參數（含樣條）都參與 SVD、共變異、相關矩陣與 dof；parameters 只列物理參數。covariance.ids 與 correlation.ids 指明完整矩陣順序，topPairs 是 |r| 最大的前 5 對。
- `FitStatistics` 欄位另含 available、covariance、elapsedMs；見型別原始碼。既有 Raw/Woollam MSE 定義不變；舊指標的 numParameters 計數保留，與排除邊界後的統計 dof 可不同。

## D：UI 與匯出

- 共用 `FitStatisticsPanel`、`StatisticsWarning`、`ParameterEstimate`；接入原結果視窗、底部成果表與 Expert 面板，沿用原樣式。
- 物理參數值 ± 標準誤、95% CI、未縮放誤差、在邊界／不可識別徽章、|r|>0.95 高相關提示。
- 摺疊區列 dof、χ²ᵣ、scaleFactor、κ、文字等級、警告及相關矩陣；總自由參數數>12 時顯示前 5 對。severe 或不可識別時頂端顯示建議固定參數的警告。
- `createValidationReport` 與 `exportFittedParametersJson` 加入 statistics/convergenceStatus；專案 JSON 原有完整 fittingResult 序列化會保存統計。新增欄位可選，不修改專案 schema 版本，舊檔案無需遷移。

## E：測試及變更範圍

- 原 42 項期望值全部保留；新增 SVD 重建／兩個 Moore–Penrose 等式、良態解 1e-9 對照、秩虧、Student t、最終點差分與尺度、邊界、鎖定／樣條、dof≤0、Monte-Carlo、超薄膜、Automatic、JSON／報告及 React 靜態呈現測試。
- Monte-Carlo：100 組、種子 0x12345678、100 nm SiO₂/Si、65/70/75°、每角 190–900 nm 每 10 nm 一點；σΨ=σΔ=雜訊標準差=0.04°。本案例只擬合膜厚，光學參數鎖定於生成值。驗收仍使用比值 0.7–1.4、coverage 85–99%、converged=100%。
- 超薄膜固定案例：2 nm、75°、630/640/650 nm，同時擬合厚度與 Cauchy A，其他係數鎖定。未預設 r 的大小，只驗證有輸出及 κ 等級至少 caution。
- 初次工程執行為 53/55：70°、600–700 nm 案例 κ=411.7457、r=−0.9999882，等級為 ok；因此不能宣稱所有 2 nm 膜皆達 caution，最終使用上述固定 75° 窄波段案例。門檻 1e3/1e5 未改。
- 初次強制忽略明確指定 tolerance、全用預設 ftol=1e-9 的實驗，Automatic 在 35 次 polish 上限為 max_iter；暫時延至 150 次仍 max_iter，中位 27.65 秒。最終恢復 35 次及呼叫端明確指定的相對容差，以保留原使用設定與結果。這個實驗不列為最終通過結果。
- **修改過的既有測試期望值：無。** 新增超薄膜測試的資料範圍/AOI 如上記錄；沒有降低數值門檻。`scientific-tests.json` 是重新產生的執行結果，不是期望值 fixture。
- 相對 f7a0859，TMM、色散模型、Δ 慣例、Worker 檔案、wrangler.jsonc、.node-version、Vite/Vercel/GitHub 部署設定與依賴檔無變更；Automatic/Expert 階段順序未改。

## 實際耗時與結果
修改前（毫秒）：`[6935.7288, 9964.7084, 7073.2503]`；中位 7073.2503 ms。

修改後（毫秒）：`[6477.1871, 7481.0745, 6579.170199999999]`；中位 6579.170199999999 ms。

中位變化 -6.985%；最後一次最終點統計 14.7261 ms，佔中位總時間 0.224%。此為本機固定案例的 wall-clock 量測，不是跨設備效能保證。

膜厚：99.99715906148896 → 99.99715991446588 nm；Raw MSE：0.009153355272130782 → 0.009153357823814337；converged：True → True。新增 Automatic 測試亦逐一比較 fitted parameters 的相對差異與專案既有 tolerance。

## pnpm run verify 原始輸出

```text
$ node scripts/check.mjs
typecheck: 0

worker-tests: 0
{
  "total": 8,
  "passed": 8,
  "failures": []
}

build: 0
vite v8.3.4 building client environment for production...
transforming...
[33m[INEFFECTIVE_DYNAMIC_IMPORT] [0msrc/data/defaultProjects.ts is dynamically imported by src/tests/unitTests.ts but also statically imported by src/tests/unitTests.ts, dynamic import will not move module into another chunk.

✓ 1707 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/defaultProjects-DCB_6quP.js       0.06 kB
dist/version.json                             0.15 kB │ gzip:   0.14 kB
dist/index.html                               1.05 kB │ gzip:   0.49 kB
dist/assets/transferMatrix-Bdb_DGJd.js        3.55 kB
dist/assets/unitTests-BB1BKNqs.js            27.45 kB
dist/assets/calculator-ZecOy0re.js           41.81 kB
dist/assets/compute.worker-Bqv1xUAH.js       70.42 kB
dist/assets/index-B1-qT0Qf.css               56.96 kB │ gzip:  10.26 kB
dist/assets/ExpertFittingPanel-DCDQOuAo.js   25.20 kB │ gzip:   7.22 kB
dist/assets/index-C636iT2t.js               445.41 kB │ gzip: 125.68 kB

✓ built in 4.56s

original-tests: 0
{
  "total": 29,
  "passed": 29,
  "failures": []
}

scientific-tests: 0
STAGE3_MONTE_CARLO {"seed":"0x12345678","runs":100,"sampleSd":0.00047851632932011725,"meanStdError":0.0005003205241958783,"ratio":0.9564195474275116,"coverage":0.96,"converged":1}
STAGE3_ULTRATHIN {"r":-0.9999993522743537,"conditionNumber":1757.1926617893112,"conditionLevel":"caution"}
STAGE3_AUTOMATIC {"thickness":99.99715991446588,"rawMse":0.009153357823814337,"converged":true,"reason":"cost","statisticsMs":20.117300000001705}
{
  "total": 56,
  "passed": 56,
  "failures": []
}


```

## pnpm run build 原始輸出

```text
$ vite build
vite v8.3.4 building client environment for production...
transforming...
[INEFFECTIVE_DYNAMIC_IMPORT] src/data/defaultProjects.ts is dynamically imported by src/tests/unitTests.ts but also statically imported by src/tests/unitTests.ts, dynamic import will not move module into another chunk.

✓ 1707 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/defaultProjects-Boy--2fr.js       0.06 kB
dist/version.json                             0.15 kB │ gzip:   0.13 kB
dist/index.html                               1.05 kB │ gzip:   0.49 kB
dist/assets/transferMatrix-Bdb_DGJd.js        3.55 kB
dist/assets/unitTests-CV7xw2jw.js            27.45 kB
dist/assets/calculator-ZecOy0re.js           41.81 kB
dist/assets/compute.worker-TOwLDbQz.js       70.42 kB
dist/assets/index-B1-qT0Qf.css               56.96 kB │ gzip:  10.26 kB
dist/assets/ExpertFittingPanel-8bDptm9P.js   25.20 kB │ gzip:   7.23 kB
dist/assets/index-OdwpGvJP.js               445.41 kB │ gzip: 125.68 kB

✓ built in 3.05s

```

## 變更檔案清單

- `STAGE3_REPORT.md`
- `scientific-tests.json`
- `scripts/scientific-tests.ts`
- `scripts/stage3-benchmark.ts`
- `scripts/stage3-tests.ts`
- `src/components/ExpertFittingPanel.tsx`
- `src/components/FinalFitResultModal.tsx`
- `src/components/FitStatisticsPanel.tsx`
- `src/components/FittingStatusBottomBar.tsx`
- `src/data/export.ts`
- `src/data/validationReport.ts`
- `src/fitting/autoWorkflow.ts`
- `src/fitting/engine.ts`
- `src/fitting/expertWorkflow.ts`
- `src/fitting/numerics.ts`
- `src/fitting/optimizer.ts`
- `src/fitting/statistics.ts`
- `src/fitting/svd.ts`
- `src/types/ellipsometry.ts`
- `stage3-after.json`
- `stage3-before.json`
- `stage3-build.log`
- `stage3-verify.log`
- `v2-original-tests.json`
- `verification-summary.json`

## 限制與未執行項目

- 本次未對實際量測資料或跨儀器結果作判讀，亦未新增瀏覽器真機/手機端到端測試；UI 測試為 React 靜態呈現，不能代替互動與視覺檢查。
- 本段未進行 Cloudflare 公開站點驗證；只推送 integration 分支，平台重新建置結果需另查。未產生壓縮檔。
- 預設 ftol 與明確指定 tolerance 的相容行為已於 A 節列明；不能把設定較寬鬆的終止條件描述為達到預設 1e-9。
- 共變異與 CI 為最終點的局部線性估計，未收斂結果在 UI 明示。邊界條件、秩虧、平滑正則化與不可識別方向均透過欄位與 warnings 呈現；不能由小 Raw MSE 推論個別參數可識別。
- 壁鐘效能受 CPU、背景程序與案例影響；目前只量測列明的三次前後 Automatic 案例。
- 既有 build 仍輸出 defaultProjects 的 ineffective dynamic import 警告，沒有改動該模組。

## 實作參考

- [Netlib/LAPACK Jacobi SVD 背景](https://www.netlib.org/lapack/lawnspdf/lawn169.pdf)：此處為自行實作基本單邊 Jacobi，未複製 LAPACK 程式。
- [NIST DLMF 8.17 incomplete beta](https://dlmf.nist.gov/8.17)：Student t 反解所用的 incomplete beta 函式背景。

## 分段 commit（本報告的 E commit 另由 git log 可得）

```text
f4809e1 A: Carry independent improvement flag through Automatic candidate selection
e15321d D: Display and export fit statistics with correlation warnings
7fc3191 C: Compute fresh final-point covariance and parameter uncertainty
991d29b A: Preserve explicit relative cost tolerances and cancellation status
d2afe5d B: Solve augmented LM least squares using Jacobi SVD
107e991 A: Share relative convergence criteria and preserve termination reasons
```
