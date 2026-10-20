> 原始輸出位置：本機 `.qa/`，不在 repo。本文歷史 JSON／log／CSV／校驗清單檔名均指 `.qa/` 下同名檔案；測試必需的小型數值基準另存 `scripts/fixtures/`，數值未改。

# AutoEllipso v2.2 integration — Stage 2

日期：2026-10-19（Asia/Taipei）。版本維持 `2.2.0-dev`，分支 `v2.2-integration`。本段僅修改擬合統計、加權目標、Jacobian、收斂旗標與指定指標呈現；TMM、Δ 轉換、色散模型、Automatic/Expert 流程步驟順序及既有版面容器不變。

## 數學與相容性

- 資料殘差統一為未加權、單位度、交錯的 `[Ψ0, Δ0, Ψ1, Δ1, ...]`。先對 Δ 做圓周差分，再由 LM 內部乘權重，避免對加權角度進行 360° 折返。
- `chiSquare=Σ(w*r)^2`，`dof=max(1,2N-M)`，`mseWoollam=sqrt(chiSquare/dof)`，`reducedChiSquare=chiSquare/dof`。`mse` 仍為未加權 Raw MSE，沒有人工縮放；TARGET_MSE=10 與其他 deg² 固定門檻仍比較 Raw MSE。
- 完整 σ 才使用各點 `1/σ`。任何點缺少有限正值 σ 時，整個共同資料集退回均勻權重並警示；per-AOI 分解沿用同一 fallback。Ψ 優先與 component/legacy point weights 經同一函式計算。
- LM 的加權資料項為 `chiSquare/(2N)`；正則化乘 `mean(w²)`。中央差分在未加權殘差上計算，含 Δ 圓周分子、實體參數步長、上下界單側退回，再逐列乘權重。
- `converged` 不再以單純改善代替；另提供 `improved`，並保留使用者停止。Engine 只在真收斂時標為 converged；有改善但未收斂為 max_iter。Automatic/Expert 的 Raw target 達標與收斂旗標分開呈現。
- `preparePhysical` 原為 ε 空間投影。本段為遵守資料 residualFn 都是度數的原則，改在量測波長/AOI 上，以來源人工光學模型的 TMM Ψ/Δ 作初始化目標，保留 σ；後續步驟仍由原 Stage 3/4/5 執行。
- 舊 B-spline `regularizationPenalty` / `totalObjective` 保留 Raw 診斷契約（Raw MSE + 原平滑罰項）；新增 `weightedRegularizationPenalty` / `weightedTotalObjective` 保存實際優化目標。選最佳與排序使用加權目標，沒有用 Raw 診斷冒充加權目標。
- 新專案預設 σ 權重；舊專案設定不改。權重選單與 Woollam/Raw/χ²ᵣ、缺 σ／未收斂提示在原區塊內更新。CSV 原欄位保留，新指標追加於末尾；JSON 與 Validation Report 包含全域及各 AOI 指標。

## 變更檔案與函式

| 檔案 | 函式／變更 |
|---|---|
| `src/fitting/residual.ts` | 新增 residualWeights；computeResidualMetrics、computeMultiAoiResidualMetrics 與指標型別 |
| `src/fitting/optimizer.ts` | optimizeBoundedLM、OptimizerOptions/Result；centralDifferenceJacobian（同一內部 Jacobian 供解析回歸） |
| `src/fitting/engine.ts` | runAutoFit：交錯殘差、預掃描、LM 權重、Woollam progress、狀態與結果 |
| `src/fitting/autoWorkflow.ts` | runAutomatedEllipsometryFit：七個 LM 子問題、粗掃/盆地/multi-start/model 排序、實際 M、結果與診斷 |
| `src/fitting/expertWorkflow.ts` | fitExpert、preparePhysical、runExpertStage：加權目標與正則化、σ 初始化、進度、結果 |
| `src/types/ellipsometry.ts` | FittingResult 的統計/收斂/per-AOI/診斷欄位及 multiStartSummary |
| `src/data/defaultProjects.ts` | 三個 benchmark factories 與 createBlankProject 的新專案預設 |
| `src/components/FittingStrategyModal.tsx` | 權重選項，保留原有控制區塊 |
| `src/components/FittingStatusBottomBar.tsx` | Woollam/Raw/χ²ᵣ、缺 σ／未收斂顯示 |
| `src/components/FinalFitResultModal.tsx` | 主要 MSE 與警示、Raw 診斷標示，不宣稱未收斂結果已收斂 |
| `src/components/ExpertFittingPanel.tsx` | 使用實際 config/M 計算指標、Woollam progress 與警示 |
| `src/App.tsx` | 空資料指標型別、傳遞 config/M、進度標籤；不變更版面容器 |
| `src/data/validationReport.ts` | createValidationReport：fresh forward 後的 Woollam/χ²/dof/mode/per-AOI/收斂 |
| `src/data/export.ts` | exportFittedParametersJson、exportFittedCurveCsv（結果 CSV）、版本來源與新統計欄位 |
| `scripts/scientific-tests.ts` | 8 項新增測試；既有測試不變 |
| `scientific-tests.json`、`v2-original-tests.json`、`verification-summary.json` | 本次實際執行結果；不是修改測試期望值 |
| `STAGE2_REPORT.md` | 本報告，隨本段提交 |

