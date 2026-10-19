/**
 * AutoEllipso — Automated Spectroscopic Ellipsometry Thin-Film Fitting and Optical Constant Extraction
 *
 * Fixed Scientific Fitting Pipeline:
 *   Experimental Ψ / Δ
 *          ↓
 *   Data Validation & AOI Detection
 *          ↓
 *   Cauchy 0-point (Transparent region baseline n(λ) and initial thickness basin)
 *          ↓
 *   Adaptive B-spline n/k (Progressive 8 → 12 → 16 → 20 knots with 2nd-order smoothness regularization)
 *          ↓
 *   B-spline Diagnostic (Raw MSE, Regularization Penalty, Total Objective, RMSE, Psi RMSE, Delta RMSE)
 *          ↓
 *   User Selected Physical Model (Gaussian / Lorentz / Tauc-Lorentz / Drude / Automatic)
 *          ↓
 *   Physical Constraints (n >= 1, k >= 0, d > 0, E0 > Eg, etc.)
 *          ↓
 *   Effective Global Thickness Search (Multi-basin discovery + local index-thickness relaxation)
 *          ↓
 *   True Multi-Start Joint Optimization (>= 20 independent starts perturbing thickness + all oscillator params)
 *          ↓
 *   Fresh Forward Recalculation (rp/rs -> Ψcalc/Δcalc -> Final Raw MSE verification)
 *          ↓
 *   Export
 */

import { normalizeDeltaDeg } from '../solver/ellipsometricAngles';
import {
  Ambient,
  Layer,
  Substrate,
  EllipsometryDataPoint,
  FittingConfig,
  FittingResult,
  FittedParameterResult,
  ParameterValue,
} from '../types/ellipsometry';
import { modelRegistry } from '../modelRegistry/registry';
import { calculateSpectrum, calculatePoint } from '../solver/calculator';
import {
  computeResidualMetrics,
  computeMultiAoiResidualMetrics,
  residualWeights,
  circularDifferenceDeg,
  findLargestResidualRegion,
} from './residual';
import { ConvergenceStatus } from './numerics';
import { optimizeBoundedLM, OptimizationVariable } from './optimizer';
import {
  generateAdaptiveKnots,
  setActiveKnots,
  evaluateAdaptiveSpline,
  computeBsplineSmoothness,
} from '../models/bspline';

export type WorkflowStage =
  | 'idle'
  | 'validating_data'
  | 'stage1_cauchy'
  | 'stage2_bspline'
  | 'stage_bspline_diagnostic'
  | 'stage3_physicalizing'
  | 'stage_thickness_search'
  | 'stage4_multilayer_optimizing'
  | 'stage_multistart'
  | 'stage5_final_rebuild'
  | 'completed'
  | 'failed';

export interface WorkflowProgress {
  stage: WorkflowStage;
  stageName: string;
  stepNumber: number;
  totalSteps: number;
  progressPercent: number;
  iteration: number;
  currentMse: number;
  currentRmse: number;
  bestMse: number;
  targetMse: number;
  currentThickness: number;
  message: string;
  currentModelName?: string;
  oscillatorsCount?: number;
  maxOscillators?: number;
  bsplineKnots?: number;
  maxBsplineKnots?: number;
  multiStartRun?: number;
  totalMultiStartRuns?: number;
  currentParams?: { name: string; value: number }[];
}

export interface ModelComparisonResult {
  modelId: string;
  modelName: string;
  finalMse: number;
  finalRmse: number;
  psiRmse: number;
  deltaRmse: number;
  finalThickness: number;
  iterations: number;
  converged: boolean;
  fittedParameters: FittedParameterResult[];
}

export interface KnotStageRecord {
  knots: number;
  rawMse: number;
  regularizationPenalty: number;
  totalObjective: number;
  weightedRegularizationPenalty?:number;
  weightedTotalObjective?:number;
  thicknessNm: number;
}

export interface MultiStartRunRecord {
  startIndex: number;
  initialThickness: number;
  finalThickness: number;
  rawMse: number;
  initialParams: Record<string, number>;
  finalParams: Record<string, number>;
}

export interface PipelineAuditData {
  experimentalAois: number[];
  cauchy0Point: {
    parameters: Record<string, number>;
    thicknessNm: number;
    rawMse: number;
  };
  bspline: {
    nodeWavelengths: number[];
    nodeCoefficients: Record<string, number>;
    thicknessNm: number;
    rawMse: number;
    regularizationPenalty: number;
    weightedRegularizationPenalty?:number;
    weightedTotalObjective?:number;
    smoothN: number;
    smoothK: number;
    totalObjective: number;
    rmse: number;
    psiRmse: number;
    deltaRmse: number;
    knotRefinementHistory: KnotStageRecord[];
  };
  selectedPhysicalModel: string;
  physicalModelParameters: Record<string, number>;
  finalThicknessNm: number;
  rawMse: number;
  rawRmse: number;
  psiRmse: number;
  deltaRmse: number;
  perAoiMse: Record<number, number>;
  multiStartSummary: {
    totalStarts: number;
    validStarts: number;
    bestStartIndex: number;
    bestRawMse: number;
    bestMseWoollam?:number;
    runs: MultiStartRunRecord[];
  };
  physicalModelMismatch?: boolean;
  freshCalculationVerified?: boolean;
}

export interface AutoFitWorkflowOptions {
  ambient: Ambient;
  layers: Layer[];
  substrate: Substrate;
  points: EllipsometryDataPoint[];
  config: FittingConfig;
  targetModelId?: string;
  selectedAois?: number[];
  onProgress?: (progress: WorkflowProgress) => void;
  shouldStop?: () => boolean;
}

export interface AutoFitWorkflowOutput {
  updatedLayers: Layer[];
  updatedSubstrate: Substrate;
  updatedPoints: EllipsometryDataPoint[];
  fittingResult: FittingResult;
  finalThickness: number;
  finalOpticalConstants: { wavelength: number; n: number; k: number }[];
  modelComparisons?: ModelComparisonResult[];
  workflowLog: string[];
  pipelineData: PipelineAuditData;
}

/**
 * Validates experimental data before starting fitting
 */
export function validateExperimentalData(
  points: EllipsometryDataPoint[],
  userPromptAoi?: number
): { isValid: boolean; errors: string[]; sanitizedPoints: EllipsometryDataPoint[]; aois: number[] } {
  const errors: string[] = [];
  if (!points || points.length === 0) {
    return { isValid: false, errors: ['資料庫為空，請先匯入實驗光譜資料 (Import Experimental Data)'], sanitizedPoints: [], aois: [] };
  }

  const sanitized: EllipsometryDataPoint[] = [];
  const seenWavelengthAoi = new Set<string>();

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    let aoi = pt.aoi;
    if (aoi === undefined || isNaN(aoi) || aoi <= 0 || aoi >= 90) {
      if (userPromptAoi && userPromptAoi > 0 && userPromptAoi < 90) {
        aoi = userPromptAoi;
      } else {
        errors.push(`第 ${i + 1} 筆資料之入射角 AOI 缺失或不合法 (${aoi}°)。必須為 0° ~ 90°。`);
        break;
      }
    }

    if (isNaN(pt.wavelength) || pt.wavelength <= 0 || !isFinite(pt.wavelength)) {
      errors.push(`第 ${i + 1} 筆資料之波長無效或為空 (${pt.wavelength})。`);
      continue;
    }

    if (isNaN(pt.psiExp) || !isFinite(pt.psiExp) || pt.psiExp < 0 || pt.psiExp > 90) {
      errors.push(`第 ${i + 1} 筆資料之 Psi (Ψ) 超出物理範圍 [0°, 90°]: ${pt.psiExp}`);
      continue;
    }

    if (isNaN(pt.deltaExp) || !isFinite(pt.deltaExp)) {
      errors.push(`第 ${i + 1} 筆資料之 Delta (Δ) 為無效數值 (NaN/Inf)。`);
      continue;
    }

    const key = `${pt.wavelength.toFixed(2)}_${aoi.toFixed(1)}`;
    if (seenWavelengthAoi.has(key)) {
      continue;
    }
    seenWavelengthAoi.add(key);

    const normDelta = normalizeDeltaDeg(pt.deltaExp);

    sanitized.push({
      ...pt,
      aoi,
      deltaExp: normDelta,
    });
  }

  const detectedAois = Array.from(new Set(sanitized.map((p) => p.aoi))).sort((a, b) => a - b);

  if (detectedAois.length === 0) {
    errors.push('未能偵測到任何有效的入射角 AOI (Angle of Incidence)。');
  }

  return {
    isValid: errors.length === 0 && sanitized.length > 0,
    errors,
    sanitizedPoints: sanitized,
    aois: detectedAois,
  };
}

/**
 * Helper to compute individual Psi RMSE and Delta RMSE from evaluated points
 */
function computePsiDeltaRmse(evaluatedPoints: EllipsometryDataPoint[]): { psiRmse: number; deltaRmse: number } {
  if (!evaluatedPoints || evaluatedPoints.length === 0) {
    return { psiRmse: 0, deltaRmse: 0 };
  }
  let sumPsiSq = 0;
  let sumDeltaSq = 0;
  let count = 0;
  for (const pt of evaluatedPoints) {
    if (pt.psiCalc === undefined || pt.deltaCalc === undefined) continue;
    const pRes = pt.psiCalc - pt.psiExp;
    const dRes = circularDifferenceDeg(pt.deltaCalc, pt.deltaExp);
    sumPsiSq += pRes * pRes;
    sumDeltaSq += dRes * dRes;
    count++;
  }
  if (count === 0) return { psiRmse: 0, deltaRmse: 0 };
  return {
    psiRmse: Math.sqrt(sumPsiSq / count),
    deltaRmse: Math.sqrt(sumDeltaSq / count),
  };
}

/**
 * Generate a decimated subset of points for fast exploratory scanning while preserving spectral coverage
 */
function getSubsampledPoints(points: EllipsometryDataPoint[], maxCount: number = 32): EllipsometryDataPoint[] {
  if (points.length <= maxCount) return points;
  const step = Math.max(1, Math.floor(points.length / maxCount));
  const result: EllipsometryDataPoint[] = [];
  for (let i = 0; i < points.length; i += step) {
    result.push(points[i]);
  }
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1]);
  }
  return result;
}

/**
 * Construct a distinct, physically self-consistent parameter set for Multi-Start #startIdx
 * Every start independently initializes and perturbs:
 *   eps_inf, oscillator amplitude (A), center energy (E0), broadening (sigma/gamma/C), bandgap (Eg),
 *   and 2nd/3rd oscillators (A2/E02/sigma2, A3/E03/sigma3) when enabled.
 */
