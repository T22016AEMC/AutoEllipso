/**
 * Fresnel Reflection and Transmission Coefficients for a single optical interface
 */
import { Complex } from './complex';

export interface FresnelResult {
  rp: Complex;
  rs: Complex;
  tp: Complex;
  ts: Complex;
  cosTheta0: Complex;
  cosTheta1: Complex;
}

/**
 * Calculate single-interface Fresnel coefficients
 * @param N0 Complex refractive index of incident medium
 * @param N1 Complex refractive index of transmitting medium
 * @param theta0Rad Angle of incidence in radians
 */
export function calculateFresnelInterface(
  N0: Complex,
  N1: Complex,
  theta0Rad: number
): FresnelResult {
  const sinTheta0 = Math.sin(theta0Rad);
  const cosTheta0 = new Complex(Math.cos(theta0Rad), 0);

  // Snell's Law in complex form: N0 * sinTheta0 = N1 * sinTheta1
  // sinTheta1 = (N0 / N1) * sinTheta0
  const sinTheta1 = N0.div(N1).mul(sinTheta0);
  const sinSqTheta1 = sinTheta1.mul(sinTheta1);

  // cosTheta1 = sqrt(1 - sin^2(theta1)) with Re(cosTheta1) >= 0
  let cosTheta1 = Complex.ONE.sub(sinSqTheta1).sqrt();
  if (cosTheta1.re < 0) {
    cosTheta1 = cosTheta1.neg();
  }

  // s-polarization (TE):
  // rs = (N0 * cosTheta0 - N1 * cosTheta1) / (N0 * cosTheta0 + N1 * cosTheta1)
  const N0_cos0 = N0.mul(cosTheta0);
  const N1_cos1 = N1.mul(cosTheta1);
  const rs = N0_cos0.sub(N1_cos1).div(N0_cos0.add(N1_cos1));
  const ts = N0_cos0.mul(2).div(N0_cos0.add(N1_cos1));

  // p-polarization (TM):
  // rp = (N1 * cosTheta0 - N0 * cosTheta1) / (N1 * cosTheta0 + N0 * cosTheta1)
  const N1_cos0 = N1.mul(cosTheta0);
  const N0_cos1 = N0.mul(cosTheta1);
  const rp = N1_cos0.sub(N0_cos1).div(N1_cos0.add(N0_cos1));
  const tp = N0_cos0.mul(2).div(N1_cos0.add(N0_cos1));

  return { rp, rs, tp, ts, cosTheta0, cosTheta1 };
}
