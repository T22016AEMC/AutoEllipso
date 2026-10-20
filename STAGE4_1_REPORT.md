> 原始輸出位置：本機 `.qa/`，不在 repo。本文歷史 JSON／log／CSV／校驗清單檔名均指 `.qa/` 下同名檔案；測試必需的小型數值基準另存 `scripts/fixtures/`，數值未改。

# Stage 4.1 實作與工程測試報告

基準 `fb3c33267a5b5b9f125ae1f8f603a41989a1b7aa`；分支 `v2.2-integration`。

## 狀態與保留的失敗

`pnpm run verify` exit code 1：typecheck 0、build 0、original 29/29、scientific 72/73、worker 8/8。既有 65 項科學測試腳本案例全部通過；新增 8 項有 1 項未通過。另執行的 `pnpm run build` exit code 0。

唯一未通過項：`Stage4.1: Automatic transparent k and propagated uncertainty`，原始 assertion：`high wavelength detection flags`。透明案例 800–900 nm 的 k 信賴下限仍大於零，沒有被標記為 below_detection。沒有把 k 改成零，也沒有放寬門檻、修改舊測試期望值或略過失敗測試。

使用者補充指示：維持本段範圍，不改 B-spline 節點加密／停止規則；保留失敗並推送指定分支。λK=0.15/0.6/2.4 僅在獨立診斷副本執行，正式預設仍為 0.6。

## A：透明預判移除與完整搜尋

起點 0 保留依 ε₂ 特徵初始化的參數。其餘起點採固定、與 k 無關的排程：零起算 startIdx % 5 !== 4 時探索既有 VUV 序列，其餘探索資料範圍附近；Gaussian/Lorentz/TL 共用此排程，振子數仍依原設定。VUV 起點本身可以在測量範圍產生極小或零 k，是否採用仍由既有實際殘差比較決定，沒有依 maxK 分流。

| 檔案／原始行號 | 原行為 | 本次行為 |
|---|---|---|
| `src/fitting/autoWorkflow.ts:324–327` | maxK < 0.035 → isTransparent | 移除樣品分類 |
| `src/fitting/autoWorkflow.ts:407` | 透明每 5 個／非透明每 4 個的不同起點分支 | 所有資料使用同一 startIdx % 5 !== 4 排程 |
| `src/fitting/autoWorkflow.ts:909–911` | Cauchy MSE<1 且無 prefit → λN=0.35、λK=8.0 | 一律 λN=0.25、λK=0.6 |
| `src/fitting/autoWorkflow.ts:1014` | 透明 kMax=0.06 | 一律 min(3.5,max(0.4,kInit+1.2))，下界 0 |
| `src/models/peakInitialization.ts:54–56` | 低 k/低 ε₂ → transparent-legacy-fallback | 移除；沒有內部或邊界峰才建立單振子 fallback |
| `src/models/peakInitialization.ts:56` | 無峰退回 registry 的舊初始化 | supported 模型直接建立範圍內 E0、非零 ε₂ seed；平坦時取能量中點、峰高至少 1e-3，最後仍依既有參數上下界夾限 |
| `src/modelRegistry/registry.ts:245–246,382,444,504,614–625` | 第二套 isTransparentDielectric 與 Gaussian/Lorentz/TL/mixed 的透明 VUV seeds | 刪除 supported 模型不再使用的舊分支，全部走共同 peak initializer；保留 Drude / Sellmeier 原本的模型專用初始化 |
| `src/fitting/autoWorkflow.ts:690–693` | transparentWindow 命名 | 改為 longWavelengthWindow 命名；保留原 Stage 1 波長取樣方式，沒有改篩選數據或階段順序 |

其餘命中與保留理由：
- Cauchy 的 k0 預設 0 與 Stage 1 長波初始化保留；這是使用者要求保留的初始模型，後續 B-spline K 初值為正、可擬合，沒有將其當作最終透明判定。
- Sellmeier 的 k=0 與標準透明材料的既有預設／合成真值保留，屬明確選用模型或 fixture，而非根據 maxK 切換規則。
- tabulated 材料、Drude/cauchy/sellmeier 的 transparent 說明文字保留。
- 未啟用振子的 A2/A3=0、自由修正預設 0，以及 n/k 的非負限制保留，屬顯式模型啟用狀態／參數下界，不是透明樣品預判。
- `src/` 的 grep 測試不再找到 maxK < 0.035 或 isTransparent 類分流；完整命中保存在 `stage4_1-source-audit.log`。

## B：完整精度

移除 autoWorkflow 的 clampAndSet 四位小數、B-spline 初始／內插係數四位小數、最佳係數記錄五位小數、物理起點／候選參數四位小數、厚度格點兩位小數、最終 n/k 四位小數、數值結果記錄及驗證摘要的提前捨入。engine 的參數記錄與 bspline 的節點位置也保留完整精度。defaultProjects 的已保存殘差移除三位小數捨入，實驗資料與雜訊不變。

沒有 prefit k 時初始化 1e-3；有 prefit 或內插結果時保留正值，僅在零值時使用 1e-12 作為正初值。此正初值不作為結果的下限；優化 K 下界仍為 0，實際擬合結果可以到邊界 0。

保留的 Math.round 用於整數節點數、SG 窗寬、既有特徵提取取樣間距與進度；訊息與 UI 的 toFixed 僅格式化。residual.ts 的既有 AIC/BIC 與殘差區段診斷格式保持原狀，避免修改禁止變動的 MSE 核心；本次比較資料的 AIC/BIC 使用未捨入 RSS 公式。完整 A/B diff 附於後文，含每一處刪除與替代。

## C：獨立自由形式曲線、共變異與比較

新增唯一的曲線傳遞 helper `freeFormCurve`，它讀取既有 `computeFitStatistics` 的物理單位 covariance，不重新估計 Jacobian/SVD/共變異。Automatic 對選定的 B-spline 最終點呼叫一次 computeFitStatistics，對選定物理模型最終點維持原呼叫；不在每一步迭代或每個起點重算統計。

所有 B-spline N/K 與膜厚的自由參數都納入同一次統計；沿用實際最佳階段的上下界。正式 covariance 包含原擬合的正則化殘差列與 mean(w²) 尺度；χ²/dof 只取資料殘差。線性 u→p 的導數為參數 span，由原 statistics.ts 計算。rcond=1e-12，boundary ε=1e-6，皆讀取既有設定，核心檔案未修改。

`σ_k(λ)=sqrt(b(λ)^T C_kk b(λ))`；95% CI 使用既有 studentT975(dof)。CI 下限≤0 時 belowDetection=true，但仍輸出原擬合 k。邊界係數依既有規則固定於當前值，不輸出係數 stdError；保存 boundaryHit 與實際上下界。不可識別或統計不可用時 kSigma=null、CI=null，不偽造誤差或判為通過。

保存欄位：freeFormOpticalConstants、finalOpticalConstants、freeFormStatistics、freeFormCoefficientBounds、freeFormModel、opticalModelComparison。freeFormModel 保存完整圖層、節點、參數、上下界與 λ，供重現這次統計與診斷。JSON 欄位可選；未改版本與舊欄位，舊專案仍可載入。

兩組 MSE_W 於同一 AOI／全光譜資料計算；有效參數數 M 取 covariance 中未鎖定且不在邊界的參數數。比較 AIC=2N·ln(RSS/(2N))+2M、BIC=2N·ln(RSS/(2N))+M·ln(2N)，使用既有未加權度數 RSS；沒有更改主結果既有的 MSE／權重／numParameters 定義。主結果與比較面板的 MSE_W 分母可能因邊界參數排除而不同，面板明示為有效參數比較。

若顯著自由形式點 k>2σ_k 的 max k，較物理模型全測量範圍的 max k 高出 2σ_k，保存並顯示指定差異提示；只作比較，不替換任一曲線。結果視窗與 Expert 面板沿用現有樣式增加比較摺疊表與自由形式下載。

## D：匯出與重現操作

`AutoEllipso_optical_constants.csv`（physical）及結果視窗「下載自由形式 n/k + σ_k CSV」產生的 `AutoEllipso_free_form_optical_constants.csv`（free_form）都維持前三欄 Wavelength,n,k，新增 k_sigma,flag,source。n 為 17 位有效數字；k/σ_k 為 16 位小數的科學記號，即 17 位有效數字，double 數值可往返，不把小 k 寫成零。physical 的 k_sigma 空白；below_detection 只標記、不改 k。

自由形式為獨立 n/k B-spline（非因果選項），物理曲線為選定色散模型；兩者的差異可在比較表與 Validation Report / 參數 JSON 查閱。專案 JSON 同時保存上述結果。下載全在瀏覽器內執行。

可重現命令：
```text
pnpm run verify
pnpm run build
pnpm exec tsx scripts/stage4_1-benchmark.ts after
pnpm exec tsx scripts/stage4_1-diagnostics.ts
```

診斷腳本以共用 fixture 和相同輸入執行原 Automatic；僅為 λK=0.15/2.4 在被忽略的 .qa 建立單一模組隔離副本，檢查並替換唯一 const lambdaK=0.6，其餘常數、節點與停止規則不改。不是另複製專案，也不會改正式檔案或預設值。診斷 data-only 使用同一個 computeFitStatistics 的 SVD 與截斷，不另實作統計。

## E：固定案例與診斷實際輸出

fixture：Si 上 100 nm，65/70/75°，190–900 nm、間隔 10 nm，共 216 點；n=1.60+0.01/λ_µm²。LCG seed=41001 + Box–Muller，σΨ=σΔ=0.03°。有吸收依明確公式 k=0.02·(400/λ_nm)^4 產生；其算術值 k633=0.003189004417984006、k900=0.0007803688462124675，不同於題目文字中的近似值；未改公式使其符合近似值。

### 有吸收與透明：正式 λK=0.6，兩種 σ_k 並列

以下空白 flag 表示信賴下限仍大於零；不是通過標誌。regularized 為正式顯示方法，data-only 只作診斷。表含全波段至少每 50 nm，以及 800–900 nm 每 10 nm。

#### absorbing

自由形式膜厚 102.65933704202604 nm；物理模型膜厚 100.07111116343209 nm；物理 converged=True。

| 方法 | dof | reduced χ² | 欄正規化 κ | 等級 | 截斷數 |
|---|---|---|---|---|---|
| 含正則化 | 407 | 28.554744336349994 | 95.8039578709264 | ok | 0 |
| 僅資料 | 407 | 28.554744336349994 | 104.08157120311859 | ok | 0 |

| λ nm | 真值 k | 擬合 k | σ_k regularized | flag regularized | σ_k data-only | flag data-only | n擬合−真值 |
|---|---|---|---|---|---|---|---|
| 190 | 0.392876052209544 | 0.36319455479264057 | 0.0008671218043844931 |  | 0.0009583095626330776 |  | -0.018302769124732388 |
| 200 | 0.32 | 0.3088385189626567 | 0.0005537532075018222 |  | 0.0006040321305296159 |  | -0.0219273423116797 |
| 250 | 0.13107200000000002 | 0.1304980669401622 | 0.00023104173685303594 |  | 0.00023718063397717412 |  | -0.033683024623493374 |
| 300 | 0.06320987654320986 | 0.060237550274889654 | 0.0002255167766389245 |  | 0.0002383717965194858 |  | -0.030147392174375343 |
| 350 | 0.03411911703456892 | 0.03531417820296492 | 0.00021165796279145778 |  | 0.0002133427204653147 |  | -0.0275641434667091 |
| 400 | 0.02 | 0.024200284754776546 | 0.0003557344012054725 |  | 0.0003859952901813488 |  | -0.027336315284116397 |
| 450 | 0.01248590153939948 | 0.019434923193922978 | 0.00037285136119637164 |  | 0.00039926069117874366 |  | -0.023786225870308764 |
| 500 | 0.008192000000000001 | 0.017056273522188817 | 0.0004527163325448297 |  | 0.000489922785201697 |  | -0.023194802567961137 |
| 550 | 0.0055952462263506595 | 0.01697563619869163 | 0.0005845796219483493 |  | 0.0006325889077504468 |  | -0.023678650486745 |
| 600 | 0.0039506172839506165 | 0.017369552135649682 | 0.0006978223536401907 |  | 0.0007529482603542368 |  | -0.023211299036594246 |
| 650 | 0.002868246910122195 | 0.017508752778105378 | 0.0007948008335284083 |  | 0.000856868240151315 |  | -0.02218134025944951 |
| 700 | 0.0021324448146605576 | 0.018283405629930607 | 0.0009231655132936699 |  | 0.0010007162133169967 |  | -0.021693553577382785 |
| 750 | 0.0016181728395061729 | 0.018187015437199642 | 0.000977079602111596 |  | 0.0010694370720199663 |  | -0.021070447181178453 |
| 800 | 0.00125 | 0.0177142103049964 | 0.0010451779353000017 |  | 0.0011119309135277121 |  | -0.020708647525350843 |
| 810 | 0.001189405344021441 | 0.017646810692559894 | 0.0010632206190505117 |  | 0.0011323217448343601 |  | -0.020710173144484312 |
| 820 | 0.0011324383059996934 | 0.017588230195367784 | 0.0010909887062550624 |  | 0.0011771595047996937 |  | -0.020733651870111336 |
| 830 | 0.001078841369040426 | 0.017537832651378097 | 0.0011226119433695462 |  | 0.0012333914582490035 |  | -0.020777612406083668 |
| 840 | 0.0010283780934898523 | 0.01749498189854887 | 0.0011500782807381048 |  | 0.001281807537666356 |  | -0.02084062297019651 |
| 850 | 0.0009808311682091928 | 0.017459041774838126 | 0.001168399142210824 |  | 0.001306263430398245 |  | -0.02092128852151043 |
| 860 | 0.0009360006622204685 | 0.017429376118203905 | 0.0011823425073452982 |  | 0.0013037775392398436 |  | -0.021018248212030244 |
| 870 | 0.0008937024540912294 | 0.017405348766604243 | 0.0012152158102912698 |  | 0.0012997398498496933 |  | -0.02113017304222886 |
| 880 | 0.0008537668192063383 | 0.017386323557997158 | 0.0013158140666576763 |  | 0.0013684126762157835 |  | -0.021255763702000108 |
| 890 | 0.0008160371574869313 | 0.017371664330340698 | 0.0015491178028480396 |  | 0.0016265149039538097 |  | -0.021393748580450955 |
| 900 | 0.0007803688462124675 | 0.017360734921592878 | 0.00196672188212857 |  | 0.0021633672145750984 |  | -0.021542881929630386 |

#### transparent

自由形式膜厚 100.54216376672133 nm；物理模型膜厚 100.13311262628386 nm；物理 converged=False。

| 方法 | dof | reduced χ² | 欄正規化 κ | 等級 | 截斷數 |
|---|---|---|---|---|---|
| 含正則化 | 409 | 4.81833583738705 | 105.12099155048355 | ok | 0 |
| 僅資料 | 409 | 4.81833583738705 | 105.55169212207149 | ok | 0 |

| λ nm | 真值 k | 擬合 k | σ_k regularized | flag regularized | σ_k data-only | flag data-only | n擬合−真值 |
|---|---|---|---|---|---|---|---|
| 190 | 0 | 0 | 0 | below_detection | 0 | below_detection | -0.007474666798268581 |
| 200 | 0 | 0.00013864311672775017 | 2.1111999225317233e-05 |  | 2.118059417354499e-05 |  | -0.006269273406506848 |
| 250 | 0 | 0.0003774707193317536 | 5.586359519083953e-05 |  | 5.6039899882008614e-05 |  | -0.007572435349279649 |
| 300 | 0 | 0.0002750327942219006 | 4.598891448021633e-05 |  | 4.626616596251337e-05 |  | -0.006342507354864413 |
| 350 | 0 | 0.0003761359362175854 | 0.00010105415105678947 |  | 0.00010193181097272655 |  | -0.005928854124003458 |
| 400 | 0 | 0.0009069087857244344 | 0.00011801082318842928 |  | 0.00011870324963789852 |  | -0.00645094378514921 |
| 450 | 0 | 0.0015699480302307522 | 0.00013793311372818382 |  | 0.00013885922223313916 |  | -0.004965645833072241 |
| 500 | 0 | 0.0019095207960690191 | 0.00015459644755629962 |  | 0.00015507998222420895 |  | -0.004783137476071175 |
| 550 | 0 | 0.0024228714330520344 | 0.00019937199528357848 |  | 0.00020043666394186318 |  | -0.004931388121529157 |
| 600 | 0 | 0.0028705115144803364 | 0.00024048022527867587 |  | 0.00024135507099347521 |  | -0.0048068864574577486 |
| 650 | 0 | 0.0031305050860280332 | 0.0002703912002154482 |  | 0.0002713187798846454 |  | -0.004630271799413999 |
| 700 | 0 | 0.003486380248796671 | 0.0003301712349852744 |  | 0.0003406713346842341 |  | -0.004534021000677013 |
| 750 | 0 | 0.003578637709954132 | 0.00035317610110575226 |  | 0.0003702889638319726 |  | -0.004370345349524074 |
| 800 | 0 | 0.0034916618783108187 | 0.000384859657308967 |  | 0.00038981567432937425 |  | -0.004231502864240788 |
| 810 | 0 | 0.0034731238448826034 | 0.00039366497913801275 |  | 0.00040071364979690766 |  | -0.00421984757458671 |
| 820 | 0 | 0.0034569421792130205 | 0.0004070093425789393 |  | 0.0004237786438931384 |  | -0.004214908896869263 |
| 830 | 0 | 0.0034442354655938754 | 0.00042206120712796896 |  | 0.0004520201678437261 |  | -0.004217291192496475 |
| 840 | 0 | 0.003436122288316977 | 0.0004351272977383266 |  | 0.00047597018469182323 |  | -0.004227638336819384 |
| 850 | 0 | 0.003433721231674128 | 0.0004440399669266611 |  | 0.0004881163790030671 |  | -0.004246630946455721 |
| 860 | 0 | 0.0034381508799571393 | 0.0004511732544502462 |  | 0.0004872718990917967 |  | -0.004274983830965695 |
| 870 | 0 | 0.003450529817457817 | 0.0004673373991505966 |  | 0.0004856208116511613 |  | -0.004313443648379156 |
| 880 | 0 | 0.003471976628467966 | 0.0005143943390355366 |  | 0.0005184113801312457 |  | -0.004362786746145764 |
| 890 | 0 | 0.0035036098972793957 | 0.000619663713052756 |  | 0.000637868950740942 |  | -0.004423817170928546 |
| 900 | 0 | 0.0035465482081839103 | 0.0008026699670005805 |  | 0.0008775288992633323 |  | -0.004497364832333206 |

