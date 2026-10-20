import {writeQaFileSync as writeFileSync,readQaFileSync as readFileSync} from './qa-files.mjs';
import {mkdirSync} from 'node:fs';
import {resolve,posix} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stage41Fixture,trueN,trueK,Scenario} from './stage4_1-fixture';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {computeFitStatistics,FitStatistics} from '../src/fitting/statistics';
import {freeFormCurve} from '../src/fitting/freeFormOptics';
import {calculatePoint} from '../src/solver/calculator';
import {circularDifferenceDeg,residualWeights} from '../src/fitting/residual';
import type {FittingResult} from '../src/types/ellipsometry';

const report:{runs:unknown[];errors:{scenario:string;lambdaK:number;error:string}[]}={runs:[],errors:[]};
const source=readFileSync('src/fitting/autoWorkflow.ts','utf8');
if(source.split('const lambdaK = 0.6;').length!==2)throw new Error('Diagnostic source guard: expected exactly one unchanged default lambdaK');
const summarize=(s:FitStatistics)=>({available:s.available,dof:s.dof,chiSquare:s.chiSquare,reducedChiSquare:s.reducedChiSquare,
  conditionNumber:s.conditionNumber,conditionLevel:s.conditionLevel,truncatedSingularValues:s.truncatedSingularValues,
  freeParameters:s.covariance.ids.length,warnings:s.warnings});
function dataStatistics(result:FittingResult,scenario:Scenario) {
  const {project,points}=stage41Fixture(scenario),model=structuredClone(result.freeFormModel!);
  const variables=model.variables.map(v=>({...v,splineCoefficient:/^[NK]\d+$/.test(v.id)}));
  const layer=model.layers[model.primaryLayerIndex];
  return computeFitStatistics(variables,variables.map(v=>v.value),vector=>{
    variables.forEach((v,i)=>{if(v.id==='thickness')layer.thickness=vector[i];else layer.parameters[v.id].current=vector[i];});
    return points.flatMap(pt=>{const c=calculatePoint(project.ambient,model.layers,project.substrate,pt.wavelength,pt.aoi);
      return [c.psiDeg-pt.psiExp,circularDifferenceDeg(c.deltaDeg,pt.deltaExp)];});
  },{weights:residualWeights(points,project.fittingConfig).weights});
}
for(const scenario of ['absorbing','transparent'] as const)for(const lambdaK of scenario==='transparent'?[.15,.6,2.4]:[.6]) {
  try {
    let run=runAutomatedEllipsometryFit;
    if(lambdaK!==.6) {
      mkdirSync('.qa',{recursive:true});
      // Isolated diagnostic copy only: keep production source and all other constants unchanged.
      const variant=source.replace('const lambdaK = 0.6;',`const lambdaK = ${lambdaK};`).replace(/from '([^']+)'/g,(match,path:string)=>
        path.startsWith('.')?`from '${posix.relative('.qa',posix.normalize(posix.join('src/fitting',path)))}'`:match);
      const file=resolve(`.qa/stage41-diagnostic-${lambdaK}.ts`);writeFileSync(file,variant);
      run=(await import(pathToFileURL(file).href)).runAutomatedEllipsometryFit;
    }
    const {project:p,points}=stage41Fixture(scenario),start=performance.now();
    const out=await run({ambient:p.ambient,layers:p.layers,substrate:p.substrate,points,config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]});
    const result=out.fittingResult,model=result.freeFormModel!,layer=model.layers[model.primaryLayerIndex],count=layer.parameters._knotCount.current;
    const knots=Array.from({length:count},(_,i)=>layer.parameters[`_knot${i}`].current);
    const nc=knots.map((_,i)=>layer.parameters[`N${i}`].current),kc=knots.map((_,i)=>layer.parameters[`K${i}`].current);
    const dataOnly=dataStatistics(result,scenario);
    const second=freeFormCurve(result.freeFormOpticalConstants!.map(q=>q.wavelength),knots,nc,kc,dataOnly);
    const table=result.freeFormOpticalConstants!.flatMap((q,i)=>q.wavelength===190||q.wavelength%50===0||q.wavelength>=800&&q.wavelength%10===0
      ?[{wavelength:q.wavelength,trueK:trueK(scenario,q.wavelength),fittedK:q.k,nBias:q.n-trueN(q.wavelength),
        regularizedSigmaK:q.kSigma,regularizedFlag:q.belowDetection?'below_detection':q.kSigma===null?'uncertainty_unavailable':'',
        dataOnlySigmaK:second[i].kSigma,dataOnlyFlag:second[i].belowDetection?'below_detection':second[i].kSigma===null?'uncertainty_unavailable':''}]:[]);
    const entry={scenario,lambdaN:model.lambdaN,lambdaK:model.lambdaK,elapsedMs:performance.now()-start,
      freeFormThickness:layer.thickness,physicalThickness:out.finalThickness,physicalConverged:result.converged,knots:count,
      comparison:result.opticalModelComparison,regularizedStatistics:summarize(result.freeFormStatistics!),dataOnlyStatistics:summarize(dataOnly),table};
    report.runs.push(entry);console.log('STAGE4_1_DIAGNOSTIC '+JSON.stringify(entry));
  }catch(error){const entry={scenario,lambdaK,error:error instanceof Error?error.stack??error.message:String(error)};report.errors.push(entry);console.error('STAGE4_1_DIAGNOSTIC_ERROR '+JSON.stringify(entry));process.exitCode=1;}
  writeFileSync('stage4_1-diagnostics.json',JSON.stringify(report,null,2));
}
console.log('STAGE4_1_DIAGNOSTIC_SUMMARY '+JSON.stringify({runs:report.runs.length,errors:report.errors}));
