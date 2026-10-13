/**
 * Drude Model for Free Carrier Absorption
 * Standard model for metals, transparent conducting oxides (ITO, AZO), and heavily doped semiconductors.
 *
 * Equation:
 *   ε(E) = ε_∞ - ω_p² / (E² + i·Γ·E)
 *   where:
 *     ω_p is the plasma energy (eV)
 *     Γ is the carrier collision / damping rate (eV)
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';
import { wavelengthNmToEnergyEv, dielectricToRefractiveIndex } from './base';

export const DrudeModel: ModelDefinition = {
  id: 'drude',
  name: 'Drude Free Carrier',
  type: 'oscillator',
  category: 'oscillator',
  description: 'Free electron gas response for conducting materials, metallic thin films, and plasmonic layers.',
  reference: 'Drude, P. (1900). Zur Elektronentheorie der Metalle. Annalen der Physik, 306(3), 566-613.',
  equation: 'ε(E) = ε_∞ - ω_p² / (E² + i·Γ·E)',
  equationDoc: 'ε(E) = ε_∞ - ω_p² / (E² + i·Γ·E)',
  validRange: {
    minWavelengthNm: 250,
    maxWavelengthNm: 3000,
    minEnergyEv: 0.4,
    maxEnergyEv: 5.0,
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
      description: 'Dielectric background of bound core electrons',
      defaultValue: 3.5,
      min: 1.0,
      max: 15.0,
      step: 0.1,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'wp',
      name: 'Plasma Energy (ω_p)',
      symbol: 'ω_p',
      unit: 'eV',
      description: 'Plasma frequency expressed in energy units (carrier density indicator)',
      defaultValue: 2.1,
      min: 0.1,
      max: 15.0,
      step: 0.05,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'gamma',
      name: 'Carrier Damping (Γ)',
      symbol: 'Γ',
      unit: 'eV',
      description: 'Scattering rate inversely proportional to carrier mobility and relaxation time',
      defaultValue: 0.15,
      min: 0.005,
      max: 2.5,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: true,
    },
  ],
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const E = Math.max(1e-3, wavelengthNmToEnergyEv(wavelengthNm));
    const epsInf = params['eps_inf'] ?? 3.5;
    const wp = params['wp'] ?? 2.1;
    const gamma = Math.max(1e-4, params['gamma'] ?? 0.15);

    const wpSq = wp * wp;
    const denom = E * E + gamma * gamma;

    const eps1 = epsInf - wpSq / denom;
    const eps2 = (wpSq * gamma) / (E * denom);

    return { eps1, eps2 };
  },
  calculate: (wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const { eps1, eps2 } = DrudeModel.calculateEpsilon(wavelengthNm, params);
    return dielectricToRefractiveIndex(eps1, eps2);
  },
  calculateN: (wavelengthNm: number, params: Record<string, number>): number => {
    return DrudeModel.calculate(wavelengthNm, params).n;
  },
  calculateK: (wavelengthNm: number, params: Record<string, number>): number => {
    return DrudeModel.calculate(wavelengthNm, params).k;
  },
};
