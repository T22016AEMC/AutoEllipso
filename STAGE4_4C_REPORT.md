# Stage 4.4(c)：振子啟用門檻

基準 `2d8abe9e658f42e6612d77b0bd166293a2554757`；分支 `v2.2-integration`。本報告僅記錄實作與工程測試輸出。

## 門檻盤點（以下行號為基準版本）

| 分類／檔案:行號 | 門檻或條件 | 處置與理由 |
|---|---|---|
| (a) gaussian.ts:246,250 | A2/A3 > 0.001 | 移除正振幅死區，直接累加兩個 ε 項 |
| (a) lorentz.ts:181 | A ≤ 0.001 return | 移除；現有 E≥1e-3、gamma≥1e-4 已令分母為正 |
| (a) taucLorentz.ts:272 | A ≤ 0.01 return | 移除；仍共用原解析函式與安全域處理 |
| (a) multiOscillator.ts:270,289,306 | A1/A2/A3 > 1e-5 | 改為無條件計算，保留原有型別分派與累加順序 |
| (b) gaussian.ts:32,47,64 | E≤0、sigma≤0、A≤0 | 有效域及精確零幅度捷徑；允許域 A≥0 無正振幅死區 |
| (b) multiOscillator.ts:28,33,50,66 | E/A/width≤0；den<1e-12 | 零幅度／無效域捷徑及除零保護，保留 |
| (b) taucLorentz.ts:17,21–22,43,49,61,63,74–75,84 | 正寬度與 C<2E0、有限性、A=0、距 Eg<1e-9、E<Eg×1e-4 | 防止複數根、log(0)、零能量相消及非有限輸出，保留 |
| (b) gaussian.ts:229,233,237,241；lorentz.ts:163,167,171,175；taucLorentz.ts:252–266；drude.ts:74,77 | E/width 的正下限 | 分母與寬度安全，不是振幅啟用門檻，保留 |
| (b) base.ts:14,22,32–33；sellmeier.ts:84,92–96；custom.ts:116,127；cauchy.ts:84 | 非正能量／波長、sqrt≥0、分母≥1e-6、波長≥0.1 | 轉換、根號及除法保護，保留 |
| (b) kk.ts:9,15,17,19,23,30；kkBspline.ts:23–24,35,41,64–69,89,92 | 積分誤差/深度、奇異點1e-9、端點、零欄範數、solver停止1e-10 | 積分與線性求解安全，非振幅裁切，保留 |

以下是模型定義／明確控制／初始化政策，不冒稱數值安全，也不屬隱藏的振幅啟用死區：
- TL:45 的 E≤Eg（吸收邊）；TL:25–33 僅對非零振子驗證；expertMixed:13,18,21–27 的 enabled/type；kkBspline:67 的 IR 啟用。
- peakInitialization:34,43,61,69 的 5% prominence、4% 距離、1e-12 平坦判斷、2% onset 均為既有初始化政策，本段不動。
- bspline/cubicSpline 的範圍、節點與端點分支；tabulated/cauchy/custom/sellmeier 的 n/k 有效域及 Sellmeier k=0 模型定義均保留。Drude 沒有正振幅啟用門檻。
- 已掃描 src/models 全部 16 個檔案；完整含行號條件清單：本機 `.qa/stage4_4c-model-audit.log`，不在 repo。

## 修改摘要與零振幅／連續性

正式修改僅四個上述模型；新增 scripts/stage4_4c-tests.ts、stage4_4c-regression.ts、stage4_4c-report.mjs，scientific-tests.ts 僅登錄新測試。未改 optimizer、參數邊界、排序、統計、迭代上限或部署設定；既有斷言／期望／容差修改：無。
隔離基準與現行模型在 190–900 nm（每 1 nm，各振幅依次設 0）ε₁/ε₂ 最大差：gaussian=0；lorentz=0；tauc_lorentz=0；multi_oscillator=0。
新增四個模型測試以全部零幅度背景與單振子單位響應對照：A=1e-8、1e-5、0.001、0.001001、1，逐點線性誤差界 1e-12×max(1,|ε|)；並以未修改的 optimizer 驗證 A=0 的單側 Jacobian 非零。
原始 ε 數表：本機 `.qa/stage4_4c-continuity.json`；測試原始輸出：`.qa/v2-scientific-tests.log`，均不入 repo。

## 四案例完整 Automatic 前後對照

相同 Stage4.1 fixture、41001 種子、65/70/75°；SiO₂ 用既有 createMultiAoiSiO2OnSiProject。每側各一次完整流程；前後皆用隔離副本的相同只讀 optimizer 呼叫包裝。多組與 verify 並行，秒數為牆鐘耗時，不是獨佔效能基準。

