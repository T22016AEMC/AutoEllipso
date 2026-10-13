/**
 * Cauchy Dispersion Model
 * Standard model for transparent thin films (dielectrics, oxides, nitrides, polymers)
 *
 * Equation:
 *   n(lambda) = A + B / lambda^2 + C / lambda^4   (lambda in micrometers)
 *   k(lambda) = k0 * exp(alpha * (1/lambda - 1/0.4)) or transparent (k0 = 0)
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';

export const CauchyModel: ModelDefinition = {
  id: 'cauchy',
  name: 'Cauchy Dispersion',
  type: 'dispersion',
  category: 'dispersion',
  description: 'Empirical dispersion relation for transparent dielectric materials in the UV-Vis-NIR region.',
  reference: 'Cauchy, A. L. (1836). Mémoire sur la dispersion de la lumière.',
  equation: 'n(λ) = A + B/λ² + C/λ⁴,  k(λ) = k₀ + k₁/λ²',
  equationDoc: 'n(λ) = A + B/λ² + C/λ⁴,  k(λ) = k₀ + k₁/λ²',
  validRange: {
    minWavelengthNm: 250,
    maxWavelengthNm: 2000,
    minEnergyEv: 0.6,
    maxEnergyEv: 5.0,
  },
  version: '1.1.0',
  fitSupported: true,
  isVerified: true,
  parameters: [
    {
      id: 'A',
      name: 'Refractive Index Offset (A)',
      symbol: 'A',
      unit: '',
      description: 'Asymptotic refractive index at infinite wavelength',
      defaultValue: 1.457,
      min: 1.0,
      max: 3.5,
      step: 0.001,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'B',
      name: 'First Dispersion Coefficient (B)',
      symbol: 'B',
      unit: 'μm²',
      description: 'Coefficient controlling dispersion in the visible spectrum',
      defaultValue: 0.0035,
      min: -0.05,
      max: 0.1,
      step: 0.0001,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'C',
      name: 'Second Dispersion Coefficient (C)',
      symbol: 'C',
      unit: 'μm⁴',
      description: 'Higher-order coefficient for UV dispersion curvature',
      defaultValue: 0.0001,
      min: -0.01,
      max: 0.05,
      step: 0.00001,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'k0',
      name: 'Extinction Constant (k₀)',
      symbol: 'k₀',
      unit: '',
      description: 'Residual absorption constant (0 for transparent films)',
      defaultValue: 0.0,
      min: 0.0,
      max: 0.5,
      step: 0.001,
      fitSupported: true,
      isFittingCandidate: false,
    },
  ],
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    const lambdaUm = Math.max(0.1, wavelengthNm / 1000);
    const lambdaSq = lambdaUm * lambdaUm;
    const lambda4 = lambdaSq * lambdaSq;

    const A = params['A'] ?? 1.457;
    const B = params['B'] ?? 0.0035;
    const C = params['C'] ?? 0.0001;

    return Math.max(1.0, A + B / lambdaSq + C / lambda4);
  },
  calculateK: (_wavelengthNm: number, params: Record<string, number>): number => {
    const k0 = params['k0'] ?? 0.0;
    return Math.max(0.0, k0);
  },
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const n = CauchyModel.calculateN(wavelengthNm, params);
    const k = CauchyModel.calculateK(wavelengthNm, params);
    return {
      eps1: n * n - k * k,
      eps2: 2 * n * k,
    };
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const n = CauchyModel.calculateN(wavelengthNm, params);
    const k = CauchyModel.calculateK(wavelengthNm, params);
    return {
      n,
      k,
      eps1: n * n - k * k,
      eps2: 2 * n * k,
    };
  },
};
