import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {stage45dTests} from './stage4_5d-tests';
import {stage41Fixture} from './stage4_1-fixture';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
const base='e589f5d',mode=process.argv[2];
assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');
if(mode==='tests') {
 const results:any[]=[];
 await stage45dTests(async(name,fn)=>{const start=performance.now();try{await fn();results.push({name,passed:true,elapsedMs:performance.now()-start});}catch(e){results.push({name,passed:false,error:String(e)});}console.log(JSON.stringify(results.at(-1)));});
 const cases=Object.fromEntries(['T0','T1','T2','T3','T4','T5'].map(id=>[id,JSON.parse(readFileSync(`.qa/stage4_5d-${id}.json`,'utf8'))]));
 writeFileSync('.qa/stage4_5d-serial-tests.json',JSON.stringify({results,cases},null,2));if(results.some(r=>!r.passed))process.exitCode=1;
} else if(mode==='regression') {
 const root=resolve('.qa/stage45d-before'),zip=resolve('.qa/stage45d-before.zip');mkdirSync(root,{recursive:true});
 execFileSync('git',['archive','--format=zip','--output='+zip,base,'src']);
 if(process.platform==='win32')execFileSync('powershell',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${zip.replaceAll("'","''")}' -DestinationPath '${root.replaceAll("'","''")}' -Force`]);
 else execFileSync('unzip',['-o',zip,'-d',root]);
 const before=await import(pathToFileURL(resolve(root,'src/fitting/autoWorkflow.ts')).href),results:any[]=[];
 for(const scenario of ['SiO2','absorbing','transparent','weak'] as const) {
  const p=createMultiAoiSiO2OnSiProject(),points=scenario==='SiO2'?p.experimentData!.points:stage41Fixture(scenario).points,outputs:any[]=[];
  for(const [label,run] of [['before',before.runAutomatedEllipsometryFit],['after',runAutomatedEllipsometryFit]] as const) {
   console.log('START '+scenario+' '+label);const start=performance.now();
   const output=await run({ambient:structuredClone(p.ambient),layers:structuredClone(p.layers),substrate:structuredClone(p.substrate),points:structuredClone(points),config:structuredClone(p.fittingConfig),targetModelId:'gaussian',selectedAois:[65,70,75]});
   const r=output.fittingResult,entry={label,elapsedMs:performance.now()-start,mseWoollam:r.mseWoollam,thickness:output.finalThickness,converged:r.converged,physical:output.finalOpticalConstants,
    freeMse:r.opticalModelComparison!.freeForm.mseWoollam,origin:r.freeFormOrigin??'ladder',output};outputs.push(entry);
   writeFileSync(`.qa/stage4_5d-reg-${scenario}-${label}.json`,JSON.stringify(entry,null,2));
  }
  const [a,b]=outputs,differences={mseWoollam:b.mseWoollam-a.mseWoollam,thickness:b.thickness-a.thickness,
   nk:Math.max(...a.physical.flatMap((p:any,i:number)=>[Math.abs(p.n-b.physical[i].n),Math.abs(p.k-b.physical[i].k)]))};
  results.push({scenario,outputs,differences});writeFileSync('.qa/stage4_5d-regression.json',JSON.stringify(results,null,2));console.log('REGRESSION '+JSON.stringify({scenario,differences,before:{...a,physical:undefined,output:undefined},after:{...b,physical:undefined,output:undefined}}));
  assert.deepEqual(b.physical,a.physical,'Physical n/k bit-identical');assert.equal(b.mseWoollam,a.mseWoollam);assert.equal(b.thickness,a.thickness);assert.equal(b.converged,a.converged);
 }
} else throw new Error('Use tests or regression');
