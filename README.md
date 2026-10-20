# AutoEllipso V2.1

以完成的 V2 完整複製建立，保留原 TMM、optimizer、Automatic / Expert 科學功能。加入瀏覽器 Worker、跨裝置操作、完整精度 CSV、Validation Report 與 Cloudflare Pages / Vercel 靜態部署設定。實驗資料只在各分頁記憶體，沒有帳號、資料庫、API 或雲端 fitting。

## 安裝與執行

使用 Node 24.19.0、pnpm 11.25.0（版本與 lockfile 隨附）：

```sh
pnpm install --frozen-lockfile
pnpm run verify
pnpm run build
pnpm run preview
```

preview 供本機 production 驗證。正式網站部署 `dist`；Git、Cloudflare Pages、Vercel 的發布步驟見 [DEPLOYMENT.md](DEPLOYMENT.md)。目前未連接部署帳號或 Git remote，沒有發布公開網址。

`typecheck` 和原 `lint` 都為 `tsc --noEmit`，未另設 ESLint。`verify` 執行 typecheck、build、原有 29 項測試、V2 科學 30 項、Worker/報告/CSV 8 項。

## 操作

- 匯入 Ψ/Δ CSV，設定 AOI、基材、單層或多層；Automatic / Deep Optimize 在 Worker 內運算。
- Expert Stage 0–5、bounds、Lock、候選解、Undo/Redo、Restore 與接續擬合保留。
- Stage 2 可初始化 cubic B-spline，觸控拖曳或精確編輯 n/k 控制係數、節點、平滑及鎖定。
- Peak Builder 保留 Gaussian / Lorentz / Tauc-Lorentz / Drude 與明示非因果的自由修正，先組合介電函數再求 n/k。人工模型、厚度與鎖定進入原 optimizer。
- 修改後 70ms 節流啟動完整光譜 TMM，拖曳結束立即重算；錯誤顯示訊息，取消或輸入變更使舊工作失效。
- Save Project、CSV、Download Validation Report 都由使用者自行下載。Report 在 Worker fresh forward 後產生完整 JSON，含版本、AOI、基材、堆疊、初始/最終厚度、模型、參數/bounds/locks、Raw MSE/RMSE/各 AOI MSE、全光譜 n/k/Ψ/Δ 與狀態。
- 無 localStorage/IndexedDB，Clear Tab Data 清空分頁並終止計算。關閉分頁終止 Worker，不同分頁不共享狀態。

## 瀏覽器測試重現

```sh
pnpm exec tsx scripts/worker-fixtures.ts
pnpm exec playwright install firefox webkit
pnpm run build
pnpm run test:browser
```

下載瀏覽器前，將 `PLAYWRIGHT_BROWSERS_PATH` 環境變數設為專案 `.playwright` 絕對路徑，與測試腳本一致。Windows 的完整矩陣需要已安裝 Edge；其他平台可用 `QA_ENGINES=firefox,webkit` 跑部分矩陣，Linux 可能需 `playwright install --with-deps`。

HTTPS QA 先用 Python 安裝 `cryptography` 並執行 `python scripts/make-test-cert.py`。憑證只供 localhost，未納入部署/Git/ZIP。沒有憑證時使用 HTTP，報告會標示。手機/平板為尺寸及 Pointer Events 模擬，Edge 另用 CDP touch，不能代替實機驗證。

實際結果與限制見 [V21_REPORT.md](V21_REPORT.md)、[browser-production-results.json](browser-production-results.json)、[verification-summary.json](verification-summary.json)。Worker 設計見 [WORKER_ARCHITECTURE.md](WORKER_ARCHITECTURE.md)。

## 封裝與來源

`AutoEllipso_V2.1.zip` 為完整可重建來源；`AutoEllipso_V2.1_static.zip` 為已測試 production dist，index.html 在壓縮檔根目錄。`pnpm run package:v21` 在保有相鄰 V2/Original/原 archive 的開發目錄校驗 SHA-256 後封裝；独立下載的專案可直接 build，追溯式封裝需相鄰原始來源。

原始輸出與校驗清單現存本機 `.qa/`（不在 repo）；測試所需的小型基準存於 `scripts/fixtures/`。`v2-baseline-manifest.json` 為複製前 72 個 V2 檔案的 SHA-256；`original-manifest.json` 為 49 個原始檔案。`v21-integrity.json` 為逐檔校驗，`v21-modified-files.json` 為本次修改/新增/移除清單，`v21-packages.json` 為 ZIP checksum。

原 V2_REPORT、baseline/UI 歷史報告與 package.mjs 保留作來源證據；V2.1 以本 README、V21_REPORT、production-browser-tests 為準，不使用舊 package:v2 封裝 V2.1。
