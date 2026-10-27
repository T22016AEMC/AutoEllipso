# Stage UI-0 手動擬合導覽與骨架報告

## 修改檔案
- `src/App.tsx`：UI 模式、持續掛載的 tabpanel、共用 Expert 進度顯示。
- `src/components/TopToolbar.tsx`：模式分段控制、上方按鈕排序、移除重複的手動計算入口。
- `src/components/ExpertFittingPanel.tsx`：移除全螢幕骨架、Close Expert 與重複版本標題；內部邏輯／介面未改。
- `src/components/LayerParamPanel.tsx`：原「套用變更並手動計算」文字改「套用變更並重算 TMM」，回呼不變。
- `src/index.css`：模式導覽、卡片外框與手機換行；沿用既有權杖，未新增色碼、字型或套件。
- `scripts/ui-tests.mjs`、`scripts/production-browser-tests.mjs`、`scripts/ui1-browser-tests.mjs`：僅入口選擇器／步驟調整。
- `scripts/ui0-browser-tests.mjs`：新增 UI-0 狀態保留、鍵盤、Worker 與截圖驗證。
- `STAGE_UI0_REPORT.md`：本報告。

## 手動計算功能檢查
- 舊頁首按鈕呼叫 `src/App.tsx` 的 `handleManualCalculate = () => compute.refresh(0)`。
- Expert「Fresh TMM Recalculate」呼叫同一 `compute.refresh(0)`；手動調參數也由既有 hook 自動刷新 TMM。
- 無 Expert 未涵蓋的獨有功能。只移除頁首重複按鈕／toolbar prop；原函式與參數區重算回呼保留。
- 未修改 `useBrowserCompute`、Worker、TMM、擬合器、統計、匯出或專案 JSON 格式。

## 導覽與狀態保留
- 上方順序：自動／手動模式 → 擬合設定 → 自動執行按鈕；資料庫、單元測試靠最右。
- 主執行按鈕只在自動模式顯示；設定按鈕保留實際 STD／AGGRESSIVE 策略標示，未為顯示 STD 而改原設定。
- <900px 模式分段控制獨占最前一列；模式按鈕觸控高度 >=44px。
- 自動內容一直掛載；Expert 首次進入手動模式才載入，之後保持掛載，以 hidden 切換。
- 首次進入才建立 Expert，保留既有 Restore Session Start 的初始快照語意；切換後不重建 Undo／Redo 等內部狀態。
- 模式與首次載入旗標都是 App 的 UI state，不寫入專案 JSON；切換不呼叫 setProject、refresh 或 cancel。
- 載入資料、AOI、參數／鎖定、結果、狀態列、Undo／Redo、候選解與 Stage 由原有狀態持續保留。
- Automatic 進度與頁尾維持共用；Expert 原進度回呼另外投影至共用狀態列，未更動 Worker 呼叫或 Stage 行為。
- 模式 tablist／tab／tabpanel 具有 aria-selected、aria-controls 與 roving tabindex；支援左右鍵、Enter／Space。
- hidden 內容以 display:none 隱藏，程式 focus 與 Tab 均不能進入；共用版本／Report／清除卡片保留於兩種模式。
- Expert 外框採 UI-1 卡片，內部仍為原深色、原 Stage 按鈕與圖表；移除其重複版本標題及 Close Expert。
- 未增加 #auto／#manual，重整預設自動模式；既有 #empty 用途不變。

## 測試選擇器／步驟更新與理由
- 三份既有 UI 腳本：button「Expert Fitting Mode」→ tab「手動擬合」，入口已改為模式切換。
- production／UI-1 腳本：button「Close Expert」→ tab「自動擬合」，不再銷毀 Expert。
- UI／production 腳本：Expert dialog 內容查詢 → tabpanel「手動擬合」，因 Expert 不再是 modal。
- UI-1 等待舊關閉按鈕 → 等待 region「Expert fitting controls」，確認 lazy Expert 已掛載後才截圖。
- 三份既有腳本除上述導覽替換外內容相同；87 個既有 assert 呼叫保持原樣，未修改期望值。
- 本次後續收尾僅依使用者授權修改新增 UI-0 最後一項 Expert 狀態測試；其他程式與測試保持前次內容。

## N3 新測試修正理由與結果
- 原新測試沒有 fill('1.8')，卻要求 Stage 2 擬合結果 N3≈1.8，這是擬合結果假設而非狀態保留驗證。
- 診斷證明現版切換／不切換與 c6aeb38 舊版都得到 N3=1.1083677122324502，三層值一致；不是模式丟值。
- 依使用者明確授權，改為 Stage 2 完成後讀 N0／N2／N3／K3／厚度的 before，往返模式後讀 after。
- 五個參數逐項要求差值 <1e-12，實測差值全部為 0；未放寬容差。
- 另以 fill('1.8') 設 N3、等待 TMM，往返模式後仍為 1.8，同樣使用 <1e-12。
- 證據：`.qa/ui0/n3-diagnosis.md`、`.qa/ui0/expert-retention-values.json`、`.qa/ui0/retention-change-scope.json`。

## UI／e2e 與六張截圖
- UI-0 共 7 項通過，瀏覽器執行錯誤 0；涵蓋預設模式、鍵盤／隱藏焦點、狀態保留與工具列排列。
- 真實 Automatic／Expert job 在切換時 ID 不變，沒有取消、錯誤或重啟；完成結果有 freshCalculationVerified。
- 原始結果：`.qa/ui0/ui-tests.log`、`.qa/ui0/ui-results.json`、`.qa/ui0/automatic-jobs.json`、`.qa/ui0/expert-jobs.json`。
- 保護範圍稽核：`.qa/ui0/scope-audit.json`；工具列尺寸：`.qa/ui0/toolbar-1440.json`、`.qa/ui0/toolbar-390.json`。
- `.qa/ui0/automatic-empty-1440.png`
- `.qa/ui0/automatic-fitted-1440.png`
- `.qa/ui0/manual-1440.png`
- `.qa/ui0/automatic-empty-390.png`
- `.qa/ui0/automatic-fitted-390.png`
- `.qa/ui0/manual-390.png`
- 六畫面皆無頁面橫向捲軸；Expert 內部表格保留原本局部橫向捲動，未做 UI-3 改版。

## 完整 verify 與交付
- 原完整 verify 已於 2026-10-27 12:42（台北）正常結束，相關 node 程序已不存在；未中斷、未重啟。
- exit 1；typecheck／build 通過，original 29/29、Worker 8/8、scientific 98/100。
- 僅既有失敗：Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance。
- 僅既有失敗：Stage4.1: SiO2 regression and timing against Stage3/4 baseline；斷言未動。
- `verify.log` 附全部子程序完整輸出；原命令輸出另存 `.qa/ui0/verify-command.log`。
- 完整命令及子程序輸出保存 `.qa/ui0/verify.log`、`.qa/ui0/v2-*.log`、`.qa/ui0/verification-summary.json`。
- 以 `v2.2-integration` commit／push 觸發既有 Cloudflare 部署，線上 commit 證據保存 `.qa/ui0/deployment.json`。
- 正式網址：https://autoellipso.t22016.workers.dev/ 。`.qa/` 按原設定留在本機，不納入 Git。
- 未開始 UI-2b、UI-3 或 UI-4。
