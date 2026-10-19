/**
 * Tauc-Lorentz Dispersion Model
 * Jellison–Modine, APL 69, 371 (1996); erratum APL 69, 2137 (1996)
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
/** Strict boundary validation for persisted/user parameters; model evaluation projects trial values. */
export function validateTaucLorentzDomain(E0:number,C:number,Eg:number):void {
  if(![E0,C,Eg].every(Number.isFinite)||E0<=0||C<=0||C>=2*E0||Eg<0||Eg>=E0)
    throw new Error('Tauc-Lorentz requires E0 > Eg >= 0 and 0 < C < 2*E0');
}
export function safeTaucLorentzDomain(E0:number,C:number,Eg:number) {
  if(![E0,C,Eg].every(Number.isFinite)||E0<=0)throw new Error('Nonfinite or invalid Tauc-Lorentz parameters');
  return {E0,C:Math.max(1e-10,Math.min(C,2*E0*(1-1e-8))),Eg:Math.max(0,Math.min(Eg,E0*(1-1e-8)))};
}
export function validateTaucLorentzParameters(modelId:string,p:Record<string,number>):void {
  if(modelId==='tauc_lorentz')for(let i=1;i<=3;i++) {
    const suffix=i===1?'':String(i);
    if((p[i===1?'A1':'A'+suffix]??p['A'+suffix]??(i===1?120:0))>0)
      validateTaucLorentzDomain(p[i===1?'E01':'E0'+suffix]??p['E0'+suffix]??[0,3.65,4.8,5.8][i],p[i===1?'C1':'C'+suffix]??p['C'+suffix]??1.5,p.Eg??3.1);
  }
  if(modelId==='expert_mixed')for(let i=0;i<(p._peakCount??0);i++)if(p[`p${i}_enabled`]&&p[`p${i}_type`]===2)
    validateTaucLorentzDomain(p[`p${i}_E0`],p[`p${i}_w`],p[`p${i}_Eg`]);
  if(modelId==='multi_oscillator')for(let i=1;i<=3;i++)if(p[`osc${i}_type_code`]===3&&(p[`A${i}`]??0)>0)
    validateTaucLorentzDomain(p[`E0${i}`],p[`w${i}`],p[`Eg${i}`]??1);
}

export function computeTaucLorentzEps2(
  E: number,
  A: number,
  E0: number,
  C: number,
  Eg: number
): number {
  if(!Number.isFinite(E)||!Number.isFinite(A)||A<0)throw new Error('Invalid Tauc-Lorentz energy/amplitude');
  ({E0,C,Eg}=safeTaucLorentzDomain(E0,C,Eg));
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
  if(![E,A,E0,C,Eg].every(Number.isFinite)||E<0||A<0)throw new Error('Invalid Tauc-Lorentz energy/amplitude');
  if(A===0)return 0;
  ({E0,C,Eg}=safeTaucLorentzDomain(E0,C,Eg));
  const energy=Math.abs(E-Eg)<1e-9?Eg+1e-9:E;
  const g2=E0*E0-C*C/2,alpha=Math.sqrt(4*E0*E0-C*C),e2=energy*energy;
  const z4=(e2-g2)**2+alpha*alpha*C*C/4;
  const aln=(Eg*Eg-E0*E0)*e2+Eg*Eg*C*C-E0*E0*(E0*E0+3*Eg*Eg);
  const atan=(e2-E0*E0)*(E0*E0+Eg*Eg)+Eg*Eg*C*C;
  const logRatio=Math.log1p(2*alpha*Eg/(E0*E0+Eg*Eg-alpha*Eg));
  const t1=A*C/(Math.PI*z4)*aln/(2*alpha*E0)*logRatio;
  const t2=-A/(Math.PI*z4)*atan/E0*(Math.PI-Math.atan((2*Eg+alpha)/C)+Math.atan((-2*Eg+alpha)/C));
  const t3=2*A*E0/(Math.PI*z4*alpha)*Eg*(e2-g2)*(Math.PI+2*Math.atan(2*(g2-Eg*Eg)/(alpha*C)));
  const D=Math.hypot(E0*E0-Eg*Eg,Eg*C);
  let logs:number;
  if(Eg===0)logs=0;
  else if(energy<Eg*1e-4) {
    // Combined terms 4+5, with their removable zero-energy cancellation evaluated as a series.
    const x=energy/Eg,x2=x*x;
    logs=2*Eg*(1+Math.log(Eg*Eg/D)+x2/3+x2*x2/30);
  } else {
    const delta=Math.abs(energy-Eg),sum=energy+Eg;
    logs=-((energy-Eg)**2)/energy*Math.log(delta)+sum*sum/energy*Math.log(sum)-2*Eg*Math.log(D);
  }
  const result=t1+t2+t3+A*E0*C/(Math.PI*z4)*logs;
  if(!Number.isFinite(result))throw new Error('Nonfinite analytic Tauc-Lorentz epsilon1');
  return result;
}

export const TaucLorentzModel: ModelDefinition = {
  id: 'tauc_lorentz',
  name: 'Tauc-Lorentz Oscillator',
  type: 'oscillator',
  category: 'oscillator',
  description: 'Physical model combining Tauc joint density of states at band edge with Lorentz oscillator for interband transitions.',
  reference: 'Jellison, G. E., & Modine, F. A. (1996). Optical functions of amorphous semiconductors using Tauc-Lorentz model. Appl. Phys. Lett., 69(3), 371-373.',
  equation: 'ε₂(E) = [A·E₀·C·(E-Eg)² / ((E²-E₀²)² + C²E²)] · (1/E) for E > Eg; ε₁(E) via analytic Jellison–Modine expression (1996 erratum)',
  equationDoc: 'ε₂(E) = [A·E₀·C·(E-Eg)² / ((E²-E₀²)² + C²E²)] · (1/E) for E > Eg; ε₁(E) via analytic Jellison–Modine expression (1996 erratum)',
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
