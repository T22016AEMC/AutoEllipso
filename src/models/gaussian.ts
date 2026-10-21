/**
 * Gaussian Oscillator Dispersion Model
 *
 * Implements a physically rigorous Kramers-Kronig consistent Gaussian absorption oscillator.
 * Extensively used in spectroscopic ellipsometry for interband transitions, defect states,
 * and materials with inhomogeneous broadening (polymers, organic semiconductors, amorphous dielectrics).
 *
 * Equation:
 *   ε₂(E) = A · [exp(-((E - E₀)/σ)²) - exp(-((E + E₀)/σ)²)]
 *   ε₁(E) = ε_∞ + (2/π) · P ∫ [ξ · ε₂(ξ) / (ξ² - E²)] dξ
 *
 * Parameters:
 *   eps_inf: High-frequency background dielectric constant (ε_∞ >= 1.0)
 *   A: Oscillator amplitude (peak extinction intensity)
 *   E0: Center resonance transition energy (eV)
 *   sigma: Gaussian broadening half-width (eV), σ = FWHM / (2√(ln 2))
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';
import { wavelengthNmToEnergyEv, dielectricToRefractiveIndex } from './base';
import { dawson } from './kk';
const gaussianCache = new Map<string, number>();

/**
 * Compute imaginary dielectric response eps2(E) for Gaussian oscillator
 */
export function computeGaussianEps2(
  E: number,
  A: number,
  E0: number,
  sigma: number
): number {
  if (E <= 0 || sigma <= 0) return 0;
  const term1 = Math.exp(-Math.pow((E - E0) / sigma, 2));
  const term2 = Math.exp(-Math.pow((E + E0) / sigma, 2));
  return Math.max(0, A * (term1 - term2));
}

/**
 * Compute derivative of eps2 with respect to energy E for smooth singularity removal
 */
function computeGaussianEps2Derivative(
  E: number,
  A: number,
  E0: number,
  sigma: number
): number {
  if (E <= 0 || sigma <= 0) return 0;
  const s2 = sigma * sigma;
  const term1 = -((2 * (E - E0)) / s2) * Math.exp(-Math.pow((E - E0) / sigma, 2));
  const term2 = -((2 * (E + E0)) / s2) * Math.exp(-Math.pow((E + E0) / sigma, 2));
  return A * (term1 - term2);
}

/**
 * Kramers-Kronig calculation of eps1(E) using singularity subtraction
 */
export function computeGaussianEps1(
  E: number,
  epsInf: number,
  A: number,
  E0: number,
  sigma: number
): number {
  if (A <= 0 || sigma <= 0) return epsInf;

  // Analytic Hilbert transform of the odd Gaussian absorption pair.
  const key=[E,E0,sigma].join('|');let unit=gaussianCache.get(key);
  if(unit===undefined) {
    unit=2/Math.sqrt(Math.PI)*(dawson((E+E0)/sigma)-dawson((E-E0)/sigma));
    if(gaussianCache.size>=8192)gaussianCache.delete(gaussianCache.keys().next().value!);
    gaussianCache.set(key,unit);
  }
  return epsInf+A*unit;
}

