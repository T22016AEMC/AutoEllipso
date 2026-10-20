import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {Complex} from '../src/optics/complex';
import {modelRegistry} from '../src/modelRegistry/registry';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
export type Scenario='absorbing'|'transparent'|'weak';
export const trueN=(w:number)=>1.6+.01/(w/1000)**2;
export const trueK=(scenario:Scenario,w:number)=>scenario==='transparent'?0:scenario==='weak'?.003:.02*(400/w)**4;
export function stage41Fixture(scenario:Scenario) {
  const project=createMultiAoiSiO2OnSiProject();let seed=41001;
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
  const points=[];
  for(const aoi of [65,70,75])for(let wavelength=190;wavelength<=900;wavelength+=10) {
    const sub=modelRegistry.get(project.substrate.modelId!)!.calculate(wavelength,Object.fromEntries(Object.entries(project.substrate.parameters).map(([key,v])=>[key,v.current])));
    const calc=solveEllipsometryTMM(new Complex(1,0),[{thicknessNm:100,N:new Complex(trueN(wavelength),trueK(scenario,wavelength))}],new Complex(sub.n,sub.k),wavelength,aoi);
    const radius=Math.sqrt(-2*Math.log(rng())),angle=2*Math.PI*rng();
    points.push({id:`${aoi}-${wavelength}`,wavelength,aoi,psiExp:calc.psiDeg+.03*radius*Math.cos(angle),
      deltaExp:normalizeDeltaDeg(calc.deltaDeg+.03*radius*Math.sin(angle)),psiSigma:.03,deltaSigma:.03});
  }
  return {project,points};
}
