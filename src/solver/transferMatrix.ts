/**
 * Multilayer Thin-Film Optical Solver
 * Implements the Characteristic Matrix Method / Transfer Matrix Method (TMM)
 * Internal N=n+ik, exp(-iωt); rho=tan(Psi)*exp(-i*Delta), Delta=-arg(rho).
 *
 * References:
 * - Azzam, R. M., & Bashara, N. M. (1977). Ellipsometry and Polarized Light.
 * - Macleod, H. A. (2017). Thin-film Optical Filters. CRC press.
 * - Born, M., & Wolf, E. (2013). Principles of Optics.
 */
import { Complex } from '../optics/complex';
import { psiDeltaFromRho } from './ellipsometricAngles';

export interface Matrix2x2 {
  m11: Complex;
  m12: Complex;
  m21: Complex;
  m22: Complex;
}

export interface LayerOpticalState {
  thicknessNm: number;
  N: Complex; // complex refractive index n + i*k
}

export interface SolverResult {
  rp: Complex;
  rs: Complex;
  rho: Complex;
  psiDeg: number;
  deltaDeg: number;
}

/**
 * 2x2 Complex Matrix multiplication: A * B
 */
function multiplyMatrix(A: Matrix2x2, B: Matrix2x2): Matrix2x2 {
  return {
    m11: A.m11.mul(B.m11).add(A.m12.mul(B.m21)),
    m12: A.m11.mul(B.m12).add(A.m12.mul(B.m22)),
    m21: A.m21.mul(B.m11).add(A.m22.mul(B.m21)),
    m22: A.m21.mul(B.m12).add(A.m22.mul(B.m22)),
  };
}

/**
 * Solve Transfer Matrix for an arbitrary stack of thin films
 *
 * @param ambientN Complex refractive index of ambient (typically 1.0 + 0i for air)
 * @param layers Array of layers in order from top (ambient interface) to bottom (substrate interface)
 * @param substrateN Complex refractive index of substrate
 * @param wavelengthNm Wavelength in nanometers
 * @param aoiDeg Angle of incidence in degrees
 */
