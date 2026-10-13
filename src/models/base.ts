/**
 * Fundamental Optical Model base functions and dielectric conversions
 */
import { OpticalConstants } from '../types/ellipsometry';
import { Complex } from '../optics/complex';

// Planck constant * speed of light in eV * nm: hc = 1239.841984... eV·nm
export const HC_EV_NM = 1239.841984;

/**
 * Convert wavelength in nm to photon energy in eV
 */
export function wavelengthNmToEnergyEv(lambdaNm: number): number {
  if (lambdaNm <= 0) return 0;
  return HC_EV_NM / lambdaNm;
}

/**
 * Convert photon energy in eV to wavelength in nm
 */
export function energyEvToWavelengthNm(energyEv: number): number {
  if (energyEv <= 0) return 0;
  return HC_EV_NM / energyEv;
}

/**
 * Convert complex dielectric function (eps1, eps2) to refractive index (n, k)
 * eps = (n + i*k)^2 = (n^2 - k^2) + i*(2*n*k)
 */
export function dielectricToRefractiveIndex(eps1: number, eps2: number): OpticalConstants {
  const norm = Math.hypot(eps1, eps2);
  const n = Math.sqrt(Math.max(0, (norm + eps1) / 2));
  const k = Math.sqrt(Math.max(0, (norm - eps1) / 2));
  return { n, k, eps1, eps2 };
}

/**
 * Convert refractive index (n, k) to complex dielectric function (eps1, eps2)
 */
export function refractiveIndexToDielectric(n: number, k: number): { eps1: number; eps2: number } {
  return {
    eps1: n * n - k * k,
    eps2: 2 * n * k,
  };
}

/**
 * Create a complex refractive index N = n + i*k
 */
export function toComplexIndex(opt: OpticalConstants): Complex {
  return new Complex(opt.n, opt.k);
}
