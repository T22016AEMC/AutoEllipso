# Stage 4.8c：自由形式階梯選擇移植

分支v2.2-integration；基準db0ae4b2150877314b80ecb00988b96073db02c2；不部署、不修改Cloudflare設定。
固定全階梯40/1→40/.1→40/.01→60/.01→80/.01；波長等距；λN=.25s、λK=.6s；每步同物理P1、不暖啟動。
邊界n=.5–5.5、k=0–3.5、d=40–200；100次、ftol=1e-5與原xtol/gtol未改；合法=converged且status=cost且dof>0且M≤N_eq/4。
σ模式正式W；σ̂模式只取合法末步rawRSS/dof；非正或非有限則基準fallback並標記σ̂不可用；嚴格改善>.05，階梯同分保留先者。
40被護欄排除才用12/1→12/.1→12/.01→16/.01→20/.01→24/.01；12基準不合法則無可用候選、不fallback。
原8–40流程保留，物理初始化、Expert、TMM、LM、Jacobian、統計公式未修改。M2=同P1的40/1，與新階梯共用單次精修。
非fallback時，新來源ladder_v2嚴格低於舊兩候選才勝出；來源同分保留原chooseFreeFormOrigin規則；fallback依固定基準。結果保存模式／σ̂²／每步狀態、收斂、dof、rawRSS、分數、接受、牆鐘及fallback。
UI及Validation Report新增所選M與s文字／欄位；預設自由形式n/k匯出行為未改。
節點放寬：僅新階梯輸出附_freeFormLadderV2=1時bspline evaluator允許80；公用MAX=40、參數定義與generateAdaptiveKnots上限仍40，舊路徑不變。
投影零方程補行只用於新階梯的寬矩陣；未改SVD或優化／統計核心。

## 改動檔案與目的

- src/fitting/freeFormLadder.ts：固定階梯、護欄、雙模式選擇、步驟紀錄及取消原子性。
- src/fitting/freeFormRefine.ts：可選階梯M/s、零行投影、來源與metadata型別、受限輸出標記。
- src/fitting/autoWorkflow.ts：物理終點之後整合階梯及既有來源、進度事件；物理演算法未改。
- src/models/bspline.ts：僅標記的階梯輸出支援80節點，其他呼叫仍40。
- src/components/OpticalModelComparisonPanel.tsx、src/data/validationReport.ts：所選M/s顯示。
- src/data/export.ts：僅標記的freeFormModel讀取驗證放寬至80；主膜層／Expert仍40，預設CSV匯出不變。
- scripts/stage4_8c-tests.ts：新增單元／副本一致性與相關回歸；stage4_8c-regression.ts：雙模式14次Automatic及樣本外評分；stage4_8c-report.ts：報告與失敗內容檢查。
- scripts/stage4_5d-tests.ts：僅原第29行的來源相容性斷言，使用者明確授權。

## 斷言變更

原全文：`assert.equal(r.freeFormOrigin,chooseFreeFormOrigin(s.ladder!.mseWoollam,physicalSeeded.mseWoollam));`
新全文：`if(r.freeFormOrigin==='ladder_v2'){assert.ok(s.comparisonScores!.ladder_v2!<Math.min(s.comparisonScores!.ladder!,s.comparisonScores!.physical_seeded!));}else{assert.equal(r.freeFormOrigin,chooseFreeFormOrigin(s.ladder!.mseWoollam,physicalSeeded.mseWoollam));}`
理由：新來源須嚴格勝過舊兩候選；ladder／physical_seeded仍須完全符合舊函式回傳；其他斷言／容差／上限不動。
scientific變更前90/92，變更後90/92；失敗名稱及內容與4.8b逐字相同。

## 單元與一致性

新增7項通過，相關4.5d 10/10。涵蓋合法性、嚴格閾值／同分、σ̂不可用、小節點降級、上限隔離、取消不發佈半成品。
M=40,s=1：正式對診斷最大差8.8817842e-16≤1e-9，p/dof/共變異參數ids一致。
M=80,s=0.01：正式對診斷最大差1.1102230e-16≤1e-9，p/dof/共變異參數ids一致。
M=12,s=1：正式對診斷最大差0.0000000≤1e-9，p/dof/共變異參數ids一致。
共用4.8a快取的21資料集×雙模式選擇器對照：42/42設定逐值相同（不重新精修）。
額外3項讀取測試：標記自由形式80節點可回讀；無標記／主膜層80節點仍拒絕。
另1項極少資料測試：六步全被護欄排除，無可用候選、不fallback、不產生結果。移開兩個.qa生成模組後typecheck亦通過，正式型別檢查不依賴它們。

## 雙模式回歸（V0–V6，49001）

σ對4.8a R1c；無σ對4.8b N3。移除σ欄位後用原uniform降級完成Automatic；樣本外49004/49005平均，真值僅評分。
為跨模式可比，表中Win/Wout在選擇完成後以原已知σ及訓練p正式回算；無σ實際正式metric另存JSON。

