# Stage UI-1 外觀改版報告

## 範圍與設計
- 主畫面、資料匯入、Automatic 設定／執行狀態、圖表與結果摘要改為灰藍底、白色圓角卡片、深青藍主色。
- 桌面採樣品／光譜雙欄，參數卡片全寬；<900px 單欄，手機左右 16px。
- 集中權杖：`src/index.css` 的 `Stage UI-1` 區塊；以 `.ui1-surface` 限定淺色範圍。
- 使用系統字型及等寬數據字型，無新增字型、CDN 或套件。
- 保留所有欄位、按鈕文字、事件、計算流程與專案 JSON 格式。
- 分段控制增加 aria-pressed；曲線用虛線區分 AOI，警告保留文字說明。

## 修改檔案
- `index.html`：favicon、apple-touch-icon。
- `src/index.css`：設計權杖、淺色樣式、響應式、focus、彈窗及既有深色介面相容。
- `src/App.tsx`：僅增加主畫面／流程樣式範圍標記。
- `src/components/TopToolbar.tsx`：新 Logo，沿用 APP_VERSION／BUILD_COMMIT。
- `src/components/SampleStackPanel.tsx`：樣式標記、分段按鈕 aria-pressed。
- `src/components/LayerParamPanel.tsx`：各分支樣式標記。
- `src/components/VisualizerPanel.tsx`：樣式標記、圖表配色／虛線、分段 aria-pressed；資料處理未變。
- `src/components/FittingStatusBottomBar.tsx`：摘要 footer 樣式標記。
- `src/components/CsvImportModal.tsx`：樣式標記。
- `src/components/FittingStrategyModal.tsx`：樣式標記。
- `public/logo/AutoEllipso logo.png`：原圖完整副本。
- `public/logo/autoellipso-logo.png`：去背、裁掉空白邊界的頁首圖。
- `public/logo/autoellipso-icon.png`：374×374 圓角圖示。
- `scripts/ui1-browser-tests.mjs`：本階段 Playwright 操作、對比及截圖驗證。
- `STAGE_UI1_REPORT.md`：本報告。

## Logo
- 採方案 A：將與外部連通的近白底色轉透明，另清除字樣封閉區域的底色。
- 保留藍色方塊內白色 Ψ／Δ；原檔未刪、完整副本 SHA-256 相同。
- 原圖 1985×792；頁首裁成 1714×394，桌面高 60px、手機高 40px，alt="AutoEllipso"。
- 目視確認縮放後邊緣乾淨，無明顯白色毛邊；合成檢查 `.qa/ui1/logo-edge-check.png`。
- favicon 與 apple-touch-icon 指向同一方形 PNG；瀏覽器請求返回 200。
- 原檔／保護範圍稽核：`.qa/ui1/scope-audit.json`。

## 測試與截圖
- 既有測試選擇器更新：無；原按鈕文字、ID 與選擇器均保留。
- 未修改任何既有測試期望值或斷言；新增 UI 驗證另存新腳本。
- 以 production preview、Playwright Edge 實際執行 Automatic，完成後關閉原詳細視窗拍摘要。
- 六張主畫面／結果截圖皆無頁面橫向捲軸；文字可換行，未見標籤截斷。
- 手機 CSV 欄位映射、匯入與儲存 JSON 保留 30.1234567 精度；鍵盤 focus 明顯可見。
- 六種畫面的可見文字對比最低 4.62:1；focus 樣式、觸控尺寸、Logo 與 icon 已檢查。
- 原始結果：`.qa/ui1/ui-results.json`、`.qa/ui1/ui-tests-final.log`。
- 尺寸／對比原始資料：`.qa/ui1/*-layout.json`、`.qa/ui1/*-contrast.json`。
- 桌面主畫面：`.qa/ui1/main-1440.png`
- 桌面 Automatic：`.qa/ui1/automatic-1440.png`
- 平板主畫面：`.qa/ui1/main-900.png`
- 平板 Automatic：`.qa/ui1/automatic-900.png`
- 手機主畫面：`.qa/ui1/main-390.png`
- 手機 Automatic：`.qa/ui1/automatic-390.png`
- 額外檢查：`.qa/ui1/settings-390.png`、`.qa/ui1/import-390.png`、`.qa/ui1/import-mapping-390.png`、`.qa/ui1/expert-smoke.png`。

## 連動與保留區域
- 主畫面共用的圖表、參數／樣品元件、FitAssessmentSummary 在主摘要內隨樣式範圍連動。
- Expert、FinalFitResultModal、參數詳細報告 dropup、光學資料庫及單元測試視窗保留原深色風格。
- Expert 僅補回淺色 shell 影響的文字繼承色；未改版，手機開關檢查可用。
- 詳細結果視窗只確認 Automatic 結束可開啟／關閉；未進行下一階段改版。

## 完整 verify
- 完整 `pnpm run verify` 僅執行一次，exit 1：typecheck／build 通過，original 29/29、Worker 8/8、scientific 98/100。
- 既有失敗 1：Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance。
- 既有失敗 2：Stage4.1: SiO2 regression and timing against Stage3/4 baseline。
- 驗證期間僅補正 CSS／新 UI 檢查；最終 CSS 已另經 build 及 16 項 UI 檢查通過，未重跑科學測試。
- 原始輸出：`.qa/ui1/verify.log`、`.qa/ui1/v2-*.log`、`.qa/ui1/verification-summary.json`、`.qa/ui1/scientific-tests.json`。
- 使用者指定的 SiO₂ 兩項既有失敗及其斷言維持原狀。

## 交付與部署
- 既有 Cloudflare Worker：`autoellipso`，正式分支 `v2.2-integration`。
- 以 commit／push 觸發既有 Cloudflare Git 部署；發布與線上 commit 核對證據保存 `.qa/ui1/deployment.json`。
- 正式網址：https://autoellipso.t22016.workers.dev/ 。
- `.qa/` 依原專案設定不納入 Git；原始截圖／輸出保留於本機。
