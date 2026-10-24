import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {settings,grid,read,save,data,rms,mean} from './stage4_6d-run';

const fmt=(v:number|null|undefined)=>v==null?'NA':v===0?'0':Math.abs(v)<.001||Math.abs(v)>=1e5?v.toExponential(2):v.toFixed(4);
const minimum=(rows:any[],key:(r:any)=>number)=>rows.reduce((a,b)=>key(b)<key(a)?b:a);
const primary:any[]=[],summary:any[]=[],selection:any[]=[],sparse:any[]=[];
for(const id of settings.truths){const f=data(id,45001);
 const rows=grid.map(g=>{const seeds=settings.seeds.map(seed=>read(`${id}-${seed}-${g.id}`));for(const r of seeds){assert.equal(r.setting.id,g.id);assert.equal(r.out.curve.length,72);assert.ok(r.out.curve.every((p:any)=>Number.isFinite(p.n)&&Number.isFinite(p.k)&&p.k>=0));}
  const r=seeds[0],variation=Object.fromEntries(['n','k'].map(key=>{const averages=f.optics.map((_:any,i:number)=>mean(seeds.map(s=>s.out.curve[i][key]))!),sd=f.optics.map((_:any,i:number)=>Math.sqrt(seeds.reduce((sum,s)=>sum+(s.out.curve[i][key]-averages[i])**2,0)/2));return[key,{sdRms:rms(sd),bias:rms(averages.map((v:number,i:number)=>v-f.optics[i][key]))}];}));
  const oosW=mean(r.oos.map((m:any)=>m.mseWoollam))!,coverage=mean(seeds.map(s=>s.score.regions.all.coverage).filter(v=>v!==null)),sigmaAvailable=seeds.map(s=>s.score.regions.all.sigmaAvailable);
  const row={...r,out:undefined,variation,oosW,gap:oosW-r.metrics.mseWoollam,coverage,sigmaAvailable,allSeedSeconds:seeds.map(s=>s.elapsedMs/1000),statuses:seeds.map(s=>`${s.iterations}:${s.status}:${s.converged}`),seedScores:seeds.map(s=>s.score),seedMetrics:seeds.map(s=>s.metrics),cvSeconds:r.cv.reduce((s:number,c:any)=>s+c.elapsedMs/1000,0)};primary.push(row);return row;
 });
 const current=rows.find(r=>r.setting.id==='40Ws1')!,best=minimum(rows,r=>r.score.error),worst=minimum(rows,r=>-r.score.error),oos=minimum(rows,r=>r.oosW),W=minimum(rows,r=>r.metrics.mseWoollam);
 for(const rule of ['BIC','AIC','CV']){const chosen=minimum(rows,r=>rule==='CV'?r.cvScore:r.criteria[rule.toLowerCase()]),error=chosen.score.error;selection.push({id,rule,chosen:chosen.setting.id,error,delta:error-best.score.error,relative:error/best.score.error,near:error<=1.1*best.score.error+.0001,oosW:chosen.oosW,thickness:chosen.score.thicknessError,best:best.setting.id});}
 const oneFactor=['120Ws1','40Es1','40Ws0.01'].map(key=>{const r=rows.find(r=>r.setting.id===key)!;return {id:key,W:r.metrics.mseWoollam,deltaW:r.metrics.mseWoollam-current.metrics.mseWoollam,E:r.score.error,oos:r.oosW};});
 summary.push({id,current:current.setting.id,best:best.setting.id,worst:worst.setting.id,oos:oos.setting.id,minimumW:W.setting.id,oneFactor,notableGap:rows.filter(r=>r.gap>.2).map(r=>r.setting.id),notableVariance:rows.filter(r=>r.variation.n.sdRms>2*current.variation.n.sdRms||r.variation.k.sdRms>2*current.variation.k.sdRms).map(r=>r.setting.id),simultaneous:rows.filter(r=>r.score.error<current.score.error&&r.oosW<current.oosW).map(r=>r.setting.id)});
 if(['T2','T3','T4'].includes(id))for(const g of grid.filter(g=>g.count>=80&&g.scale===.01)){const r=read(`${id}-sparse-${g.id}`);sparse.push({...r,out:undefined,status:r.out.result.status,converged:r.out.result.converged,iterations:r.out.result.iterations,available:r.out.statistics.available,dof:r.out.statistics.dof,effective:r.out.statistics.covariance.ids.length,roughness:r.score.roughness});}
}
assert.equal(primary.length,144);assert.equal(sparse.length,12);
const timings=grid.map(g=>{const rows=primary.filter(r=>r.setting.id===g.id),seconds=rows.flatMap(r=>r.allSeedSeconds);return {id:g.id,mean:mean(seconds),min:Math.min(...seconds),max:Math.max(...seconds),total:seconds.reduce((s,v)=>s+v,0),cv:rows.reduce((s,r)=>s+r.cvSeconds,0)};});
save('complete-summary',{settings,primary,summary,selection,sparse,timings});
const flat=primary.map(r=>({truth:r.id,setting:r.setting.id,W:r.metrics.mseWoollam,chiSquarePerN:r.metrics.weightedMse,total:r.totalCost,p:r.effective,AIC:r.criteria.aic,BIC:r.criteria.bic,E:r.score.error,nMax:r.score.regions.all.nMax,nRMS:r.score.regions.all.nRms,kMax:r.score.regions.all.kMax,kRMS:r.score.regions.all.kRms,dError:r.score.thicknessError,oos:r.oosW,gap:r.gap,cv:r.cvScore,nSD:r.variation.n.sdRms,kSD:r.variation.k.sdRms,nBias:r.variation.n.bias,kBias:r.variation.k.bias,coverage:r.coverage,roughN:r.score.roughness.n.ratio,roughK:r.score.roughness.k.ratio,seconds:r.elapsedMs/1000,iterations:r.iterations,status:r.status,converged:r.converged}));
writeFileSync('.qa/stage4_6d-complete-summary.csv',[Object.keys(flat[0]).join(','),...flat.map(r=>Object.values(r).join(','))].join('\n')+'\n');
const get=(id:string,key:string)=>primary.find(r=>r.id===id&&r.setting.id===key)!;
const lines=[
 '# Stage 4.6d：自由形式殘差下限診斷', '',
 `基準 \`${settings.base}\`；僅診斷腳本與本報告，src/、正式容差/上限、既有斷言及部署設定未變。原始輸出均在本機 \`.qa/stage4_6d-*\`，不入 repo。`,
 '以下網格與評分於跑資料前寫入本報告及 settings.json，未依結果調整；真值只評分。W 表示正式 MSE_W=sqrt(χ²/dof)，並非 χ²/N。',
 '固定網格：M=40/60/80/120 × 等距波長W/光子能量E × s=.01/.1/1，共24組；λN=.25s、λK=.6s；全資料100次、ftol=1e-5、既有xtol/gtol；n=.5–5.5、k=0–3.5、d=40–200。',
 'E分佈：1/λ等距後以波長遞增排列，仍用正式波長cubicBasis；二階係數差分無間距正規化，因此M/分佈同時改變隱含先驗，不能完全拆開表示與正則化。',
 '正式SVD不接受波長數<M的投影；診斷副本以零方程補足行數，維持同一最小範數問題與既有rcond。初次CV因此中止，修正後重驗基準並重跑；未調設定網格或評分。',
 '資料：T0 Cauchy k0=0、T1 TL、T2 Gaussian、T3 Lorentz、T4雙Gaussian、T5=T0 n加700–900nm線性k至.02；參數沿用4.5/4.5c；Si/100nm、65/70/75°、190–900每10nm、σ=.03°；三種子45001–45003。',
 '18次完整正式Automatic串行各跑一次；T1–T4匹配target，T0/T5沿用gaussian（Automatic把Cauchy固定作前處理並回退Gaussian，T5無對應正式族）。每個資料集所有設定從同一物理終點updatedLayers出發。',
 `先以4.5d六例保存物理起點重跑：排除elapsedMs，副本對正式函式逐值最大差 ${fmt(Math.max(...read('equivalence').map((r:any)=>r.difference)))}；歷史係數/W/曲線/統計/模型/係數邊界最大差 ${fmt(Math.max(...read('equivalence').map((r:any)=>r.historicalDifference)))}，皆≤1e-9。副本避開正式bspline 40上限，用相同TMM殘差回算並獨立驗證χ²。`,
 'p沿用computeFitStatistics covariance.ids.length（排除邊界，並非平滑器有效自由度）；AIC=N ln(rawRSS/N)+2p、BIC=N ln(rawRSS/N)+p lnN，採compareOpticalModels raw-RSS慣例，不四捨五入選解；N=432，未評估階梯sigma-BIC的χ²公式。',
 '固定真值評分E=sqrt((nRMS²+kRMS²)/2)，膜厚另列；相近定義E≤1.10×最佳E+.0001（只分類）。區域k≥.001/近透明的n/k max/RMS均存完整JSON；缺區域=NA。',
 '樣本外：45001擬合曲線/膜厚對45002/3各算W，沿用訓練p後平均；gap=Wout−Win，>0.2標記明顯。另存χ²/N避免dof混淆。這是相同光譜格點的獨立雜訊重複。',
 'CV固定為45001整波長兩折交錯留出（同波長三AOI同折），每折精修補集，選sqrt(Σχ²heldout/Nheldout)最低；45002/3不參與選擇。共用全資料P1有初始化洩漏，CV不是完全獨立端到端驗證。',
 '變異為三種子曲線逐波長樣本SD的RMS；偏差為三種子平均對真值RMS；任一SD>現行2倍標記。±2σ涵蓋率用正式statistics/freeFormCurve有限kSigma，先各種子計算再平均，缺失另計。',
 '粗糙度為全10nm格點曲線二階差分L2範數/真值範數，n/k分列；真值範數0則比值NA並保留絕對範數。粗糙度僅量測格點，無法排除格點間振盪。',
 '',
 '主種子摘要：每真值現行／E最佳／E最差三列；完整6×24與432次擬合、區域誤差、σ可用數、狀態與CV逐折在complete-summary.json/csv及逐設定JSON。',
 '|真值/類別|設定|W / χ²/N|E; n(max/RMS); k(max/RMS)|d誤差nm|Wout|成本/p|AIC/BIC|次:status:收斂|',
 '|---|---|---:|---:|---:|---:|---:|---:|---|',
];
for(const s of summary)for(const [label,key] of [['現行',s.current],['最佳',s.best],['最差',s.worst]]){const r=get(s.id,key),a=r.score.regions.all;lines.push(`|${s.id}/${label}|${key}|${fmt(r.metrics.mseWoollam)}/${fmt(r.metrics.weightedMse)}|${fmt(r.score.error)};${fmt(a.nMax)}/${fmt(a.nRms)};${fmt(a.kMax)}/${fmt(a.kRms)}|${fmt(r.score.thicknessError)}|${fmt(r.oosW)}|${fmt(r.totalCost)}/${r.effective}|${fmt(r.criteria.aic)}/${fmt(r.criteria.bic)}|${r.iterations}:${r.status}:${r.converged?'Y':'N'}|`);}
lines.push('', '單因子比較：現行40Ws1→120Ws1（M）、40Es1（分佈）、40Ws.01（平滑）；各欄W（相對現行Δ）。最佳樣本外由獨立種子評分，沒有拿來選AIC/BIC/CV。', '|真值|現行W|M|分佈|平滑|最低W設定:W|最佳Wout設定:Wout/E|同時改善E及Wout組數|', '|---|---:|---:|---:|---:|---|---|---:|');
for(const s of summary){const b=get(s.id,s.minimumW),o=get(s.id,s.oos);lines.push(`|${s.id}|${fmt(get(s.id,s.current).metrics.mseWoollam)}|${s.oneFactor.map((r:any)=>`${fmt(r.W)}(${fmt(r.deltaW)})`).join('|')}|${b.setting.id}:${fmt(b.metrics.mseWoollam)}(Δ${fmt(b.metrics.mseWoollam-get(s.id,s.current).metrics.mseWoollam)})|${o.setting.id}:${fmt(o.oosW)}/${fmt(o.score.error)}|${s.simultaneous.length}|`);}
lines.push('', '過擬合與三種子：現行→E最佳；SD=n/k RMS標準差，bias=n/k RMS偏差，σ=涵蓋率（可用點數三種子）；完整24設定名單存JSON。', '|真值|gap現行→最佳|SD現行→最佳|bias最佳|σ現行→最佳(可用數)|粗糙n/k最佳|gap>.2 / SD>2倍組數|', '|---|---:|---|---|---|---|---:|');
for(const s of summary){const c=get(s.id,s.current),b=get(s.id,s.best),sd=(r:any)=>`${fmt(r.variation.n.sdRms)}/${fmt(r.variation.k.sdRms)}`;lines.push(`|${s.id}|${fmt(c.gap)}→${fmt(b.gap)}|${sd(c)}→${sd(b)}|${fmt(b.variation.n.bias)}/${fmt(b.variation.k.bias)}|${fmt(c.coverage)}→${fmt(b.coverage)}(${b.sigmaAvailable.join('/')})|${fmt(b.score.roughness.n.ratio)}/${fmt(b.score.roughness.k.ratio)}|${s.notableGap.length}/${s.notableVariance.length}|`);}
lines.push('', '無真值選擇：E最佳為評分oracle，未參與選解；差=所選E−最佳E。', '|真值|規則|所選|E|差 / 倍率|相近|Wout / d誤差nm|', '|---|---|---|---:|---:|---|---:|');
for(const r of selection)lines.push(`|${r.id}|${r.rule}|${r.chosen}|${fmt(r.error)}|${fmt(r.delta)}/${fmt(r.relative)}|${r.near?'Y':'N'}|${fmt(r.oosW)}/${fmt(r.thickness)}|`);
lines.push('', '稀疏情境：190/210/…/890共36波長，沿用全資料P1；s=.01。Wout為完整10nm格點45002，含900nm端點夾值；dof≤0時正式函式回傳空covariance，p=0不代表零有效參數，W不宜直接跨組比較，並列χ²/Nout。', '|真值|設定|Win / Wout (χ²/Nout)|E / d誤差nm|粗糙n/k|次:status:收斂|統計可用/p/dof|', '|---|---|---:|---:|---:|---|---|');
for(const r of sparse)lines.push(`|${r.id}|${r.setting.id}|${fmt(r.metrics.mseWoollam)}/${fmt(r.oos.mseWoollam)}(${fmt(r.oos.weightedMse)})|${fmt(r.score.error)}/${fmt(r.score.thicknessError)}|${fmt(r.roughness.n.ratio)}/${fmt(r.roughness.k.ratio)}|${r.iterations}:${r.status}:${r.converged?'Y':'N'}|${r.available}/${r.effective}/${r.dof}|`);
lines.push('', '耗時秒：各設定三種子×六真值共18次精修的平均[min,max]；列內s=.01/.1/1；包含統計，串行固定順序，有JIT/系統波動，不能當純計算複雜度。', '|M/分佈|s=.01|s=.1|s=1|', '|---|---:|---:|---:|');
for(const count of settings.counts)for(const distribution of settings.distributions){const tt=timings.filter(t=>grid.find(g=>g.id===t.id)!.count===count&&grid.find(g=>g.id===t.id)!.distribution===distribution);lines.push(`|${count}/${distribution}|${tt.map(t=>`${fmt(t.mean)}[${fmt(t.min)},${fmt(t.max)}]`).join('|')}|`);}
const auto=settings.truths.flatMap(id=>settings.seeds.map(seed=>read(`${id}-${seed}-formal`).elapsedMs/1000));
lines.push(`主網格432次合計${fmt(timings.reduce((s,t)=>s+t.total,0))}s；CV288次${fmt(timings.reduce((s,t)=>s+t.cv,0))}s；稀疏12次${fmt(sparse.reduce((s,r)=>s+r.elapsedMs/1000,0))}s；18次Automatic ${fmt(auto.reduce((s,v)=>s+v,0))}s；一致性檢查及起始重試不計入網格。`,
 `主網格未收斂${primary.reduce((s,r)=>s+r.statuses.filter((v:string)=>v.endsWith(':false')).length,0)}/432（T3/40Es0.01，45001/45002，100:max_iter）；CV未收斂${primary.reduce((s,r)=>s+r.cv.filter((c:any)=>!c.converged).length,0)}/288，原值保留。`,
 `選擇規則達相近：${['BIC','AIC','CV'].map(rule=>`${rule} ${selection.filter(r=>r.rule===rule&&r.near).length}/6`).join('；')}。`,
 '成因：T1主要是平滑過強；T2/T3為平滑與節點表示交互影響；T4節點數/分佈作用更突出，單降s只使W從27.83降至27.11。T0/T5原本已在雜訊水準，減s或增M並不一致改善真值誤差；純表示不足與隱含正則化的精確分攤無法判定。',
 '依據：T1固定40W，s=1→.01使W 3.732→1.016；T3在s=.01下40W→60W使W 2.486→1.073；T4在s=.01下40W→40E使W 27.106→1.551。分佈也能惡化：60E於T1/T2/T4產生高殘差，初始投影/夾界及盆地效應與表示能力無法單獨判定。',
 '過擬合依據：120E全部18組及120W弱平滑(s=.01/.1)全部12組的主種子gap>.2；T1有17/24組SD>現行2倍。T3主種子最佳60Es.01的n/k SD約為現行10/17倍，另兩種子kRMS=.00669/.00782；其98%涵蓋率不能當成曲線準確的證明。名單與全部變異/偏差見完整JSON。',
 '稀疏風險：六個120節點案例皆dof≤0；T3/T4樣本外W約7–11/30–39，粗糙度比仍約.93–1.00。未見粗糙度膨脹不等於預測可靠，格點間振盪成因無法判定；欠定、端點夾值及起點投影混合影響，不能只以converged或低Win判穩定。',
 '選擇判斷：AIC/BIC主種子各5/6達固定相近標準，T4都落選最佳且E高1.70倍；BIC的T3選解跨種子不穩。此CV只2/6，含訓練端點外推與全資料P1初始化洩漏，不能據此否定其他資料分割CV，其可行性無法判定。',
 '移植判斷：AIC/BIC值得另案驗證為候選規則，尚不支持直接設為預設或一律增M/減s；每資料集全24組平均約280s，p也不是平滑器有效自由度，證據只限六真值三種子。T5沒有同時降低E及Wout的設定，最佳E設定的Wout比現行高約.00030，未宣稱顯著。');
const verification=read('verification');
lines.push(`pnpm run verify：exit${verification.exitCode}；${verification.commands.map((c:any)=>c.name+'='+c.exitCode).join('、')}；original ${verification.counts.original}、scientific ${verification.counts.scientific}、worker ${verification.counts.worker}。失敗名稱/內容與4.6c一致=${verification.sameAs46c}；原始log/JSON均在.qa/stage4_6d-*。`,
 ...verification.failures.map((f:any,i:number)=>`失敗${i+1}：${f.name}：${f.error.replace(/\s+/g,' ').trim()}`));
assert.ok(lines.length<=120,`report lines=${lines.length}`);
writeFileSync('STAGE4_6D_REPORT.md',lines.join('\n')+'\n');console.log(`REPORT ${lines.length} lines`);
