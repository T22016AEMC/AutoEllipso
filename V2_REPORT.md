> 原始輸出位置：本機 `.qa/`，不在 repo。本文歷史 JSON／log／CSV／校驗清單檔名均指 `.qa/` 下同名檔案；測試必需的小型數值基準另存 `scripts/fixtures/`，數值未改。

# AutoEllipso V2 交付紀錄

## 原始保留及 baseline

唯一基準為工作目錄的 `autoellipso.zip`，SHA-256：`F511D681DDE4FC20AB4E2BCD809327744B6BD579B5967DD48BE24B8535FB8C88`。壓縮檔無多餘最外層目錄，完整解壓到 `AutoEllipso_Original`，完整複製至 `AutoEllipso_V2` 後才修改。原檔沒有 node_modules/dist 等需要刪除的產物；所有原始碼、設定、資源、模型、TMM、optimizer、UI、測試及匯出功能均保留。

`original-manifest.json` 記錄每個原始檔的路徑、大小及 SHA-256。`integrity-verification.json` 在交付時再次核對原始 ZIP、原始解壓檔及 Git baseline。Baseline commit `1e1fcd6` 在功能修改前建立：build/typecheck 通過、原 29 項測試全通過，沒有發現原有編譯或既有測試失敗。

原 public/assets/aistudio/.gitignore 會忽略自身，初次 Git baseline 漏收該檔；兩份磁碟副本一直保留原始位元組。`original-baseline` 分支由初次 baseline 補入此未修改檔案形成完整原版快照，交付稽核逐檔驗證此快照；未改寫既有歷史。

環境的沙箱啟動器因 S:/Q: 裝置錯誤無法啟動，工作使用已批准的沙箱外 PowerShell。初次 pnpm 的安裝腳本政策尚未設定而退出 1；已明確禁用未需要的安裝腳本，最後 `pnpm install --frozen-lockfile` 實際退出 0。所有依賴版本已鎖定。

## 架構、功能與修改

| 模組 | 實作 |
|---|---|
| `src/fitting/expertWorkflow.ts` | 六個獨立階段、驗證、完整候選快照、曲線投影、人工接續、multi-AOI residual、全域膜厚掃描、20-start joint LM、fresh verification |
| `src/components/ExpertFittingPanel.tsx` | 真實 pointer 操作、精確輸入、控制拓撲、平滑、鎖定、Undo/Redo、Restore、Save Candidate、峰操作及即時圖表 |
| `src/models/cubicSpline.ts` | Open clamped cubic knot vector、Cox–de Boor、非均勻 basis、端點處理 |
| `src/models/expertMixed.ts` | Gaussian/Lorentz/Tauc-Lorentz/Drude 介電函數相加；獨立自由 δε spline；精確保留可停用的人工 n/k 基線 |
| `src/models/kk.ts` | Dawson 評估與奇點扣除、無窮域自適應 KK quadrature |
| 既有 TMM/calculator/residual | 保留接口與核心架構，修正吸收相位、厚膜溢位、內部精度與 phase wrapping |
| 既有 App/registry/types/export | Expert 接入、即時 TMM、狀態保存、模型註冊、舊 JSON 遷移、完整參數與鎖定匯出 |

Stage 0–5：Validation、Cauchy、B-spline/Peaks、Physical、Global+Local、Final Verification。選取階段本身不覆寫解；Run 才執行。Stage 1 明確初始化 Cauchy。Stage 3 對 mixed 模型保留峰類型、數量、參數、上下限及 locks；純數值 spline 則建立物理初值並保留人工來源快照。

編輯直接寫入既有 Layer.parameters，模型、TMM 及 optimizer 都讀取同一份數值。候選解包含堆疊、基材、AOI、資料及配置，以原 project JSON 保存。混合峰也註冊於原模型庫，所以原 n/k 匯出可評估新增模型。

物理峰只相加 ε，再平方根轉為 n/k，不相加各模型 n/k。自由 δε 與數值 n/k 基線明確標示非因果；進入 builder 不抹掉人工曲線，停用數值基線可改成純物理峰。

## 物理修正及實際擬合

