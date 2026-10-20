> 原始輸出位置：本機 `.qa/`，不在 repo。本文歷史 JSON／log／CSV／校驗清單檔名均指 `.qa/` 下同名檔案；測試必需的小型數值基準另存 `scripts/fixtures/`，數值未改。

# AutoEllipso 整合第 4 段：工程實作報告

基準：`43c4231982c2d59fb63272d2f991e7477bc9cdb3`，分支 `v2.2-integration`。
本報告只記錄實作與工程測試輸出；實驗資料與模型判讀由使用者另行執行。

## A. 解析 Tauc–Lorentz

- `computeTaucLorentzEps1` 改為題示 Jellison–Modine 五項解析式，回傳振子貢獻；ε∞ 仍是呼叫端獨立加法常數。
- 五項中第 4、5 項合併後評估，避免兩個 log 在 Eg 附近互相抵消。`|E−Eg|<1e-9` 以 `Eg+1e-9` 評估。E/Eg<1e-4 時，使用合併 log 項的零能量展開：`2Eg[1+ln(Eg²/D)+(E/Eg)²/3+(E/Eg)⁴/30]`，其中 `D=hypot(E0²−Eg²,Eg C)`。Eg=0 時合併 log 項為 0。
- `safeTaucLorentzDomain` 將試算 C 投影至 `[1e-10,2E0(1−1e-8)]`，Eg 投影至 `[0,E0(1−1e-8)]`，確保公式使用實 α。保留原 TL model 對 E0≥Eg+0.05 的求值保護。ε₂ 原定義未變；有限值檢查若失敗會拋出錯誤。
- `validateTaucLorentzDomain/Parameters` 在 JSON 匯入（含候選解、manualSource）與 Expert 驗證時拒絕違反 `E0>Eg≥0`、`0<C<2E0` 的作用中振子，包含既有 A1/E01/C1 別名；介面沿用既有錯誤顯示。參數說明同步列明耦合域。
- Automatic、獨立 TL model、mixed oscillator、Expert Peak Builder 共用同一個 TL ε₁ 函式。TL 的 kkReal 呼叫及 kkCache 已刪除，正式 TL 路徑沒有數值積分或快取；kkReal 僅在測試交叉對照 TL 使用。KK B-spline 是另一模型，其基底積分不屬於 TL 實作。
- 不更換 optimizer 的座標參數化：域限制在模型求值記錄上投影，原始試算向量仍採既有 box bounds。這不同於新增耦合座標最佳化器；此段沒有更改 optimizer、殘差、MSE 或 Jacobian 演算法。

## B. ε₂ 多峰初始化

- 新增 `peakInitialization.ts`：由前階段 n/k 形成 ε₂=2nk，先在等距能量網格插值，再以二次 Savitzky–Golay 平滑。窗長為約 N/15 的奇數，至少 5；N<5 使用移動平均。端點以平移後的完整視窗作二次擬合。
- prominence≥0.05×max(smoothed ε₂)、間距≥0.04×能量範圍，依 prominence 降序選取。偵測器預設最多 4；現有 Gaussian/Lorentz/TL/Multi-Oscillator 模板各最多 3，因此種子數再受模板與使用者設定限制。
- 寬度採半 prominence 交點線性插值，夾在資料能量範圍的 1%–30%。Gaussian σ=FWHM/(2√ln2)；Lorentz/TL broadening 採此寬度。振幅以單位振幅模型在峰位置的 ε₂ 反推，所以沿用各模型的實際振幅慣例；Multi-Oscillator 保留各槽位的既有模型型別。
- TL Eg 取首次超過峰高 2% 的能量，再依資料下限／第一峰 0.95 倍與模型 bounds 初始化。若低能邊界外推與 Eg<E0 衝突，以 TL 域為優先，E0 至少 Eg+0.05；因此受域／box bounds 限制的邊界種子可能不保留完整 15% 外推位置，已列入實作決定。
- 上升到邊界時提供外側 15% 範圍的 E0 建議，記錄 edgePeak；單調曲線的內部峰數仍為 0。無峰／平坦時沿用單振子 fallback，不報錯。
- 為保留既有透明樣品行為，`max k<0.035 && max ε₂<0.18` 時仍使用舊透明單振子搜尋，method 明列 `transparent-legacy-fallback`。偵測器輸出仍保留在 metadata，不把這個例外隱藏成新增多峰初始化。
- `dielectricBackground` 是共同的 ε∞ 差值平均函式。新多峰路徑使用長波 15% 的 ε₁ 減去所有振子貢獻；既有透明 fallback 保留其原擬合樣本與單位振幅搜尋。
- Automatic 與 Expert preparePhysical 接入共同種子產生器；手動 mixed model 的既有直接接續分支保留。Expert peak handoff 沿用 Gaussian 模板的 3 槽容量；未增加既有模型的第四個振子參數模板。
- `FittingResult.initialization` 保存 peaksDetected、peaks（energy/height/prominence/width/edgePeak）、oscillatorsUsed、edgePeak、method；Validation Report 與參數 JSON 匯出同欄位。專案 schema/version 未變，欄位可選。

## C. 節點狀態移除（先獨立提交與量測）

- 刪除 bspline.ts 的模組層級 active grid 與 getter/setter。既有 spline 由每層 `_knotCount/_knot0…` 決定；沒有序列化節點的舊資料使用固定 190–900 nm 的純函式 fallback，不依賴先前載入的專案。
- Automatic 每個 knot stage、最佳 spline、連續光譜評估都傳入明確網格；Expert 與舊 JSON 匯入沿用每層網格。`rg 'getActiveKnots|setActiveKnots|globalActiveKnots' src` 無命中。
- 交錯 A/B/A/B 模型呼叫、B 單獨擬合與 A 後 B 擬合，檢查光譜、參數與 MSE 位元一致。
- C-only 固定 benchmark 與基準的膜厚／Raw MSE 相對差異均為 0，門檻維持 1e-9；沒有把其他模型初始化差異混入這個隔離測試。

## D. Expert 可選 KK ε₂ B-spline

