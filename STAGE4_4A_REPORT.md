> 原始輸出位置：本機 `.qa/`，不在 repo。本文歷史 JSON／log／CSV／校驗清單檔名均指 `.qa/` 下同名檔案；測試必需的小型數值基準另存 `scripts/fixtures/`，數值未改。

# Stage 4.4(a)：回歸處理

基準：`ea378c5b6062038e17251933c7a7d322ab404ac9`；分支：`v2.2-integration`。

## 修前失敗清單

1. original-tests：`Synthetic Recovery Test: Inverting Known Thickness (85 nm) and n(λ) from True Forward Spectrum` 的 10 點資料無可准入的 B-spline 階段，拋錯中斷；不是斷言數值不符。原始輸出：`stage4_3-verify-original-tests.log`。
2. `Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance`：SiO₂ 的 `converged=false`，與既有 `true` 斷言不符。
3. `Stage4.1: SiO2 regression and timing against Stage3/4 baseline`：相同 SiO₂ 旗標斷言失敗。後兩項原始輸出：`stage4_3-verify-scientific-tests.log`。

## 修改摘要

- `src/fitting/autoWorkflow.ts`：沒有任何可准入的節點階段時，改為略過自由形式；以真正的 Cauchy 模型及其膜厚接續原本的物理初始化、厚度搜尋與多起點流程。不建立未擬合的自由形式曲線、統計或比較表。其餘輸入走原有分支。
- `src/types/ellipsometry.ts`：新增可選 `freeFormWarning`；診斷增加 `skipped`、`warning`、`sourceModel`。完整階段略過原因仍保留於 `knotRefinementHistory`。
- `src/components/OpticalModelComparisonPanel.tsx`、`FinalFitResultModal.tsx`：顯示略過警告，並明確把替代診斷標為 Cauchy。
- `src/data/export.ts`、`validationReport.ts`：匯出警告與來源；專案 JSON 沿用既有序列化保存這些可選欄位。
- `scripts/stage4_4a-tests.ts`、`stage4_4a-small.ts`、`scientific-tests.ts`：新增 3 波長×1 AOI、5 波長×2 AOI 的完整 Automatic 測試；檢查有限結果、警告、略過標記、沒有假自由形式結果、UI 文字與 Validation Report。
- `scripts/stage4_4a-regression.ts`：從 Git 讀取基準到 `.qa/` 隔離副本；記錄優化停止量並比較四案例。正式 optimizer/Jacobian 不變。
- 沒有修改任何既有測試的期望值、容差或斷言。沒有修改 main、TMM、統計核心、部署設定、`wrangler.jsonc`、`.node-version`。

## SiO₂ 旗標診斷

不是旗標傳遞錯誤；最後被選中的較低成本精修確實跑滿 35 次。Stage 4.3 的節點選擇改變了傳入物理初始化的曲線；物理階段的排序、精修及旗標傳遞程式未因此改動。

| 精修候選 | 加權資料成本 | 迭代 | converged/status | 最後相對改善 | u 步長 |
|---|---:|---:|---|---:|---:|
| 另一較高成本候選 | 5.596628681769119 | 1 | true/cost | 2.008469074944753e-7 | 5.197964190518042e-8 |
| 最終被選用 | 5.5903415361067745 | 35 | false/max_iter | 4.3931835210901535e-6 | 4.25272613228559e-4 |

最終被選用者的最後相對改善仍大於 ftol=1e-6、步長大於 xtol=1e-9；最後一次迭代起始點的投影梯度範數為 70.6693460039539，對應梯度容差 5.590366095610983e-9。這些是隔離副本的迭代追蹤量，沒有冒稱為另算的最終點梯度。

因此保留 `converged=false`；沒有以「有改善」或另一個候選的收斂旗標替代。完整起點、參數、追蹤：`stage4_4a-sio2-optimizer.json`。

## 與 ea378c5 的數值對照

相同 fixture、種子、AOI 與 targetModelId=gaussian。每個案例兩次完整執行（基準／修改後）；物理與自由形式各比較 711 個波長的 n/k。

| 案例 | 最終 MSE_W 前→後 | 最終膜厚 nm 前→後 | max Δ物理 n/k | max Δ自由形式 n/k | converged 前→後 |
|---|---|---|---:|---:|---|
| Si+SiO₂ | 2.3950798456374924 → 相同 | 99.99715434809612 → 相同 | 0 | 0 | false → false |
| 吸收型 | 24.801369352729214 → 相同 | 100.07153249234608 → 相同 | 0 | 0 | true → true |
| 透明型 | 37.701323083900476 → 相同 | 100.41518545845928 → 相同 | 0 | 0 | false → false |
| 弱吸收 | 63.933956471749376 → 相同 | 99.3787005409195 → 相同 | 0 | 0 | false → false |

四案例 MSE_W、膜厚差均為 0（未出現超過 1e-9 的差異）。逐波長原始數值與兩次輸出：`stage4_4a-comparison.json`；執行輸出：`stage4_4a-comparison.log`。

## 工程測試與仍未解決項目

`pnpm run verify` 結束碼 1；完整原始輸出 `stage4_4a-verify.log`，各命令輸出 `stage4_4a-verify-{name}.log`，摘要 `stage4_4a-verification-summary.json`。

| 項目 | 實際結果 |
|---|---|
| typecheck | exit 0 |
| production build | exit 0 |
| original-tests | 29/29，exit 0 |
| scientific-tests | 76/78，exit 1（既有 76 項中 74 通過，新增 2 項通過） |
| worker-tests | 8/8，exit 0 |

本次仍失敗的測試逐項如下，原因皆為實際 max_iter 與既有 true 斷言不符：
1. `Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance`。
2. `Stage4.1: SiO2 regression and timing against Stage3/4 baseline`。

沒有其他失敗。逐項原始結果：`stage4_4a-scientific-tests.json`、`stage4_4a-original-tests.json`。初次完整執行亦為相同 76/78，保存於 `stage4_4a-verify-initial.log`；後續再執行已包含最終略過來源標記的斷言。

新小資料案例原始輸出：`stage4_4a-small.log`、`stage4_4a-small-tests.json`、`stage4_4a-small-3.json`、`stage4_4a-small-10.json`。3 點：膜厚 100.05640097651045 nm、MSE_W 1.5684331263070719；10 點：100.16561372772821 nm、MSE_W 1.3447997828046496。兩者皆有略過警告及完整結果；這些測試沒有宣稱少量資料能唯一決定模型。

未解決：SiO₂ 的兩個既有收斂斷言；本次不改搜尋、迭代上限、容差、參數或選模，故不會將真實 max_iter 改標為收斂。兩個測試都在旗標斷言先停止；沒有宣稱其後所有數值斷言已通過。

CI：只推送整合分支後查看對應 SHA 的 GitHub Actions；實際執行結果與連結於交付回覆提供，不改設定放行。未執行使用者另行負責的科學驗證。
