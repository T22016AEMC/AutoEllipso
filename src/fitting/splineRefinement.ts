import {FIT_NUMERICS} from './numerics';
import type {OptimizationVariable} from './optimizer';

export const SPLINE_STAGES=[8,12,16,20,24,32,40] as const;
export interface SplineStageResult {
  knots:number; skipped:boolean; skipReason?:string; selected:boolean; elapsedMs:number;
  iterations?:number; status?:string; converged?:boolean; mseWoollam?:number; reducedChiSquare?:number;
  effectiveParameters?:number; bic?:number; deltaBic?:number|null;
  rawMse?:number; regularizationPenalty?:number; totalObjective?:number;
  weightedRegularizationPenalty?:number; weightedTotalObjective?:number; thicknessNm?:number;
}
/** Same linear u-space boundary definition used by final-point statistics. */
export function effectiveSplineParameters(variables:OptimizationVariable[],params:number[]):number {
  return variables.filter((v,i)=>{
    if(v.max<=v.min)return false;
    const u=(params[i]-v.min)/(v.max-v.min);
    return u>FIT_NUMERICS.boundaryEpsilon&&u<1-FIT_NUMERICS.boundaryEpsilon;
  }).length;
}
export function splineBic(observations:number,effectiveParameters:number,chiSquare:number,rss:number,sigma:boolean):number {
  if(observations<=0)throw new Error('BIC requires data residuals');
  return (sigma?chiSquare:observations*Math.log(Math.max(Number.MIN_VALUE,rss/observations)))+effectiveParameters*Math.log(observations);
}
export function continueSplineRefinement(previousBic:number|undefined,currentBic:number):boolean {
  return previousBic===undefined||previousBic-currentBic>10;
}
export function bestSplineStage(stages:Pick<SplineStageResult,'knots'|'bic'|'skipped'>[]):number {
  let best=-1;
  stages.forEach((s,i)=>{if(!s.skipped&&s.bic!==undefined&&(best<0||s.bic<stages[best].bic!||s.bic===stages[best].bic&&s.knots<stages[best].knots))best=i;});
  return best;
}
