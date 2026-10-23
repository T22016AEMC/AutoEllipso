import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {groups,settings,read,save,guard} from './stage4_6c-support';
guard();const all=groups.map(g=>read(g.id)),names=['R0','R1','R2','R3','R4','Oracle'];
for(const r of all){assert.deepEqual(r.settings,settings);assert.deepEqual(r.strategies.map((s:any)=>s.name),names);assert.ok(r.results.length>=13&&r.results.length<=16);}
const fmt=(v:number)=>v===0?'0':Math.abs(v)<.01||Math.abs(v)>1e5?v.toExponential(5):v.toFixed(4);
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
const strategy=(r:any,name:string)=>r.strategies.find((s:any)=>s.name===name);
const aggregate=(rr:any[],name:string)=>{const ss=rr.map(r=>strategy(r,name));return {name,count:ss.length,meanRegret:mean(ss.map(s=>s.regret)),maxRegret:Math.max(...ss.map(s=>s.regret)),positive:ss.filter(s=>s.regret>0).length,improvedVsR0:rr.filter(r=>strategy(r,name).selected.mseWoollam<strategy(r,'R0').selected.mseWoollam).length,meanRelativeTime:mean(ss.map(s=>s.relativeTime)),meanInclusiveRelativeTime:mean(ss.map(s=>s.inclusiveRelativeTime)),meanSeconds:mean(ss.map(s=>s.elapsedMs))/1000};};
const matched=all.filter(r=>r.group.matched),mismatched=all.filter(r=>!r.group.matched),bad=mismatched.filter(r=>r.badP1);
assert.equal(matched.length,4);assert.equal(mismatched.length,8);
const aggregates=names.map(name=>({name,matched:aggregate(matched,name),mismatched:aggregate(mismatched,name),all:aggregate(all,name)}));
const failures=JSON.parse(readFileSync('.qa/stage4_6c-scientific-tests.json','utf8')).filter((q:any)=>!q.passed);
const previous=JSON.parse(readFileSync('.qa/stage4_6b-scientific-tests.json','utf8')).filter((q:any)=>!q.passed);
assert.deepEqual(failures,previous,'Existing failures and details unchanged');
const verification=JSON.parse(readFileSync('.qa/stage4_6c-verification-summary.json','utf8'));
assert.deepEqual(Object.fromEntries(verification.commands.map((q:any)=>[q.name,q.exitCode])),{typecheck:0,build:0,'original-tests':0,'scientific-tests':1,'worker-tests':0});
const badTable=bad.map(r=>({id:r.group.id,P1:r.results[0].mseWoollam,oracle:strategy(r,'Oracle').selected.mseWoollam,rescuedBy:r.strategies.filter((s:any)=>s.rescued).map((s:any)=>s.name)}));
const statusCounts=Object.fromEntries(['cost','step','gradient','no_better_step','max_iter','stalled'].map(status=>[status,all.flatMap(r=>r.results).filter(q=>q.status===status).length]));
const unconverged=all.flatMap(r=>r.results.filter((q:any)=>!q.converged).map((q:any)=>({group:r.group.id,start:q.id,status:q.status,iterations:q.iterations,mseWoollam:q.mseWoollam})));
const excludedDifferences:any[]=[];
for(const r of all){const formal=read(r.group.id+'-formal'),i=formal.context.primaryLayerIndex,base=formal.output.updatedLayers;
 for(const a of r.p9Audit){if(!a.duplicateOf)continue;const other=a.duplicateOf==='P1'?base:r.p9Audit.find((p:any)=>'P9r'+p.rank===a.duplicateOf).layers;
  const ids=Object.keys(base[i].parameters).filter(k=>!base[i].parameters[k].fit&&a.layers[i].parameters[k].current!==other[i].parameters[k].current);
  if(ids.length)excludedDifferences.push({group:r.group.id,rank:a.rank,ids});}}