### 透明案例：λK 診斷與膜厚／n 偏差

| λK（僅診斷） | 自由形式膜厚 nm | 物理膜厚 nm | λ nm | 擬合 k | n偏差 | σ_k（regularized） | flag |
|---|---|---|---|---|---|---|---|
| 0.15 | 100.54360221645382 | 100.1331128454647 | 800 | 0.003492365323557754 | -0.004239654517242508 | 0.00038804495711991754 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 810 | 0.0034719264851591474 | -0.004227344786893461 | 0.00039815092695553436 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 820 | 0.0034544745726493606 | -0.0042219980941891055 | 0.0004168680137267174 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 830 | 0.0034413069794750183 | -0.0042242708556663455 | 0.0004391328412449261 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 840 | 0.0034337210990827483 | -0.004234859001804203 | 0.0004580746534431985 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 850 | 0.0034330143249191748 | -0.004254495204348396 | 0.0004685216619545764 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 860 | 0.0034404840504309265 | -0.0042839463279875645 | 0.00047091896602856445 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 870 | 0.0034574276690646282 | -0.004324011085879764 | 0.00047715037851067736 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 880 | 0.0034851425742669067 | -0.004375517880603086 | 0.0005168337449359842 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 890 | 0.00352492615948439 | -0.004439322813948765 | 0.000630807083541259 |  |
| 0.15 | 100.54360221645382 | 100.1331128454647 | 900 | 0.003578075818163701 | -0.004516307850650936 | 0.0008464699322427079 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 800 | 0.0034916618783108187 | -0.004231502864240788 | 0.000384859657308967 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 810 | 0.0034731238448826034 | -0.00421984757458671 | 0.00039366497913801275 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 820 | 0.0034569421792130205 | -0.004214908896869263 | 0.0004070093425789393 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 830 | 0.0034442354655938754 | -0.004217291192496475 | 0.00042206120712796896 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 840 | 0.003436122288316977 | -0.004227638336819384 | 0.0004351272977383266 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 850 | 0.003433721231674128 | -0.004246630946455721 | 0.0004440399669266611 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 860 | 0.0034381508799571393 | -0.004274983830965695 | 0.0004511732544502462 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 870 | 0.003450529817457817 | -0.004313443648379156 | 0.0004673373991505966 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 880 | 0.003471976628467966 | -0.004362786746145764 | 0.0005143943390355366 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 890 | 0.0035036098972793957 | -0.004423817170928546 | 0.000619663713052756 |  |
| 0.6 | 100.54216376672133 | 100.13311262628386 | 900 | 0.0035465482081839103 | -0.004497364832333206 | 0.0008026699670005805 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 800 | 0.0034800164600222666 | -0.004198156720250923 | 0.0003752898472260237 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 810 | 0.003465933578384633 | -0.0041880824632283264 | 0.00038226755714819216 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 820 | 0.0034525709952851987 | -0.004184072871804112 | 0.00039018437687187894 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 830 | 0.0034406762776279308 | -0.004186624809654926 | 0.0003983935735384333 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 840 | 0.0034309969923168016 | -0.004196274654401089 | 0.00040647399428222006 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 850 | 0.0034242807062557787 | -0.004213595524928282 | 0.0004154155189717135 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 860 | 0.0034212749863488344 | -0.004239194733065776 | 0.0004291152126224429 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 870 | 0.003422727399499938 | -0.004273711439112038 | 0.0004557413947710202 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 880 | 0.0034293855126130584 | -0.0043178144927853435 | 0.0005076073466997508 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 890 | 0.0034419968925921683 | -0.004372200443017782 | 0.0005981307573868285 |  |
| 2.4 | 100.5368810992887 | 100.13311173904842 | 900 | 0.003461309106341234 | -0.004437591701683008 | 0.0007376356827459569 |  |

四次診斷均執行完成，errors=[]；兩種 Jacobian 方法在這些輸出中皆截斷 0 個奇異值。全部實際條件數見上述表及 stage4_1-diagnostics.json，不將未達警告門檻解讀為 k 準確或測試通過。三種 λK 的長波 k 仍偏離透明真值；沒有依診斷結果改預設，也不以本表判定偏差的唯一成因。

### 弱吸收：只記錄，不加通過門檻

| λ nm | 真值 k | 擬合 k | σ_k | flag |
|---|---|---|---|---|
| 200 | 0.003 | 0.002992731194597068 | 7.912648924604633e-05 |  |
| 250 | 0.003 | 0.0034288210274478577 | 6.121763176651206e-05 |  |
| 300 | 0.003 | 0.0032206939882152555 | 8.999559891012703e-05 |  |
| 350 | 0.003 | 0.003340680721488998 | 0.00010055550711704934 |  |
| 400 | 0.003 | 0.003953969767026369 | 0.000160361495163763 |  |
| 450 | 0.003 | 0.004593123381445175 | 0.00015783042690896196 |  |
| 500 | 0.003 | 0.004951158946339023 | 0.00018383016958673645 |  |
| 550 | 0.003 | 0.005471254268436022 | 0.0002378302698507891 |  |
| 600 | 0.003 | 0.00592879999171598 | 0.00028353836853850213 |  |
| 650 | 0.003 | 0.006208708476848585 | 0.00031974013595617253 |  |
| 700 | 0.003 | 0.006556437217538044 | 0.0003763725144107101 |  |
| 750 | 0.003 | 0.006654115014536445 | 0.00039913762387023595 |  |
| 800 | 0.003 | 0.006574104004212238 | 0.00042862550446584564 |  |
| 850 | 0.003 | 0.006514517189278139 | 0.0004824651492605036 |  |
| 900 | 0.003 | 0.0066289789053699776 | 0.0008254513934999806 |  |

### SiO₂/Si 回歸與 Automatic 耗時

| 來源 | 膜厚 nm | Raw MSE deg² | converged | 三次耗時 ms / 中位 ms |
|---|---|---|---|---|
| stage3-before | 99.99715906148896 | 0.009153355272130782 | True | [6935.7288, 9964.7084, 7073.2503] / 7073.2503 |
| stage4-after | 99.99715991446588 | 0.009153357823814337 | True | [6916.6108, 6627.6074, 6584.991599999999] / 6627.6074 |
| 本段 before | 99.99715991446588 | 0.009153357823814337 | True | [6563.215300000001, 7019.2857, 6770.475600000002] / 6770.475600000002 |
| 本段 after | 99.99715991449385 | 0.009153358917018344 | True | [7216.0099, 6936.4511, 6964.572099999999] / 6964.572099999999 |

本段差異：膜厚 2.7966962079517543e-11 nm；Raw MSE 1.0932040064859372e-09 deg²；中位耗時增加 2.8668074662287824% 。三次結果 bitIdentical=true。數值差異來自指定的透明分支／精度修改；沒有對比值或舊期望值作校正。

verify 內的個別耗時包含並行檢查及另外 build 競爭，不能與獨立三次 benchmark 混比；獨立測量資料在 stage4_1-before.json / stage4_1-after.json。

### 測試清單與期望值變更

既有測試期望值修改：**無**。既有 65 項全部通過。新增 8 項：
- Stage4.1: flat-spectrum fallback stays in band with positive absorption：通過
- Stage4.1: Automatic absorbing k and propagated uncertainty：通過
- Stage4.1: Automatic transparent k and propagated uncertainty：未通過：AssertionError [ERR_ASSERTION]: high wavelength detection flags
- Stage4.1: Automatic weak k and propagated uncertainty：通過
- Stage4.1: covariance propagation uses existing statistics and retains below-detection k：通過
- Stage4.1: optical CSV small k survives round-trip with stable first columns and both sources：通過
- Stage4.1: SiO2 regression and timing against Stage3/4 baseline：通過
- Stage4.1: no absorption threshold branching or optical four-decimal rounding：通過

開發時修正的新測試／實作接點：可選 warning 原本為顯式 undefined，JSON 往返會省略，改為未有警告時不建立屬性；grep 最初誤把 UI 顯示字串 toFixed 當成資料層捨入，改為只在資料／模型程式檢查數值捨入，透明分流檢查仍掃描整個 src。這些都不是既有 65 項期望值修改，沒有放寬數值門檻。

## 變更檔案與函式

- src/fitting/autoWorkflow.ts：buildPerturbedPhysicalStartParams / runAutomatedEllipsometryFit；移除透明分流與捨入、保存最佳 B-spline 上下界、一次性統計、兩組結果／比較。
- src/models/peakInitialization.ts：initializeDetectedPeaks；非零、範圍內 fallback；峰偵測本身未修改。
- src/modelRegistry/registry.ts：initializePhysicalModelFromBSpline；移除第二套透明種子，保留其他模型專用初始化。
- src/models/bspline.ts：generateAdaptiveKnots；節點完整精度，基底／前向公式未修改。
- src/fitting/engine.ts：runAutoFit 的參數記錄完整精度；擬合殘差／optimizer 未修改。
- src/data/defaultProjects.ts：generateBenchmarkData 的保存殘差完整精度。
- src/fitting/freeFormOptics.ts：OpticalConstantPoint / OpticalModelComparison、freeFormCurve / compareOpticalModels；共變異傳遞與比較，不估計另一套統計。
- src/types/ellipsometry.ts：FittingResult 的可選保存欄位。
- src/data/export.ts：opticalConstantsCsv / exportOpticalConstantsCsv / exportFittedParametersJson；17 位有效數字、來源／σ／flag 與完整保存結果。
- src/data/validationReport.ts：createValidationReport；加入自由形式、共變異、模型來源及比較。
- src/components/OpticalModelComparisonPanel.tsx：比較／提示／自由形式下載；FinalFitResultModal.tsx / ExpertFittingPanel.tsx 加入面板。
- scripts/stage4_1-fixture.ts / stage4_1-tests.ts / stage4_1-diagnostics.ts / stage4_1-benchmark.ts；共用固定種子、8 項新增工程測試、診斷與獨立 benchmark；scripts/scientific-tests.ts 僅新增註冊，舊 assertions 不變。
- scientific-tests.json / v2-original-tests.json / verification-summary.json 等執行結果與 stage4_1-*.json、*.log：實際執行輸出；既有報告／基準檔未覆蓋。

## 未完成、限制與保護範圍

- 透明案例的高波長 belowDetection 需求未通過，故 verify 仍為 exit 1。這項依使用者指示保留，不視為完成驗收。GitHub CI 若執行相同 verify，預期也會因相同 assertion 失敗。
- 有吸收案例雖通過本段 400–450 nm 下限門檻，但長波自由形式 k／膜厚與真值仍有偏差；弱吸收輸出也有偏差。所有實際值已列出，沒有以通過部分 assertions 代替外部評估。
- σ_k 是最終點局部線性化與既有 SVD／邊界處理下的傳遞值，未加入模型偏差或人工校準。含／不含正則化兩種結果只按實際輸出比較，沒有乘上補償係數。
- 未調整 B-spline 節點加密、停止規則、迭代次數、正式平滑強度、權重與任何擬合參數來通過測試。
- UI 僅執行 React SSR 工程檢查；未重新執行實體瀏覽器點擊、觸控與下載測試。
- TMM、Δ、MSE／statistics.ts／optimizer／numerics／Worker 架構與階段順序未改；main、wrangler.jsonc、.node-version 與部署設定未改；未新增依賴、封裝或新專案目錄。

保護檔案（基準與工作檔內容相同，忽略換行編碼）：
- `src/solver/transferMatrix.ts` SHA-256（工作檔）：`1da80fefe41583340f27059a752c6afb575dc1bb0541e3b787354925efe55bdd`
- `src/solver/ellipsometricAngles.ts` SHA-256（工作檔）：`3ce7d7025f3115f522e78870e34d8cdea1c3a5f4aa329fd3909d671a0a9d90ba`
- `src/fitting/residual.ts` SHA-256（工作檔）：`c3017cb6db30384e7994c49ead0fe155356f13c6b2553dca14a511e33296634f`
- `src/fitting/statistics.ts` SHA-256（工作檔）：`18d26634667a197c1dd97b9e986c7a942e8fb1f664634fc950a93baf802295eb`
- `src/fitting/optimizer.ts` SHA-256（工作檔）：`3a5479c639248d6e067797c51aaa706743808b57f2d6ac3e468583bf1125e387`
- `src/fitting/numerics.ts` SHA-256（工作檔）：`659d6c86f49ca2739e0d822a80df49b9ff75a337244e4c483e9d786ab36851e5`
- `wrangler.jsonc` SHA-256（工作檔）：`42dfb30440ee8e1a8cb8910d3b399223747da243e77bc3de3a044f07e3dd4ae1`
- `.node-version` SHA-256（工作檔）：`7e8a2fa94951112b894a3dbe3d05efef5e9263741fa49125f0a70f40fedab4cc`
- `.github/workflows/ci.yml` SHA-256（工作檔）：`59c878f16138c3f3545ed60d46494f4adc17e8bce714f160fe30ca9b6135b29c`

## A/B 全部修改行前後對照（原始 diff）

