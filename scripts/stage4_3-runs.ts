import {writeQaFileSync as writeFileSync,readQaFileSync as readFileSync,existsQaFileSync as existsSync} from './qa-files.mjs';
import {mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {stage41Fixture,trueN,trueK,Scenario} from './stage4_1-fixture';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {opticalConstantsCsv} from '../src/data/export';

const before=process.argv[2]==='before',base='46f114bc48f0a751290a8cd4bef93d8aa79c5ba7';
const filename=before?'stage4_3-before.json':'stage4_3-runs.json';
const report:any=existsSync(filename)?JSON.parse(readFileSync(filename,'utf8')):{base,mode:before?'before':'after',runs:[]};
const save=()=>writeFileSync(filename,JSON.stringify(report,null,2));
let run=runAutomatedEllipsometryFit;
mkdirSync('.qa',{recursive:true});
if(before){
  const files=execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n');
  for(const file of files){const path=resolve('.qa/stage43-before',file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,execFileSync('git',['show',base+':'+file]));}
  run=(await import(pathToFileURL(resolve('.qa/stage43-before/src/fitting/autoWorkflow.ts')).href)).runAutomatedEllipsometryFit;
}
// Same fixture code and PRNG as Stage 4.1; only the explicit seed is variable for MC.
const fixtureCode=readFileSync('scripts/stage4_1-fixture.ts','utf8').replace('stage41Fixture(scenario:Scenario)','stage41Fixture(scenario:Scenario,noiseSeed=41001)').replace('let seed=41001','let seed=noiseSeed');
writeFileSync('.qa/stage43-seeded-fixture.ts',fixtureCode);
const seeded=(await import(pathToFileURL(resolve('.qa/stage43-seeded-fixture.ts')).href)).stage41Fixture;
assert.deepEqual(seeded('transparent',41001).points,stage41Fixture('transparent').points);
const jobs:{scenario:Scenario|'SiO2';model:string;repeat:number;seed:number;kind:string}[]=[];
for(const scenario of ['SiO2','absorbing','transparent','weak'] as const)
  for(let repeat=0;repeat<3;repeat++)jobs.push({scenario,model:'gaussian',repeat,seed:41001,kind:'timing'});
if(!before){
  for(const scenario of ['absorbing','transparent','weak'] as const)for(const model of ['tauc_lorentz','lorentz'])jobs.push({scenario,model,repeat:0,seed:41001,kind:'physical'});
  for(let seed=41001;seed<=41020;seed++)jobs.push({scenario:'transparent',model:'gaussian',repeat:0,seed,kind:'MC'});
}
for(const job of jobs){
  const key=[job.kind,job.scenario,job.model,job.repeat,job.seed].join('/');
  if(report.runs.some((r:any)=>r.key===key))continue;
  // Seed 41001 MC is identical to the first timed transparent run; reuse its exact output.
  const reuse=job.kind==='MC'&&job.seed===41001?report.runs.find((r:any)=>r.key==='timing/transparent/gaussian/0/41001'):undefined;
  if(reuse&&!reuse.error){report.runs.push({...reuse,...job,key,reusedFrom:reuse.key});save();continue;}
  console.log('STAGE4_3_START '+key);const start=performance.now();
  try{
    const {project:p,points}=job.scenario==='SiO2'?(()=>{const p=createMultiAoiSiO2OnSiProject();return {project:p,points:p.experimentData!.points};})():seeded(job.scenario,job.seed);
    let lastStage='';
    const out=await run({ambient:p.ambient,layers:p.layers,substrate:p.substrate,points,config:p.fittingConfig,
      targetModelId:job.model,selectedAois:[65,70,75],onProgress:progress=>{
        const label=progress.stage+'/'+(progress.bsplineKnots??'');if(label!==lastStage){console.log('STAGE4_3_PROGRESS '+key+' '+label);lastStage=label;}
      }});
    const elapsedMs=performance.now()-start,r=out.fittingResult,free=r.freeFormOpticalConstants!;
    const optical=job.scenario==='SiO2'?[]:free.map(q=>({...q,trueN:trueN(q.wavelength),trueK:trueK(job.scenario as Scenario,q.wavelength),nError:q.n-trueN(q.wavelength),kError:q.k-trueK(job.scenario as Scenario,q.wavelength)}));
    const range=optical.filter(q=>q.wavelength>=300&&q.wavelength<=900),tail=optical.filter(q=>q.wavelength>=600&&q.wavelength<=900);
    const selected=r.bsplineDiagnostic?.knotRefinementHistory?.find(s=>s.selected),freeThickness=r.freeFormModel!.layers[r.freeFormModel!.primaryLayerIndex].thickness;
    const metrics={mseWoollam:r.opticalModelComparison!.freeForm.mseWoollam,thickness:freeThickness,
      maxNError:Math.max(0,...range.map(q=>Math.abs(q.nError))),maxKError:Math.max(0,...tail.map(q=>Math.abs(q.kError)))};
    const checks=job.scenario==='SiO2'?undefined:{mse:metrics.mseWoollam<=1.3,thickness:Math.abs(freeThickness-100)<=.2,n:metrics.maxNError<=.003,k:metrics.maxKError<=.002};
    const entry={key,...job,elapsedMs,metrics,checks,
      free:{converged:selected?.converged,status:selected?.status,reducedChiSquare:r.freeFormStatistics?.reducedChiSquare,fitAdequacy:r.freeFormFitAdequacy,
        warning:r.freeFormFitAdequacyWarning,stages:r.bsplineDiagnostic?.knotRefinementHistory},
      physical:{model:job.model,mseWoollam:r.mseWoollam,rawMse:r.rawMse,thickness:out.finalThickness,converged:r.converged,status:r.convergenceStatus,
        reducedChiSquare:r.statistics?.reducedChiSquare,fitAdequacy:r.fitAdequacy,warning:r.fitAdequacyWarning,parameters:r.parameters,initialization:r.initialization},
      curve:job.kind==='MC'?free.filter(q=>[300,500,700,800,900].includes(q.wavelength)):optical,
      transparentLegacyAssertion:job.scenario==='transparent'?free.filter(q=>q.wavelength>=800).every(q=>q.belowDetection===true):undefined};
    report.runs.push(entry);
    if(!before&&job.kind==='timing'&&job.repeat===0&&job.scenario!=='SiO2')writeFileSync('stage4_3-'+job.scenario+'-free-form.csv',opticalConstantsCsv(free,'free_form'));
    console.log('STAGE4_3_RESULT '+JSON.stringify({...entry,curve:undefined,physical:{...entry.physical,parameters:undefined,initialization:undefined}}));
  }catch(error){report.runs.push({key,...job,elapsedMs:performance.now()-start,error:String(error instanceof Error?error.stack:error)});console.error('STAGE4_3_ERROR '+key+' '+String(error));process.exitCode=1;}
  save();
}
console.log('STAGE4_3_COMPLETE '+JSON.stringify({mode:report.mode,runs:report.runs.length,errors:report.runs.filter((r:any)=>r.error).length}));
