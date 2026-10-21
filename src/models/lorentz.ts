/**
 * Lorentz Oscillator Model
 * Fundamental physics-based dispersion model for bound electron dielectric response and interband transitions.
 *
 * Equation:
 *   ε(E) = ε_inf + (A · E₀) / (E₀² - E² - i·γ·E)
 *   where E = hc/λ (eV)
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';
import { wavelengthNmToEnergyEv, dielectricToRefractiveIndex } from './base';

export const LorentzModel: ModelDefinition = {
  id: 'lorentz',
  name: 'Lorentz Oscillator',
  type: 'oscillator',
  category: 'oscillator',
  description: 'Classical harmonic oscillator model describing interband absorption and dielectric resonance.',
  reference: 'Lorentz, H. A. (1909). The Theory of Electrons and Its Applications to the Phenomena of Light and Radiant Heat.',
  equation: 'ε(E) = ε_∞ + A·E₀ / (E₀² - E² - i·γ·E)',
  equationDoc: 'ε(E) = ε_∞ + A·E₀ / (E₀² - E² - i·γ·E)',
  validRange: {
    minWavelengthNm: 190,
    maxWavelengthNm: 2500,
    minEnergyEv: 0.5,
    maxEnergyEv: 6.5,
  },
  version: '1.2.0',
  fitSupported: true,
  isVerified: true,
  parameters: [
    {
      id: 'eps_inf',
      name: 'High-Frequency Dielectric (ε_∞)',
      symbol: 'ε_∞',
      unit: '',
      description: 'Offset dielectric constant at energies well above resonance',
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
      unit: 'eV',
      description: 'Strength/intensity of Lorentz oscillator #1 transition',
      defaultValue: 15.0,
      min: 0.01,
      max: 250.0,
      step: 0.1,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'E0',
      name: 'Oscillator #1 Resonance Energy (E₀₁)',
      symbol: 'E₀₁',
      unit: 'eV',
      description: 'Central resonance transition energy for oscillator #1',
      defaultValue: 3.8,
      min: 0.5,
      max: 15.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'gamma',
      name: 'Oscillator #1 Damping (γ₁)',
      symbol: 'γ₁',
      unit: 'eV',
      description: 'Full width at half maximum (FWHM) of oscillator #1',
      defaultValue: 0.45,
      min: 0.001,
      max: 5.0,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'A2',
      name: 'Oscillator #2 Amplitude (A₂)',
      symbol: 'A₂',
      unit: 'eV',
      description: 'Strength/intensity of Lorentz oscillator #2 transition',
      defaultValue: 0.0,
      min: 0.0,
      max: 250.0,
      step: 0.1,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'E02',
      name: 'Oscillator #2 Resonance Energy (E₀₂)',
      symbol: 'E₀₂',
      unit: 'eV',
      description: 'Central resonance transition energy for oscillator #2',
      defaultValue: 4.8,
      min: 0.5,
      max: 15.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'gamma2',
      name: 'Oscillator #2 Damping (γ₂)',
      symbol: 'γ₂',
      unit: 'eV',
      description: 'Full width at half maximum (FWHM) of oscillator #2',
      defaultValue: 0.5,
      min: 0.001,
      max: 5.0,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'A3',
      name: 'Oscillator #3 Amplitude (A₃)',
      symbol: 'A₃',
      unit: 'eV',
      description: 'Strength/intensity of Lorentz oscillator #3 transition',
      defaultValue: 0.0,
      min: 0.0,
      max: 250.0,
      step: 0.1,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'E03',
      name: 'Oscillator #3 Resonance Energy (E₀₃)',
      symbol: 'E₀₃',
      unit: 'eV',
      description: 'Central resonance transition energy for oscillator #3',
      defaultValue: 5.8,
      min: 0.5,
      max: 15.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'gamma3',
      name: 'Oscillator #3 Damping (γ₃)',
      symbol: 'γ₃',
      unit: 'eV',
      description: 'Full width at half maximum (FWHM) of oscillator #3',
      defaultValue: 0.6,
      min: 0.001,
      max: 5.0,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: false,
    },
  ],
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const E = Math.max(1e-3, wavelengthNmToEnergyEv(wavelengthNm));
    const epsInf = params['eps_inf'] ?? 2.2;
    const A1 = params['A1'] ?? params['A'] ?? 15.0;
    const E01 = params['E01'] ?? params['E0'] ?? 3.8;
    const gamma1 = Math.max(1e-4, params['gamma1'] ?? params['gamma'] ?? 0.45);

    const A2 = params['A2'] ?? 0;
    const E02 = params['E02'] ?? 4.8;
    const gamma2 = Math.max(1e-4, params['gamma2'] ?? 0.5);

    const A3 = params['A3'] ?? 0;
    const E03 = params['E03'] ?? 5.8;
    const gamma3 = Math.max(1e-4, params['gamma3'] ?? 0.6);

    let eps1 = epsInf;
    let eps2 = 0;

    const addOsc = (A: number, E0: number, gamma: number) => {
      const diff = E0 * E0 - E * E;
      const denom = diff * diff + gamma * gamma * E * E;
      const num = A * E0;
      eps1 += (num * diff) / denom;
      eps2 += (num * gamma * E) / denom;
    };

    addOsc(A1, E01, gamma1);
    addOsc(A2, E02, gamma2);
    addOsc(A3, E03, gamma3);

    return { eps1, eps2: Math.max(0, eps2) };
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const { eps1, eps2 } = LorentzModel.calculateEpsilon(wavelengthNm, params);
    return dielectricToRefractiveIndex(eps1, eps2);
  },
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    return LorentzModel.calculate(wavelengthNm, params).n;
  },
  calculateK: (wavelengthNm: number, params: Record<string, number>): number => {
    return LorentzModel.calculate(wavelengthNm, params).k;
  },
};
