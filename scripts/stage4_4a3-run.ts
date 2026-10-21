import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {optimizeBoundedLM} from '../src/fitting/optimizer';
import {circularDifferenceDeg} from '../src/fitting/residual';
import {parameterSnapshot,matrixDiagnostics} from './stage4_4a3-math';
import {instrumentStage44a3} from './stage4_4a3-instrumentation';

const save=(name:string,value:unknown)=>writeFileSync('.qa/stage4_4a3-'+name+'.json',JSON.stringify(value,null,2));
assert.equal(execFileSync('git',['rev-parse','--abbrev-ref','HEAD'],{encoding:'utf8'}).trim(),'v2.2-integration');
assert.equal(execFileSync('git',['diff','10b641d','--','src'],{encoding:'utf8'}),'');
const check:any=matrixDiagnostics([[3,0],[0,1],[0,0]],[{id:'x',min:0,max:1,value:.5,name:'x'},{id:'y',min:0,max:1,value:.5,name:'y'}],[.5,.5],[1,1]);
assert.equal(check.full.raw.maximum,3);assert.equal(check.full.raw.minimum,1);assert.equal(check.full.normalized.condition,1);
const {workflow,optimizer}=await instrumentStage44a3();
const p=createMultiAoiSiO2OnSiProject();
console.log('START baseline full Automatic');
const out=await workflow.runAutomatedEllipsometryFit({ambient:p.ambient,layers:p.layers,substrate:p.substrate,
 points:p.experimentData!.points,config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]});
assert.equal(workflow.captured.length,2);
const captures=workflow.captured;
const selected=captures.find((c:any)=>c.result.finalParams.every((value:number,i:number)=>
 value===(i===0?out.finalThickness:out.updatedLayers[0].parameters[c.variables[i].id].current)));
assert.ok(selected,'The final selected physical parameters must match a captured polish exactly');
function exportRun(c:any){
 for(const row of c.result.diagnostic.iterations){
  row.attemptCount=row.attempts.length;
  row.relativeImprovement=row.attempts.at(-1)?.relativeImprovement??null;
  row.stepNorm=row.attempts.at(-1)?.stepNorm??null;
  for(const [i,a] of row.attempts.entries())a.lambdaAfter=row.attempts[i+1]?.lambda??row.lambdaAfter;
 }
 return {variables:c.variables,elapsedMs:c.elapsedMs,result:c.result};
}
const candidates=captures.map((c:any,i:number)=>({index:i+1,selected:c===selected,...exportRun(c)}));
save('candidates',candidates);
save('baseline',{base:'10b641d',fixture:'createMultiAoiSiO2OnSiProject; same deterministic wavelength/AOI noise',
 aoi:[65,70,75],targetModelId:'gaussian',mseWoollam:out.fittingResult.mseWoollam,thickness:out.finalThickness,
 selectedCandidate:candidates.find((c:any)=>c.selected)!.index,points:p.experimentData!.points.length});
console.log('BASELINE '+JSON.stringify({mseWoollam:out.fittingResult.mseWoollam,thickness:out.finalThickness,cost:selected.result.finalCost}));
// Check that telemetry has not altered the same-start production optimizer result.
const plainStart=performance.now();
const plain=await optimizeBoundedLM(selected.variables,selected.residualFn,selected.options);
for(const key of ['finalParams','finalCost','finalRawMse','iterations','status','converged'] as const)assert.deepEqual(plain[key],selected.result[key],key);
save('replay-check',{bitIdentical:true,elapsedMs:performance.now()-plainStart,production:plain});
console.log('REPLAY bit-identical');
const experiments:any[]=[];
for(const cap of [35,100,300]){
 console.log('START A '+cap);const start=performance.now();
 const result=await optimizer.optimizeBoundedLM(selected.variables,selected.residualFn,{...selected.options,maxIterations:cap});
 const entry=exportRun({variables:selected.variables,elapsedMs:performance.now()-start,result});
 experiments.push({experiment:'A',cap,...entry});save('experiments',experiments);
 console.log('A '+JSON.stringify({cap,cost:result.finalCost,converged:result.converged,status:result.status,iterations:result.iterations,elapsedMs:entry.elapsedMs}));
 if(cap===100)for(const key of ['finalParams','finalCost','iterations','status'])assert.deepEqual(result[key],selected.result[key]);
}
const finalMatrix=selected.result.diagnostic.matrices.at(-1);
const choices=[{label:'full minimum singular direction',matrix:finalMatrix.full},
 {label:'active nonzero minimum singular direction',matrix:finalMatrix.activeNonzero}];