- 新 `createKkBsplineModel` 註冊為 `kk_bspline`，Expert Stage 2 按鈕可從當前光學曲線初始化；Stage 2/3 接續時保留該模型。Automatic 候選集合未加入它，明確要求 Automatic 使用 kk_bspline 時會回報請使用 Expert。階段順序不改。
- ε₂ 使用既有 cubic basis，c_j≥0。每層的 `_emin/_emax/_knotCount` 產生控制網格，亦接受逐點 `_energy0…` 覆寫，沒有全域節點。預設由資料範圍初始化，24 個控制位置，首尾係數固定 0，22 個內部係數可擬合；可在 Expert 修改能量範圍與極參數。
- **有限頻帶端點決定：首尾係數固定 0。** 非零端點搭配範圍外直接為 0 會在截點出現 KK log 發散；此實作以連續歸零的邊界條件處理，不以有限的大數代替發散。這限制了頻帶邊緣的形狀自由度。
- 對實驗點 E，積分使用奇異點扣除：`0.5∫[(B(x)−B(E))/(x−E)+B(x)/(x+E)]dx +0.5 B(E)ln|(Emax−E)/(Emin−E)|`，乘 2/π。依實際 cubic knot vector 分段，用 8/16 點 Gauss–Legendre 誤差估計與遞迴細分，每段容差總和≤1e-9；未達容差會報錯。
- 基底 real/imaginary response 只在網格＋能量首次使用時計算。快取在工廠建立的模型實例 closure 內，最多 8192 列；鍵採完整節點／能量 signature 的雜湊，並比對原 signature 避免 collision 誤用。不同實例沒有共用 cache。
- ε₁=ε∞+Σc_j K_j，ε₂=Σc_j B_j；後續係數變動只作線性加總。`coefficientJacobian` 提供 ε₁/ε₂ 對係數的線性基底。既有 LM 的 Ψ/Δ 中央差分沿用相同快取，不為每個係數重新積分，沒有修改 TMM 導數架構。
- 外加 UV Lorentz 極 E0 固定於每次擬合（≥1.5 Emax），振幅非負且可擬合；IR 預設關閉，開啟後振幅可擬合，E0 在低能邊界外。**範圍外為 0 指 spline ε₂ 分量，外加 Lorentz 極另有其尾端貢獻。**
- 初始化使用確定性的非負最小平方座標更新投影 ε₂，再以 ε₁ 差值匹配 ε∞／UV 振幅。正式 Ψ/Δ 擬合仍呼叫原 TMM 與 optimizer。
- 平滑呼叫原 `computeBsplineSmoothness` 二階差分，僅將新係數接到既有正則化介面；沒有新增另一個 MSE/權重定義。所有自由係數進入既有統計，但不逐一列為物理參數。
- 本段未改 Peak Builder 的自由 δε 修正行為。

## E. 高物理參數相關性

- statistics.ts 只加入物理參數配對檢查與警告文字：|r|>0.99 至少 caution；|r|>0.9999 為 severe；樣條係數不觸發此物理參數配對規則。
- κ、共變異、標準誤與 MSE 數值沒有因這項規則改寫；warnings 指出參數 ID 與 r。總等級取原 κ 等級與相關性等級中較高者。
- 70°／600–700 nm／2 nm 案例：原 κ 等級 ok → severe（κ 不跨 1e3，是 |r| 觸發）。既有 75°／630–650 nm 案例原 caution → severe。
- **既有測試期望值修改清單：無。** 原 56 項測試維持原斷言；例如原超薄膜斷言已允許 caution 或 severe，無需放寬或重寫。

## 工程測試與限制

- 新增 9 項測試，合計 65 項；門檻依任務固定，未降低容差。對照表中 analytic 指新程式輸出名稱，不代表對量測結果的判讀。
- TL 對照 3 組參數，每組指定能量點另含 Eg 與 Eg+1e-10；相對門檻 1e-4，近 Eg 絕對門檻 1e-3。
- 峰偵測使用固定種子，2/3 個 Gaussian 峰、ε₂ 雜訊標準差 0 或 0.025，檢查數目與 E0/FWHM；初始化重複執行深度相等。Automatic benchmark 三次最終參數／MSE／初始化亦為位元一致。
- KK 對照為 22 個能量點、固定種子的非負內部係數；數值 KK 以既有 kkReal 獨立重算。Jacobian 檢查為直接相對差（不設分母下限），門檻 1e-7。
- TL→spline 投影在 0.5–6.5 eV 的 ε₂ 作非負最小平方，ε₁ 在 1–5.5 eV 的偏差表只記錄，不設定事後通過門檻。
- 合成 Ψ/Δ 案例：TL 真值 100 nm、A=100、E0=3.5、C=1.5、Eg=1.5、ε∞=1.8；65/70/75°，1–5.5 eV，每角 37 點；σΨ=σΔ=雜訊標準差=0.03°，種子 20261019。KK 支撐範圍明確設定 0.5–6.5 eV，從真值光譜投影後的係數初始化、厚度初值 97 nm，再以 Ψ/Δ 聯立擬合。這是已知初值條件下的工程恢復案例，不代表從未知實驗資料完成整套反演。
- 此案例關閉 smoothing 以單獨測試資料殘差；預設 Expert smoothing 仍保留原設定。UV/IR 有有限值與啟用檢查，但沒有另作 IR 專屬恢復實驗。
- 本次沒有真機 UI／手機端互動或公開 Cloudflare 網址測試；UI 已完成 production 編譯。未建立壓縮檔。
- 有限帶寬、端點歸零及單一 UV/IR 極會留下截斷／近似偏差，實際偏差與 MSE_W 均照錄。極端參數域、跨設備效能及任意樣品未作全面測試。
- 未新增套件。TMM、Δ 慣例、optimizer、residual/MSE、Worker 檔案、階段順序、wrangler.jsonc、.node-version 與部署設定未改；statistics.ts 的例外只有 E 節。

## 前後 Automatic 耗時（毫秒）
- before: 三次 `[6095.8102, 5739.434899999999, 6131.783900000002]`，中位 6095.810200 ms；膜厚 99.99715991446588 nm；Raw MSE 0.009153357823814337。
- C-only: 三次 `[6922.5717, 6640.8768, 6918.534]`，中位 6918.534000 ms；膜厚 99.99715991446588 nm；Raw MSE 0.009153357823814337。
- after: 三次 `[6916.6108, 6627.6074, 6584.991599999999]`，中位 6627.607400 ms；膜厚 99.99715991446588 nm；Raw MSE 0.009153357823814337。

完整變更後中位相對變化：8.7240%。壁鐘時間受本機 CPU/背景工作影響，三次量測不構成跨設備效能保證。

## A：TL 實際誤差表

