// Diagnostic-only source copies. Every replacement is guarded; src is never written.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {posix,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
export function replaceOnce(source:string,needle:string,replacement:string) {
  assert.equal(source.split(needle).length,2,`Diagnostic anchor: ${needle}`);
  return source.replace(needle,replacement);
}
function relocate(source:string,dir:string) {
  return source.replace(/from '([^']+)'/g,(all,p)=>p.startsWith('.')?`from '${posix.relative('.qa',posix.normalize(posix.join(dir,p)))}'`:all);
}
export async function instrument() {
  mkdirSync('.qa',{recursive:true});
  let opt=readFileSync('src/fitting/optimizer.ts','utf8');
  opt=replaceOnce(opt,'  let lambda = options.initialLambda ?? 1e-2;',`  let lambda = options.initialLambda ?? 1e-2;
  const telemetry:any={lastGradientNorm:null,lastAcceptedStepNorm:null,lastTrialStepNorm:null,relativeImprovement:null};
  const traceStart=performance.now();`);
  opt=replaceOnce(opt,'const {ftol,xtol,gtol,costEpsilon,lambdaMax}=convergenceSettings(options.tolerance);',
    `let {ftol,xtol,gtol,costEpsilon,lambdaMax}=convergenceSettings(options.tolerance);
     if((options as any).diagnosticTight){ftol/=100;xtol/=100;gtol/=100;}`);
  opt=replaceOnce(opt,'const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);',
    `const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);
     Object.assign(telemetry,{lastGradientNorm:gradNorm,lastGradientParams:[...currentParams],gradientTolerance});`);
  opt=replaceOnce(opt,'const trialParams = toPhysical(trialU);',
    `telemetry.lastTrialStepNorm=Math.hypot(...trialU.map((u,i)=>u-currentU[i]));
        const trialParams = toPhysical(trialU);`);
  opt=replaceOnce(opt,'const stepNorm=Math.hypot(...trialU.map((u,i)=>u-currentU[i]));',
    `const stepNorm=Math.hypot(...trialU.map((u,i)=>u-currentU[i]));
          Object.assign(telemetry,{lastAcceptedStepNorm:stepNorm,relativeImprovement});`);
  opt=replaceOnce(opt,'  return {\n    status,',`  return {
    telemetry:{...telemetry,lambda,ftol,xtol,gtol,maxIterations,limitHit:iter>=maxIterations,elapsedMs:performance.now()-traceStart},
    status,`);
  writeFileSync('.qa/stage42-optimizer.ts',relocate(opt,'src/fitting'));
  const spline=replaceOnce(readFileSync('src/models/bspline.ts','utf8'),'MAX_BSPLINE_NODES = 20','MAX_BSPLINE_NODES = 40');
  writeFileSync('.qa/stage42-bspline.ts',relocate(spline,'src/models'));
  let auto=readFileSync('src/fitting/autoWorkflow.ts','utf8');
  auto=relocate(auto,'src/fitting').replace("from '../src/fitting/optimizer'","from './stage42-optimizer'");
  // The copied generator can generate 24–40 knots; default 8–20 grids are unchanged.
  auto=auto.replace("from '../src/models/bspline'","from './stage42-bspline'");
  auto=`export const diagnostic:any={options:{},stages:[],starts:[],calls:[],candidates:[]};
  import {trueN,trueK} from '../scripts/stage4_1-fixture';
  `+auto;
  auto=auto.replace(/await optimizeBoundedLM\(/g,'await tracedOptimize(');
  auto+=`
async function tracedOptimize(variables:any[],residualFn:any,options:any) {
 const initial=structuredClone(variables);
 const result=await optimizeBoundedLM(variables,residualFn,options);
 diagnostic.calls.push({variables:initial,dataResidualCount:options.residualWeights?.length,...result});
 return result;
}
`;
  auto=replaceOnce(auto,'  const cauchyFinalMse = cauchyMetrics.rawMse;',`  const cauchyFinalMse = cauchyMetrics.rawMse;
  diagnostic.cauchy={metrics:cauchyMetrics,layers:structuredClone(cauchyLayers),optimization:cauchyFullOpt};
  diagnostic.context={ambient,substrate,points:fittingPoints,config,primaryLayerIndex};`);
  auto=replaceOnce(auto,'const allKnotStages = [8, 12, 16, 20].filter((k) => k <= maxAllowedKnots);',
    'const allKnotStages = diagnostic.options.knots ? [diagnostic.options.knots] : [8, 12, 16, 20].filter((k) => k <= maxAllowedKnots);');
  auto=replaceOnce(auto,'const lambdaN = 0.25;','const lambdaN = 0.25 * (diagnostic.options.nScale??1);');
  auto=replaceOnce(auto,'const lambdaK = 0.6;','const lambdaK = 0.6 * (diagnostic.options.kScale??1);');
  auto=replaceOnce(auto,'    reportProgress({\n      stage: \'stage2_bspline\',',`    if(diagnostic.options.truth) {
      initNCoeffs=stageKnots.map(w=>trueN(w));
      initKCoeffs=stageKnots.map(w=>trueK(diagnostic.options.scenario,w));
      activeBsplineThickness=100;
    }
    reportProgress({
      stage: 'stage2_bspline',`);
  auto=replaceOnce(auto,'      maxIterations: 22,\n      tolerance: 1e-5,',
    '      maxIterations: diagnostic.options.tight?110:22,\n      diagnosticTight:diagnostic.options.tight,\n      tolerance: 1e-5,');
  auto=replaceOnce(auto,'    const stageTotalObj = stageMetrics.weightedMse + stageRegPenalty;',`    const stageTotalObj = stageMetrics.weightedMse + stageRegPenalty;
    diagnostic.stages.push({knots:stageKnots,variables:structuredClone(stageVars),optimization:stageOpt,
      metrics:stageMetrics,layers:structuredClone(bsplineLayers),lambdaN,lambdaK,
      smoothInfo,previousRawMse:activeBsplineRawMse,previousObjective:activeBsplineTotalObj,
      accepted:stageIdx===0||stageTotalObj<activeBsplineTotalObj,
      stopReason:stageIdx!==0&&stageTotalObj>=activeBsplineTotalObj?'weighted_objective_not_improved':
        stageRawMse<0.025?'raw_mse_below_0.025':
        stageIdx>0&&activeBsplineRawMse-stageRawMse<knotImprovementTolerance?'raw_improvement_below_0.005':
        stageIdx===allKnotStages.length-1?'configured_knot_limit':'continue',
      rawImprovement:activeBsplineRawMse-stageRawMse,scheduledKnots:allKnotStages});`);
  const stopAnchor='  const freeFormOpticalConstants=freeFormCurve(freeWavelengths,activeKnots,activeNCoeffs,activeKCoeffs,freeFormStatistics);';
  auto=replaceOnce(auto,stopAnchor,stopAnchor+`
  diagnostic.free={freeFormModel,freeFormStatistics,freeFormOpticalConstants};
  if(diagnostic.options.stopAfterSpline)return diagnostic.free as any;
`);
  auto=replaceOnce(auto,'      const finalParamsRecord: Record<string, number> = {};',`      diagnostic.starts.push({modelId:cModelId,index:startIdx+1,initialization,
        source:startIdx===0?'peak_initialization':startIdx%5!==4?'VUV':'near_data_range',
        variables:structuredClone(activeVars),initialParams:structuredClone(initialParamsRecord),
        metrics:fullMetrics,optimization:optRes,layers:structuredClone(startLayers)});
      const finalParamsRecord: Record<string, number> = {};`);
  auto=replaceOnce(auto,'  const winningCandidate = evaluatedCandidates[0];',`  const winningCandidate = evaluatedCandidates[0];
  diagnostic.candidates=structuredClone(evaluatedCandidates);
  diagnostic.selection='ascending full-spectrum weightedMse; top two starts polished first';`);
  writeFileSync('.qa/stage42-workflow.ts',auto);
  const module=await import(pathToFileURL(resolve('.qa/stage42-workflow.ts')).href);
  return module;
}
