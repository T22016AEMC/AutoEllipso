/**
 * Custom Parametric Optical Model
 *
 * User-configurable extended dispersion and absorption model.
 * Provides an adaptable parametric formulation allowing users to customize refractive index
 * and absorption spectra without modifying UI or backend solver logic.
 *
 * Equation:
 *   n(λ) = n₀ + C₁ / λ² + C₂ / λ⁴   (λ in μm)
 *   k(λ) = k₀ + α · exp(-((hc/λ - E_res) / 0.5)²)
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';
import { wavelengthNmToEnergyEv, refractiveIndexToDielectric } from './base';

export const CustomModel: ModelDefinition = {
  id: 'custom',
  name: 'Custom Parametric Model',
  type: 'custom',
  category: 'custom',
  description:
    'Extensible parametric dispersion and absorption model with user-definable baseline index, dispersion curvature, and resonant absorption threshold.',
  reference:
    'Flexible user-defined thin-film dispersion formulation.',
  equation: 'n(λ) = n₀ + C₁/λ² + C₂/λ⁴,  k(λ) = k₀ + α·exp(-((E - E_res)/0.5)²)',
  equationDoc: 'n(λ) = n₀ + C₁/λ² + C₂/λ⁴,  k(λ) = k₀ + α·exp(-((E - E_res)/0.5)²)',
  validRange: {
    minWavelengthNm: 190,
    maxWavelengthNm: 3000,
    minEnergyEv: 0.4,
    maxEnergyEv: 6.5,
  },
  version: '1.0.0',
  fitSupported: true,
  isVerified: true,
  parameters: [
    {
      id: 'n0',
      name: 'Base Refractive Index (n₀)',
      symbol: 'n₀',
      unit: '',
      description: 'Long-wavelength asymptotic refractive index offset',
      defaultValue: 1.50,
      min: 1.0,
      max: 5.0,
      step: 0.005,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'C1',
      name: 'First Dispersion Term (C₁)',
      symbol: 'C₁',
      unit: 'μm²',
      description: 'First-order dispersion curvature coefficient',
      defaultValue: 0.005,
      min: -0.05,
      max: 0.2,
      step: 0.0005,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'C2',
      name: 'Second Dispersion Term (C₂)',
      symbol: 'C₂',
      unit: 'μm⁴',
      description: 'Higher-order UV curvature coefficient',
      defaultValue: 0.0002,
      min: -0.01,
      max: 0.05,
      step: 0.00005,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'k0',
      name: 'Base Extinction (k₀)',
      symbol: 'k₀',
      unit: '',
      description: 'Residual non-resonant background absorption coefficient',
      defaultValue: 0.0,
      min: 0.0,
      max: 2.0,
      step: 0.001,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'alpha',
      name: 'Resonant Absorption (α)',
      symbol: 'α',
      unit: '',
      description: 'Extinction peak amplitude at transition resonance',
      defaultValue: 0.0,
      min: 0.0,
      max: 5.0,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'E_res',
      name: 'Resonance Energy (E_res)',
      symbol: 'E_res',
      unit: 'eV',
      description: 'Characteristic peak absorption transition energy',
      defaultValue: 3.5,
      min: 0.5,
      max: 8.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: true,
    },
  ],
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    const lambdaUm = Math.max(0.1, wavelengthNm / 1000);
    const lambdaSq = lambdaUm * lambdaUm;
    const lambda4 = lambdaSq * lambdaSq;

    const n0 = params['n0'] ?? 1.50;
    const C1 = params['C1'] ?? 0.005;
    const C2 = params['C2'] ?? 0.0002;

    return Math.max(1.0, n0 + C1 / lambdaSq + C2 / lambda4);
  },
  calculateK: (wavelengthNm: number, params: Record<string, number>): number => {
    const E = Math.max(1e-3, wavelengthNmToEnergyEv(wavelengthNm));
    const k0 = Math.max(0.0, params['k0'] ?? 0.0);
    const alpha = Math.max(0.0, params['alpha'] ?? 0.0);
    const Eres = params['E_res'] ?? 3.5;

    const peak = alpha * Math.exp(-Math.pow((E - Eres) / 0.5, 2));
    return Math.max(0.0, k0 + peak);
  },
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const n = CustomModel.calculateN(wavelengthNm, params);
    const k = CustomModel.calculateK(wavelengthNm, params);
    return refractiveIndexToDielectric(n, k);
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const n = CustomModel.calculateN(wavelengthNm, params);
    const k = CustomModel.calculateK(wavelengthNm, params);
    const { eps1, eps2 } = refractiveIndexToDielectric(n, k);
    return { n, k, eps1, eps2 };
  },
};