for(const choice of choices){
 if(!choice.matrix.raw){experiments.push({experiment:'B',selection:choice.label,error:choice.matrix.error});continue;}
 const id=choice.matrix.raw.minimumVector[0].id,index=selected.variables.findIndex((v:any)=>v.id===id);
 const fixedValue=selected.variables[index].value;
 const variables=selected.variables.filter((_:any,i:number)=>i!==index);
 const residual=(params:number[])=>{let j=0;return selected.residualFn(selected.variables.map((v:any,i:number)=>i===index?fixedValue:params[j++]));};
 const start=performance.now(),result=await optimizer.optimizeBoundedLM(variables,residual,{...selected.options,maxIterations:35});
 const entry={experiment:'B',selection:choice.label,fixedId:id,fixedValue,fixedAt:'selected candidate initial value',
  ...exportRun({variables,elapsedMs:performance.now()-start,result})};
 experiments.push(entry);save('experiments',experiments);
 console.log('B '+JSON.stringify({fixedId:id,fixedValue,cost:result.finalCost,converged:result.converged,status:result.status,iterations:result.iterations}));
}
const [a,b]=captures;
assert.equal(captures.indexOf(selected),1,'Candidate difference table labels require the second captured start to be selected');
save('candidate-differences',{initial:a.variables.map((v:any,i:number)=>({id:v.id,first:v.value,selected:b.variables[i].value,difference:b.variables[i].value-v.value})),
 final:a.variables.map((v:any,i:number)=>({id:v.id,first:a.result.finalParams[i],selected:b.result.finalParams[i],difference:b.result.finalParams[i]-a.result.finalParams[i]})),
 initialCostDifference:b.result.initialCost-a.result.initialCost,finalCostDifference:b.result.finalCost-a.result.finalCost,
 selectedIndex:captures.indexOf(selected)+1});
save('checks',{productionReplayBitIdentical:true,unchangedSrc:execFileSync('git',['diff','10b641d','--','src'],{encoding:'utf8'})==='',
 finiteSnapshots:candidates.every((c:any)=>c.result.diagnostic.iterations.every((r:any)=>r.parametersAfter.every((v:any)=>Number.isFinite(v.value)))),
 selectedStart:parameterSnapshot(selected.variables,selected.variables.map((v:any)=>v.value))});
// Read-only check of zero Jacobian columns near the existing Gaussian activation gate.
const baseResidual=selected.residualFn(selected.result.finalParams),probes=[];
for(const id of ['A2','A3'])for(const value of [.0005,.001,.001001,.002]){
 const index=selected.variables.findIndex((v:any)=>v.id===id),params=[...selected.result.finalParams];params[index]=value;
 const residual=selected.residualFn(params),weights=selected.options.residualWeights;
 probes.push({id,value,physicalDifferenceStep:Math.max(1e-5*(selected.variables[index].max-selected.variables[index].min),1e-4*Math.abs(selected.result.finalParams[index]),1e-12),
  maximumResidualChangeDeg:Math.max(...residual.map((r:number,i:number)=>Math.abs(i%2?circularDifferenceDeg(r,baseResidual[i]):r-baseResidual[i]))),
  cost:residual.reduce((s:number,r:number,i:number)=>s+(r*weights[i])**2,0)/residual.length});
}
save('activation-probes',probes);
console.log('COMPLETE');