## pnpm run verify — 實際結果

最終 summary 時間：`2026-10-19T10:52:20.714Z`。Node/pnpm 使用現有鎖定環境；沒有新增依賴。

| 子命令 | 通過／總數 | Exit |
|---|---:|---:|
| typecheck (`tsc --noEmit`) | 命令通過 | 0 |
| build (`vite build`) | 命令通過 | 0 |
| original-tests | 29 / 29 | 0 |
| scientific-tests | 42 / 42 | 0 |
| worker-tests | 8 / 8 | 0 |

本次五份 log 隨 ZIP 保存：`v2-typecheck.log`（成功無輸出，0 bytes）、`v2-build.log`、`v2-original-tests.log`、`v2-scientific-tests.log`、`v2-worker-tests.log`。各命令 exit code 見 verification-summary.json。

新增測試包含指定五項：真值 Woollam、σ 改變目標而 Raw 不變、缺 σ fallback、解析中央差分及上下界、單次迭代改善不代表收斂；另驗證正則化尺度/權重長度、解析加權最適解/第七進度參數、Engine 與 Expert 真正共同擬合異質 σ 的多 AOI。

真值實測：

| 資料 | Woollam MSE | Raw MSE (deg²) | χ² |
|---|---:|---:|---:|
| SiO2/Si 70° | 0.9385477930963038 | 0.0014093951358815082 | 126.84556222933568 |
| SiO2/Si 65°/70°/75° | 0.9164250565915056 | 0.0013437358149579887 | 362.80867003865757 |

額外實際執行 Windows Edge Production Preview smoke：Woollam/Raw/χ²ᵣ 顯示與三個權重選項、編譯後 module Worker 的 σ 擬合與未收斂旗標、完整 fresh forward Validation Report、缺 σ 警示、實際 CSV／參數 JSON 下載欄位均通過，無 page error。本段未重跑完整三瀏覽器矩陣或實體手機測試。

Build 保留原有 defaultProjects 同時 static/dynamic import 的 chunk 警告，build exit 0。

## 修改過的既有測試期望值

**無。** 未放寬容差、未刪除測試。原 benchmark 對 Raw B-spline 診斷的契約在實作中保留，未調整其斷言。新增測試不是修改既有期望值。

## Git 與交付

`v2.1-baseline` 已指向 `0fd3bd9c246e914fa10cbbc8e43d488eb42519b4`。本段提交前的實際命令：

```sh
git log --oneline v2.1-baseline..HEAD
```

```text
b149368 Integrate standard Delta convention and measurement uncertainties
```

本報告隨 Stage 2 單一 commit 提交。為避免報告自含其 commit hash 的循環引用，**提交後的完整實際 `git log --oneline v2.1-baseline..HEAD` 隨 ZIP 附在 [STAGE2_GIT_LOG.txt](STAGE2_GIT_LOG.txt)**；也可用隨附 `.git` 直接重現。Stage 2 commit 訊息：`Integrate Woollam MSE, sigma-weighted fitting and central Jacobian`。

交付 ZIP：`AutoEllipso_V2.2_stage2.zip`，包含原始碼、完整 `.git`、lockfile、本報告、summary、測試結果與本次五份 verify log。排除 node_modules、dist/build、.playwright、.qa、test-results、coverage、所有舊 ZIP 與所有 `.env*` 檔（含環境範本）；不包含 QA 憑證。既有舊 ZIP 未覆寫。

重新建置：`pnpm install --frozen-lockfile`、`pnpm run verify`。封裝後另逐項驗證 ZIP CRC、必要/排除項目與內容雜湊，大小與 SHA-256 在交付回覆提供。
