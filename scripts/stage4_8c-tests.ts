import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {freeFormSteps,legalFreeForm,selectFreeForm,runFreeFormLadder,LadderStep} from '../src/fitting/freeFormLadder';
import {refineFreeForm} from '../src/fitting/freeFormRefine';
import {refineDiagnostic} from './stage4_6d-refine';
import {BSplineModel,MAX_BSPLINE_NODES,generateAdaptiveKnots} from '../src/models/bspline';
import {cubicEvaluate} from '../src/models/cubicSpline';
import {stage45dTests} from './stage4_5d-tests';
import {importProjectJson} from '../src/data/export';
const read=(name:string)=>JSON.parse(readFileSync(`.qa/stage4_8a-${name}.json`,'utf8'));
const save=(name:string,value:unknown)=>writeFileSync(`.qa/stage4_8c-${name}.json`,JSON.stringify(value,null,2)+'\n');
const rows=():LadderStep[]=>freeFormSteps(432).map((setting,i)=>({...setting,status:'cost',converged:true,dof:350,rawRSS:350*(1-i*.03)**2,w:1-i*.03,accepted:false,legal:true,elapsedMs:1}));
export async function units(){
 const start=performance.now(),checks:string[]=[];
 const test=(name:string,fn:()=>void)=>{fn();checks.push(name);};
 test('legal guards',()=>{const row=rows()[0];assert.equal(legalFreeForm(row,432),true);for(const bad of [{status:'step'},{converged:false},{dof:0},{count:109}])assert.equal(legalFreeForm({...row,...bad},432),false);});
 test('strict drop and earlier ties',()=>{const choice=selectFreeForm(rows(),'sigma');assert.deepEqual(choice.selected,{count:80,scale:.01});assert.deepEqual(choice.steps.map(q=>q.accepted),[true,false,true,false,true]);const same=rows().map(q=>({...q,w:1}));assert.equal(selectFreeForm(same,'sigma').selected!.scale,1);});
 test('sigma estimate unavailable fallback',()=>{for(const bad of [{legal:false},{rawRSS:0},{rawRSS:Infinity}]){const r=rows();Object.assign(r[4],bad);const c=selectFreeForm(r,'sigmaHat');assert.equal(c.sigmaUnavailable,true);assert.equal(c.fallback,true);assert.deepEqual(c.selected,{count:40,scale:1});}});
 test('small ladder guard and no candidate',()=>{assert.equal(freeFormSteps(160)[0].count,40);assert.deepEqual(freeFormSteps(159).map(s=>s.count),[12,12,12,16,20,24]);const r=rows().map((q,i)=>({...q,...freeFormSteps(96)[i]}));r[0].legal=false;const c=selectFreeForm(r,'sigmaHat');assert.equal(c.noAvailableCandidate,true);assert.equal(c.selected,null);assert.equal(c.fallback,false);});
 test('extended output opt in only',()=>{assert.equal(MAX_BSPLINE_NODES,40);assert.equal(generateAdaptiveKnots(190,900,80).length,40);assert.equal(BSplineModel.parameters.filter(p=>/^N\d+$/.test(p.id)).length,40);const knots=Array.from({length:80},(_,i)=>190+710*i/79),coeff=knots.map((_,i)=>1+i/80),p:any={_knotCount:80};knots.forEach((w,i)=>{p['_knot'+i]=w;p['N'+i]=coeff[i];p['K'+i]=0;});assert.equal(BSplineModel.calculate(800,p).n,cubicEvaluate(800,knots.slice(0,40),coeff.slice(0,40)));p._freeFormLadderV2=1;assert.equal(BSplineModel.calculate(800,p).n,cubicEvaluate(800,knots,coeff));});
 const f=read('V2-49001-data'),P1=read('V2-49001-automatic').output.updatedLayers;
 const options={ambient:f.project.ambient,layers:P1,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig,outputWavelengths:f.optics.map((q:any)=>q.wavelength)};
 const equivalence=[];
 for(const [count,scale] of [[40,1],[80,.01],[12,1]]){
  const opts=count===12?{...options,points:f.points.filter((q:any)=>(q.wavelength-190)%20===0)}:options;
  const formal=await refineFreeForm({...opts,ladderSetting:{count,scale}}),copy=await refineDiagnostic({count,scale,distribution:'wavelength'},opts);
  const difference=Math.max(...formal.result.finalParams.map((v,i)=>Math.abs(v-copy.result.finalParams[i])),...formal.curve.flatMap((q,i)=>[Math.abs(q.n-copy.curve[i].n),Math.abs(q.k-copy.curve[i].k)]),Math.abs(formal.metrics.mseWoollam-copy.metrics.mseWoollam));
  assert.ok(difference<=1e-9);assert.equal(formal.statistics.dof,copy.statistics.dof);assert.deepEqual(formal.statistics.covariance.ids,copy.statistics.covariance.ids);
  equivalence.push({count,scale,difference});
 }
 checks.push('40/80/sparse12 diagnostic equivalence <=1e-9');
 let stopped=false,published=false,completed=0;
 await assert.rejects(async()=>{const result=await runFreeFormLadder({...options,shouldStop:()=>stopped},'sigma',()=>{completed++;stopped=true;});published=!!result;},/使用者中止/);
 assert.equal(completed,1);assert.equal(published,false);assert.deepEqual(options.layers,P1);checks.push('cancellation after completed fit publishes no partial result');
 const result={checks,equivalence,elapsedMs:performance.now()-start};save('unit-tests',result);return result;
}
export async function related(){const start=performance.now(),tests:any[]=[];await stage45dTests(async(name,fn)=>{try{await fn();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,detail:String(error)});save('related-tests',{tests,elapsedMs:performance.now()-start});throw error;}});save('related-tests',{tests,elapsedMs:performance.now()-start});}
export async function selectors(){
 const start=performance.now(),checks=[];
 for(let truth=0;truth<7;truth++)for(const seed of [49001,49002,49003]){
  const id=`V${truth}`,steps=freeFormSteps(432).map(setting=>{
   const fit=read(`${id}-${seed}-${setting.count}Ws${setting.scale}`);
   return {...setting,status:fit.status,converged:fit.converged,dof:fit.dof,rawRSS:fit.metrics.rawMse*fit.N,
    w:fit.metrics.mseWoollam,accepted:false,legal:legalFreeForm({...setting,status:fit.status,converged:fit.converged,dof:fit.dof},fit.N),elapsedMs:fit.elapsedMs};
  });
  for(const mode of ['sigma','sigmaHat'] as const){
   const selection=selectFreeForm(steps.map(s=>({...s})),mode),chosen=selection.selected!;
   const expected=mode==='sigma'?read(`${id}-${seed}-rules`).rules.find((r:any)=>r.rule==='R1c').selected:
    JSON.parse(readFileSync(`.qa/stage4_8b-${id}-${seed}-choices.json`,'utf8')).choices.find((r:any)=>r.rule==='N3').selected;
   assert.equal(`${chosen.count}Ws${chosen.scale}`,expected);checks.push({id,seed,mode,selected:expected});
  }
 }
 save('selector-tests',{checks,elapsedMs:performance.now()-start});
}
export async function resumeRelated(){
 const prior=JSON.parse(readFileSync('.qa/stage4_8c-related-tests.json','utf8')),tests=prior.tests.filter((t:any)=>t.passed),start=performance.now();
 // Keep every assertion verbatim; the isolated import supplies the already saved T2 Automatic once.
 const wrapper=`import {runAutomatedEllipsometryFit as real} from '../src/fitting/autoWorkflow';
import {readFileSync} from 'node:fs';
import {fixture} from '../scripts/stage4_5c-support';
let used=false;
export async function runAutomatedEllipsometryFit(options:Parameters<typeof real>[0]):ReturnType<typeof real>{
 if(!used&&JSON.stringify(options.points)===JSON.stringify(fixture('T2').points)){
  used=true;const stored=JSON.parse(readFileSync('.qa/stage4_5d-T2.json','utf8'));
  for(const progress of stored.progress)options.onProgress?.(progress);return stored.output;
 }return real(options);
}`;
 writeFileSync('.qa/stage4_8c-cache.ts',wrapper);
 const copied=readFileSync('scripts/stage4_5d-tests.ts','utf8').replaceAll("from './","from '../scripts/")
  .replace("from '../src/fitting/autoWorkflow'","from './stage4_8c-cache'");
 writeFileSync('.qa/stage4_8c-related-copy.ts',copied);
 const f=read('V2-49001-data'),model=structuredClone(read('V2-49001-80Ws0.01').out.model);
 model.layers[0].parameters._freeFormLadderV2={id:'_freeFormLadderV2',name:'_freeFormLadderV2',unit:'',current:1,initial:1,min:1,max:1,fit:false};
 model.layers[0].parameters._knotCount.max=80;
 const project={...f.project,deltaConventionVersion:2,fittingResult:{freeFormModel:model}};
 assert.equal(importProjectJson(JSON.stringify(project)).fittingResult!.freeFormModel!.layers[0].parameters._knotCount.current,80);
 const unmarked=structuredClone(project);delete unmarked.fittingResult.freeFormModel.layers[0].parameters._freeFormLadderV2;
 assert.throws(()=>importProjectJson(JSON.stringify(unmarked)),/from 4 to 40/);
 const primary=structuredClone(project);primary.layers=model.layers;
 assert.throws(()=>importProjectJson(JSON.stringify(primary)),/from 4 to 40/);
 save('roundtrip-tests',{passed:3,elapsedMs:performance.now()-start});
 const resumeModule='../.qa/stage4_8c-related-copy.ts';
 const {stage45dTests:run}=await import(resumeModule);
 await run(async(name:string,fn:()=>Promise<void>|void)=>{
  if(tests.some((t:any)=>t.name===name))return;
  try{await fn();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,detail:String(error)});save('related-tests',{tests,elapsedMs:prior.elapsedMs+performance.now()-start});throw error;}
  save('related-tests',{tests,elapsedMs:prior.elapsedMs+performance.now()-start,resume:{savedAutomaticReused:['T2'],fittedResultsRerun:0,scope:'T2 assertion/roundtrip only; T0/T1 skipped; remaining tests first execution'}});
 });
}
export async function guarded(){
 const start=performance.now(),f=read('V2-49001-data');let events=0;
 const result=await runFreeFormLadder({ambient:f.project.ambient,layers:f.project.layers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points.slice(0,3),config:f.project.fittingConfig},'sigmaHat',()=>{events++;});
 assert.equal(events,6);assert.equal(result.selection.noAvailableCandidate,true);assert.equal(result.selection.fallback,false);
 assert.equal(result.output,undefined);assert.ok(result.selection.steps.every(s=>s.guarded&&s.elapsedMs===0));
 save('guarded-tests',{passed:1,elapsedMs:performance.now()-start});
}
if(process.argv[1]?.endsWith('stage4_8c-tests.ts'))(process.argv[2]==='related'?related():process.argv[2]==='resume-related'?resumeRelated():process.argv[2]==='selectors'?selectors():process.argv[2]==='guarded'?guarded():units()).catch(error=>{save('stopped',{stage:process.argv[2]??'unit',error:String(error),at:new Date().toISOString()});process.exitCode=1;});