|A|E0|C|Eg|E|analytic|numeric|absolute|relative|
|---|---|---|---|---|---|---|---|---|
|100|3.5|1.5|1.5|0.5|7.32315238912|7.32315238912|2.48689957516e-14|3.39594131464e-15|
|100|3.5|1.5|1.5|1|7.82438958941|7.82438958819|1.21449961199e-09|1.5521972651e-10|
|100|3.5|1.5|1.5|2|11.397421654|11.397421654|1.10844666779e-12|9.72541598825e-14|
|100|3.5|1.5|1.5|3|16.0141151805|16.0141151805|7.78754838393e-12|4.8629276711e-13|
|100|3.5|1.5|1.5|3.5|5.78102292119|5.78102292119|4.3778314307e-12|7.57276262416e-13|
|100|3.5|1.5|1.5|4.5|-7.07761260739|-7.0776126074|3.64952512655e-12|5.15643526849e-13|
|100|3.5|1.5|1.5|6|-4.35164162303|-4.35164162303|2.93365332027e-12|6.74148648809e-13|
|100|3.5|1.5|1.5|1.5|8.94678291161|8.94678290809|3.51983509006e-09|3.93419078815e-10|
|100|3.5|1.5|1.5|1.5000000001|8.94678291161|8.94678290845|3.1673863532e-09|3.54025171462e-10|
|20|3|0.4|1|0.5|2.82063225112|2.82063225112|4.57411886146e-14|1.6216643838e-14|
|20|3|0.4|1|1|3.10941584316|3.10941584227|8.93577656313e-10|2.87377984047e-10|
|20|3|0.4|1|2|5.12632831456|5.12632831456|9.1837648597e-13|1.79148979468e-13|
|20|3|0.4|1|3|1.39907528777|1.39907528778|1.25661703265e-11|8.98176848398e-12|
|20|3|0.4|1|3.5|-6.79812366453|-6.79812366455|1.96607174985e-11|2.89208000158e-12|
|20|3|0.4|1|4.5|-2.33695940175|-2.33695940175|5.12478948167e-13|2.19293047103e-13|
|20|3|0.4|1|6|-1.00585607257|-1.00585607257|3.22630810956e-13|3.20752461265e-13|
|20|3|0.4|1|1|3.10941584316|3.10941584227|8.93577656313e-10|2.87377984047e-10|
|20|3|0.4|1|1.0000000001|3.10941584316|3.10941584235|8.04146083055e-10|2.5861644882e-10|
|60|4|2.5|2|0.5|2.63816955691|2.63816955691|2.77067258025e-12|1.05022536288e-12|
|60|4|2.5|2|1|2.75537436839|2.75537436839|1.46549439251e-14|5.31867614549e-15|
|60|4|2.5|2|2|3.45538191993|3.45538191845|1.47542200679e-09|4.26992454557e-10|
|60|4|2.5|2|3|5.2805629414|5.2805629414|1.74082970261e-13|3.2966744681e-14|
|60|4|2.5|2|3.5|4.98690288581|4.9869028858|2.68851607643e-12|5.39115386443e-13|
|60|4|2.5|2|4.5|0.322129059751|0.322129059756|5.16009457385e-12|1.60187180187e-11|
|60|4|2.5|2|6|-1.63532029815|-1.63532029815|9.54125667363e-13|5.83448801094e-13|
|60|4|2.5|2|2|3.45538191993|3.45538191845|1.47542200679e-09|4.26992454557e-10|
|60|4|2.5|2|2.0000000001|3.45538191993|3.4553819186|1.32747279835e-09|3.8417541957e-10|

## PEAK_DETECTION 實際輸出

```json
{
  "results": [
    {
      "centers": [
        2,
        4
      ],
      "noise": 0,
      "peaksDetected": 2,
      "peaks": [
        {
          "energy": 3.995,
          "height": 2.4424892628013093,
          "prominence": 2.4424892628013093,
          "width": 0.379056655830587,
          "edgePeak": false
        },
        {
          "energy": 2,
          "height": 1.9549210619870439,
          "prominence": 1.9549210619870439,
          "width": 0.37896748898432353,
          "edgePeak": false
        }
      ],
      "oscillatorsUsed": 2,
      "edgePeak": false,
      "method": "epsilon2-Savitzky-Golay"
    },
    {
      "centers": [
        2,
        4
      ],
      "noise": 0.025,
      "peaksDetected": 2,
      "peaks": [
        {
          "energy": 3.995,
          "height": 2.4525590931675167,
          "prominence": 2.4491739209713845,
          "width": 0.37981190038924106,
          "edgePeak": false
        },
        {
          "energy": 2,
          "height": 1.9605069765920207,
          "prominence": 1.956707409745779,
          "width": 0.3765021626077647,
          "edgePeak": false
        }
      ],
      "oscillatorsUsed": 2,
      "edgePeak": false,
      "method": "epsilon2-Savitzky-Golay"
    },
    {
      "centers": [
        1.5,
        3,
        5
      ],
      "noise": 0,
      "peaksDetected": 3,
      "peaks": [
        {
          "energy": 5,
          "height": 2.932381592980565,
          "prominence": 2.932381592980565,
          "width": 0.3789674889843244,
          "edgePeak": false
        },
        {
          "energy": 3.005,
          "height": 2.4424892628013084,
          "prominence": 2.4424892628013084,
          "width": 0.3790566558305013,
          "edgePeak": false
        },
        {
          "energy": 1.505,
          "height": 1.9539914102410476,
          "prominence": 1.9539914102410476,
          "width": 0.3790566558304438,
          "edgePeak": false
        }
      ],
      "oscillatorsUsed": 3,
      "edgePeak": false,
      "method": "epsilon2-Savitzky-Golay"
    },
    {
      "centers": [
        1.5,
        3,
        5
      ],
      "noise": 0.025,
      "peaksDetected": 3,
      "peaks": [
        {
          "energy": 5,
          "height": 2.9268120457661624,
          "prominence": 2.9241655739235446,
          "width": 0.37977792817489053,
          "edgePeak": false
        },
        {
          "energy": 3.005,
          "height": 2.4600669766653596,
          "prominence": 2.455177992771073,
          "width": 0.3757027624745328,
          "edgePeak": false
        },
        {
          "energy": 1.505,
          "height": 1.952910177851582,
          "prominence": 1.9495320738049535,
          "width": 0.37936498981701616,
          "edgePeak": false
        }
      ],
      "oscillatorsUsed": 3,
      "edgePeak": false,
      "method": "epsilon2-Savitzky-Golay"
    }
  ],
  "edge": {
    "peaksDetected": 0,
    "peaks": [],
    "oscillatorsUsed": 1,
    "edgePeak": true,
    "method": "epsilon2-Savitzky-Golay"
  }
}
```

## MODEL_INITIALIZATION 實際輸出

