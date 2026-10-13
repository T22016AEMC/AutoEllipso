/**
 * High-level Spectroscopic Ellipsometry Calculator
 * Evaluates the full layer stack across experimental or simulated spectra.
 */
import {
  Ambient,
  Layer,
  Substrate,
  EllipsometryDataPoint,
} from '../types/ellipsometry';
import { Complex } from '../optics/complex';
import { modelRegistry } from '../modelRegistry/registry';
import { solveEllipsometryTMM, LayerOpticalState, SolverResult } from './transferMatrix';

/**
 * Extract active optical constants for a given layer at a specific wavelength
 */
export function evaluateLayerOpticalConstants(
  layer: Layer,
  wavelengthNm: number
): Complex {
  const model = modelRegistry.get(layer.modelId);
  if (!model) {
    // Default fallback: SiO2 Cauchy
    return new Complex(1.46, 0);
  }

  const paramValues: Record<string, number> = {};
  for (const [key, p] of Object.entries(layer.parameters)) {
    paramValues[key] = p.current;
  }

  const opt = model.calculate(wavelengthNm, paramValues);
  return new Complex(opt.n, opt.k);
}

/**
 * Extract optical constants for the substrate at a specific wavelength
 */
export function evaluateSubstrateOpticalConstants(
  substrate: Substrate,
  wavelengthNm: number
): Complex {
  const model = modelRegistry.get(substrate.modelId);
  if (!model) {
    // Default to crystalline Silicon
    const siModel = modelRegistry.get('tabulated_si');
    if (siModel) {
      const opt = siModel.calculate(wavelengthNm, {});
      return new Complex(opt.n, opt.k);
    }
    return new Complex(3.88, 0.019);
  }

  const paramValues: Record<string, number> = {};
  for (const [key, p] of Object.entries(substrate.parameters)) {
    paramValues[key] = p.current;
  }

  const opt = model.calculate(wavelengthNm, paramValues);
  return new Complex(opt.n, opt.k);
}

/**
 * Calculate single point Psi and Delta for a given state
 */
export function calculatePoint(
  ambient: Ambient,
  layers: Layer[],
  substrate: Substrate,
  wavelengthNm: number,
  aoiDeg: number
): SolverResult {
  const ambientN = new Complex(ambient.n, ambient.k);
  const substrateN = evaluateSubstrateOpticalConstants(substrate, wavelengthNm);

  const layerStates: LayerOpticalState[] = layers.map((l) => ({
    thicknessNm: l.thickness,
    N: evaluateLayerOpticalConstants(l, wavelengthNm),
  }));

  return solveEllipsometryTMM(ambientN, layerStates, substrateN, wavelengthNm, aoiDeg);
}

/**
 * Evaluate spectrum for all experimental data points
 */
export function calculateSpectrum(
  ambient: Ambient,
  layers: Layer[],
  substrate: Substrate,
  points: EllipsometryDataPoint[]
): EllipsometryDataPoint[] {
  return points.map((pt) => {
    const res = calculatePoint(ambient, layers, substrate, pt.wavelength, pt.aoi);

    // Delta shortest circular difference
    let deltaDiff = res.deltaDeg - pt.deltaExp;
    while (deltaDiff > 180) deltaDiff -= 360;
    while (deltaDiff < -180) deltaDiff += 360;

    const psiDiff = res.psiDeg - pt.psiExp;

    return {
      ...pt,
      psiCalc: res.psiDeg,
      deltaCalc: res.deltaDeg,
      psiResidual: psiDiff,
      deltaResidual: deltaDiff,
    };
  });
}
