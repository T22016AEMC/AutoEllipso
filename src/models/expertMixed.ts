import { ModelDefinition, OpticalConstants } from '../types/ellipsometry';
import { computeGaussianEps1, computeGaussianEps2 } from './gaussian';
import { computeTaucLorentzEps1, computeTaucLorentzEps2 } from './taucLorentz';
import { wavelengthNmToEnergyEv, dielectricToRefractiveIndex } from './base';
import { cubicEvaluate } from './cubicSpline';
export const peakTypes = ['Gaussian','Lorentz','Tauc-Lorentz','Drude','Free B-spline Local Correction'] as const;
export function mixedOptics(wavelength:number,p:Record<string,number>):OpticalConstants {
  const E=wavelengthNmToEnergyEv(wavelength); let eps1=p.eps_inf??2.25,eps2=0;
  const count=p._knotCount??8;
  const grid=Array.from({length:count},(_,i)=>p[`_knot${i}`]);
  // Retain a manual n/k baseline exactly when entering the builder. This
  // numerical epsilon contribution is explicitly separate from causal peaks.
  if(p._baseEnabled) {
    const n=cubicEvaluate(wavelength,grid,grid.map((_,i)=>p[`base_N${i}`])),k=cubicEvaluate(wavelength,grid,grid.map((_,i)=>p[`base_K${i}`]));
    eps1+=n*n-k*k-(p._baseRef??0);eps2=2*n*k;
  }
  for(let i=0;i<(p._peakCount??0);i++) {
    if(!p[`p${i}_enabled`]) continue;
    const get=(key:string,fallback:number)=>p[`p${i}_${key}`]??fallback;
    const A=get('A',0),E0=get('E0',3),w=get('w',0.5),type=get('type',0);
    if(type===0) {eps1+=computeGaussianEps1(E,0,A,E0,w); eps2+=computeGaussianEps2(E,A,E0,w);}
    if(type===1) {const diff=E0*E0-E*E,den=diff*diff+w*w*E*E; eps1+=A*E0*diff/den;eps2+=A*E0*w*E/den;}
    if(type===2) {const Eg=get('Eg',1); eps1+=computeTaucLorentzEps1(E,A,E0,w,Eg);eps2+=computeTaucLorentzEps2(E,A,E0,w,Eg);}
    if(type===3) {eps1-=A*A/(E*E+w*w); eps2+=A*A*w/(E*(E*E+w*w));}
    // Free correction is separate, applied below in epsilon; no causal claim.
  }
  for(let j=0;j<(p._peakCount??0);j++) if(p[`p${j}_enabled`] && p[`p${j}_type`]===4) {
    eps1+=cubicEvaluate(wavelength,grid,grid.map((_,i)=>p[`p${j}_R${i}`]??0));
    eps2+=cubicEvaluate(wavelength,grid,grid.map((_,i)=>p[`p${j}_I${i}`]??0));
  }
  if(!Number.isFinite(eps1)||!Number.isFinite(eps2)||eps2 < -1e-10) throw new Error('Invalid or active dielectric response; adjust free correction');
  return dielectricToRefractiveIndex(eps1,Math.max(0,eps2));
}
export const ExpertMixedModel:ModelDefinition = {
  id:'expert_mixed',name:'Expert mixed dielectric response',type:'oscillator',
  description:'Mixed causal oscillators plus explicitly noncausal free dielectric spline corrections',
  reference:'Lorentz/Drude analytic susceptibilities; Gaussian Hilbert transform; Tauc-Lorentz Jellison–Modine analytic expression',
  equation:'epsilon = epsilon_inf + sum(chi_j) + free_delta_epsilon',parameters:[],
  validRange:{minWavelengthNm:150,maxWavelengthNm:2500},version:'2.0.0',fitSupported:true,isVerified:false,
  calculate:mixedOptics,calculateN:(w,p)=>mixedOptics(w,p).n,calculateK:(w,p)=>mixedOptics(w,p).k,
  calculateEpsilon:(w,p)=>{const o=mixedOptics(w,p);return {eps1:o.eps1!,eps2:o.eps2!};}
};
