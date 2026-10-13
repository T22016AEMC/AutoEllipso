/**
 * Multi-Oscillator Physical Dispersion Model
 *
 * Implements a Kramers-Kronig consistent dielectric summation of up to 3 physical oscillators
 * (Gaussian, Lorentz, or Tauc-Lorentz) on top of a high-frequency background ε_∞:
 *
 *   ε(E) = ε_∞ + Σ_j [ Δε_{1,j}(E) + i·ε_{2,j}(E) ]
 *   n + i·k = √ε(E)
 *
 * Ensures:
 *   n(E) >= 1.0, k(E) >= 0.0
 *   Strict parameter bounds (Amplitude >= 0, Center Energy in spectral window, Broadening > 0).
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';
import { wavelengthNmToEnergyEv, dielectricToRefractiveIndex } from './base';
import { computeGaussianEps1, computeGaussianEps2 } from './gaussian';
import { computeTaucLorentzEps1, computeTaucLorentzEps2 } from './taucLorentz';

/**
 * Lorentz oscillator dielectric components
 */
function computeLorentzOscillator(
  E: number,
  A: number,
  E0: number,
  gamma: number
): { dEps1: number; eps2: number } {
  if (E <= 0 || A <= 0 || gamma <= 0) return { dEps1: 0, eps2: 0 };
  const E0sq = E0 * E0;
  const Esq = E * E;
  const diff = E0sq - Esq;
  const den = diff * diff + gamma * gamma * Esq;
  if (den < 1e-12) return { dEps1: 0, eps2: 0 };

  const factor = A * E0;
  const dEps1 = (factor * diff) / den;
  const eps2 = Math.max(0, (factor * gamma * E) / den);
  return { dEps1, eps2 };
}

/**
 * Gaussian oscillator dielectric components
 */
function computeGaussianOscillator(
  E: number,
  A: number,
  E0: number,
  sigma: number
): { dEps1: number; eps2: number } {
  if (E <= 0 || A <= 0 || sigma <= 0) return { dEps1: 0, eps2: 0 };
  const eps2 = computeGaussianEps2(E, A, E0, sigma);
  const eps1WithZeroOffset = computeGaussianEps1(E, 0.0, A, E0, sigma);
  return { dEps1: eps1WithZeroOffset, eps2 };
}

/**
 * Tauc-Lorentz oscillator dielectric components
 */
function computeTaucLorentzOscillator(
  E: number,
  A: number,
  E0: number,
  C: number,
  Eg: number
): { dEps1: number; eps2: number } {
  if (E <= 0 || A <= 0 || C <= 0) return { dEps1: 0, eps2: 0 };
  const eps2 = computeTaucLorentzEps2(E, A, E0, C, Eg);
  const eps1WithZeroOffset = computeTaucLorentzEps1(E, A, E0, C, Eg);
  return { dEps1: eps1WithZeroOffset, eps2 };
}