function buildPerturbedPhysicalStartParams(
  modelId: string,
  baseParams: Record<string, ParameterValue>,
  bsplineSpectrum: { wavelength: number; n: number; k: number }[],
  startIdx: number,
  activeOscillatorCount: number
): Record<string, ParameterValue> {
  const params: Record<string, ParameterValue> = JSON.parse(JSON.stringify(baseParams));
  const modelDef = modelRegistry.get(modelId);
  if (!modelDef || bsplineSpectrum.length === 0) return params;

  const sorted = [...bsplineSpectrum].sort((a, b) => a.wavelength - b.wavelength);
  const maxK = Math.max(...sorted.map((p) => p.k));
  const minWl = sorted[0].wavelength;
  const maxEnergyEv = 1239.84 / Math.max(120, minWl);
  const isTransparent = maxK < 0.035;

  // Compute target eps1, eps2 at sampled wavelengths for fast least-squares amplitude/eps_inf matching
  const sampleStep = Math.max(1, Math.floor(sorted.length / 16));
  const sampled = sorted.filter((_, idx) => idx % sampleStep === 0);

  const clampAndSet = (key: string, val: number, fit?: boolean) => {
    if (!params[key]) return;
    const c = Math.max(params[key].min, Math.min(params[key].max, val));
    params[key].current = Number(c.toFixed(4));
    if (fit !== undefined) params[key].fit = fit;
  };

  // Helper to solve linear least squares for (eps_inf, A) given candidate shape parameters
  const matchBaseline = (
    shapeRecord: Record<string, number>,
    ampKey: string,
    ampPerturbFactor: number,
    epsInfDelta: number
  ) => {
    let s11 = sampled.length;
    let s12 = 0;
    let s22 = 0;
    let rhs1 = 0;
    let rhs2 = 0;
    const b1Arr: number[] = [];

    for (const pt of sampled) {
      const unitRec = { ...shapeRecord, eps_inf: 1.0, [ampKey]: 1.0, A2: 0, A3: 0 };
      const eps = modelDef.calculateEpsilon(pt.wavelength, unitRec);
      const b1 = eps.eps1 - 1.0;
      const b2 = eps.eps2;
      b1Arr.push(b1);
      const t1 = pt.n * pt.n - pt.k * pt.k;
      const t2 = 2 * pt.n * pt.k;
      s12 += b1;
      s22 += b1 * b1 + 2.5 * b2 * b2;
      rhs1 += t1;
      rhs2 += b1 * t1 + 2.5 * b2 * t2;
    }

    const det = s11 * s22 - s12 * s12;
    let estA = params[ampKey]?.current ?? 5.0;
    if (Math.abs(det) > 1e-9) {
      estA = (s11 * rhs2 - s12 * rhs1) / det;
    }
    const minA = params[ampKey]?.min ?? 0.05;
    const maxA = params[ampKey]?.max ?? 100.0;
    estA = Math.max(minA, Math.min(maxA, estA * ampPerturbFactor));

    const meanEps1 =
      sampled.reduce((acc, pt, idx) => {
        const t1 = pt.n * pt.n - pt.k * pt.k;
        return acc + (t1 - estA * b1Arr[idx]);
      }, 0) / sampled.length;

    const minEps = params['eps_inf']?.min ?? 1.0;
    const maxEps = params['eps_inf']?.max ?? 15.0;
    const estEpsInf = Math.max(minEps, Math.min(maxEps, meanEps1 + epsInfDelta));

    return { epsInf: estEpsInf, A: estA };
  };

  // Start 0 uses the exact B-spline feature-extracted parameters
  if (startIdx === 0) {
    return params;
  }

  // Deterministic multi-dimensional perturbation sequences for starts 1..25+
  const e0OffsetsInBand = [-0.6, -0.35, -0.18, -0.08, 0.08, 0.2, 0.38, 0.65, -0.45, 0.5];
  const vuvPoles = [7.4, 8.1, 8.8, 9.4, 10.0, 10.6, 11.2, 11.8, 12.5, 13.2];
  const widthScales = [0.65, 0.8, 0.92, 1.08, 1.25, 1.45, 0.55, 1.65];
  const ampScales = [0.75, 0.88, 0.96, 1.05, 1.15, 1.3, 0.65, 1.4];
  const epsDeltas = [-0.25, -0.12, -0.05, 0.0, 0.06, 0.14, 0.25, -0.18];

  const wScale = widthScales[startIdx % widthScales.length];
  const aScale = ampScales[(startIdx * 3) % ampScales.length];
  const epsDelta = epsDeltas[(startIdx * 5) % epsDeltas.length];

  // Decide whether this start explores VUV dielectric pole or in-band absorption resonance
  const useVuvPole = isTransparent ? startIdx % 5 !== 4 : startIdx % 4 === 3;

  if (modelId === 'gaussian') {
    const baseE0 = baseParams['E0']?.current ?? 3.6;
    const baseSigma = baseParams['sigma']?.current ?? 0.55;

    const targetE0 = useVuvPole
      ? vuvPoles[startIdx % vuvPoles.length]
      : Math.max(1.0, Math.min(13.5, baseE0 + e0OffsetsInBand[startIdx % e0OffsetsInBand.length]));
    const targetSigma = useVuvPole
      ? Math.max(0.18, Math.min(1.2, 0.45 * wScale))
      : Math.max(0.1, Math.min(3.0, baseSigma * wScale));

    const matched = matchBaseline({ E0: targetE0, sigma: targetSigma }, 'A', aScale, epsDelta);
    clampAndSet('eps_inf', matched.epsInf, true);
    clampAndSet('A', matched.A, true);
    clampAndSet('E0', targetE0, true);
    clampAndSet('sigma', targetSigma, true);

    if (activeOscillatorCount >= 2) {
      const baseA2 = Math.max(0.3, (baseParams['A2']?.current || matched.A * 0.25) * aScale);
      const baseE02 = Math.min(14.5, targetE0 + (startIdx % 2 === 0 ? 1.4 : -1.1));
      const baseSigma2 = Math.max(0.15, targetSigma * (0.8 + 0.1 * (startIdx % 4)));
      clampAndSet('A2', baseA2, true);
      clampAndSet('E02', Math.max(1.0, baseE02), true);
      clampAndSet('sigma2', baseSigma2, true);
    } else {
      clampAndSet('A2', 0.0, false);
      if (params['E02']) params['E02'].fit = false;
      if (params['sigma2']) params['sigma2'].fit = false;
    }

    if (activeOscillatorCount >= 3) {
      const baseA3 = Math.max(0.2, (baseParams['A3']?.current || matched.A * 0.15) * wScale);
      const baseE03 = Math.min(14.8, targetE0 + 2.4);
      const baseSigma3 = Math.max(0.2, targetSigma * 1.1);
      clampAndSet('A3', baseA3, true);
      clampAndSet('E03', Math.max(1.2, baseE03), true);
      clampAndSet('sigma3', baseSigma3, true);
    } else {
      clampAndSet('A3', 0.0, false);
      if (params['E03']) params['E03'].fit = false;
      if (params['sigma3']) params['sigma3'].fit = false;
    }
  } else if (modelId === 'lorentz') {
    const baseE0 = baseParams['E0']?.current ?? 3.8;
    const baseGamma = baseParams['gamma']?.current ?? 0.45;

    const targetE0 = useVuvPole
      ? vuvPoles[startIdx % vuvPoles.length]
      : Math.max(1.0, Math.min(13.5, baseE0 + e0OffsetsInBand[startIdx % e0OffsetsInBand.length]));
    const targetGamma = useVuvPole
      ? Math.max(0.002, Math.min(0.15, 0.015 * wScale))
      : Math.max(0.05, Math.min(3.5, baseGamma * wScale));

    const matched = matchBaseline({ E0: targetE0, gamma: targetGamma }, 'A', aScale, epsDelta);
    clampAndSet('eps_inf', matched.epsInf, true);
    clampAndSet('A', matched.A, true);
    clampAndSet('E0', targetE0, true);
    clampAndSet('gamma', targetGamma, true);

    if (activeOscillatorCount >= 2) {
      clampAndSet('A2', Math.max(0.3, matched.A * 0.25 * aScale), true);
      clampAndSet('E02', Math.max(1.0, Math.min(14.5, targetE0 + 1.3)), true);
      clampAndSet('gamma2', Math.max(0.05, targetGamma * 1.1), true);
    } else {
      clampAndSet('A2', 0.0, false);
      if (params['E02']) params['E02'].fit = false;
      if (params['gamma2']) params['gamma2'].fit = false;
    }

    if (activeOscillatorCount >= 3) {
      clampAndSet('A3', Math.max(0.2, matched.A * 0.15 * wScale), true);
      clampAndSet('E03', Math.max(1.2, Math.min(14.8, targetE0 + 2.4)), true);
      clampAndSet('gamma3', Math.max(0.05, targetGamma * 1.2), true);
    } else {
      clampAndSet('A3', 0.0, false);
      if (params['E03']) params['E03'].fit = false;
      if (params['gamma3']) params['gamma3'].fit = false;
    }
  } else if (modelId === 'tauc_lorentz') {
    const baseE0 = baseParams['E0']?.current ?? 3.65;
    const baseC = baseParams['C']?.current ?? 1.5;
    const baseEg = baseParams['Eg']?.current ?? 3.1;

    const egOffsets = [-0.35, -0.18, -0.08, 0.0, 0.08, 0.18, 0.35];
    const targetEg = useVuvPole
      ? Math.max(6.5, maxEnergyEv + 0.2 + 0.3 * (startIdx % 5))
      : Math.max(0.4, Math.min(8.5, baseEg + egOffsets[startIdx % egOffsets.length]));
    const targetE0 = useVuvPole
      ? Math.max(targetEg + 1.2, vuvPoles[startIdx % vuvPoles.length])
      : Math.max(targetEg + 0.25, Math.min(13.5, baseE0 + e0OffsetsInBand[startIdx % e0OffsetsInBand.length]));
    const targetC = Math.max(0.15, Math.min(4.5, baseC * wScale));

    const matched = matchBaseline({ E0: targetE0, C: targetC, Eg: targetEg }, 'A', aScale, epsDelta);
    clampAndSet('eps_inf', matched.epsInf, true);
    clampAndSet('A', matched.A, true);
    clampAndSet('E0', targetE0, true);
    clampAndSet('C', targetC, true);
    clampAndSet('Eg', targetEg, true);

    if (activeOscillatorCount >= 2) {
      clampAndSet('A2', Math.max(5.0, matched.A * 0.25 * aScale), true);
      clampAndSet('E02', Math.max(targetEg + 0.4, Math.min(14.5, targetE0 + 1.3)), true);
      clampAndSet('C2', Math.max(0.2, targetC * 1.1), true);
    } else {
      clampAndSet('A2', 0.0, false);
      if (params['E02']) params['E02'].fit = false;
      if (params['C2']) params['C2'].fit = false;
    }

    if (activeOscillatorCount >= 3) {
      clampAndSet('A3', Math.max(5.0, matched.A * 0.15 * wScale), true);
      clampAndSet('E03', Math.max(targetEg + 0.6, Math.min(14.8, targetE0 + 2.4)), true);
      clampAndSet('C3', Math.max(0.2, targetC * 1.2), true);
    } else {
      clampAndSet('A3', 0.0, false);
      if (params['E03']) params['E03'].fit = false;
      if (params['C3']) params['C3'].fit = false;
    }
  } else if (modelId === 'drude') {
    const baseEps = baseParams['eps_inf']?.current ?? 2.2;
    const baseWp = baseParams['wp']?.current ?? 1.5;
    const baseGamma = baseParams['gamma']?.current ?? 0.25;
    clampAndSet('eps_inf', baseEps + epsDelta * 1.5, true);
    clampAndSet('wp', baseWp * aScale, true);
    clampAndSet('gamma', baseGamma * wScale, true);
  } else {
    // Generic perturbation for any other physical model
    for (const [k, p] of Object.entries(params)) {
      if (p.fit) {
        const span = p.max - p.min;
        const delta = ((startIdx % 7) - 3) * 0.04 * span;
        clampAndSet(k, p.current + delta, true);
      }
    }
  }

  return params;
}

/**
 * Execute AutoEllipso fitting workflow
 */
