import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {modelRegistry} from '../src/modelRegistry/registry';
import {getSiliconOpticalConstants} from '../src/optics/materials';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';

/** Test-only substrate. Never registered as a selectable material. */
export function perturbedSilicon(wavelength:number) {
  const base=getSiliconOpticalConstants(wavelength),factor=1+.02*Math.exp(-(((wavelength-300)/25)**2));
  return {n:base.n*factor,k:base.k*factor};
}
export const v2Values={eps_inf:2.35,A:1.65,E0:2.85,sigma:.37,A2:0,E02:4.8,sigma2:.6,A3:0,E03:5.8,sigma3:.7};
export function synthetic(modelId:string,values:Record<string,number>,thickness:number,seed:number,perturbed=false) {
  const project=createMultiAoiSiO2OnSiProject(),layer=project.layers[0];
  layer.modelId=modelId;layer.parameters=modelRegistry.createParameterSet(modelId);
  for(const [key,value] of Object.entries(values))layer.parameters[key].current=value;
  layer.thickness=layer.thicknessInitial=thickness;
  layer.thicknessMin=1;layer.thicknessMax=500;
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
  const points=[],optics=[];
  const model=modelRegistry.get(modelId)!;
  const parameters=Object.fromEntries(Object.entries(layer.parameters).map(([k,v])=>[k,v.current]));
  for(const aoi of [65,70,75])for(let wavelength=190;wavelength<=900;wavelength+=10){
    const nk=model.calculate(wavelength,parameters),si=perturbed?perturbedSilicon(wavelength):getSiliconOpticalConstants(wavelength);
    const c=solveEllipsometryTMM(new Complex(project.ambient.n,project.ambient.k),[{thicknessNm:thickness,N:new Complex(nk.n,nk.k)}],new Complex(si.n,si.k),wavelength,aoi);
    const r=Math.sqrt(-2*Math.log(rng())),theta=2*Math.PI*rng();
    points.push({id:`${aoi}-${wavelength}`,wavelength,aoi,psiExp:c.psiDeg+.03*r*Math.cos(theta),deltaExp:normalizeDeltaDeg(c.deltaDeg+.03*r*Math.sin(theta)),psiSigma:.03,deltaSigma:.03});
    if(aoi===65)optics.push({wavelength,n:nk.n,k:nk.k});
  }
  return {project,points,optics,truthThickness:thickness,substrateGeneration:perturbed?'deterministically perturbed Si':'self-consistent Si'};
}