```diff
diff --git a/src/data/defaultProjects.ts b/src/data/defaultProjects.ts
index b3df244..ba94d52 100644
--- a/src/data/defaultProjects.ts
+++ b/src/data/defaultProjects.ts
@@ -63,4 +63,4 @@ function generateBenchmarkData(
       deltaCalc: pt.deltaCalc,
-      psiResidual: Number((pt.psiCalc! - psiNoisy).toFixed(3)),
-      deltaResidual: Number((pt.deltaCalc! - deltaNoisy).toFixed(3)),
+      psiResidual: pt.psiCalc! - psiNoisy,
+      deltaResidual: pt.deltaCalc! - deltaNoisy,
     };
diff --git a/src/fitting/autoWorkflow.ts b/src/fitting/autoWorkflow.ts
index 7a55553..3140637 100644
--- a/src/fitting/autoWorkflow.ts
+++ b/src/fitting/autoWorkflow.ts
@@ -2,2 +2,3 @@ import type {PeakInitialization} from '../models/peakInitialization';
 import { computeFitStatistics } from './statistics';
+import {freeFormCurve,compareOpticalModels} from './freeFormOptics';
 /**
@@ -49,3 +50,3 @@ import {
 } from './residual';
-import { ConvergenceStatus } from './numerics';
+import { ConvergenceStatus, FIT_NUMERICS } from './numerics';
 import { optimizeBoundedLM, OptimizationVariable } from './optimizer';
@@ -235,3 +236,3 @@ export function validateExperimentalData(

-    const key = `${pt.wavelength.toFixed(2)}_${aoi.toFixed(1)}`;
+    const key = `${pt.wavelength}_${aoi}`;
     if (seenWavelengthAoi.has(key)) {
@@ -323,6 +324,4 @@ function buildPerturbedPhysicalStartParams(
   const sorted = [...bsplineSpectrum].sort((a, b) => a.wavelength - b.wavelength);
-  const maxK = Math.max(...sorted.map((p) => p.k));
   const minWl = sorted[0].wavelength;
   const maxEnergyEv = 1239.84 / Math.max(120, minWl);
-  const isTransparent = maxK < 0.035;

@@ -335,3 +334,3 @@ function buildPerturbedPhysicalStartParams(
     const c = Math.max(params[key].min, Math.min(params[key].max, val));
-    params[key].current = Number(c.toFixed(4));
+    params[key].current = c;
     if (fit !== undefined) params[key].fit = fit;
@@ -406,3 +405,3 @@ function buildPerturbedPhysicalStartParams(
   // Decide whether this start explores VUV dielectric pole or in-band absorption resonance
-  const useVuvPole = isTransparent ? startIdx % 5 !== 4 : startIdx % 4 === 3;
+  const useVuvPole = startIdx % 5 !== 4;

@@ -690,6 +689,6 @@ export async function runAutomatedEllipsometryFit(

-  // Identify long-wavelength transparent window (upper 60% of wavelength range, >= 420 nm)
-  const transparentWlThreshold = Math.max(420, fitWlMin + 0.4 * (fitWlMax - fitWlMin));
-  const transparentPoints = fittingPoints.filter((p) => p.wavelength >= transparentWlThreshold);
-  const cauchyScanPts = transparentPoints.length >= 6 ? transparentPoints : fastScanPoints;
+  // Existing Stage 1 long-wavelength window; it does not classify or constrain the subsequent k curve.
+  const longWavelengthThreshold = Math.max(420, fitWlMin + 0.4 * (fitWlMax - fitWlMin));
+  const longWavelengthPoints = fittingPoints.filter((p) => p.wavelength >= longWavelengthThreshold);
+  const cauchyScanPts = longWavelengthPoints.length >= 6 ? longWavelengthPoints : fastScanPoints;

@@ -908,5 +907,4 @@ export async function runAutomatedEllipsometryFit(
   //   regularizedObjective = rawMse + lambdaN * smoothN + lambdaK * smoothK
-  const isTransparentBaseline = cauchyFinalMse < 1.0 && !prefitSpectrumMap;
-  const lambdaN = isTransparentBaseline ? 0.35 : 0.25;
-  const lambdaK = isTransparentBaseline ? 8.0 : 0.6;
+  const lambdaN = 0.25;
+  const lambdaK = 0.6;
   const knotImprovementTolerance = 0.005;
@@ -918,3 +916,3 @@ export async function runAutomatedEllipsometryFit(
   let activeKCoeffs: number[] = activeKnots.map((wl) =>
-    prefitSpectrumMap ? prefitSpectrumMap(wl).k : 0.0002
+    prefitSpectrumMap ? Math.max(1e-12, prefitSpectrumMap(wl).k) : 1e-3
   );
@@ -931,2 +929,5 @@ export async function runAutomatedEllipsometryFit(
   const bsplineLayers: Layer[] = JSON.parse(JSON.stringify(workingLayers));
+  let bestSplineVariables: OptimizationVariable[] = [];
+  let bestSplineResidual: (p:number[])=>number[] = ()=>[];
+  let bestSplineRegularization: (p:number[])=>number[] = ()=>[];
   bsplineLayers[primaryLayerIndex].modelId = 'bspline';
@@ -944,10 +945,10 @@ export async function runAutomatedEllipsometryFit(
     if (stageIdx === 0) {
-      initNCoeffs = stageKnots.map((wl) => Number((prefitSpectrumMap ? prefitSpectrumMap(wl).n : evalBaselineN(wl)).toFixed(4)));
-      initKCoeffs = stageKnots.map((wl) => Number((prefitSpectrumMap ? prefitSpectrumMap(wl).k : 0.0002).toFixed(4)));
+      initNCoeffs = stageKnots.map((wl) => (prefitSpectrumMap ? prefitSpectrumMap(wl).n : evalBaselineN(wl)));
+      initKCoeffs = stageKnots.map((wl) => (prefitSpectrumMap ? Math.max(1e-12, prefitSpectrumMap(wl).k) : 1e-3));
     } else {
       initNCoeffs = stageKnots.map((wl) =>
-        Number(Math.max(1.0, evaluateAdaptiveSpline(wl, activeKnots, activeNCoeffs)).toFixed(4))
+        Math.max(1.0, evaluateAdaptiveSpline(wl, activeKnots, activeNCoeffs))
       );
       initKCoeffs = stageKnots.map((wl) =>
-        Number(Math.max(0.0, evaluateAdaptiveSpline(wl, activeKnots, activeKCoeffs)).toFixed(4))
+        Math.max(1e-12, evaluateAdaptiveSpline(wl, activeKnots, activeKCoeffs))
       );
@@ -1013,3 +1014,3 @@ export async function runAutomatedEllipsometryFit(
       const kInit = initKCoeffs[i];
-      const kMax = isTransparentBaseline ? 0.06 : Math.min(3.5, Math.max(0.4, kInit + 1.2));
+      const kMax = Math.min(3.5, Math.max(0.4, kInit + 1.2));
       stageParamDict[`K${i}`] = {
@@ -1112,8 +1113,8 @@ export async function runAutomatedEllipsometryFit(
       knots: stageKnotCount,
-      rawMse: Number(stageRawMse.toFixed(5)),
+      rawMse: stageRawMse,
       // Preserve the legacy Raw diagnostic contract; weighted fields are the optimized objective.
-      regularizationPenalty: Number(smoothInfo.regularizationPenalty.toFixed(5)),
-      totalObjective: Number((stageRawMse+smoothInfo.regularizationPenalty).toFixed(5)),
+      regularizationPenalty: smoothInfo.regularizationPenalty,
+      totalObjective: (stageRawMse+smoothInfo.regularizationPenalty),
       weightedRegularizationPenalty:stageRegPenalty,weightedTotalObjective:stageTotalObj,
-      thicknessNm: Number(stageT.toFixed(2)),
+      thicknessNm: stageT,
     });
@@ -1126,2 +1127,5 @@ export async function runAutomatedEllipsometryFit(
     if (stageIdx === 0 || stageTotalObj < activeBsplineTotalObj) {
+      bestSplineVariables=structuredClone(stageVars);
+      bestSplineResidual=bsplineExpResidualFn;
+      bestSplineRegularization=bsplineRegResidualFn;
       activeKnots = stageKnots;
@@ -1159,3 +1163,3 @@ export async function runAutomatedEllipsometryFit(
   for (let i = 0; i < activeKnots.length; i++) {
-    finalBsplineCoeffRecord[`N${i}`] = Number(activeNCoeffs[i].toFixed(5));
+    finalBsplineCoeffRecord[`N${i}`] = activeNCoeffs[i];
     finalBsplineParamDict[`N${i}`] = {
@@ -1173,3 +1177,3 @@ export async function runAutomatedEllipsometryFit(
   for (let i = 0; i < activeKnots.length; i++) {
-    finalBsplineCoeffRecord[`K${i}`] = Number(activeKCoeffs[i].toFixed(5));
+    finalBsplineCoeffRecord[`K${i}`] = activeKCoeffs[i];
     finalBsplineParamDict[`K${i}`] = {
@@ -1190,4 +1194,20 @@ export async function runAutomatedEllipsometryFit(
   bsplineLayers[primaryLayerIndex].parameters = finalBsplineParamDict;
+  for(const variable of bestSplineVariables)if(variable.id!=='thickness') {
+    finalBsplineParamDict[variable.id].min=variable.min;
+    finalBsplineParamDict[variable.id].max=variable.max;
+  }
   bsplineLayers[primaryLayerIndex].thickness = activeBsplineThickness;
   const finalBsplineThickness = activeBsplineThickness;
+  const splineVector=[finalBsplineThickness,...activeNCoeffs,...activeKCoeffs];
+  const freeFormStatistics=computeFitStatistics(bestSplineVariables.map(v=>({...v,splineCoefficient:/^[NK]\d+$/.test(v.id)})),
+    splineVector,bestSplineResidual,{weights:residualWeights(fittingPoints,config).weights,regularizationResidualsFn:bestSplineRegularization});
+  const freeFormModel={primaryLayerIndex,layers:structuredClone(bsplineLayers),
+    variables:bestSplineVariables.map((v,i)=>({...v,value:splineVector[i]})),lambdaN,lambdaK};
+  const freeFormCoefficientBounds=bestSplineVariables.filter(v=>v.id.startsWith('K')).map((v,i)=>{
+    const value=activeKCoeffs[i],u=(value-v.min)/(v.max-v.min);
+    return {id:v.id,value,min:v.min,max:v.max,boundaryHit:u<=FIT_NUMERICS.boundaryEpsilon||u>=1-FIT_NUMERICS.boundaryEpsilon};
+  });
+  const freeWavelengths=Array.from(new Set([...fittingPoints.map(p=>p.wavelength),fitWlMax,
+    ...Array.from({length:Math.floor(fitWlMax-fitWlMin)+1},(_,i)=>fitWlMin+i)])).sort((a,b)=>a-b);
+  const freeFormOpticalConstants=freeFormCurve(freeWavelengths,activeKnots,activeNCoeffs,activeKCoeffs,freeFormStatistics);

@@ -1227,3 +1247,3 @@ export async function runAutomatedEllipsometryFit(
     bsplineContinuousSpectrum.push({
-      wavelength: Number(w.toFixed(1)),
+      wavelength: w,
       n: opt.n,
@@ -1315,5 +1335,5 @@ export async function runAutomatedEllipsometryFit(
     const rawGridSet = new Set<number>();
-    rawGridSet.add(Number(finalBsplineThickness.toFixed(2)));
-    rawGridSet.add(Number(finalCauchyThickness.toFixed(2)));
-    rawGridSet.add(Number(primaryLayer.thickness.toFixed(2)));
+    rawGridSet.add(finalBsplineThickness);
+    rawGridSet.add(finalCauchyThickness);
+    rawGridSet.add(primaryLayer.thickness);

@@ -1330,3 +1350,3 @@ export async function runAutomatedEllipsometryFit(
         if (cand >= tMin && cand <= tMax) {
-          rawGridSet.add(Number(cand.toFixed(2)));
+          rawGridSet.add(cand);
         }
@@ -1345,3 +1365,3 @@ export async function runAutomatedEllipsometryFit(
       const val = tMin + (s / linearSteps) * (linearSearchMax - tMin);
-      rawGridSet.add(Number(val.toFixed(2)));
+      rawGridSet.add(val);
     }
@@ -1595,3 +1615,3 @@ export async function runAutomatedEllipsometryFit(
       for (const [pKey, pVal] of Object.entries(startLayers[primaryLayerIndex].parameters)) {
-        finalParamsRecord[pKey] = Number(pVal.current.toFixed(4));
+        finalParamsRecord[pKey] = pVal.current;
       }
@@ -1600,5 +1620,5 @@ export async function runAutomatedEllipsometryFit(
         startIndex: startIdx + 1,
-        initialThickness: Number(startT.toFixed(2)),
-        finalThickness: Number(startLayers[primaryLayerIndex].thickness.toFixed(2)),
-        rawMse: Number(fullMetrics.rawMse.toFixed(5)),
+        initialThickness: startT,
+        finalThickness: startLayers[primaryLayerIndex].thickness,
+        rawMse: fullMetrics.rawMse,
         initialParams: initialParamsRecord,
@@ -1681,4 +1701,4 @@ export async function runAutomatedEllipsometryFit(
     if (winRunRecord) {
-      winRunRecord.finalThickness = Number(bestStartState.layers[primaryLayerIndex].thickness.toFixed(2));
-      winRunRecord.rawMse = Number(bestStartState.rawMse.toFixed(5));
+      winRunRecord.finalThickness = bestStartState.layers[primaryLayerIndex].thickness;
+      winRunRecord.rawMse = bestStartState.rawMse;
     }
@@ -1700,4 +1720,4 @@ export async function runAutomatedEllipsometryFit(
         paramName: '膜層厚度 (Thickness)',
-        initialValue: Number(bestStartState.initialThickness.toFixed(2)),
-        finalValue: Number(bestStartState.layers[primaryLayerIndex].thickness.toFixed(2)),
+        initialValue: bestStartState.initialThickness,
+        finalValue: bestStartState.layers[primaryLayerIndex].thickness,
         min: tMin,
@@ -1716,4 +1736,4 @@ export async function runAutomatedEllipsometryFit(
           paramName: pVal.name || pKey,
-          initialValue: Number((bestStartState.initialParamsRecord[pKey] ?? pVal.initial).toFixed(4)),
-          finalValue: Number(pVal.current.toFixed(4)),
+          initialValue: (bestStartState.initialParamsRecord[pKey] ?? pVal.initial),
+          finalValue: pVal.current,
           min: pVal.min,
@@ -1829,5 +1849,5 @@ export async function runAutomatedEllipsometryFit(
     finalOpticalConstants.push({
-      wavelength: Number(w.toFixed(1)),
-      n: Number(opt.n.toFixed(4)),
-      k: Number(opt.k.toFixed(4)),
+      wavelength: w,
+      n: opt.n,
+      k: opt.k,
     });
@@ -1849,2 +1869,7 @@ export async function runAutomatedEllipsometryFit(
   },{weights:residualWeights(finalFittingPoints,config).weights});
+  const freeCount=freeFormStatistics.covariance.ids.length,physicalCount=statistics.covariance.ids.length;
+  const physicalComparisonCurve=freeWavelengths.map(wavelength=>({wavelength,...finalModelDef.calculate(wavelength,finalParamRecord)}));
+  const opticalModelComparison=compareOpticalModels(freeFormOpticalConstants,physicalComparisonCurve,
+    computeResidualMetrics(bsplineEval,config.fitWeighting,psiWeight,deltaWeight,freeCount),
+    computeResidualMetrics(finalFittingPoints,config.fitWeighting,psiWeight,deltaWeight,physicalCount),freeCount,physicalCount);

@@ -1899,6 +1924,6 @@ export async function runAutomatedEllipsometryFit(
       rawMse: bsplineFinalMse,
-      regularizationPenalty: Number(activeBsplineRegPenalty.toFixed(5)),
-      smoothN: Number(activeBsplineSmoothN.toFixed(6)),
-      smoothK: Number(activeBsplineSmoothK.toFixed(6)),
-      totalObjective: Number((bsplineFinalMse + activeBsplineRegPenalty).toFixed(5)),
+      regularizationPenalty: activeBsplineRegPenalty,
+      smoothN: activeBsplineSmoothN,
+      smoothK: activeBsplineSmoothK,
+      totalObjective: (bsplineFinalMse + activeBsplineRegPenalty),
       weightedRegularizationPenalty:activeWeightedRegPenalty,weightedTotalObjective:activeBsplineTotalObj,
@@ -1911,7 +1936,7 @@ export async function runAutomatedEllipsometryFit(
     physicalModelParameters: finalParamRecord,
-    finalThicknessNm: Number(finalThickness.toFixed(2)),
+    finalThicknessNm: finalThickness,
     rawMse: finalMetrics.rawMse,
     rawRmse: finalMetrics.rawRmse,
-    psiRmse: Number(finalPsiRmse.toFixed(4)),
-    deltaRmse: Number(finalDeltaRmse.toFixed(4)),
+    psiRmse: finalPsiRmse,
+    deltaRmse: finalDeltaRmse,
     perAoiMse,
@@ -1936,2 +1961,4 @@ export async function runAutomatedEllipsometryFit(
       statistics,
+      freeFormStatistics,freeFormOpticalConstants,freeFormCoefficientBounds,opticalModelComparison,freeFormModel,
+      finalOpticalConstants:physicalComparisonCurve,
       mseWoollam:finalMetrics.mseWoollam,reducedChiSquare:finalMetrics.reducedChiSquare,chiSquare:finalMetrics.chiSquare,dof:finalMetrics.dof,
@@ -1947,4 +1974,4 @@ export async function runAutomatedEllipsometryFit(
       rawRmse: finalMetrics.rawRmse,
-      psiRmse: Number(finalPsiRmse.toFixed(4)),
-      deltaRmse: Number(finalDeltaRmse.toFixed(4)),
+      psiRmse: finalPsiRmse,
+      deltaRmse: finalDeltaRmse,
       weightedMse: finalMetrics.weightedMse,
@@ -1973,6 +2000,6 @@ export async function runAutomatedEllipsometryFit(
         deltaRmse: bsplineDeltaRmse,
-        regularizationPenalty: Number(activeBsplineRegPenalty.toFixed(5)),
-        smoothN: Number(activeBsplineSmoothN.toFixed(6)),
-        smoothK: Number(activeBsplineSmoothK.toFixed(6)),
-        totalObjective: Number((bsplineFinalMse + activeBsplineRegPenalty).toFixed(5)),
+        regularizationPenalty: activeBsplineRegPenalty,
+        smoothN: activeBsplineSmoothN,
+        smoothK: activeBsplineSmoothK,
+        totalObjective: (bsplineFinalMse + activeBsplineRegPenalty),
       weightedRegularizationPenalty:activeWeightedRegPenalty,weightedTotalObjective:activeBsplineTotalObj,
diff --git a/src/fitting/engine.ts b/src/fitting/engine.ts
index 602666c..2bf6906 100644
--- a/src/fitting/engine.ts
+++ b/src/fitting/engine.ts
@@ -270,3 +270,3 @@ export async function runAutoFit(options: RunFitOptions): Promise<FitEngineOutpu
             name: v.name,
-            value: Number(currentParamVals[i].toFixed(4)),
+            value: currentParamVals[i],
           })),
@@ -298,4 +298,4 @@ export async function runAutoFit(options: RunFitOptions): Promise<FitEngineOutpu
       paramName: t.paramName,
-      initialValue: Number(t.initialValue.toFixed(4)),
-      finalValue: Number(finalVal.toFixed(4)),
+      initialValue: t.initialValue,
+      finalValue: finalVal,
       min: t.min,
diff --git a/src/modelRegistry/registry.ts b/src/modelRegistry/registry.ts
index 64ef4ba..e9a70a8 100644
--- a/src/modelRegistry/registry.ts
+++ b/src/modelRegistry/registry.ts
@@ -1,3 +1,3 @@
 import {createKkBsplineModel} from '../models/kkBspline';
-import {initializeDetectedPeaks,dielectricBackground,PeakInitialization} from '../models/peakInitialization';
+import {initializeDetectedPeaks,PeakInitialization} from '../models/peakInitialization';
 /**
@@ -8,3 +8,2 @@ import {initializeDetectedPeaks,dielectricBackground,PeakInitialization} from '.
 import { ModelDefinition, ParameterValue, ModelType } from '../types/ellipsometry';
-import { wavelengthNmToEnergyEv } from '../models/base';
 import { CauchyModel } from '../models/cauchy';
@@ -201,393 +200,10 @@ class ModelRegistry {

-    // Sort by wavelength ascending
-    const sorted = [...bsplineSpectrum].sort((a, b) => a.wavelength - b.wavelength);
-
-    // Compute energies, eps1, eps2
-    const spectralData = sorted.map((pt) => {
-      const E = wavelengthNmToEnergyEv(pt.wavelength);
-      const eps1 = pt.n * pt.n - pt.k * pt.k;
-      const eps2 = 2 * pt.n * pt.k;
-      return {
-        wavelength: pt.wavelength,
-        E,
-        n: pt.n,
-        k: pt.k,
-        eps1,
-        eps2,
-      };
-    });
-
-    // 1. Estimate long-wavelength and short-wavelength dielectric response
-    const longWlPoints = spectralData.slice(-Math.max(3, Math.floor(spectralData.length * 0.15)));
-    const shortWlPoints = spectralData.slice(0, Math.max(3, Math.floor(spectralData.length * 0.15)));
-    const avgLongN = longWlPoints.reduce((acc, p) => acc + p.n, 0) / longWlPoints.length;
-    const avgLongEps1 = longWlPoints.reduce((acc, p) => acc + p.eps1, 0) / longWlPoints.length;
-    const avgShortEps1 = shortWlPoints.reduce((acc, p) => acc + p.eps1, 0) / shortWlPoints.length;
-    const maxEnergyEv = Math.max(...spectralData.map((p) => p.E));
-
-    // 2. Find primary peak absorption in eps2 (or k)
-    let peakEps2 = 0;
-    let maxK = 0;
-    let peakEnergyEv = 3.6;
-    let peakIdx = 0;
-
-    for (let i = 0; i < spectralData.length; i++) {
-      if (spectralData[i].k > maxK) {
-        maxK = spectralData[i].k;
-      }
-      if (spectralData[i].eps2 > peakEps2) {
-        peakEps2 = spectralData[i].eps2;
-        peakEnergyEv = spectralData[i].E;
-        peakIdx = i;
-      }
-    }
-
-    // Determine whether the film is predominantly transparent across the measured range
-    const isTransparentDielectric = maxK < 0.035 && peakEps2 < 0.18;
-
-    // Secondary peak detection (local maximum separated by at least 0.6 eV from peak 1)
-    let peak2Eps2 = 0;
-    let peak2EnergyEv = Math.min(8.5, peakEnergyEv + 1.2);
-    for (let i = 1; i < spectralData.length - 1; i++) {
-      const pt = spectralData[i];
-      if (
-        Math.abs(pt.E - peakEnergyEv) > 0.6 &&
-        pt.eps2 > spectralData[i - 1].eps2 &&
-        pt.eps2 > spectralData[i + 1].eps2 &&
-        pt.eps2 > peak2Eps2
-      ) {
-        peak2Eps2 = pt.eps2;
-        peak2EnergyEv = pt.E;
-      }
-    }
-
-    // Tertiary peak detection
-    let peak3Eps2 = 0;
-    let peak3EnergyEv = Math.min(10.0, peak2EnergyEv + 1.0);
-    for (let i = 1; i < spectralData.length - 1; i++) {
-      const pt = spectralData[i];
-      if (
-        Math.abs(pt.E - peakEnergyEv) > 0.6 &&
-        Math.abs(pt.E - peak2EnergyEv) > 0.6 &&
-        pt.eps2 > spectralData[i - 1].eps2 &&
-        pt.eps2 > spectralData[i + 1].eps2 &&
-        pt.eps2 > peak3Eps2
-      ) {
-        peak3Eps2 = pt.eps2;
-        peak3EnergyEv = pt.E;
-      }
-    }
-
-    // 3. Estimate Full Width at Half Maximum (FWHM) around the primary peak
-    const halfMax = peakEps2 * 0.5;
-    let leftE = peakEnergyEv - 0.4;
-    let rightE = peakEnergyEv + 0.4;
-
-    for (let i = peakIdx - 1; i >= 0; i--) {
-      if (spectralData[i].eps2 <= halfMax) {
-        leftE = spectralData[i].E;
-        break;
-      }
-    }
-    for (let i = peakIdx + 1; i < spectralData.length; i++) {
-      if (spectralData[i].eps2 <= halfMax) {
-        rightE = spectralData[i].E;
-        break;
-      }
-    }
-    const fwhm = Math.max(0.2, Math.min(3.0, Math.abs(rightE - leftE)));
-
-    // Helper to safely set parameter if it exists
-    const setParam = (key: string, val: number, fit: boolean = true) => {
-      if (params[key]) {
-        const clamped = Math.max(params[key].min, Math.min(params[key].max, val));
-        params[key].current = Number(clamped.toFixed(4));
-        params[key].initial = params[key].current;
-        params[key].fit = fit;
-      }
-    };
-
-    const modelDef = this.get(modelId);
-
-    // Helper: Given fixed oscillator shape parameters, solve for optimal (eps_inf, A) against B-spline spectrum
-    const matchEpsInfAndAmplitude = (
-      testRecord: Record<string, number>,
-      ampKey: string = 'A'
-    ): { epsInf: number; A: number; fitError: number } => {
-      if (!modelDef) {
-        return { epsInf: Math.max(1.0, avgLongEps1), A: 2.0, fitError: 1e9 };
-      }
-      // Evaluate unit-amplitude oscillator response: eps_osc(E) = eps(E; eps_inf=1, A=1) - (1, 0)
-      const basis1: number[] = [];
-      const basis2: number[] = [];
-      for (const pt of spectralData) {
-        const unitRec = { ...testRecord, eps_inf: 1.0, [ampKey]: 1.0, A2: 0, A3: 0 };
-        const eps = modelDef.calculateEpsilon(pt.wavelength, unitRec);
-        basis1.push(eps.eps1 - 1.0);
-        basis2.push(eps.eps2);
-      }
-
-      // Linear least squares for:
-      //   eps1_target(i) ≈ eps_inf + A * basis1(i)
-      //   eps2_target(i) ≈ A * basis2(i)
-      const nPts = spectralData.length;
-      let s11 = nPts;
-      let s12 = 0;
-      let s22 = 0;
-      let rhs1 = 0;
-      let rhs2 = 0;
-
-      for (let i = 0; i < nPts; i++) {
-        const b1 = basis1[i];
-        const b2 = basis2[i];
-        const t1 = spectralData[i].eps1;
-        const t2 = spectralData[i].eps2;
-        s12 += b1;
-        s22 += b1 * b1 + 2.5 * b2 * b2;
-        rhs1 += t1;
-        rhs2 += b1 * t1 + 2.5 * b2 * t2;
-      }
-
-      const det = s11 * s22 - s12 * s12;
-      let estEpsInf = Math.max(1.0, avgLongEps1 - 0.4);
-      let estA = 2.0;
-
-      if (Math.abs(det) > 1e-9) {
-        estEpsInf = (s22 * rhs1 - s12 * rhs2) / det;
-        estA = (s11 * rhs2 - s12 * rhs1) / det;
-      }
-
-      const minA = params[ampKey]?.min ?? 0.05;
-      const maxA = params[ampKey]?.max ?? 100.0;
-      estA = Math.max(minA, Math.min(maxA, estA));
-
-      // Re-solve optimal eps_inf given clamped estA
-      const meanResidualEps1 = dielectricBackground(spectralData.map((pt,i)=>({target:pt.eps1,contribution:estA*basis1[i]})));
-      const minEpsInf = params['eps_inf']?.min ?? 1.0;
-      const maxEpsInf = params['eps_inf']?.max ?? 15.0;
-      estEpsInf = Math.max(minEpsInf, Math.min(maxEpsInf, meanResidualEps1));
-
-      let err = 0;
-      for (let i = 0; i < nPts; i++) {
-        const e1 = estEpsInf + estA * basis1[i] - spectralData[i].eps1;
-        const e2 = estA * basis2[i] - spectralData[i].eps2;
-        err += e1 * e1 + 2.0 * e2 * e2;
-      }
-
-      return { epsInf: estEpsInf, A: estA, fitError: err / nPts };
-    };
-
-    switch (modelId) {
-      case 'gaussian': {
-        if (isTransparentDielectric) {
-          // Search VUV resonance poles above maxEnergyEv so k(λ) ≈ 0 and normal dispersion matches B-spline n(λ)
-          let bestPole = { E0: Math.max(8.5, maxEnergyEv + 3.0), sigma: 0.55, epsInf: 1.35, A: 10.0, err: 1e9 };
-          const candidateE0s = [
-            maxEnergyEv + 1.8,
-            maxEnergyEv + 2.6,
-            maxEnergyEv + 3.5,
-            maxEnergyEv + 4.3,
-            maxEnergyEv + 5.2,
-          ];
-          const candidateSigmas = [0.35, 0.55, 0.8];
-          for (const cE0 of candidateE0s) {
-            for (const cSigma of candidateSigmas) {
-              const m = matchEpsInfAndAmplitude({ E0: cE0, sigma: cSigma }, 'A');
-              if (m.fitError < bestPole.err) {
-                bestPole = { E0: cE0, sigma: cSigma, epsInf: m.epsInf, A: m.A, err: m.fitError };
-              }
-            }
-          }
-          setParam('eps_inf', bestPole.epsInf, true);
-          setParam('A', bestPole.A, true);
-          setParam('E0', bestPole.E0, true);
-          setParam('sigma', bestPole.sigma, true);
-          setParam('A2', 0.0, false);
-          setParam('E02', Math.min(14.0, bestPole.E0 + 1.5), false);
-          setParam('sigma2', 0.6, false);
-          setParam('A3', 0.0, false);
-          setParam('E03', Math.min(14.5, bestPole.E0 + 2.5), false);
-          setParam('sigma3', 0.7, false);
-        } else {
-          const sigma1 = Math.max(0.15, Math.min(2.5, fwhm / 1.665));
-          const E01 = Math.max(1.0, Math.min(12.0, peakEnergyEv));
-          const matched = matchEpsInfAndAmplitude({ E0: E01, sigma: sigma1 }, 'A');
-          setParam('eps_inf', matched.epsInf, true);
-          setParam('A', Math.max(0.1, matched.A), true);
-          setParam('E0', E01, true);
-          setParam('sigma', sigma1, true);
-
-          if (peak2Eps2 > 0.15 * peakEps2) {
-            setParam('A2', Math.max(0.1, peak2Eps2 * 1.1), true);
-            setParam('E02', Math.max(1.0, Math.min(14.0, peak2EnergyEv)), true);
-            setParam('sigma2', Math.max(0.2, sigma1 * 0.9), true);
-          } else {
-            setParam('A2', 0.0, false);
-            setParam('E02', Math.min(14.0, E01 + 1.2), false);
-            setParam('sigma2', 0.6, false);
-          }
-
-          if (peak3Eps2 > 0.15 * peakEps2) {
-            setParam('A3', Math.max(0.1, peak3Eps2 * 1.0), true);
-            setParam('E03', Math.max(1.0, Math.min(14.5, peak3EnergyEv)), true);
-            setParam('sigma3', Math.max(0.2, sigma1 * 1.1), true);
-          } else {
-            setParam('A3', 0.0, false);
-            setParam('E03', Math.min(14.5, peak2EnergyEv + 1.0), false);
-            setParam('sigma3', 0.7, false);
-          }
-        }
-        break;
-      }
-
-      case 'lorentz': {
-        if (isTransparentDielectric) {
-          let bestPole = { E0: Math.max(8.8, maxEnergyEv + 3.2), gamma: 0.01, epsInf: 1.35, A: 8.0, err: 1e9 };
-          const candidateE0s = [
-            maxEnergyEv + 1.8,
-            maxEnergyEv + 2.8,
-            maxEnergyEv + 3.8,
-            maxEnergyEv + 4.8,
-          ];
-          const candidateGammas = [0.005, 0.015, 0.05];
-          for (const cE0 of candidateE0s) {
-            for (const cGamma of candidateGammas) {
-              const m = matchEpsInfAndAmplitude({ E0: cE0, gamma: cGamma }, 'A');
-              if (m.fitError < bestPole.err) {
-                bestPole = { E0: cE0, gamma: cGamma, epsInf: m.epsInf, A: m.A, err: m.fitError };
-              }
-            }
-          }
-          setParam('eps_inf', bestPole.epsInf, true);
-          setParam('A', bestPole.A, true);
-          setParam('E0', bestPole.E0, true);
-          setParam('gamma', bestPole.gamma, true);
-          setParam('A2', 0.0, false);
-          setParam('E02', Math.min(14.0, bestPole.E0 + 1.5), false);
-          setParam('gamma2', 0.2, false);
-          setParam('A3', 0.0, false);
-          setParam('E03', Math.min(14.5, bestPole.E0 + 2.5), false);
-          setParam('gamma3', 0.3, false);
-        } else {
-          const gamma = Math.max(0.1, Math.min(2.5, fwhm));
-          const E01 = Math.max(1.0, Math.min(12.0, peakEnergyEv));
-          const matched = matchEpsInfAndAmplitude({ E0: E01, gamma }, 'A');
-          setParam('eps_inf', matched.epsInf, true);
-          setParam('A', Math.max(0.2, matched.A), true);
-          setParam('E0', E01, true);
-          setParam('gamma', gamma, true);
-
-          if (peak2Eps2 > 0.15 * peakEps2) {
-            setParam('A2', Math.max(0.2, peak2Eps2 * gamma * 1.3), true);
-            setParam('E02', Math.max(1.0, Math.min(14.0, peak2EnergyEv)), true);
-            setParam('gamma2', Math.max(0.1, gamma * 0.9), true);
-          } else {
-            setParam('A2', 0.0, false);
-            setParam('E02', Math.min(14.0, E01 + 1.2), false);
-            setParam('gamma2', 0.5, false);
-          }
-
-          if (peak3Eps2 > 0.15 * peakEps2) {
-            setParam('A3', Math.max(0.2, peak3Eps2 * gamma * 1.1), true);
-            setParam('E03', Math.max(1.0, Math.min(14.5, peak3EnergyEv)), true);
-            setParam('gamma3', Math.max(0.1, gamma * 1.1), true);
-          } else {
-            setParam('A3', 0.0, false);
-            setParam('E03', Math.min(14.5, peak2EnergyEv + 1.0), false);
-            setParam('gamma3', 0.6, false);
-          }
-        }
-        break;
-      }
-
-      case 'tauc_lorentz': {
-        if (isTransparentDielectric) {
-          const egPole = Math.max(6.6, maxEnergyEv + 0.3);
-          let bestPole = { E0: egPole + 3.0, C: 1.2, Eg: egPole, epsInf: 1.35, A: 90.0, err: 1e9 };
-          for (const dE0 of [2.0, 3.0, 4.0]) {
-            for (const cVal of [1.0, 1.5]) {
-              const cE0 = egPole + dE0;
-              const m = matchEpsInfAndAmplitude({ E0: cE0, C: cVal, Eg: egPole }, 'A');
-              if (m.fitError < bestPole.err) {
-                bestPole = { E0: cE0, C: cVal, Eg: egPole, epsInf: m.epsInf, A: m.A, err: m.fitError };
-              }
-            }
-          }
-          setParam('eps_inf', bestPole.epsInf, true);
-          setParam('A', bestPole.A, true);
-          setParam('E0', bestPole.E0, true);
-          setParam('C', bestPole.C, true);
-          setParam('Eg', bestPole.Eg, true);
-          setParam('A2', 0.0, false);
-          setParam('E02', Math.min(14.0, bestPole.E0 + 1.5), false);
-          setParam('C2', 1.5, false);
-          setParam('A3', 0.0, false);
-          setParam('E03', Math.min(14.5, bestPole.E0 + 2.5), false);
-          setParam('C3', 1.8, false);
-        } else {
-          const broadeningC = Math.max(0.3, Math.min(3.5, fwhm));
-          let egEst = Math.max(0.5, peakEnergyEv - broadeningC * 0.6);
-          // Scan from low energy to high energy to detect absorption onset
-          const byEnergyAsc = [...spectralData].sort((a, b) => a.E - b.E);
-          for (let i = 0; i < byEnergyAsc.length; i++) {
-            if (byEnergyAsc[i].k > 0.025 && byEnergyAsc[i].E < peakEnergyEv) {
-              egEst = Math.max(0.5, byEnergyAsc[i].E - 0.15);
-              break;
-            }
-          }
-          const clampedEg = Math.max(0.4, Math.min(peakEnergyEv - 0.2, egEst));
-          const E01 = Math.max(clampedEg + 0.25, Math.min(12.0, peakEnergyEv));
-
-          // Grid search around (E01, broadeningC, clampedEg) to find best least-squares match to B-spline
-          let bestTL = {
-            E0: E01,
-            C: broadeningC,
-            Eg: clampedEg,
-            epsInf: 1.8,
-            A: Math.max(15.0, peakEps2 * 40.0),
-            err: 1e9,
-          };
-          for (const dE0 of [-0.2, 0.0, 0.2]) {
-            for (const cScale of [0.75, 1.0, 1.25]) {
-              for (const dEg of [-0.15, 0.0, 0.15]) {
-                const testEg = Math.max(0.3, clampedEg + dEg);
-                const testE0 = Math.max(testEg + 0.2, E01 + dE0);
-                const testC = Math.max(0.2, broadeningC * cScale);
-                const m = matchEpsInfAndAmplitude({ E0: testE0, C: testC, Eg: testEg }, 'A');
-                if (m.fitError < bestTL.err) {
-                  bestTL = { E0: testE0, C: testC, Eg: testEg, epsInf: m.epsInf, A: m.A, err: m.fitError };
-                }
-              }
-            }
-          }
-
-          setParam('eps_inf', bestTL.epsInf, true);
-          setParam('Eg', bestTL.Eg, true);
-          setParam('E0', bestTL.E0, true);
-          setParam('C', bestTL.C, true);
-          setParam('A', bestTL.A, true);
-
-          if (peak2Eps2 > 0.15 * peakEps2) {
-            setParam('A2', Math.max(10.0, peak2Eps2 * 40.0), true);
-            setParam('E02', Math.max(bestTL.Eg + 0.4, Math.min(14.0, peak2EnergyEv)), true);
-            setParam('C2', Math.max(0.3, bestTL.C * 1.1), true);
-          } else {
-            setParam('A2', 0.0, false);
-            setParam('E02', Math.min(14.0, bestTL.E0 + 1.2), false);
-            setParam('C2', 1.8, false);
-          }
-
-          if (peak3Eps2 > 0.15 * peakEps2) {
-            setParam('A3', Math.max(10.0, peak3Eps2 * 35.0), true);
-            setParam('E03', Math.max(bestTL.Eg + 0.4, Math.min(14.5, peak3EnergyEv)), true);
-            setParam('C3', Math.max(0.3, bestTL.C * 1.2), true);
-          } else {
-            setParam('A3', 0.0, false);
-            setParam('E03', Math.min(14.5, peak2EnergyEv + 1.0), false);
-            setParam('C3', 2.0, false);
-          }
-        }
-        break;
-      }
-
+    const sorted=[...bsplineSpectrum].sort((a,b)=>a.wavelength-b.wavelength);
+    const spectralData=sorted.map(p=>({...p,eps1:p.n*p.n-p.k*p.k}));
+    const longWlPoints=spectralData.slice(-Math.max(1,Math.floor(spectralData.length*.15)));
+    const shortWlPoints=spectralData.slice(0,Math.max(1,Math.floor(spectralData.length*.15)));
+    const avgLongN=longWlPoints.reduce((s,p)=>s+p.n,0)/longWlPoints.length;
+    const avgShortEps1=shortWlPoints.reduce((s,p)=>s+p.eps1,0)/shortWlPoints.length;
+    const setParam=(key:string,value:number,fit=true)=>{const p=params[key];if(p){p.current=Math.max(p.min,Math.min(p.max,value));p.initial=p.current;p.fit=fit;}};
+    switch(modelId) {
       case 'drude': {
@@ -612,22 +228,2 @@ class ModelRegistry {

-      case 'multi_oscillator': {
-        const e0Init = isTransparentDielectric ? Math.max(8.5, maxEnergyEv + 2.5) : Math.max(1.2, Math.min(8.0, peakEnergyEv));
-        const w1Init = isTransparentDielectric ? 0.05 : Math.max(0.2, fwhm);
-        const matched = matchEpsInfAndAmplitude({ E01: e0Init, w1: w1Init }, 'A1');
-        setParam('eps_inf', matched.epsInf, true);
-        setParam('A1', Math.max(0.5, matched.A), true);
-        setParam('E01', e0Init, true);
-        setParam('w1', w1Init, true);
-
-        let osc2Energy = e0Init > 5.0 ? 4.2 : 5.5;
-        setParam('A2', isTransparentDielectric ? 0.1 : Math.max(0.1, peakEps2 * 0.4), !isTransparentDielectric);
-        setParam('E02', osc2Energy, !isTransparentDielectric);
-        setParam('w2', 0.6, !isTransparentDielectric);
-
-        setParam('A3', 0.0, false);
-        setParam('E03', 6.5, false);
-        setParam('w3', 0.8, false);
-        break;
-      }
-
       default:
diff --git a/src/models/bspline.ts b/src/models/bspline.ts
index 2b61b7f..d40a633 100644
--- a/src/models/bspline.ts
+++ b/src/models/bspline.ts
@@ -34,3 +34,3 @@ export function generateAdaptiveKnots(
     const wl = minW + (i / (count - 1)) * (maxW - minW);
-    knots.push(Number(wl.toFixed(1)));
+    knots.push(wl);
   }
diff --git a/src/models/peakInitialization.ts b/src/models/peakInitialization.ts
index eef3722..0619a35 100644
--- a/src/models/peakInitialization.ts
+++ b/src/models/peakInitialization.ts
@@ -53,5 +53,3 @@ export function initializeDetectedPeaks(modelId:string,spectrum:{wavelength:numb
   const info=detectEpsilonPeaks(data,capacity),result=structuredClone(params);
-  const transparent=Math.max(...data.map(p=>p.k))<.035&&Math.max(...data.map(p=>p.eps2))<.18;
-  if(!supported||transparent||(!info.peaksDetected&&!info.edgePeak))
-    return {parameters:result,initialization:{...info,oscillatorsUsed:1,method:transparent?'transparent-legacy-fallback':'single-legacy-fallback'},useLegacyFallback:true};
+  if(!supported)return {parameters:result,initialization:{...info,method:'model-specific-fallback'},useLegacyFallback:true};
   const lo=data[0].energy,hi=data.at(-1)!.energy,range=hi-lo;
@@ -60,2 +58,9 @@ export function initializeDetectedPeaks(modelId:string,spectrum:{wavelength:numb
     height:Math.max(...data.map(p=>p.eps2)),prominence:0,width:.15*range,edgePeak:true});
+  if(!peaks.length) {
+    const maximumPoint=data.reduce((a,b)=>b.eps2>a.eps2?b:a);
+    const flat=Math.max(...data.map(p=>p.eps2))-Math.min(...data.map(p=>p.eps2))<1e-12;
+    peaks.push({energy:flat?(lo+hi)/2:clamp(maximumPoint.energy,lo+.1*range,hi-.1*range),
+      height:Math.max(1e-3,maximumPoint.eps2),prominence:0,width:.15*range,edgePeak:false});
+    info.method='single-inband-fallback';
+  }
   const set=(key:string,value:number,fit=true)=>{const p=result[key];if(p){p.current=clamp(value,p.min,p.max);p.initial=p.current;p.fit=fit;}};
```

