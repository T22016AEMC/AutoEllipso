import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {calculatePoint,calculateSpectrum} from '../src/solver/calculator';
import {computeResidualMetrics,circularDifferenceDeg,residualWeights} from '../src/fitting/residual';
import {optimizeBoundedLM,OptimizationVariable} from '../src/fitting/optimizer';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {stage41Fixture} from './stage4_1-fixture';
import {fixture,truthCases} from './stage4_5-support';

export const settings=Object.freeze({base:'f2da2d1fd275482c3b0d541c8be9cac3baeadd50',maxIterations:100,tolerance:1e-6,
 S0:2,S1:4,S2:6,S3:{first:10,survivors:4,second:90,lambdaReset:'existing optimizer default .01'},
 S4:{base:2,extra:2,features:'fitted E0/E02/E03 and sigma/gamma/C widths; shared active features; RMS range-normalized maximin; rank tie-break'},
 lowFinalFactor:1.1,highCoarseFactor:10,timing:'prefix + sums of serial measured calls; estimates to physical-selection endpoint; excludes final verification/M2',
 retention:'all rules retain original best coarse state; S3 also retains evaluated 10-step states',ties:'oracle/survivors: lower coarse rank; final rule output: last evaluated <= as in formal; Spearman exact ties receive average rank'});
export const models=['gaussian','lorentz','tauc_lorentz'];
export const groups=[...['SiO2','absorbing','transparent','weak'].flatMap(scenario=>models.map(model=>({id:scenario+'-'+model,scenario,model}))),
 ...truthCases.map(t=>({id:t.id+'-'+t.model,scenario:t.id,model:t.model}))];
