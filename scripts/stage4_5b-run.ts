import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {solveLeastSquaresSvd} from '../src/fitting/svd';
import {cubicBasis} from '../src/models/cubicSpline';
import {base,prepare,runtime,makeFixture,save,read,exists,path,analyze,problem,statistics,refit,regrid,correlations} from './stage4_5b-support';
assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');
assert.equal(execFileSync('git',['diff',base,'--','src'],{encoding:'utf8'}),'');
const id=process.argv[2],mode=process.argv[3]??'core';
if(id==='prepare'){prepare();console.log('Prepared read-only capture and isolated 48-coefficient diagnostic model');}
else {
 assert.ok(['T0','T1','T2','T3','T4'].includes(id));
 const rt=await runtime(),f=makeFixture(id);
 if(mode==='core') {
  save(id+'-fixture',{truth:f.truth,parameters:f.values,points:f.points,optics:f.optics,seed:45001});
  for(const fixed of [undefined,100,99,101,97,103]) {
   const label=fixed===undefined?'free':'fixed'+fixed,name=id+'-'+label;
   if(exists(name)){console.log('REUSE '+name);continue;}
   console.log('START '+name);rt.workflow.setDiagnosticThickness(fixed);rt.workflow.diagnosticCalls.length=0;
   const start=performance.now(),capture=await rt.workflow.runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:id==='T0'?'gaussian':f.truth.model,selectedAois:[65,70,75]});
   const summary=analyze(capture,rt,f.optics),chosen=capture.history.find((s:any)=>s.selected),call=capture.calls.find((c:any)=>c.result.finalParams.length===capture.params.length&&c.result.finalParams.every((p:number,i:number)=>p===capture.params[i]));
   assert.ok(call,'Selected stage capture');assert.equal(call.points,216);
   assert.ok(Math.abs(summary.dataCost-call.result.finalWeightedCost)<1e-9*Math.max(1,summary.dataCost),'Reconstructed objective agrees with captured production residual');
   assert.ok(Math.abs(summary.regularizationCost-call.result.finalRegularizationPenalty)<1e-9*Math.max(1,summary.regularizationCost),'Reconstructed regularization agrees');
   let readOnlyComparison:any;
   if(fixed===undefined&&id!=='T0'&&existsSync(`.qa/stage4_5-${id}.json`)) {
    const previous=JSON.parse(readFileSync(`.qa/stage4_5-${id}.json`,'utf8'));
    assert.deepEqual(f.points,previous.points,'Exact Stage4.5 dataset and seed');
    const old=previous.output.fittingResult;
    const maxNk=Math.max(...capture.curve.flatMap((p:any,i:number)=>['n','k','kSigma'].map(k=>Math.abs(p[k]-old.freeFormOpticalConstants[i][k]))));
    assert.equal(maxNk,0,'Read-only normal result and isolated 48 cap leave <=40 calculation unchanged');
    assert.equal(capture.params[0],old.freeFormModel.layers[0].thickness);
    readOnlyComparison={maxNkSigmaDifference:maxNk,thicknessIdentical:true,pointsIdentical:true};
   }
   const extra=fixed===undefined?{
    jacobianCorrelations:correlations(capture,rt),
    conditionalAtSamePoint:analyze(capture,rt,f.optics,statistics(capture,rt,true)),
   }:{};
   save(name,{id,label,fixed,elapsedMs:performance.now()-start,summary,chosen,capture,readOnlyComparison,...extra});
   console.log('RESULT '+JSON.stringify({name,knots:summary.knots,mse:summary.mseWoollam,thickness:summary.thickness,coverage:summary.coverage,status:chosen.status,bounds:summary.bounds}));
  }
 } else {
  const original=read(id+'-free').capture;
  if(mode==='projection') {
   const name=id+'-projection',c=structuredClone(original),basis=f.optics.map(t=>cubicBasis(t.wavelength,c.knots));
   const n=solveLeastSquaresSvd(basis,f.optics.map(t=>t.n)),k=solveLeastSquaresSvd(basis,f.optics.map(t=>t.k));
   const raw=[100,...n.solution,...k.solution];let clipped=0;
   c.params=raw.map((v,i)=>{if(i===0)return v;const b=c.variables[i],value=Math.max(b.min,Math.min(b.max,v));if(value!==v)clipped++;return value;});
   assert.ok(c.params.every((v:number,i:number)=>v>=c.variables[i].min&&v<=c.variables[i].max),'Candidate is feasible in the original free-d parameter box');
   c.variables[0]={...c.variables[0],min:100,max:100,value:100};
   c.statistics=statistics(c,rt);const summary=analyze(c,rt,f.optics);
   save(name,{method:'Single optical-space least squares; clamp to original bounds; no Psi/Delta optimization',clipped,truncated:n.truncated+k.truncated,raw,summary,capture:c});
   console.log('PROJECTION '+JSON.stringify({id,clipped,mse:summary.mseWoollam,cost:summary.dataCost+summary.regularizationCost,nMax:summary.nMax,kMax:summary.kMax}));
  } else if(mode==='fixed-control') {
   for(const fixed of [undefined,97,99,100,101,103]) {
    const name=id+'-control'+(fixed??'Free');if(exists(name)){console.log('REUSE '+name);continue;}
    console.log('START '+name);const c=structuredClone(original);
    if(fixed!==undefined){c.params[0]=fixed;c.variables[0]={...c.variables[0],value:fixed,min:fixed,max:fixed};}
    const out=await refit(c,rt,f.optics,{iterations:22});save(name,out);
    console.log('RESULT '+JSON.stringify({name,...out.summary,iterations:out.result.iterations,status:out.result.status}));
   }
  } else if(mode==='refine') {
   assert.ok(['T2','T3'].includes(id));
   for(const iterations of [100,300]) {
    const name=id+'-refine'+iterations;if(exists(name)){console.log('REUSE '+name);continue;}
    console.log('START '+name);const out=await refit(original,rt,f.optics,{iterations});save(name,out);
    console.log('RESULT '+JSON.stringify({name,...out.summary,iterations:out.result.iterations,status:out.result.status}));
   }
  } else if(mode==='sensitivity') {
   assert.ok(['T2','T3'].includes(id));
   // 40 is already the formal maximum. The isolated +one-level experiment uses 48, not an extra formal ladder stage.
   const counts=[original.knots.length===40?32:original.knots.length-4,original.knots.length,original.knots.length===40?48:original.knots.length+4];
   for(const count of counts)for(const factor of [.1,1,10]) {
    const name=`${id}-sensitivity-${count}-${factor}`;if(exists(name)){console.log('REUSE '+name);continue;}
    console.log('START '+name);const c=regrid(original,rt,count),out=await refit(c,rt,f.optics,{iterations:22,factor});save(name,out);
    console.log('RESULT '+JSON.stringify({name,...out.summary,iterations:out.result.iterations,status:out.result.status}));
   }
  } else throw new Error('Unknown diagnostic mode '+mode);
 }
}