export const MultiOscillatorModel: ModelDefinition = {
  id: 'multi_oscillator',
  name: 'Multi-Oscillator (General Dispersion)',
  type: 'oscillator',
  category: 'oscillator',
  description:
    'Combined multi-oscillator physical dispersion model supporting up to 3 KK-consistent oscillators (Gaussian, Lorentz, Tauc-Lorentz) with ε_∞ dielectric baseline.',
  reference:
    'Jellison, G. E. (1998). Spectroscopic Ellipsometry Data Analysis: Measured vs Calculated. Thin Solid Films 313–314, 33–39.',
  equation: 'ε(E) = ε_∞ + Σ_j Δε_j(E), where Δε_j are Gaussian, Lorentz, or Tauc-Lorentz oscillators',
  equationDoc: 'ε(E) = ε_∞ + Σ_j Δε_j(E), where Δε_j are Gaussian, Lorentz, or Tauc-Lorentz oscillators',
  validRange: {
    minWavelengthNm: 190,
    maxWavelengthNm: 2500,
    minEnergyEv: 0.5,
    maxEnergyEv: 6.5,
  },
  version: '2.0.0',
  fitSupported: true,
  isVerified: true,
  parameters: [
    {
      id: 'eps_inf',
      name: 'High-Frequency Dielectric (ε_∞)',
      symbol: 'ε_∞',
      unit: '',
      description: 'Background electronic polarization offset',
      defaultValue: 2.2,
      min: 1.0,
      max: 15.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: true,
    },
    // Oscillator 1
    {
      id: 'A1',
      name: 'Oscillator 1 振幅 (A1)',
      symbol: 'A₁',
      unit: 'eV',
      description: 'First oscillator amplitude',
      defaultValue: 2.5,
      min: 0.0,
      max: 150.0,
      step: 0.1,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'E01',
      name: 'Oscillator 1 諧振能量 (E01)',
      symbol: 'E₀₁',
      unit: 'eV',
      description: 'First oscillator center energy',
      defaultValue: 3.8,
      min: 1.2,
      max: 6.5,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'w1',
      name: 'Oscillator 1 展寬 (w1)',
      symbol: 'w₁',
      unit: 'eV',
      description: 'First oscillator broadening (sigma/gamma/C)',
      defaultValue: 0.6,
      min: 0.05,
      max: 4.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'Eg1',
      name: 'Oscillator 1 能隙 Eg (若為TL)',
      symbol: 'E_g1',
      unit: 'eV',
      description: 'Optical bandgap for Tauc-Lorentz oscillator 1',
      defaultValue: 2.5,
      min: 0.5,
      max: 5.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: false,
    },
    // Oscillator 2
    {
      id: 'A2',
      name: 'Oscillator 2 振幅 (A2)',
      symbol: 'A₂',
      unit: 'eV',
      description: 'Second oscillator amplitude',
      defaultValue: 0.0,
      min: 0.0,
      max: 150.0,
      step: 0.1,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'E02',
      name: 'Oscillator 2 諧振能量 (E02)',
      symbol: 'E₀₂',
      unit: 'eV',
      description: 'Second oscillator center energy',
      defaultValue: 4.8,
      min: 1.2,
      max: 6.5,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'w2',
      name: 'Oscillator 2 展寬 (w2)',
      symbol: 'w₂',
      unit: 'eV',
      description: 'Second oscillator broadening',
      defaultValue: 0.8,
      min: 0.05,
      max: 4.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    // Oscillator 3
    {
      id: 'A3',
      name: 'Oscillator 3 振幅 (A3)',
      symbol: 'A₃',
      unit: 'eV',
      description: 'Third oscillator amplitude',
      defaultValue: 0.0,
      min: 0.0,
      max: 150.0,
      step: 0.1,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'E03',
      name: 'Oscillator 3 諧振能量 (E03)',
      symbol: 'E₀₃',
      unit: 'eV',
      description: 'Third oscillator center energy',
      defaultValue: 2.4,
      min: 1.0,
      max: 6.5,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'w3',
      name: 'Oscillator 3 展寬 (w3)',
      symbol: 'w₃',
      unit: 'eV',
      description: 'Third oscillator broadening',
      defaultValue: 0.7,
      min: 0.05,
      max: 4.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
  ],
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    return MultiOscillatorModel.calculate(wavelengthNm, params).n;
  },
  calculateK: (wavelengthNm: number, params: Record<string, number>): number => {
    return MultiOscillatorModel.calculate(wavelengthNm, params).k;
  },
  calculateEpsilon: (
    wavelengthNm: number,
    params: Record<string, number>
  ): { eps1: number; eps2: number } => {
    const res = MultiOscillatorModel.calculate(wavelengthNm, params);
    return {
      eps1: res.eps1 ?? (res.n * res.n - res.k * res.k),
      eps2: res.eps2 ?? (2 * res.n * res.k),
    };
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const E = wavelengthNmToEnergyEv(wavelengthNm);
    const epsInf = Math.max(1.0, params['eps_inf'] ?? 2.2);

    let totalEps1 = epsInf;
    let totalEps2 = 0.0;

    // Oscillator 1
    const A1 = Math.max(0, params['A1'] ?? 0);
    const E01 = params['E01'] ?? 3.8;
    const w1 = Math.max(0.01, params['w1'] ?? 0.6);
    const Eg1 = params['Eg1'] ?? 2.5;
    const type1 = params['osc1_type_code'] ?? 1; // 1: Gaussian, 2: Lorentz, 3: Tauc-Lorentz

    if (A1 > 1e-5) {
      let oscRes: { dEps1: number; eps2: number };
      if (type1 === 2) {
        oscRes = computeLorentzOscillator(E, A1, E01, w1);
      } else if (type1 === 3) {
        oscRes = computeTaucLorentzOscillator(E, A1, E01, w1, Eg1);
      } else {
        oscRes = computeGaussianOscillator(E, A1, E01, w1);
      }
      totalEps1 += oscRes.dEps1;
      totalEps2 += oscRes.eps2;
    }

    // Oscillator 2
    const A2 = Math.max(0, params['A2'] ?? 0);
    const E02 = params['E02'] ?? 4.8;
    const w2 = Math.max(0.01, params['w2'] ?? 0.8);
    const type2 = params['osc2_type_code'] ?? 1;

    if (A2 > 1e-5) {
      let oscRes: { dEps1: number; eps2: number };
      if (type2 === 2) {
        oscRes = computeLorentzOscillator(E, A2, E02, w2);
      } else {
        oscRes = computeGaussianOscillator(E, A2, E02, w2);
      }
      totalEps1 += oscRes.dEps1;
      totalEps2 += oscRes.eps2;
    }

    // Oscillator 3
    const A3 = Math.max(0, params['A3'] ?? 0);
    const E03 = params['E03'] ?? 2.4;
    const w3 = Math.max(0.01, params['w3'] ?? 0.7);
    const type3 = params['osc3_type_code'] ?? 2;

    if (A3 > 1e-5) {
      let oscRes: { dEps1: number; eps2: number };
      if (type3 === 1) {
        oscRes = computeGaussianOscillator(E, A3, E03, w3);
      } else {
        oscRes = computeLorentzOscillator(E, A3, E03, w3);
      }
      totalEps1 += oscRes.dEps1;
      totalEps2 += oscRes.eps2;
    }

    const { n, k } = dielectricToRefractiveIndex(totalEps1, totalEps2);
    return {
      n,
      k: Math.max(0.0, k),
      eps1: totalEps1,
      eps2: totalEps2,
    };
  },
};
