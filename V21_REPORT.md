> 原始輸出位置：本機 `.qa/`，不在 repo。本文歷史 JSON／log／CSV／校驗清單檔名均指 `.qa/` 下同名檔案；測試必需的小型數值基準另存 `scripts/fixtures/`，數值未改。

# AutoEllipso V2.1 交付與驗證

驗證日期：2026-10-13。從既有 V2 複製至獨立 AutoEllipso_V2.1；V2、原始解壓專案與 archive 不變。

## 修改與相容性

原科學核心 byte-for-byte 保留。Worker 直接呼叫 autoWorkflow、runAutoFit、runExpertStage 與原 TMM，Automatic、多起點、厚度搜尋、B-spline、物理振盪子、多 AOI、Deep refinement、final forward 移出主執行緒。

UUID / input revision 保護 progress/result；輸入替換、人工修改、取消與 pagehide 終止工作。獨立 forward Worker 以 70ms 節流，pointer up 後完整重算。沒有下採樣或 MSE 縮放，顯示真實 solver progress。React authoritative input ref 不受 speculative render 回退。

響應式版面、SVG screen transformation 與 pointer capture 支援觸控；所有 stage、參數、locks、Peak Builder 保留。固定 TMM 狀態區避免按鈕隨計算位移。Validation Report 是 fresh forward 的完整 JSON，保留 CSV/JSON 匯出。

資料在分頁記憶體，沒有 storage、跨分頁通訊或上傳 API；CSP 禁止 connect。Pages/Vercel 設定、lockfile、版本與 GitHub CI 隨附，沒有 required API key。原 express/genai 未使用依賴為相容性保留，不在 runtime 呼叫。

CSV 既有小數截斷已移除；非有限值拒絕、delta modulo 正規化避免 Infinity 迴圈；CSV/JSON 保留原數值精度，Safari 延後回收下載 Blob URL。

## 實際執行

| 項目 | 結果 |
|---|---|
| 新目錄 dependency install，未複製 V2 node_modules；最終 frozen-lockfile install | 成功，Node 24.19.0 / pnpm 11.25.0 |
| Typecheck / 原 lint 命令 | tsc --noEmit，exit 0 |
| Production build | Vite 8.3.4，exit 0；真實 module Worker / hash assets |
| 原科學測試 | 29/29 |
| V2 科學 regression | 30/30 |
| Worker client / Report / CSV 精度 | 8/8 |
| Production HTTPS Playwright | 39/39，Edge / Firefox / WebKit 各 13 |

科學覆蓋 Fresnel、單層/多層 TMM、phase wrapping、ε→n/k、振盪子、B-spline basis/節點/人工值/locks、真實多 AOI residual、合成厚度/曲線恢復及 final forward。證據：v2-original-tests.json、scientific-tests.json、worker-tests.json、verification-summary.json。

每個瀏覽器執行 HTTPS/deep-link；compiled Worker TMM 逐點比對；multi-AOI B-spline 恢復；Automatic fresh forward；mixed handoff locks；Error/Cancel/Termination；UI cancel/manual edits；duplicate start/replacement input；CSV/JSON/Report 下載；分頁/瀏覽器隔離與 network/storage；桌面 zoom；390×844 手機及 820×1180 平板 stage/lock/控制點/Peak Builder。跨引擎 forward 容差 1e-9 度，沒有改變計算精度或原數據。

此前失敗揭露的 CSV rounding、React ref 回退及平板 layout shift 已修正，最終矩陣全過。Build 仍有既有 unitTests 同時 static/dynamic import defaultProjects 的 chunk 警告，不影響 build/正確性，未為清除提示更改科學測試。

## 尚未驗證與限制

- Windows 執行三引擎與尺寸模擬，未在實體 Android/iPhone、macOS 或低記憶體手機測試；WebKit 不是完整 iPhone Safari 驗證。建置 target Safari 16.4+ / ES2022，較舊瀏覽器未驗證。
- 無 Git remote 或部署帳號連接，沒有公開 URL。Cloudflare/Vercel CDN MIME、headers、公開訪問權限與 Linux 遠端 CI 尚未實際驗證；local HTTPS 使用短期自簽 localhost QA 憑證。
- 大資料減少 candidate payload、依光譜數調整 undo 數量；>2000 點以完整 polyline 取代逐點 DOM markers，全部點仍參與繪圖/擬合。尚無實機最大資料量或長時間耗電/記憶體保證；極端 OS memory kill 不一定回報事件。Worker script/decode/error 與取消已處理。
- 保留 Automatic/Expert、Single Layer 預設/Multi-Layer 可選、模型/設定、candidate/history、匯入匯出及真實指標。非同步 UI 顯示 pending/error，結果未完成不宣稱驗證；Clear Tab Data 重載空白專案。
- 原 V2 模型適用範圍與求解限制仍適用。MSE <10 是工程目標，非所有實驗的保證；自由 spline/數值修正明示非因果，不能冒稱物理模型。

校驗與變更清單：v21-integrity.json / v21-modified-files.json。部署步驟：DEPLOYMENT.md。下載由使用者觸發，不自動送服務端。