- N=n+ik 的被動波採 exp(+iβ)，characteristic matrix 使用 -i off-diagonal。厚吸收膜在同一 solver 内使用等價穩定反射遞迴；以獨立 Fresnel recurrence 對照透明/吸收單層、多層及厚膜。參考：[Byrnes 的推導與實作](https://github.com/sbyrnes321/tmm/blob/master/tmm_core.py)。
- Gaussian ε1 使用 odd Gaussian Hilbert transform；Tauc-Lorentz 保留原 ε2 公式，改用去奇點、至無窮域的自適應積分。以完整能量及形狀參數鍵快取 unit-amplitude KK；振幅變更免重新積分，最終 TMM 仍 fresh 執行。
- 移除 Lorentz/Gaussian/Tauc-Lorentz 的 ε1 floor 與 mixed 的 n≥1 floor，保留金屬與共振區的負 ε1／低 n。內部不先四捨五入 Ψ/Δ 或 MSE。
- Raw MSE = Σ(rΨ²+rΔ²)/(2N)，單位 deg²，不縮放。Δ 採最短圆周差。平滑 penalty 與 Raw MSE 分開；保存最低 regularized objective 的候選，Best Raw MSE 顯示觀察到的原始誤差。
- Expert residual 真正使用所選 AOI 的完整光譜。膜厚掃描用 TMM residual，再 20-start bounded LM 共同擬合厚度、光學參數及啟用的 substrate 參數。Disabled peaks／locked parameters 不進 variable vector。
- 每次 stage fit 都由最佳參數重算全光譜並獨立核對；Stage 5 再 fresh forward。零個待擬合變數仍回報真實誤差，不虛報 MSE=0。

## 實際測試結果

| 檢查 | 結果與證據 |
|---|---|
| Baseline build/lint(typecheck) | 通過；`baseline-build.log`、`baseline-lint.log` |
| Baseline tests | 29/29；`baseline-tests.json` |
| V2 build/typecheck | 通過；`verification-summary.json`、`v2-build.log` |
| V2 原有 tests | 29/29；`v2-original-tests.json` |
| 新增科學 tests | 30/30；`scientific-tests.json` |
| 真實 Edge UI 操作 | 9/9，無 page error；`ui-tests.json` |
| 依賴重現安裝 | `pnpm install --frozen-lockfile`，exit 0 |

科學測試涵蓋 Fresnel/TMM、單層/多層/厚吸收膜、零厚度、Δ wrapping、unscaled MSE、非均勻 cubic basis/Bezier 特例、ε↔n/k、Gaussian/KK、窄 Lorentz KK、Tauc bandgap/收斂、mixed ε 組合、峰生命週期、人工 n/k optimizer、multi-AOI 共同影響、已知 n/k/厚度恢復、遠距 global recovery、多層厚度恢復、mixed Lorentz/Drude 恢復、鎖定、fresh 保存解、六階段連續執行、JSON 相容及人工基線精確保留。

瀏覽器操作包含精確係數修改、Undo/Redo、實際拖曳與 lock、控制點增減/位置調整、候選還原、從人工值真正擬合、五種峰操作、Stage 接續保留、Stage 3 實際執行。測試 server 使用空閒本機 port，關閉 HMR 並於完成後關閉。

保留 Vite 的既有 dynamic/static import 重複警告，不影響 build。Expert UI 採 lazy load，主 bundle 低於 500 kB。原 `lint` 就是 typecheck，沒有虛稱另外執行 ESLint。

## 相容性與交付

原有 Automatic workflow、CSV 匯入、專案 JSON、n/k/曲線/參數匯出、模型設定與模型庫均保留。Single Layer 預設與 Multi-Layer 可選模式保留。舊 project JSON 的全域 B-spline grid 會遷移為每層明確 grid；V2 candidates、mixed parameters、bounds、locks 可完整 round-trip。參數匯出新增完整 Layer.parameters 與 Expert 狀態，誤差取當前曲線，避免人工修改後沿用舊 MSE。

核心相容性證據是原 29 項測試仍全通過；未宣稱已逐一手動點測所有原有匯出對話框。完整逐檔修改清單在 `modified-files.json`，原始完整性證據在 `integrity-verification.json`。可執行指令見 README。交付 `AutoEllipso_V2.zip` 包含完整 source、lockfile、資源與測試，排除 node_modules/dist/Git/暫存；重新安裝即可建置。

## 尚未完成或未驗證項目

1. 未提供外部實測資料；尚未驗證所有真實材料、系統校正、量測雜訊、不確定度及參數唯一性。Raw MSE < 10 是工程目標，不是任意資料的保證。
2. 純數值 spline 的自動物理初值目前投影成一個 Gaussian seed。可人工建立混合峰；沒有實作自動保證找出任意材料最佳峰類型/數量。
3. 數值控制點 4–20、混合峰最多 32。拓撲增減以 least-squares 投影，未宣稱每次都精確無損；鎖定係數時禁止重建拓撲。
4. Expert refinement 採所選 AOI 的完整光譜與 unweighted residual；原 Automatic 的 wavelength/weighting 配置保留。未新增 Expert covariance/不確定度加權。
5. 計算仍於瀏覽器主執行緒，optimizer 定期 yield、可停止；未新增 Worker，尚未量測數萬波長、32 峰或大量膜層的效能極限。
6. 沿用原 coherent/isotropic TMM；未新增 anisotropic、非相干或 Mueller-matrix 求解。自由曲線不宣稱 KK consistent；改為純物理模型可能提高真實 MSE。

已交付的所有操作均接入真實模型/TMM/optimizer，没有用 mock、demo 或 placeholder 冒充功能。