export function solveEllipsometryTMM(
  ambientN: Complex,
  layers: LayerOpticalState[],
  substrateN: Complex,
  wavelengthNm: number,
  aoiDeg: number
): SolverResult {
  const theta0Rad = (aoiDeg * Math.PI) / 180.0;
  const sinTheta0 = Math.sin(theta0Rad);
  const cosTheta0 = new Complex(Math.cos(theta0Rad), 0);

  // Invariant from Snell's law: S0 = ambientN * sin(theta0)
  const S0 = ambientN.mul(sinTheta0);
  // With N=n+ik and exp(-i wt), forward waves decay as exp(+i beta).
  // Characteristic matrices therefore use -i off-diagonal entries.
  // Avoid cos/sin overflow for opaque films with the equivalent stable
  // bottom-up interface recursion, retaining the same solver API.
  if (layers.some(l => l.N.mul(l.N).sub(S0.mul(S0)).sqrt().im * 2*Math.PI*l.thicknessNm/wavelengthNm > 30)) {
    const films=layers.filter(l=>l.thicknessNm>0);
    const indices=[ambientN,...films.map(l=>l.N),substrateN];
    const q=indices.map(N=>N.mul(N).sub(S0.mul(S0)).sqrt());
    const reflect=(p:boolean):Complex=>{
      const eta=indices.map((N,i)=>p?N.mul(N).div(q[i]):q[i]);let r=Complex.ZERO;
      for(let i=indices.length-2;i>=0;i--) {
        const ri=eta[i].sub(eta[i+1]).div(eta[i].add(eta[i+1]));
        const phase=q[i+1].mul(2*Math.PI*(films[i]?.thicknessNm??0)/wavelengthNm);
        const wave=new Complex(-2*phase.im,2*phase.re).exp();const below=r.mul(wave);
        r=ri.add(below).div(Complex.ONE.add(ri.mul(below)));
      }
      return p?r.neg():r;
    };
    const rp=reflect(true),rs=reflect(false),rho=rp.div(rs);
    return {rp,rs,rho,...psiDeltaFromRho(rho)};
  }

  // Compute cosTheta for substrate
  // cosThetaSub = sqrt(1 - (S0 / substrateN)^2)
  const sinThetaSub = S0.div(substrateN);
  let cosThetaSub = Complex.ONE.sub(sinThetaSub.mul(sinThetaSub)).sqrt();
  if (cosThetaSub.re < 0) {
    cosThetaSub = cosThetaSub.neg();
  }

  // Substrate optical admittances
  // s-pol: eta_s = N * cos(theta)
  // p-pol: eta_p = N / cos(theta)
  const etaS_sub = substrateN.mul(cosThetaSub);
  const etaP_sub = substrateN.div(cosThetaSub);

  // Ambient optical admittances
  const etaS_0 = ambientN.mul(cosTheta0);
  const etaP_0 = ambientN.div(cosTheta0);

  // Identity characteristic matrices
  let Ms: Matrix2x2 = {
    m11: Complex.ONE,
    m12: Complex.ZERO,
    m21: Complex.ZERO,
    m22: Complex.ONE,
  };

  let Mp: Matrix2x2 = {
    m11: Complex.ONE,
    m12: Complex.ZERO,
    m21: Complex.ZERO,
    m22: Complex.ONE,
  };

  // Iterate through layers from top to bottom
  for (const layer of layers) {
    const d = layer.thicknessNm;
    if (d <= 0) continue; // Skip zero thickness layers

    const N = layer.N;
    // Compute cosTheta for this layer
    const sinThetaL = S0.div(N);
    let cosThetaL = Complex.ONE.sub(sinThetaL.mul(sinThetaL)).sqrt();
    if (cosThetaL.re < 0) {
      cosThetaL = cosThetaL.neg();
    }

    // Phase thickness delta = (2 * pi * d / lambda) * N * cosThetaL
    const phaseFactor = (2.0 * Math.PI * d) / wavelengthNm;
    const delta = N.mul(cosThetaL).mul(phaseFactor);

    const cosDelta = delta.cos();
    const sinDelta = delta.sin();

    // s-polarization characteristic matrix
    const etaS = N.mul(cosThetaL);
    // m12 = (i / eta) * sin(delta)
    const m12_s = Complex.I.neg().div(etaS).mul(sinDelta);
    // m21 = i * eta * sin(delta)
    const m21_s = Complex.I.neg().mul(etaS).mul(sinDelta);

    const layerMs: Matrix2x2 = {
      m11: cosDelta,
      m12: m12_s,
      m21: m21_s,
      m22: cosDelta,
    };
    Ms = multiplyMatrix(Ms, layerMs);

    // p-polarization characteristic matrix
    const etaP = N.div(cosThetaL);
    const m12_p = Complex.I.neg().div(etaP).mul(sinDelta);
    const m21_p = Complex.I.neg().mul(etaP).mul(sinDelta);

    const layerMp: Matrix2x2 = {
      m11: cosDelta,
      m12: m12_p,
      m21: m21_p,
      m22: cosDelta,
    };
    Mp = multiplyMatrix(Mp, layerMp);
  }

  // Calculate reflection coefficient for s-polarization:
  // [Bs, Cs]^T = Ms * [1, etaS_sub]^T
  const Bs = Ms.m11.add(Ms.m12.mul(etaS_sub));
  const Cs = Ms.m21.add(Ms.m22.mul(etaS_sub));
  // rs = (etaS_0 * Bs - Cs) / (etaS_0 * Bs + Cs)
  const numS = etaS_0.mul(Bs).sub(Cs);
  const denS = etaS_0.mul(Bs).add(Cs);
  const rs = numS.div(denS);

  // Calculate reflection coefficient for p-polarization:
  // [Bp, Cp]^T = Mp * [1, etaP_sub]^T
  const Bp = Mp.m11.add(Mp.m12.mul(etaP_sub));
  const Cp = Mp.m21.add(Mp.m22.mul(etaP_sub));
  // Standard ellipsometry sign convention (Azzam & Bashara / Nebraska Woollam):
  // rp = (Cp - etaP_0 * Bp) / (Cp + etaP_0 * Bp)
  // This ensures standard agreement with Fresnel rp = (N1 cos0 - N0 cos1)/(N1 cos0 + N0 cos1)
  const numP = Cp.sub(etaP_0.mul(Bp));
  const denP = Cp.add(etaP_0.mul(Bp));
  const rp = numP.div(denP);

  // Ellipsometric ratio rho = rp / rs = tan(Psi) * exp(-i * Delta)
  const rho = rp.div(rs);

  const { psiDeg, deltaDeg } = psiDeltaFromRho(rho);

  return {
    rp,
    rs,
    rho,
    psiDeg,
    deltaDeg,
  };
}