```json
{
  "table": [
    {
      "modelId": "gaussian",
      "initialization": {
        "peaksDetected": 2,
        "peaks": [
          {
            "energy": 3.994999999999999,
            "height": 2.955616321461338,
            "prominence": 2.955616321461338,
            "width": 0.42556990442681286,
            "edgePeak": false
          },
          {
            "energy": 1.9999999999999998,
            "height": 1.9549210619870427,
            "prominence": 1.9549210619870427,
            "width": 0.37896748898432375,
            "edgePeak": false
          }
        ],
        "oscillatorsUsed": 2,
        "edgePeak": false,
        "method": "epsilon2-Savitzky-Golay"
      },
      "parameters": {
        "eps_inf": 2.4195030440167784,
        "A": 2.955616321461338,
        "E0": 3.994999999999999,
        "sigma": 0.25558077435607635,
        "A2": 1.9549210619870427,
        "E02": 1.9999999999999998,
        "sigma2": 0.22759317161030168,
        "A3": 0,
        "E03": 5.8,
        "sigma3": 0.7
      }
    },
    {
      "modelId": "lorentz",
      "initialization": {
        "peaksDetected": 2,
        "peaks": [
          {
            "energy": 3.994999999999999,
            "height": 2.955616321461338,
            "prominence": 2.955616321461338,
            "width": 0.42556990442681286,
            "edgePeak": false
          },
          {
            "energy": 1.9999999999999998,
            "height": 1.9549210619870427,
            "prominence": 1.9549210619870427,
            "width": 0.37896748898432375,
            "edgePeak": false
          }
        ],
        "oscillatorsUsed": 2,
        "edgePeak": false,
        "method": "epsilon2-Savitzky-Golay"
      },
      "parameters": {
        "eps_inf": 2.1712217387157833,
        "A": 1.2578213554466298,
        "E0": 3.994999999999999,
        "gamma": 0.42556990442681286,
        "A2": 0.7408515260237972,
        "E02": 1.9999999999999998,
        "gamma2": 0.37896748898432375,
        "A3": 0,
        "E03": 5.8,
        "gamma3": 0.6
      }
    },
    {
      "modelId": "tauc_lorentz",
      "initialization": {
        "peaksDetected": 2,
        "peaks": [
          {
            "energy": 3.994999999999999,
            "height": 2.955616321461338,
            "prominence": 2.955616321461338,
            "width": 0.42556990442681286,
            "edgePeak": false
          },
          {
            "energy": 1.9999999999999998,
            "height": 1.9549210619870427,
            "prominence": 1.9549210619870427,
            "width": 0.37896748898432375,
            "edgePeak": false
          }
        ],
        "oscillatorsUsed": 2,
        "edgePeak": false,
        "method": "epsilon2-Savitzky-Golay"
      },
      "parameters": {
        "eps_inf": 2.162550244185431,
        "A": 3.485218798344114,
        "E0": 3.994999999999999,
        "C": 0.42556990442681286,
        "Eg": 1.595,
        "A2": 18.06679533056054,
        "E02": 1.9999999999999998,
        "C2": 0.37896748898432375,
        "A3": 0,
        "E03": 5.8,
        "C3": 2
      }
    },
    {
      "modelId": "multi_oscillator",
      "initialization": {
        "peaksDetected": 2,
        "peaks": [
          {
            "energy": 3.994999999999999,
            "height": 2.955616321461338,
            "prominence": 2.955616321461338,
            "width": 0.42556990442681286,
            "edgePeak": false
          },
          {
            "energy": 1.9999999999999998,
            "height": 1.9549210619870427,
            "prominence": 1.9549210619870427,
            "width": 0.37896748898432375,
            "edgePeak": false
          }
        ],
        "oscillatorsUsed": 2,
        "edgePeak": false,
        "method": "epsilon2-Savitzky-Golay"
      },
      "parameters": {
        "eps_inf": 1.4195030440167782,
        "A1": 2.955616321461338,
        "E01": 3.994999999999999,
        "w1": 0.25558077435607635,
        "Eg1": 2.5,
        "A2": 1.9549210619870427,
        "E02": 1.9999999999999998,
        "w2": 0.22759317161030168,
        "A3": 0,
        "E03": 2.4,
        "w3": 0.7
      }
    }
  ],
  "edgeSeed": 7.399999999999999,
  "edge": {
    "peaksDetected": 0,
    "peaks": [
      {
        "energy": 7.399999999999999,
        "height": 4.500000000000001,
        "prominence": 0,
        "width": 0.8999999999999998,
        "edgePeak": true
      }
    ],
    "oscillatorsUsed": 1,
    "edgePeak": true,
    "method": "epsilon2-Savitzky-Golay"
  }
}
```

## C_ISOLATION 實際輸出

```json
{
  "thicknessRelative": 0,
  "mseRelative": 0,
  "interleaved": "bit-identical",
  "sequential": "bit-identical"
}
```

## D：KK 基底對照

|E|analyticBasis|numeric|relative|
|---|---|---|---|
|0.6|1.7456367719|1.7456367719|2.10897227242e-13|
|0.87619047619|1.22514737237|1.22514737237|8.5689845627e-13|
|1.15238095238|1.19269005291|1.19269005291|1.68782860504e-12|
|1.42857142857|0.693163955487|0.693163955491|5.78316607963e-12|
|1.70476190476|0.338160541269|0.338160541263|1.83935386461e-11|
|1.98095238095|0.110803797488|0.110803797499|9.39882299032e-11|
|2.25714285714|0.492024083249|0.492024083235|2.74420385251e-11|
|2.53333333333|0.567008725947|0.567008725963|2.86775788386e-11|
|2.80952380952|0.761267079902|0.761267079882|2.62399061724e-11|
|3.08571428571|0.692233167084|0.692233167112|4.05232837817e-11|
|3.3619047619|0.980526432543|0.98052643253|1.35752668055e-11|
|3.6380952381|0.57774982555|0.577749825564|2.3106673804e-11|
|3.91428571429|0.527719212436|0.527719212405|5.83846231301e-11|
|4.19047619048|0.209977156429|0.209977156457|1.31747051254e-10|
|4.46666666667|-0.268645161083|-0.268645161066|6.45496904946e-11|
|4.74285714286|-0.335628138689|-0.335628138719|8.97157667468e-11|
|5.01904761905|-0.771735851433|-0.771735851387|5.9546017256e-11|
|5.29523809524|-0.602173060127|-0.602173060173|7.64146748393e-11|
|5.57142857143|-0.500626937334|-0.50062693731|4.76161585645e-11|
|5.84761904762|-0.256908293126|-0.256908293087|1.52881288854e-10|
|6.12380952381|-0.154021937808|-0.154021937842|2.24569911958e-10|
|6.4|-1.25893625919|-1.25893625922|2.73269791868e-11|

Jacobian 最大相對差：`3.7427379979159517e-10`。快取計數：`{"entries": 31, "integrations": 31}`；相同網格與能量只改係數不增加 integrations，新模型實例 cache entries=0。

## D：TL 投影 ε₁ 偏差

|E|truth|fit|deviation|
|---|---|---|---|
|1|9.62438958941|9.51632562491|-0.1080639645|
|1.25|10.0698330689|9.97054275853|-0.0992903103529|
|1.5|10.7467829116|10.6639545136|-0.0828283979774|
|1.75|11.8357965797|11.7294146603|-0.106381919374|
|2|13.197421654|13.1294571803|-0.0679644736712|
|2.25|14.775670829|14.7070930655|-0.0685777635697|
|2.5|16.4608936009|16.4147647314|-0.0461288695417|
|2.75|17.846540977|17.8107609325|-0.0357800445264|
|3|17.8141151805|17.7939971783|-0.020118002148|
|3.25|14.4946135348|14.512172877|0.0175593421948|
|3.5|7.58102292119|7.60646478781|0.0254418666206|
|3.75|0.608066178949|0.650796746797|0.0427305678474|
|4|-3.48640686181|-3.40077961923|0.0856272425838|
|4.25|-5.04388353816|-4.94307566834|0.10080786982|
|4.5|-5.27761260739|-5.13625923179|0.141353375607|
|4.75|-4.96332570995|-4.81511942161|0.148206288339|
|5|-4.46388635764|-4.24718484182|0.216701515822|
|5.25|-3.93125121546|-3.76285342774|0.168397787729|
|5.5|-3.42445620496|-3.10999876879|0.31445743617|

