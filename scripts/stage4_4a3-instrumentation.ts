import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

function once(source:string,needle:string,addition:string) {
 assert.equal(source.split(needle).length,2,'Diagnostic anchor: '+needle);
 return source.replace(needle,addition);
}
export async function instrumentStage44a3() {
 const base='10b641d',root=resolve('.qa/stage44a3-source');
 for(const file of execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n')){
  const target=resolve(root,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,execFileSync('git',['show',base+':'+file]));
 }
 const optPath=resolve(root,'src/fitting/diagnosticOptimizer.ts');
 let s=readFileSync(resolve(root,'src/fitting/optimizer.ts'),'utf8');
 const helper=relative(dirname(optPath),resolve('scripts/stage4_4a3-math.ts')).replaceAll('\\','/');
 s=`import {parameterSnapshot,matrixDiagnostics} from '${helper}';\n`+s;
 s=once(s,'  let lambda = options.initialLambda ?? 1e-2;',`  let lambda = options.initialLambda ?? 1e-2;
  const diagnostic:any={iterations:[],matrices:[],tolerances:{ftol,xtol,gtol,costEpsilon,lambdaMax}};
  let round:any;`);
 s=once(s,'    const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);',`    const gradientTolerance=gtol*Math.max(currentCost,costEpsilon);
    round={iteration:iter+1,costBefore:currentCost,lambdaBefore:lambda,parametersBefore:parameterSnapshot(variables,currentParams),
      gradientNorm:gradNorm,gradientTolerance,attempts:[]};
    if((iter+1)%10===0)diagnostic.matrices.push({iteration:iter+1,point:'iteration_start',cost:currentCost,
      ...matrixDiagnostics(J,variables,currentU,g)});`);
 s=once(s,'    if (gradNorm < gradientTolerance) {',`    if (gradNorm < gradientTolerance) {
      round.gradientConverged=true;round.costAfter=currentCost;round.parametersAfter=parameterSnapshot(variables,currentParams);
      diagnostic.iterations.push(round);`);
 s=once(s,'        const trialCost = trialState.totalCost;',`        const trialCost = trialState.totalCost;
        const attempt:any={index:round.attempts.length+1,lambda,trialCost,costBefore:currentCost,accepted:trialCost<currentCost,
          relativeImprovement:(currentCost-trialCost)/Math.max(currentCost,costEpsilon),
          stepNorm:Math.hypot(...trialU.map((u,i)=>u-currentU[i])),unprojectedStepNorm:Math.hypot(...deltaU),
          parameters:parameterSnapshot(variables,trialParams)};
        round.attempts.push(attempt);`);
 s=once(s,'    iter++;',`    round.costAfter=currentCost;round.lambdaAfter=lambda;round.accepted=stepAccepted;
    round.parametersAfter=parameterSnapshot(variables,currentParams);round.attemptCount=round.attempts.length;
    const last=round.attempts.at(-1);
    round.criteria={ftol:last?.accepted?last.relativeImprovement<ftol:false,xtol:last?.accepted?last.stepNorm<xtol:false,
      gtol:gradNorm<gradientTolerance,noBetterStep:!stepAccepted&&gradNorm<100*gradientTolerance};
    diagnostic.iterations.push(round);
    iter++;`);
 s=once(s,'  const improved = currentCost < initialCost;',`  const finalState=evaluateFullState(currentParams);
  const finalJ=centralDifferenceJacobian(variables,currentParams,p=>{const state=evaluateFullState(p);return [...state.expRes,...state.regRes];},
    i=>isAngularIdx(i,finalState.mExp)).map((row,i)=>row.map(v=>v*finalState.rowWeights[i]));
  const finalG=variables.map((_,j)=>finalJ.reduce((sum,row,i)=>sum+row[j]*finalState.combinedResiduals[i],0)/finalState.mExp);
  const projected=finalG.map((g,i)=>(currentU[i]<=1e-8&&g>0)||(currentU[i]>=1-1e-8&&g<0)?0:g);
  diagnostic.final={parameters:parameterSnapshot(variables,currentParams),gradient:finalG,projectedGradient:projected,
    gradientNorm:Math.max(0,...projected.map(Math.abs)),gradientTolerance:gtol*Math.max(currentCost,costEpsilon)};
  diagnostic.final.gradientSatisfied=diagnostic.final.gradientNorm<diagnostic.final.gradientTolerance;
  diagnostic.matrices.push({iteration:iter,point:'fresh_final',cost:currentCost,...matrixDiagnostics(finalJ,variables,currentU,finalG)});
  evaluateFullState(currentParams); // Restore residual closure state after the read-only final Jacobian.
  const improved = currentCost < initialCost;`);
 s=once(s,'  return {\n    status,','  return {\n    diagnostic,\n    status,');
 writeFileSync(optPath,s);
 const workflowPath=resolve(root,'src/fitting/autoWorkflow.ts');let auto=readFileSync(workflowPath,'utf8');
 auto=`import {optimizeBoundedLM as diagnosticOptimize} from './diagnosticOptimizer';
 export const captured:any[]=[];\n`+auto.replace(/await optimizeBoundedLM\(/g,'await captureOptimize(');
 auto+=`\nasync function captureOptimize(variables:any[],residualFn:any,options:any) {
  if(options.maxIterations!==100||options.tolerance!==1e-6)return optimizeBoundedLM(variables,residualFn,options);
  const initial=structuredClone(variables),start=performance.now();
  const result=await diagnosticOptimize(variables,residualFn,options);
  captured.push({variables:initial,residualFn,options,result,elapsedMs:performance.now()-start});return result;
 }\n`;
 writeFileSync(workflowPath,auto);
 return {workflow:await import(pathToFileURL(workflowPath).href),optimizer:await import(pathToFileURL(optPath).href)};
}
