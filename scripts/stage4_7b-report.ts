import assert from 'node:assert/strict';
import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {settings,prefix,read,save,sha,mean,rms} from './stage4_7b-run';

if(process.argv[2]==='verify'){
 assert.equal(read('execution').uniqueRefinements,133);const timing=read('verify-timing');
 const load=(name:string)=>JSON.parse(readFileSync('.qa/'+name+'.json','utf8'));
 for(const name of ['verification-summary','v2-original-tests','scientific-tests','worker-tests'])copyFileSync('.qa/'+name+'.json',prefix+name+'.json');
 const scientific=load('scientific-tests'),baseline=load('stage4_7a-scientific-tests'),failure=(a:any[])=>a.filter(r=>!r.passed).map(({name,detail})=>({name,detail})),failures=failure(scientific),previous=failure(baseline);
 const newNames=failures.filter((r:any)=>!previous.some((p:any)=>p.name===r.name)),changed=failures.filter((r:any)=>previous.some((p:any)=>p.name===r.name&&p.detail!==r.detail));
 const count=(a:any[])=>`${a.filter(r=>r.passed).length}/${a.length}`;
 save('verification',{...timing,commands:load('verification-summary').commands,failures,newNames,changed,sameAs47a:isDeepStrictEqual(failures,previous),counts:{original:count(load('v2-original-tests')),scientific:count(scientific),worker:count(load('worker-tests'))}});
 console.log(JSON.stringify({sameAs47a:read('verification').sameAs47a,counts:read('verification').counts,newNames:newNames.length,changed:changed.length}));
}else{
 const execution=read('execution'),verification=read('verification');assert.equal(execution.datasets,21);assert.equal(execution.uniqueRefinements,133);assert.deepEqual(read('settings'),settings);
 const frozen=read('frozen');assert.equal(sha(readFileSync(prefix+'settings.json')),frozen.settingsSha256);assert.equal(sha(readFileSync(prefix+'frozen-report.md')),frozen.reportSha256);
 const fmt=(v:any)=>v==null||!Number.isFinite(v)?'NA':v===0?'0':Math.abs(v)<.001||Math.abs(v)>=1e5?v.toExponential(3):v.toFixed(4);
 const records:any[]=[],variation:any[]=[];
 for(const t of settings.truths){
  const primary=read(`${t.id}-48001-rules`),oracle=primary.evaluations.map((g:string)=>read(`${t.id}-48001-${g}-evaluation`)).reduce((a:any,b:any)=>b.score.error<a.score.error?b:a);
  for(const seed of settings.selectionSeeds){const d=read(`${t.id}-${seed}-rules`),r0=read(`${t.id}-${seed}-40Ws1-evaluation`);
   for(const choice of d.rules){const r=read(`${t.id}-${seed}-${choice.selected}`),e=read(`${t.id}-${seed}-${choice.selected}-evaluation`),delta=e.score.error-r0.score.error;
    records.push({id:t.id,seed,rule:choice.rule,selected:choice.selected,fallback:choice.fallback,trials:choice.trials,elapsedMs:choice.elapsedMs,metrics:r.metrics,p:r.p,dof:r.dof,aic:r.aic,bic:r.bic,totalCost:r.totalCost,status:r.status,converged:r.converged,iterations:r.iterations,score:e.score,oosW:e.oosW,oosChiN:e.oosChiN,gap:e.gap,delta,deltaClass:Math.abs(delta)<1e-4?'N':Math.abs(delta)>1e-4?'B':'EQ',near:seed===48001?e.score.error<=1.1*oracle.score.error+1e-4:null,absolute:seed===48001?e.score.error<=oracle.score.error+1e-4:null,oracle:seed===48001?{setting:oracle.setting,error:oracle.score.error}:null});
   }
  }
  const truth=read(`${t.id}-48001-data`).optics;
  for(const rule of settings.rules){const rows=records.filter(r=>r.id===t.id&&r.rule===rule),curves=rows.map(r=>read(`${r.id}-${r.seed}-${r.selected}`).out.curve);
   const fields=Object.fromEntries(['n','k'].map(key=>{const average=truth.map((_:any,i:number)=>mean(curves.map(c=>c[i][key]))!),sd=average.map((a:number,i:number)=>Math.sqrt(curves.reduce((s,c)=>s+(c[i][key]-a)**2,0)/2));return [key,{sdRms:rms(sd),bias:rms(average.map((a:number,i:number)=>a-truth[i][key])),pointwiseSD:sd,meanCurve:average}];}));
   variation.push({id:t.id,rule,selected:rows.map(r=>r.selected),consistent:new Set(rows.map(r=>r.selected)).size===1,fallbacks:rows.filter(r=>r.fallback).length,...fields});
  }
 }
 assert.equal(records.length,105);assert.equal(variation.length,35);
 const r0Mean=mean(records.filter(r=>r.rule==='R0').map(r=>r.elapsedMs))!;
 const rules=settings.rules.map(rule=>{
  const rows=records.filter(r=>r.rule===rule),primary=rows.filter(r=>r.seed===48001),matched=primary.filter(r=>settings.matched.includes(r.id)),consistent=variation.filter(v=>v.rule===rule&&v.consistent).length,meanMs=mean(rows.map(r=>r.elapsedMs))!,worse=rows.filter(r=>r.delta>1e-4),badFit=matched.filter(r=>r.metrics.mseWoollam>1.3||r.oosW===null||r.oosW>1.3),near=primary.filter(r=>r.near).length;
  const checks=[{id:1,passed:near>=6,value:`${near}/7`},{id:2,passed:worse.length===0,value:`${worse.length}/21`,datasets:worse.map(r=>`${r.id}/${r.seed}`)},{id:3,passed:badFit.length===0,value:`${matched.length-badFit.length}/5`,failures:badFit.map(r=>r.id)},{id:4,passed:meanMs<=4*r0Mean,value:meanMs/r0Mean},{id:5,passed:consistent>=6,value:`${consistent}/7`}];
  return {rule,near,absolute:primary.filter(r=>r.absolute).length,checks,passed:checks.every(c=>c.passed),meanMs,totalMs:rows.reduce((s,r)=>s+r.elapsedMs,0),ratio:meanMs/r0Mean,noise:rows.filter(r=>r.deltaClass==='N').length,equal:rows.filter(r=>r.deltaClass==='EQ').length,improvedBeyond:rows.filter(r=>r.delta< -1e-4).length,worseBeyond:worse.length,meanDelta:mean(rows.map(r=>r.delta)),consistent,fallbacks:rows.filter(r=>r.fallback).length};
 });
 const passed=rules.filter(r=>r.rule!=='R0'&&r.passed),fastest=passed.length>1?passed.filter(r=>r.meanMs===Math.min(...passed.map(r=>r.meanMs))).map(r=>r.rule):[];
 const phaseSeconds=[...execution.stageSeconds,verification.elapsedMs/1000],summary={settings,records,variation,rules,passed:passed.map(r=>r.rule),fastest,phaseSeconds,verification,frozen};save('complete-summary',summary);
 const flat=records.map(r=>({truth:r.id,seed:r.seed,rule:r.rule,setting:r.selected,fallback:r.fallback,W:r.metrics.mseWoollam,chiN:r.metrics.weightedMse,E:r.score.error,delta:r.delta,deltaClass:r.deltaClass,near:r.near,absolute:r.absolute,dError:r.score.thicknessError,nMax:r.score.regions.all.nMax,nRMS:r.score.regions.all.nRms,kMax:r.score.regions.all.kMax,kRMS:r.score.regions.all.kRms,Wout:r.oosW,chiNout:r.oosChiN,gap:r.gap,p:r.p,dof:r.dof,AIC:r.aic,BIC:r.bic,seconds:r.elapsedMs/1000}));
 writeFileSync(prefix+'rules.csv',[Object.keys(flat[0]).join(','),...flat.map(r=>Object.values(r).map(v=>v??'NA').join(','))].join('\n')+'\n');
 const lines=readFileSync(prefix+'frozen-report.md','utf8').trimEnd().split('\n');
 lines.push(`凍結設計報告SHA256=${frozen.reportSha256}；正式副本重驗六例最大差${fmt(Math.max(...read('equivalence').checks.map((c:any)=>c.maxDifference)))}≤1e-9。`,
  '', '48001主表：ΔE對同資料R0；N/B/EQ定義見上；近/絕=兩種oracle分類，*為gap>.2。n/k max/RMS與區域、每種子規則、逐步trace完整於rules.csv/complete-summary.json/各evaluation.json。',
  '|真值/規則|所選|W / χ²/N|E / ΔE(類)|近/絕|d誤差nm|Wout / gap|精修秒|', '|---|---|---|---|---|---:|---|---:|');
 for(const r of records.filter(r=>r.seed===48001))lines.push(`|${r.id}/${r.rule}|${r.selected}${r.fallback?' fallback':''}|${fmt(r.metrics.mseWoollam)}/${fmt(r.metrics.weightedMse)}|${fmt(r.score.error)}/${fmt(r.delta)}(${r.deltaClass})|${r.near?'Y':'N'}/${r.absolute?'Y':'N'}|${fmt(r.score.thicknessError)}|${fmt(r.oosW)}/${fmt(r.gap)}${r.gap>.2?'*':''}|${fmt(r.elapsedMs/1000)}|`);
 lines.push('', '跨三種子：每格為SD RMS(n/k)；偏差(n/k)；所選設定一致Y/N。逐波長及三個設定id在完整JSON。', '|真值|R0|R1|R1a|R1b|R1c|', '|---|---|---|---|---|---|');
 for(const t of settings.truths)lines.push(`|${t.id}|${settings.rules.map(rule=>{const v=variation.find(v=>v.id===t.id&&v.rule===rule)!;return `${fmt(v.n.sdRms)}/${fmt(v.k.sdRms)};${fmt(v.n.bias)}/${fmt(v.k.bias)};${v.consistent?'Y':'N'}`;}).join('|')}|`);
 lines.push('', '逐規則固定判準（每格為通過/未通過與實際數；判準3需五例全過）：', '|規則|1 相近|2 E大差惡化數|3 匹配W/Wout|4 時間倍率|5 一致|全部|', '|---|---|---|---|---|---|---|');
 for(const r of rules.filter(r=>r.rule!=='R0'))lines.push(`|${r.rule}|${r.checks.map(c=>`${c.passed?'通過':'未通過'}(${typeof c.value==='number'?fmt(c.value):c.value}${c.id===3&&c.failures?.length?';'+c.failures.join(','):''})`).join('|')}|${r.passed?'通過':'未通過'}|`);
 lines.push('', '全部21資料集耗時與ΔE分類（B改善/惡化為超過1e-4；N用絕對差；EQ獨立，未四捨五入判斷）：', '|規則|總秒/平均秒/對R0倍率|N/EQ/B改善/B惡化|平均ΔE|近/絕數|一致數|', '|---|---|---|---:|---|---|');
 for(const r of rules)lines.push(`|${r.rule}|${fmt(r.totalMs/1000)}/${fmt(r.meanMs/1000)}/${fmt(r.ratio)}|${r.noise}/${r.equal}/${r.improvedBeyond}/${r.worseBeyond}|${fmt(r.meanDelta)}|${r.near}/${r.absolute}|${r.consistent}/7|`);
 const primaryRecord=(id:string,rule:string)=>records.find(r=>r.id===id&&r.seed===48001&&r.rule===rule)!;
 const lastDrop=(r:any)=>r.trials.at(-2).bic-r.trials.at(-1).bic;
 lines.push(`階段0一致性${fmt(phaseSeconds[0])}秒；1 Automatic21 ${fmt(phaseSeconds[1])}秒；2 oracle63 ${fmt(phaseSeconds[2])}秒；3 階梯70及105規則評分${fmt(phaseSeconds[3])}秒；4 verify ${fmt(phaseSeconds[4])}秒；總完成工作${fmt(phaseSeconds.reduce((s,v)=>s+v,0))}秒。`,
  `停止規則證據：U4在(40,.1)→(40,.01)的BIC只降${fmt(lastDrop(primaryRecord('U4','R1')))}，R1/R1a均按預定規則停止；完整階梯R1b/c所選Win由${fmt(primaryRecord('U4','R1').metrics.mseWoollam)}降至${fmt(primaryRecord('U4','R1b').metrics.mseWoollam)}。`,
  `U6同一步BIC降${fmt(lastDrop(primaryRecord('U6','R1')))}，R1停止、R1a繼續至80Ws.01；所選Win由${fmt(primaryRecord('U6','R1').metrics.mseWoollam)}降至${fmt(primaryRecord('U6','R1a').metrics.mseWoollam)}。門檻2在U4仍未走到較高M。`,
  `BIC與W選擇證據：U2的R1b選${primaryRecord('U2','R1b').selected}，R1c選${primaryRecord('U2','R1c').selected}，Wout=${fmt(primaryRecord('U2','R1b').oosW)}→${fmt(primaryRecord('U2','R1c').oosW)}；R1c的U3/U4/U6樣本外仍超過1.3，未過判準3。`,
  '全走階梯可越過本研究中的中間小改善步驟；本次各規則精修倍率均>4，因此沒有規則通過耗時判準。這些是固定候選與相同起點下的比較，未改門檻或設定。',
  '中斷0、重算0；21個完整Automatic與133個唯一候選結果均保存，共用結果未重跑。',
  `全部五判準通過者：${summary.passed.join(',')||'無'}。${passed.length>1?'其中實測耗時最低：'+fastest.join(',')+'（只列出，不決定採用）。':'未出現多個全通過規則，無需列最低者；未決定採用。'}`,
  '結果只涵蓋七個新合成真值、三選擇種子與兩獨立雜訊重複；相近分類不保證絕對準確。具體失敗成因與真實量測適用性無法判定。',
  `正式verify完整一次，exit${verification.exitCode}；typecheck/build等子項見verification.json；original ${verification.counts.original}、scientific ${verification.counts.scientific}、worker ${verification.counts.worker}；名稱/內容同4.7a=${verification.sameAs47a}。`,
  `新增失敗名稱${verification.newNames.length}；同名內容變更${verification.changed.length}；原始verify.log/verification.json，不修改測試。`,
  ...verification.failures.map((r:any)=>`失敗：${r.name}；${r.detail.replace(/\s+/g,' ').trim()}`));
 assert.ok(lines.length<=120,`report lines=${lines.length}`);writeFileSync('STAGE4_7B_REPORT.md',lines.join('\n')+'\n');console.log(JSON.stringify({reportLines:lines.length,passed:summary.passed,fastest}));
}
