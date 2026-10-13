/**
 * Tauc-Lorentz Dispersion Model
 * Developed by G. E. Jellison Jr. and F. A. Sales (1996)
 * Widely acknowledged as the gold standard for amorphous, polycrystalline semiconductors, and high-k dielectrics (a-Si, TiO2, Ta2O5, SiNx).
 *
 * Parameters:
 *   eps_inf: high-frequency dielectric constant (>= 1.0)
 *   A: transition matrix element / amplitude (eV)
 *   E0: peak transition energy (eV)
 *   C: broadening term (eV)
 *   Eg: optical bandgap (eV)
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';
import { wavelengthNmToEnergyEv, dielectricToRefractiveIndex } from './base';
import { kkReal } from './kk';
const kkCache = new Map<string, number>();

export function computeTaucLorentzEps2(
  E: number,
  A: number,
  E0: number,
  C: number,
  Eg: number
): number {
  if (E <= Eg) return 0;
  const num = A * E0 * C * Math.pow(E - Eg, 2);
  const den = Math.pow(E * E - E0 * E0, 2) + C * C * E * E;
  return num / den / E;
}

export function computeTaucLorentzEps1(
  E: number,
  A: number,
  E0: number,
  C: number,
  Eg: number
): number {
  if (A <= 0 || C <= 0) return 0;
  const key=[E,E0,C,Eg].join('|');
  let unit=kkCache.get(key);
  if(unit===undefined) {
    unit=kkReal(E, x=>computeTaucLorentzEps2(x,1,E0,C,Eg),[Eg,E0-C,E0,E0+C,E0+6*C]);
    if(kkCache.size>=8192)kkCache.delete(kkCache.keys().next().value!);
    kkCache.set(key,unit);
  }
  return A*unit;
}

export const TaucLorentzModel: ModelDefinition = {
  id: 'tauc_lorentz',
  name: 'Tauc-Lorentz Oscillator',
  type: 'oscillator',
  category: 'oscillator',
  description: 'Physical model combining Tauc joint density of states at band edge with Lorentz oscillator for interband transitions.',
  reference: 'Jellison, G. E., & Sales, B. C. (1996). Optical functions of amorphous semiconductors using Tauc-Lorentz model. Appl. Phys. Lett., 69(3), 371-373.',
  equation: 'ε₂(E) = [A·E₀·C·(E-Eg)² / ((E²-E₀²)² + C²E²)] · (1/E) for E > Eg; ε₁(E) via Kramers-Kronig',
  equationDoc: 'ε₂(E) = [A·E₀·C·(E-Eg)² / ((E²-E₀²)² + C²E²)] · (1/E) for E > Eg; ε₁(E) via Kramers-Kronig',
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
      description: 'Dielectric constant limit at very high energy',
      defaultValue: 1.8,
      min: 1.0,
      max: 15.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'A',
      name: 'Oscillator #1 Amplitude (A₁)',
      symbol: 'A₁',
      unit: 'eV',
      description: 'Tauc-Lorentz oscillator #1 amplitude',
      defaultValue: 120.0,
      min: 1.0,
      max: 600.0,
      step: 1.0,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'E0',
      name: 'Oscillator #1 Peak Energy (E₀₁)',
      symbol: 'E₀₁',
      unit: 'eV',
      description: 'Resonant peak energy of electronic transition for oscillator #1',
      defaultValue: 3.65,
      min: 0.5,
      max: 15.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'C',
      name: 'Oscillator #1 Broadening (C₁)',
      symbol: 'C₁',
      unit: 'eV',
      description: 'Damping / broadening parameter for oscillator #1',
      defaultValue: 1.5,
      min: 0.05,
      max: 6.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'Eg',
      name: 'Optical Bandgap (E_g)',
      symbol: 'E_g',
      unit: 'eV',
      description: 'Fundamental optical absorption onset threshold',
      defaultValue: 3.1,
      min: 0.2,
      max: 11.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'A2',
      name: 'Oscillator #2 Amplitude (A₂)',
      symbol: 'A₂',
      unit: 'eV',
      description: 'Tauc-Lorentz oscillator #2 amplitude',
      defaultValue: 0.0,
      min: 0.0,
      max: 600.0,
      step: 1.0,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'E02',
      name: 'Oscillator #2 Peak Energy (E₀₂)',
      symbol: 'E₀₂',
      unit: 'eV',
      description: 'Resonant peak energy of electronic transition for oscillator #2',
      defaultValue: 4.8,
      min: 0.5,
      max: 15.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'C2',
      name: 'Oscillator #2 Broadening (C₂)',
      symbol: 'C₂',
      unit: 'eV',
      description: 'Damping / broadening parameter for oscillator #2',
      defaultValue: 1.8,
      min: 0.05,
      max: 6.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'A3',
      name: 'Oscillator #3 Amplitude (A₃)',
      symbol: 'A₃',
      unit: 'eV',
      description: 'Tauc-Lorentz oscillator #3 amplitude',
      defaultValue: 0.0,
      min: 0.0,
      max: 600.0,
      step: 1.0,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'E03',
      name: 'Oscillator #3 Peak Energy (E₀₃)',
      symbol: 'E₀₃',
      unit: 'eV',
      description: 'Resonant peak energy of electronic transition for oscillator #3',
      defaultValue: 5.8,
      min: 0.5,
      max: 15.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: false,
    },
    {
      id: 'C3',
      name: 'Oscillator #3 Broadening (C₃)',
      symbol: 'C₃',
      unit: 'eV',
      description: 'Damping / broadening parameter for oscillator #3',
      defaultValue: 2.0,
      min: 0.05,
      max: 6.0,
      step: 0.02,
      fitSupported: true,
      isFittingCandidate: false,
    },
  ],
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const E = Math.max(1e-4, wavelengthNmToEnergyEv(wavelengthNm));
    const epsInf = params['eps_inf'] ?? 1.8;
    const Eg = Math.max(0.1, params['Eg'] ?? 3.1);

    const A1 = params['A1'] ?? params['A'] ?? 120.0;
    const E01 = Math.max(Eg + 0.05, params['E01'] ?? params['E0'] ?? 3.65);
    const C1 = Math.max(1e-3, params['C1'] ?? params['C'] ?? 1.5);

    const A2 = params['A2'] ?? 0;
    const E02 = Math.max(Eg + 0.05, params['E02'] ?? 4.8);
    const C2 = Math.max(1e-3, params['C2'] ?? 1.8);

    const A3 = params['A3'] ?? 0;
    const E03 = Math.max(Eg + 0.05, params['E03'] ?? 5.8);
    const C3 = Math.max(1e-3, params['C3'] ?? 2.0);

    let eps2 = 0;
    let eps1 = epsInf;

    const addTL = (A: number, E0: number, C: number) => {
      if (A <= 0.01) return;
      eps2 += computeTaucLorentzEps2(E, A, E0, C, Eg);
      eps1 += computeTaucLorentzEps1(E, A, E0, C, Eg);
    };

    addTL(A1, E01, C1);
    addTL(A2, E02, C2);
    addTL(A3, E03, C3);

    return { eps1, eps2: Math.max(0, eps2) };
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const { eps1, eps2 } = TaucLorentzModel.calculateEpsilon(wavelengthNm, params);
    return dielectricToRefractiveIndex(eps1, eps2);
  },
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    return TaucLorentzModel.calculate(wavelengthNm, params).n;
  },
  calculateK: (wavelengthNm: number, params: Record<string, number>): number => {
    return TaucLorentzModel.calculate(wavelengthNm, params).k;
  },
};
