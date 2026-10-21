import assert from 'node:assert/strict';
import {modelRegistry} from '../src/modelRegistry/registry';
import {centralDifferenceJacobian} from '../src/fitting/optimizer';

export async function stage44cTests(test:(name:string,fn:()=>void|Promise<void>)=>Promise<void>) {
 for(const id of ['gaussian','lorentz','tauc_lorentz','multi_oscillator']) {
  await test(`Stage4.4c: ${id} zero amplitude and continuous oscillator activation`,()=>{
   const model=modelRegistry.get(id)!;
   const params=Object.fromEntries(Object.entries(modelRegistry.createParameterSet(id)).map(([k,p])=>[k,p.current]));
   const amplitudes=id==='multi_oscillator'?['A1','A2','A3']:['A','A2','A3'];
   amplitudes.forEach(k=>params[k]=0);
   for(let w=190;w<=900;w+=10) {
    const zero=model.calculateEpsilon!(w,params);
    assert.ok(Math.abs(zero.eps1-params.eps_inf)<=1e-12&&Math.abs(zero.eps2)<=1e-12);
    for(const key of amplitudes) {
     const unit=model.calculateEpsilon!(w,{...params,[key]:1});
     for(const a of [1e-8,1e-5,.001,.001001,1]) {
      const e=model.calculateEpsilon!(w,{...params,[key]:a});
      for(const component of ['eps1','eps2'] as const) {
       const expected=zero[component]+a*(unit[component]-zero[component]);
       assert.ok(Number.isFinite(e[component])&&Math.abs(e[component]-expected)<=1e-12*Math.max(1,Math.abs(expected)),`${id} ${key} ${w} ${a} ${component}`);
      }
     }
    }
   }
   // Exercise the unchanged optimizer's actual one-sided difference at A=0.
   for(const key of amplitudes) {
    const J=centralDifferenceJacobian([{id:key,name:key,value:0,min:0,max:100}],[0],p=>{
     const e=model.calculateEpsilon!(350,{...params,[key]:p[0]});return [e.eps1,e.eps2];
    },()=>false);
    assert.ok(Math.hypot(J[0][0],J[1][0])>1e-8,`${id} ${key} derivative must be visible at zero`);
   }
  });
 }
}
