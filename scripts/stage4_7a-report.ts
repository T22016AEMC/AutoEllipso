import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {settings,grid,prefix,read,save,mean,rms} from './stage4_7a-run';
const fmt=(v:any)=>v==null||!Number.isFinite(v)?'NA':v===0?'0':Math.abs(v)<.001||Math.abs(v)>=1e5?v.toExponential(3):v.toFixed(4);
const pair=(v:any)=>v?`${fmt(v.n)}/${fmt(v.k)}`:'NA';
const execution=read('execution'),verification=read('verification');
assert.equal(execution.datasets.length,209);assert.deepEqual(read('settings'),settings);
assert.equal(createHash('sha256').update(readFileSync(prefix+'settings.json')).digest('hex'),read('frozen').settingsSha256);
const ds=(id:string,seed:number,g='full')=>read(`${id}-${seed}-${g}-dataset`);
const fit=(d:any,c:string)=>read(`${d.id}-${d.seed}-${d.gridName}-${c}`);
const chosen=(d:any)=>d.selected?fit(d,d.selected):null;
const full=settings.truths.map(t=>{
 const d=ds(t.id,46001),r0=fit(d,d.r0),r1=chosen(d),oracle=grid.map(g=>fit(d,g.id)).reduce((a,b)=>b.score.error<a.score.error?b:a);
 const seeds=settings.selectionSeeds.map(seed=>ds(t.id,seed)),truth=read(`${t.id}-46001-full-data`).optics;
 const variation=(rule:string)=>{
  const curves=seeds.map(d=>rule==='R0'?fit(d,d.r0).out.curve:chosen(d)?.out.curve);if(curves.some(c=>!c))return null;
  return Object.fromEntries(['n','k'].map(key=>{const averages=truth.map((_:any,i:number)=>mean(curves.map(c=>c[i][key]))!),sd=averages.map((a:number,i:number)=>Math.sqrt(curves.reduce((s,c)=>s+(c[i][key]-a)**2,0)/2));return [key,{sd:rms(sd),bias:rms(averages.map((a:number,i:number)=>a-truth[i][key])),pointwiseSD:sd}];}));
 };
 return {id:t.id,d,r0,r1,oracle,near:r1!==null&&r1.score.error<=1.1*oracle.score.error+.0001,delta:r1?r1.score.error-oracle.score.error:null,seeds,variation:{R0:variation('R0'),R1:variation('R1')}};
});
const sparse=['T2','T3','T4','T6'].flatMap(id=>['S1','S2'].map(g=>{const d=ds(id,46001,g),r=chosen(d),baseline=fit(ds(id,46001,'S1'),'12Ws1');return {id,grid:g,d,r,baselineWout:baseline.oosW,ratio:r&&baseline.oosW>0?r.oosW/baseline.oosW:null};}));
const calibration=settings.calibrationTruths.flatMap(id=>settings.calibrationGrids.map(g=>{
 const datasets=settings.calibrationSeeds.map(seed=>ds(id,seed,g)),truth=read(`${id}-47001-${g}-data`).optics;
 function summarize(rule:string){
  const fits=datasets.map(d=>rule==='R0'?fit(d,d.r0):chosen(d));
  if(fits.some(r=>!r))return {ratio:null,coverage:null,missing:20*72,eligibleWavelengths:0,points:[]};
  const points=truth.map((t:any,i:number)=>{
   const k=fits.map(r=>r.out.curve[i].k),sigma=fits.map(r=>r.out.curve[i].kSigma),average=mean(k)!,sd=Math.sqrt(k.reduce((s,v)=>s+(v-average)**2,0)/19),finite=sigma.filter(Number.isFinite);
   const sigmaRms=finite.length===20?rms(sigma):null;
   return {wavelength:t.wavelength,truth:t.k,mean:average,sd,sigmaRms,ratio:sigmaRms!==null&&sigmaRms>0?sd/sigmaRms:null,finite:finite.length,covered:fits.filter(r=>Number.isFinite(r.out.curve[i].kSigma)&&Math.abs(r.out.curve[i].k-t.k)<=2*r.out.curve[i].kSigma).length};
  });
  const eligible=points.filter((p:any)=>p.finite===20),sigmaRms=rms(eligible.map((p:any)=>p.sigmaRms)),sd=rms(eligible.map((p:any)=>p.sd)),coverage=fits.map(r=>r.score.regions.all.coverage);
  return {ratio:sigmaRms!==null&&sigmaRms>0&&sd!==null?sd/sigmaRms:null,coverage:coverage.every(Number.isFinite)?mean(coverage):null,missing:20*72-points.reduce((s:number,p:any)=>s+p.finite,0),eligibleWavelengths:eligible.length,points};
 }
 const R0=summarize('R0'),R1=summarize('R1'),passed=R1.ratio!==null&&R1.ratio>=.6&&R1.ratio<=1.4&&R0.coverage!==null&&R1.coverage!==null&&R1.coverage>=R0.coverage-.10;
 const distribution=Object.fromEntries([...new Set(datasets.map(d=>d.selected??'none'))].map(s=>[s,datasets.filter(d=>(d.selected??'none')===s).length]));
 return {id,grid:g,R0,R1,passed,distribution,seconds:datasets.reduce((s,d)=>s+d.wallMs/1000,0)};
}));
const mainDatasets=full.flatMap(r=>r.seeds),r0Mean=mean(mainDatasets.map(d=>d.r0Ms))!,r1Mean=mean(mainDatasets.map(d=>d.ladderMs))!,timingRatio=r1Mean/r0Mean;
const worsened=mainDatasets.filter(d=>!chosen(d)||chosen(d).score.error>fit(d,d.r0).score.error).map(d=>`${d.id}/${d.seed}`);
const matched=full.filter(r=>['T1','T2','T3','T4'].includes(r.id));
const checks=[
 {criterion:1,passed:full.filter(r=>r.near).length>=6,evidence:`相近${full.filter(r=>r.near).length}/7（需≥6）`},
 {criterion:2,passed:worsened.length===0,evidence:`21主資料E劣於R0或缺解${worsened.length}；${worsened.join(',')||'無'}`},
 {criterion:3,passed:matched.every(r=>r.r1&&r.r1.metrics.mseWoollam<=1.3&&r.r1.oosW<=1.3),evidence:matched.map(r=>`${r.id} W/Wout=${fmt(r.r1?.metrics.mseWoollam)}/${fmt(r.r1?.oosW)}`).join('；')},
 {criterion:4,passed:sparse.every(r=>r.r&&r.r.dof>0&&!r.d.selection.trials.some((t:any)=>t.dof<=0)),evidence:`稀疏缺解${sparse.filter(r=>!r.r).length}，選解dof≤0 ${sparse.filter(r=>r.r&&r.r.dof<=0).length}，試次dof≤0 ${sparse.reduce((s,r)=>s+r.d.selection.trials.filter((t:any)=>t.dof<=0).length,0)}`},
 {criterion:5,passed:timingRatio<=4,evidence:`21主資料R1/R0平均精修=${fmt(r1Mean/1000)}/${fmt(r0Mean/1000)}秒，倍率${fmt(timingRatio)}≤4`},
 {criterion:6,passed:calibration.every(c=>c.passed),evidence:`σ校準${calibration.filter(c=>c.passed).length}/9通過（需全部）；缺值不通過`},
 {criterion:7,passed:sparse.every(r=>r.ratio!==null&&r.ratio<=1.2),evidence:`稀疏Wout/36點基準≤1.2：${sparse.filter(r=>r.ratio!==null&&r.ratio<=1.2).length}/8`},
];
const compact=(r:any)=>r?{...r,out:undefined}:null;
save('complete-summary',{settings,checks,timingRatio,worsened,full:full.map(r=>({...r,r0:compact(r.r0),r1:compact(r.r1),oracle:compact(r.oracle)})),sparse:sparse.map(r=>({...r,r:compact(r.r)})),calibration,execution,verification});
const flat=execution.datasets.flatMap((d:any)=>d.settings.map((c:string)=>{const r=fit(d,c),a=r.score.regions.all;return {truth:d.id,seed:d.seed,grid:d.gridName,setting:c,selected:d.selected===c,W:r.metrics.mseWoollam,chiN:r.metrics.weightedMse,p:r.p,dof:r.dof,E:r.score.error,nMax:a.nMax,nRMS:a.nRms,kMax:a.kMax,kRMS:a.kRms,dError:r.score.thicknessError,Wout:r.oosW,gap:r.gap,AIC:r.aic,BIC:r.bic,cost:r.totalCost,iterations:r.iterations,status:r.status,converged:r.converged,seconds:r.elapsedMs/1000};}));
writeFileSync(prefix+'complete-summary.csv',[Object.keys(flat[0]).join(','),...flat.map((r:any)=>Object.values(r).map(v=>v??'NA').join(','))].join('\n')+'\n');
const lines=readFileSync(prefix+'frozen-report.md','utf8').trimEnd().split('\n');
lines.push('', '主46001摘要（T6為困難案例）；完整63個oracle候選與所有逐設定、區域誤差及狀態見complete-summary.json/csv與各資料集JSON。',
 '|真值|R1設定/狀態/fallback|W R0→R1 / χ²/N R1|E R0→R1 / oracle設定:E / 差 / 相近|d誤差nm|Wout R0→R1 / gap R1|',
 '|---|---|---|---|---:|---|');
