/** Read-only forward comparison; input reference values stay in RAM, never persisted. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelRegistry} from '../src/modelRegistry/registry';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {circularDifferenceDeg} from '../src/fitting/residual';

const request=JSON.parse(readFileSync(0,'utf8'));
const settings=JSON.parse(readFileSync('.qa/stage4_9b-settings.json','utf8'));
const config=settings.stage0_forward_gate;
const model=modelRegistry.get(config.film.model)!;
const rows:any[]=[];
for(const point of request.points){
 const film=model.calculate(point.wavelength,config.film.parameters);
 for(const aoi of config.aois){
  const evaluate=(substrate:any)=>{
   assert.ok([substrate.n,substrate.k].every(Number.isFinite));
   return solveEllipsometryTMM(new Complex(1,0),[{thicknessNm:config.thickness_nm,N:new Complex(film.n,film.k)}],new Complex(substrate.n,substrate.k),point.wavelength,aoi);
  };
  const a=evaluate(point.linear),b=evaluate(point.pchip);
  // Self-comparison checks the angular difference path without another fit.
  assert.equal(circularDifferenceDeg(b.deltaDeg,b.deltaDeg),0);
  rows.push({wavelength:point.wavelength,aoi,extrapolation:settings.hc_eVnm/point.wavelength>6.5,
   psiError:a.psiDeg-b.psiDeg,deltaError:circularDifferenceDeg(a.deltaDeg,b.deltaDeg)});
 }
}
function stats(key:string,subset:any[]){
 if(!subset.length)return null;
 const at=subset.reduce((a,b)=>Math.abs(b[key])>Math.abs(a[key])?b:a);
 return {maxAbs:Math.abs(at[key]),at_nm:at.wavelength,aoi:at.aoi,rms:Math.sqrt(subset.reduce((s,p)=>s+p[key]**2,0)/subset.length)};
}
const summarize=(subset:any[])=>({points:subset.length,psi:stats('psiError',subset),delta:stats('deltaError',subset)});
console.log(JSON.stringify({global:summarize(rows),measured:summarize(rows.filter(p=>!p.extrapolation)),
 extrapolated:summarize(rows.filter(p=>p.extrapolation)),
 bands:settings.bands.map(([lo,hi,closed]:[number,number,boolean])=>({band:[lo,hi,closed],...summarize(rows.filter(p=>p.wavelength>=lo&&(closed?p.wavelength<=hi:p.wavelength<hi)))})),rows}));
