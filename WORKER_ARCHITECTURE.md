# 瀏覽器計算架構

`src/workers/compute.worker.ts` 直接匯入 V2 的 autoWorkflow、engine、expertWorkflow 與 calculator；沒有重寫 solver/模型/optimizer，也沒有改變數值精度或 MSE。autoWorkflow 內的 global search、multi-start、B-spline、physical fitting、multi-AOI、deep refinement 都在此專用執行緒執行。

`protocol.ts` 定義 start/progress/result/error/cancel/terminate；每個 request/response 帶 jobId 與 revision。`client.ts` 的每個工作建立 Dedicated Worker，檢查同一 job/revision，成功/失敗後 terminate。Cancel 發送 protocol 訊息並立即 terminate，避免無法讓出 event loop 的長循環延遲取消；取消不採用半成品。

`useBrowserCompute.ts` 維護單一輸入版本與 authoritative input ref。人工改值、換資料、model/config 改變都增版、取消工作；只有有效版本能接受結果。React speculative render 不寫回此 ref。Forward 回應只合併計算點，不覆蓋新增的 candidate、stage selection 或 UI settings。

Fitting 與 forward 使用分開的 Worker client；每次改值合併到最新輸入、70 ms debounce完整 TMM request；拖曳結束立即重新算完整光譜。曲線編輯、觸控與 UI 在主執行緒，n/k 顯示為真實模型計算。等待期間標示 Ψ/Δ/MSE 屬上一輪，沒有 fake preview residual 或縮減最後光譜。

重複 Start 由 synchronous busy guard 與 client job replacement 防止。Worker script/error/message-decode failure 回報到 UI，不覆寫原輸入。分頁關閉終止兩個 Worker，不發送測量資料。不同分頁/使用者没有 shared worker、BroadcastChannel 或共同 fitting state。

候選解留在 UI，不在每次 worker payload 中重複傳送。Undo 數量隨光譜大小調整，仍保留 Undo/Redo/候選還原。大量點的 SVG 使用包含所有點的線條，避免每個點都生成 marker；不改任何 calculation/validation/export 數據。Validation Report 的 full fresh TMM、n/k 與 JSON 序列化亦在 Worker。

參考：[Vite module worker constructor](https://vite.dev/guide/features.html#web-workers)、[MDN Worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)。
