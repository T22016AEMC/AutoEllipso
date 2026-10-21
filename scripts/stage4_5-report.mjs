import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=n=>JSON.parse(readFileSync(`.qa/stage4_5-${n}.json`,'utf8'));
const f=x=>x===null||x===undefined?'N/A':typeof x==='number'?x.toPrecision(7):String(x);
const pct=x=>x===null?'N/A':(100*x).toFixed(1)+'%';
const truth=['T1','T2','T3','T4'].map(read),fixture=read('fixture-truth');
const reused=read('fixture-comparison')[0].runs.filter(r=>r.source).length;
const l=['# Stage 4.5：物理階段診斷','',
'基準9185a97，對照2d8abe9；分支v2.2-integration。只新增scripts與本報告，src、部署設定、容差、迭代上限、既有斷言皆未改。原始輸出均為本機.qa/，不在repo。',
'', '## 判定與依據', '',
'- 沒有發現「完全不使用自由形式曲線」的脫鉤：autoWorkflow.ts:1323 → registry.ts:183,197 → peakInitialization.ts:48–50，以n/k計算ε₂=2nk與ε₁=n²−k²。初始化與逐候選輸入已實際捕獲。',
'- 起點不是始終忠實保留自由形式峰：autoWorkflow.ts:387只有startIdx=0直接沿用；403的固定VUV排程、409/451/489起的形狀覆寫，357仍以自由形式ε₂參與背景/振幅配對。物理優化的殘差為Ψ/Δ，不另含自由形式曲線一致性項（1574–1591、1670–1688）。',
'- 選擇依據是全光譜weightedMse=χ²/(2N)，不是converged優先：1655排序，只精修前兩個，1703以較小成本更新，1782選模型；未對全部起點做相同的全資料精修。最終曲線不同本身不能證明未使用初始曲線。',
'', '## T1–T4 合成真值與還原', '',
'四例皆Si、100 nm、65/70/75°、190–900 nm每10 nm、σΨ=σΔ=0.03°，LCG+Box–Muller種子45001。真值由各模型現行公式逐波長產生，沒有預先指定n/k形狀。',
truth.map(t=>`${t.truth.id} / ${t.truth.model}：${JSON.stringify(t.truth.values)}；其他未列參數為該模型預設，完整真值字典在.qa/stage4_5-${t.truth.id}.json。`).join('；'),'',
'診斷分區：真值k≥0.001為吸收區，k<0.001為近透明區，只供列表，不進入擬合。n/k誤差是逐唯一波長的絕對差（不是除以近零真值）；72個波長。無樣本區域列N/A。', '',
'| 案例 | 自由形式d−100 nm / MSE_W | 物理d−100 nm / MSE_W | 自由/物理converged,status | 完整流程秒 |',
'|---|---|---|---|---|'];
for(const t of truth){const free=t.output.fittingResult.bsplineDiagnostic.knotRefinementHistory.find(s=>s.selected);l.push(`| ${t.truth.id} | ${f(t.output.fittingResult.freeFormModel.layers[0].thickness-100)} / ${f(t.output.fittingResult.opticalModelComparison.freeForm.mseWoollam)} | ${f(t.thicknessError)} / ${f(t.mseWoollam)} | ${free.converged}/${free.status}；${t.converged}/${t.status} | ${f(t.elapsedMs/1000)} |`);}
l.push('', '| 案例/區域(點數) | 自由n max/RMS | 自由k max/RMS | 物理n max/RMS | 物理k max/RMS | 自由k ±2σ涵蓋率/可用σ數 |',
'|---|---|---|---|---|---|');
for(const t of truth)for(const e of t.errors)l.push(`| ${t.truth.id}/${e.region}(${e.free.count}) | ${f(e.free.nMax)}/${f(e.free.nRms)} | ${f(e.free.kMax)}/${f(e.free.kRms)} | ${f(e.physical.nMax)}/${f(e.physical.nRms)} | ${f(e.physical.kMax)}/${f(e.physical.kRms)} | ${pct(e.free.coverage)}/${e.free.sigmaAvailable} |`);
l.push('涵蓋率分母僅含可用σ_k的波長，真值k與擬合k逐波長直接比較；沒有σ者不視為涵蓋。不是Monte-Carlo覆蓋率，也不能據單一雜訊實例判定統計可信度。',
'', '## 每個參數的起點／終點、邊界', '',
'下表為被選start在初次物理多起點優化前的值 → 最終值 [下界,上界]；!為距界u<1e-3，F為未擬合。不是將最後精修起點冒充最初起點。',
'| 案例/被選start | 參數 |', '|---|---|');
for(const t of truth){const chosen=t.diagnostics.find(d=>d.kind==='selected').state.startIndex;l.push(`| ${t.truth.id}/#${chosen} | ${t.parametersDetailed.map(p=>`${p.id}:${f(p.initial)}→${f(p.final)}[${f(p.min)},${f(p.max)}]${p.boundary?'!':''}${p.fit?'':'F'}`).join('；')} |`);}
l.push('所有24個起點、參數、界限、初次終點、兩個最終精修與選擇結果：.qa/stage4_5-T{1,2,3,4}.json（calls與diagnostics欄位）。未啟用振子的A=0亦列出，不能把F項的邊界視為擬合失敗。',
'', '## T2、T3 起點敏感度', '',
'使用Automatic #1的模型／自由參數集合與界限；真值、全部數值±20%（含膜厚，零仍為零）、#1原起點，分別以原全資料精修設定maxIterations=100、tolerance=1e-6呼叫正式optimizer。沒有修改正式容差或上限。成本C=χ²/(2N)，非MSE_W。', '',
'| 案例/起點 | C初→終 | converged/status/迭代 | 終點參數（順序見原始variables） |', '|---|---|---|---|');
for(const id of ['T2','T3'])for(const e of read(id+'-sensitivity'))l.push(`| ${id}/${e.label} | ${f(e.initialCost)}→${f(e.result.finalWeightedCost)} | ${e.result.converged}/${e.result.status}/${e.result.iterations} | ${e.variables.map((v,i)=>`${v.id}=${f(e.result.finalParams[i])}`).join('; ')} |`);
for(const id of ['T2','T3']){const es=read(id+'-sensitivity'),cs=es.map(e=>e.result.finalWeightedCost),check=read(id+'-read-only-check');l.push(`${id}四起點終成本範圍[${f(Math.min(...cs))},${f(Math.max(...cs))}]；被選精修同原closure/options重放：${check.bitIdentical===true?'參數、成本、status、迭代、converged逐值相同':check.warning}。`);}
l.push('T2四起點成本只差約8.1e-10，未見本試驗的起點障礙；T3成本約0.9512–0.9611，有小幅局部路徑差。真值均在既有邊界內，這些實驗沒有顯示真值被模型族或邊界排除；不等於其他資料不會受起點影響。');
l.push('這些是有限組局部起點試驗：不同終點可證明本實驗的起點影響，不能證明全域最小或唯一可辨識性；若真值起點能達到較低成本，不能將較差終點直接歸咎模型族/邊界。',
'', '## Lorentz退步：兩版候選與原解重放', '',
'| 案例/版本 | 前兩名start（初次全資料成本） | 最終被選start / C / MSE_W | 兩個精修迭代 |', '|---|---|---|---|');
for(const scenario of ['SiO2','transparent'])for(const label of ['before','after']) {
 const r=read(`lorentz-${scenario}-${label}`),d=r.diagnostics.find(d=>d.kind==='starts'),win=r.diagnostics.find(d=>d.kind==='selected').state,sorted=[...d.states].sort((a,b)=>a.weightedMse-b.weightedMse);
 l.push(`| ${scenario}/${label} | ${sorted.slice(0,2).map(s=>'#'+s.startIndex+'('+f(s.weightedMse)+')').join(',')} | #${win.startIndex}/${f(win.weightedMse)}/${f(r.mseWoollam)} | ${r.calls.filter(c=>c.options.maxIterations===100&&c.options.tolerance===1e-6).map(c=>c.result.iterations).join(',')} |`);
}
l.push('全部候選逐起點/終點/成本/迭代/選中標記與界限：.qa/stage4_5-lorentz-{SiO2,transparent}-candidates.{json,log}；每筆另含兩個精修完整初值與終點。',
'| 案例/9185a97重放起點 | C初→終 | converged/status/迭代 |', '|---|---|---|');
for(const s of ['SiO2','transparent'])for(const e of read('lorentz-'+s+'-replays'))l.push(`| ${s}/${e.label} | ${f(e.initialCost)}→${f(e.result.finalWeightedCost)} | ${e.result.converged}/${e.result.status}/${e.result.iterations} |`);
l.push('');
for(const s of ['SiO2','transparent']) {
 const before=read(`lorentz-${s}-before`),after=read(`lorentz-${s}-after`),db=before.diagnostics.find(d=>d.kind==='starts'),da=after.diagnostics.find(d=>d.kind==='starts');
 const spectrumDiff=Math.max(...db.spectrum.flatMap((p,i)=>['n','k'].map(k=>Math.abs(p[k]-da.spectrum[i][k]))));
 const baseDiff=Object.keys(db.basePhysicalParams).filter(k=>db.basePhysicalParams[k].current!==da.basePhysicalParams[k].current);
 l.push(`${s}自由形式輸入最大n/k差=${f(spectrumDiff)}；基礎物理初值變動欄位=${baseDiff.join(',')||'無'}。索引未變時也不代表同一終點；候選選擇表與所有起終值一起判讀。`);
 const old=read(`lorentz-${s}-before`).diagnostics.find(d=>d.kind==='selected').state,es=read('lorentz-'+s+'-replays'),r=es[0];
 const former=db.states.find(x=>x.startIndex===old.startIndex),now=da.states.find(x=>x.startIndex===old.startIndex),rank=[...da.states].sort((a,b)=>a.weightedMse-b.weightedMse).findIndex(x=>x.startIndex===old.startIndex)+1;
 l.push(`${s}原winner #${old.startIndex}：新粗排序第${rank}；同索引初始厚度${f(former.initialThickness)}→${f(now.initialThickness)}，粗終成本${f(former.weightedMse)}→${f(now.weightedMse)}。基礎eps_inf=${f(db.basePhysicalParams.eps_inf.current)}→${f(da.basePhysicalParams.eps_inf.current)}；小振子參與背景扣除與後續有限步搜尋同時改變，無法單獨歸因各因素比例。`);
 l.push(`${s}：新模型在原解上的C差=${f(r.initialCost-old.weightedMse)}；重放終成本相對原解差=${f(r.result.finalWeightedCost-old.weightedMse)}。${r.initialCost<=old.weightedMse+1e-9?'原較低成本點在新模型仍可達；退步至少包含搜尋路徑/有限精修候選因素。':'原解點的新響應有差；僅此結果不能排除模型響應變更因素。'}更細的逐步分歧及保證改善的修法，無法判定。`);
}
l.push('', '## TL與Multi-Oscillator補回歸', '',
'| target/案例 | MSE_W 2d8→9185 | 膜厚nm 2d8→9185 | converged 2d8→9185 | ΔMSE_W |', '|---|---|---|---|---|');
for(const model of ['tauc_lorentz','multi_oscillator'])for(const r of read('reg-'+model+'-comparison')){const[a,b]=r.runs;l.push(`| ${model}/${r.scenario} | ${f(a.mseWoollam)}→${f(b.mseWoollam)} | ${f(a.thickness)}→${f(b.thickness)} | ${a.converged}→${b.converged} | ${f(b.mseWoollam-a.mseWoollam)}${r.mseIncreased?' **上升**':''} |`);}
l.push('', '## SiO₂ fixture真值與厚度誤差', '',
`createMultiAoiSiO2OnSiProject為合成資料，defaultProjects.ts:191–217：真厚100 nm；Cauchy參數${JSON.stringify(fixture.parameters)}。n=1.457+0.0035/λ_µm²+0.0001/λ_µm⁴，k=0，並非全波段n=1.457常數；生成雜訊σ=0.04°。完整72點真值與基板設定見.qa/stage4_5-fixture-truth.json；基材為該fixture既有tabulated_si模型。`,
`真值n/k示例：${fixture.optics.filter(p=>[190,400,600,900].includes(p.wavelength)).map(p=>`${p.wavelength}nm=${f(p.n)}/${f(p.k)}`).join('；')}。`,
'| target | d−100 nm，2d8→9185 |', '|---|---|');
for(const model of ['gaussian','lorentz','tauc_lorentz','multi_oscillator']) {
 const record=read(model==='gaussian'?'fixture-comparison':model==='lorentz'?'lorentz-comparison':'reg-'+model+'-comparison').find(r=>r.scenario==='SiO2');
 l.push(`| ${model} | ${f(record.runs[0].thickness-100)}→${f(record.runs[1].thickness-100)} |`);
}
l.push(`Gaussian fixture ${reused}筆沿用已釘定版本的4.4c本機原始輸出、${2-reused}筆本段重跑；其餘本段重跑。不能把Cauchy生成資料自動當成Gaussian/Lorentz真值，也不能據模型名稱斷定有限頻帶可表示程度。`,
'', '## 驗證與判斷限制', '');
const v=JSON.parse(readFileSync('.qa/verification-summary.json','utf8')),tests=JSON.parse(readFileSync('.qa/scientific-tests.json','utf8'));
l.push(`pnpm run verify：${v.commands.map(c=>c.name+' exit '+c.exitCode).join('；')}。scientific ${tests.filter(t=>t.passed).length}/${tests.length}；original 29/29，worker 8/8。`);
for(const t of tests.filter(t=>!t.passed))l.push(`- ${t.name}：${t.detail.replaceAll('\n',' ')}。`);
l.push(`正式數值未改；兩項仍為4.4c同樣的SiO₂歷史厚度斷言，不處理。原始verify：.qa/stage4_5-verify.log與v2-*.log；本段診斷新跑${26-reused}次完整Automatic（4真值＋16補回歸＋4 Lorentz調查＋${2-reused} Gaussian fixture）；${reused}筆重用4.4c，不列新執行。`,
'對「可由程式修正」的限度：原較低成本解若可在新模型重現，就有搜尋路徑層面的改進空間；本段未實作或測出保證修法。對「屬資料本身可辨識度限制」：單種子與有限起點不足以作此歸因，無法判定；沒有建議調容差或改斷言。',
'T1–T4全參數、曲線、σ與初始化輸入：.qa/stage4_5-T*.json；敏感度：T{2,3}-sensitivity.json；補回歸：stage4_5-{model}-{case}-{before,after}.json。所有耗時為多組並行的當次牆鐘時間，非獨佔效能基準。');
const paragraphs=[];
const plain=s=>s&& !/^(#|\||-|```)/.test(s);
for(const line of l) {
 if(plain(line)&&plain(paragraphs.at(-1)))paragraphs[paragraphs.length-1]+=' '+line;
 else paragraphs.push(line);
}
const formatted=[];
for(const line of paragraphs) {
 const previous=formatted.at(-1);
 if(previous&&line&&((previous.startsWith('|')&&!line.startsWith('|'))||(!previous.startsWith('|')&&line.startsWith('|'))||(plain(previous)&&line.startsWith('- '))||(previous.startsWith('- ')&&plain(line))))formatted.push('');
 formatted.push(line);
}
const report=formatted.join('\n'),lineCount=formatted.length;
assert.ok(lineCount<=120,'Report lines '+lineCount);writeFileSync('STAGE4_5_REPORT.md',report+'\n');console.log('Report '+lineCount+' lines');