| target／案例 | MSE_W 前 → 後 | 膜厚 nm 前 → 後 | converged 前 → 後 | 秒 前 → 後 | ΔMSE_W／上升標示 |
|---|---|---|---|---|---|
| gaussian/SiO2 | 2.39436167354 → 1.96524122119 | 99.9971542937 → 100.273869197 | false → true | 120.090 → 117.464 | -0.429120452358 |
| gaussian/absorbing | 24.8013693527 → 24.8013693527 | 100.071532492 → 100.071532492 | true → true | 174.235 → 109.092 | 0.00000000000 |
| gaussian/transparent | 36.0105266242 → 30.0734588620 | 100.373380189 → 100.581131291 | true → false | 59.336 → 70.747 | -5.93706776218 |
| gaussian/weak | 63.6218071405 → 39.1732520006 | 99.3782732949 → 99.5298634665 | false → false | 55.366 → 44.794 | -24.4485551399 |
| lorentz/SiO2 | 1.91346211837 → 2.41404782830 | 100.317733091 → 100.000163421 | true → true | 100.878 → 82.317 | 0.500585709927 **上升** |
| lorentz/absorbing | 53.9239218087 → 53.9239218087 | 104.593124747 → 104.593124747 | true → true | 161.286 → 125.807 | 0.00000000000 |
| lorentz/transparent | 24.0743554515 → 27.9172359582 | 102.426815281 → 103.095752935 | true → true | 57.985 → 54.843 | 3.84288050675 **上升** |
| lorentz/weak | 53.9602242886 → 53.9602242886 | 99.9780160763 → 99.9780160763 | true → true | 51.048 → 52.152 | 0.00000000000 |

成本上升的兩項為 Lorentz/SiO₂（+0.500585709927）與 Lorentz/transparent（+3.84288050675）。SiO₂ 被選終點 A2 由0.00709472243815變0；被選精修起點 gamma2 由5變0.0961744118555，顯示搜尋路徑已不同，尚未進一步診斷其原因。
如有成本上升：移除門檻後有限差分與後續非線性搜尋路徑會改變；本次未重排候選、改起點或調參。僅由本次輸出無法判定各上升案例的更細原因。完整參數、各 optimizer 起點／終點／status：本機 `.qa/stage4_4c-{gaussian,lorentz}-{案例}-{before,after}.json`，不在 repo。

## 兩 Gaussian 振子案例

預先固定真值：eps_inf=2.2；A=2,E0=2.5,sigma=0.3；A2=1.2,E02=4.5,sigma2=0.4；A3=0。Si、100 nm、65/70/75°、190–900 nm 每10 nm、σΨ=σΔ=0.03°；LCG+Box–Muller 種子44003。保留預設 Automatic 初值與全部設定，沒有依結果調參。

| 版本 | A2 終值 | A2−1.2 | MSE_W | 膜厚 nm | converged/status | 被選優化呼叫 A2 初值／u／貼界 |
|---|---|---|---|---|---|
| before | 1.20018467441 | 0.000184674410278 | 1.00013581877 | 100.001476239 | true/cost | 1.20018467441／0.0120018467441／false |
| after | 1.20018467441 | 0.000184674410278 | 1.00013581877 | 100.001476239 | true/cost | 1.20018467441／0.0120018467441／false |
此固定案例在基準已還原第二峰；前後數值相同，不能作為完整流程改善的證據。A2 是原欄位名稱，沒有為改善誤差而交換振子標號；峰位與所有起點保存在本機 `.qa/stage4_4c-two-two-{before,after}.json`。若標號交換／多振子分攤，不能由 A2 單一誤差宣稱唯一還原，未調參。

## verify 與未解決項目

typecheck exit 0；production build exit 0；original 29/29；worker 8/8。新增四項模型測試均通過。
verify 原始輸出：本機 `.qa/stage4_4c-verify.log`、`.qa/v2-*.log`、`.qa/verification-summary.json`（不入 repo）。
```json
{"at":"2026-10-21T07:00:54.527Z","commands":[{"name":"typecheck","exitCode":0},{"name":"build","exitCode":0},{"name":"original-tests","exitCode":0},{"name":"scientific-tests","exitCode":1},{"name":"worker-tests","exitCode":0}]}
```
scientific：80/82；新增四項：4/4。失敗逐項列出：
- Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance：AssertionError [ERR_ASSERTION]: 100.27386919748632 != 99.99715906148896, tolerance 0.001。
- Stage4.1: SiO2 regression and timing against Stage3/4 baseline：AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:    assert.ok(Math.abs(previous.deltaThickness)<1e-3) 。
沒有新增失敗的測試名稱；兩個原有失敗的原因已從 converged=false 變為膜厚歷史數值斷言：本次 converged=true，膜厚100.27386919748632 nm 對照99.99715906148896 nm，差0.27671013599736 nm，超過原0.001 nm 容差。未改動或放寬。
基準已知失敗名稱：Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance；Stage4.1: SiO2 regression and timing against Stage3/4 baseline。既有測試若因 converged 轉 true 而進到後續數值斷言，仍保留其原斷言，不改寫期望。
Gaussian/transparent 的 converged 由 true 變 false（max_iter），雖 MSE_W 下降仍未收斂；Gaussian/weak 仍為 false。沒有因成本改善就改寫收斂旗標。
新增測試只驗證模型零值、連續性及有限差分啟用，不能據此推論所有資料的全域搜尋或參數可辨識度。未執行額外瀏覽器測試。
僅推 v2.2-integration；推送後對應 commit 的 GitHub Actions 狀態與連結於交付回覆回報，不更改 CI 設定。