最大絕對偏差：`0.3144574361700867`。

## KK_SYNTHETIC_FIT 實際輸出

```json
{
  "thickness": 100.06905571093064,
  "error": 0.06905571093064111,
  "converged": true,
  "status": "cost",
  "mseWoollam": 2.6998665687437247
}
```

## CORRELATION_LEVEL 實際輸出

```json
{
  "r": -0.9999882030599727,
  "kappa": 411.74566096125557,
  "previousLevel": "ok",
  "level": "severe",
  "warnings": [
    "物理參數高度相關：d ↔ A，r=-0.99998820 (severe)。",
    "統計警告等級：severe（綜合欄正規化條件數與物理參數相關性）。"
  ]
}
```

## 命令原始輸出

verify 腳本原本只列各子程序最後 2500 字；下面另附完整 scientific 子程序 log（stage4-scientific.log），不以截短的 CLI 顯示取代誤差表。

### pnpm run verify

```text
$ node scripts/check.mjs
typecheck: 0

build: 0
vite v8.3.4 building client environment for production...
transforming...
[33m[INEFFECTIVE_DYNAMIC_IMPORT] [0msrc/data/defaultProjects.ts is dynamically imported by src/tests/unitTests.ts but also statically imported by src/tests/unitTests.ts, dynamic import will not move module into another chunk.

✓ 1709 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/defaultProjects-Bri-LMoA.js       0.06 kB
dist/version.json                             0.15 kB │ gzip:   0.13 kB
dist/index.html                               1.05 kB │ gzip:   0.49 kB
dist/assets/transferMatrix-Bdb_DGJd.js        3.55 kB
dist/assets/unitTests-HCK5cTJd.js            27.45 kB
dist/assets/calculator-QnO140Jr.js           51.39 kB
dist/assets/compute.worker-DDKUHr8l.js       72.70 kB
dist/assets/index-B1-qT0Qf.css               56.96 kB │ gzip:  10.26 kB
dist/assets/ExpertFittingPanel-uB5U38tM.js   26.11 kB │ gzip:   7.49 kB
dist/assets/index-Hu6BDOpx.js               457.05 kB │ gzip: 130.39 kB

✓ built in 4.78s

worker-tests: 0
{
  "total": 8,
  "passed": 8,
  "failures": []
}

original-tests: 0
{
  "total": 29,
  "passed": 29,
  "failures": []
}

scientific-tests: 0
s":-1.2589362591858024,"numeric":-1.2589362592202054,"relative":2.732697918684065e-11}],"maximumJacobianError":3.7427379979159517e-10,"cache":{"entries":31,"integrations":31}}
STAGE4_TL_SPLINE_PROJECTION {"table":[{"E":1,"truth":9.624389589405284,"fit":9.516325624905237,"deviation":-0.1080639645000474},{"E":1.25,"truth":10.06983306888517,"fit":9.97054275853232,"deviation":-0.09929031035285085},{"E":1.5,"truth":10.746782911613915,"fit":10.663954513636526,"deviation":-0.08282839797738895},{"E":1.75,"truth":11.835796579651332,"fit":11.729414660277635,"deviation":-0.10638191937369612},{"E":2,"truth":13.197421653993201,"fit":13.129457180322023,"deviation":-0.06796447367117864},{"E":2.25,"truth":14.7756708290359,"fit":14.707093065466218,"deviation":-0.0685777635696816},{"E":2.5,"truth":16.460893600942995,"fit":16.41476473140129,"deviation":-0.04612886954170392},{"E":2.75,"truth":17.846540977001908,"fit":17.81076093247555,"deviation":-0.03578004452635852},{"E":3,"truth":17.814115180487402,"fit":17.79399717833943,"deviation":-0.02011800214797077},{"E":3.25,"truth":14.494613534795583,"fit":14.512172876990343,"deviation":0.017559342194759964},{"E":3.5,"truth":7.581022921186867,"fit":7.606464787807497,"deviation":0.025441866620630194},{"E":3.75,"truth":0.6080661789491579,"fit":0.6507967467965534,"deviation":0.042730567847395484},{"E":4,"truth":-3.486406861813161,"fit":-3.40077961922933,"deviation":0.08562724258383092},{"E":4.25,"truth":-5.04388353815786,"fit":-4.94307566833783,"deviation":0.10080786982002987},{"E":4.5,"truth":-5.277612607394961,"fit":-5.136259231787584,"deviation":0.1413533756073777},{"E":4.75,"truth":-4.963325709946118,"fit":-4.815119421606822,"deviation":0.1482062883392965},{"E":5,"truth":-4.463886357638243,"fit":-4.247184841815927,"deviation":0.216701515822316},{"E":5.25,"truth":-3.9312512154642922,"fit":-3.762853427735132,"deviation":0.16839778772916025},{"E":5.5,"truth":-3.424456204957724,"fit":-3.109998768787637,"deviation":0.3144574361700867}],"maxDeviation":0.3144574361700867,"uvAmplitude":15.964982545063206,"epsilonInf":0.43848948295625917}
STAGE4_KK_SYNTHETIC_FIT {"thickness":100.06905571093064,"error":0.06905571093064111,"converged":true,"status":"cost","mseWoollam":2.6998665687437247}
STAGE4_CORRELATION_LEVEL {"r":-0.9999882030599727,"kappa":411.74566096125557,"previousLevel":"ok","level":"severe","warnings":["物理參數高度相關：d ↔ A，r=-0.99998820 (severe)。","統計警告等級：severe（綜合欄正規化條件數與物理參數相關性）。"]}
{
  "total": 65,
  "passed": 65,
  "failures": []
}


```

### pnpm run build

```text
$ vite build
vite v8.3.4 building client environment for production...
transforming...
[INEFFECTIVE_DYNAMIC_IMPORT] src/data/defaultProjects.ts is dynamically imported by src/tests/unitTests.ts but also statically imported by src/tests/unitTests.ts, dynamic import will not move module into another chunk.

✓ 1709 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/defaultProjects-GcncHVbB.js       0.06 kB
dist/version.json                             0.15 kB │ gzip:   0.13 kB
dist/index.html                               1.05 kB │ gzip:   0.49 kB
dist/assets/transferMatrix-Bdb_DGJd.js        3.55 kB
dist/assets/unitTests-RSYKymQi.js            27.45 kB
dist/assets/calculator-QnO140Jr.js           51.39 kB
dist/assets/compute.worker-B8GJWO0s.js       72.70 kB
dist/assets/index-B1-qT0Qf.css               56.96 kB │ gzip:  10.26 kB
dist/assets/ExpertFittingPanel-PBuFBdeD.js   26.11 kB │ gzip:   7.49 kB
dist/assets/index-EZlOelwh.js               457.05 kB │ gzip: 130.39 kB

✓ built in 2.48s

```

