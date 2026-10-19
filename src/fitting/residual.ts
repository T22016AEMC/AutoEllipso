/**
 * Unified Residual Calculator for Spectroscopic Ellipsometry
 * Evaluates point-by-point errors and aggregate MSE / RMSE metrics.
 *
 * Implements strict separation between:
 *   - Raw MSE (unweighted, physical ground-truth comparison)
 *   - Weighted MSE (with user or experimental uncertainties)
 *   - Information criteria: AIC, BIC for overfitting diagnostics
 */
import { EllipsometryDataPoint, FittingConfig } from '../types/ellipsometry';

export function residualWeights(points: EllipsometryDataPoint[], config: Pick<FittingConfig,'fitWeighting'|'psiWeight'|'deltaWeight'>):
  {weights:number[];mode:'sigma'|'uniform'|'psi_dominant';warning?:string} {
  const sigma = points.every(p => Number.isFinite(p.psiSigma) && p.psiSigma! > 0 && Number.isFinite(p.deltaSigma) && p.deltaSigma! > 0);
  const mode = config.fitWeighting === 'standard_deviation' ? (sigma ? 'sigma' : 'uniform') : config.fitWeighting ?? 'uniform';
  const warning = config.fitWeighting === 'standard_deviation' && !sigma ? '部分資料點缺少 σ，已改用均勻權重（MSE 以 σ = 1° 計算）' : undefined;
  const psi = config.psiWeight ?? 1, delta = config.deltaWeight ?? 1;
  if (![psi,delta].every(v=>Number.isFinite(v)&&v>=0)) throw new Error('Residual component weights must be finite and nonnegative');
  const weights=points.flatMap(p=>{
    const legacy=mode!=='sigma' ? p.weight ?? 1 : 1;
    if (!Number.isFinite(legacy)||legacy<0) throw new Error('Point weight must be finite and nonnegative');
    return [(mode==='sigma'?1/p.psiSigma!:mode==='psi_dominant'?Math.sqrt(2):1)*Math.sqrt(psi*legacy),
      (mode==='sigma'?1/p.deltaSigma!:mode==='psi_dominant'?Math.sqrt(.5):1)*Math.sqrt(delta*legacy)];
  });
  return {weights,mode,warning};
}

export interface ResidualMetrics {
  mse: number; // Raw MSE (Mean Squared Error)
  rmse: number; // Raw RMSE (Root Mean Squared Error)
  rawMse: number;
  rawRmse: number;
  weightedMse: number;
  weightedRmse: number;
  chiSquare: number;
  dof: number;
  mseWoollam: number;
  reducedChiSquare: number;
  weightingMode: 'sigma'|'uniform'|'psi_dominant';
  weightingWarning?: string;
  psiMse: number;
  deltaMse: number;
  totalPoints: number;
  aic?: number;
  bic?: number;
}

/**
 * Calculate the shortest angular difference between two angles in degrees [-180, 180]
 */
export function circularDifferenceDeg(angle1: number, angle2: number): number {
  const diff = (angle1 - angle2) % 360;
  return diff > 180 ? diff - 360 : diff < -180 ? diff + 360 : diff;
}

/**
 * Compute residual metrics across a dataset
 */
export function computeResidualMetrics(
  points: EllipsometryDataPoint[],
  weightingType: 'uniform' | 'standard_deviation' | 'psi_dominant' = 'uniform',
  psiWeight: number = 1.0,
  deltaWeight: number = 1.0,
  numParameters: number = 0
): ResidualMetrics {
  const {weights,mode,warning}=residualWeights(points,{fitWeighting:weightingType,psiWeight,deltaWeight});
  let sumPsiSq=0,sumDeltaSq=0,sumWeightedResidualSq=0,validCount=0;
  points.forEach((pt,i)=>{
    if (pt.psiCalc===undefined || pt.deltaCalc===undefined) return;
    const psiRes=pt.psiCalc-pt.psiExp,deltaRes=circularDifferenceDeg(pt.deltaCalc,pt.deltaExp);
    sumPsiSq+=psiRes*psiRes;sumDeltaSq+=deltaRes*deltaRes;
    sumWeightedResidualSq+=(weights[2*i]*psiRes)**2+(weights[2*i+1]*deltaRes)**2;validCount++;
  });
  const totalObs=2*validCount,dof=Math.max(1,totalObs-numParameters),rawSumSq=sumPsiSq+sumDeltaSq;
  const rawMse=rawSumSq/Math.max(1,totalObs),rawRmse=Math.sqrt(rawMse);
  const weightedMse=sumWeightedResidualSq/Math.max(1,totalObs),weightedRmse=Math.sqrt(weightedMse);
  const psiMse=sumPsiSq/Math.max(1,validCount),deltaMse=sumDeltaSq/Math.max(1,validCount);

  // Information criteria for model complexity vs overfitting assessment
  let aic: number | undefined;
  let bic: number | undefined;
  if (numParameters > 0 && totalObs > 0) {
    const rss = Math.max(1e-12, rawSumSq);
    aic = Number((totalObs * Math.log(rss / totalObs) + 2 * numParameters).toFixed(2));
    bic = Number((totalObs * Math.log(rss / totalObs) + numParameters * Math.log(totalObs)).toFixed(2));
  }

  return {
    mse: rawMse, // Default MSE is always strict unweighted Raw MSE
    rmse: rawRmse,
    rawMse: rawMse,
    rawRmse: rawRmse,
    weightedMse: weightedMse,
    weightedRmse: weightedRmse,
    chiSquare: sumWeightedResidualSq,
    dof,mseWoollam:Math.sqrt(sumWeightedResidualSq/dof),reducedChiSquare:sumWeightedResidualSq/dof,
    weightingMode:mode,weightingWarning:warning,
    psiMse: psiMse,
    deltaMse: deltaMse,
    totalPoints: validCount,
    aic,
    bic,
  };
}

