/**
 * Adaptive B-spline Optical Constant Dispersion Model
 *
 * Implements a physically constrained, adaptive numerical representation of
 * complex refractive index n(λ) and k(λ) using basis splines.
 *
 * Eliminates fixed 5-node limitations. Dynamically creates knots based on the
 * experimental wavelength range [wavelengthMin, wavelengthMax] with configurable
 * knot count (Standard: 8~12 knots, Aggressive: 12~20 knots, max 20).
 *
 * Equation:
 *   n(λ) = Σ c_n,i · B_i(λ)
 *   k(λ) = Σ c_k,i · B_i(λ)
 */
import { ModelDefinition, OpticalConstants, ParameterDef } from '../types/ellipsometry';
import { dielectricToRefractiveIndex } from './base';
import { cubicEvaluate } from './cubicSpline';

export const MAX_BSPLINE_NODES = 20;

/**
 * Automatically generates adaptive B-spline knots covering the exact experimental wavelength range
 */
export function generateAdaptiveKnots(
  wavelengthMin: number,
  wavelengthMax: number,
  knotCount: number = 8
): number[] {
  const minW = Math.max(150, wavelengthMin);
  const maxW = Math.min(2500, wavelengthMax);
  const count = Math.max(4, Math.min(MAX_BSPLINE_NODES, Math.round(knotCount)));
  const knots: number[] = [];
  for (let i = 0; i < count; i++) {
    const wl = minW + (i / (count - 1)) * (maxW - minW);
    knots.push(Number(wl.toFixed(1)));
  }
  return knots;
}

/**
 * Open clamped cubic B-spline evaluation over a nonuniform control grid
 */
export function evaluateAdaptiveSpline(
  wavelengthNm: number,
  knots: number[],
  coeffs: number[]
): number {
  return cubicEvaluate(wavelengthNm, knots, coeffs);
}

// Generate up to 20 parameter definitions dynamically
function buildBsplineParamDefs(): ParameterDef[] {
  const defs: ParameterDef[] = [];
  for (let i = 0; i < MAX_BSPLINE_NODES; i++) {
    defs.push({
      id: `N${i}`,
      name: `Refractive Index Node ${i + 1}`,
      symbol: `N_${i}`,
      unit: '',
      description: `B-spline refractive index control coefficient #${i + 1}`,
      defaultValue: 1.48,
      min: 1.0,
      max: 5.5,
      step: 0.005,
      fitSupported: true,
      isFittingCandidate: i < 8,
    });
  }
  for (let i = 0; i < MAX_BSPLINE_NODES; i++) {
    defs.push({
      id: `K${i}`,
      name: `Extinction Node ${i + 1}`,
      symbol: `K_${i}`,
      unit: '',
      description: `B-spline extinction control coefficient #${i + 1}`,
      defaultValue: 0.001,
      min: 0.0,
      max: 3.5,
      step: 0.001,
      fitSupported: true,
      isFittingCandidate: i < 8,
    });
  }
  return defs;
}

/**
 * Extract active coefficients from parameter dictionary in index order
 */
function extractCoeffs(params: Record<string, number>, prefix: 'N' | 'K', count: number): number[] {
  const coeffs: number[] = [];
  for (let i = 0; i < count; i++) {
    const val = params[`${prefix}${i}`];
    if (val !== undefined && !isNaN(val)) {
      coeffs.push(val);
    } else {
      const prev = coeffs.length > 0 ? coeffs[coeffs.length - 1] : prefix === 'N' ? 1.48 : 0.0005;
      coeffs.push(prev);
    }
  }
  return coeffs;
}

/**
 * Second-order finite-difference smoothness regularization for B-spline coefficients:
 *   smoothN = Σ [n(i+1) - 2*n(i) + n(i-1)]^2
 *   smoothK = Σ [k(i+1) - 2*k(i) + k(i-1)]^2
 *   regularizationPenalty = lambdaN * smoothN + lambdaK * smoothK
 */
