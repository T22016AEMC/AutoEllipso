/**
 * 內部 N = n + ik、exp(−iωt)；ρ = rp/rs = tanΨ·exp(−iΔ)；輸出 Δ = −arg(ρ)，
 * 符合 Woollam/Horiba/Fujiwara 量測慣例。正入射 Δ = 180°；Si 上薄氧化層 Δ 隨膜厚自 180° 往下降。
 */
import { Complex } from '../optics/complex';

export function normalizeDeltaDeg(d: number): number {
  // Equivalent to ((d % 360) + 360) % 360; preserve in-range measurement precision.
  if (d >= 0 && d < 360) return d === 0 ? 0 : d;
  return ((d % 360) + 360) % 360;
}

export function psiDeltaFromRho(rho: Complex): { psiDeg: number; deltaDeg: number } {
  return {
    psiDeg: Math.atan(rho.abs()) * 180 / Math.PI,
    deltaDeg: normalizeDeltaDeg(-rho.arg() * 180 / Math.PI),
  };
}
