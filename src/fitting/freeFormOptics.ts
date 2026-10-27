import type {FitStatistics} from './statistics';
import {studentT975} from './statistics';
import {cubicBasis} from '../models/cubicSpline';
import type {ResidualMetrics} from './residual';

export interface OpticalConstantPoint {
  wavelength:number;n:number;k:number;kSigma?:number|null;kCi95?:[number,number]|null;belowDetection?:boolean;fitAdequacy?:FitAdequacy;
  underdetermined?:boolean;
  freeFormOrigin?:import('./freeFormRefine').FreeFormOrigin;
}
export type FitAdequacy='good'|'marginal'|'poor'|'unknown';
/** Read existing final-point statistics; no new covariance or sigma estimate. */
export function assessFitAdequacy(statistics:Pick<FitStatistics,'reducedChiSquare'>|undefined,mode?:string):{fitAdequacy:FitAdequacy;warning?:string} {
  if(mode!=='sigma')return {fitAdequacy:'unknown',warning:'沒有 σ，無法評估擬合是否充分'};
  const reduced=statistics?.reducedChiSquare;
  if(reduced==null||!Number.isFinite(reduced))return {fitAdequacy:'unknown',warning:'無可用的 reduced χ²，無法評估擬合是否充分'};
  const fitAdequacy:FitAdequacy=reduced<=1.5?'good':reduced<=2?'marginal':'poor';
  return {fitAdequacy,...(fitAdequacy==='good'?{}:{warning:'擬合不足（reduced χ² = '+reduced.toPrecision(6)+'），不確定度與偵測旗標不可信'})};
}
export const unreliableUncertainty=(adequacy?:FitAdequacy)=>adequacy==='poor'||adequacy==='marginal';
export interface OpticalModelComparison {
  freeForm:{mseWoollam:number;rawMse:number;effectiveParameters:number;aic:number;bic:number};
  physical:OpticalModelComparison['freeForm'];
  significantFreeFormMaxK:number;physicalMaxK:number;warning?:string;
}
/** Propagate the existing final-point physical covariance; do not estimate another covariance. */
export function freeFormCurve(wavelengths:number[],knots:number[],n:number[],k:number[],statistics:FitStatistics,weightingMode?:string):OpticalConstantPoint[] {
  const {ids,matrix}=statistics.covariance,t=statistics.available?studentT975(statistics.dof):0;
  return wavelengths.map(wavelength=>{
    const b=cubicBasis(wavelength,knots),nv=b.reduce((s,x,i)=>s+x*n[i],0),kv=b.reduce((s,x,i)=>s+x*k[i],0);
    const indices=k.map((_,i)=>ids.indexOf(`K${i}`));
    // A boundary coefficient is fixed conditionally. Non-identifiable free coefficients cannot supply an error bar.
    const unknown=!statistics.available||indices.some((j,i)=>b[i]!==0&&j>=0&&statistics.correlation.matrix[j][j]===null);
    let variance=0;
    indices.forEach((i,a)=>{if(i>=0)indices.forEach((j,c)=>{if(j>=0)variance+=b[a]*matrix[i][j]*b[c];});});
    const kSigma=unknown?null:Math.sqrt(Math.max(0,variance));
    const kCi95:[number,number]|null=kSigma===null?null:[kv-t*kSigma,kv+t*kSigma];
    return {wavelength,n:nv,k:kv,kSigma,kCi95,...(kCi95?{belowDetection:kCi95[0]<=0}:{}),...(weightingMode?{fitAdequacy:assessFitAdequacy(statistics,weightingMode).fitAdequacy}:{})};
  });
}
export function compareOpticalModels(free:OpticalConstantPoint[],physical:OpticalConstantPoint[],
  freeMetrics:ResidualMetrics,physicalMetrics:ResidualMetrics,freeCount:number,physicalCount:number):OpticalModelComparison {
  const summarize=(m:ResidualMetrics,count:number)=>{
    const observations=2*m.totalPoints,rss=Math.max(1e-12,m.rawMse*observations);
    return {mseWoollam:m.mseWoollam,rawMse:m.rawMse,effectiveParameters:count,
      aic:observations*Math.log(rss/observations)+2*count,bic:observations*Math.log(rss/observations)+count*Math.log(observations)};
  };
  const significant=free.filter(p=>p.kSigma!==null&&p.kSigma!==undefined&&p.k>2*p.kSigma);
  const significantFreeFormMaxK=Math.max(0,...significant.map(p=>p.k)),physicalMaxK=Math.max(0,...physical.map(p=>p.k));
  const atMaximum=significant.find(p=>p.k===significantFreeFormMaxK);
  const warning=atMaximum&&significantFreeFormMaxK-physicalMaxK>2*atMaximum.kSigma!
    ?`物理模型在資料範圍內 k 偏低，與自由形式曲線差異如下：顯著自由形式 max k=${significantFreeFormMaxK.toPrecision(8)}，物理 max k=${physicalMaxK.toPrecision(8)}（差異 > 2σ_k）。`:undefined;
  return {freeForm:summarize(freeMetrics,freeCount),physical:summarize(physicalMetrics,physicalCount),significantFreeFormMaxK,physicalMaxK,...(warning?{warning}:{})};
}
