import {unreliableUncertainty} from '../fitting/freeFormOptics';
import type {FittingResult} from '../types/ellipsometry';
import {exportOpticalConstantsCsv} from '../data/export';
export function OpticalModelComparisonPanel({result}:{result:FittingResult}) {
  const comparison=result.opticalModelComparison;
  if(!comparison)return null;
  return <details className="my-3 rounded border border-slate-700 p-3 text-xs text-slate-200" open>
    <summary>自由形式 / 物理模型比較（保留兩組結果）</summary>
    {result.freeFormFitAdequacyWarning&&<p role="alert" className="text-amber-300">自由形式：⚠ {result.freeFormFitAdequacyWarning}</p>}
    {result.fitAdequacyWarning&&<p role="alert" className="text-amber-300">物理模型：⚠ {result.fitAdequacyWarning}</p>}
    {comparison.warning&&<p role="alert" className="my-2 text-amber-300">{comparison.warning}</p>}
    <div className="overflow-x-auto"><table className="w-full my-2 text-right">
      <thead><tr><th>來源</th><th>MSE (Woollam)</th><th>有效參數</th><th>AIC</th><th>BIC</th></tr></thead>
      <tbody>{([['自由形式',comparison.freeForm],['物理模型',comparison.physical]] as const).map(([label,m])=>
        <tr key={label}><td>{label}</td><td>{m.mseWoollam.toPrecision(6)}</td><td>{m.effectiveParameters}</td><td>{m.aic.toFixed(2)}</td><td>{m.bic.toFixed(2)}</td></tr>)}</tbody>
    </table></div>
    <p>自由形式為非因果 n/k B-spline；有效參數排除鎖定與邊界。σ_k 使用含平滑正則化列的最終點共變異，條件於邊界係數固定。低於偵測限仍保留 k；無法識別時不提供 σ。兩者不會互相覆蓋。</p>
    {result.freeFormOpticalConstants&&<details><summary>自由形式 k 與 σ_k 預覽（每 50 nm）</summary><div className="overflow-auto max-h-64"><table><thead><tr><th>nm</th><th>k</th><th>σ_k</th><th>95% CI</th></tr></thead><tbody>{result.freeFormOpticalConstants.filter(q=>q.wavelength%50===0).map(q=><tr key={q.wavelength}><td>{q.wavelength}</td><td>{q.k.toPrecision(8)}</td><td>{q.kSigma?.toPrecision(6)??'—'}{unreliableUncertainty(q.fitAdequacy)&&<span title={result.freeFormFitAdequacyWarning}> ⚠ 不可信</span>}</td><td>{q.kCi95?.map(v=>v.toPrecision(6)).join(' — ')??'—'}</td></tr>)}</tbody></table></div></details>}
    {result.freeFormOpticalConstants&&<button className="mt-2 rounded bg-slate-700 px-3 py-2" onClick={()=>exportOpticalConstantsCsv(result.freeFormOpticalConstants!,'AutoEllipso_free_form_optical_constants.csv','free_form')}>下載自由形式 n/k + σ_k CSV</button>}
  </details>;
}