### scientific 子程序完整 stdout/stderr

```text
STAGE3_MONTE_CARLO {"seed":"0x12345678","runs":100,"sampleSd":0.00047851632932011725,"meanStdError":0.0005003205241958783,"ratio":0.9564195474275116,"coverage":0.96,"converged":1}
STAGE3_ULTRATHIN {"r":-0.9999993522743537,"conditionNumber":1757.1926617893112,"conditionLevel":"severe"}
STAGE3_AUTOMATIC {"thickness":99.99715991446588,"rawMse":0.009153357823814337,"converged":true,"reason":"cost","statisticsMs":20.259500000000116}
STAGE4_TL_ERROR_TABLE [{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":0.5,"analytic":7.32315238912251,"numeric":7.323152389122485,"absolute":2.4868995751603507e-14,"relative":3.395941314636974e-15},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":1,"analytic":7.824389589405284,"numeric":7.824389588190784,"absolute":1.2144996119900497e-9,"relative":1.5521972651043257e-10},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":2,"analytic":11.3974216539932,"numeric":11.397421653994309,"absolute":1.1084466677857563e-12,"relative":9.725415988249352e-14},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":3,"analytic":16.0141151804874,"numeric":16.014115180479614,"absolute":7.787548383930698e-12,"relative":4.862927671098133e-13},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":3.5,"analytic":5.781022921186867,"numeric":5.781022921191245,"absolute":4.377831430701917e-12,"relative":7.572762624161704e-13},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":4.5,"analytic":-7.077612607394961,"numeric":-7.077612607398611,"absolute":3.6495251265478146e-12,"relative":5.15643526848696e-13},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":6,"analytic":-4.35164162303161,"numeric":-4.351641623034544,"absolute":2.9336533202695136e-12,"relative":6.741486488089476e-13},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":1.5,"analytic":8.946782911613914,"numeric":8.946782908094079,"absolute":3.5198350900600417e-9,"relative":3.9341907881498685e-10},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":1.5000000001,"analytic":8.946782911613914,"numeric":8.946782908446528,"absolute":3.1673863531977986e-9,"relative":3.5402517146219286e-10},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":0.5,"analytic":2.820632251124173,"numeric":2.820632251124127,"absolute":4.574118861455645e-14,"relative":1.621664383803556e-14},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":1,"analytic":3.109415843158698,"numeric":3.10941584226512,"absolute":8.935776563134823e-10,"relative":2.8737798404684807e-10},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":2,"analytic":5.12632831456187,"numeric":5.126328314562788,"absolute":9.183764859699295e-13,"relative":1.791489794676281e-13},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":3,"analytic":1.3990752877701986,"numeric":1.3990752877827648,"absolute":1.2566170326522297e-11,"relative":8.981768483979865e-12},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":3.5,"analytic":-6.798123664528373,"numeric":-6.798123664548034,"absolute":1.9660717498481972e-11,"relative":2.8920800015763016e-12},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":4.5,"analytic":-2.3369594017541413,"numeric":-2.3369594017546538,"absolute":5.124789481669723e-13,"relative":2.192930471030814e-13},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":6,"analytic":-1.0058560725709405,"numeric":-1.005856072571263,"absolute":3.226308109560705e-13,"relative":3.2075246126548855e-13},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":1,"analytic":3.109415843158698,"numeric":3.10941584226512,"absolute":8.935776563134823e-10,"relative":2.8737798404684807e-10},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":1.0000000001,"analytic":3.109415843158698,"numeric":3.1094158423545517,"absolute":8.04146083055457e-10,"relative":2.5861644882034536e-10},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":0.5,"analytic":2.6381695569108614,"numeric":2.6381695569080907,"absolute":2.7706725802545407e-12,"relative":1.0502253628844623e-12},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":1,"analytic":2.7553743683909433,"numeric":2.7553743683909286,"absolute":1.4654943925052066e-14,"relative":5.3186761454887875e-15},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":2,"analytic":3.4553819199250904,"numeric":3.4553819184496684,"absolute":1.4754220067914048e-9,"relative":4.2699245455720414e-10},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":3,"analytic":5.280562941402943,"numeric":5.280562941402769,"absolute":1.7408297026122455e-13,"relative":3.2966744681009297e-14},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":3.5,"analytic":4.986902885805945,"numeric":4.986902885803256,"absolute":2.688516076432279e-12,"relative":5.391153864427483e-13},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":4.5,"analytic":0.32212905975112793,"numeric":0.322129059756288,"absolute":5.1600945738528026e-12,"relative":1.6018718018662322e-11},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":6,"analytic":-1.6353202981525552,"numeric":-1.6353202981535093,"absolute":9.541256673628595e-13,"relative":5.83448801094313e-13},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":2,"analytic":3.4553819199250904,"numeric":3.4553819184496684,"absolute":1.4754220067914048e-9,"relative":4.2699245455720414e-10},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":2.0000000001,"analytic":3.4553819199250904,"numeric":3.4553819185976176,"absolute":1.3274727983514367e-9,"relative":3.841754195698858e-10}]
STAGE4_PEAK_DETECTION {"results":[{"centers":[2,4],"noise":0,"peaksDetected":2,"peaks":[{"energy":3.995,"height":2.4424892628013093,"prominence":2.4424892628013093,"width":0.379056655830587,"edgePeak":false},{"energy":2,"height":1.9549210619870439,"prominence":1.9549210619870439,"width":0.37896748898432353,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},{"centers":[2,4],"noise":0.025,"peaksDetected":2,"peaks":[{"energy":3.995,"height":2.4525590931675167,"prominence":2.4491739209713845,"width":0.37981190038924106,"edgePeak":false},{"energy":2,"height":1.9605069765920207,"prominence":1.956707409745779,"width":0.3765021626077647,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},{"centers":[1.5,3,5],"noise":0,"peaksDetected":3,"peaks":[{"energy":5,"height":2.932381592980565,"prominence":2.932381592980565,"width":0.3789674889843244,"edgePeak":false},{"energy":3.005,"height":2.4424892628013084,"prominence":2.4424892628013084,"width":0.3790566558305013,"edgePeak":false},{"energy":1.505,"height":1.9539914102410476,"prominence":1.9539914102410476,"width":0.3790566558304438,"edgePeak":false}],"oscillatorsUsed":3,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},{"centers":[1.5,3,5],"noise":0.025,"peaksDetected":3,"peaks":[{"energy":5,"height":2.9268120457661624,"prominence":2.9241655739235446,"width":0.37977792817489053,"edgePeak":false},{"energy":3.005,"height":2.4600669766653596,"prominence":2.455177992771073,"width":0.3757027624745328,"edgePeak":false},{"energy":1.505,"height":1.952910177851582,"prominence":1.9495320738049535,"width":0.37936498981701616,"edgePeak":false}],"oscillatorsUsed":3,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"}],"edge":{"peaksDetected":0,"peaks":[],"oscillatorsUsed":1,"edgePeak":true,"method":"epsilon2-Savitzky-Golay"}}
STAGE4_MODEL_INITIALIZATION {"table":[{"modelId":"gaussian","initialization":{"peaksDetected":2,"peaks":[{"energy":3.994999999999999,"height":2.955616321461338,"prominence":2.955616321461338,"width":0.42556990442681286,"edgePeak":false},{"energy":1.9999999999999998,"height":1.9549210619870427,"prominence":1.9549210619870427,"width":0.37896748898432375,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},"parameters":{"eps_inf":2.4195030440167784,"A":2.955616321461338,"E0":3.994999999999999,"sigma":0.25558077435607635,"A2":1.9549210619870427,"E02":1.9999999999999998,"sigma2":0.22759317161030168,"A3":0,"E03":5.8,"sigma3":0.7}},{"modelId":"lorentz","initialization":{"peaksDetected":2,"peaks":[{"energy":3.994999999999999,"height":2.955616321461338,"prominence":2.955616321461338,"width":0.42556990442681286,"edgePeak":false},{"energy":1.9999999999999998,"height":1.9549210619870427,"prominence":1.9549210619870427,"width":0.37896748898432375,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},"parameters":{"eps_inf":2.1712217387157833,"A":1.2578213554466298,"E0":3.994999999999999,"gamma":0.42556990442681286,"A2":0.7408515260237972,"E02":1.9999999999999998,"gamma2":0.37896748898432375,"A3":0,"E03":5.8,"gamma3":0.6}},{"modelId":"tauc_lorentz","initialization":{"peaksDetected":2,"peaks":[{"energy":3.994999999999999,"height":2.955616321461338,"prominence":2.955616321461338,"width":0.42556990442681286,"edgePeak":false},{"energy":1.9999999999999998,"height":1.9549210619870427,"prominence":1.9549210619870427,"width":0.37896748898432375,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},"parameters":{"eps_inf":2.162550244185431,"A":3.485218798344114,"E0":3.994999999999999,"C":0.42556990442681286,"Eg":1.595,"A2":18.06679533056054,"E02":1.9999999999999998,"C2":0.37896748898432375,"A3":0,"E03":5.8,"C3":2}},{"modelId":"multi_oscillator","initialization":{"peaksDetected":2,"peaks":[{"energy":3.994999999999999,"height":2.955616321461338,"prominence":2.955616321461338,"width":0.42556990442681286,"edgePeak":false},{"energy":1.9999999999999998,"height":1.9549210619870427,"prominence":1.9549210619870427,"width":0.37896748898432375,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},"parameters":{"eps_inf":1.4195030440167782,"A1":2.955616321461338,"E01":3.994999999999999,"w1":0.25558077435607635,"Eg1":2.5,"A2":1.9549210619870427,"E02":1.9999999999999998,"w2":0.22759317161030168,"A3":0,"E03":2.4,"w3":0.7}}],"edgeSeed":7.399999999999999,"edge":{"peaksDetected":0,"peaks":[{"energy":7.399999999999999,"height":4.500000000000001,"prominence":0,"width":0.8999999999999998,"edgePeak":true}],"oscillatorsUsed":1,"edgePeak":true,"method":"epsilon2-Savitzky-Golay"}}
STAGE4_C_ISOLATION {"thicknessRelative":0,"mseRelative":0,"interleaved":"bit-identical","sequential":"bit-identical"}
STAGE4_KK_BASIS {"table":[{"E":0.6,"analyticBasis":1.7456367719011299,"numeric":1.745636771901498,"relative":2.108972272420002e-13},{"E":0.8761904761904762,"analyticBasis":1.2251473723673278,"numeric":1.2251473723683777,"relative":8.56898456269868e-13},{"E":1.1523809523809523,"analyticBasis":1.1926900529145112,"numeric":1.1926900529124982,"relative":1.6878286050382797e-12},{"E":1.4285714285714284,"analyticBasis":0.6931639554865665,"numeric":0.6931639554905752,"relative":5.7831660796282674e-12},{"E":1.704761904761905,"analyticBasis":0.33816054126925366,"numeric":0.3381605412630337,"relative":1.8393538646110364e-11},{"E":1.980952380952381,"analyticBasis":0.1108037974884577,"numeric":0.11080379749887195,"relative":9.398822990315828e-11},{"E":2.257142857142857,"analyticBasis":0.49202408324892,"numeric":0.49202408323541785,"relative":2.7442038525118675e-11},{"E":2.533333333333333,"analyticBasis":0.5670087259465584,"numeric":0.5670087259628188,"relative":2.8677578838581703e-11},{"E":2.8095238095238098,"analyticBasis":0.7612670799022827,"numeric":0.7612670798823071,"relative":2.623990617242232e-11},{"E":3.0857142857142854,"analyticBasis":0.6922331670841824,"numeric":0.6922331671122339,"relative":4.052328378169995e-11},{"E":3.361904761904762,"analyticBasis":0.9805264325433902,"numeric":0.9805264325300793,"relative":1.357526680549993e-11},{"E":3.638095238095238,"analyticBasis":0.5777498255503466,"numeric":0.5777498255636965,"relative":2.310667380397743e-11},{"E":3.914285714285714,"analyticBasis":0.5277192124357897,"numeric":0.527719212404979,"relative":5.838462313012753e-11},{"E":4.19047619047619,"analyticBasis":0.2099771564289541,"numeric":0.20997715645661796,"relative":1.3174705125369355e-10},{"E":4.466666666666667,"analyticBasis":-0.2686451610833289,"numeric":-0.26864516106598796,"relative":6.454969049459051e-11},{"E":4.742857142857143,"analyticBasis":-0.3356281386887836,"numeric":-0.33562813871889474,"relative":8.971576674682715e-11},{"E":5.019047619047619,"analyticBasis":-0.7717358514333417,"numeric":-0.7717358513873879,"relative":5.954601725598046e-11},{"E":5.295238095238094,"analyticBasis":-0.6021730601271662,"numeric":-0.6021730601731811,"relative":7.641467483931111e-11},{"E":5.57142857142857,"analyticBasis":-0.5006269373338972,"numeric":-0.5006269373100593,"relative":4.761615856453664e-11},{"E":5.847619047619047,"analyticBasis":-0.25690829312621544,"numeric":-0.25690829308693897,"relative":1.5288128885421105e-10},{"E":6.123809523809523,"analyticBasis":-0.15402193780775675,"numeric":-0.15402193784234544,"relative":2.245699119580579e-10},{"E":6.3999999999999995,"analyticBasis":-1.2589362591858024,"numeric":-1.2589362592202054,"relative":2.732697918684065e-11}],"maximumJacobianError":3.7427379979159517e-10,"cache":{"entries":31,"integrations":31}}
STAGE4_TL_SPLINE_PROJECTION {"table":[{"E":1,"truth":9.624389589405284,"fit":9.516325624905237,"deviation":-0.1080639645000474},{"E":1.25,"truth":10.06983306888517,"fit":9.97054275853232,"deviation":-0.09929031035285085},{"E":1.5,"truth":10.746782911613915,"fit":10.663954513636526,"deviation":-0.08282839797738895},{"E":1.75,"truth":11.835796579651332,"fit":11.729414660277635,"deviation":-0.10638191937369612},{"E":2,"truth":13.197421653993201,"fit":13.129457180322023,"deviation":-0.06796447367117864},{"E":2.25,"truth":14.7756708290359,"fit":14.707093065466218,"deviation":-0.0685777635696816},{"E":2.5,"truth":16.460893600942995,"fit":16.41476473140129,"deviation":-0.04612886954170392},{"E":2.75,"truth":17.846540977001908,"fit":17.81076093247555,"deviation":-0.03578004452635852},{"E":3,"truth":17.814115180487402,"fit":17.79399717833943,"deviation":-0.02011800214797077},{"E":3.25,"truth":14.494613534795583,"fit":14.512172876990343,"deviation":0.017559342194759964},{"E":3.5,"truth":7.581022921186867,"fit":7.606464787807497,"deviation":0.025441866620630194},{"E":3.75,"truth":0.6080661789491579,"fit":0.6507967467965534,"deviation":0.042730567847395484},{"E":4,"truth":-3.486406861813161,"fit":-3.40077961922933,"deviation":0.08562724258383092},{"E":4.25,"truth":-5.04388353815786,"fit":-4.94307566833783,"deviation":0.10080786982002987},{"E":4.5,"truth":-5.277612607394961,"fit":-5.136259231787584,"deviation":0.1413533756073777},{"E":4.75,"truth":-4.963325709946118,"fit":-4.815119421606822,"deviation":0.1482062883392965},{"E":5,"truth":-4.463886357638243,"fit":-4.247184841815927,"deviation":0.216701515822316},{"E":5.25,"truth":-3.9312512154642922,"fit":-3.762853427735132,"deviation":0.16839778772916025},{"E":5.5,"truth":-3.424456204957724,"fit":-3.109998768787637,"deviation":0.3144574361700867}],"maxDeviation":0.3144574361700867,"uvAmplitude":15.964982545063206,"epsilonInf":0.43848948295625917}
STAGE4_KK_SYNTHETIC_FIT {"thickness":100.06905571093064,"error":0.06905571093064111,"converged":true,"status":"cost","mseWoollam":2.6998665687437247}
STAGE4_CORRELATION_LEVEL {"r":-0.9999882030599727,"kappa":411.74566096125557,"previousLevel":"ok","level":"severe","warnings":["物理參數高度相關：d ↔ A，r=-0.99998820 (severe)。","統計警告等級：severe（綜合欄正規化條件數與物理參數相關性）。"]}
{
  "total": 65,
  "passed": 65,
  "failures": []
}

```

