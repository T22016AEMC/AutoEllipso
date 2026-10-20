import {unreliableUncertainty} from '../fitting/freeFormOptics';
import React from 'react';
import type {FittedParameterResult,FittingResult} from '../types/ellipsometry';
import type {FitStatistics} from '../fitting/statistics';

const number=(v:number|null|undefined)=>v===null||v===undefined?'—':v.toPrecision(5);
export function StatisticsWarning({statistics:s}:{statistics?:FitStatistics}) {
  return s&&(s.conditionLevel==='severe'||s.parameters.some(p=>p.nonIdentifiable))?
    <p role="alert" className="text-amber-300 text-xs p-2 border border-amber-700 rounded">參數之間高度相關，個別數值不可信，建議固定其中一個參數</p>:null;
}
export function ParameterEstimate({result,parameter:p}:{result:FittingResult;parameter:FittedParameterResult}) {
  const stat=result.statistics?.parameters.find(s=>s.id===`${p.layerId}.${p.paramId}`);
  const index=result.statistics?.correlation.ids.indexOf(`${p.layerId}.${p.paramId}`)??-1;
  const correlations=index>=0?result.statistics!.correlation.matrix[index]:[];
  const high=correlations.map((r,j)=>r!==null&&j!==index&&Math.abs(r)>.95?`${result.statistics!.correlation.ids[j]} (r=${r.toFixed(4)})`:null).filter(Boolean);
  return <span title={high.length?`高相關：${high.join('、')}`:undefined}>
    {stat?number(stat.value):p.finalValue.toFixed(4)}{stat?.stdError!==null&&stat?.stdError!==undefined?` ± ${number(stat.stdError)}`:''} {p.unit}
    {stat?.stdError!=null&&unreliableUncertainty(result.fitAdequacy)&&<span role="note" title={result.fitAdequacyWarning} className="text-amber-300"> ⚠ 不確定度不可信</span>}
    {stat?.boundaryHit&&<span className="ml-1 text-amber-300">在邊界</span>}
    {stat?.nonIdentifiable&&<span className="ml-1 text-amber-300">不可識別</span>}
    {!!high.length&&<span className="ml-1 text-amber-300">高相關 ⓘ</span>}
    {stat?.ci95&&<small className="block text-slate-400">95% CI [{number(stat.ci95[0])}, {number(stat.ci95[1])}]</small>}
  </span>;
}
export function FitStatisticsPanel({result}:{result:FittingResult|null}) {
  const s=result?.statistics;
  if(!s)return null;
  const physical=new Set(s.parameters.map(p=>p.id));
  const indices=s.correlation.ids.map((id,i)=>physical.has(id)?i:-1).filter(i=>i>=0);
  return <><p role="alert" className="text-amber-300 text-xs">{result?.fitAdequacyWarning?"⚠ "+result.fitAdequacyWarning:""}</p><details className="p-3 text-xs border border-slate-700 rounded bg-slate-900">
    <summary className="cursor-pointer text-cyan-300">統計 · {result?.converged?'已收斂':'未收斂'} ({result?.convergenceStatus??'未記錄'})</summary>
    {result?.fitAdequacyWarning&&<p role="alert" className="text-amber-300">⚠ {result.fitAdequacyWarning}</p>}
    <p className="my-2">dof {s.dof} · χ²ᵣ {number(s.reducedChiSquare)} · scaleFactor {number(s.scaleFactor)}</p>
    <p className={s.conditionLevel==='ok'?'text-slate-300':'text-amber-300'}>條件數 κ {s.conditionNumber===null?'∞（奇異）':number(s.conditionNumber)} · {s.conditionLevel==='severe'?'嚴重警告 (severe)':s.conditionLevel==='caution'?'注意 (caution)':'正常 (ok)'}</p>
    {!result?.converged&&<p className="text-amber-300">未收斂：以下為目前最終點的局部統計估計。</p>}
    {s.warnings.map((w,i)=><p role="note" className="text-amber-300 my-1" key={i}>{w}</p>)}
    <div className="overflow-auto my-2"><table className="w-full text-left"><thead><tr><th>物理參數</th><th>值 ± 標準誤 / 95% CI</th><th>未縮放標準誤</th></tr></thead>
      <tbody>{s.parameters.map(p=><tr key={p.id} className="border-t border-slate-800"><td className="p-1">{p.id}</td><td className="p-1">
        <ParameterEstimate result={result!} parameter={{layerId:p.id.slice(0,p.id.lastIndexOf('.')),paramId:p.id.slice(p.id.lastIndexOf('.')+1),finalValue:p.value,unit:''} as FittedParameterResult}/>
      </td><td className="p-1">{number(p.stdErrorUnscaled)}</td></tr>)}</tbody></table></div>
    <p className="text-slate-400">所有自由參數（含樣條係數）均納入 dof、共變異與條件數；僅列出物理參數個別統計。</p>
    {s.correlation.ids.length>12?<div className="my-2">|r| 最大的 5 對：{s.correlation.topPairs.map(p=><p key={p.ids.join('|')}>{p.ids.join(' ↔ ')}：{number(p.correlation)}</p>)}</div>:
      <div className="overflow-auto my-2"><table aria-label="參數相關矩陣" className="text-right"><thead><tr><th></th>{indices.map(i=><th className="px-2" key={i}>{s.correlation.ids[i]}</th>)}</tr></thead>
        <tbody>{indices.map(i=><tr key={i}><th className="px-2">{s.correlation.ids[i]}</th>{indices.map(j=><td key={j} className={i!==j&&Math.abs(s.correlation.matrix[i][j]??0)>.95?'px-2 text-amber-300':'px-2'}>{number(s.correlation.matrix[i][j])}</td>)}</tr>)}</tbody></table></div>}
  </details></>;
}