export async function runAutomatedEllipsometryFit(
  options: AutoFitWorkflowOptions
): Promise<AutoFitWorkflowOutput> {
  const {
    ambient,
    layers,
    substrate,
    points,
    config,
    targetModelId,
    selectedAois,
    onProgress,
    shouldStop,
  } = options;

  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(`[${new Date().toISOString().substring(11, 19)}] ${msg}`);
  };

  const TARGET_MSE = config.targetMse ?? 10.0;
  const isAggressiveMode = config.fittingStrategy !== 'standard';
  const psiWeight = config.psiWeight ?? 1.0;
  const deltaWeight = config.deltaWeight ?? 1.0;

  if (layers.length === 0) {
    throw new Error('未定義任何薄膜層，請先新增至少一層薄膜 (At least 1 layer required)');
  }

  // Sample Structure: Default Single Layer (Ambient -> Film Layer -> Substrate)
  const isSingleLayerMode = (config.sampleStructure ?? 'single_layer') === 'single_layer';
  const workingLayers: Layer[] = isSingleLayerMode
    ? [JSON.parse(JSON.stringify(layers[0]))]
    : JSON.parse(JSON.stringify(layers));

  const primaryLayerIndex = 0;
  const primaryLayer = workingLayers[primaryLayerIndex];

  // Determine physical model (Cauchy and B-spline are fixed preprocessing stages, never the final physical model)
  const rawModelId = targetModelId || primaryLayer.modelId;
  const isAutoSelection = rawModelId === 'auto';
  const selectedPhysicalModelId =
    !isAutoSelection && rawModelId && rawModelId !== 'bspline' && rawModelId !== 'cauchy'
      ? rawModelId
      : 'gaussian';

  log('========================================================================');
  log(`【AutoEllipso — 核心光學反演引擎啟動】`);
  log(`樣品結構模式: ${isSingleLayerMode ? 'Single Layer (單層膜薄膜反演，預設)' : 'Multi-Layer Stack (多層結構)'}`);
  log(`流程固定前處理: [Cauchy 0-point] → [Progressive Regularized B-spline n/k] → [B-spline Diagnostic]`);
  log(`目標物理模型: 【${isAutoSelection ? 'Automatic (多模型自動比對)' : selectedPhysicalModelId}】`);
  log(`擬合策略: ${isAggressiveMode ? 'Aggressive (強制擬合)' : 'Standard (標準擬合)'} (目標 Raw MSE < ${TARGET_MSE.toFixed(2)})`);
  log('========================================================================');

  // =========================================================================
  // STEP 1: Data Validation & AOI Detection
  // =========================================================================
  if (shouldStop?.()) throw new Error('使用者中止擬合');

  const valResult = validateExperimentalData(points);
  if (!valResult.isValid) {
    throw new Error(`實驗資料校驗失敗: ${valResult.errors.join('; ')}`);
  }

  const datasetPoints = valResult.sanitizedPoints;
  const detectedAois = valResult.aois;
  const activeAois =
    selectedAois && selectedAois.length > 0
      ? selectedAois.filter((a) => detectedAois.includes(a))
      : detectedAois;

  const fitWlMin = config.fitWavelengthMin ?? Math.min(...datasetPoints.map((p) => p.wavelength));
  const fitWlMax = config.fitWavelengthMax ?? Math.max(...datasetPoints.map((p) => p.wavelength));

  const fittingPoints = datasetPoints.filter(
    (p) => activeAois.includes(p.aoi) && p.wavelength >= fitWlMin && p.wavelength <= fitWlMax
  );
  const fastScanPoints = getSubsampledPoints(fittingPoints, 28);

  const tMin = Math.max(0.1, config.minThickness ?? primaryLayer.thicknessMin ?? 0.1);
  const tMax = Math.min(5000.0, config.maxThickness ?? primaryLayer.thicknessMax ?? 5000.0);

  let totalOptimizerIterations = 0;

  let bestProgressMse=Infinity;
  const reportProgress = (p: Partial<WorkflowProgress>) => {
    if(p.currentMse!==undefined)bestProgressMse=Math.min(bestProgressMse,p.currentMse);
    onProgress?.({
      stage: p.stage ?? 'stage1_cauchy',
      stageName: p.stageName ?? '',
      stepNumber: p.stepNumber ?? 1,
      totalSteps: 8,
      progressPercent: p.progressPercent ?? Math.round(((p.stepNumber ?? 1) / 8) * 100),
      iteration: p.iteration ?? totalOptimizerIterations,
      currentMse: p.currentMse ?? 0,
      currentRmse: p.currentRmse ?? 0,
      bestMse: p.bestMse ?? (Number.isFinite(bestProgressMse)?bestProgressMse:0),
      targetMse: TARGET_MSE,
      currentThickness: p.currentThickness ?? workingLayers[primaryLayerIndex].thickness,
      message: p.message ?? '',
      currentModelName: p.currentModelName ?? modelRegistry.get(workingLayers[primaryLayerIndex].modelId)?.name,
      oscillatorsCount: p.oscillatorsCount,
      maxOscillators: config.maxOscillators ?? 3,
      bsplineKnots: p.bsplineKnots,
      maxBsplineKnots: config.maxBsplineKnots ?? 20,
      multiStartRun: p.multiStartRun,
      totalMultiStartRuns: p.totalMultiStartRuns,
      currentParams: p.currentParams,
    });
  };

  reportProgress({
    stage: 'validating_data',
    stageName: 'Data Validation & AOI Detection',
    stepNumber: 1,
    progressPercent: 8,
    message: `[1/8] 驗證實驗光譜：涵蓋 ${fitWlMin.toFixed(0)}~${fitWlMax.toFixed(0)} nm，AOI: ${activeAois.map((a) => `${a}°`).join(', ')}...`,
  });

  // =========================================================================
  // STEP 2: Cauchy 0-point Initialization (Transparent Region + Full Spectrum)
  // =========================================================================
  if (shouldStop?.()) throw new Error('使用者中止擬合');

  reportProgress({
    stage: 'stage1_cauchy',
    stageName: 'Cauchy 0-point Initialization',
    stepNumber: 2,
    progressPercent: 16,
    message: '[2/8] Cauchy 0-point 基準建立：搜尋透明區正常色散 n(λ) 與初始膜厚盆地...',
  });
  log('[2/8] Cauchy 0-point initialization: 建立透明區正常色散 baseline n(λ) 與初始厚度盆地');

  const cauchyLayers: Layer[] = JSON.parse(JSON.stringify(workingLayers));
  const cauchyParams = modelRegistry.createParameterSet('cauchy');
  cauchyLayers[primaryLayerIndex].modelId = 'cauchy';
  cauchyLayers[primaryLayerIndex].parameters = cauchyParams;
  cauchyLayers[primaryLayerIndex].thicknessFit = true;

  // Identify long-wavelength transparent window (upper 60% of wavelength range, >= 420 nm)
  const transparentWlThreshold = Math.max(420, fitWlMin + 0.4 * (fitWlMax - fitWlMin));
  const transparentPoints = fittingPoints.filter((p) => p.wavelength >= transparentWlThreshold);
  const cauchyScanPts = transparentPoints.length >= 6 ? transparentPoints : fastScanPoints;

  // 2D coarse scan over thickness and refractive index A so both low-n (SiO2 ~ 1.46) and high-n (TiO2 ~ 2.4) find their true basin
  const candidateAs = [1.45, 1.65, 1.95, 2.35];
  const maxCoarseT = Math.min(tMax, Math.max(300.0, primaryLayer.thickness * 2.5));
  const scanSteps = 45;

  let bestCauchyT = cauchyLayers[primaryLayerIndex].thickness;
  let bestCauchyA = 1.46;
  let bestCauchyB = 0.004;
  let lowestCoarseMse = Infinity;

  // Also explicitly include the current layer thickness in the coarse scan
  const testThicknesses: number[] = [primaryLayer.thickness];
  for (let s = 0; s <= scanSteps; s++) {
    testThicknesses.push(tMin + (s / scanSteps) * (maxCoarseT - tMin));
  }

  for (const aVal of candidateAs) {
    const bVal = aVal > 2.0 ? 0.035 : 0.004;
    cauchyLayers[primaryLayerIndex].parameters['A'].current = aVal;
    cauchyLayers[primaryLayerIndex].parameters['B'].current = bVal;
    cauchyLayers[primaryLayerIndex].parameters['C'].current = 0.0001;
    for (const testT of testThicknesses) {
      cauchyLayers[primaryLayerIndex].thickness = testT;
      const calcPts = calculateSpectrum(ambient, cauchyLayers, substrate, cauchyScanPts);
      const m = computeResidualMetrics(calcPts, config.fitWeighting, psiWeight, deltaWeight, 2);
      if (m.weightedMse < lowestCoarseMse) {
        lowestCoarseMse = m.weightedMse;
        bestCauchyT = testT;
        bestCauchyA = aVal;
        bestCauchyB = bVal;
      }
    }
  }

  // First optimize Cauchy on the long-wavelength normal-dispersion window (enforcing B >= 0)
  cauchyLayers[primaryLayerIndex].thickness = bestCauchyT;
  cauchyLayers[primaryLayerIndex].parameters['A'].current = bestCauchyA;
  cauchyLayers[primaryLayerIndex].parameters['B'].current = bestCauchyB;
  cauchyLayers[primaryLayerIndex].parameters['C'].current = 0.0001;

  const cauchyLongVars: OptimizationVariable[] = [
    { id: 'thickness', name: 'Thickness', value: bestCauchyT, min: tMin, max: tMax },
    { id: 'A', name: 'Cauchy A', value: bestCauchyA, min: 1.05, max: 3.5 },
    { id: 'B', name: 'Cauchy B', value: bestCauchyB, min: 0.0, max: 0.15 },
    { id: 'C', name: 'Cauchy C', value: 0.0001, min: -0.005, max: 0.05 },
  ];

  const cauchyLongOpt = await optimizeBoundedLM(
    cauchyLongVars,
    (params: number[]) => {
      cauchyLayers[primaryLayerIndex].thickness = params[0];
      cauchyLayers[primaryLayerIndex].parameters['A'].current = params[1];
      cauchyLayers[primaryLayerIndex].parameters['B'].current = params[2];
      cauchyLayers[primaryLayerIndex].parameters['C'].current = params[3];
      const residuals: number[] = [];
      for (const pt of cauchyScanPts) {
        const calc = calculatePoint(ambient, cauchyLayers, substrate, pt.wavelength, pt.aoi);
        residuals.push(calc.psiDeg - pt.psiExp);
        residuals.push(circularDifferenceDeg(calc.deltaDeg, pt.deltaExp));
      }
      return residuals;
    },
    { maxIterations: 25, tolerance: 1e-5, residualWeights:residualWeights(cauchyScanPts,config).weights, shouldStop }
  );
  totalOptimizerIterations += cauchyLongOpt.iterations;

  // Next refine Cauchy on the full spectrum with normal dispersion (B >= 0)
  const cauchyFullVars: OptimizationVariable[] = [
    { id: 'thickness', name: 'Thickness', value: cauchyLongOpt.finalParams[0], min: tMin, max: tMax },
    { id: 'A', name: 'Cauchy A', value: cauchyLongOpt.finalParams[1], min: 1.05, max: 3.5 },
    { id: 'B', name: 'Cauchy B', value: cauchyLongOpt.finalParams[2], min: 0.0, max: 0.15 },
    { id: 'C', name: 'Cauchy C', value: cauchyLongOpt.finalParams[3], min: -0.005, max: 0.05 },
  ];

  const cauchyFullOpt = await optimizeBoundedLM(
    cauchyFullVars,
    (params: number[]) => {
      cauchyLayers[primaryLayerIndex].thickness = params[0];
      cauchyLayers[primaryLayerIndex].parameters['A'].current = params[1];
      cauchyLayers[primaryLayerIndex].parameters['B'].current = params[2];
      cauchyLayers[primaryLayerIndex].parameters['C'].current = params[3];
      const residuals: number[] = [];
      for (const pt of fittingPoints) {
        const calc = calculatePoint(ambient, cauchyLayers, substrate, pt.wavelength, pt.aoi);
        residuals.push(calc.psiDeg - pt.psiExp);
        residuals.push(circularDifferenceDeg(calc.deltaDeg, pt.deltaExp));
      }
      return residuals;
    },
    {
      maxIterations: 25,
      residualWeights:residualWeights(fittingPoints,config).weights,
      tolerance: 1e-5,
      shouldStop,
      onIteration: (iter, cost, _prev, _params, _raw, _reg, weightedCost) => {
        totalOptimizerIterations++;
        reportProgress({
          stage: 'stage1_cauchy',
          stageName: 'Cauchy 0-point Initialization',
          stepNumber: 2,
          progressPercent: 16 + Math.min(8, iter * 0.35),
          currentMse: Math.sqrt(weightedCost!*2*fittingPoints.length/Math.max(1,2*fittingPoints.length-cauchyFullVars.length)),
          currentThickness: cauchyLayers[primaryLayerIndex].thickness,
          message: `[2/8] Cauchy 優化中: 膜厚 = ${cauchyLayers[primaryLayerIndex].thickness.toFixed(2)} nm, Raw MSE = ${cost.toFixed(4)}`,
        });
      },
    }
  );

  // If full-spectrum Cauchy has large residual (strong UV absorption like TiO2), preserve long-wavelength normal-dispersion baseline
  const useLongWlBaseline = cauchyFullOpt.finalRawMse > 25.0 && cauchyLongOpt.finalWeightedCost < cauchyFullOpt.finalWeightedCost * 0.25;
  const chosenCauchyParams = useLongWlBaseline ? cauchyLongOpt.finalParams : cauchyFullOpt.finalParams;

  const finalCauchyThickness = chosenCauchyParams[0];
  const finalCauchyA = chosenCauchyParams[1];
  const finalCauchyB = chosenCauchyParams[2];
  const finalCauchyC = chosenCauchyParams[3];

  cauchyLayers[primaryLayerIndex].thickness = finalCauchyThickness;
  cauchyLayers[primaryLayerIndex].parameters['A'].current = finalCauchyA;
  cauchyLayers[primaryLayerIndex].parameters['B'].current = finalCauchyB;
  cauchyLayers[primaryLayerIndex].parameters['C'].current = finalCauchyC;

  const cauchyEval = calculateSpectrum(ambient, cauchyLayers, substrate, fittingPoints);
  const cauchyMetrics = computeResidualMetrics(cauchyEval, config.fitWeighting, psiWeight, deltaWeight, cauchyFullVars.length);
  const cauchyFinalMse = cauchyMetrics.rawMse;

  log(
    `[2/8] Cauchy 0-point 完成: 膜厚 = ${finalCauchyThickness.toFixed(2)} nm, A = ${finalCauchyA.toFixed(4)}, B = ${finalCauchyB.toFixed(5)}, C = ${finalCauchyC.toFixed(6)}, Full Raw MSE = ${cauchyFinalMse.toFixed(4)}`
  );

  // =========================================================================
  // STEP 3: Adaptive B-spline n/k with 2nd-Order Smoothness Regularization
  //         & Progressive Knot Refinement (Stage 1: 8 -> 12 -> 16 -> 20 Knots)
  // =========================================================================
  if (shouldStop?.()) throw new Error('使用者中止擬合');

  const cauchyDef = modelRegistry.get('cauchy')!;
  const evalBaselineN = (w: number) =>
    cauchyDef.calculateN(w, { A: finalCauchyA, B: finalCauchyB, C: finalCauchyC });

  // If Cauchy full-spectrum MSE is large (> 2.0), run a fast 1-oscillator Kramers-Kronig pre-fit
  // so B-spline starts from a realistic smooth complex (n(λ), k(λ)) baseline in UV-absorbing films
  let prefitSpectrumMap: ((w: number) => { n: number; k: number }) | null = null;
  let bsplineInitialThickness = finalCauchyThickness;

  if (cauchyFinalMse > 2.0) {
    const tlDef = modelRegistry.get('tauc_lorentz')!;
    const tempLayers: Layer[] = JSON.parse(JSON.stringify(workingLayers));
    tempLayers[primaryLayerIndex].modelId = 'tauc_lorentz';
    tempLayers[primaryLayerIndex].parameters = modelRegistry.createParameterSet('tauc_lorentz');
    tempLayers[primaryLayerIndex].thickness = finalCauchyThickness;

    const estEpsInf = Math.max(1.2, Math.min(8.0, finalCauchyA * finalCauchyA - 1.5));
    const preVars: OptimizationVariable[] = [
      {
        id: 'thickness',
        name: 'd',
        value: finalCauchyThickness,
        min: Math.max(tMin, finalCauchyThickness * 0.9),
        max: Math.min(tMax, finalCauchyThickness * 1.1),
      },
      { id: 'eps_inf', name: 'eps_inf', value: estEpsInf, min: 1.0, max: 12.0 },
      { id: 'A', name: 'A', value: 115.0, min: 5.0, max: 500.0 },
      { id: 'E0', name: 'E0', value: 3.68, min: 1.5, max: 8.5 },
      { id: 'C', name: 'C', value: 1.5, min: 0.2, max: 4.5 },
      { id: 'Eg', name: 'Eg', value: 3.05, min: 0.5, max: 6.2 },
    ];

    const preOpt = await optimizeBoundedLM(
      preVars,
      (p: number[]) => {
        tempLayers[primaryLayerIndex].thickness = p[0];
        tempLayers[primaryLayerIndex].parameters['eps_inf'].current = p[1];
        tempLayers[primaryLayerIndex].parameters['A'].current = p[2];
        tempLayers[primaryLayerIndex].parameters['E0'].current = Math.max(p[5] + 0.15, p[3]);
        tempLayers[primaryLayerIndex].parameters['C'].current = p[4];
        tempLayers[primaryLayerIndex].parameters['Eg'].current = p[5];
        const r: number[] = [];
        for (const pt of fastScanPoints) {
          const c = calculatePoint(ambient, tempLayers, substrate, pt.wavelength, pt.aoi);
          r.push(c.psiDeg - pt.psiExp);
          r.push(circularDifferenceDeg(c.deltaDeg, pt.deltaExp));
        }
        return r;
      },
      { maxIterations: 22, tolerance: 1e-5, residualWeights:residualWeights(fastScanPoints,config).weights, shouldStop }
    );
    totalOptimizerIterations += preOpt.iterations;

    if (preOpt.finalWeightedCost < cauchyMetrics.weightedMse * 0.7) {
      bsplineInitialThickness = preOpt.finalParams[0];
      const preRec = {
        eps_inf: preOpt.finalParams[1],
        A: preOpt.finalParams[2],
        E0: Math.max(preOpt.finalParams[5] + 0.15, preOpt.finalParams[3]),
        C: preOpt.finalParams[4],
        Eg: preOpt.finalParams[5],
      };
      prefitSpectrumMap = (w: number) => {
        const opt = tlDef.calculate(w, preRec);
        return { n: Math.max(1.0, opt.n), k: Math.max(0.0, opt.k) };
      };
    }
  }

  // Progressive Knot Refinement Schedule: Stage 1 (8) -> Stage 2 (12) -> Stage 3 (16) -> Stage 4 (20)
  const maxAllowedKnots = Math.max(8, Math.min(20, config.maxBsplineKnots ?? config.knotCount ?? (isAggressiveMode ? 20 : 12)));
  const allKnotStages = [8, 12, 16, 20].filter((k) => k <= maxAllowedKnots);
  if (allKnotStages.length === 0) allKnotStages.push(8);

  // Regularization weights:
  //   regularizedObjective = rawMse + lambdaN * smoothN + lambdaK * smoothK
  const isTransparentBaseline = cauchyFinalMse < 1.0 && !prefitSpectrumMap;
  const lambdaN = isTransparentBaseline ? 0.35 : 0.25;
  const lambdaK = isTransparentBaseline ? 8.0 : 0.6;
  const knotImprovementTolerance = 0.005;

  let activeKnots: number[] = generateAdaptiveKnots(fitWlMin, fitWlMax, 8);
  let activeNCoeffs: number[] = activeKnots.map((wl) =>
    prefitSpectrumMap ? prefitSpectrumMap(wl).n : evalBaselineN(wl)
  );
  let activeKCoeffs: number[] = activeKnots.map((wl) =>
    prefitSpectrumMap ? prefitSpectrumMap(wl).k : 0.0002
  );
  let activeBsplineThickness = bsplineInitialThickness;
  let activeBsplineRawMse = cauchyFinalMse;
  let activeBsplineMseWoollam=cauchyMetrics.mseWoollam;
  let activeBsplineRegPenalty = 0;
  let activeWeightedRegPenalty=0;
  let activeBsplineSmoothN = 0;
  let activeBsplineSmoothK = 0;
  let activeBsplineTotalObj = cauchyMetrics.weightedMse;

  const knotRefinementHistory: KnotStageRecord[] = [];
  const bsplineLayers: Layer[] = JSON.parse(JSON.stringify(workingLayers));
  bsplineLayers[primaryLayerIndex].modelId = 'bspline';
  bsplineLayers[primaryLayerIndex].thicknessFit = true;

  for (let stageIdx = 0; stageIdx < allKnotStages.length; stageIdx++) {
    if (shouldStop?.()) throw new Error('使用者中止擬合');

    const stageKnotCount = allKnotStages[stageIdx];
    const stageKnots = generateAdaptiveKnots(fitWlMin, fitWlMax, stageKnotCount);

    // Interpolate initial N and K coefficients from previous stage spline (or baseline for Stage 1)
    let initNCoeffs: number[];
    let initKCoeffs: number[];
    if (stageIdx === 0) {
      initNCoeffs = stageKnots.map((wl) => Number((prefitSpectrumMap ? prefitSpectrumMap(wl).n : evalBaselineN(wl)).toFixed(4)));
      initKCoeffs = stageKnots.map((wl) => Number((prefitSpectrumMap ? prefitSpectrumMap(wl).k : 0.0002).toFixed(4)));
    } else {
      initNCoeffs = stageKnots.map((wl) =>
        Number(Math.max(1.0, evaluateAdaptiveSpline(wl, activeKnots, activeNCoeffs)).toFixed(4))
      );
      initKCoeffs = stageKnots.map((wl) =>
        Number(Math.max(0.0, evaluateAdaptiveSpline(wl, activeKnots, activeKCoeffs)).toFixed(4))
      );
    }

    setActiveKnots(stageKnots);

    reportProgress({
      stage: 'stage2_bspline',
      stageName: `Adaptive B-spline Stage ${stageIdx + 1} (${stageKnotCount} knots)`,
      stepNumber: 3,
      progressPercent: 26 + stageIdx * 5,
      bsplineKnots: stageKnotCount,
      currentMse: activeBsplineMseWoollam,
      currentThickness: activeBsplineThickness,
      message: `[3/8] B-spline 階梯加密 Stage ${stageIdx + 1} (${stageKnotCount} knots)：二階平滑正則化聯立擬合...`,
    });

    // Build clean parameter dictionary containing ONLY active knots 0 .. stageKnotCount-1
    const stageParamDict: Record<string, ParameterValue> = {
      _knotCount: {
        id: '_knotCount',
        name: 'Active Knot Count',
        unit: '',
        current: stageKnotCount,
        initial: stageKnotCount,
        min: 4,
        max: 20,
        fit: false,
      },
    };

    const stageVars: OptimizationVariable[] = [
      { id: 'thickness', name: 'Thickness', value: activeBsplineThickness, min: tMin, max: tMax },
    ];

    for (let i = 0; i < stageKnotCount; i++) {
      const nInit = initNCoeffs[i];
      const nMin = Math.max(1.0, nInit - 0.8);
      const nMax = Math.min(5.5, nInit + 0.8);
      stageParamDict[`N${i}`] = {
        id: `N${i}`,
        name: `Refractive Index Node ${i + 1}`,
        symbol: `N_${i}`,
        unit: '',
        current: nInit,
        initial: nInit,
        min: nMin,
        max: nMax,
        fit: true,
      };
      stageVars.push({
        id: `N${i}`,
        name: `N${i}`,
        value: nInit,
        min: nMin,
        max: nMax,
      });
    }

    for (let i = 0; i < stageKnotCount; i++) {
      const kInit = initKCoeffs[i];
      const kMax = isTransparentBaseline ? 0.06 : Math.min(3.5, Math.max(0.4, kInit + 1.2));
      stageParamDict[`K${i}`] = {
        id: `K${i}`,
        name: `Extinction Node ${i + 1}`,
        symbol: `K_${i}`,
        unit: '',
        current: kInit,
        initial: kInit,
        min: 0.0,
        max: kMax,
        fit: true,
      };
      stageVars.push({
        id: `K${i}`,
        name: `K${i}`,
        value: kInit,
        min: 0.0,
        max: kMax,
      });
    }

    bsplineLayers[primaryLayerIndex].parameters = stageParamDict;
    bsplineLayers[primaryLayerIndex].thickness = activeBsplineThickness;

    const mExpObs = Math.max(1, fittingPoints.length * 2);
    const scaleN = Math.sqrt(mExpObs * lambdaN);
    const scaleK = Math.sqrt(mExpObs * lambdaK);

    const bsplineExpResidualFn = (params: number[]) => {
      bsplineLayers[primaryLayerIndex].thickness = params[0];
      bsplineLayers[primaryLayerIndex].parameters['_knotCount'].current = stageKnotCount;
      for (let i = 0; i < stageKnotCount; i++) {
        bsplineLayers[primaryLayerIndex].parameters[`N${i}`].current = params[1 + i];
        bsplineLayers[primaryLayerIndex].parameters[`K${i}`].current = params[1 + stageKnotCount + i];
      }
      const residuals: number[] = [];
      for (const pt of fittingPoints) {
        const calc = calculatePoint(ambient, bsplineLayers, substrate, pt.wavelength, pt.aoi);
        residuals.push(calc.psiDeg - pt.psiExp);
        residuals.push(circularDifferenceDeg(calc.deltaDeg, pt.deltaExp));
      }
      return residuals;
    };

    const bsplineRegResidualFn = (params: number[]) => {
      const nArr = params.slice(1, 1 + stageKnotCount);
      const kArr = params.slice(1 + stageKnotCount, 1 + 2 * stageKnotCount);
      const regResiduals: number[] = [];
      // Second-order smoothness: n(i+1) - 2*n(i) + n(i-1)
      for (let i = 1; i < stageKnotCount - 1; i++) {
        regResiduals.push(scaleN * (nArr[i + 1] - 2 * nArr[i] + nArr[i - 1]));
      }
      // Second-order smoothness: k(i+1) - 2*k(i) + k(i-1)
      for (let i = 1; i < stageKnotCount - 1; i++) {
        regResiduals.push(scaleK * (kArr[i + 1] - 2 * kArr[i] + kArr[i - 1]));
      }
      return regResiduals;
    };

    const stageOpt = await optimizeBoundedLM(stageVars, bsplineExpResidualFn, {
      residualWeights:residualWeights(fittingPoints,config).weights,
      maxIterations: 22,
      tolerance: 1e-5,
      regularizationResidualsFn: bsplineRegResidualFn,
      shouldStop,
      onIteration: (iter, rawMseVal, _prev, _params, _raw, regPenVal, weightedCost) => {
        totalOptimizerIterations++;
        reportProgress({
          stage: 'stage2_bspline',
          stageName: `Adaptive B-spline (${stageKnotCount} knots)`,
          stepNumber: 3,
          progressPercent: 26 + stageIdx * 5 + Math.min(4, iter * 0.2),
          bsplineKnots: stageKnotCount,
          currentMse: Math.sqrt(weightedCost!*2*fittingPoints.length/Math.max(1,2*fittingPoints.length-stageVars.length)),
          currentThickness: bsplineLayers[primaryLayerIndex].thickness,
          message: `[3/8] B-spline (${stageKnotCount} knots) #${iter}: d=${bsplineLayers[primaryLayerIndex].thickness.toFixed(2)} nm, Raw MSE=${rawMseVal.toFixed(4)}, Reg=${(regPenVal ?? 0).toFixed(4)}`,
        });
      },
    });

    const stageT = stageOpt.finalParams[0];
    const stageN = stageOpt.finalParams.slice(1, 1 + stageKnotCount);
    const stageK = stageOpt.finalParams.slice(1 + stageKnotCount, 1 + 2 * stageKnotCount);

    bsplineLayers[primaryLayerIndex].thickness = stageT;
    for (let i = 0; i < stageKnotCount; i++) {
      bsplineLayers[primaryLayerIndex].parameters[`N${i}`].current = stageN[i];
      bsplineLayers[primaryLayerIndex].parameters[`K${i}`].current = stageK[i];
    }

    const stageEval = calculateSpectrum(ambient, bsplineLayers, substrate, fittingPoints);
    const stageMetrics = computeResidualMetrics(stageEval, config.fitWeighting, psiWeight, deltaWeight, stageVars.length);
    const stageRawMse = stageMetrics.rawMse;
    const smoothInfo = computeBsplineSmoothness(stageN, stageK, lambdaN, lambdaK);
    const stageRegPenalty = stageOpt.finalRegularizationPenalty;
    const stageTotalObj = stageMetrics.weightedMse + stageRegPenalty;

    knotRefinementHistory.push({
      knots: stageKnotCount,
      rawMse: Number(stageRawMse.toFixed(5)),
      // Preserve the legacy Raw diagnostic contract; weighted fields are the optimized objective.
      regularizationPenalty: Number(smoothInfo.regularizationPenalty.toFixed(5)),
      totalObjective: Number((stageRawMse+smoothInfo.regularizationPenalty).toFixed(5)),
      weightedRegularizationPenalty:stageRegPenalty,weightedTotalObjective:stageTotalObj,
      thicknessNm: Number(stageT.toFixed(2)),
    });

    log(
      `[3/8] B-spline Stage ${stageIdx + 1} (${stageKnotCount} knots): d = ${stageT.toFixed(2)} nm, Raw MSE = ${stageRawMse.toFixed(4)}, Reg Penalty = ${stageRegPenalty.toFixed(4)}, Total Obj = ${stageTotalObj.toFixed(4)}`
    );

    const prevRawMse = activeBsplineRawMse;
    if (stageIdx === 0 || stageTotalObj < activeBsplineTotalObj) {
      activeKnots = stageKnots;
      activeNCoeffs = stageN;
      activeKCoeffs = stageK;
      activeBsplineThickness = stageT;
      activeBsplineRawMse = stageRawMse;
      activeBsplineMseWoollam=stageMetrics.mseWoollam;
      activeBsplineRegPenalty = smoothInfo.regularizationPenalty;
      activeWeightedRegPenalty=stageRegPenalty;
      activeBsplineSmoothN = smoothInfo.smoothN;
      activeBsplineSmoothK = smoothInfo.smoothK;
      activeBsplineTotalObj = stageTotalObj;
    } else {
      // Revert active knots if adding more knots did not reduce the weighted regularized objective
      setActiveKnots(activeKnots);
      log(`[3/8] B-spline 節點加密停止：${stageKnotCount} knots 未進一步降低加權目標，保留 ${activeKnots.length} knots 最佳平滑解。`);
      break;
    }

    // Stopping condition: if Raw MSE is already very low (< 0.025) or improvement < tolerance, stop adding knots
    const improvement = prevRawMse - stageRawMse;
    if (stageRawMse < 0.025 || (stageIdx > 0 && improvement < knotImprovementTolerance)) {
      log(
        `[3/8] B-spline 節點收斂完成 (${stageKnotCount} knots)：Raw MSE = ${stageRawMse.toFixed(4)} (改善量 ΔMSE = ${improvement.toFixed(5)} <= 門檻)，停止增加節點。`
      );
      break;
    }
  }

  // Restore best B-spline state cleanly
  setActiveKnots(activeKnots);
  const finalBsplineParamDict: Record<string, ParameterValue> = {};
  const finalBsplineCoeffRecord: Record<string, number> = {};
  for (let i = 0; i < activeKnots.length; i++) {
    finalBsplineCoeffRecord[`N${i}`] = Number(activeNCoeffs[i].toFixed(5));
    finalBsplineParamDict[`N${i}`] = {
      id: `N${i}`,
      name: `Refractive Index Node ${i + 1}`,
      symbol: `N_${i}`,
      unit: '',
      current: activeNCoeffs[i],
      initial: activeNCoeffs[i],
      min: 1.0,
      max: 5.5,
      fit: true,
    };
  }
  for (let i = 0; i < activeKnots.length; i++) {
    finalBsplineCoeffRecord[`K${i}`] = Number(activeKCoeffs[i].toFixed(5));
    finalBsplineParamDict[`K${i}`] = {
      id: `K${i}`,
      name: `Extinction Node ${i + 1}`,
      symbol: `K_${i}`,
      unit: '',
      current: activeKCoeffs[i],
      initial: activeKCoeffs[i],
      min: 0.0,
      max: 3.5,
      fit: true,
    };
  }

  bsplineLayers[primaryLayerIndex].parameters = finalBsplineParamDict;
  bsplineLayers[primaryLayerIndex].thickness = activeBsplineThickness;
  const finalBsplineThickness = activeBsplineThickness;

  // =========================================================================
  // STEP 4: B-spline Diagnostic
  // =========================================================================
  reportProgress({
    stage: 'stage_bspline_diagnostic',
    stageName: 'B-spline Diagnostic',
    stepNumber: 4,
    progressPercent: 46,
    bsplineKnots: activeKnots.length,
    currentMse: activeBsplineMseWoollam,
    currentThickness: finalBsplineThickness,
    message: '[4/8] B-spline 診斷：分離檢核 Raw MSE、平滑正則化懲罰項與總目標函數...',
  });

  const bsplineEval = calculateSpectrum(ambient, bsplineLayers, substrate, fittingPoints);
  const bsplineMetrics = computeResidualMetrics(bsplineEval, config.fitWeighting, psiWeight, deltaWeight, 1+2*activeKnots.length);
  const bsplineFinalMse = bsplineMetrics.rawMse;
  const bsplineFinalRmse = bsplineMetrics.rawRmse;
  const { psiRmse: bsplinePsiRmse, deltaRmse: bsplineDeltaRmse } = computePsiDeltaRmse(bsplineEval);

  log(
    `[B-spline Diagnostic] Knots: ${activeKnots.length}, Thickness: ${finalBsplineThickness.toFixed(2)} nm, Raw MSE: ${bsplineFinalMse.toFixed(4)}, Reg Penalty: ${activeBsplineRegPenalty.toFixed(4)}, Total Objective: ${(bsplineFinalMse + activeBsplineRegPenalty).toFixed(4)}, Psi RMSE: ${bsplinePsiRmse.toFixed(3)}°, Delta RMSE: ${bsplineDeltaRmse.toFixed(3)}°`
  );
  if (bsplineFinalMse > 200.0) {
    log(`⚠️ [B-spline 診斷警告] B-spline 本身無法擬合 (Raw MSE > 200)。問題在於實驗數據品質、AOI 偏差、基板模型或薄膜厚度盆地，而非振盪子模型選擇。`);
  }

  // Extract continuous B-spline spectrum spanning full experimental range
  const bsplineDef = modelRegistry.get('bspline')!;
  const bsplineContinuousSpectrum: { wavelength: number; n: number; k: number }[] = [];
  const stepWl = Math.max(1, Math.round((fitWlMax - fitWlMin) / 80));
  for (let w = fitWlMin; w <= fitWlMax; w += stepWl) {
    const opt = bsplineDef.calculate(w, { ...finalBsplineCoeffRecord, _knotCount: activeKnots.length });
    bsplineContinuousSpectrum.push({
      wavelength: Number(w.toFixed(1)),
      n: opt.n,
      k: opt.k,
    });
  }

  // =========================================================================
  // STEP 5, 6, 7: Physical Model Initialization, Effective Global Thickness Search
  //               & >= 20 Independent Multi-Start Joint Optimization
  // =========================================================================
  const candidateModelIds: string[] = isAutoSelection
    ? ['gaussian', 'lorentz', 'tauc_lorentz', 'drude']
    : [selectedPhysicalModelId];

  const minIndependentStarts = config.enableMultiStart === false ? 1 : isAutoSelection ? 20 : isAggressiveMode ? 24 : 20;

  log(
    `[5/8] 物理模型初始化與全域反演: 【${candidateModelIds.join(', ')}】(每個模型執行 ${minIndependentStarts} 組獨立 Multi-Start 聯立尋優)`
  );

  interface CandidateEvaluation {
    modelId: string;
    modelName: string;
    layers: Layer[];
    thickness: number;
    rawMse: number;
    rawRmse: number;
    mseWoollam:number;
    converged:boolean;
    convergenceStatus:ConvergenceStatus;
    psiRmse: number;
    deltaRmse: number;
    weightedMse: number;
    points: EllipsometryDataPoint[];
    parametersRecord: FittedParameterResult[];
    iterations: number;
    multiStartRuns: MultiStartRunRecord[];
    bestStartIndex: number;
  }

  const evaluatedCandidates: CandidateEvaluation[] = [];

  for (const cModelId of candidateModelIds) {
    if (shouldStop?.()) throw new Error('使用者中止擬合');

    const cModelDef = modelRegistry.get(cModelId);
    if (!cModelDef) continue;

    reportProgress({
      stage: 'stage3_physicalizing',
      stageName: `Physical Model: ${cModelDef.name}`,
      stepNumber: 5,
      progressPercent: 54,
      currentModelName: cModelDef.name,
      message: `[5/8] 自 B-spline 光譜萃取物理特徵並建立【${cModelDef.name}】初始參數...`,
    });

    const basePhysicalParams = modelRegistry.initializePhysicalModelFromBSpline(
      cModelId,
      bsplineContinuousSpectrum
    );

    const requestedComplexity = config.oscillatorComplexity ?? 'auto';
    const initialOscCount = requestedComplexity === 'auto' ? 1 : requestedComplexity;

    const testLayers: Layer[] = JSON.parse(JSON.stringify(workingLayers));
    testLayers[primaryLayerIndex].modelId = cModelId;
    testLayers[primaryLayerIndex].parameters = JSON.parse(JSON.stringify(basePhysicalParams));
    testLayers[primaryLayerIndex].thickness = finalBsplineThickness;
    testLayers[primaryLayerIndex].thicknessFit = true;

    // =======================================================================
    // STEP 6: Effective Global Thickness Search (Multi-Basin Discovery + Local Index-Thickness Relaxation)
    // =======================================================================
    reportProgress({
      stage: 'stage_thickness_search',
      stageName: `Global Thickness Search: ${cModelDef.name}`,
      stepNumber: 6,
      progressPercent: 60,
      currentModelName: cModelDef.name,
      message: `[6/8] Effective Global Thickness Search：結合 B-spline 與物理色散進行多盆地掃描與局部折射率弛豫...`,
    });

    const rawGridSet = new Set<number>();
    rawGridSet.add(Number(finalBsplineThickness.toFixed(2)));
    rawGridSet.add(Number(finalCauchyThickness.toFixed(2)));
    rawGridSet.add(Number(primaryLayer.thickness.toFixed(2)));

    // Interference phase-period harmonics: D_pi = lambda_avg / (2 * sqrt(n^2 - sin^2(theta)))
    const avgN =
      bsplineContinuousSpectrum.reduce((s, p) => s + p.n, 0) / Math.max(1, bsplineContinuousSpectrum.length);
    const avgAoiRad = ((activeAois[0] ?? 70) * Math.PI) / 180;
    const effCos = Math.sqrt(Math.max(0.2, avgN * avgN - Math.pow(Math.sin(avgAoiRad), 2)));
    const halfWavePeriodNm = 500.0 / (2 * effCos);

    for (const refD of [finalBsplineThickness, finalCauchyThickness]) {
      for (const mult of [-2, -1, -0.5, -0.15, -0.06, 0.06, 0.15, 0.5, 1, 2]) {
        const cand = refD + mult * halfWavePeriodNm;
        if (cand >= tMin && cand <= tMax) {
          rawGridSet.add(Number(cand.toFixed(2)));
        }
      }
    }

    // Logarithmic + dense linear grid across [tMin, tMax]
    const logSeeds = [1, 2, 5, 10, 18, 25, 35, 50, 70, 85, 100, 125, 150, 200, 300, 450, 650, 1000, 1800, 3000];
    for (const s of logSeeds) {
      if (s >= tMin && s <= tMax) rawGridSet.add(s);
    }

    const linearSearchMax = Math.min(tMax, Math.max(600.0, finalCauchyThickness * 3.0));
    const linearSteps = 60;
    for (let s = 0; s <= linearSteps; s++) {
      const val = tMin + (s / linearSteps) * (linearSearchMax - tMin);
      rawGridSet.add(Number(val.toFixed(2)));
    }

    const sortedGrid = Array.from(rawGridSet).sort((a, b) => a - b);

    // Evaluate thickness landscape using BOTH B-spline dispersion AND Physical Model dispersion
    const landscape: { thickness: number; mse: number }[] = [];
    for (const tVal of sortedGrid) {
      testLayers[primaryLayerIndex].thickness = tVal;
      const physPts = calculateSpectrum(ambient, testLayers, substrate, fastScanPoints);
      const physMse = computeResidualMetrics(physPts, config.fitWeighting, psiWeight, deltaWeight, 1).weightedMse;

      bsplineLayers[primaryLayerIndex].thickness = tVal;
      const bspPts = calculateSpectrum(ambient, bsplineLayers, substrate, fastScanPoints);
      const bspMse = computeResidualMetrics(bspPts, config.fitWeighting, psiWeight, deltaWeight, 1).weightedMse;

      landscape.push({ thickness: tVal, mse: Math.min(physMse, bspMse) });
    }
    bsplineLayers[primaryLayerIndex].thickness = finalBsplineThickness;

    // Extract distinct local minima basins + global best candidates
    const localMinima: { thickness: number; mse: number }[] = [];
    for (let i = 0; i < landscape.length; i++) {
      const prevMse = i > 0 ? landscape[i - 1].mse : Infinity;
      const nextMse = i < landscape.length - 1 ? landscape[i + 1].mse : Infinity;
      if (landscape[i].mse <= prevMse && landscape[i].mse <= nextMse) {
        localMinima.push(landscape[i]);
      }
    }
    localMinima.sort((a, b) => a.mse - b.mse);

    // Ensure distinct thickness basins (separated by at least max(2.0 nm, 3% of thickness))
    const distinctBasins: number[] = [finalBsplineThickness, finalCauchyThickness];
    for (const item of [...localMinima, ...[...landscape].sort((a, b) => a.mse - b.mse)]) {
      if (distinctBasins.length >= 10) break;
      const minSep = Math.max(1.5, item.thickness * 0.025);
      const tooClose = distinctBasins.some((existing) => Math.abs(existing - item.thickness) < minSep);
      if (!tooClose) {
        distinctBasins.push(item.thickness);
      }
    }

    // Perform fast local joint relaxation (thickness + eps_inf + amplitude) on each candidate basin
    const relaxedBasins: { thickness: number; mse: number }[] = [];
    for (const basinT of distinctBasins.slice(0, 8)) {
      const relaxLayers: Layer[] = JSON.parse(JSON.stringify(testLayers));
      relaxLayers[primaryLayerIndex].thickness = basinT;
      const relaxVars: OptimizationVariable[] = [
        { id: 'thickness', name: 'd', value: basinT, min: tMin, max: tMax },
      ];
      if (relaxLayers[primaryLayerIndex].parameters['eps_inf']) {
        const p = relaxLayers[primaryLayerIndex].parameters['eps_inf'];
        relaxVars.push({ id: 'eps_inf', name: 'eps_inf', value: p.current, min: p.min, max: p.max });
      }
      if (relaxLayers[primaryLayerIndex].parameters['A']) {
        const p = relaxLayers[primaryLayerIndex].parameters['A'];
        relaxVars.push({ id: 'A', name: 'A', value: p.current, min: p.min, max: p.max });
      }

      const relaxOpt = await optimizeBoundedLM(
        relaxVars,
        (pVec: number[]) => {
          relaxLayers[primaryLayerIndex].thickness = pVec[0];
          if (pVec[1] !== undefined && relaxLayers[primaryLayerIndex].parameters['eps_inf']) {
            relaxLayers[primaryLayerIndex].parameters['eps_inf'].current = pVec[1];
          }
          if (pVec[2] !== undefined && relaxLayers[primaryLayerIndex].parameters['A']) {
            relaxLayers[primaryLayerIndex].parameters['A'].current = pVec[2];
          }
          const r: number[] = [];
          for (const pt of fastScanPoints) {
            const c = calculatePoint(ambient, relaxLayers, substrate, pt.wavelength, pt.aoi);
            r.push(c.psiDeg - pt.psiExp);
            r.push(circularDifferenceDeg(c.deltaDeg, pt.deltaExp));
          }
          return r;
        },
        { maxIterations: 5, tolerance: 1e-4, residualWeights:residualWeights(fastScanPoints,config).weights, shouldStop }
      );
      totalOptimizerIterations += relaxOpt.iterations;
      relaxedBasins.push({ thickness: relaxOpt.finalParams[0], mse: relaxOpt.finalWeightedCost });
    }

    relaxedBasins.sort((a, b) => a.mse - b.mse);
    const topThicknessBasins = relaxedBasins.map((b) => b.thickness);
    if (topThicknessBasins.length === 0) {
      topThicknessBasins.push(finalBsplineThickness);
    }

    log(
      `[Global Thickness Search - ${cModelDef.name}] 弛豫後最佳膜厚盆地: ${topThicknessBasins
        .slice(0, 6)
        .map((t) => `${t.toFixed(2)} nm`)
        .join(', ')}`
    );

    // =======================================================================
    // STEP 7: True Multi-Start Joint Optimization (>= 20 Independent Starts)
    // =======================================================================
    reportProgress({
      stage: 'stage_multistart',
      stageName: `Multi-Start Joint Optimization: ${cModelDef.name}`,
      stepNumber: 7,
      progressPercent: 68,
      currentModelName: cModelDef.name,
      totalMultiStartRuns: minIndependentStarts,
      message: `[7/8] 執行 ${minIndependentStarts} 組獨立起點 Multi-Start 聯立優化 (同時擾動膜厚與所有物理振盪子參數)...`,
    });

    const multiStartRuns: MultiStartRunRecord[] = [];
    const thicknessPerturbFactors = [
      1.0, 0.985, 1.015, 0.96, 1.04, 0.92, 1.08, 0.85, 1.15, 0.78, 1.22,
    ];

    interface StartCandidateState {
      startIndex: number;
      initialThickness: number;
      initialParamsRecord: Record<string, number>;
      layers: Layer[];
      rawMse: number;
      weightedMse: number;
      converged:boolean;
    convergenceStatus:ConvergenceStatus;
      iterations: number;
    }

    const startStates: StartCandidateState[] = [];

    for (let startIdx = 0; startIdx < minIndependentStarts; startIdx++) {
      if (shouldStop?.()) throw new Error('使用者中止擬合');

      // 1. Select base thickness from Global Thickness Search basins + bounded perturbation
      let startT: number;
      if (startIdx === 0) {
        startT = topThicknessBasins[0];
      } else if (startIdx === 1) {
        startT = finalBsplineThickness;
      } else if (startIdx === 2) {
        startT = finalCauchyThickness;
      } else {
        const basinT = topThicknessBasins[startIdx % topThicknessBasins.length];
        const factor = thicknessPerturbFactors[startIdx % thicknessPerturbFactors.length];
        startT = Math.max(tMin, Math.min(tMax, basinT * factor));
      }

      // 2. Construct independently initialized & perturbed physical model parameters for this start
      const oscCountForStart =
        requestedComplexity !== 'auto'
          ? requestedComplexity
          : startIdx >= Math.floor(minIndependentStarts * 0.75)
          ? 2
          : initialOscCount;

      const startParams = buildPerturbedPhysicalStartParams(
        cModelId,
        basePhysicalParams,
        bsplineContinuousSpectrum,
        startIdx,
        oscCountForStart
      );

      const startLayers: Layer[] = JSON.parse(JSON.stringify(testLayers));
      startLayers[primaryLayerIndex].thickness = startT;
      startLayers[primaryLayerIndex].parameters = startParams;

      const initialParamsRecord: Record<string, number> = {};
      const activeVars: OptimizationVariable[] = [
        { id: 'thickness', name: 'Thickness', value: startT, min: tMin, max: tMax },
      ];

      for (const [pKey, pVal] of Object.entries(startLayers[primaryLayerIndex].parameters)) {
        initialParamsRecord[pKey] = pVal.current;
        if (pVal.fit) {
          activeVars.push({
            id: pKey,
            name: pVal.name || pKey,
            value: pVal.current,
            min: pVal.min,
            max: pVal.max,
          });
        }
      }

      // Use subsampled points for rapid basin convergence across all 20+ starts, then full points on top basins
      const useFullPtsImmediately = startIdx < 3;
      const ptsForStart = useFullPtsImmediately ? fittingPoints : fastScanPoints;

      const residualFn = (params: number[]) => {
        startLayers[primaryLayerIndex].thickness = params[0];
        let vIdx = 1;
        for (const [pKey, pVal] of Object.entries(startLayers[primaryLayerIndex].parameters)) {
          if (pVal.fit) {
            startLayers[primaryLayerIndex].parameters[pKey].current = params[vIdx++];
          }
        }
        // Physical constraint: for Tauc-Lorentz, enforce E0 > Eg + 0.1
        if (cModelId === 'tauc_lorentz' && startLayers[primaryLayerIndex].parameters['Eg'] && startLayers[primaryLayerIndex].parameters['E0']) {
          const egVal = startLayers[primaryLayerIndex].parameters['Eg'].current;
          if (startLayers[primaryLayerIndex].parameters['E0'].current <= egVal + 0.08) {
            startLayers[primaryLayerIndex].parameters['E0'].current = egVal + 0.1;
          }
        }
        const residuals: number[] = [];
        for (const pt of ptsForStart) {
          const calc = calculatePoint(ambient, startLayers, substrate, pt.wavelength, pt.aoi);
          residuals.push(calc.psiDeg - pt.psiExp);
          residuals.push(circularDifferenceDeg(calc.deltaDeg, pt.deltaExp));
        }
        return residuals;
      };

      const optRes = await optimizeBoundedLM(activeVars, residualFn, {
        residualWeights:residualWeights(ptsForStart,config).weights,
        maxIterations: useFullPtsImmediately ? 25 : 14,
        tolerance: 1e-5,
        shouldStop,
        onIteration: (iter, cost, _prev, _params, _raw, _reg, weightedCost) => {
          totalOptimizerIterations++;
          if (iter % 4 === 0) {
            reportProgress({
              stage: 'stage_multistart',
              stageName: `Multi-Start Optimization: ${cModelDef.name}`,
              stepNumber: 7,
              progressPercent: 68 + Math.min(20, Math.round(((startIdx + 1) / minIndependentStarts) * 20)),
              currentMse: Math.sqrt(weightedCost!*2*ptsForStart.length/Math.max(1,2*ptsForStart.length-activeVars.length)),
              currentThickness: startLayers[primaryLayerIndex].thickness,
              currentModelName: cModelDef.name,
              multiStartRun: startIdx + 1,
              totalMultiStartRuns: minIndependentStarts,
              message: `[7/8] [${cModelDef.name}] Start #${startIdx + 1}/${minIndependentStarts}: d = ${startLayers[primaryLayerIndex].thickness.toFixed(2)} nm, Raw MSE = ${cost.toFixed(4)}`,
            });
          }
        },
      });

      startLayers[primaryLayerIndex].thickness = optRes.finalParams[0];
      let vIdx = 1;
      for (const [pKey, pVal] of Object.entries(startLayers[primaryLayerIndex].parameters)) {
        if (pVal.fit) {
          startLayers[primaryLayerIndex].parameters[pKey].current = optRes.finalParams[vIdx++];
        }
      }

      // Evaluate exact full-spectrum Raw MSE for this start
      const fullEvalPts = calculateSpectrum(ambient, startLayers, substrate, fittingPoints);
      const fullMetrics = computeResidualMetrics(fullEvalPts, config.fitWeighting, psiWeight, deltaWeight, activeVars.length);

      const finalParamsRecord: Record<string, number> = {};
      for (const [pKey, pVal] of Object.entries(startLayers[primaryLayerIndex].parameters)) {
        finalParamsRecord[pKey] = Number(pVal.current.toFixed(4));
      }

      multiStartRuns.push({
        startIndex: startIdx + 1,
        initialThickness: Number(startT.toFixed(2)),
        finalThickness: Number(startLayers[primaryLayerIndex].thickness.toFixed(2)),
        rawMse: Number(fullMetrics.rawMse.toFixed(5)),
        initialParams: initialParamsRecord,
        finalParams: finalParamsRecord,
      });

      startStates.push({
        startIndex: startIdx + 1,
        initialThickness: startT,
        initialParamsRecord,
        layers: startLayers,
        rawMse: fullMetrics.rawMse,
        weightedMse:fullMetrics.weightedMse,converged:optRes.converged,convergenceStatus:optRes.status,
        iterations: optRes.iterations,
      });
    }

    // Sort all 20+ starts by true full-spectrum Raw MSE ascending
    startStates.sort((a, b) => a.weightedMse - b.weightedMse);

    // Polish the top 2 winning starts on the complete experimental spectrum with tight tolerance
    let bestStartState = startStates[0];
    for (let polishIdx = 0; polishIdx < Math.min(2, startStates.length); polishIdx++) {
      const candidate = startStates[polishIdx];
      const polishLayers: Layer[] = JSON.parse(JSON.stringify(candidate.layers));
      const polishVars: OptimizationVariable[] = [
        { id: 'thickness', name: 'Thickness', value: polishLayers[primaryLayerIndex].thickness, min: tMin, max: tMax },
      ];
      for (const [pKey, pVal] of Object.entries(polishLayers[primaryLayerIndex].parameters)) {
        if (pVal.fit) {
          polishVars.push({ id: pKey, name: pVal.name || pKey, value: pVal.current, min: pVal.min, max: pVal.max });
        }
      }

      const polishOpt = await optimizeBoundedLM(
        polishVars,
        (params: number[]) => {
          polishLayers[primaryLayerIndex].thickness = params[0];
          let vIdx = 1;
          for (const [pKey, pVal] of Object.entries(polishLayers[primaryLayerIndex].parameters)) {
            if (pVal.fit) {
              polishLayers[primaryLayerIndex].parameters[pKey].current = params[vIdx++];
            }
          }
          const residuals: number[] = [];
          for (const pt of fittingPoints) {
            const calc = calculatePoint(ambient, polishLayers, substrate, pt.wavelength, pt.aoi);
            residuals.push(calc.psiDeg - pt.psiExp);
            residuals.push(circularDifferenceDeg(calc.deltaDeg, pt.deltaExp));
          }
          return residuals;
        },
        { maxIterations: 35, tolerance: 1e-6, residualWeights:residualWeights(fittingPoints,config).weights, shouldStop }
      );
      totalOptimizerIterations += polishOpt.iterations;

      polishLayers[primaryLayerIndex].thickness = polishOpt.finalParams[0];
      let vIdx = 1;
      for (const [pKey, pVal] of Object.entries(polishLayers[primaryLayerIndex].parameters)) {
        if (pVal.fit) {
          polishLayers[primaryLayerIndex].parameters[pKey].current = polishOpt.finalParams[vIdx++];
        }
      }

      const evalPts = calculateSpectrum(ambient, polishLayers, substrate, fittingPoints);
      const metrics = computeResidualMetrics(evalPts, config.fitWeighting, psiWeight, deltaWeight, polishVars.length);
      if (metrics.weightedMse <= bestStartState.weightedMse) {
        bestStartState = {
          ...candidate,
          layers: polishLayers,
          rawMse: metrics.rawMse,
          weightedMse:metrics.weightedMse,converged:polishOpt.converged,convergenceStatus:polishOpt.status,
          iterations: candidate.iterations + polishOpt.iterations,
        };
      }
    }

    // Update the corresponding record in multiStartRuns
    const winRunRecord = multiStartRuns.find((r) => r.startIndex === bestStartState.startIndex);
    if (winRunRecord) {
      winRunRecord.finalThickness = Number(bestStartState.layers[primaryLayerIndex].thickness.toFixed(2));
      winRunRecord.rawMse = Number(bestStartState.rawMse.toFixed(5));
    }

    const bestEvalPts = calculateSpectrum(ambient, bestStartState.layers, substrate, fittingPoints);
    const bestMetrics = computeResidualMetrics(bestEvalPts, config.fitWeighting, psiWeight, deltaWeight, 1+Object.values(bestStartState.layers[primaryLayerIndex].parameters).filter(p=>p.fit).length);
    const { psiRmse: candPsiRmse, deltaRmse: candDeltaRmse } = computePsiDeltaRmse(bestEvalPts);

    log(
      `[${cModelDef.name}] ${minIndependentStarts} 組 Multi-Start 完成！最佳 Start #${bestStartState.startIndex}: 膜厚 = ${bestStartState.layers[primaryLayerIndex].thickness.toFixed(2)} nm, Raw MSE = ${bestMetrics.rawMse.toFixed(4)} (Ψ RMSE = ${candPsiRmse.toFixed(3)}°, Δ RMSE = ${candDeltaRmse.toFixed(3)}°)`
    );

    // Build parameter record
    const candidateParamsRecord: FittedParameterResult[] = [
      {
        layerId: bestStartState.layers[primaryLayerIndex].id,
        layerName: bestStartState.layers[primaryLayerIndex].name,
        paramId: 'thickness',
        paramName: '膜層厚度 (Thickness)',
        initialValue: Number(bestStartState.initialThickness.toFixed(2)),
        finalValue: Number(bestStartState.layers[primaryLayerIndex].thickness.toFixed(2)),
        min: tMin,
        max: tMax,
        unit: 'nm',
        fitted: true,
      },
    ];

    for (const [pKey, pVal] of Object.entries(bestStartState.layers[primaryLayerIndex].parameters)) {
      if (pVal.fit) {
        candidateParamsRecord.push({
          layerId: bestStartState.layers[primaryLayerIndex].id,
          layerName: bestStartState.layers[primaryLayerIndex].name,
          paramId: pKey,
          paramName: pVal.name || pKey,
          initialValue: Number((bestStartState.initialParamsRecord[pKey] ?? pVal.initial).toFixed(4)),
          finalValue: Number(pVal.current.toFixed(4)),
          min: pVal.min,
          max: pVal.max,
          unit: pVal.unit || '',
          fitted: true,
        });
      }
    }

    evaluatedCandidates.push({
      modelId: cModelId,
      modelName: cModelDef.name,
      layers: bestStartState.layers,
      thickness: bestStartState.layers[primaryLayerIndex].thickness,
      rawMse: bestMetrics.rawMse,
      rawRmse: bestMetrics.rawRmse,
      psiRmse: candPsiRmse,
      deltaRmse: candDeltaRmse,
      weightedMse: bestMetrics.weightedMse,
      mseWoollam:bestMetrics.mseWoollam,converged:bestStartState.converged,convergenceStatus:bestStartState.convergenceStatus,
      points: bestEvalPts,
      parametersRecord: candidateParamsRecord,
      iterations: bestStartState.iterations,
      multiStartRuns,
      bestStartIndex: bestStartState.startIndex,
    });
  }

  evaluatedCandidates.sort((a, b) => a.weightedMse - b.weightedMse);
  const winningCandidate = evaluatedCandidates[0];

  const finalLayers: Layer[] = JSON.parse(JSON.stringify(winningCandidate.layers));
  const finalThickness = winningCandidate.thickness;
  const finalModelId = finalLayers[primaryLayerIndex].modelId;
  const finalModelDef = modelRegistry.get(finalModelId)!;

  // =========================================================================
  // STEP 8: Fresh Forward Recalculation & Discrepancy Verification
  // =========================================================================
  reportProgress({
    stage: 'stage5_final_rebuild',
    stageName: 'Fresh Forward Recalculation',
    stepNumber: 8,
    progressPercent: 95,
    currentThickness: finalThickness,
    currentModelName: finalModelDef.name,
    message: `[8/8] 驗證最終光學常數與真實正向回算 (Fresh Forward Calculation)...`,
  });

  const finalAllPoints = calculateSpectrum(
    ambient,
    finalLayers,
    substrate,
    datasetPoints
  );

  const finalFittingPoints = finalAllPoints.filter(
    (p) => activeAois.includes(p.aoi) && p.wavelength >= fitWlMin && p.wavelength <= fitWlMax
  );

  const numActiveParams=winningCandidate.parametersRecord.length;

  const finalMetrics = computeResidualMetrics(
    finalFittingPoints,
    config.fitWeighting,
    psiWeight,
    deltaWeight,
    numActiveParams
  );
  const { psiRmse: finalPsiRmse, deltaRmse: finalDeltaRmse } = computePsiDeltaRmse(finalFittingPoints);

  // Check discrepancy between optimizer state and fresh recalculation
  const discrepancy = Math.abs(finalMetrics.rawMse - winningCandidate.rawMse);
  const freshCalculationVerified = discrepancy < 1e-3;
  if (!freshCalculationVerified) {
    log(`⚠️ 數值警告: 正向回算與優化器終態存在數值差異 (${discrepancy.toExponential(2)})`);
  }

  // Physical Model Mismatch Diagnostic:
  // If B-spline MSE <= TARGET_MSE, but Physical Model MSE > TARGET_MSE:
  const isPhysicalModelMismatch = bsplineFinalMse <= TARGET_MSE && finalMetrics.rawMse > TARGET_MSE;
  if (isPhysicalModelMismatch) {
    log(
      `⚠️ 【Physical Model Mismatch 警示】B-spline 能精準擬合實驗資料 (MSE = ${bsplineFinalMse.toFixed(2)})，但當前物理模型【${finalModelDef.name}】無法以現有振盪子數目充份再現光學常數。建議增加振盪子複雜度 (+1 oscillator)！`
    );
  }

  // Breakdown per AOI
  const perAoiMse: Record<number, number> = {};
  for (const aoi of activeAois) {
    const aoiPts = finalFittingPoints.filter((p) => p.aoi === aoi);
    if (aoiPts.length > 0) {
      perAoiMse[aoi] = computeResidualMetrics(aoiPts, finalMetrics.weightingMode==='sigma'?'standard_deviation':finalMetrics.weightingMode, psiWeight, deltaWeight, numActiveParams).rawMse;
    }
  }

  const resRegionInfo = findLargestResidualRegion(finalFittingPoints);

  // Extract continuous fitted n(λ) and k(λ)
  const finalParamRecord: Record<string, number> = {};
  for (const [k, p] of Object.entries(finalLayers[primaryLayerIndex].parameters)) {
    finalParamRecord[k] = p.current;
  }

  const finalOpticalConstants: { wavelength: number; n: number; k: number }[] = [];
  const minW = Math.max(190, fitWlMin);
  const maxW = Math.min(1200, fitWlMax);

  for (let w = minW; w <= maxW; w += 1.0) {
    const opt = finalModelDef.calculate(w, finalParamRecord);
    finalOpticalConstants.push({
      wavelength: Number(w.toFixed(1)),
      n: Number(opt.n.toFixed(4)),
      k: Number(opt.k.toFixed(4)),
    });
  }

  const targetAchieved = finalMetrics.rawMse < TARGET_MSE;
  const finalStatus: FittingResult['status'] = targetAchieved ? 'target_achieved' : 'target_not_achieved';

  const statusMsg = targetAchieved
    ? `TARGET ACHIEVED! 最終 Raw MSE: ${finalMetrics.rawMse.toFixed(4)} < ${TARGET_MSE.toFixed(2)}, 模型: 【${finalModelDef.name}】, 膜厚: ${finalThickness.toFixed(2)} nm (Ψ RMSE: ${finalPsiRmse.toFixed(3)}°, Δ RMSE: ${finalDeltaRmse.toFixed(3)}°)`
    : `TARGET NOT ACHIEVED: 最終 Raw MSE = ${finalMetrics.rawMse.toFixed(4)} >= ${TARGET_MSE.toFixed(2)}, 模型: 【${finalModelDef.name}】, 膜厚: ${finalThickness.toFixed(2)} nm`;

  log('========================================================================');
  log(statusMsg);
  log('========================================================================');

  reportProgress({
    stage: 'completed',
    stageName: 'Fitting Completed',
    stepNumber: 8,
    progressPercent: 100,
    currentMse: finalMetrics.mseWoollam,
    currentRmse: finalMetrics.rawRmse,
    currentThickness: finalThickness,
    currentModelName: finalModelDef.name,
    message: `[8/8] 擬合完成！最終 Raw MSE: ${finalMetrics.rawMse.toFixed(4)}, 膜厚: ${finalThickness.toFixed(2)} nm`,
  });

  const MODEL_NAMES: Record<string, string> = {
    cauchy: 'Cauchy (透明色散)',
    bspline: 'B-Spline (數值平滑)',
    gaussian: 'Gaussian (高斯振盪子)',
    lorentz: 'Lorentz (洛倫茲振盪子)',
    tauc_lorentz: 'Tauc-Lorentz (非晶半導體)',
    drude: 'Drude (自由載子)',
    multi_oscillator: 'Multi-Oscillator (複合振盪子)',
  };

  const pipelineData: PipelineAuditData = {
    experimentalAois: detectedAois,
    cauchy0Point: {
      parameters: {
        A: finalCauchyA,
        B: finalCauchyB,
        C: finalCauchyC,
      },
      thicknessNm: finalCauchyThickness,
      rawMse: cauchyFinalMse,
    },
    bspline: {
      nodeWavelengths: activeKnots,
      nodeCoefficients: finalBsplineCoeffRecord,
      thicknessNm: finalBsplineThickness,
      rawMse: bsplineFinalMse,
      regularizationPenalty: Number(activeBsplineRegPenalty.toFixed(5)),
      smoothN: Number(activeBsplineSmoothN.toFixed(6)),
      smoothK: Number(activeBsplineSmoothK.toFixed(6)),
      totalObjective: Number((bsplineFinalMse + activeBsplineRegPenalty).toFixed(5)),
      weightedRegularizationPenalty:activeWeightedRegPenalty,weightedTotalObjective:activeBsplineTotalObj,
      rmse: bsplineFinalRmse,
      psiRmse: bsplinePsiRmse,
      deltaRmse: bsplineDeltaRmse,
      knotRefinementHistory,
    },
    selectedPhysicalModel: MODEL_NAMES[finalModelId] || finalModelDef.name,
    physicalModelParameters: finalParamRecord,
    finalThicknessNm: Number(finalThickness.toFixed(2)),
    rawMse: finalMetrics.rawMse,
    rawRmse: finalMetrics.rawRmse,
    psiRmse: Number(finalPsiRmse.toFixed(4)),
    deltaRmse: Number(finalDeltaRmse.toFixed(4)),
    perAoiMse,
    multiStartSummary: {
      totalStarts: winningCandidate.multiStartRuns.length,
      validStarts: winningCandidate.multiStartRuns.length,
      bestStartIndex: winningCandidate.bestStartIndex,
      bestRawMse: winningCandidate.rawMse,
      bestMseWoollam:finalMetrics.mseWoollam,
      runs: winningCandidate.multiStartRuns,
    },
    physicalModelMismatch: isPhysicalModelMismatch,
    freshCalculationVerified,
  };

  return {
    updatedLayers: finalLayers,
    updatedSubstrate: substrate,
    updatedPoints: finalAllPoints,
    fittingResult: {
      mseWoollam:finalMetrics.mseWoollam,reducedChiSquare:finalMetrics.reducedChiSquare,chiSquare:finalMetrics.chiSquare,dof:finalMetrics.dof,
      weightingMode:finalMetrics.weightingMode,weightingWarning:finalMetrics.weightingWarning,converged:winningCandidate.converged,convergenceStatus:winningCandidate.convergenceStatus,
      perAoiMseWoollam:Object.fromEntries(Object.entries(computeMultiAoiResidualMetrics(finalFittingPoints,activeAois,config.fitWeighting,psiWeight,deltaWeight,numActiveParams).perAoi).map(([a,m])=>[a,m.mseWoollam])),
      status: finalStatus,
      iterations: totalOptimizerIterations,
      initialMse: cauchyFinalMse,
      finalMse: finalMetrics.rawMse,
      initialRmse: Math.sqrt(cauchyFinalMse),
      finalRmse: finalMetrics.rawRmse,
      rawMse: finalMetrics.rawMse,
      rawRmse: finalMetrics.rawRmse,
      psiRmse: Number(finalPsiRmse.toFixed(4)),
      deltaRmse: Number(finalDeltaRmse.toFixed(4)),
      weightedMse: finalMetrics.weightedMse,
      targetMse: TARGET_MSE,
      targetAchieved,
      aic: finalMetrics.aic,
      bic: finalMetrics.bic,
      numParameters: numActiveParams,
      isOverfitting: false,
      largestResidualRegion: resRegionInfo.regionDescription,
      possibleCauses: targetAchieved
        ? []
        : isPhysicalModelMismatch
        ? ['B-spline 能準確描述光學常數，但所選物理模型振盪子數目不足 (建議 +1 oscillator)']
        : ['實驗資料偏離或膜厚全域盆地邊界受限'],
      executionTimeMs: 0,
      parameters: winningCandidate.parametersRecord,
      message: statusMsg,
      fittingMode: activeAois.length > 1 ? 'multi_aoi' : 'single_aoi',
      selectedAois: activeAois,
      perAoiMse,
      bsplineDiagnostic: {
        rawMse: bsplineFinalMse,
        rawRmse: bsplineFinalRmse,
        psiRmse: bsplinePsiRmse,
        deltaRmse: bsplineDeltaRmse,
        regularizationPenalty: Number(activeBsplineRegPenalty.toFixed(5)),
        smoothN: Number(activeBsplineSmoothN.toFixed(6)),
        smoothK: Number(activeBsplineSmoothK.toFixed(6)),
        totalObjective: Number((bsplineFinalMse + activeBsplineRegPenalty).toFixed(5)),
      weightedRegularizationPenalty:activeWeightedRegPenalty,weightedTotalObjective:activeBsplineTotalObj,
        activeKnots: activeKnots.length,
        knotRefinementHistory,
      },
      multiStartSummary: {
        totalStarts: winningCandidate.multiStartRuns.length,
        validStarts: winningCandidate.multiStartRuns.length,
        bestStartIndex: winningCandidate.bestStartIndex,
        bestRawMse: winningCandidate.rawMse,
      bestMseWoollam:finalMetrics.mseWoollam,
      },
      physicalModelMismatch: isPhysicalModelMismatch,
      freshCalculationVerified,
    },
    finalThickness,
    finalOpticalConstants,
    modelComparisons: evaluatedCandidates.map((c) => ({
      modelId: c.modelId,
      modelName: c.modelName,
      finalMse: c.rawMse,
      finalRmse: c.rawRmse,
      psiRmse: c.psiRmse,
      deltaRmse: c.deltaRmse,
      finalThickness: c.thickness,
      iterations: c.iterations,
      converged: c.converged,
      fittedParameters: c.parametersRecord,
    })),
    workflowLog: logs,
    pipelineData,
  };
}
