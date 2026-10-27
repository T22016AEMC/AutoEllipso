import type {FittingResult} from '../types/ellipsometry';
import {fitAssessment} from '../fitting/fitPresentation';

export function UnderdeterminedWarning({value}:{value?:boolean}) {
  return value?<span role="alert" className="text-amber-300">欠定：總觀測數 − 參數數 ≤ 0；數值保留，不應直接判讀充分性</span>:null;
}
export function FitAssessmentSummary({result}:{result:FittingResult}) {
  const assessment=fitAssessment(result);
  return <div className="text-xs text-slate-300">
    <span>MSE_W：{result.mseWoollam?.toPrecision(6)??'—'} · Raw MSE：{(result.rawMse??result.finalMse).toPrecision(6)} deg² · fitAdequacy：{assessment.fitAdequacy}</span>
    <p>{assessment.description}</p>
    <UnderdeterminedWarning value={result.underdetermined}/>
  </div>;
}