export const GaussianModel: ModelDefinition = {
  id: 'gaussian',
  name: 'Gaussian Oscillator',
  type: 'oscillator',
  category: 'oscillator',
  description:
    'Harmonic oscillator with Gaussian spectral broadening, widely applied to interband transitions and defect states with inhomogeneous broadening.',
  reference:
    'Woollam, J. A. et al. (1999). Overview of Variable Angle Spectroscopic Ellipsometry (VASE). Proc. SPIE 10294.',
  equation: 'ε₂(E) = A · [exp(-((E-E₀)/σ)²) - exp(-((E+E₀)/σ)²)],  ε₁(E) via Kramers-Kronig relation',
  equationDoc: 'ε₂(E) = A · [exp(-((E-E₀)/σ)²) - exp(-((E+E₀)/σ)²)],  ε₁(E) via Kramers-Kronig relation',
  validRange: {
    minWavelengthNm: 190,
    maxWavelengthNm: 2500,
    minEnergyEv: 0.5,
    maxEnergyEv: 6.5,
  },
  version: '1.3.0',
  fitSupported: true,
  isVerified: true,
  parameters: [
    {
      id: 'eps_inf',
      name: 'High-Frequency Dielectric (ε_∞)',
      symbol: 'ε_∞',
      unit: '',
      description: 'Dielectric constant offset at energies well above the oscillator resonance',
      defaultValue: 2.2,
      min: 1.0,
      max: 20.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'A',
      name: 'Oscillator #1 Amplitude (A₁)',
      symbol: 'A₁',
      unit: '',
      description: 'Peak dielectric absorption amplitude of Gaussian oscillator #1',
      defaultValue: 3.5,
      min: 0.01,
      max: 100.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'E0',
      name: 'Oscillator #1 Center Energy (E₀₁)',
      symbol: 'E₀₁',
      unit: 'eV',
      description: 'Central resonance transition photon energy for oscillator #1',
      defaultValue: 3.6,
      min: 0.5,
      max: 15.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'sigma',
      name: 'Oscillator #1 Broadening (σ₁)',
      symbol: 'σ₁',
      unit: 'eV',
      description: 'Gaussian half-width for oscillator #1',
      defaultValue: 0.55,
      min: 0.05,
      max: 3.5,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'A2',
      name: 'Oscillator #2 Amplitude (A₂)',
      symbol: 'A₂',
      unit: '',
      description: 'Peak dielectric absorption amplitude of Gaussian oscillator #2',
      defaultValue: 0.0,
      min: 0.0,
      max: 100.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'E02',
      name: 'Oscillator #2 Center Energy (E₀₂)',
      symbol: 'E₀₂',
      unit: 'eV',
      description: 'Central resonance transition photon energy for oscillator #2',
      defaultValue: 4.8,
      min: 0.5,
      max: 15.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'sigma2',
      name: 'Oscillator #2 Broadening (σ₂)',
      symbol: 'σ₂',
      unit: 'eV',
      description: 'Gaussian half-width for oscillator #2',
      defaultValue: 0.6,
      min: 0.05,
      max: 3.5,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'A3',
      name: 'Oscillator #3 Amplitude (A₃)',
      symbol: 'A₃',
      unit: '',
      description: 'Peak dielectric absorption amplitude of Gaussian oscillator #3',
      defaultValue: 0.0,
      min: 0.0,
      max: 100.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'E03',
      name: 'Oscillator #3 Center Energy (E₀₃)',
      symbol: 'E₀₃',
      unit: 'eV',
      description: 'Central resonance transition photon energy for oscillator #3',
      defaultValue: 5.8,
      min: 0.5,
      max: 15.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'sigma3',
      name: 'Oscillator #3 Broadening (σ₃)',
      symbol: 'σ₃',
      unit: 'eV',
      description: 'Gaussian half-width for oscillator #3',
      defaultValue: 0.7,
      min: 0.05,
      max: 3.5,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: false,
    },
  ],
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const E = Math.max(1e-3, wavelengthNmToEnergyEv(wavelengthNm));
    const epsInf = params['eps_inf'] ?? 2.2;
    const A1 = params['A1'] ?? params['A'] ?? 3.5;
    const E01 = params['E01'] ?? params['E0'] ?? 3.6;
    const sigma1 = Math.max(0.01, params['sigma1'] ?? params['sigma'] ?? 0.55);

    const A2 = params['A2'] ?? 0;
    const E02 = params['E02'] ?? 4.8;
    const sigma2 = Math.max(0.01, params['sigma2'] ?? 0.6);

    const A3 = params['A3'] ?? 0;
    const E03 = params['E03'] ?? 5.8;
    const sigma3 = Math.max(0.01, params['sigma3'] ?? 0.7);

    let eps2 = computeGaussianEps2(E, A1, E01, sigma1);
    let deltaEps1 = computeGaussianEps1(E, 0, A1, E01, sigma1);

    eps2 += computeGaussianEps2(E, A2, E02, sigma2);
    deltaEps1 += computeGaussianEps1(E, 0, A2, E02, sigma2);
    eps2 += computeGaussianEps2(E, A3, E03, sigma3);
    deltaEps1 += computeGaussianEps1(E, 0, A3, E03, sigma3);

    const eps1 = epsInf + deltaEps1;
    return { eps1, eps2 };
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const { eps1, eps2 } = GaussianModel.calculateEpsilon(wavelengthNm, params);
    return dielectricToRefractiveIndex(eps1, eps2);
  },
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    return GaussianModel.calculate(wavelengthNm, params).n;
  },
  calculateK: (wavelengthNm: number, params: Record<string, number>): number => {
    return GaussianModel.calculate(wavelengthNm, params).k;
  },
};
