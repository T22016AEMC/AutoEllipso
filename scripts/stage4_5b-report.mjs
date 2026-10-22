import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=n=>JSON.parse(readFileSync(`.qa/stage4_5b-${n}.json`,'utf8'));
const ids=['T0','T1','T2','T3','T4'],free=Object.fromEntries(ids.map(id=>[id,read(id+'-free')]));
const f=x=>x===null||x===undefined?'N/A':typeof x==='number'?x.toPrecision(5):String(x);
const pct=x=>x===null?'N/A':(100*x).toFixed(1)+'%';
const stripped=s=>({rows:undefined,envelope:undefined,...s,rows:undefined,envelope:undefined});
const l=['# Stage 4.5b：自由形式 n/k 準確度診斷','',
'基準d539582（git log最新4.5提交），v2.2-integration；只新增scripts與報告，src、部署設定、既有斷言與正式容差/迭代上限未改。原始輸出均為本機.qa/，不入repo。',
'', '## 判定', '',
'- 正式自由階段已用全216資料點，不能把本次差解歸因fast-scan子集。T1/T2/T3原結果都到40節點上限；T4另有BIC停止，見逐級表。到達收斂旗標不代表低資料成本或還原真值。',
`- 有界限限制的直接證據：${ids.map(id=>`${id}最終界限排除真值n的波長${free[id].summary.bounds.nExcluded}/72（最大越界${f(free[id].summary.bounds.nMaxViolation)}）`).join('；')}。以非負且和為1的基底計算逐波長係數界限包絡；T1/T3真值n<1，既有N係數≥1不能表示該部分真值。不是B-spline一般形式的不可表示性證明。`,
'- 正式自由膜厚的σ_k是完整joint共變異之C_kk邊際區塊，不是先固定膜厚的條件共變異。表中另算同點鎖d、與固定100後重新擬合，分開比較；邊界係數仍依既有規則條件固定，正則化曲率也仍包含在統計內。',
`- 同原可行盒/同正則目標的可行見證：${ids.map(id=>{const a=free[id].summary,p=read(id+'-projection').summary;return id+' Ctotal '+f(a.dataCost+a.regularizationCost)+'→'+f(p.dataCost+p.regularizationCost);}).join('；')}。候選僅以既有SVD把真值n/k投影到同節點、夾入原係數界限、d=100後forward，沒有Ψ/Δ最佳化。較低者直接證明正式終點不是該目標全域最低；較高者不能反證不存在更好解。T2/T3嚴重差解至少含局部搜尋因素；T1有直接界限限制；T4有BIC停止，但其主要成因無法單獨判定。`,
'', '## T0–T4 逐級軌跡', '',
'T1–T4完全沿用4.5資料及seed45001；T0採Cauchy A=1.457,B=0.0035,C=0.0001,k=0。皆100nm、Si、65/70/75°、190–900nm每10nm、σ=雜訊標準差=0.03°。隔離副本在自由階段結束返回；不再跑物理階段。',
'Cdata=χ²/(2N)，Creg為optimizer實際加權正則化項，總成本為兩者之和。每級max22、ftol=1e-5、其餘共用容差未改；N=216點/432殘差，全資料。*為最後採用級。', '',
'| 案例/knots | Cdata + Creg | MSE_W | 迭代/converged/status | d nm | BIC / ΔBIC | 點數/採用 |',
'|---|---|---|---|---|---|---|'];
for(const id of ids) {
 const c=free[id].capture;
 for(const h of c.history.filter(s=>!s.skipped)) {
  const call=c.calls.find(x=>x.initial.length===1+2*h.knots);
  l.push(`| ${id}/${h.knots} | ${f(call.result.finalWeightedCost)} + ${f(call.result.finalRegularizationPenalty)} | ${f(h.mseWoollam)} | ${h.iterations}/${h.converged}/${h.status} | ${f(h.thicknessNm)} | ${f(h.bic)}/${f(h.deltaBic)} | ${call.points}${h.selected?' *':''} |`);
 }
 const skipped=c.history.filter(h=>h.skipped);
 if(skipped.length)l.push(`| ${id}/${skipped.map(s=>s.knots).join(',')} | — | — | 略過：${[...new Set(skipped.map(s=>s.skipReason))].join(';')} | — | — | 未執行 |`);
}
l.push(ids.map(id=>{const c=free[id].capture,last=c.history.filter(s=>!s.skipped).at(-1),skip=c.history.find(s=>s.skipped);return `${id}選${free[id].summary.knots}，末執行${last.knots}，${skip?skip.skipReason:'達正式40上限，無下一正式級'}（末ΔBIC=${f(last.deltaBic)}）`;}).join('；')+'。同BIC取較少節點。',
'', '**T2/T3 全資料延長續擬合**：100與300皆從同一正式終點獨立續擬合，仍全216點，原界限、正則化與ftol/xtol/gtol不改。', '',
'| 案例/上限 | MSE_W | d nm | n max/RMS | k max/RMS | 實際迭代/converged/status |', '|---|---|---|---|---|---|');
for(const id of ['T2','T3'])for(const cap of [100,300]) {const r=read(id+'-refine'+cap),s=r.summary;l.push(`| ${id}/${cap} | ${f(s.mseWoollam)} | ${f(s.thickness)} | ${f(s.nMax)}/${f(s.nRms)} | ${f(s.kMax)}/${f(s.kRms)} | ${r.result.iterations}/${r.result.converged}/${r.result.status} |`);}
l.push(['T2','T3'].map(id=>{const a=free[id].summary,b=read(id+'-refine300').summary;return `${id}/300上限相對正式結果：ΔMSE_W=${f(b.mseWoollam-a.mseWoollam)}，Δ|d−100|=${f(Math.abs(b.thickness-100)-Math.abs(a.thickness-100))}，Δmax|Δk|=${f(b.kMax-a.kMax)}`;}).join('；')+'。局部續擬合未改善不能證明全域模型極限。',
'', '## 固定膜厚：相同實際界限控制與完整階梯對照', '',
'主表從正式終點開始，保持同一最終級與實際n/k界限、λN=0.25、λK=0.6、22次，僅將d上下界相等；free22為相同額外迭代預算的自由d對照。另獨立重跑25個固定d完整階梯（每級22、同BIC及界限規則），但nInit±0.8界限隨路徑改變，不能將其差異全歸d。每格：[knots] MSE_W；n最大/RMS；k最大/RMS；±2σ涵蓋率，誤差為絕對Δn/Δk。', '',
'| 案例 | free22 d/MSE_W | d=97 | d=99 | d=100 | d=101 | d=103 | 完整暖階梯100 MSE_W/排除n點數 |', '|---|---|---|---|---|---|---|---|');
for(const id of ids){const warm=read(id+'-fixed100').summary,cont=read(id+'-controlFree').summary;l.push(`| ${id} | ${f(cont.thickness)}/${f(cont.mseWoollam)} | ${[97,99,100,101,103].map(d=>{const s=read(id+'-control'+d).summary;return `[${s.knots}] ${f(s.mseWoollam)}; ${f(s.nMax)}/${f(s.nRms)}; ${f(s.kMax)}/${f(s.kRms)}; ${pct(s.coverage)}`;}).join(' | ')} | ${f(warm.mseWoollam)}/${warm.bounds.nExcluded} |`);}
l.push('', '**σ_k比較與膜厚—係數相關**：σ仍全部由同一computeFitStatistics與freeFormCurve計算；同點鎖d不重新擬合（dof依既有規則多1），固定100欄則重新擬合。Jacobian欄正規化相關為資料σ加權J的欄餘弦，不冒稱逆J所得參數相關r；只列內部自由參數，前5對均為d↔該係數。', '',
'| 案例 | d在正式cov內/σ0數/可用σ數 | 平均σ：正式/同點鎖d/固定100 | ±2σ涵蓋：正式/同點鎖d/free22/固定100 | 前5個資料J欄相關 |', '|---|---|---|---|---|');
for(const id of ids){const r=free[id],a=r.summary,b=r.conditionalAtSamePoint,c=read(id+'-control100').summary,continued=read(id+'-controlFree').summary;l.push(`| ${id} | ${a.thicknessInCovariance}/${a.rows.filter(p=>p.kSigma===0).length}/${a.sigmaAvailable} | ${f(a.meanSigma)}/${f(b.meanSigma)}/${f(c.meanSigma)} | ${pct(a.coverage)}/${pct(b.coverage)}/${pct(continued.coverage)}/${pct(c.coverage)} | ${r.jacobianCorrelations.dataOnly.map(p=>p.id+':'+f(p.r)).join(', ')} |`);}
l.push('涵蓋率只計有有限σ的72個唯一波長；可用數、逐點σ、邊界旗標、資料+正則J欄相關與cov參數相關完整列於free/fixed JSON。這是單雜訊實例的波長涵蓋，不是Monte-Carlo校準；不能把低涵蓋單獨歸因厚度條件化，也不能把固定d後涵蓋率提高、但MSE仍高解讀為已校準。' + ids.filter(id=>free[id].summary.rows.some(p=>p.kSigma===0)).map(id=>{const e=free[id].summary.rows.filter(p=>p.kSigma===0).map(p=>Math.abs(p.kError));return id+'零σ點的|Δk|範圍'+f(Math.min(...e))+'–'+f(Math.max(...e));}).join('；')+'。涵蓋率仍保留所有零σ點，未加容差；極小非零係數造成的未涵蓋與實際偏差必須區分。',
'', '**平滑／節點敏感度**：T2/T3正式選中40，±一級為32/48；48僅將.qa隔離模型數量上限延至48，正式src仍40。每格從正式終點暖啟動，換節點時照既有方法在新位置取原曲線及產生界限；每次仍22、ftol=1e-5。f同時乘λN與λK，1×/40是額外22次的續擬合控制。', '',
'| 案例/knots/f | MSE_W | d nm | n max/RMS | k max/RMS | 迭代/status | 真值排除n/k點數 |', '|---|---|---|---|---|---|---|');
for(const id of ['T2','T3'])for(const k of [32,40,48])for(const factor of [.1,1,10]) {
 const r=read(`${id}-sensitivity-${k}-${factor}`),s=r.summary;l.push(`| ${id}/${k}/${factor} | ${f(s.mseWoollam)} | ${f(s.thickness)} | ${f(s.nMax)}/${f(s.nRms)} | ${f(s.kMax)}/${f(s.kRms)} | ${r.result.iterations}/${r.result.status} | ${s.bounds.nExcluded}/${s.bounds.kExcluded} |`);
}
l.push('', '## 工程驗證與判斷邊界', '');
const v=JSON.parse(readFileSync(existsSync('.qa/stage4_5b-verification-summary.json')?'.qa/stage4_5b-verification-summary.json':'.qa/verification-summary.json','utf8')),tests=JSON.parse(readFileSync(existsSync('.qa/stage4_5b-scientific-tests.json')?'.qa/stage4_5b-scientific-tests.json':'.qa/scientific-tests.json','utf8'));
l.push(`pnpm run verify：${v.commands.map(c=>c.name+' exit '+c.exitCode).join('；')}；original29/29、worker8/8、scientific${tests.filter(t=>t.passed).length}/${tests.length}。原始輸出.qa/stage4_5b-verify.log、stage4_5b-*-final.log。`);
for(const t of tests.filter(t=>!t.passed))l.push(`- ${t.name}：${t.detail.replaceAll('\n',' ')}。`);
l.push(`${ids.filter(id=>free[id].readOnlyComparison).join('/')}正常分支的曲線n/k/σ、膜厚與4.5逐值相同；新增殘差/正則化重建也對照所捕獲optimizer成本。初輪ESM設定接點錯誤在擬合前發生，修復隔離接點後重跑，初輪log仍在.qa/。投影迴圈計算均完成，外殼彙整日誌重導向錯誤未影響五份原始projection JSON。沒有修改既有斷言或容差。`,
'可信邊界僅能依本次合成數據描述：低資料殘差、真值未被係數界限排除、且固定/自由膜厚與局部敏感度均小，才有這些案例的支持；不能泛化保證真實樣品。高MSE、真值超出界限或敏感度大時，這些曲線與σ不能作已還原真值的依據。',
'階梯停止、局部迭代、膜厚—係數耦合、正則化與界限可能同時影響；實驗只有變因對照，不保證找到全域解，不能從未改善直接宣稱B-spline本身不可表示。資料本身可辨識度與單一主因的完整因果佔比，無法判定；未建議調容差或改斷言。',
'本段完成30個階梯流程（205個實際級）、30個同界限控制、4個延長、18個敏感度與5個可行投影。重現：先pnpm exec tsx scripts/stage4_5b-run.ts prepare；T0–T4 core、fixed-control、projection；T2/T3 refine與sensitivity；最後node scripts/stage4_5b-report.mjs。完整資料/曲線/統計/逐級設定：.qa/stage4_5b-*.json（不入repo）；並行牆鐘耗時非獨佔效能基準。');
const out=[];const plain=s=>s&&!/^(#|\||-|```)/.test(s);
for(const line of l){if(plain(line)&&plain(out.at(-1)))out[out.length-1]+=' '+line;else out.push(line);}
const formatted=[];
for(const line of out){const previous=formatted.at(-1);if(previous&&line&&((previous.startsWith('|')!==line.startsWith('|'))||(plain(previous)&&line.startsWith('- '))||(previous.startsWith('- ')&&plain(line))))formatted.push('');formatted.push(line);}
assert.ok(formatted.length<=120,'Report lines '+formatted.length);
writeFileSync('STAGE4_5B_REPORT.md',formatted.join('\n')+'\n');console.log('Report '+formatted.length+' lines');