## 原始輸出：stage4_1-verify.log

```text
$ node scripts/check.mjs
typecheck: 0

worker-tests: 0
{
  "total": 8,
  "passed": 8,
  "failures": []
}

build: 0
vite v8.3.4 building client environment for production...
transforming...
[33m[INEFFECTIVE_DYNAMIC_IMPORT] [0msrc/data/defaultProjects.ts is dynamically imported by src/tests/unitTests.ts but also statically imported by src/tests/unitTests.ts, dynamic import will not move module into another chunk.

✓ 1710 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/defaultProjects-DnUZnnrX.js       0.06 kB
dist/version.json                             0.15 kB │ gzip:   0.13 kB
dist/index.html                               1.05 kB │ gzip:   0.49 kB
dist/assets/transferMatrix-Bdb_DGJd.js        3.55 kB
dist/assets/unitTests-BhbGavWn.js            27.41 kB
dist/assets/calculator-B4e57Zii.js           46.09 kB
dist/assets/compute.worker-DDXu2-CK.js       74.37 kB
dist/assets/index-BAEr4TzS.css               57.01 kB │ gzip:  10.27 kB
dist/assets/ExpertFittingPanel-YYhHTveq.js   26.17 kB │ gzip:   7.51 kB
dist/assets/index-BShFvLv7.js               454.17 kB │ gzip: 129.50 kB

✓ built in 4.59s

original-tests: 0
{
  "total": 29,
  "passed": 29,
  "failures": []
}

scientific-tests: 1
flag":""}],"warnings":["共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。"],"coefficientBounds":[{"id":"K0","value":0.002737549571817719,"min":0,"max":1.2023939079414996,"boundaryHit":false},{"id":"K1","value":0.003991526478050609,"min":0,"max":1.204137864716944,"boundaryHit":false},{"id":"K2","value":0.0027388107591919007,"min":0,"max":1.2047239852520304,"boundaryHit":false},{"id":"K3","value":0.003665955341124847,"min":0,"max":1.2051486241769207,"boundaryHit":false},{"id":"K4","value":0.004714381247151872,"min":0,"max":1.2062026415193825,"boundaryHit":false},{"id":"K5","value":0.004930355558236112,"min":0,"max":1.2074155410193235,"boundaryHit":false},{"id":"K6","value":0.005893722276134243,"min":0,"max":1.2084270108291288,"boundaryHit":false},{"id":"K7","value":0.0060840940415906675,"min":0,"max":1.2097920978132626,"boundaryHit":false},{"id":"K8","value":0.006698070786915626,"min":0,"max":1.210903110382022,"boundaryHit":false},{"id":"K9","value":0.006630139335474492,"min":0,"max":1.2109742653342945,"boundaryHit":false},{"id":"K10","value":0.006411875593084875,"min":0,"max":1.2106360408173793,"boundaryHit":false},{"id":"K11","value":0.0066289789053699776,"min":0,"max":1.2107497476056286,"boundaryHit":false}]}
STAGE4_1_regression [{"file":"stage3-before.json","oldThickness":99.99715906148896,"newThickness":99.99715991449385,"deltaThickness":8.530048916099986e-7,"oldRawMse":0.009153355272130782,"newRawMse":0.009153358917018344,"deltaRawMse":3.6448875619099486e-9,"oldConverged":true,"newConverged":true,"oldMedianMs":7073.2503,"newElapsedMs":7186.911699999997},{"file":"stage4-after.json","oldThickness":99.99715991446588,"newThickness":99.99715991449385,"deltaThickness":2.7966962079517543e-11,"oldRawMse":0.009153357823814337,"newRawMse":0.009153358917018344,"deltaRawMse":1.0932040064859372e-9,"oldConverged":true,"newConverged":true,"oldMedianMs":6627.6074,"newElapsedMs":7186.911699999997},{"file":"stage4_1-before.json","oldThickness":99.99715991446588,"newThickness":99.99715991449385,"deltaThickness":2.7966962079517543e-11,"oldRawMse":0.009153357823814337,"newRawMse":0.009153358917018344,"deltaRawMse":1.0932040064859372e-9,"oldConverged":true,"newConverged":true,"oldMedianMs":6770.475600000002,"newElapsedMs":7186.911699999997}]
{
  "total": 73,
  "passed": 72,
  "failures": [
    {
      "name": "Stage4.1: Automatic transparent k and propagated uncertainty",
      "passed": false,
      "detail": "AssertionError [ERR_ASSERTION]: high wavelength detection flags"
    }
  ]
}

[ELIFECYCLE] Command failed with exit code 1.
```

