import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {prepare,workflow,save,fixture,truthCases,summary,errors,parameterTable,replay} from './stage4_5-support';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {modelRegistry} from '../src/modelRegistry/registry';
import {stage41Fixture} from './stage4_1-fixture';
const mode=process.argv[2]??'prepare';
assert.equal(execFileSync('git',['diff','9185a97','--','src'],{encoding:'utf8'}),'','Production source must stay unchanged');
assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');
if(mode==='prepare') {
 prepare();
 const parameters=Object.fromEntries(Object.entries(modelRegistry.createParameterSet('cauchy')).map(([k,p])=>[k,p.current]));
 const optics=Array.from({length:72},(_,i)=>({wavelength:190+10*i,...modelRegistry.get('cauchy')!.calculate(190+10*i,parameters)}));
 save('fixture-truth',{source:'src/data/defaultProjects.ts:181-217',thickness:100,model:'cauchy',parameters,optics,noiseSigma:.04,aois:[65,70,75]});
 console.log('Prepared two isolated revisions; src untouched');
} else if(mode.startsWith('T')) {
 const index=truthCases.findIndex(t=>t.id===mode);assert.ok(index>=0);
 const f=fixture(index),w=await workflow('after');console.log('START '+mode);
 const start=performance.now();
 const out=await w.runAutomatedEllipsometryFit({ambient:f.project.ambient,layers:f.project.layers,substrate:f.project.substrate,points:f.points,config:f.project.fittingConfig,targetModelId:f.truth.model,selectedAois:[65,70,75]});
 const result={truth:f.truth,truthParameters:f.values,seed:45001,...summary(out,performance.now()-start),errors:errors(out,f.optics),parametersDetailed:parameterTable(out,w.diagnostics)};
 save(mode,{...result,points:f.points,truthOptics:f.optics,output:out,calls:w.calls,diagnostics:w.diagnostics});
 console.log('RESULT '+JSON.stringify(result));
 if(mode==='T2'||mode==='T3') {
  const states=w.diagnostics.find((d:any)=>d.kind==='starts').states,first=states.find((s:any)=>s.startIndex===1);
  const selected=w.diagnostics.find((d:any)=>d.kind==='selected').state;
  // Same physical parameter set and bounds as Automatic start #1; inactive terms remain inactive.
  const initialDefault={thickness:first.initialThickness,...first.initialParamsRecord};
  const experiments=[];
  for(const [label,factor] of [['truth',1],['truth-20%',.8],['truth+20%',1.2],['Automatic-start1',null]] as const) {
   const initial=factor===null?initialDefault:Object.fromEntries(Object.entries({thickness:100,...f.values}).map(([k,v])=>[k,v*factor]));
   const e=await replay(f.project,f.points,first,initial,label);experiments.push(e);
   save(mode+'-sensitivity',experiments);console.log('SENSITIVITY '+JSON.stringify(e));
  }
  // Read-only wrapper self-check: replay the winning polish with its exact original closure/options.
  const physicalParams=result.parameters;
  const selectedCall=w.calls.filter((c:any)=>c.options.maxIterations===100&&c.options.tolerance===1e-6&&
   c.initial.every((v:any,i:number)=>Math.abs(c.result.finalParams[i]-(v.id==='thickness'?out.finalThickness:physicalParams[v.id]))<=1e-12)).at(-1);
  if(selectedCall) {
   const {optimizeBoundedLM}=await import('../src/fitting/optimizer');
   const again=await optimizeBoundedLM(selectedCall.initial,selectedCall.residualFn,selectedCall.options);
   for(const key of ['finalParams','finalCost','status','iterations','converged'] as const)assert.deepEqual(again[key],selectedCall.result[key],mode+' read-only replay '+key);
   save(mode+'-read-only-check',{bitIdentical:true,result:again});
  } else save(mode+'-read-only-check',{bitIdentical:null,warning:'Winning state did not match a captured final polish; selected pre-polish start may have remained best',selected});
 }
} else {
 const model=mode==='lorentz'?'lorentz':mode==='fixture'?'gaussian':mode.replace('reg-','');
 assert.ok(['lorentz','gaussian','tauc_lorentz','multi_oscillator'].includes(model));
 const scenarios=mode==='lorentz'?['SiO2','transparent']:mode==='fixture'?['SiO2']:['SiO2','absorbing','transparent','weak'];
 const results=[];
 for(const scenario of scenarios) {
  const p=createMultiAoiSiO2OnSiProject(),points=scenario==='SiO2'?p.experimentData!.points:stage41Fixture(scenario as 'transparent'|'absorbing'|'weak').points;
  const runs:any[]=[];
  for(const label of ['before','after'] as const) {
   // Reuse pinned Stage4.4c Gaussian fixture results if present; these are explicitly identified as prior measurements.
   const oldPath=`.qa/stage4_4c-gaussian-SiO2-${label}.json`;
   if(mode==='fixture'&&existsSync(oldPath)) {
    const old=JSON.parse(readFileSync(oldPath,'utf8'));
    runs.push({...summary(old.output,old.elapsedMs),label,source:oldPath});continue;
   }
   const w=await workflow(label);w.calls.length=0;w.diagnostics.length=0;console.log(`START ${model} ${scenario} ${label}`);
   const start=performance.now(),out=await w.runAutomatedEllipsometryFit({ambient:structuredClone(p.ambient),layers:structuredClone(p.layers),substrate:structuredClone(p.substrate),points:structuredClone(points),config:structuredClone(p.fittingConfig),targetModelId:model,selectedAois:[65,70,75]});
   const record={label,...summary(out,performance.now()-start),parametersDetailed:parameterTable(out,w.diagnostics),output:out,calls:w.calls,diagnostics:w.diagnostics};
   runs.push(record);save(`${model}-${scenario}-${label}`,record);console.log('RESULT '+JSON.stringify({...record,output:undefined,calls:undefined,diagnostics:undefined}));
  }
  results.push({scenario,runs:runs.map(({output,calls,diagnostics,...r})=>r),mseIncreased:runs[1].mseWoollam>runs[0].mseWoollam});save(mode+'-comparison',results);
  if(mode==='lorentz') {
   const [old,current]=runs;
   const experiments=[];
   const oldState=old.diagnostics.find((d:any)=>d.kind==='selected').state;
   const currentState=current.diagnostics.find((d:any)=>d.kind==='selected').state;
   const oldPoint={thickness:old.thickness,...old.parameters};
   // Keep the old solution's free-parameter set, including terms absent from the current winner.
   experiments.push(await replay(p,points,oldState,oldPoint,'old-best-point in current model'));
   experiments.push(await replay(p,points,currentState,{thickness:current.thickness,...current.parameters},'current-best-point replay'));
   save('lorentz-'+scenario+'-replays',experiments);
   console.log('REPLAYS '+JSON.stringify(experiments));
   const candidates=runs.flatMap(r=>r.diagnostics.find((d:any)=>d.kind==='starts').states.map((s:any)=>{
    const selected=r.diagnostics.find((d:any)=>d.kind==='selected').state;
    const calls=r.calls.filter((c:any)=>c.line>=1540&&c.line<1640);
    const c=calls[s.startIndex-1];
    return {revision:r.label,startIndex:s.startIndex,selected:s.startIndex===selected.startIndex,
     initialThickness:s.initialThickness,initialParams:s.initialParamsRecord,finalThickness:s.layers[0].thickness,
     finalParams:Object.fromEntries(Object.entries(s.layers[0].parameters).map(([id,p]:[string,any])=>[id,p.current])),fullCost:s.weightedMse,
     iterations:s.iterations,converged:s.converged,status:s.convergenceStatus,bounds:c?.initial,
     finalPolishes:r.calls.filter((c:any)=>c.options.maxIterations===100&&c.options.tolerance===1e-6).map(({residualFn,options,...c}:any)=>c)};
   }));
   save('lorentz-'+scenario+'-candidates',candidates);
   // Full candidate table remains a local raw output, never a tracked fixture.
   writeFileSync(`.qa/stage4_5-lorentz-${scenario}-candidates.log`,candidates.map(c=>JSON.stringify(c)).join('\n')+'\n');
  }
 }
}