for(const r of full)lines.push(`|${r.id}′${r.id==='T6'?'困難':''}|${r.d.selected}/${r.r1?.status??'NA'}/${r.d.selection.fallback?'Y':'N'}|${fmt(r.r0.metrics.mseWoollam)}→${fmt(r.r1?.metrics.mseWoollam)} / ${fmt(r.r1?.metrics.weightedMse)}|${fmt(r.r0.score.error)}→${fmt(r.r1?.score.error)} / ${r.oracle.setting.id}:${fmt(r.oracle.score.error)} / ${fmt(r.delta)} / ${r.near?'Y':'N'}|${fmt(r.r1?.score.thicknessError)}|${fmt(r.r0.oosW)}→${fmt(r.r1?.oosW)} / ${fmt(r.r1?.gap)}${r.r1?.gap>.2?'*':''}|`);
lines.push('', '跨46001–46003三種子（n/k；T3與T6各自列出）；*表示主46001 gap>.2；逐波長曲線與SD在原始JSON。', '|真值|SD RMS R0→R1 (n/k)|偏差R0→R1 (n/k)|三種子R1選解|', '|---|---|---|---|');
for(const r of full){const v=(rule:string,key:string)=>{const q=(r.variation as any)[rule];return q?pair({n:q.n[key],k:q.k[key]}):'NA';};lines.push(`|${r.id}′|${v('R0','sd')}→${v('R1','sd')}|${v('R0','bias')}→${v('R1','bias')}|${r.seeds.map(d=>d.selected??'無').join('/')}|`);}
lines.push('', '稀疏46001：Wout=完整10nm格點46004；比較基準一律同真值S1(12,1)，S2亦如此；dof取正式統計，未用metrics的夾值。', '|真值/格點|所選/狀態/fallback|p/dof|Win / Wout / χ²/Nout|Wout/基準|總階梯秒|', '|---|---|---|---|---:|---:|');
for(const r of sparse)lines.push(`|${r.id}′/${r.grid}|${r.d.selected??'無可用候選'}/${r.r?.status??'NA'}/${r.d.selection.fallback?'Y':'N'}|${r.r?.p??'NA'}/${r.r?.dof??'NA'}|${fmt(r.r?.metrics.mseWoollam)} / ${fmt(r.r?.oosW)} / ${fmt(r.r?.oosChiN)}|${fmt(r.ratio)}|${fmt(r.d.ladderMs/1000)}|`);
lines.push('', 'σ_k校準（各20種子，有限σ缺失分列；R1欄稀疏代表R1s）。沒有校正或重新縮放σ。', '|真值/格點|std/σ R0→R1|±2σ涵蓋率 R0→R1|缺失/1440 R0→R1|判準6|', '|---|---|---|---|---|');
for(const c of calibration)lines.push(`|${c.id}′/${c.grid}|${fmt(c.R0.ratio)}→${fmt(c.R1.ratio)}|${fmt(c.R0.coverage)}→${fmt(c.R1.coverage)}|${c.R0.missing}→${c.R1.missing}|${c.passed?'通過':'未通過'}|`);
lines.push('', '耗時秒（串行牆鐘；三主種子依46001/2/3列出，每資料集Automatic、所有精修與總牆鐘；oracle額外成本包含在46001精修中）。', '|真值|Automatic秒（三資料集）|全部精修秒（三資料集）|總牆鐘秒（三資料集）|', '|---|---|---|---|');
for(const r of full)lines.push(`|${r.id}′|${r.seeds.map(d=>fmt(d.automaticMs/1000)).join('/')}|${r.seeds.map(d=>fmt(d.refinementMs/1000)).join('/')}|${r.seeds.map(d=>fmt(d.wallMs/1000)).join('/')}|`);
lines.push(`209完成資料集牆鐘加總${fmt((execution.completedDatasetWallMs+ds('T0',46001).automaticMs)/1000)}秒（補入首例已保存Automatic，排除暫停及未保存工作）；Automatic合計${fmt(execution.datasets.reduce((s:number,d:any)=>s+d.automaticMs/1000,0))}秒；唯一精修合計${fmt(execution.datasets.reduce((s:number,d:any)=>s+d.refinementMs/1000,0))}秒。`,
 '中斷1：T0/46001/full沿用已保存Automatic；未落盤精修由同P1重算，放棄工作量/耗時無法判定。該資料集wallMs只計恢復後，原Automatic另補入總計；recovery.json。',
 '中斷2：要求暫停時停止控制提早中斷T0/47004/S2的Automatic，未落盤，精修未開始；明確「繼續」後只重算此Automatic，72個完整資料集不重算。pause.json/resume-audit.json記錄範圍與已保存檔案雜湊核對。',
 `校準各真值/格點總秒：${calibration.map(c=>`${c.id}/${c.grid}=${fmt(c.seconds)}`).join('；')}；每資料集明細execution.json。`,
 '預先寫定判準逐條判定（未放寬，NA不視為通過）：');