## 原始輸出：stage4_1-build.log

```text
$ vite build
vite v8.3.4 building client environment for production...
transforming...
[INEFFECTIVE_DYNAMIC_IMPORT] src/data/defaultProjects.ts is dynamically imported by src/tests/unitTests.ts but also statically imported by src/tests/unitTests.ts, dynamic import will not move module into another chunk.

✓ 1710 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/defaultProjects-CchwlZSQ.js       0.06 kB
dist/version.json                             0.15 kB │ gzip:   0.14 kB
dist/index.html                               1.05 kB │ gzip:   0.49 kB
dist/assets/transferMatrix-Bdb_DGJd.js        3.55 kB
dist/assets/unitTests-D80v3S6d.js            27.41 kB
dist/assets/calculator-B4e57Zii.js           46.09 kB
dist/assets/compute.worker-CrlRVV1Z.js       74.37 kB
dist/assets/index-BAEr4TzS.css               57.01 kB │ gzip:  10.27 kB
dist/assets/ExpertFittingPanel-0jUL4VpC.js   26.17 kB │ gzip:   7.51 kB
dist/assets/index-Cxcceemo.js               454.17 kB │ gzip: 129.50 kB

✓ built in 3.15s
```

## 原始輸出：stage4_1-original.log

```text
{
  "total": 29,
  "passed": 29,
  "failures": []
}
```

## 原始輸出：stage4_1-scientific.log

