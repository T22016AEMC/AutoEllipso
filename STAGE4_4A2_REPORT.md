# Stage 4.4(a2)：清理輸出與物理精修上限

基準：`51546e819e220f276881f01c6508961ee67b4d65`；分支：`v2.2-integration`。

## 清理摘要

- 從目前版本樹移除 118 個原始 JSON/log/CSV/校驗清單，移至本機 `.qa/`，不在 repo；未重寫 Git 歷史，舊 commit 仍含歷史輸出。
- 保留既有原始碼、文件及四個應用/建置 JSON 設定。測試真正使用的五份小型基準存於 `scripts/fixtures/`（共 1,157 bytes），只保留既有斷言讀取欄位，其值逐項與基準 commit 比對。
- 歷史報告加上「本機 .qa/，不在 repo」註記；`.gitignore` 排除原始輸出。`scripts/qa-files.mjs` 與型別宣告統一路由測試、診斷及舊封裝腳本的輸出到 .qa；截圖也改放 .qa。
- 小型 fixture 的搬遷只改讀取位置；既有測試斷言、期望值及容差未改。清理清單：本機 `.qa/stage4_4a2-cleanup.json`（不在 repo）。

## 唯一正式計算變更

`src/fitting/autoWorkflow.ts:1689`：物理模型最後全資料精修的 `maxIterations: 35 → 100`（原有兩個候選精修呼叫共用該設定）。未改 ftol/xtol/gtol、tolerance=1e-6、其他階段上限、模型排序、optimizer 或部署設定。

SiO₂ 被選精修：100 次，成本 5.586989476372822，converged=false，status=max_iter。100 次仍未收斂，依指示停止增加上限；另一較高成本候選的收斂狀態沒有替代最佳解的狀態。

下表為被選候選最後五次接受步（成本是加權資料殘差平方和／殘差數；該精修無正則化）：

| 迭代 | 成本 | 相對改善 |
|---|---:|---:|
| 96 | 5.587166804764098 | 0.000005873942745744581 |
| 97 | 5.587143335270611 | 0.000004200607267943505 |
| 98 | 5.587104305990643 | 0.000006985551940563484 |
| 99 | 5.5870336400603735 | 0.000012648042062396238 |
| 100 | 5.586989476372822 | 0.000007904675431839523 |

## 四案例前後對照

沿用 stage4_4a-regression 的案例、fixture、種子、AOI、gaussian 與隔離追蹤方式；新增 `scripts/stage4_4a2-regression.ts`，基準改為 51546e8，記錄本次允許的數值變化。舊腳本的斷言保留。

| 案例 | MSE_W 前 → 後 | 膜厚 nm 前 → 後 | converged 前 → 後 | ΔMSE_W |
|---|---|---|---|---:|
| SiO2 | 2.3950798456374924 → 2.3943616735440143 | 99.99715434809612 → 99.99715429373421 | false → false | -0.000718172093478131 |
| absorbing | 24.801369352729214 → 24.801369352729214 | 100.07153249234608 → 100.07153249234608 | true → true | 0 |
| transparent | 37.701323083900476 → 36.01052662418056 | 100.41518545845928 → 100.37338018935196 | false → true | -1.6907964597199197 |
| weak | 63.933956471749376 → 63.621807140463225 | 99.3787005409195 → 99.37827329492892 | false → false | -0.3121493312861503 |

四案例 MSE_W 均未上升。自由形式曲線四例的 n/k 差值均為 0；物理曲線隨精修改變，未宣稱其數值不變。完整數值：本機 `.qa/stage4_4a2-comparison.json`、`.qa/stage4_4a2-comparison.log`（不在 repo）。

## SiO₂ 精修計時

兩個精修起點合計：35 次上限 2057.8237999999837 ms → 100 次上限 5884.756700000027 ms。被選候選自身：1990.252600000007 → 5838.83170000001 ms。
同機各一次、相同隔離追蹤包裝；同時有 verify 執行，這是觀察到的牆鐘耗時，不是獨佔效能基準。原始軌跡：本機 `.qa/stage4_4a2-sio2-before.json`、`.qa/stage4_4a2-sio2-after.json`（不在 repo）。

## 驗證結果與未解決項目

| 最終 pnpm run verify | 結果 |
|---|---|
| typecheck | exit 0 |
| build | exit 0 |
| original-tests | exit 0, 29/29 |
| scientific-tests | exit 1, 76/78 |
| worker-tests | exit 0, 8/8 |

失敗項目逐條列出：

1. `Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance`：AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: false !== true 。
2. `Stage4.1: SiO2 regression and timing against Stage3/4 baseline`：AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: false !== true 。

兩項仍在 converged=true 的既有斷言先停止，後續數值斷言未執行；沒有宣稱改成收斂後其餘斷言會通過。SiO₂ 的 100 次上限仍不足，未再調參。

原始輸出均為本機 .qa/，不在 repo：`stage4_4a2-verify-final.log`、`verification-summary.json`、`v2-*.log`、`scientific-tests.json`。首次輸出 `stage4_4a2-verify.log` 包含已修復的 I/O 包裝型別錯誤；最終完整重跑如上。另有 I/O 6 項檢查、fixture 原值與斷言片段比對，見 `stage4_4a2-io-tests.log`、`stage4_4a2-fixture-audit.json`、`stage4_4a2-assertion-audit.json`。

歷史封裝/診斷若需要完整舊輸出，需本機 .qa 封存資料；乾淨 clone 的 verify 只依賴受追蹤的小型 fixture。未執行瀏覽器或歷史封裝測試，未作科學驗證結論。
只推整合分支；推送後對應 SHA 的 GitHub Actions 實際結果與連結於交付回覆提供，不改設定放行。