## 變更檔案清單

- `STAGE4_REPORT.md`
- `scientific-tests.json`
- `scripts/scientific-tests.ts`
- `scripts/stage4-benchmark.ts`
- `scripts/stage4-tests.ts`
- `src/components/ExpertFittingPanel.tsx`
- `src/data/export.ts`
- `src/data/validationReport.ts`
- `src/fitting/autoWorkflow.ts`
- `src/fitting/expertWorkflow.ts`
- `src/fitting/statistics.ts`
- `src/modelRegistry/registry.ts`
- `src/models/bspline.ts`
- `src/models/expertMixed.ts`
- `src/models/kkBspline.ts`
- `src/models/peakInitialization.ts`
- `src/models/taucLorentz.ts`
- `src/types/ellipsometry.ts`
- `stage4-after.json`
- `stage4-before.json`
- `stage4-build.log`
- `stage4-c-only.json`
- `stage4-scientific.log`
- `stage4-test-details.json`
- `stage4-verify.log`
- `v2-original-tests.json`
- `verification-summary.json`

## 函式接點

- taucLorentz.ts：computeTaucLorentzEps1/2、safeTaucLorentzDomain、validateTaucLorentzDomain/Parameters；expertMixed 僅同步 TL reference。
- peakInitialization.ts：detectEpsilonPeaks、initializeDetectedPeaks、dielectricBackground；registry.initializePhysicalModelFromBSpline 接入新種子與 metadata。
- bspline.ts：getEffectiveKnotsAndCount 改為純參數解析，移除 getter/setter；autoWorkflow.runAutomatedEllipsometryFit 傳遞各階段網格及初始化結果。
- expertWorkflow.ts：splineGrid、preparePhysical、fitExpert、runExpertStage 接點；新增 initializeKkSpline 與 KK 參數驗證／平滑介面。
- kkBspline.ts：kkSplineGrid、kkBasisAtEnergy、createKkBsplineModel、fitKkEpsilon2；ModelRegistry 註冊；ExpertFittingPanel 提供初始化／範圍／極設定。
- statistics.ts：computeFitStatistics 增加 E 項配對警告；types.FittingResult.initialization、createValidationReport、exportFittedParametersJson 傳遞結果。
- scripts/scientific-tests.ts 僅增加新測試入口；stage4-tests.ts 為本段工程案例，stage4-benchmark.ts 為固定案例量測器。scientific-tests.json、v2-original-tests.json 等為重新產生的執行結果，沒有改變原斷言的期望值。