```text
STAGE3_MONTE_CARLO {"seed":"0x12345678","runs":100,"sampleSd":0.00047851632932011725,"meanStdError":0.0005003205241958783,"ratio":0.9564195474275116,"coverage":0.96,"converged":1}
STAGE3_ULTRATHIN {"r":-0.9999993522743537,"conditionNumber":1757.1926617893112,"conditionLevel":"severe"}
STAGE3_AUTOMATIC {"thickness":99.99715991449385,"rawMse":0.009153358917018344,"converged":true,"reason":"cost","statisticsMs":24.292100000002392}
STAGE4_TL_ERROR_TABLE [{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":0.5,"analytic":7.32315238912251,"numeric":7.323152389122485,"absolute":2.4868995751603507e-14,"relative":3.395941314636974e-15},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":1,"analytic":7.824389589405284,"numeric":7.824389588190784,"absolute":1.2144996119900497e-9,"relative":1.5521972651043257e-10},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":2,"analytic":11.3974216539932,"numeric":11.397421653994309,"absolute":1.1084466677857563e-12,"relative":9.725415988249352e-14},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":3,"analytic":16.0141151804874,"numeric":16.014115180479614,"absolute":7.787548383930698e-12,"relative":4.862927671098133e-13},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":3.5,"analytic":5.781022921186867,"numeric":5.781022921191245,"absolute":4.377831430701917e-12,"relative":7.572762624161704e-13},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":4.5,"analytic":-7.077612607394961,"numeric":-7.077612607398611,"absolute":3.6495251265478146e-12,"relative":5.15643526848696e-13},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":6,"analytic":-4.35164162303161,"numeric":-4.351641623034544,"absolute":2.9336533202695136e-12,"relative":6.741486488089476e-13},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":1.5,"analytic":8.946782911613914,"numeric":8.946782908094079,"absolute":3.5198350900600417e-9,"relative":3.9341907881498685e-10},{"A":100,"E0":3.5,"C":1.5,"Eg":1.5,"E":1.5000000001,"analytic":8.946782911613914,"numeric":8.946782908446528,"absolute":3.1673863531977986e-9,"relative":3.5402517146219286e-10},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":0.5,"analytic":2.820632251124173,"numeric":2.820632251124127,"absolute":4.574118861455645e-14,"relative":1.621664383803556e-14},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":1,"analytic":3.109415843158698,"numeric":3.10941584226512,"absolute":8.935776563134823e-10,"relative":2.8737798404684807e-10},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":2,"analytic":5.12632831456187,"numeric":5.126328314562788,"absolute":9.183764859699295e-13,"relative":1.791489794676281e-13},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":3,"analytic":1.3990752877701986,"numeric":1.3990752877827648,"absolute":1.2566170326522297e-11,"relative":8.981768483979865e-12},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":3.5,"analytic":-6.798123664528373,"numeric":-6.798123664548034,"absolute":1.9660717498481972e-11,"relative":2.8920800015763016e-12},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":4.5,"analytic":-2.3369594017541413,"numeric":-2.3369594017546538,"absolute":5.124789481669723e-13,"relative":2.192930471030814e-13},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":6,"analytic":-1.0058560725709405,"numeric":-1.005856072571263,"absolute":3.226308109560705e-13,"relative":3.2075246126548855e-13},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":1,"analytic":3.109415843158698,"numeric":3.10941584226512,"absolute":8.935776563134823e-10,"relative":2.8737798404684807e-10},{"A":20,"E0":3,"C":0.4,"Eg":1,"E":1.0000000001,"analytic":3.109415843158698,"numeric":3.1094158423545517,"absolute":8.04146083055457e-10,"relative":2.5861644882034536e-10},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":0.5,"analytic":2.6381695569108614,"numeric":2.6381695569080907,"absolute":2.7706725802545407e-12,"relative":1.0502253628844623e-12},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":1,"analytic":2.7553743683909433,"numeric":2.7553743683909286,"absolute":1.4654943925052066e-14,"relative":5.3186761454887875e-15},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":2,"analytic":3.4553819199250904,"numeric":3.4553819184496684,"absolute":1.4754220067914048e-9,"relative":4.2699245455720414e-10},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":3,"analytic":5.280562941402943,"numeric":5.280562941402769,"absolute":1.7408297026122455e-13,"relative":3.2966744681009297e-14},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":3.5,"analytic":4.986902885805945,"numeric":4.986902885803256,"absolute":2.688516076432279e-12,"relative":5.391153864427483e-13},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":4.5,"analytic":0.32212905975112793,"numeric":0.322129059756288,"absolute":5.1600945738528026e-12,"relative":1.6018718018662322e-11},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":6,"analytic":-1.6353202981525552,"numeric":-1.6353202981535093,"absolute":9.541256673628595e-13,"relative":5.83448801094313e-13},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":2,"analytic":3.4553819199250904,"numeric":3.4553819184496684,"absolute":1.4754220067914048e-9,"relative":4.2699245455720414e-10},{"A":60,"E0":4,"C":2.5,"Eg":2,"E":2.0000000001,"analytic":3.4553819199250904,"numeric":3.4553819185976176,"absolute":1.3274727983514367e-9,"relative":3.841754195698858e-10}]
STAGE4_PEAK_DETECTION {"results":[{"centers":[2,4],"noise":0,"peaksDetected":2,"peaks":[{"energy":3.995,"height":2.4424892628013093,"prominence":2.4424892628013093,"width":0.379056655830587,"edgePeak":false},{"energy":2,"height":1.9549210619870439,"prominence":1.9549210619870439,"width":0.37896748898432353,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},{"centers":[2,4],"noise":0.025,"peaksDetected":2,"peaks":[{"energy":3.995,"height":2.4525590931675167,"prominence":2.4491739209713845,"width":0.37981190038924106,"edgePeak":false},{"energy":2,"height":1.9605069765920207,"prominence":1.956707409745779,"width":0.3765021626077647,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},{"centers":[1.5,3,5],"noise":0,"peaksDetected":3,"peaks":[{"energy":5,"height":2.932381592980565,"prominence":2.932381592980565,"width":0.3789674889843244,"edgePeak":false},{"energy":3.005,"height":2.4424892628013084,"prominence":2.4424892628013084,"width":0.3790566558305013,"edgePeak":false},{"energy":1.505,"height":1.9539914102410476,"prominence":1.9539914102410476,"width":0.3790566558304438,"edgePeak":false}],"oscillatorsUsed":3,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},{"centers":[1.5,3,5],"noise":0.025,"peaksDetected":3,"peaks":[{"energy":5,"height":2.9268120457661624,"prominence":2.9241655739235446,"width":0.37977792817489053,"edgePeak":false},{"energy":3.005,"height":2.4600669766653596,"prominence":2.455177992771073,"width":0.3757027624745328,"edgePeak":false},{"energy":1.505,"height":1.952910177851582,"prominence":1.9495320738049535,"width":0.37936498981701616,"edgePeak":false}],"oscillatorsUsed":3,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"}],"edge":{"peaksDetected":0,"peaks":[],"oscillatorsUsed":1,"edgePeak":true,"method":"epsilon2-Savitzky-Golay"}}
STAGE4_MODEL_INITIALIZATION {"table":[{"modelId":"gaussian","initialization":{"peaksDetected":2,"peaks":[{"energy":3.994999999999999,"height":2.955616321461338,"prominence":2.955616321461338,"width":0.42556990442681286,"edgePeak":false},{"energy":1.9999999999999998,"height":1.9549210619870427,"prominence":1.9549210619870427,"width":0.37896748898432375,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},"parameters":{"eps_inf":2.4195030440167784,"A":2.955616321461338,"E0":3.994999999999999,"sigma":0.25558077435607635,"A2":1.9549210619870427,"E02":1.9999999999999998,"sigma2":0.22759317161030168,"A3":0,"E03":5.8,"sigma3":0.7}},{"modelId":"lorentz","initialization":{"peaksDetected":2,"peaks":[{"energy":3.994999999999999,"height":2.955616321461338,"prominence":2.955616321461338,"width":0.42556990442681286,"edgePeak":false},{"energy":1.9999999999999998,"height":1.9549210619870427,"prominence":1.9549210619870427,"width":0.37896748898432375,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},"parameters":{"eps_inf":2.1712217387157833,"A":1.2578213554466298,"E0":3.994999999999999,"gamma":0.42556990442681286,"A2":0.7408515260237972,"E02":1.9999999999999998,"gamma2":0.37896748898432375,"A3":0,"E03":5.8,"gamma3":0.6}},{"modelId":"tauc_lorentz","initialization":{"peaksDetected":2,"peaks":[{"energy":3.994999999999999,"height":2.955616321461338,"prominence":2.955616321461338,"width":0.42556990442681286,"edgePeak":false},{"energy":1.9999999999999998,"height":1.9549210619870427,"prominence":1.9549210619870427,"width":0.37896748898432375,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},"parameters":{"eps_inf":2.162550244185431,"A":3.485218798344114,"E0":3.994999999999999,"C":0.42556990442681286,"Eg":1.595,"A2":18.06679533056054,"E02":1.9999999999999998,"C2":0.37896748898432375,"A3":0,"E03":5.8,"C3":2}},{"modelId":"multi_oscillator","initialization":{"peaksDetected":2,"peaks":[{"energy":3.994999999999999,"height":2.955616321461338,"prominence":2.955616321461338,"width":0.42556990442681286,"edgePeak":false},{"energy":1.9999999999999998,"height":1.9549210619870427,"prominence":1.9549210619870427,"width":0.37896748898432375,"edgePeak":false}],"oscillatorsUsed":2,"edgePeak":false,"method":"epsilon2-Savitzky-Golay"},"parameters":{"eps_inf":1.4195030440167782,"A1":2.955616321461338,"E01":3.994999999999999,"w1":0.25558077435607635,"Eg1":2.5,"A2":1.9549210619870427,"E02":1.9999999999999998,"w2":0.22759317161030168,"A3":0,"E03":2.4,"w3":0.7}}],"edgeSeed":7.399999999999999,"edge":{"peaksDetected":0,"peaks":[{"energy":7.399999999999999,"height":4.500000000000001,"prominence":0,"width":0.8999999999999998,"edgePeak":true}],"oscillatorsUsed":1,"edgePeak":true,"method":"epsilon2-Savitzky-Golay"}}
STAGE4_C_ISOLATION {"thicknessRelative":0,"mseRelative":0,"interleaved":"bit-identical","sequential":"bit-identical"}
STAGE4_KK_BASIS {"table":[{"E":0.6,"analyticBasis":1.7456367719011299,"numeric":1.745636771901498,"relative":2.108972272420002e-13},{"E":0.8761904761904762,"analyticBasis":1.2251473723673278,"numeric":1.2251473723683777,"relative":8.56898456269868e-13},{"E":1.1523809523809523,"analyticBasis":1.1926900529145112,"numeric":1.1926900529124982,"relative":1.6878286050382797e-12},{"E":1.4285714285714284,"analyticBasis":0.6931639554865665,"numeric":0.6931639554905752,"relative":5.7831660796282674e-12},{"E":1.704761904761905,"analyticBasis":0.33816054126925366,"numeric":0.3381605412630337,"relative":1.8393538646110364e-11},{"E":1.980952380952381,"analyticBasis":0.1108037974884577,"numeric":0.11080379749887195,"relative":9.398822990315828e-11},{"E":2.257142857142857,"analyticBasis":0.49202408324892,"numeric":0.49202408323541785,"relative":2.7442038525118675e-11},{"E":2.533333333333333,"analyticBasis":0.5670087259465584,"numeric":0.5670087259628188,"relative":2.8677578838581703e-11},{"E":2.8095238095238098,"analyticBasis":0.7612670799022827,"numeric":0.7612670798823071,"relative":2.623990617242232e-11},{"E":3.0857142857142854,"analyticBasis":0.6922331670841824,"numeric":0.6922331671122339,"relative":4.052328378169995e-11},{"E":3.361904761904762,"analyticBasis":0.9805264325433902,"numeric":0.9805264325300793,"relative":1.357526680549993e-11},{"E":3.638095238095238,"analyticBasis":0.5777498255503466,"numeric":0.5777498255636965,"relative":2.310667380397743e-11},{"E":3.914285714285714,"analyticBasis":0.5277192124357897,"numeric":0.527719212404979,"relative":5.838462313012753e-11},{"E":4.19047619047619,"analyticBasis":0.2099771564289541,"numeric":0.20997715645661796,"relative":1.3174705125369355e-10},{"E":4.466666666666667,"analyticBasis":-0.2686451610833289,"numeric":-0.26864516106598796,"relative":6.454969049459051e-11},{"E":4.742857142857143,"analyticBasis":-0.3356281386887836,"numeric":-0.33562813871889474,"relative":8.971576674682715e-11},{"E":5.019047619047619,"analyticBasis":-0.7717358514333417,"numeric":-0.7717358513873879,"relative":5.954601725598046e-11},{"E":5.295238095238094,"analyticBasis":-0.6021730601271662,"numeric":-0.6021730601731811,"relative":7.641467483931111e-11},{"E":5.57142857142857,"analyticBasis":-0.5006269373338972,"numeric":-0.5006269373100593,"relative":4.761615856453664e-11},{"E":5.847619047619047,"analyticBasis":-0.25690829312621544,"numeric":-0.25690829308693897,"relative":1.5288128885421105e-10},{"E":6.123809523809523,"analyticBasis":-0.15402193780775675,"numeric":-0.15402193784234544,"relative":2.245699119580579e-10},{"E":6.3999999999999995,"analyticBasis":-1.2589362591858024,"numeric":-1.2589362592202054,"relative":2.732697918684065e-11}],"maximumJacobianError":3.7427379979159517e-10,"cache":{"entries":31,"integrations":31}}
STAGE4_TL_SPLINE_PROJECTION {"table":[{"E":1,"truth":9.624389589405284,"fit":9.516325624905237,"deviation":-0.1080639645000474},{"E":1.25,"truth":10.06983306888517,"fit":9.97054275853232,"deviation":-0.09929031035285085},{"E":1.5,"truth":10.746782911613915,"fit":10.663954513636526,"deviation":-0.08282839797738895},{"E":1.75,"truth":11.835796579651332,"fit":11.729414660277635,"deviation":-0.10638191937369612},{"E":2,"truth":13.197421653993201,"fit":13.129457180322023,"deviation":-0.06796447367117864},{"E":2.25,"truth":14.7756708290359,"fit":14.707093065466218,"deviation":-0.0685777635696816},{"E":2.5,"truth":16.460893600942995,"fit":16.41476473140129,"deviation":-0.04612886954170392},{"E":2.75,"truth":17.846540977001908,"fit":17.81076093247555,"deviation":-0.03578004452635852},{"E":3,"truth":17.814115180487402,"fit":17.79399717833943,"deviation":-0.02011800214797077},{"E":3.25,"truth":14.494613534795583,"fit":14.512172876990343,"deviation":0.017559342194759964},{"E":3.5,"truth":7.581022921186867,"fit":7.606464787807497,"deviation":0.025441866620630194},{"E":3.75,"truth":0.6080661789491579,"fit":0.6507967467965534,"deviation":0.042730567847395484},{"E":4,"truth":-3.486406861813161,"fit":-3.40077961922933,"deviation":0.08562724258383092},{"E":4.25,"truth":-5.04388353815786,"fit":-4.94307566833783,"deviation":0.10080786982002987},{"E":4.5,"truth":-5.277612607394961,"fit":-5.136259231787584,"deviation":0.1413533756073777},{"E":4.75,"truth":-4.963325709946118,"fit":-4.815119421606822,"deviation":0.1482062883392965},{"E":5,"truth":-4.463886357638243,"fit":-4.247184841815927,"deviation":0.216701515822316},{"E":5.25,"truth":-3.9312512154642922,"fit":-3.762853427735132,"deviation":0.16839778772916025},{"E":5.5,"truth":-3.424456204957724,"fit":-3.109998768787637,"deviation":0.3144574361700867}],"maxDeviation":0.3144574361700867,"uvAmplitude":15.964982545063206,"epsilonInf":0.43848948295625917}
STAGE4_KK_SYNTHETIC_FIT {"thickness":100.06905571093064,"error":0.06905571093064111,"converged":true,"status":"cost","mseWoollam":2.6998665687437247}
STAGE4_CORRELATION_LEVEL {"r":-0.9999882030599727,"kappa":411.74566096125557,"previousLevel":"ok","level":"severe","warnings":["物理參數高度相關：d ↔ A，r=-0.99998820 (severe)。","統計警告等級：severe（綜合欄正規化條件數與物理參數相關性）。"]}
STAGE4_1_absorbing {"elapsedMs":10657.164700000001,"thickness":100.07111116343209,"converged":true,"comparison":{"freeForm":{"mseWoollam":5.343663943059108,"rawMse":0.024212043635196762,"effectiveParameters":25,"aic":-1557.431002655972,"bic":-1455.7203629498692},"physical":{"mseWoollam":24.801367381375456,"rawMse":0.5433452445209256,"effectiveParameters":8,"aic":-247.52447191650668,"bic":-214.9770672105538},"significantFreeFormMaxK":0.36319455479264057,"physicalMaxK":0.4316572484590792},"table":[{"wavelength":200,"trueK":0.32,"fittedK":0.3088385189626567,"sigmaK":0.0005537532075018222,"flag":""},{"wavelength":250,"trueK":0.13107200000000002,"fittedK":0.1304980669401622,"sigmaK":0.00023104173685303594,"flag":""},{"wavelength":300,"trueK":0.06320987654320986,"fittedK":0.060237550274889654,"sigmaK":0.0002255167766389245,"flag":""},{"wavelength":350,"trueK":0.03411911703456892,"fittedK":0.03531417820296492,"sigmaK":0.00021165796279145778,"flag":""},{"wavelength":400,"trueK":0.02,"fittedK":0.024200284754776546,"sigmaK":0.0003557344012054725,"flag":""},{"wavelength":450,"trueK":0.01248590153939948,"fittedK":0.019434923193922978,"sigmaK":0.00037285136119637164,"flag":""},{"wavelength":500,"trueK":0.008192000000000001,"fittedK":0.017056273522188817,"sigmaK":0.0004527163325448297,"flag":""},{"wavelength":550,"trueK":0.0055952462263506595,"fittedK":0.01697563619869163,"sigmaK":0.0005845796219483493,"flag":""},{"wavelength":600,"trueK":0.0039506172839506165,"fittedK":0.017369552135649682,"sigmaK":0.0006978223536401907,"flag":""},{"wavelength":650,"trueK":0.002868246910122195,"fittedK":0.017508752778105378,"sigmaK":0.0007948008335284083,"flag":""},{"wavelength":700,"trueK":0.0021324448146605576,"fittedK":0.018283405629930607,"sigmaK":0.0009231655132936699,"flag":""},{"wavelength":750,"trueK":0.0016181728395061729,"fittedK":0.018187015437199642,"sigmaK":0.000977079602111596,"flag":""},{"wavelength":800,"trueK":0.00125,"fittedK":0.0177142103049964,"sigmaK":0.0010451779353000017,"flag":""},{"wavelength":850,"trueK":0.0009808311682091928,"fittedK":0.017459041774838126,"sigmaK":0.001168399142210824,"flag":""},{"wavelength":900,"trueK":0.0007803688462124675,"fittedK":0.017360734921592878,"sigmaK":0.00196672188212857,"flag":""}],"warnings":["共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。"],"coefficientBounds":[{"id":"K0","value":0.36319455479264057,"min":0,"max":1.555139228603098,"boundaryHit":false},{"id":"K1","value":0.11365948800439091,"min":0,"max":1.3266319139787095,"boundaryHit":false},{"id":"K2","value":0.04941168134659079,"min":0,"max":1.2423224132994275,"boundaryHit":false},{"id":"K3","value":0.0246985873303069,"min":0,"max":1.2289479151296931,"boundaryHit":false},{"id":"K4","value":0.019154789935247822,"min":0,"max":1.2226056811810337,"boundaryHit":false},{"id":"K5","value":0.016019452917560486,"min":0,"max":1.2170508263791482,"boundaryHit":false},{"id":"K6","value":0.017702270652729217,"min":0,"max":1.2188226863319618,"boundaryHit":false},{"id":"K7","value":0.017011968348084414,"min":0,"max":1.219280148660201,"boundaryHit":false},{"id":"K8","value":0.018783131442078996,"min":0,"max":1.2183071743249907,"boundaryHit":false},{"id":"K9","value":0.01758941347107091,"min":0,"max":1.2193484187484558,"boundaryHit":false},{"id":"K10","value":0.017400652211582646,"min":0,"max":1.2200895934437197,"boundaryHit":false},{"id":"K11","value":0.017360734921592878,"min":0,"max":1.217272476434308,"boundaryHit":false}]}
STAGE4_1_transparent {"elapsedMs":11405.710899999998,"thickness":100.13311262628386,"converged":false,"comparison":{"freeForm":{"mseWoollam":2.195070804640947,"rawMse":0.004105623661440216,"effectiveParameters":23,"aic":-2328.0117719904606,"bic":-2234.437983460846},"physical":{"mseWoollam":57.93462986434299,"rawMse":2.9928090259539295,"effectiveParameters":4,"aic":481.5637654126527,"bic":497.8374677656291},"significantFreeFormMaxK":0.0035835827478123126,"physicalMaxK":0,"warning":"物理模型在資料範圍內 k 偏低，與自由形式曲線差異如下：顯著自由形式 max k=0.0035835827，物理 max k=0.0000000（差異 > 2σ_k）。"},"table":[{"wavelength":200,"trueK":0,"fittedK":0.00013864311672775017,"sigmaK":0.000021111999225317233,"flag":""},{"wavelength":250,"trueK":0,"fittedK":0.0003774707193317536,"sigmaK":0.00005586359519083953,"flag":""},{"wavelength":300,"trueK":0,"fittedK":0.0002750327942219006,"sigmaK":0.00004598891448021633,"flag":""},{"wavelength":350,"trueK":0,"fittedK":0.0003761359362175854,"sigmaK":0.00010105415105678947,"flag":""},{"wavelength":400,"trueK":0,"fittedK":0.0009069087857244344,"sigmaK":0.00011801082318842928,"flag":""},{"wavelength":450,"trueK":0,"fittedK":0.0015699480302307522,"sigmaK":0.00013793311372818382,"flag":""},{"wavelength":500,"trueK":0,"fittedK":0.0019095207960690191,"sigmaK":0.00015459644755629962,"flag":""},{"wavelength":550,"trueK":0,"fittedK":0.0024228714330520344,"sigmaK":0.00019937199528357848,"flag":""},{"wavelength":600,"trueK":0,"fittedK":0.0028705115144803364,"sigmaK":0.00024048022527867587,"flag":""},{"wavelength":650,"trueK":0,"fittedK":0.0031305050860280332,"sigmaK":0.0002703912002154482,"flag":""},{"wavelength":700,"trueK":0,"fittedK":0.003486380248796671,"sigmaK":0.0003301712349852744,"flag":""},{"wavelength":750,"trueK":0,"fittedK":0.003578637709954132,"sigmaK":0.00035317610110575226,"flag":""},{"wavelength":800,"trueK":0,"fittedK":0.0034916618783108187,"sigmaK":0.000384859657308967,"flag":""},{"wavelength":850,"trueK":0,"fittedK":0.003433721231674128,"sigmaK":0.0004440399669266611,"flag":""},{"wavelength":900,"trueK":0,"fittedK":0.0035465482081839103,"sigmaK":0.0008026699670005805,"flag":""}],"warnings":["其餘參數的不確定度為條件於該參數固定在邊界。","共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。"],"coefficientBounds":[{"id":"K0","value":0,"min":0,"max":1.200000000001,"boundaryHit":true},{"id":"K1","value":0.0006812905508092681,"min":0,"max":1.2010766611854897,"boundaryHit":false},{"id":"K2","value":0,"min":0,"max":1.2017059006169786,"boundaryHit":true},{"id":"K3","value":0.000567058343959179,"min":0,"max":1.2024146309711516,"boundaryHit":false},{"id":"K4","value":0.0017195004635745784,"min":0,"max":1.2036085102049432,"boundaryHit":false},{"id":"K5","value":0.0018671147095823517,"min":0,"max":1.2049491380096449,"boundaryHit":false},{"id":"K6","value":0.002858871247117733,"min":0,"max":1.2061823977481037,"boundaryHit":false},{"id":"K7","value":0.0029918681677758305,"min":0,"max":1.2076126644753886,"boundaryHit":false},{"id":"K8","value":0.003638124794344212,"min":0,"max":1.20870889787041,"boundaryHit":false},{"id":"K9","value":0.0035374002168983773,"min":0,"max":1.2088602741847676,"boundaryHit":false},{"id":"K10","value":0.003335855951814342,"min":0,"max":1.2085849254547736,"boundaryHit":false},{"id":"K11","value":0.0035465482081839103,"min":0,"max":1.2085848730282616,"boundaryHit":false}]}
STAGE4_1_weak {"elapsedMs":10679.617400000003,"thickness":99.38293800226785,"converged":false,"comparison":{"freeForm":{"mseWoollam":2.1886039701069513,"rawMse":0.004061510096985291,"effectiveParameters":25,"aic":-2328.678585523544,"bic":-2226.967945817441},"physical":{"mseWoollam":63.853084888457076,"rawMse":3.6355180010471484,"effectiveParameters":4,"aic":565.6046931697707,"bic":581.8783955227472},"significantFreeFormMaxK":0.006656855651803656,"physicalMaxK":0,"warning":"物理模型在資料範圍內 k 偏低，與自由形式曲線差異如下：顯著自由形式 max k=0.0066568557，物理 max k=0.0000000（差異 > 2σ_k）。"},"table":[{"wavelength":200,"trueK":0.003,"fittedK":0.002992731194597068,"sigmaK":0.00007912648924604633,"flag":""},{"wavelength":250,"trueK":0.003,"fittedK":0.0034288210274478577,"sigmaK":0.00006121763176651206,"flag":""},{"wavelength":300,"trueK":0.003,"fittedK":0.0032206939882152555,"sigmaK":0.00008999559891012703,"flag":""},{"wavelength":350,"trueK":0.003,"fittedK":0.003340680721488998,"sigmaK":0.00010055550711704934,"flag":""},{"wavelength":400,"trueK":0.003,"fittedK":0.003953969767026369,"sigmaK":0.000160361495163763,"flag":""},{"wavelength":450,"trueK":0.003,"fittedK":0.004593123381445175,"sigmaK":0.00015783042690896196,"flag":""},{"wavelength":500,"trueK":0.003,"fittedK":0.004951158946339023,"sigmaK":0.00018383016958673645,"flag":""},{"wavelength":550,"trueK":0.003,"fittedK":0.005471254268436022,"sigmaK":0.0002378302698507891,"flag":""},{"wavelength":600,"trueK":0.003,"fittedK":0.00592879999171598,"sigmaK":0.00028353836853850213,"flag":""},{"wavelength":650,"trueK":0.003,"fittedK":0.006208708476848585,"sigmaK":0.00031974013595617253,"flag":""},{"wavelength":700,"trueK":0.003,"fittedK":0.006556437217538044,"sigmaK":0.0003763725144107101,"flag":""},{"wavelength":750,"trueK":0.003,"fittedK":0.006654115014536445,"sigmaK":0.00039913762387023595,"flag":""},{"wavelength":800,"trueK":0.003,"fittedK":0.006574104004212238,"sigmaK":0.00042862550446584564,"flag":""},{"wavelength":850,"trueK":0.003,"fittedK":0.006514517189278139,"sigmaK":0.0004824651492605036,"flag":""},{"wavelength":900,"trueK":0.003,"fittedK":0.0066289789053699776,"sigmaK":0.0008254513934999806,"flag":""}],"warnings":["共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。"],"coefficientBounds":[{"id":"K0","value":0.002737549571817719,"min":0,"max":1.2023939079414996,"boundaryHit":false},{"id":"K1","value":0.003991526478050609,"min":0,"max":1.204137864716944,"boundaryHit":false},{"id":"K2","value":0.0027388107591919007,"min":0,"max":1.2047239852520304,"boundaryHit":false},{"id":"K3","value":0.003665955341124847,"min":0,"max":1.2051486241769207,"boundaryHit":false},{"id":"K4","value":0.004714381247151872,"min":0,"max":1.2062026415193825,"boundaryHit":false},{"id":"K5","value":0.004930355558236112,"min":0,"max":1.2074155410193235,"boundaryHit":false},{"id":"K6","value":0.005893722276134243,"min":0,"max":1.2084270108291288,"boundaryHit":false},{"id":"K7","value":0.0060840940415906675,"min":0,"max":1.2097920978132626,"boundaryHit":false},{"id":"K8","value":0.006698070786915626,"min":0,"max":1.210903110382022,"boundaryHit":false},{"id":"K9","value":0.006630139335474492,"min":0,"max":1.2109742653342945,"boundaryHit":false},{"id":"K10","value":0.006411875593084875,"min":0,"max":1.2106360408173793,"boundaryHit":false},{"id":"K11","value":0.0066289789053699776,"min":0,"max":1.2107497476056286,"boundaryHit":false}]}
STAGE4_1_regression [{"file":"stage3-before.json","oldThickness":99.99715906148896,"newThickness":99.99715991449385,"deltaThickness":8.530048916099986e-7,"oldRawMse":0.009153355272130782,"newRawMse":0.009153358917018344,"deltaRawMse":3.6448875619099486e-9,"oldConverged":true,"newConverged":true,"oldMedianMs":7073.2503,"newElapsedMs":7186.911699999997},{"file":"stage4-after.json","oldThickness":99.99715991446588,"newThickness":99.99715991449385,"deltaThickness":2.7966962079517543e-11,"oldRawMse":0.009153357823814337,"newRawMse":0.009153358917018344,"deltaRawMse":1.0932040064859372e-9,"oldConverged":true,"newConverged":true,"oldMedianMs":6627.6074,"newElapsedMs":7186.911699999997},{"file":"stage4_1-before.json","oldThickness":99.99715991446588,"newThickness":99.99715991449385,"deltaThickness":2.7966962079517543e-11,"oldRawMse":0.009153357823814337,"newRawMse":0.009153358917018344,"deltaRawMse":1.0932040064859372e-9,"oldConverged":true,"newConverged":true,"oldMedianMs":6770.475600000002,"newElapsedMs":7186.911699999997}]
{
  "total": 73,
  "passed": 72,
  "failures": [
    {
      "name": "Stage4.1: Automatic transparent k and propagated uncertainty",
      "passed": false,
      "detail": "AssertionError [ERR_ASSERTION]: high wavelength detection flags"
    }
  ]
}
```

