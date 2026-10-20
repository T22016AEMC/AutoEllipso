import {writeQaFileSync as writeFileSync,readQaFileSync as readFileSync} from './qa-files.mjs';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {replaceOnce,instrument} from './stage4_2-instrumentation';
import {stage41Fixture} from './stage4_1-fixture';

// Reuse the exact fixture implementation, changing only its explicit seed argument in an isolated copy.
mkdirSync('.qa',{recursive:true});
let fixture=readFileSync('scripts/stage4_1-fixture.ts','utf8');
fixture=replaceOnce(fixture,'stage41Fixture(scenario:Scenario)','stage41Fixture(scenario:Scenario,noiseSeed=41001)');
fixture=replaceOnce(fixture,'let seed=41001','let seed=noiseSeed');
writeFileSync('.qa/stage42-seeded-fixture.ts',fixture);
const {stage41Fixture:seeded}=await import(pathToFileURL(resolve('.qa/stage42-seeded-fixture.ts')).href);
assert.deepEqual(seeded('transparent',41001).points,stage41Fixture('transparent').points);
const report:any={fixtureSeedIdentity:true,seeds:Array.from({length:20},(_,i)=>41001+i),runs:[]};
const wavelengths=[300,500,700,800,900];
const diagnosticModule=await instrument();
for(const seed of report.seeds){
  const start=performance.now();
  try {
    const {project:p,points}=seeded('transparent',seed);
    Object.assign(diagnosticModule.diagnostic,{options:{},stages:[],starts:[],calls:[],candidates:[]});
    const out=await diagnosticModule.runAutomatedEllipsometryFit({ambient:p.ambient,layers:p.layers,substrate:p.substrate,points,
      config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]});
    const r=out.fittingResult;
    const entry={seed,elapsedMs:performance.now()-start,physicalConverged:r.converged,physicalStatus:r.status,
      freeFormThickness:r.freeFormModel!.layers[r.freeFormModel!.primaryLayerIndex].thickness,
      splineStages:diagnosticModule.diagnostic.stages.map((s:any)=>({knots:s.knots.length,accepted:s.accepted,
        converged:s.optimization.converged,status:s.optimization.status,iterations:s.optimization.iterations})),
      reducedChiSquare:r.freeFormStatistics!.reducedChiSquare,physicalReducedChiSquare:r.reducedChiSquare,
      curve:wavelengths.map(w=>r.freeFormOpticalConstants!.find((q:any)=>q.wavelength===w))};
    report.runs.push(entry);console.log('STAGE4_2_MC '+JSON.stringify(entry));
  }catch(e){report.runs.push({seed,error:String(e)});process.exitCode=1;}
  writeFileSync('stage4_2-montecarlo.json',JSON.stringify(report,null,2));
}
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
report.summary=wavelengths.map(w=>{
  const samples=report.runs.filter((r:any)=>r.curve).map((r:any)=>r.curve.find((q:any)=>q.wavelength===w));
  const ks=samples.map((q:any)=>q.k),sigmas=samples.filter((q:any)=>Number.isFinite(q.kSigma)).map((q:any)=>q.kSigma);
  const avg=mean(ks),sd=Math.sqrt(ks.reduce((s:number,k:number)=>s+(k-avg)**2,0)/(ks.length-1));
  return {wavelength:w,n:ks.length,sigmaAvailable:sigmas.length,kMean:avg,kSampleStd:sd,meanSigma:mean(sigmas),
    stdToMeanSigma:sd/mean(sigmas),coverage:samples.filter((q:any)=>Number.isFinite(q.kSigma)&&Math.abs(q.k)<=2*q.kSigma).length/samples.length};
});
console.log('STAGE4_2_MC_SUMMARY '+JSON.stringify(report.summary));
writeFileSync('stage4_2-montecarlo.json',JSON.stringify(report,null,2));