## 參考

- [Jellison–Modine 原文 DOI](https://doi.org/10.1063/1.118064)、[1996 更正 DOI](https://doi.org/10.1063/1.118155)。實作公式由本次任務給定；亦對照 [pyElli 官方 TL 原始碼文件](https://pyelli.readthedocs.io/en/v0.21.2/_modules/elli/dispersions/tauc_lorentz.html)，不引入其依賴。
- [Johs–Hale：Dielectric function representation by B-splines](https://onlinelibrary.wiley.com/doi/10.1002/pssa.200777754)。本段以所述概念自行實作基底數值 KK，未將文章的解析基底公式聲稱為此程式實作。

## 分段 commit

報告本身的最終 E commit 可再由 git log 取得；以下為產生報告時的已提交紀錄：

```text
9fb8124 B: Keep edge-derived Tauc-Lorentz seeds inside the coupled domain
0ab7dd8 A: Document coupled TL constraints and reject nonfinite epsilon2
f741d2b E: Escalate warnings for strongly correlated physical parameters
b3db03e D: Add instance-cached KK epsilon2 spline model for Expert fitting
816d73d B: Preserve mixed oscillator shapes and include edge peaks
69dc6c6 A: Validate TL parameter aliases and align analytic model references
4d8c801 B: Seed physical oscillators from deterministic epsilon2 peaks
45feb1a A: Use analytic Tauc-Lorentz epsilon1 with domain validation
882e886 C: Replace mutable spline knot state with explicit per-layer grids
```