export function computeBsplineSmoothness(
  nCoeffs: number[],
  kCoeffs: number[],
  lambdaN: number = 5.0,
  lambdaK: number = 10.0
): {
  smoothN: number;
  smoothK: number;
  regularizationPenalty: number;
  secondDiffN: number[];
  secondDiffK: number[];
} {
  const secondDiffN: number[] = [];
  let smoothN = 0;
  for (let i = 1; i < nCoeffs.length - 1; i++) {
    const d2 = nCoeffs[i + 1] - 2 * nCoeffs[i] + nCoeffs[i - 1];
    secondDiffN.push(d2);
    smoothN += d2 * d2;
  }

  const secondDiffK: number[] = [];
  let smoothK = 0;
  for (let i = 1; i < kCoeffs.length - 1; i++) {
    const d2 = kCoeffs[i + 1] - 2 * kCoeffs[i] + kCoeffs[i - 1];
    secondDiffK.push(d2);
    smoothK += d2 * d2;
  }

  const regularizationPenalty = lambdaN * smoothN + lambdaK * smoothK;

  return {
    smoothN,
    smoothK,
    regularizationPenalty,
    secondDiffN,
    secondDiffK,
  };
}

function getEffectiveKnotsAndCount(params:Record<string,number>,prefix:'N'|'K'):{knots:number[];count:number} {
  let defined=0;while(params[`${prefix}${defined}`]!==undefined&&defined<MAX_BSPLINE_NODES)defined++;
  const count=params._knotCount>=4?Math.min(MAX_BSPLINE_NODES,Math.round(params._knotCount)):
    defined>=4&&defined<MAX_BSPLINE_NODES?defined:8;
  const knots=params._knot0!==undefined?Array.from({length:count},(_,i)=>params[`_knot${i}`]):generateAdaptiveKnots(190,900,count);
  return {knots,count};
}

export const BSplineModel: ModelDefinition = {
  id: 'bspline',
  name: 'B-Spline Numerical Dispersion',
  type: 'dispersion',
  category: 'dispersion',
  description: 'Adaptive basis-spline formulation for arbitrary complex refractive index n(λ) and k(λ) extraction.',
  reference: 'Johs, B., & Hale, J. S. (2008). Dielectric function representation by B-splines. Phys. Status Solidi A, 205(4), 715-719.',
  equation: 'n(λ) = Σ c_n,i · B_i(λ),  k(λ) = Σ c_k,i · B_i(λ)',
  equationDoc: 'n(λ) = Σ c_n,i · B_i(λ),  k(λ) = Σ c_k,i · B_i(λ)',
  validRange: {
    minWavelengthNm: 150,
    maxWavelengthNm: 2500,
    minEnergyEv: 0.5,
    maxEnergyEv: 8.0,
  },
  version: '2.1.0',
  fitSupported: true,
  isVerified: true,
  parameters: buildBsplineParamDefs(),
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    const { knots, count } = getEffectiveKnotsAndCount(params, 'N');
    const coeffs = extractCoeffs(params, 'N', count);
    return Math.max(0.0, evaluateAdaptiveSpline(wavelengthNm, knots, coeffs));
  },
  calculateK: (wavelengthNm: number, params: Record<string, number>): number => {
    const { knots, count } = getEffectiveKnotsAndCount(params, 'K');
    const coeffs = extractCoeffs(params, 'K', count);
    return Math.max(0.0, evaluateAdaptiveSpline(wavelengthNm, knots, coeffs));
  },
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const n = BSplineModel.calculateN(wavelengthNm, params);
    const k = BSplineModel.calculateK(wavelengthNm, params);
    return {
      eps1: n * n - k * k,
      eps2: 2 * n * k,
    };
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const n = BSplineModel.calculateN(wavelengthNm, params);
    const k = BSplineModel.calculateK(wavelengthNm, params);
    return {
      n,
      k,
      eps1: n * n - k * k,
      eps2: 2 * n * k,
    };
  },
};
