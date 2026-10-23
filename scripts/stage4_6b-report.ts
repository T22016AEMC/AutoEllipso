import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {groups,settings,read,save} from './stage4_6b-run';

const all=groups.map(g=>read(g.id));
for(const r of all){assert.equal(r.results.length,10);assert.deepEqual(r.settings,settings);assert.equal(r.pairs.length,45);}
const fmt=(v:number)=>v===0?'0':Math.abs(v)<.0001||Math.abs(v)>1e5?v.toExponential(3):v.toFixed(4);
const columns=settings.starts;
const table=(rows:string[],head='案例')=>[`|${head}|${columns.join('|')}|`,`|---|${columns.map(()=>'---:').join('|')}|`,...rows];
const totals=all.flatMap(r=>r.results);
const failures=JSON.parse(readFileSync('.qa/stage4_6b-scientific-tests.json','utf8')).filter((r:any)=>!r.passed);
const prior=JSON.parse(readFileSync('.qa/stage4_6a-scientific-tests.json','utf8')).filter((r:any)=>!r.passed);
assert.deepEqual(failures,prior,'Same existing assertions and failure details as Stage4.6a');
const verification=JSON.parse(readFileSync('.qa/stage4_6b-verification-summary.json','utf8'));
assert.deepEqual(Object.fromEntries(verification.commands.map((q:any)=>[q.name,q.exitCode])),{typecheck:0,build:0,'original-tests':0,'scientific-tests':1,'worker-tests':0},'Report must match actual final verification exits');
const different=all.filter(r=>!r.summary.allPairwiseWithinThreshold);
const p2changes=all.filter(r=>r.group.kind==='A').map(r=>({id:r.group.id,deltaMse:r.results[1].mseDeltaToP1,...r.results[1].delta}));
save('summary',{settings,groups:all.map(r=>({group:r.group,...r.summary})),p2changes,verification,failures});
const report=[
'# Stage 4.6b：自由形式精修起點敏感度診斷',
'基準 `'+settings.base+'`；只新增 scripts/ 與本報告，src/、模型、容差、迭代上限、斷言及部署設定不變。',
'規則在首個資料執行前固定於本報告與 `.qa/stage4_6b-settings.json`，未依結果調整。',
'P1 正式物理終點；P2 工程 A 組採 4.6a oracle，其餘 B/C 組為 P1 別名、獨立重跑並檢查參數位元一致。',
'P3 粗擬合後全資料成本最高者；P4 粗排序較低中位數（24 個取第 12 名），都用粗擬合終點，並非 oracle 精修終點。',
'P5 重用正式 Stage1 的 Cauchy A/B/C/膜厚，k=0；P6 n=1.5、k=0.05、膜厚取 P5；P7 原 BIC 階梯終點，再投影／精修。',
'P8a/b/c：seed 61001/61002/61003，LCG，六個等距波長 cubic controls；n 相對 ±15%、k 加 0–0.1、膜厚 ±5 nm。',
'起點不用真值；實際集合為 P1–P7 加三個 P8，共 10 個（需求「8+3」與列舉數量不一致，採明列集合）。',
'同一終點：n、k 對 P1 最大絕對差皆 ≤1e-3；另算所有 45 對端點，收斂旗標不等同於曲線一致。',
'全部串行呼叫原 refineFreeForm：40 節點、全資料、100 次、ftol=1e-5、既有 xtol/gtol、λN=.25、λK=.6；沒有修改這些設定。',
'A/B 重用 4.6a 快取（正式 src tree 相同）；C 的 T0/T5 用同一隔離唯讀追蹤重跑。P7 從 pipelineData.bspline 重建，避免誤用已被 M2 取代的曲線。',
'資料沿用指定 fixture：190–900 nm 每 10 nm、65/70/75°、216 點；工程吸收／透明／弱吸收 seed 41001、σ=.03°，SiO2 沿用預設多 AOI fixture（σ=.04°）；T0–T5 seed 45001、σ=.03°。',
'計時為逐次呼叫牆鐘，含 SVD、精修與最終統計，不含取得起點；固定 P1→P8c 順序有暖機／快取影響，不能當獨立隨機效能樣本。',
'所有完整精度曲線、起終點參數、指標與原始 log：本機 `.qa/stage4_6b-*.json`、`.log`，不在 repo。',
'',
'終點全資料 MSE_W（未套用正式 ladder/physical_seeded 二選一；此處只比較同一精修核心的各起點）：',
...table(all.map(r=>'|'+r.group.id+'|'+r.results.map((q:any)=>fmt(q.mseWoollam)).join('|')+'|')),
'',
'對 P1 終點的曲線差，欄內依序為 n最大/nRMS；k最大/kRMS，逐量測波長計算：',
...table(all.map(r=>'|'+r.group.id+'|'+r.results.map((q:any)=>`${fmt(q.delta.nMax)}/${fmt(q.delta.nRms)};${fmt(q.delta.kMax)}/${fmt(q.delta.kRms)}`).join('|')+'|')),
'',
'逐次執行：欄內為「起點 MSE_W→總成本／迭代數:status／秒／膜厚nm」。cost/step/gradient/no_better_step 才表示 converged；max_iter/stalled 不表示收斂。',
'起點分數為正式 SVD 投影／邊界裁切後的實際優化器起點；原曲線起點 M=0 分數亦保存在 JSON。總成本為資料項＋正式縮放正則項。',
...table(all.map(r=>'|'+r.group.id+'|'+r.results.map((q:any)=>`${fmt(q.initialMseWoollam)}→${fmt(q.totalCost)}/${q.iterations}:${q.status}/${(q.elapsedMs/1000).toFixed(2)}/${fmt(q.thickness)}`).join('|')+'|')),
'',
'B 組相對真值誤差：n最大/nRMS；k最大/kRMS；膜厚誤差nm（真值只用於此評分）：',
...table(all.filter(r=>r.group.kind==='B').map(r=>'|'+r.group.id+'|'+r.results.map((q:any)=>`${fmt(q.truth.nMax)}/${fmt(q.truth.nRms)};${fmt(q.truth.kMax)}/${fmt(q.truth.kRms)};${fmt(q.truth.thicknessError)}`).join('|')+'|')),
'',
'彙整：不同終點欄列「起點:相對 P1 的 ΔMSE_W」；未列者歸為與 P1 同一終點。',
'|案例|最小–最大 MSE_W|最大 Δn / Δk 對P1|全部兩兩≤1e-3|不同終點：ΔMSE_W|',
'|---|---:|---:|---|---|',
...all.map(r=>`|${r.group.id}|${fmt(r.summary.minimumMse)}–${fmt(r.summary.maximumMse)}|${fmt(r.summary.maxNDeltaToP1)} / ${fmt(r.summary.maxKDeltaToP1)}|${r.summary.allPairwiseWithinThreshold?'是':'否'}|${r.summary.different.map((q:any)=>q.id+':'+fmt(q.deltaMse)).join(', ')||'無'}|`),
'',
`判定：${different.length}/10 組未達所有終點互差 ≤1e-3；在這組固定起點與正式精修預算下，不能把自由形式視為對起點不敏感。`,
'P2 對 P1 的工程案例差（ΔMSE_W；Δn最大；Δk最大）：'+p2changes.map(q=>`${q.id} ${fmt(q.deltaMse)};${fmt(q.nMax)};${fmt(q.kMax)}`).join(' / ')+'。',
'四個工程案例的 P2 與 P1 皆在同一終點範圍，最大 Δn <1e-7、最大 Δk <5e-8；這四組未見 oracle 物理候選成本優勢明顯傳到自由形式曲線，據此尚不能把物理候選選擇最佳化列為改善自由形式的優先項。',
'P3/P6/P8 造成的差異只證明這些起點的敏感度，不能單憑它推論所有候選選擇策略的收益；B/C 未比較真正 oracle，不能外推。',
'不同於 P1 的組數：'+columns.map(id=>id+' '+all.filter(r=>!r.results.find((q:any)=>q.id===id).sameAsP1).length+'/10').join('、')+'。P7 在 T2/T3/T4 不同；P8a/b 在 SiO2/T0/T5 不同；詳彙整表的實際 ΔMSE。',
`100 次精修共 ${(totals.reduce((s,q)=>s+q.elapsedMs,0)/1000).toFixed(2)} 秒；converged=${totals.filter(q=>q.converged).length}/100，max_iter=${totals.filter(q=>q.status==='max_iter').length}，stalled=${totals.filter(q=>q.status==='stalled').length}。即使 status=cost，仍可能進入不同終點，詳上表。`,
'起點樣本有限；B/C 的 P2 是 P1 別名，無法用它判定該組 oracle 起點的收益。未改正式行為、未建議調容差或斷言。',
'',
'pnpm run verify 原始輸出：本機 `.qa/stage4_6b-verify.log` 與 `.qa/stage4_6b-v2-*.log`（不在 repo）。',
'工程測試：typecheck exit 0、build exit 0、original 29/29、scientific 90/92、worker 8/8；verify exit 1。',
...failures.map((q:any)=>'- '+q.name+'：'+q.detail.replaceAll('\n',' ').replaceAll('|','/').trimEnd()),
'兩項失敗與 4.6a 名稱及原始錯誤內容完全相同；沒有新增既有測試失敗、沒有修改任何斷言或期望值。',
'首次 verify 的新增腳本曾缺少差值物件回傳型別，修正僅型別宣告後重跑；首次原始輸出另留本機 `.qa/stage4_6b-verify-first-attempt.log`，不在 repo。',
];
assert.ok(report.length<=100,'Report <=100 lines: '+report.length);assert.ok(existsSync('.qa/stage4_6b-verify.log'));writeFileSync('STAGE4_6B_REPORT.md',report.join('\n')+'\n');console.log(JSON.stringify({lines:report.length,p2changes,differentGroups:different.length,verification,failures}));
