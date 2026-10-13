/**
 * Standard Optical Materials Library and Tabulated Refractive Indices
 * Grounded in authentic scientific literature (Aspnes & Studna 1983, Palik, Green 2008).
 */
import { OpticalConstants } from '../types/ellipsometry';

// Reference Silicon (c-Si) data points: [wavelength_nm, n, k]
// Standard Herzinger / Aspnes & Studna / Palik spectroscopic ellipsometry reference (190 nm - 1000 nm)
export const SI_SUBSTRATE_DATA: [number, number, number][] = [
  [190, 0.90, 2.45],
  [200, 1.02, 2.68],
  [210, 1.18, 2.92],
  [220, 1.34, 3.16],
  [230, 1.45, 3.34],
  [240, 1.51, 3.48],
  [250, 1.57, 3.56],
  [275, 2.05, 4.41],
  [300, 3.51, 5.28],
  [325, 5.04, 3.42],
  [350, 5.56, 3.01],
  [365, 6.52, 2.69],
  [375, 6.01, 1.34],
  [400, 5.57, 0.38],
  [425, 4.95, 0.20],
  [450, 4.67, 0.13],
  [475, 4.46, 0.089],
  [500, 4.29, 0.065],
  [525, 4.17, 0.049],
  [550, 4.08, 0.038],
  [575, 4.00, 0.030],
  [600, 3.94, 0.024],
  [632.8, 3.88, 0.019],
  [650, 3.85, 0.016],
  [700, 3.78, 0.012],
  [750, 3.73, 0.009],
  [800, 3.69, 0.006],
  [850, 3.65, 0.004],
  [900, 3.63, 0.002],
  [950, 3.60, 0.001],
  [1000, 3.58, 0.0005],
];

// Linear interpolation helper
export function interpolateOpticalData(
  table: [number, number, number][],
  targetWavelength: number
): OpticalConstants {
  if (table.length === 0) return { n: 1, k: 0 };
  if (targetWavelength <= table[0][0]) {
    return { n: table[0][1], k: table[0][2] };
  }
  if (targetWavelength >= table[table.length - 1][0]) {
    const last = table[table.length - 1];
    return { n: last[1], k: last[2] };
  }

  // Find interval
  for (let i = 0; i < table.length - 1; i++) {
    const [w0, n0, k0] = table[i];
    const [w1, n1, k1] = table[i + 1];
    if (targetWavelength >= w0 && targetWavelength <= w1) {
      const t = (targetWavelength - w0) / (w1 - w0);
      const n = n0 + t * (n1 - n0);
      const k = k0 + t * (k1 - k0);
      return { n, k };
    }
  }

  return { n: table[0][1], k: table[0][2] };
}

/**
 * Silicon (c-Si) optical constants lookup
 */
export function getSiliconOpticalConstants(wavelengthNm: number): OpticalConstants {
  return interpolateOpticalData(SI_SUBSTRATE_DATA, wavelengthNm);
}

/**
 * Standard Glass / Quartz substrate
 */
export function getGlassOpticalConstants(wavelengthNm: number): OpticalConstants {
  // Schott BK7 Sellmeier approximation
  const um = wavelengthNm / 1000;
  const umSq = um * um;
  const nSq = 1 + (1.03961212 * umSq) / (umSq - 0.00600069867) + (0.231792344 * umSq) / (umSq - 0.0200179144) + (1.01046945 * umSq) / (umSq - 103.560653);
  return { n: Math.sqrt(Math.max(1.0, nSq)), k: 0 };
}
