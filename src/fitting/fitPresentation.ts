import type {FittingResult} from '../types/ellipsometry';
import {assessFitAdequacy} from './freeFormOptics';

/** Display assessment never interprets legacy target statuses as fit quality. */
export function fitAssessment(result:Pick<FittingResult,'statistics'|'weightingMode'>) {
  const assessment=assessFitAdequacy(result.statistics,result.weightingMode);
  const descriptions={good:'依量測 σ 與 reduced χ² 評估為充分',marginal:'擬合充分性介於臨界範圍',poor:'擬合不足',unknown:'無法評估擬合是否充分'};
  return {fitAdequacy:assessment.fitAdequacy,description:assessment.warning??descriptions[assessment.fitAdequacy]};
}

/** Raw-MSE ties retain the physical model; both exports remain available. */
export function defaultOpticalExport(result:FittingResult) {
  const comparison=result.opticalModelComparison;
  const source=comparison&&result.freeFormOpticalConstants?.length&&comparison.freeForm.rawMse<comparison.physical.rawMse?'free_form':'physical';
  const rawMse=comparison?.[source==='free_form'?'freeForm':'physical'].rawMse;
  const underdetermined=source==='free_form'?result.freeFormUnderdetermined:result.underdetermined;
  const adequacy=source==='free_form'?result.freeFormFitAdequacy:fitAssessment(result).fitAdequacy;
  const points=(source==='free_form'?result.freeFormOpticalConstants:result.finalOpticalConstants)?.map(p=>({...p,fitAdequacy:adequacy,underdetermined:p.underdetermined??underdetermined}));
  return {source,rawMse,points,label:`預設：${source==='free_form'?'自由形式':'物理模型'}（較低 Raw MSE：${rawMse?.toPrecision(6)??'無比較值'}）`} as const;
}