## 原始輸出：stage4_1-worker.log

```text
{
  "total": 8,
  "passed": 8,
  "failures": []
}
```

## 原始輸出：stage4_1-diagnostics.log

```text
STAGE4_1_DIAGNOSTIC {"scenario":"absorbing","lambdaN":0.25,"lambdaK":0.6,"elapsedMs":11852.0835,"freeFormThickness":102.65933704202604,"physicalThickness":100.07111116343209,"physicalConverged":true,"knots":12,"comparison":{"freeForm":{"mseWoollam":5.343663943059108,"rawMse":0.024212043635196762,"effectiveParameters":25,"aic":-1557.431002655972,"bic":-1455.7203629498692},"physical":{"mseWoollam":24.801367381375456,"rawMse":0.5433452445209256,"effectiveParameters":8,"aic":-247.52447191650668,"bic":-214.9770672105538},"significantFreeFormMaxK":0.36319455479264057,"physicalMaxK":0.4316572484590792},"regularizedStatistics":{"available":true,"dof":407,"chiSquare":11621.780944894448,"reducedChiSquare":28.554744336349994,"conditionNumber":95.8039578709264,"conditionLevel":"ok","truncatedSingularValues":0,"freeParameters":25,"warnings":["共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。"]},"dataOnlyStatistics":{"available":true,"dof":407,"chiSquare":11621.780944894448,"reducedChiSquare":28.554744336349994,"conditionNumber":104.08157120311859,"conditionLevel":"ok","truncatedSingularValues":0,"freeParameters":25,"warnings":[]},"table":[{"wavelength":190,"trueK":0.392876052209544,"fittedK":0.36319455479264057,"nBias":-0.018302769124732388,"regularizedSigmaK":0.0008671218043844931,"regularizedFlag":"","dataOnlySigmaK":0.0009583095626330776,"dataOnlyFlag":""},{"wavelength":200,"trueK":0.32,"fittedK":0.3088385189626567,"nBias":-0.0219273423116797,"regularizedSigmaK":0.0005537532075018222,"regularizedFlag":"","dataOnlySigmaK":0.0006040321305296159,"dataOnlyFlag":""},{"wavelength":250,"trueK":0.13107200000000002,"fittedK":0.1304980669401622,"nBias":-0.033683024623493374,"regularizedSigmaK":0.00023104173685303594,"regularizedFlag":"","dataOnlySigmaK":0.00023718063397717412,"dataOnlyFlag":""},{"wavelength":300,"trueK":0.06320987654320986,"fittedK":0.060237550274889654,"nBias":-0.030147392174375343,"regularizedSigmaK":0.0002255167766389245,"regularizedFlag":"","dataOnlySigmaK":0.0002383717965194858,"dataOnlyFlag":""},{"wavelength":350,"trueK":0.03411911703456892,"fittedK":0.03531417820296492,"nBias":-0.0275641434667091,"regularizedSigmaK":0.00021165796279145778,"regularizedFlag":"","dataOnlySigmaK":0.0002133427204653147,"dataOnlyFlag":""},{"wavelength":400,"trueK":0.02,"fittedK":0.024200284754776546,"nBias":-0.027336315284116397,"regularizedSigmaK":0.0003557344012054725,"regularizedFlag":"","dataOnlySigmaK":0.0003859952901813488,"dataOnlyFlag":""},{"wavelength":450,"trueK":0.01248590153939948,"fittedK":0.019434923193922978,"nBias":-0.023786225870308764,"regularizedSigmaK":0.00037285136119637164,"regularizedFlag":"","dataOnlySigmaK":0.00039926069117874366,"dataOnlyFlag":""},{"wavelength":500,"trueK":0.008192000000000001,"fittedK":0.017056273522188817,"nBias":-0.023194802567961137,"regularizedSigmaK":0.0004527163325448297,"regularizedFlag":"","dataOnlySigmaK":0.000489922785201697,"dataOnlyFlag":""},{"wavelength":550,"trueK":0.0055952462263506595,"fittedK":0.01697563619869163,"nBias":-0.023678650486745,"regularizedSigmaK":0.0005845796219483493,"regularizedFlag":"","dataOnlySigmaK":0.0006325889077504468,"dataOnlyFlag":""},{"wavelength":600,"trueK":0.0039506172839506165,"fittedK":0.017369552135649682,"nBias":-0.023211299036594246,"regularizedSigmaK":0.0006978223536401907,"regularizedFlag":"","dataOnlySigmaK":0.0007529482603542368,"dataOnlyFlag":""},{"wavelength":650,"trueK":0.002868246910122195,"fittedK":0.017508752778105378,"nBias":-0.02218134025944951,"regularizedSigmaK":0.0007948008335284083,"regularizedFlag":"","dataOnlySigmaK":0.000856868240151315,"dataOnlyFlag":""},{"wavelength":700,"trueK":0.0021324448146605576,"fittedK":0.018283405629930607,"nBias":-0.021693553577382785,"regularizedSigmaK":0.0009231655132936699,"regularizedFlag":"","dataOnlySigmaK":0.0010007162133169967,"dataOnlyFlag":""},{"wavelength":750,"trueK":0.0016181728395061729,"fittedK":0.018187015437199642,"nBias":-0.021070447181178453,"regularizedSigmaK":0.000977079602111596,"regularizedFlag":"","dataOnlySigmaK":0.0010694370720199663,"dataOnlyFlag":""},{"wavelength":800,"trueK":0.00125,"fittedK":0.0177142103049964,"nBias":-0.020708647525350843,"regularizedSigmaK":0.0010451779353000017,"regularizedFlag":"","dataOnlySigmaK":0.0011119309135277121,"dataOnlyFlag":""},{"wavelength":810,"trueK":0.001189405344021441,"fittedK":0.017646810692559894,"nBias":-0.020710173144484312,"regularizedSigmaK":0.0010632206190505117,"regularizedFlag":"","dataOnlySigmaK":0.0011323217448343601,"dataOnlyFlag":""},{"wavelength":820,"trueK":0.0011324383059996934,"fittedK":0.017588230195367784,"nBias":-0.020733651870111336,"regularizedSigmaK":0.0010909887062550624,"regularizedFlag":"","dataOnlySigmaK":0.0011771595047996937,"dataOnlyFlag":""},{"wavelength":830,"trueK":0.001078841369040426,"fittedK":0.017537832651378097,"nBias":-0.020777612406083668,"regularizedSigmaK":0.0011226119433695462,"regularizedFlag":"","dataOnlySigmaK":0.0012333914582490035,"dataOnlyFlag":""},{"wavelength":840,"trueK":0.0010283780934898523,"fittedK":0.01749498189854887,"nBias":-0.02084062297019651,"regularizedSigmaK":0.0011500782807381048,"regularizedFlag":"","dataOnlySigmaK":0.001281807537666356,"dataOnlyFlag":""},{"wavelength":850,"trueK":0.0009808311682091928,"fittedK":0.017459041774838126,"nBias":-0.02092128852151043,"regularizedSigmaK":0.001168399142210824,"regularizedFlag":"","dataOnlySigmaK":0.001306263430398245,"dataOnlyFlag":""},{"wavelength":860,"trueK":0.0009360006622204685,"fittedK":0.017429376118203905,"nBias":-0.021018248212030244,"regularizedSigmaK":0.0011823425073452982,"regularizedFlag":"","dataOnlySigmaK":0.0013037775392398436,"dataOnlyFlag":""},{"wavelength":870,"trueK":0.0008937024540912294,"fittedK":0.017405348766604243,"nBias":-0.02113017304222886,"regularizedSigmaK":0.0012152158102912698,"regularizedFlag":"","dataOnlySigmaK":0.0012997398498496933,"dataOnlyFlag":""},{"wavelength":880,"trueK":0.0008537668192063383,"fittedK":0.017386323557997158,"nBias":-0.021255763702000108,"regularizedSigmaK":0.0013158140666576763,"regularizedFlag":"","dataOnlySigmaK":0.0013684126762157835,"dataOnlyFlag":""},{"wavelength":890,"trueK":0.0008160371574869313,"fittedK":0.017371664330340698,"nBias":-0.021393748580450955,"regularizedSigmaK":0.0015491178028480396,"regularizedFlag":"","dataOnlySigmaK":0.0016265149039538097,"dataOnlyFlag":""},{"wavelength":900,"trueK":0.0007803688462124675,"fittedK":0.017360734921592878,"nBias":-0.021542881929630386,"regularizedSigmaK":0.00196672188212857,"regularizedFlag":"","dataOnlySigmaK":0.0021633672145750984,"dataOnlyFlag":""}]}
STAGE4_1_DIAGNOSTIC {"scenario":"transparent","lambdaN":0.25,"lambdaK":0.15,"elapsedMs":13860.919699999999,"freeFormThickness":100.54360221645382,"physicalThickness":100.1331128454647,"physicalConverged":false,"knots":12,"comparison":{"freeForm":{"mseWoollam":2.195081721354053,"rawMse":0.004105664498416401,"effectiveParameters":23,"aic":-2328.0074750827475,"bic":-2234.433686553133},"physical":{"mseWoollam":57.934655085276695,"rawMse":2.9928116316995617,"effectiveParameters":4,"aic":481.5641415414378,"bic":497.8378438944142},"significantFreeFormMaxK":0.0035992850724366875,"physicalMaxK":0,"warning":"物理模型在資料範圍內 k 偏低，與自由形式曲線差異如下：顯著自由形式 max k=0.0035992851，物理 max k=0.0000000（差異 > 2σ_k）。"},"regularizedStatistics":{"available":true,"dof":409,"chiSquare":1970.718959239873,"reducedChiSquare":4.8183837634226725,"conditionNumber":105.32643646119938,"conditionLevel":"ok","truncatedSingularValues":0,"freeParameters":23,"warnings":["其餘參數的不確定度為條件於該參數固定在邊界。","共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。"]},"dataOnlyStatistics":{"available":true,"dof":409,"chiSquare":1970.718959239873,"reducedChiSquare":4.8183837634226725,"conditionNumber":105.55140781587777,"conditionLevel":"ok","truncatedSingularValues":0,"freeParameters":23,"warnings":["其餘參數的不確定度為條件於該參數固定在邊界。"]},"table":[{"wavelength":190,"trueK":0,"fittedK":0,"nBias":-0.007493326025339364,"regularizedSigmaK":0,"regularizedFlag":"below_detection","dataOnlySigmaK":0,"dataOnlyFlag":"below_detection"},{"wavelength":200,"trueK":0,"fittedK":0.00013936467102892535,"nBias":-0.006287392627428057,"regularizedSigmaK":0.00002115485514620088,"regularizedFlag":"","dataOnlySigmaK":0.00002118009907844267,"dataOnlyFlag":""},{"wavelength":250,"trueK":0,"fittedK":0.0003792484913704865,"nBias":-0.007589247529475651,"regularizedSigmaK":0.000055968724470080935,"regularizedFlag":"","dataOnlySigmaK":0.00005603866052124331,"dataOnlyFlag":""},{"wavelength":300,"trueK":0,"fittedK":0.0002753005440813001,"nBias":-0.006359119273055214,"regularizedSigmaK":0.00004614278089104754,"regularizedFlag":"","dataOnlySigmaK":0.00004626565585450565,"dataOnlyFlag":""},{"wavelength":350,"trueK":0,"fittedK":0.0003747836186502812,"nBias":-0.005944859908692646,"regularizedSigmaK":0.00010158346136810539,"regularizedFlag":"","dataOnlySigmaK":0.0001019307705230431,"dataOnlyFlag":""},{"wavelength":400,"trueK":0,"fittedK":0.0009083307101823779,"nBias":-0.0064663973589922374,"regularizedSigmaK":0.00011832577940096495,"regularizedFlag":"","dataOnlySigmaK":0.00011870107845076078,"dataOnlyFlag":""},{"wavelength":450,"trueK":0,"fittedK":0.0015762022804947885,"nBias":-0.004980383980921488,"regularizedSigmaK":0.00013845790979317158,"regularizedFlag":"","dataOnlySigmaK":0.00013885348639765976,"dataOnlyFlag":""},{"wavelength":500,"trueK":0,"fittedK":0.001913946260941758,"nBias":-0.004795566343730684,"regularizedSigmaK":0.0001548110896559464,"regularizedFlag":"","dataOnlySigmaK":0.0001550741486064008,"dataOnlyFlag":""},{"wavelength":550,"trueK":0,"fittedK":0.0024304760615644167,"nBias":-0.00494453775266912,"regularizedSigmaK":0.00019989681246331806,"regularizedFlag":"","dataOnlySigmaK":0.00020042879166642713,"dataOnlyFlag":""},{"wavelength":600,"trueK":0,"fittedK":0.00287688127369666,"nBias":-0.004818902104106959,"regularizedSigmaK":0.00024091328157481898,"regularizedFlag":"","dataOnlySigmaK":0.00024134689072003004,"dataOnlyFlag":""},{"wavelength":650,"trueK":0,"fittedK":0.00313505349751302,"nBias":-0.004640812193550836,"regularizedSigmaK":0.0002708395219341753,"regularizedFlag":"","dataOnlySigmaK":0.00027131006873663615,"dataOnlyFlag":""},{"wavelength":700,"trueK":0,"fittedK":0.0035027235592036843,"nBias":-0.0045490989493019995,"regularizedSigmaK":0.0003359791105020844,"regularizedFlag":"","dataOnlySigmaK":0.0003406594746822116,"dataOnlyFlag":""},{"wavelength":750,"trueK":0,"fittedK":0.0035920777310904806,"nBias":-0.004383599321378773,"regularizedSigmaK":0.00036264715010787005,"regularizedFlag":"","dataOnlySigmaK":0.00037027673653909296,"dataOnlyFlag":""},{"wavelength":800,"trueK":0,"fittedK":0.003492365323557754,"nBias":-0.004239654517242508,"regularizedSigmaK":0.00038804495711991754,"regularizedFlag":"","dataOnlySigmaK":0.0003898061600803764,"dataOnlyFlag":""},{"wavelength":810,"trueK":0,"fittedK":0.0034719264851591474,"nBias":-0.004227344786893461,"regularizedSigmaK":0.00039815092695553436,"regularizedFlag":"","dataOnlySigmaK":0.0004007040523729514,"dataOnlyFlag":""},{"wavelength":820,"trueK":0,"fittedK":0.0034544745726493606,"nBias":-0.0042219980941891055,"regularizedSigmaK":0.0004168680137267174,"regularizedFlag":"","dataOnlySigmaK":0.00042376857071287376,"dataOnlyFlag":""},{"wavelength":830,"trueK":0,"fittedK":0.0034413069794750183,"nBias":-0.0042242708556663455,"regularizedSigmaK":0.0004391328412449261,"regularizedFlag":"","dataOnlySigmaK":0.00045200930032379075,"dataOnlyFlag":""},{"wavelength":840,"trueK":0,"fittedK":0.0034337210990827483,"nBias":-0.004234859001804203,"regularizedSigmaK":0.0004580746534431985,"regularizedFlag":"","dataOnlySigmaK":0.00047595837190191813,"dataOnlyFlag":""},{"wavelength":850,"trueK":0,"fittedK":0.0034330143249191748,"nBias":-0.004254495204348396,"regularizedSigmaK":0.0004685216619545764,"regularizedFlag":"","dataOnlySigmaK":0.0004881037138919796,"dataOnlyFlag":""},{"wavelength":860,"trueK":0,"fittedK":0.0034404840504309265,"nBias":-0.0042839463279875645,"regularizedSigmaK":0.00047091896602856445,"regularizedFlag":"","dataOnlySigmaK":0.00048725885736456787,"dataOnlyFlag":""},{"wavelength":870,"trueK":0,"fittedK":0.0034574276690646282,"nBias":-0.004324011085879764,"regularizedSigmaK":0.00047715037851067736,"regularizedFlag":"","dataOnlySigmaK":0.00048560855760515704,"dataOnlyFlag":""},{"wavelength":880,"trueK":0,"fittedK":0.0034851425742669067,"nBias":-0.004375517880603086,"regularizedSigmaK":0.0005168337449359842,"regularizedFlag":"","dataOnlySigmaK":0.0005184019092756312,"dataOnlyFlag":""},{"wavelength":890,"trueK":0,"fittedK":0.00352492615948439,"nBias":-0.004439322813948765,"regularizedSigmaK":0.000630807083541259,"regularizedFlag":"","dataOnlySigmaK":0.000637863611502657,"dataOnlyFlag":""},{"wavelength":900,"trueK":0,"fittedK":0.003578075818163701,"nBias":-0.004516307850650936,"regularizedSigmaK":0.0008464699322427079,"regularizedFlag":"","dataOnlySigmaK":0.0008775266540588969,"dataOnlyFlag":""}]}
STAGE4_1_DIAGNOSTIC {"scenario":"transparent","lambdaN":0.25,"lambdaK":0.6,"elapsedMs":11026.727599999995,"freeFormThickness":100.54216376672133,"physicalThickness":100.13311262628386,"physicalConverged":false,"knots":12,"comparison":{"freeForm":{"mseWoollam":2.195070804640947,"rawMse":0.004105623661440216,"effectiveParameters":23,"aic":-2328.0117719904606,"bic":-2234.437983460846},"physical":{"mseWoollam":57.93462986434299,"rawMse":2.9928090259539295,"effectiveParameters":4,"aic":481.5637654126527,"bic":497.8374677656291},"significantFreeFormMaxK":0.0035835827478123126,"physicalMaxK":0,"warning":"物理模型在資料範圍內 k 偏低，與自由形式曲線差異如下：顯著自由形式 max k=0.0035835827，物理 max k=0.0000000（差異 > 2σ_k）。"},"regularizedStatistics":{"available":true,"dof":409,"chiSquare":1970.6993574913033,"reducedChiSquare":4.81833583738705,"conditionNumber":105.12099155048355,"conditionLevel":"ok","truncatedSingularValues":0,"freeParameters":23,"warnings":["其餘參數的不確定度為條件於該參數固定在邊界。","共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。"]},"dataOnlyStatistics":{"available":true,"dof":409,"chiSquare":1970.6993574913033,"reducedChiSquare":4.81833583738705,"conditionNumber":105.55169212207149,"conditionLevel":"ok","truncatedSingularValues":0,"freeParameters":23,"warnings":["其餘參數的不確定度為條件於該參數固定在邊界。"]},"table":[{"wavelength":190,"trueK":0,"fittedK":0,"nBias":-0.007474666798268581,"regularizedSigmaK":0,"regularizedFlag":"below_detection","dataOnlySigmaK":0,"dataOnlyFlag":"below_detection"},{"wavelength":200,"trueK":0,"fittedK":0.00013864311672775017,"nBias":-0.006269273406506848,"regularizedSigmaK":0.000021111999225317233,"regularizedFlag":"","dataOnlySigmaK":0.00002118059417354499,"dataOnlyFlag":""},{"wavelength":250,"trueK":0,"fittedK":0.0003774707193317536,"nBias":-0.007572435349279649,"regularizedSigmaK":0.00005586359519083953,"regularizedFlag":"","dataOnlySigmaK":0.000056039899882008614,"dataOnlyFlag":""},{"wavelength":300,"trueK":0,"fittedK":0.0002750327942219006,"nBias":-0.006342507354864413,"regularizedSigmaK":0.00004598891448021633,"regularizedFlag":"","dataOnlySigmaK":0.00004626616596251337,"dataOnlyFlag":""},{"wavelength":350,"trueK":0,"fittedK":0.0003761359362175854,"nBias":-0.005928854124003458,"regularizedSigmaK":0.00010105415105678947,"regularizedFlag":"","dataOnlySigmaK":0.00010193181097272655,"dataOnlyFlag":""},{"wavelength":400,"trueK":0,"fittedK":0.0009069087857244344,"nBias":-0.00645094378514921,"regularizedSigmaK":0.00011801082318842928,"regularizedFlag":"","dataOnlySigmaK":0.00011870324963789852,"dataOnlyFlag":""},{"wavelength":450,"trueK":0,"fittedK":0.0015699480302307522,"nBias":-0.004965645833072241,"regularizedSigmaK":0.00013793311372818382,"regularizedFlag":"","dataOnlySigmaK":0.00013885922223313916,"dataOnlyFlag":""},{"wavelength":500,"trueK":0,"fittedK":0.0019095207960690191,"nBias":-0.004783137476071175,"regularizedSigmaK":0.00015459644755629962,"regularizedFlag":"","dataOnlySigmaK":0.00015507998222420895,"dataOnlyFlag":""},{"wavelength":550,"trueK":0,"fittedK":0.0024228714330520344,"nBias":-0.004931388121529157,"regularizedSigmaK":0.00019937199528357848,"regularizedFlag":"","dataOnlySigmaK":0.00020043666394186318,"dataOnlyFlag":""},{"wavelength":600,"trueK":0,"fittedK":0.0028705115144803364,"nBias":-0.0048068864574577486,"regularizedSigmaK":0.00024048022527867587,"regularizedFlag":"","dataOnlySigmaK":0.00024135507099347521,"dataOnlyFlag":""},{"wavelength":650,"trueK":0,"fittedK":0.0031305050860280332,"nBias":-0.004630271799413999,"regularizedSigmaK":0.0002703912002154482,"regularizedFlag":"","dataOnlySigmaK":0.0002713187798846454,"dataOnlyFlag":""},{"wavelength":700,"trueK":0,"fittedK":0.003486380248796671,"nBias":-0.004534021000677013,"regularizedSigmaK":0.0003301712349852744,"regularizedFlag":"","dataOnlySigmaK":0.0003406713346842341,"dataOnlyFlag":""},{"wavelength":750,"trueK":0,"fittedK":0.003578637709954132,"nBias":-0.004370345349524074,"regularizedSigmaK":0.00035317610110575226,"regularizedFlag":"","dataOnlySigmaK":0.0003702889638319726,"dataOnlyFlag":""},{"wavelength":800,"trueK":0,"fittedK":0.0034916618783108187,"nBias":-0.004231502864240788,"regularizedSigmaK":0.000384859657308967,"regularizedFlag":"","dataOnlySigmaK":0.00038981567432937425,"dataOnlyFlag":""},{"wavelength":810,"trueK":0,"fittedK":0.0034731238448826034,"nBias":-0.00421984757458671,"regularizedSigmaK":0.00039366497913801275,"regularizedFlag":"","dataOnlySigmaK":0.00040071364979690766,"dataOnlyFlag":""},{"wavelength":820,"trueK":0,"fittedK":0.0034569421792130205,"nBias":-0.004214908896869263,"regularizedSigmaK":0.0004070093425789393,"regularizedFlag":"","dataOnlySigmaK":0.0004237786438931384,"dataOnlyFlag":""},{"wavelength":830,"trueK":0,"fittedK":0.0034442354655938754,"nBias":-0.004217291192496475,"regularizedSigmaK":0.00042206120712796896,"regularizedFlag":"","dataOnlySigmaK":0.0004520201678437261,"dataOnlyFlag":""},{"wavelength":840,"trueK":0,"fittedK":0.003436122288316977,"nBias":-0.004227638336819384,"regularizedSigmaK":0.0004351272977383266,"regularizedFlag":"","dataOnlySigmaK":0.00047597018469182323,"dataOnlyFlag":""},{"wavelength":850,"trueK":0,"fittedK":0.003433721231674128,"nBias":-0.004246630946455721,"regularizedSigmaK":0.0004440399669266611,"regularizedFlag":"","dataOnlySigmaK":0.0004881163790030671,"dataOnlyFlag":""},{"wavelength":860,"trueK":0,"fittedK":0.0034381508799571393,"nBias":-0.004274983830965695,"regularizedSigmaK":0.0004511732544502462,"regularizedFlag":"","dataOnlySigmaK":0.0004872718990917967,"dataOnlyFlag":""},{"wavelength":870,"trueK":0,"fittedK":0.003450529817457817,"nBias":-0.004313443648379156,"regularizedSigmaK":0.0004673373991505966,"regularizedFlag":"","dataOnlySigmaK":0.0004856208116511613,"dataOnlyFlag":""},{"wavelength":880,"trueK":0,"fittedK":0.003471976628467966,"nBias":-0.004362786746145764,"regularizedSigmaK":0.0005143943390355366,"regularizedFlag":"","dataOnlySigmaK":0.0005184113801312457,"dataOnlyFlag":""},{"wavelength":890,"trueK":0,"fittedK":0.0035036098972793957,"nBias":-0.004423817170928546,"regularizedSigmaK":0.000619663713052756,"regularizedFlag":"","dataOnlySigmaK":0.000637868950740942,"dataOnlyFlag":""},{"wavelength":900,"trueK":0,"fittedK":0.0035465482081839103,"nBias":-0.004497364832333206,"regularizedSigmaK":0.0008026699670005805,"regularizedFlag":"","dataOnlySigmaK":0.0008775288992633323,"dataOnlyFlag":""}]}
STAGE4_1_DIAGNOSTIC {"scenario":"transparent","lambdaN":0.25,"lambdaK":2.4,"elapsedMs":16811.339099999997,"freeFormThickness":100.5368810992887,"physicalThickness":100.13311173904842,"physicalConverged":false,"knots":12,"comparison":{"freeForm":{"mseWoollam":2.195280308677514,"rawMse":0.004106407404520625,"effectiveParameters":23,"aic":-2327.9293132152693,"bic":-2234.355524685655},"physical":{"mseWoollam":57.93453870312959,"rawMse":2.9927996074804404,"effectiveParameters":4,"aic":481.5624058915759,"bic":497.83610824455235},"significantFreeFormMaxK":0.003533872917149786,"physicalMaxK":0,"warning":"物理模型在資料範圍內 k 偏低，與自由形式曲線差異如下：顯著自由形式 max k=0.0035338729，物理 max k=0.0000000（差異 > 2σ_k）。"},"regularizedStatistics":{"available":true,"dof":409,"chiSquare":1971.0755541698989,"reducedChiSquare":4.819255633667234,"conditionNumber":104.40481343705537,"conditionLevel":"ok","truncatedSingularValues":0,"freeParameters":23,"warnings":["其餘參數的不確定度為條件於該參數固定在邊界。","共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。"]},"dataOnlyStatistics":{"available":true,"dof":409,"chiSquare":1971.0755541698989,"reducedChiSquare":4.819255633667234,"conditionNumber":105.55221873715915,"conditionLevel":"ok","truncatedSingularValues":0,"freeParameters":23,"warnings":["其餘參數的不確定度為條件於該參數固定在邊界。"]},"table":[{"wavelength":190,"trueK":0,"fittedK":0,"nBias":-0.007406132254883513,"regularizedSigmaK":0,"regularizedFlag":"below_detection","dataOnlySigmaK":0,"dataOnlyFlag":"below_detection"},{"wavelength":200,"trueK":0,"fittedK":0.00013597026518522031,"nBias":-0.00620270908825904,"regularizedSigmaK":0.000020958215397113443,"regularizedFlag":"","dataOnlySigmaK":0.000021184833377443944,"dataOnlyFlag":""},{"wavelength":250,"trueK":0,"fittedK":0.00037083726249575257,"nBias":-0.007510653610373508,"regularizedSigmaK":0.00005548048812626221,"regularizedFlag":"","dataOnlySigmaK":0.00005605088148555149,"dataOnlyFlag":""},{"wavelength":300,"trueK":0,"fittedK":0.0002737414823698348,"nBias":-0.006281524289200924,"regularizedSigmaK":0.000045406056816382184,"regularizedFlag":"","dataOnlySigmaK":0.00004627345344239226,"dataOnlyFlag":""},{"wavelength":350,"trueK":0,"fittedK":0.00038032396908018986,"nBias":-0.005870250690186651,"regularizedSigmaK":0.00009909706441667623,"regularizedFlag":"","dataOnlySigmaK":0.00010194747151427185,"dataOnlyFlag":""},{"wavelength":400,"trueK":0,"fittedK":0.0009013243395429964,"nBias":-0.00639470740628334,"regularizedSigmaK":0.00011682687070737936,"regularizedFlag":"","dataOnlySigmaK":0.00011872494001342968,"dataOnlyFlag":""},{"wavelength":450,"trueK":0,"fittedK":0.001547551470353265,"nBias":-0.004912093140891027,"regularizedSigmaK":0.00013622597764543695,"regularizedFlag":"","dataOnlySigmaK":0.00013889570111520725,"dataOnlyFlag":""},{"wavelength":500,"trueK":0,"fittedK":0.0018929969014501627,"nBias":-0.004737259443827746,"regularizedSigmaK":0.00015380857052139045,"regularizedFlag":"","dataOnlySigmaK":0.0001551191139165092,"dataOnlyFlag":""},{"wavelength":550,"trueK":0,"fittedK":0.002395454383227654,"nBias":-0.0048831349982181305,"regularizedSigmaK":0.00019767873525196157,"regularizedFlag":"","dataOnlySigmaK":0.0002004881715956416,"dataOnlyFlag":""},{"wavelength":600,"trueK":0,"fittedK":0.002845825388154744,"nBias":-0.004762024004405285,"regularizedSigmaK":0.00023897539788514613,"regularizedFlag":"","dataOnlySigmaK":0.00024141305637711646,"dataOnlyFlag":""},{"wavelength":650,"trueK":0,"fittedK":0.003111968584259986,"nBias":-0.004590706186513138,"regularizedSigmaK":0.00026901509108439176,"regularizedFlag":"","dataOnlySigmaK":0.0002713820082010691,"dataOnlyFlag":""},{"wavelength":700,"trueK":0,"fittedK":0.00343224299962327,"nBias":-0.004481486242719379,"regularizedSigmaK":0.0003189654775948063,"regularizedFlag":"","dataOnlySigmaK":0.00034075265524569667,"dataOnlyFlag":""},{"wavelength":750,"trueK":0,"fittedK":0.003533430024165639,"nBias":-0.004323304426268493,"regularizedSigmaK":0.00034077337177184296,"regularizedFlag":"","dataOnlySigmaK":0.00037037486173952796,"dataOnlyFlag":""},{"wavelength":800,"trueK":0,"fittedK":0.0034800164600222666,"nBias":-0.004198156720250923,"regularizedSigmaK":0.0003752898472260237,"regularizedFlag":"","dataOnlySigmaK":0.0003898969801995893,"dataOnlyFlag":""},{"wavelength":810,"trueK":0,"fittedK":0.003465933578384633,"nBias":-0.0041880824632283264,"regularizedSigmaK":0.00038226755714819216,"regularizedFlag":"","dataOnlySigmaK":0.0004007966478048554,"dataOnlyFlag":""},{"wavelength":820,"trueK":0,"fittedK":0.0034525709952851987,"nBias":-0.004184072871804112,"regularizedSigmaK":0.00039018437687187894,"regularizedFlag":"","dataOnlySigmaK":0.0004238657414836692,"dataOnlyFlag":""},{"wavelength":830,"trueK":0,"fittedK":0.0034406762776279308,"nBias":-0.004186624809654926,"regularizedSigmaK":0.0003983935735384333,"regularizedFlag":"","dataOnlySigmaK":0.00045211275058204455,"dataOnlyFlag":""},{"wavelength":840,"trueK":0,"fittedK":0.0034309969923168016,"nBias":-0.004196274654401089,"regularizedSigmaK":0.00040647399428222006,"regularizedFlag":"","dataOnlySigmaK":0.00047606808161489454,"dataOnlyFlag":""},{"wavelength":850,"trueK":0,"fittedK":0.0034242807062557787,"nBias":-0.004213595524928282,"regularizedSigmaK":0.0004154155189717135,"regularizedFlag":"","dataOnlySigmaK":0.00048821790937273216,"dataOnlyFlag":""},{"wavelength":860,"trueK":0,"fittedK":0.0034212749863488344,"nBias":-0.004239194733065776,"regularizedSigmaK":0.0004291152126224429,"regularizedFlag":"","dataOnlySigmaK":0.0004873743436226459,"dataOnlyFlag":""},{"wavelength":870,"trueK":0,"fittedK":0.003422727399499938,"nBias":-0.004273711439112038,"regularizedSigmaK":0.0004557413947710202,"regularizedFlag":"","dataOnlySigmaK":0.00048572136472587834,"dataOnlyFlag":""},{"wavelength":880,"trueK":0,"fittedK":0.0034293855126130584,"nBias":-0.0043178144927853435,"regularizedSigmaK":0.0005076073466997508,"regularizedFlag":"","dataOnlySigmaK":0.0005185096484931922,"dataOnlyFlag":""},{"wavelength":890,"trueK":0,"fittedK":0.0034419968925921683,"nBias":-0.004372200443017782,"regularizedSigmaK":0.0005981307573868285,"regularizedFlag":"","dataOnlySigmaK":0.0006379727828278934,"dataOnlyFlag":""},{"wavelength":900,"trueK":0,"fittedK":0.003461309106341234,"nBias":-0.004437591701683008,"regularizedSigmaK":0.0007376356827459569,"regularizedFlag":"","dataOnlySigmaK":0.0008776566978819753,"dataOnlyFlag":""}]}
STAGE4_1_DIAGNOSTIC_SUMMARY {"runs":4,"errors":[]}
```

