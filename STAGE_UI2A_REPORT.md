# Stage UI-2a 版面調整報告

## 修改檔案
- `src/App.tsx`：DOM 順序改為樣品結構、薄膜參數、結果圖表。
- `src/components/LayerParamPanel.tsx`：本機 UI 收合狀態、可操作標題列與 hidden 內容區。
- `src/components/VisualizerPanel.tsx`：控制列順序、圖卡版面、SVG 字級與資料點顯示尺寸。
- `src/index.css`：設定／結果區排序、收合區與響應式控制列、16:10 圖卡。
- `scripts/ui2a-browser-tests.mjs`：新增本段 e2e 與 15 張驗收截圖腳本。
- `STAGE_UI2A_REPORT.md`：本報告。

## 實作方式
- 資料匯入按鈕沿用頁首；樣品結構與薄膜參數在桌面並排，結果區在兩者下方。
- <900px 依 DOM 順序堆疊：資料匯入／操作列 → 樣品結構 → 薄膜參數 → 結果。
- 所有指定薄膜欄位保留；固定前處理、最終物理模型與厚度／初始值／上下限直接顯示。
- 色散參數預設收起；整列為原生 button，顯示標題、既有參數數量及箭頭。
- button 提供 aria-expanded／aria-controls，原生支援 Enter／Space；內容以 hidden 隱藏。
- React state 只存在元件內，未寫入專案 JSON；切換物理模型、重建參數後維持當下收合狀態。
- 展開內的欄位與事件處理保持原狀；不使用高度／收合動畫。
- 結果區順序：檢視／參與擬合／實驗理論控制 → 圖表分頁 → 原 Zoom 列 → 圖表。
- 控制項觸控高度 44px；桌面群組含邊框約 46px；窄畫面按組或組內乾淨換行。
- 可能換行的控制群組外框使用既有 14px 權杖；膠囊只保留於單行按鈕。
- 同時解除 Filter 圖示被既有通用 SVG min-height 拉高的問題，避免再撐成大橢圓。
- 圖卡由網格決定寬度，固定 16:10；>=900px 兩欄，<900px 單欄。
- All／單一 AOI 使用同一尺寸規則；圖內邊距與短座標標籤避免小螢幕重疊，完整名稱仍在圖卡標題。
- ResizeObserver 只校正 SVG 顯示字級／點半徑為至少 11px／2px，不修改量測／擬合數據或波長 Zoom 行為。
- 沿用 UI-1 的顏色權杖與字型，未新增色碼、字型或套件。

## Automatic／Expert 按鈕與狀態位置
- Automatic 執行按鈕保留於頁首工具列；Expert 按鈕保留於下方原資料／操作列。
- Automatic 階段狀態保留在頁首工具列下方；統計／狀態 footer 保留頁尾。
- 原執行按鈕與階段狀態已在設定區上方，故原位保留；沒有插入參數區與結果區之間。
- 深色結果詳細視窗與 Expert 介面未改版；未新增 n/k 圖，也未處理 UI-4 Zoom 功能。

## 測試與驗收
- 既有測試選擇器更新：無；沒有修改任何既有測試的期望值或斷言。
- 新 e2e 使用新增的 disclosure／控制群組標記與模型 aria-label，驗證預設收合、點擊與鍵盤、aria-expanded。
- 同時驗證 hidden 內容不進入 Tab、模型切換保留狀態、UI state 不寫進 JSON。
- 以實際三角度標樣執行 Automatic，完成後關閉原詳細視窗，拍攝主畫面與結果區。
- 三尺寸皆驗證無橫向捲軸、控制列無大橢圓、區塊順序、44px 控制高度及 All／單一 AOI 圖卡尺寸一致。
- 最終 e2e 共 11 項通過，瀏覽器執行錯誤 0；15 張截圖皆已完成。
- 原始 e2e：`.qa/ui2a/ui-tests.log`、`.qa/ui2a/ui-results.json`。
- 尺寸／字級／控制列數據：`.qa/ui2a/geometry-*.json`、`.qa/ui2a/controls-*.json`、`.qa/ui2a/*-layout.json`。
- 擬合後原始專案：`.qa/ui2a/fitted-project.json`；保護範圍／Zoom／色碼稽核：`.qa/ui2a/scope-audit.json`。

## 15 張截圖
- `.qa/ui2a/empty-1440.png`
- `.qa/ui2a/fitted-collapsed-1440.png`
- `.qa/ui2a/fitted-expanded-1440.png`
- `.qa/ui2a/all-aois-1440.png`
- `.qa/ui2a/single-aoi-1440.png`
- `.qa/ui2a/empty-900.png`
- `.qa/ui2a/fitted-collapsed-900.png`
- `.qa/ui2a/fitted-expanded-900.png`
- `.qa/ui2a/all-aois-900.png`
- `.qa/ui2a/single-aoi-900.png`
- `.qa/ui2a/empty-390.png`
- `.qa/ui2a/fitted-collapsed-390.png`
- `.qa/ui2a/fitted-expanded-390.png`
- `.qa/ui2a/all-aois-390.png`
- `.qa/ui2a/single-aoi-390.png`

## 完整 verify 與部署
- 原 verify 持續執行並正常結束，未中斷、未重跑；exit 1，只有下列兩項既有科學測試失敗。
- typecheck／build 通過；original 29/29、Worker 8/8、scientific 98/100。
- 既有失敗：Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance。
- 既有失敗：Stage4.1: SiO2 regression and timing against Stage3/4 baseline。
- SiO₂ 兩項既有失敗與斷言維持原狀；不藉本段修改科學測試。
- `verify.log` 保留命令輸出並附全部子程序完整日誌；原命令輸出另存 `.qa/ui2a/verify-command.log`。
- 完整原始輸出與子項摘要保存 `.qa/ui2a/verify.log`、`.qa/ui2a/v2-*.log`、`.qa/ui2a/verification-summary.json`。
- 以 `v2.2-integration` commit／push 觸發既有 Cloudflare 部署；證據保存 `.qa/ui2a/deployment.json`。
- 正式網址：https://autoellipso.t22016.workers.dev/ 。`.qa/` 按原設定留在本機，不納入 Git。