export const save=(name:string,value:unknown)=>{mkdirSync('.qa',{recursive:true});writeFileSync(`.qa/stage4_6a-${name}.json`,JSON.stringify(value,null,2));};
export const read=(name:string)=>JSON.parse(readFileSync(`.qa/stage4_6a-${name}.json`,'utf8'));
export function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src'],{encoding:'utf8'}),'');assert.equal(execFileSync('git',['status','--porcelain','--','src'],{encoding:'utf8'}),'');}
export function data(group:typeof groups[number]) {
 if(group.scenario.startsWith('T')){const f=fixture(Number(group.scenario.slice(1))-1);return {project:f.project,points:f.points,truth:f.truth};}
 const project=createMultiAoiSiO2OnSiProject();return {project,points:group.scenario==='SiO2'?project.experimentData!.points:stage41Fixture(group.scenario as 'absorbing'|'transparent'|'weak').points,truth:undefined};
}
const root=resolve('.qa/stage46a-source');
function once(s:string,a:string,b:string){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
export function prepare() {
 guard();mkdirSync(root,{recursive:true});const zip=resolve('.qa/stage46a-source.zip');execFileSync('git',['archive','--format=zip','--output='+zip,settings.base,'src']);
 if(process.platform==='win32')execFileSync('powershell',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${zip.replaceAll("'","''")}' -DestinationPath '${root.replaceAll("'","''")}' -Force`]);
 else execFileSync('unzip',['-o',zip,'-d',root]);
 const file=resolve(root,'src/fitting/autoWorkflow.ts'),original=readFileSync(file,'utf8');
 let source=original.replace(/await optimizeBoundedLM\(/g,(_match,offset)=>`await captureAt(${original.slice(0,offset).split('\n').length})(`);
 source=once(source,'      multiStartRuns.push({',`      diagnosticCoarse.push({modelId:cModelId,startIndex:startIdx+1,initial:structuredClone(activeVars),
        result:structuredClone(optRes),points:ptsForStart.length,maxIterations:useFullPtsImmediately?25:14});
      multiStartRuns.push({`);
 source=once(source,'    // Polish the top 2 winning starts on the complete experimental spectrum with tight tolerance',`    diagnosticContexts.push({modelId:cModelId,states:structuredClone(startStates),coarse:structuredClone(diagnosticCoarse.filter(c=>c.modelId===cModelId)),
      ambient:structuredClone(ambient),substrate:structuredClone(substrate),points:structuredClone(fittingPoints),config:structuredClone(config),
      primaryLayerIndex,tMin,tMax,prefixElapsedMs:performance.now()-diagnosticStartedAt,
      prefixIterations:diagnosticCalls.reduce((sum,c)=>sum+c.result.iterations,0)});
    // Polish the top 2 winning starts on the complete experimental spectrum with tight tolerance`);
 source=once(source,'    // Update the corresponding record in multiStartRuns',`    diagnosticContexts[diagnosticContexts.length-1].selected=structuredClone(bestStartState);
    // Update the corresponding record in multiStartRuns`);
 source=`export const diagnosticCalls:any[]=[],diagnosticContexts:any[]=[],diagnosticCoarse:any[]=[];
let diagnosticStartedAt=0;
export function diagnosticReset(){diagnosticCalls.length=0;diagnosticContexts.length=0;diagnosticCoarse.length=0;diagnosticStartedAt=performance.now();}
`+source+`
function captureAt(line:number){return async(variables:any[],residualFn:any,options:any)=>{
 const initial=structuredClone(variables),start=performance.now(),result=await optimizeBoundedLM(variables,residualFn,options);
 diagnosticCalls.push({line,initial,options,elapsedMs:performance.now()-start,result:structuredClone(result)});return result;
};}
`;
 writeFileSync(file,source);save('settings',settings);
}
export async function workflow(){return import(pathToFileURL(resolve(root,'src/fitting/autoWorkflow.ts')).href);}

/** Same assignment order, full-data residual and options as the formal polish closure; no coarse TL projection. */
export async function polish(ctx:any,state:any,maxIterations=100,initial?:number[]) {
 const layers=structuredClone(state.layers),layer=layers[ctx.primaryLayerIndex];
 const variables:OptimizationVariable[]=[{id:'thickness',name:'Thickness',value:layer.thickness,min:ctx.tMin,max:ctx.tMax}];
 for(const [id,p] of Object.entries(layer.parameters) as [string,any][])if(p.fit)variables.push({id,name:p.name||id,value:p.current,min:p.min,max:p.max});
 if(initial)variables.forEach((v,i)=>v.value=initial[i]);
 const residual=(p:number[])=>{
  layer.thickness=p[0];let j=1;
  for(const [id,v] of Object.entries(layer.parameters) as [string,any][])if(v.fit)layer.parameters[id].current=p[j++];
  return ctx.points.flatMap((pt:any)=>{const c=calculatePoint(ctx.ambient,layers,ctx.substrate,pt.wavelength,pt.aoi);return[c.psiDeg-pt.psiExp,circularDifferenceDeg(c.deltaDeg,pt.deltaExp)];});
 };
 const start=performance.now(),result=await optimizeBoundedLM(variables,residual,{maxIterations,tolerance:settings.tolerance,residualWeights:residualWeights(ctx.points,ctx.config).weights,shouldStop:undefined});
 residual(result.finalParams);
 const metrics=computeResidualMetrics(calculateSpectrum(ctx.ambient,layers,ctx.substrate,ctx.points),ctx.config.fitWeighting,ctx.config.psiWeight,ctx.config.deltaWeight,variables.length);
 return {startIndex:state.startIndex,rank:state.rank,variables,result,metrics,cost:metrics.weightedMse,mseWoollam:metrics.mseWoollam,
  iterations:result.iterations,converged:result.converged,status:result.status,elapsedMs:performance.now()-start,thickness:layer.thickness,
  parameters:Object.fromEntries(Object.entries(layer.parameters).map(([id,v]:[string,any])=>[id,v.current]))};
}
function ranks(values:number[]) {
 const order=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),r=values.map(()=>0);
 for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j].v===order[i].v)j++;for(let k=i;k<j;k++)r[order[k].i]=(i+1+j)/2;i=j;}return r;
}
export function spearman(a:number[],b:number[]) {
 assert.equal(a.length,b.length);const x=ranks(a),y=ranks(b),mean=(a.length+1)/2;
 const numerator=x.reduce((s,v,i)=>s+(v-mean)*(y[i]-mean),0),denominator=Math.sqrt(x.reduce((s,v)=>s+(v-mean)**2,0)*y.reduce((s,v)=>s+(v-mean)**2,0));
 return denominator?numerator/denominator:null;
}
const features=/^(E0[23]?|sigma[23]?|gamma[23]?|C[23]?)$/;
export function diverse(states:any[]) {
 // shortcut: mandated fixtures have one layer; use primaryLayerIndex before diagnosing multilayers.
 const selected=states.slice(0,2),rows:any[]=[];
 const distance=(a:any,b:any)=>{
  const av=a.layers[0].parameters,bv=b.layers[0].parameters;
  const keys=Object.keys(av).filter(k=>features.test(k)&&av[k].fit&&bv[k]?.fit&&Math.max(av[k].max,bv[k].max)>Math.min(av[k].min,bv[k].min));
  return keys.length?Math.sqrt(keys.reduce((s,k)=>s+((av[k].current-bv[k].current)/(Math.max(av[k].max,bv[k].max)-Math.min(av[k].min,bv[k].min)))**2,0)/keys.length):0;
 };
 while(selected.length<Math.min(4,states.length)) {
  const candidates=states.filter(s=>!selected.includes(s)).map(s=>({state:s,distance:Math.min(...selected.map(q=>distance(s,q)))})).sort((a,b)=>b.distance-a.distance||a.state.rank-b.state.rank);
  const pick=candidates[0];selected.push(pick.state);rows.push({startIndex:pick.state.startIndex,rank:pick.state.rank,distance:pick.distance});
 }
 return {selected,rows};
}
export function selfCheck() {
 assert.equal(spearman([1,2,3],[3,2,1]),-1);assert.equal(spearman([1,1,3],[1,1,2]),1);assert.equal(spearman([1,1],[2,3]),null);
 const state=(rank:number,value:number)=>({rank,startIndex:rank,layers:[{parameters:{E0:{current:value,min:0,max:10,fit:true}}}]});
 const d=diverse([state(1,1),state(2,2),state(3,3),state(4,9),state(5,6)]);
 assert.deepEqual(d.selected.map(s=>s.rank),[1,2,4,5]);console.log('SELF-CHECK: exact-tie Spearman and deterministic peak-distance maximin passed');
}