## 原始輸出：stage4_1-source-audit.log

```text
src/materialRegistry\materialRegistry.ts:17:    description: 'High-purity thermally grown or PECVD silicon dioxide, highly transparent across visible and NIR.',
src/models\cauchy.ts:3: * Standard model for transparent thin films (dielectrics, oxides, nitrides, polymers)
src/models\cauchy.ts:7: *   k(lambda) = k0 * exp(alpha * (1/lambda - 1/0.4)) or transparent (k0 = 0)
src/models\cauchy.ts:16:  description: 'Empirical dispersion relation for transparent dielectric materials in the UV-Vis-NIR region.',
src/models\cauchy.ts:74:      description: 'Residual absorption constant (0 for transparent films)',
src/fitting\optimizer.ts:231:      for(let k=0;k<free.length;k++)augmented.push(free.map((j,l)=>l===k?Math.sqrt(lambda*(Math.max(1e-6,diagonal[j])+1e-4)):0));
src/models\drude.ts:3: * Standard model for metals, transparent conducting oxides (ITO, AZO), and heavily doped semiconductors.
src/fitting\statistics.ts:95:      let sum=0;for(let k=0;k<s.length;k++)if(s[k]>0&&s[k]>=cutoff)sum+=v[i][k]*v[j][k]/s[k]**2;
src/models\peakInitialization.ts:24:    for(let j=start;j<start+window;j++){const x=j-i;for(let k=0;k<5;k++)mom[k]+=x**k;for(let k=0;k<3;k++)rhs[k]+=raw[j]*x**k;}
src/models\peakInitialization.ts:26:    for(let k=0;k<3;k++){const d=a[k][k];for(let j=k;j<4;j++)a[k][j]/=d;for(let r=0;r<3;r++)if(r!==k){const f=a[r][k];for(let j=k;j<4;j++)a[r][j]-=f*a[k][j];}}
src/models\sellmeier.ts:3: * Widely used for optical glass, fused silica, and transparent optical media.
src/models\sellmeier.ts:112:      k: 0.0,
```
