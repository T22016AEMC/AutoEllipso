# Stage 4.5d：物理起點自由形式精修

基準 e589f5d；僅提交 v2.2-integration。原始輸出均為本機 `.qa/stage4_5d-*`，不在 repo。

## 修改與選擇規則

- `src/fitting/freeFormRefine.ts`：取最終物理模型在量測格點的曲線作SVD起點；只在副本變更主要圖層，其餘層固定。物理結果不被取代。
- 固定40個等距波長節點；n係數 .5–5.5、k係數0–3.5、厚度40–200 nm；全資料、100次、ftol=1e-5、既有xtol/gtol；λN=.25、λK=.6。k沒有正下限；正則化只有二階差分，沒有靠攏物理曲線的懲罰。
- `autoWorkflow.ts`：最終物理回算/統計之後，新增「自由形式精修」進度；既有shouldStop延續使用。失敗保留階梯並輸出警告；小資料集沿用原警告略過。T0–T5均使用216資料點/432殘差。
- 全資料比較：sigma模式使用Woollam MSE，其他模式用Raw MSE；取較低者，差≤1e-6×max(|a|,|b|)取physical_seeded。模型、統計、係數邊界、fitAdequacy與曲線同步切換。階梯稽核資料仍是原階梯。
- 統計只呼叫既有computeFitStatistics/freeFormCurve，沿用below_detection/unreliable。`ellipsometry.ts`、`freeFormOptics.ts`新增可選來源欄位，舊JSON不需遷移。
- `OpticalModelComparisonPanel.tsx`顯示來源與兩組MSE；`export.ts`、`validationReport.ts`加入freeFormOrigin/freeFormRefinement。新自由形式CSV保留source=free_form並附free_form_origin；前三欄與既有欄位不動。缺來源的舊資料維持舊CSV表頭。
- 新增 `stage4_5d-tests.ts`、`stage4_5d-run.ts`、本報告產生腳本；scientific-tests.ts只新增import/呼叫，未改任何既有斷言。

## A、D：完整Automatic與4.5c M2比較

同4.5fixture/seed45001；T0 Cauchy、T1 TL、T2 Gaussian、T3 Lorentz、T4雙Gaussian、T5 Cauchy n加700–900 nm線性k至.02。數字未拿來調參。厚度誤差相對100 nm。

|案例|階梯MSE_W|採用MSE_W / 4.5c M2|膜厚誤差nm / 4.5c M2|來源|總秒 / 新精修秒|
|---|---:|---:|---:|---|---:|
|T0|1.077921690|0.9976920782 / 0.9976921241|0.04701588300 / 0.04701503095|physical_seeded|24.70891090 / 1.460347800|
|T1|20.35262098|3.732113217 / 3.732113217|0.005831206557 / 0.005831206557|physical_seeded|16.10097730 / 0.5892703000|
|T2|119.1284462|2.045791941 / 2.045791941|0.3345591520 / 0.3345591520|physical_seeded|38.65120940 / 0.9265929000|
|T3|249.0989307|14.14003215 / 14.14003215|-1.482265547 / -1.482265547|physical_seeded|65.59843910 / 1.025208200|
|T4|182.4644634|27.82832899 / 27.82832899|1.556219791 / 1.556219791|physical_seeded|11.30289630 / 1.080423500|
|T5|1.081584513|0.9957966246 / 0.9957966246|0.03364087393 / 0.03364087393|physical_seeded|18.63061340 / 0.9743054000|

A：全部6例皆MSE_W≤階梯，k有限且≥0、自由形式膜厚在40–200內，來源均physical_seeded。新CSV來源、JSON還原、Validation Report及SSR文字亦在同一測試檢查。
D：超過1e-6相對差的項目：T0 膜厚誤差：Δ=8.520506185e-7 nm，相對差=0.00001812294071。T0的4.5c M2以另行擬合的Cauchy(k0自由)起點，本次使用正式Automatic的Gaussian終點；起點不同、固定停止準則下終點略有差異。T1–T5未超過門檻。

## B、C與選擇防呆

B：T2、Cauchy零k起點，吸收區max k=0.6348439045（要求>0.01）；初始MSE_W=1153.469783→2.045784382。未加入k正下限。
C：3點與10點完整Automatic皆有結果、有原資料不足警告，freeFormRefinement.skipped=true、無physicalSeeded結果，沒有拋錯。
防呆：同分/1→1.0000005選physical_seeded，1→2留ladder，1→.5選physical_seeded；非有限候選留ladder。串行新增測試 10/10；原始結果在 `.qa/stage4_5d-serial-tests.log`、`.qa/stage4_5d-serial-tests.json`、`.qa/stage4_5d-zero-k.json`、`.qa/stage4_5d-small-*.json`。

## 四案例回歸與耗時

before取e589f5d隔離副本，after取本次src；均targetModelId=gaussian、同輸入，前後依序執行且未與其他計算並行。表內物理結果前後一致；n/k比對完整輸出格點。

|案例|物理MSE_W前→後|物理膜厚前→後nm|converged前→後|最大Δn/k|自由MSE_W前→後|總秒前→後|
|---|---:|---:|---|---:|---:|---:|
|SiO2|1.965241221→1.965241221|100.2738692→100.2738692|true→true|0|0.9394132827→0.8947196855|28.30410400→22.67704680|
|absorbing|24.80136935→24.80136935|100.0715325→100.0715325|true→true|0|1.075213932→1.049784262|33.42998930→34.24571330|
|transparent|30.07345886→30.07345886|100.5811313→100.5811313|false→false|0|1.050237343→1.029387965|28.87440660→33.08617690|
|weak|39.17325200→39.17325200|99.52986347→99.52986347|false→false|0|1.052418214→1.037054862|29.66709280→27.58424090|

物理MSE_W、膜厚、converged及全部n/k皆用嚴格相等斷言，四例通過。耗時僅單次牆鐘，含JIT/系統波動，不作加速結論；前後原始輸出：`.qa/stage4_5d-regression.log`、`.qa/stage4_5d-regression.json`及`.qa/stage4_5d-reg-*.json`。

## verify與限制

`pnpm run verify`原始輸出：本機 `.qa/stage4_5d-verify.log`；各子項 `.qa/stage4_5d-v2-*.log`、測試明細 `.qa/stage4_5d-scientific-tests.json`（均不在repo）。
命令exit code：typecheck=0；build=0；original-tests=0；scientific-tests=1；worker-tests=0。original 29/29、worker 8/8；scientific 90/92。

- 既有失敗：Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance：AssertionError [ERR_ASSERTION]: 100.27386919748632 != 99.99715906148896, tolerance 0.001
- 既有失敗：Stage4.1: SiO2 regression and timing against Stage3/4 baseline：AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value: assert.ok(Math.abs(previous.deltaThickness)<1e-3)

既有期望值修改：無。新增失敗：0；未調整選擇、門檻、平滑或任何容差。
未解決：物理透明/弱吸收的converged仍false；T1–T4自由形式仍有偏差，較低MSE不代表所有n/k、膜厚或σ涵蓋率改善。T4膜厚誤差由階梯−.8112變+1.5562 nm。
UI只做SSR文字/匯出/JSON檢查，未做互動瀏覽器測試；未做跨種子統計校準。未改TMM、Δ、optimizer、residual、statistics演算法、Worker、物理階段、原容差/上限或部署設定。
GitHub Actions 在本commit推送後查詢，結果由交付訊息回報；本報告不預先宣稱通過，也不修改CI設定。
