import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {settings,guard,save,fixture,prepare,runtime,control,cauchy,project,variables,finish} from './stage4_5c-support';
import {pointByPoint,selfCheck} from './stage4_5c-point';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
guard();
const id=process.argv[2],method=process.argv[3];
if(id==='check') {
 selfCheck();const knots=Array.from({length:40},(_,i)=>190+710*i/39),wavelengths=Array.from({length:72},(_,i)=>190+10*i);
 const constant=project(wavelengths,wavelengths.map(()=>1.5),knots);
 assert.ok(constant.solution.every(v=>Math.abs(v-1.5)<1e-10),'SVD projects constant spline without bias');
 // Reconstruct all completed objectives without fitting or changing saved results.
 const {load,splineProblem}=await import('./stage4_5c-support');
 for(const caseId of ['T0','T1','T2','T3','T4','T5'])for(const methodId of ['M1','M2',...(['T2','T3'].includes(caseId)?['M2-mismatch']:[])]) {
  const out=load(caseId+'-'+methodId),p=splineProblem(fixture(caseId),out.knots),r=p.residual(out.result.finalParams),reg=p.regularization(out.result.finalParams),m=r.length,mean=p.weights.reduce((s,w)=>s+w*w,0)/m;
  const cost=r.reduce((s,x,i)=>s+(x*p.weights[i])**2,0)/m+reg.reduce((s,x)=>s+x*x,0)*mean/m;
  assert.ok(Math.abs(cost-out.result.finalCost)<1e-8*Math.max(1,cost),'Saved objective agrees '+caseId+'/'+methodId);
 }
 console.log('SELF-CHECK: constant projection and all 14 saved prototype objectives agree');
}
else if(id==='prepare'){selfCheck();prepare();save('settings',settings);console.log(JSON.stringify(settings));}
else {
 assert.ok(['T0','T1','T2','T3','T4','T5'].includes(id));assert.ok(['M0','M1','M2','M2-mismatch'].includes(method));
 assert.deepEqual(JSON.parse(readFileSync('.qa/stage4_5c-settings.json','utf8')),settings,'Settings remain frozen');
 const f=fixture(id);save(id+'-fixture',{truth:f.truth,points:f.points,optics:f.optics,seed:45001});
 const start=performance.now();console.log('START '+id+' '+method);let out:any;
 if(method==='M0') {
  const rt=await runtime();out=await control(f,rt);
  const previous=`.qa/stage4_5b-${id}-free.json`;
  if(existsSync(previous)){const prior=JSON.parse(readFileSync(previous,'utf8'));assert.equal(out.summary.thickness,prior.summary.thickness);assert.equal(out.summary.mseWoollam,prior.summary.mseWoollam);out.previousBitIdentical=true;}
 } else if(method==='M1')out=await pointByPoint(f);
 else {
  let curve:any[],d:number,seed:any;
  if(method==='M2'&&['T1','T2','T3','T4'].includes(id)) {
   const file=`.qa/stage4_5-${id}.json`,old=JSON.parse(readFileSync(file,'utf8'));assert.deepEqual(f.points,old.points,'Same fitted dataset; physical seed is not truth');
   curve=old.output.finalOpticalConstants;d=old.output.finalThickness;seed={source:file,cached:true,model:old.truth.model,parameters:old.parameters,acquisitionElapsedMs:null,note:'Prior seed acquisition was not serially timed; prototype elapsed excludes cached acquisition'};
  } else if(id==='T0') {
   const result=await cauchy(f,true);curve=result.curve;d=result.result.finalParams[0];seed={source:'Cauchy fit with k0 free, not truth',cached:false,result};
  } else {
   assert.ok(method!=='M2-mismatch'||id==='T2'||id==='T3');const model=id==='T2'?'lorentz':'gaussian',seedStart=performance.now();
   const result=await runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:model,selectedAois:[65,70,75]});
   curve=result.finalOpticalConstants;d=result.finalThickness;seed={source:'Full Automatic fitted physical model',model,cached:false,acquisitionElapsedMs:performance.now()-seedStart,result};
  }
  assert.ok(Number.isFinite(d));const knots=Array.from({length:settings.knots},(_,i)=>190+710*i/(settings.knots-1));
  // Physical exports are sampled at 1 nm; use the measured wavelengths, never a truth-dependent grid.
  const byWavelength=new Map(curve.map(p=>[p.wavelength,p]));
  curve=f.points.filter((p:any)=>p.aoi===65).map((p:any)=>byWavelength.get(p.wavelength));
  assert.ok(curve.every(p=>p&&Number.isFinite(p.n)&&Number.isFinite(p.k)),'Physical seed covers every measured wavelength');
  const n=project(curve.map(p=>p.wavelength),curve.map(p=>p.n),knots),k=project(curve.map(p=>p.wavelength),curve.map(p=>p.k),knots);
  const refineStart=performance.now();out=await finish(f,knots,variables(knots,d,n.solution,k.solution),{...seed,projection:{nTruncated:n.truncated,kTruncated:k.truncated}});out.refinementElapsedMs=performance.now()-refineStart;
 }
 out.elapsedMs=performance.now()-start;out.settings=settings;save(id+'-'+method,out);guard();
 console.log('RESULT '+JSON.stringify({id,method,elapsedMs:out.elapsedMs,...out.summary,regions:out.regions}));
}