export interface AoiMetricBreakdown extends ResidualMetrics {
  aoi: number;
  mse: number;
  rmse: number;
  psiMse: number;
  deltaMse: number;
  totalPoints: number;
}

export interface MultiAoiResidualMetrics extends ResidualMetrics {
  fittingMode: 'single_aoi' | 'multi_aoi';
  selectedAois: number[];
  perAoi: Record<number, AoiMetricBreakdown>;
}

/**
 * Compute residual metrics broken down across multiple AOIs and globally
 */
export function computeMultiAoiResidualMetrics(
  points: EllipsometryDataPoint[],
  activeAois?: number[],
  weightingType: 'uniform' | 'standard_deviation' | 'psi_dominant' = 'uniform',
  psiWeight: number = 1.0,
  deltaWeight: number = 1.0,
  numParameters: number = 0
): MultiAoiResidualMetrics {
  const allAois = Array.from(new Set(points.map((p) => p.aoi))).sort((a, b) => a - b);
  const selectedAois = activeAois && activeAois.length > 0 ? activeAois : allAois;

  const filteredPoints = points.filter((p) => selectedAois.includes(p.aoi));
  const globalMetrics = computeResidualMetrics(
    filteredPoints,
    weightingType,
    psiWeight,
    deltaWeight,
    numParameters
  );

  const perAoi: Record<number, AoiMetricBreakdown> = {};
  selectedAois.forEach((aoi) => {
    const aoiPoints = points.filter((p) => p.aoi === aoi);
    // A missing sigma anywhere falls back uniformly for the entire joint dataset.
    const perAoiWeighting = weightingType==='standard_deviation' && globalMetrics.weightingMode!=='sigma' ? 'uniform' : weightingType;
    const m = computeResidualMetrics(aoiPoints, perAoiWeighting, psiWeight, deltaWeight, numParameters);
    perAoi[aoi] = {
      ...m,
      aoi,
      mse: m.rawMse,
      rmse: m.rawRmse,
      psiMse: m.psiMse,
      deltaMse: m.deltaMse,
      totalPoints: m.totalPoints,
    };
  });

  return {
    ...globalMetrics,
    fittingMode: selectedAois.length > 1 ? 'multi_aoi' : 'single_aoi',
    selectedAois,
    perAoi,
  };
}

/**
 * Identify the spectral region with the largest residual
 * Returns descriptive summary, center peak wavelength (nm), and resonance energy (eV)
 */
export function findLargestResidualRegion(points: EllipsometryDataPoint[]): {
  regionDescription: string;
  peakWavelengthNm: number;
  peakEnergyEv: number;
  peakResidualDeg: number;
} {
  const valid = points.filter((p) => p.psiCalc !== undefined && p.deltaCalc !== undefined);
  if (valid.length === 0) {
    return {
      regionDescription: '無可用計算殘差',
      peakWavelengthNm: 400,
      peakEnergyEv: 3.1,
      peakResidualDeg: 0,
    };
  }

  // Find individual peak residual
  let maxRes = -1;
  let peakWl = valid[0].wavelength;

  for (const pt of valid) {
    const psiDiff = Math.abs(pt.psiCalc! - pt.psiExp);
    const deltaDiff = Math.abs(circularDifferenceDeg(pt.deltaCalc!, pt.deltaExp));
    const combinedRes = Math.sqrt(psiDiff * psiDiff + deltaDiff * deltaDiff);
    if (combinedRes > maxRes) {
      maxRes = combinedRes;
      peakWl = pt.wavelength;
    }
  }

  const peakEnergyEv = Number((1239.84 / Math.max(100, peakWl)).toFixed(2));

  // Determine spectral band description
  let bandName = '可見光區 (Vis)';
  if (peakWl < 380) {
    bandName = '紫外/深紫外區 (UV/DUV) - 電子帶間躍遷帶';
  } else if (peakWl < 500) {
    bandName = '藍光/近紫外區 (Blue-UV)';
  } else if (peakWl > 750) {
    bandName = '近紅外區 (NIR) - 自由載子或吸收基線帶';
  }

  const spanMin = Math.max(190, Math.round(peakWl - 40));
  const spanMax = Math.round(peakWl + 40);

  return {
    regionDescription: `${spanMin} ~ ${spanMax} nm (${bandName})`,
    peakWavelengthNm: peakWl,
    peakEnergyEv,
    peakResidualDeg: Number(maxRes.toFixed(2)),
  };
}
