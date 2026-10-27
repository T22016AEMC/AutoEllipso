# Stage UI-2b 最小 n/k 圖表報告
- 修改檔案：`src/components/OpticalConstantsPanel.tsx`（新）、`src/components/VisualizerPanel.tsx`、`src/App.tsx`、`src/index.css`、本報告。
- n/k 僅讀 `FittingResult.finalOpticalConstants`（物理）、`freeFormOpticalConstants`（自由形式），不呼叫模型、TMM 或擬合器。
- 同源匯出：`src/components/OpticalModelComparisonPanel.tsx` → `src/data/export.ts::exportOpticalConstantsCsv / opticalConstantsCsv`；預設來源規則在 `src/fitting/fitPresentation.ts::defaultOpticalExport`，均未修改。
- 既有結果無資料則空圖；多層提供層選單，物理陣列屬第一層、自由形式屬既有 primaryLayerIndex，其他無資料的層空白，不重算。
- 沿用 `.plot-card / .plot-grid / .plot-canvas`；桌面六張圖卡均 623×389.375px、24px 圓角。物理為 accent 實線，自由形式為 primary 虛線。
- n/k 共用資料範圍並留 5% Y 邊界；k 可切線性／對數，≤0 點斷線略過，全非正值時顯示指定提示，X 仍保留原資料範圍。
- SVG 路徑依既有策略一次繪製／快取；游標二分查最近既有波長，無插值、無逐點事件；n 顯示 4 位、k 顯示 5 位小數。
- AOI-only 變更僅保留同一輸入的圖表快照；換資料、模型、參數或其他設定即失效；擬合 busy 時空圖，結果更新即取新陣列。
- 人工觀察：AOI 檢視／參與擬合切換路徑不變；自由形式單獨存在、空結果、全零 k 對數提示均正常；其他層無資料時不畫。
- 驗收只用已保存的 UI-0 結果 fixture；單物理情境只隱藏自由形式陣列。未重新擬合或生成 n/k；CSV 由原格式化函式輸出。
## 三個波長人工對照（CSV n/k → 游標 n/k）
| 波長 nm | 物理模型 | 自由形式 |
|---|---|---|
| 400 | 1.4808799521683977 / 4.4096722451232091e-4 → 1.4809 / 0.00044 | 1.4823900152074694 / 1.2505995596137615e-4 → 1.4824 / 0.00013 |
| 550 | 1.4674669378844778 / 1.1562973598047046e-3 → 1.4675 / 0.00116 | 1.4692451845894428 / 3.7886121745429516e-4 → 1.4692 / 0.00038 |
| 700 | 1.4624457150795827 / 1.2668747412663060e-3 → 1.4624 / 0.00127 | 1.4640322248477611 / 3.1511861417667894e-4 → 1.4640 / 0.00032 |
- 三個波長兩來源皆與原 CSV 依指定小數位顯示一致；完整精度仍保留於原陣列／CSV。
- 原始對照：`.qa/ui2b/wavelength-samples.json`、`.qa/ui2b/physical.csv`、`.qa/ui2b/free-form.csv`。
## 桌面截圖與檢查
- `.qa/ui2b/physical-only.png`（1440 桌面，僅物理模型）。
- `.qa/ui2b/both-curves.png`（1440 桌面，兩來源並列）。
- `.qa/ui2b/k-logarithmic.png`（1440 桌面，k 對數）。
- build／typecheck 均通過：`.qa/ui2b/build.log`、`.qa/ui2b/typecheck.log`。
- 未跑完整 verify、未新增或執行 e2e；既有 UI 選擇器測試未執行、未修改。
- 人工截圖資料與範圍稽核：`.qa/ui2b/visual-observations.json`、`.qa/ui2b/scope-audit.json`；瀏覽器錯誤 0。
- 越界說明：`App.tsx` 僅傳 project／busy 圖表 props；Visualizer 只接入新圖，既有 Ψ/Δ 資料處理原碼不變；CSS 只補圖表樣式。
- 運算、匯出、JSON 格式、套件、既有測試、結果詳細視窗均未動；無新增色碼／字型／窄螢幕排版。
- 未做縮放、波長連動、σ_k 帶、偵測標記或圖片匯出；未開始 UI-3／UI-4。
- 部署與線上 commit 證據：`.qa/ui2b/deployment.json`；正式網址 https://autoellipso.t22016.workers.dev/ 。
