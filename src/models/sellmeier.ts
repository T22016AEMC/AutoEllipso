/**
 * Sellmeier Dispersion Model
 * Widely used for optical glass, fused silica, and transparent optical media.
 *
 * Equation:
 *   n²(λ) = 1 + B1·λ² / (λ² - C1) + B2·λ² / (λ² - C2)
 *   where λ is in μm, and C1, C2 are resonance absorption wavelength squares (μm²).
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';

export const SellmeierModel: ModelDefinition = {
  id: 'sellmeier',
  name: 'Sellmeier Dispersion',
  type: 'dispersion',
  category: 'dispersion',
  description: 'Physical dispersion formula relating refractive index to optical resonance absorption wavelengths.',
  reference: 'Sellmeier, W. (1871). Zur Erklärung der abnormen Farbenfolge im Spectrum einiger Substanzen.',
  equation: 'n²(λ) = 1 + B₁λ²/(λ² - C₁) + B₂λ²/(λ² - C₂)',
  equationDoc: 'n²(λ) = 1 + B₁λ²/(λ² - C₁) + B₂λ²/(λ² - C₂)',
  validRange: {
    minWavelengthNm: 200,
    maxWavelengthNm: 2500,
    minEnergyEv: 0.5,
    maxEnergyEv: 6.2,
  },
  version: '1.1.0',
  fitSupported: true,
  isVerified: true,
  parameters: [
    {
      id: 'B1',
      name: 'Oscillator Strength 1 (B₁)',
      symbol: 'B₁',
      unit: '',
      description: 'First oscillator strength',
      defaultValue: 0.696,
      min: 0.01,
      max: 3.0,
      step: 0.001,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'C1',
      name: 'Resonance 1 (C₁)',
      symbol: 'C₁',
      unit: 'μm²',
      description: 'First absorption resonance square',
      defaultValue: 0.0046,
      min: 0.0001,
      max: 0.05,
      step: 0.0001,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'B2',
      name: 'Oscillator Strength 2 (B₂)',
      symbol: 'B₂',
      unit: '',
      description: 'Second oscillator strength',
      defaultValue: 0.407,
      min: 0.01,
      max: 3.0,
      step: 0.001,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'C2',
      name: 'Resonance 2 (C₂)',
      symbol: 'C₂',
      unit: 'μm²',
      description: 'Second absorption resonance square',
      defaultValue: 0.0135,
      min: 0.001,
      max: 0.1,
      step: 0.0001,
      fitSupported: true,
      isFittingCandidate: true,
    },
  ],
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    const lambdaUm = Math.max(0.1, wavelengthNm / 1000);
    const lambdaSq = lambdaUm * lambdaUm;

    const B1 = params['B1'] ?? 0.696;
    const C1 = params['C1'] ?? 0.0046;
    const B2 = params['B2'] ?? 0.407;
    const C2 = params['C2'] ?? 0.0135;

    const term1 = (B1 * lambdaSq) / Math.max(1e-6, lambdaSq - C1);
    const term2 = (B2 * lambdaSq) / Math.max(1e-6, lambdaSq - C2);

    const nSq = 1.0 + term1 + term2;
    return Math.sqrt(Math.max(1.0, nSq));
  },
  calculateK: (): number => {
    return 0.0;
  },
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const n = SellmeierModel.calculateN(wavelengthNm, params);
    return {
      eps1: n * n,
      eps2: 0,
    };
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const n = SellmeierModel.calculateN(wavelengthNm, params);
    return {
      n,
      k: 0.0,
      eps1: n * n,
      eps2: 0,
    };
  },
};
