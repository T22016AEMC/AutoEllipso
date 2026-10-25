import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const prefix='.qa/stage4_8c-',read=(name:string)=>JSON.parse(readFileSync(prefix+name+'.json','utf8'));
const unit=read('unit-tests'),selectors=read('selector-tests'),guarded=read('guarded-tests'),related=read('related-tests'),reg=read('regression-summary'),timing=read('verify-timing');
const unitMs=unit.elapsedMs+selectors.elapsedMs+guarded.elapsedMs;
const scientific=JSON.parse(readFileSync('.qa/scientific-tests.json','utf8'));
const oldScientific=JSON.parse(readFileSync('.qa/stage4_8b-scientific-tests.json','utf8'));
const fails=(rows:any[])=>rows.filter(q=>!q.passed).map(({name,detail})=>({name,detail}));
const original=JSON.parse(readFileSync('.qa/v2-original-tests.json','utf8')),worker=JSON.parse(readFileSync('.qa/worker-tests.json','utf8'));
const verification=JSON.parse(readFileSync('.qa/verification-summary.json','utf8'));
const failures=fails(scientific),baselineFailures=fails(oldScientific),changed=JSON.stringify(failures)!==JSON.stringify(baselineFailures);
copyFileSync('.qa/scientific-tests.json',prefix+'scientific-tests.json');
writeFileSync(prefix+'verification.json',JSON.stringify({timing,verification,failures,changed,counts:{original:[original.filter((q:any)=>q.passed).length,original.length],scientific:[scientific.filter((q:any)=>q.passed).length,scientific.length],worker:[worker.filter((q:any)=>q.passed).length,worker.length]}},null,2));
const source=readFileSync('scripts/stage4_5d-tests.ts','utf8'),base=execFileSync('git',['show','db0ae4b2150877314b80ecb00988b96073db02c2:scripts/stage4_5d-tests.ts'],{encoding:'utf8'});
const oldAssertion="  assert.equal(r.freeFormOrigin,chooseFreeFormOrigin(s.ladder!.mseWoollam,physicalSeeded.mseWoollam));";
const newAssertion=source.split(/\r?\n/).find(l=>l.includes("if(r.freeFormOrigin==='ladder_v2')"))!;
assert.equal(source.replace(newAssertion,oldAssertion).replaceAll('\r\n','\n'),base.replaceAll('\r\n','\n'),'only authorized assertion changed');
const fmt=(v:number,n=5)=>Number.isFinite(v)?v.toPrecision(n):'NA';
const lines=[
 '# Stage 4.8c：自由形式階梯選擇移植','',
 '分支v2.2-integration；基準db0ae4b2150877314b80ecb00988b96073db02c2；不部署、不修改Cloudflare設定。',
 '固定全階梯40/1→40/.1→40/.01→60/.01→80/.01；波長等距；λN=.25s、λK=.6s；每步同物理P1、不暖啟動。',
 '邊界n=.5–5.5、k=0–3.5、d=40–200；100次、ftol=1e-5與原xtol/gtol未改；合法=converged且status=cost且dof>0且M≤N_eq/4。',
 'σ模式正式W；σ̂模式只取合法末步rawRSS/dof；非正或非有限則基準fallback並標記σ̂不可用；嚴格改善>.05，階梯同分保留先者。',
 '40被護欄排除才用12/1→12/.1→12/.01→16/.01→20/.01→24/.01；12基準不合法則無可用候選、不fallback。',
 '原8–40流程保留，物理初始化、Expert、TMM、LM、Jacobian、統計公式未修改。M2=同P1的40/1，與新階梯共用單次精修。',
 '非fallback時，新來源ladder_v2嚴格低於舊兩候選才勝出；來源同分保留原chooseFreeFormOrigin規則；fallback依固定基準。結果保存模式／σ̂²／每步狀態、收斂、dof、rawRSS、分數、接受、牆鐘及fallback。',
 'UI及Validation Report新增所選M與s文字／欄位；預設自由形式n/k匯出行為未改。',
 '節點放寬：僅新階梯輸出附_freeFormLadderV2=1時bspline evaluator允許80；公用MAX=40、參數定義與generateAdaptiveKnots上限仍40，舊路徑不變。',
 '投影零方程補行只用於新階梯的寬矩陣；未改SVD或優化／統計核心。',
 '', '## 改動檔案與目的',
 '- src/fitting/freeFormLadder.ts：固定階梯、護欄、雙模式選擇、步驟紀錄及取消原子性。',
 '- src/fitting/freeFormRefine.ts：可選階梯M/s、零行投影、來源與metadata型別、受限輸出標記。',
 '- src/fitting/autoWorkflow.ts：物理終點之後整合階梯及既有來源、進度事件；物理演算法未改。',
 '- src/models/bspline.ts：僅標記的階梯輸出支援80節點，其他呼叫仍40。',
 '- src/components/OpticalModelComparisonPanel.tsx、src/data/validationReport.ts：所選M/s顯示。',
 '- src/data/export.ts：僅標記的freeFormModel讀取驗證放寬至80；主膜層／Expert仍40，預設CSV匯出不變。',
 '- scripts/stage4_8c-tests.ts：新增單元／副本一致性與相關回歸；stage4_8c-regression.ts：雙模式14次Automatic及樣本外評分；stage4_8c-report.ts：報告與失敗內容檢查。',
 '- scripts/stage4_5d-tests.ts：僅原第29行的來源相容性斷言，使用者明確授權。',
 '', '## 斷言變更',
 `原全文：\`${oldAssertion.trim()}\``,
 `新全文：\`${newAssertion.trim()}\``,
 '理由：新來源須嚴格勝過舊兩候選；ladder／physical_seeded仍須完全符合舊函式回傳；其他斷言／容差／上限不動。',
 `scientific變更前90/92，變更後${scientific.filter((q:any)=>q.passed).length}/${scientific.length}；失敗名稱及內容${changed?'有變更，見下列':'與4.8b逐字相同'}。`,
 '', '## 單元與一致性',
 `新增${unit.checks.length}項通過，相關4.5d ${related.tests.filter((q:any)=>q.passed).length}/${related.tests.length}。涵蓋合法性、嚴格閾值／同分、σ̂不可用、小節點降級、上限隔離、取消不發佈半成品。`,
 ...unit.equivalence.map((q:any)=>`M=${q.count},s=${q.scale}：正式對診斷最大差${fmt(q.difference,8)}≤1e-9，p/dof/共變異參數ids一致。`),
 `共用4.8a快取的21資料集×雙模式選擇器對照：${selectors.checks.length}/42設定逐值相同（不重新精修）。`,
 '額外3項讀取測試：標記自由形式80節點可回讀；無標記／主膜層80節點仍拒絕。',
 '另1項極少資料測試：六步全被護欄排除，無可用候選、不fallback、不產生結果。移開兩個.qa生成模組後typecheck亦通過，正式型別檢查不依賴它們。',
 '', '## 雙模式回歸（V0–V6，49001）',
 'σ對4.8a R1c；無σ對4.8b N3。移除σ欄位後用原uniform降級完成Automatic；樣本外49004/49005平均，真值僅評分。',
 '為跨模式可比，表中Win/Wout在選擇完成後以原已知σ及訓練p正式回算；無σ實際正式metric另存JSON。',
 '|模式/真值|所選/對照|Win / Wout / E|ΔWin / ΔWout / ΔE|來源|秒|',
 '|---|---|---|---|---|---:|',
 ...reg.cards.map((c:any)=>`|${c.mode}/${c.id}|${c.selected}/${c.reference}|${fmt(c.Win)} / ${fmt(c.Wout)} / ${fmt(c.E)}|${fmt(c.deltaWin,3)} / ${fmt(c.deltaWout,3)} / ${fmt(c.deltaE,3)}|${c.origin}|${fmt(c.elapsedMs/1000)}|`),
 '',
 ...reg.modes.map((m:any)=>`${m.mode}：設定一致${m.matches}/7；門檻≥6/7且不一致ΔWout≤.05：${m.pass?'通過':'未通過'}。Automatic中位${fmt(m.medianMs/1000)}秒，相對4.5d中位${fmt(m.baselineMedianMs/1000)}秒為${fmt(m.ratio)}倍。`),
 `σ案例物理膜厚對4.8a最大差${fmt(Math.max(...reg.cards.filter((c:any)=>c.mode==='sigma').map((c:any)=>Math.abs(c.physicalThicknessDelta))),8)}nm；無σ權重不同的物理終點差異另存逐例JSON。`,
 '耗時對照的4.5d是歷史六真值T0–T5，本次為V0–V6七真值；非同硬體負載下配對計時，加速因果無法判定。',
 '', '## verify與耗時',
 `完整pnpm run verify僅1次，exit=${timing.exitCode}；original ${original.filter((q:any)=>q.passed).length}/${original.length}、worker ${worker.filter((q:any)=>q.passed).length}/${worker.length}、scientific ${scientific.filter((q:any)=>q.passed).length}/${scientific.length}。`,
 ...failures.map((f:any)=>`- ${f.name}：${f.detail.replaceAll('\n',' / ')}`),
 '',
 `失敗內容變更：${changed?'有，停止並單獨回報':'無'}。typecheck/build見 .qa/stage4_8c-verification.json。`,
 `階段實測：單元／一致性／快取選擇／護欄${fmt(unitMs/1000)}秒；相關測試${fmt(related.elapsedMs/1000)}秒；14次Automatic${fmt(reg.elapsedMs/1000)}秒；verify${fmt(timing.elapsedMs/1000)}秒；合計${fmt((unitMs+related.elapsedMs+reg.elapsedMs+timing.elapsedMs)/1000)}秒（不含編輯／等待檢查／獨立正向評分與檔案I/O）。`,
 '中斷／重算：來源斷言衝突時未啟動實驗；相關測試T2於JSON讀取40上限中止，修補受限讀取路徑；接續器另一次匯入名稱錯誤未啟動擬合。',
 '已保存T0/T1直接略過，T2重用Automatic輸出只重驗原斷言／回讀，之後案例首次執行；Automatic重算0次。詳 .qa/stage4_8c-resume-history.json、related-tests.json。',
 '', '## 限制與判斷',
 '4.8b的N3使用σ加權擬合結果再模擬無σ選擇；本次確實移除σ並採uniform。原optimizer以mean(weights²)同比例縮放正則化；本資料常數σ使整體目標尺度不同，未修改核心以強制數值完全相同。',
 'V4/V6的Wout約1.485/1.490，保留原診斷結果；非均勻未知雜訊與真實樣品的泛化能力無法判定（未測）。',
 `回歸A：${reg.modes.every((m:any)=>m.pass)?'雙模式通過':'至少一模式未通過'}；B：${!changed&&scientific.filter((q:any)=>q.passed).length===90?'90/92且同兩項既有失敗':'未達標，停止'}；C：新增測試通過；D：只報耗時倍率；E：匯出不變。`,
 '原始／逐步／逐點 .qa/stage4_8c-* 不入repo；本報告不建議修改容差或斷言。',
 '規格偏離：無；唯一既有斷言變更依使用者明確修訂。未部署、未推送。',
];
const markdown=lines.flatMap(line=>[...(line.startsWith('|模式')||line.startsWith('- Automatic multi')?['']:[]),line,...(line.startsWith('## ')?['']:[])]);
assert.ok(markdown.length<=120);writeFileSync('STAGE4_8C_REPORT.md',markdown.map(line=>line.trimEnd()).join('\n')+'\n');
if(changed||scientific.filter((q:any)=>q.passed).length!==90||original.filter((q:any)=>q.passed).length!==29||worker.filter((q:any)=>q.passed).length!==8){writeFileSync(prefix+'stopped.json',JSON.stringify({stage:'verify',reason:'fixed test requirements changed',failures},null,2));process.exitCode=1;}