for(const c of checks)lines.push(`${c.criterion}. ${c.passed?'通過':'未通過'}：${c.evidence}。`);
const excluded=flat.filter((r:any)=>r.status!=='cost'||!r.converged||r.dof<=0),fallbacks=execution.datasets.filter((d:any)=>d.selection.fallback),mainGaps=full.filter(r=>r.r1?.gap>.2);
lines.push(`排除候選${excluded.length}/${flat.length}；全資料集fallback ${fallbacks.length}/209；主46001 R1 gap>.2：${mainGaps.map(r=>r.id).join(',')||'無'}。完整排除原因/停止路徑見各dataset與complete-summary。`,
 'T4的首步BIC只降1.6721（≤10），階梯依固定規則停止；E最佳80Ws.01的W=.9785、Wout=1.3755，仍高於1.3。未事後改門檻或選解。',
 'T6困難案例：九組最低E仍.8399，該解W=229.7457、d誤差+100nm；相近分類不代表絕對準確。此例高殘差下限的成因無法判定。',
 '稀疏選解Wout=161.6738–701.5307；正dof與相對基準分類不足以證明絕對預測準確。σ主格3/3通過、稀疏0/6通過，因此整體判準6仍未通過。',
 `移植判斷：${checks.every(c=>c.passed)?'本次全部預定判準通過，可支持下一階段移植驗證；尚未改正式程式。':'本次未滿足全部預定判準，不支持直接移植為正式預設。'}獨立雜訊重複只驗證同類合成光譜；真實量測的適用性無法判定。`,
 'σ風險：共變異包含正則化局部曲率且條件於邊界係數；std/σ檢查隨機變異，涵蓋率亦受表示偏差影響。不能只用低W或cost收斂判定曲線正確，主因的精確分攤無法判定。',
 `完整pnpm run verify僅一次：${fmt(verification.elapsedMs/1000)}秒，exit ${verification.exitCode}；失敗名稱與內容同4.6d=${verification.sameAs46d}；${verification.counts}。含驗證完成工作總計${fmt((execution.completedDatasetWallMs+ds('T0',46001).automaticMs+verification.elapsedMs)/1000)}秒；原始verify.log及verification.json。`,
 ...verification.failures.map((f:any)=>`${verification.sameAs46d?'既有失敗':'失敗（需對照新增/變更）'}：${f.name}；${f.detail.replace(/\s+/g,' ').trim()}`));
assert.ok(lines.length<=120,`report exceeds120: ${lines.length}`);writeFileSync('STAGE4_7A_REPORT.md',lines.join('\n')+'\n');console.log(`REPORT ${lines.length} lines; criteria ${checks.map(c=>`${c.criterion}:${c.passed}`).join(',')}`);
