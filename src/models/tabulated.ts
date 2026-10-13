/**
 * Tabulated & Constant Optical Material Model
 * Provides crystalline Silicon (Si), Glass (BK7), or constant (n, k) values.
 */
import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';
import { getSiliconOpticalConstants, getGlassOpticalConstants } from '../optics/materials';

export const TabulatedSiModel: ModelDefinition = {
  id: 'tabulated_si',
  name: 'Crystalline Silicon (c-Si)',
  type: 'tabulated',
  category: 'tabulated',
  description: 'Standard empirical optical constants for crystalline Silicon substrate (Aspnes & Studna, Green).',
  reference: 'Aspnes, D. E., & Studna, A. A. (1983). Dielectric functions and optical parameters of Si, Ge, GaP, GaAs, GaSb, InP, InAs, and InSb from 1.5 to 6.0 eV. Phys. Rev. B, 27(2), 985.',
  equation: 'Interpolated from empirical reference data table',
  equationDoc: 'Interpolated from empirical reference data table',
  validRange: {
    minWavelengthNm: 250,
    maxWavelengthNm: 1200,
    minEnergyEv: 1.0,
    maxEnergyEv: 5.0,
  },
  version: '1.0.0',
  fitSupported: false,
  isVerified: true,
  parameters: [],
  calculate: (wavelengthNm: number): OpticalConstants => {
    return getSiliconOpticalConstants(wavelengthNm);
  },
  calculateN: (wavelengthNm: number): number => {
    return getSiliconOpticalConstants(wavelengthNm).n;
  },
  calculateK: (wavelengthNm: number): number => {
    return getSiliconOpticalConstants(wavelengthNm).k;
  },
  calculateEpsilon: (wavelengthNm: number): { eps1: number; eps2: number } => {
    const { n, k } = getSiliconOpticalConstants(wavelengthNm);
    return {
      eps1: n * n - k * k,
      eps2: 2 * n * k,
    };
  },
};

export const TabulatedGlassModel: ModelDefinition = {
  id: 'tabulated_glass',
  name: 'Glass Substrate (Schott BK7)',
  type: 'tabulated',
  category: 'tabulated',
  description: 'Schott BK7 standard optical crown glass.',
  reference: 'Schott Optical Glass Catalog.',
  equation: 'Sellmeier formula for Schott BK7',
  equationDoc: 'Sellmeier formula for Schott BK7',
  validRange: {
    minWavelengthNm: 300,
    maxWavelengthNm: 2500,
    minEnergyEv: 0.5,
    maxEnergyEv: 4.1,
  },
  version: '1.0.0',
  fitSupported: false,
  isVerified: true,
  parameters: [],
  calculate: (wavelengthNm: number): OpticalConstants => {
    return getGlassOpticalConstants(wavelengthNm);
  },
  calculateN: (wavelengthNm: number): number => {
    return getGlassOpticalConstants(wavelengthNm).n;
  },
  calculateK: (wavelengthNm: number): number => {
    return getGlassOpticalConstants(wavelengthNm).k;
  },
  calculateEpsilon: (wavelengthNm: number): { eps1: number; eps2: number } => {
    const { n, k } = getGlassOpticalConstants(wavelengthNm);
    return {
      eps1: n * n - k * k,
      eps2: 2 * n * k,
    };
  },
};

export const ConstantModel: ModelDefinition = {
  id: 'constant_nk',
  name: 'Constant (n, k)',
  type: 'tabulated',
  category: 'tabulated',
  description: 'Wavelength-independent optical constants (useful for idealized substrate or ambient tests).',
  reference: 'Standard Idealized Medium.',
  equation: 'n(λ) = n₀, k(λ) = k₀',
  equationDoc: 'n(λ) = n₀, k(λ) = k₀',
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
      id: 'n',
      name: 'Refractive Index (n)',
      symbol: 'n',
      unit: '',
      description: 'Real part of refractive index',
      defaultValue: 1.5,
      min: 1.0,
      max: 10.0,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: true,
    },
    {
      id: 'k',
      name: 'Extinction Coefficient (k)',
      symbol: 'k',
      unit: '',
      description: 'Imaginary part of refractive index (absorption)',
      defaultValue: 0.0,
      min: 0.0,
      max: 10.0,
      step: 0.01,
      fitSupported: true,
      isFittingCandidate: true,
    },
  ],
  calculateN: (_wavelengthNm: number, params: Record<string, number>): number => {
    return Math.max(1.0, params['n'] ?? 1.5);
  },
  calculateK: (_wavelengthNm: number, params: Record<string, number>): number => {
    return Math.max(0.0, params['k'] ?? 0.0);
  },
  calculateEpsilon: (wavelengthNm: number, params: Record<string, number>): { eps1: number; eps2: number } => {
    const n = ConstantModel.calculateN(wavelengthNm, params);
    const k = ConstantModel.calculateK(wavelengthNm, params);
    return {
      eps1: n * n - k * k,
      eps2: 2 * n * k,
    };
  },
  calculate: (_wavelengthNm: number, params: Record<string, number>): OpticalConstants => {
    const n = Math.max(1.0, params['n'] ?? 1.5);
    const k = Math.max(0.0, params['k'] ?? 0.0);
    return {
      n,
      k,
      eps1: n * n - k * k,
      eps2: 2 * n * k,
    };
  },
};