const summary={settings,aggregates,badTable,statusCounts,unconverged,excludedDifferences,groups:all.map(r=>({group:r.group,provenance:r.provenance,badP1:r.badP1,p9GenerationMs:r.p9GenerationMs,strategies:r.strategies})),verification,failures};save('summary',summary);
const table=(rows:string[],extra:string[]=[])=>[`|案例${extra.length?'|'+extra.join('|'):''}|${names.join('|')}|`,`|---${extra.map(()=>'|---:').join('')}|${names.map(()=>'---:').join('|')}|`,...rows];
const row=(r:any)=>r.group.id+(r.group.matched?'*':'');
const totalCalls=all.reduce((s,r)=>s+r.results.length,0),wallSeconds=all.reduce((s,r)=>s+r.results.reduce((ss:number,q:any)=>ss+q.elapsedMs,0),0)/1000;
const report=[
'# Stage 4.6c：模型族不匹配與自由形式多起點診斷',
'基準 `'+settings.base+'`；只新增 scripts/ 與本報告。規則於跑資料前固定；src/、部署設定、容差、迭代上限與既有斷言未改。',
'資料：T1–T4×三模型，seed45001，Si/100nm、65/70/75°、190–900nm每10nm、σ=.03°，全部串行；*為4個匹配組，其餘8組不匹配。',
'每組新跑一次隔離 Automatic：與4.6a同樣唯讀追蹤，僅在隔離副本跳過物理終點之後的M2；保留原階梯與最終物理結果。',
'P1正式物理終點；P5 Stage1 Cauchy k=0；P7原BIC階梯；P9粗排序前4名物理精修終點，前2重用、3/4用正式100次/1e-6精修，依排名留最多3個。',
'P9去重：膜厚按正式[tMin,tMax]、P1 fitted參數按P1界限正規化，取最大距離；與P1或既留者<1e-6即去重。P10=P1光學曲線、膜厚−5/+5/−10/+10nm（夾40–200）。',
'Oracle另加4.6b定義的P3/P4/P6/P8a/b/c（seed61001–61003，六個cubic controls；n±15%、k加0–.1、d±5）；P4取較低中位數。起點不使用真值。',
'R0=P1精修與原階梯用正式二選一（含1e-6相對平手）；R1=P1/P5/P7；R2=P1/P9；R3=P1/P10；R4=前述全部；Oracle=R4加oracle池。',
'R1–Oracle按全資料MSE_W、完全同值再按總成本及固定順序選解；真值僅評分。全部用原refineFreeForm：40節點、全資料、100次、ftol=1e-5、既有xtol/gtol、λN=.25/λK=.6。',
'遺憾=W策略−WOracle，比例除Oracle；>0採嚴格正值。差P1定義為比Oracle≥2倍且差≥1；救回=≤Oracle×1.01，僅診斷分類，不是測試通過門檻。',
'Oracle只是指定池的最佳，不證明全域最小；未精修階梯只屬R0，可能負遺憾亦保留。原始完整JSON/log：本機`.qa/stage4_6c-*`，不在repo。',
`完成12次Automatic、${totalCalls}次自由形式精修（合計${wallSeconds.toFixed(2)}s）；${all.filter(r=>r.provenance.baselineChecked).length}組物理結果與既有4.6a快取逐值一致。`,
`不匹配差P1：${badTable.map(r=>`${r.id} P1=${fmt(r.P1)},Oracle=${fmt(r.oracle)}；救回${r.rescuedBy.join('/')}`).join('；')||'依固定分類為0/8；不代表所有起點都可靠。'}`,
`自由形式status：cost=${statusCounts.cost}，max_iter=${statusCounts.max_iter}；未收斂：${unconverged.map(q=>q.group+'/'+q.start+' '+q.iterations+'次 W='+fmt(q.mseWoollam)).join('；')}，照原值保留。P9被去重者的未擬合參數亦相同（例外${excludedDifferences.length}筆）。`,
'',
'遺憾表：絕對值（相對%）；P1欄為物理精修前→自由形式精修後MSE_W；極小正遺憾仍計入>0組數。',
...table(all.map(r=>'|'+row(r)+'|'+fmt(r.provenance.physicalMseWoollam)+'→'+fmt(r.results[0].mseWoollam)+'|'+r.strategies.map((s:any)=>`${fmt(s.regret)}(${fmt(100*s.relativeRegret)}%)`).join('|')+'|'),['P1前→後']),
'',
'策略終點：選中起點:MSE_W／總成本／膜厚nm／迭代:status:converged(Y/N)；原階梯保留該級迭代資訊。',
...table(all.map(r=>'|'+row(r)+'|'+r.strategies.map((s:any)=>{const q=s.selected;return`${q.id}:${fmt(q.mseWoollam)}/${fmt(q.totalCost)}/${fmt(q.thickness)}/${q.iterations}:${q.status}:${q.converged?'Y':'N'}`;}).join('|')+'|')),
'',
'相對真值誤差：n最大/nRMS；k最大/kRMS；膜厚誤差nm（只評分，不選解）。',
...table(all.map(r=>'|'+row(r)+'|'+r.strategies.map((s:any)=>{const q=s.selected.truth;return`${fmt(q.nMax)}/${fmt(q.nRms)};${fmt(q.kMax)}/${fmt(q.kRms)};${fmt(q.thicknessError)}`;}).join('|')+'|')),
'',
'耗時：自由形式秒數／相對R0倍率[含P9額外物理精修的倍率]；P9列為額外rank3/4秒數。為共享串行實測呼叫之和，非每策略獨立重跑；排除共用Automatic，固定順序有暖機/快取影響。',
...table(all.map(r=>'|'+row(r)+'|'+(r.p9GenerationMs/1000).toFixed(2)+'|'+r.strategies.map((s:any)=>`${(s.elapsedMs/1000).toFixed(2)}/${s.relativeTime.toFixed(2)}[${s.inclusiveRelativeTime.toFixed(2)}]`).join('|')+'|'),['P9秒']),
'',
'分組彙整：平均遺憾／最大遺憾／嚴格>0組數；時間倍率為逐組倍率的算術平均（非總時間比）。',
'|策略|匹配4組|不匹配8組|平均精修秒|平均倍率FF[含P9]|不匹配平均倍率FF[含P9]|',
'|---|---:|---:|---:|---:|---:|',
...aggregates.map(a=>`|${a.name}|${fmt(a.matched.meanRegret)}/${fmt(a.matched.maxRegret)}/${a.matched.positive}|${fmt(a.mismatched.meanRegret)}/${fmt(a.mismatched.maxRegret)}/${a.mismatched.positive}|${a.all.meanSeconds.toFixed(2)}|${a.all.meanRelativeTime.toFixed(2)}[${a.all.meanInclusiveRelativeTime.toFixed(2)}]|${a.mismatched.meanRelativeTime.toFixed(2)}[${a.mismatched.meanInclusiveRelativeTime.toFixed(2)}]|`),
'',
`判斷：R3在不匹配組有${aggregates.find(a=>a.name==='R3')!.mismatched.improvedVsR0}/8組比R0低，平均遺憾由${fmt(aggregates[0].mismatched.meanRegret)}降至${fmt(aggregates[3].mismatched.meanRegret)}；保險方案中其平均遺憾/耗時權衡優於R1/R2，但全12組平均仍需${aggregates[3].all.meanInclusiveRelativeTime.toFixed(2)}倍精修時間。`,
`R4需${aggregates[4].all.meanInclusiveRelativeTime.toFixed(2)}倍精修時間，仍未消除不匹配組最大遺憾${fmt(aggregates[4].mismatched.maxRegret)}（T4×TL，Oracle選P8c）；R1不改善8個不匹配組的R0結果。這批數據不足以支持把多起點移植為預設保險；保留R0是目前較省時選擇。`,
'未觀察到固定定義的差P1案例，並不證明模型族不匹配無風險；T3/T4連指定Oracle的MSE_W也約14/28，可能共享較差盆地或有其他限制，成因無法由此池判定。真值誤差見表，未宣稱曲線準確或需要哪種正式修正。',
'pnpm run verify：typecheck/build exit0；original29/29；scientific90/92；worker8/8；verify exit1。原始輸出：本機`.qa/stage4_6c-verify.log`及`.qa/stage4_6c-v2-*.log`（不在repo）。',
...failures.map((q:any)=>'- '+q.name+'：'+q.detail.replaceAll('\n',' ').trimEnd()),
'兩項失敗名稱及原始內容與4.6b相同，未修改既有斷言或期望值；未做正式行為移植。',
];
assert.ok(report.length<=100,'Report lines '+report.length);writeFileSync('STAGE4_6C_REPORT.md',report.join('\n')+'\n');console.log(JSON.stringify({lines:report.length,totalCalls,wallSeconds,badTable,aggregates,verification,failures}));