|模式/真值|所選/對照|Win / Wout / E|ΔWin / ΔWout / ΔE|來源|秒|
|---|---|---|---|---|---:|
|sigma/V0|40Ws1/40Ws1|0.97762 / 1.2073 / 0.00055477|1.11e-16 / 0.00 / 0.00|physical_seeded|35.998|
|sigma/V1|40Ws0.01/40Ws0.01|1.0188 / 1.2416 / 0.0012250|-2.22e-16 / 0.00 / 0.00|ladder_v2|28.860|
|sigma/V2|60Ws0.01/60Ws0.01|0.93328 / 1.3357 / 0.00060776|-2.22e-16 / 0.00 / 0.00|ladder_v2|63.837|
|sigma/V3|60Ws0.01/60Ws0.01|0.95752 / 1.3625 / 0.00034259|3.33e-16 / 0.00 / 0.00|ladder_v2|141.00|
|sigma/V4|80Ws0.01/80Ws0.01|0.94742 / 1.4847 / 0.00034882|-2.22e-16 / 0.00 / 0.00|ladder_v2|51.854|
|sigma/V5|40Ws1/40Ws1|0.97037 / 1.1983 / 0.00031600|-4.44e-16 / 0.00 / 0.00|physical_seeded|25.169|
|sigma/V6|80Ws0.01/80Ws0.01|1.0010 / 1.4899 / 0.00031174|0.00 / 0.00 / 0.00|ladder_v2|57.260|
|sigmaHat/V0|40Ws1/40Ws1|0.97762 / 1.2073 / 0.00055477|8.27e-10 / -2.39e-9 / -7.30e-11|physical_seeded|35.771|
|sigmaHat/V1|40Ws0.01/40Ws0.01|1.0188 / 1.2416 / 0.0012250|5.92e-10 / -3.18e-9 / -8.35e-10|ladder_v2|28.493|
|sigmaHat/V2|60Ws0.01/60Ws0.01|0.93328 / 1.3357 / 0.00060776|-1.38e-10 / 2.49e-9 / 6.44e-11|ladder_v2|42.229|
|sigmaHat/V3|60Ws0.01/60Ws0.01|0.95752 / 1.3625 / 0.00034253|6.65e-7 / 0.00000153 / -6.13e-8|ladder_v2|15.845|
|sigmaHat/V4|80Ws0.01/80Ws0.01|0.94742 / 1.4847 / 0.00034882|6.37e-11 / 1.78e-10 / 8.11e-12|ladder_v2|27.100|
|sigmaHat/V5|40Ws1/40Ws1|0.97037 / 1.1983 / 0.00031600|5.05e-11 / -1.74e-9 / -5.67e-11|physical_seeded|25.384|
|sigmaHat/V6|80Ws0.01/80Ws0.01|1.0010 / 1.4899 / 0.00031174|4.84e-12 / -1.72e-11 / -2.88e-14|ladder_v2|57.528|

sigma：設定一致7/7；門檻≥6/7且不一致ΔWout≤.05：通過。Automatic中位51.854秒，相對4.5d中位21.670秒為2.3929倍。
sigmaHat：設定一致7/7；門檻≥6/7且不一致ΔWout≤.05：通過。Automatic中位28.493秒，相對4.5d中位21.670秒為1.3149倍。
σ案例物理膜厚對4.8a最大差0.0000000nm；無σ權重不同的物理終點差異另存逐例JSON。
耗時對照的4.5d是歷史六真值T0–T5，本次為V0–V6七真值；非同硬體負載下配對計時，加速因果無法判定。

## verify與耗時

完整pnpm run verify僅1次，exit=1；original 29/29、worker 8/8、scientific 90/92。

- Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance：AssertionError [ERR_ASSERTION]: 100.27386919748632 != 99.99715906148896, tolerance 0.001
- Stage4.1: SiO2 regression and timing against Stage3/4 baseline：AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value: /  /   assert.ok(Math.abs(previous.deltaThickness)<1e-3) /

失敗內容變更：無。typecheck/build見 .qa/stage4_8c-verification.json。
階段實測：單元／一致性／快取選擇／護欄13.786秒；相關測試241.32秒；14次Automatic636.33秒；verify479.98秒；合計1371.4秒（不含編輯／等待檢查／獨立正向評分與檔案I/O）。
中斷／重算：來源斷言衝突時未啟動實驗；相關測試T2於JSON讀取40上限中止，修補受限讀取路徑；接續器另一次匯入名稱錯誤未啟動擬合。
已保存T0/T1直接略過，T2重用Automatic輸出只重驗原斷言／回讀，之後案例首次執行；Automatic重算0次。詳 .qa/stage4_8c-resume-history.json、related-tests.json。

## 限制與判斷

4.8b的N3使用σ加權擬合結果再模擬無σ選擇；本次確實移除σ並採uniform。原optimizer以mean(weights²)同比例縮放正則化；本資料常數σ使整體目標尺度不同，未修改核心以強制數值完全相同。
V4/V6的Wout約1.485/1.490，保留原診斷結果；非均勻未知雜訊與真實樣品的泛化能力無法判定（未測）。
回歸A：雙模式通過；B：90/92且同兩項既有失敗；C：新增測試通過；D：只報耗時倍率；E：匯出不變。
原始／逐步／逐點 .qa/stage4_8c-* 不入repo；本報告不建議修改容差或斷言。
規格偏離：無；唯一既有斷言變更依使用者明確修訂。未部署、未推送。
