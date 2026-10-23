import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {modelRegistry} from '../src/modelRegistry/registry';
import {cubicBasis} from '../src/models/cubicSpline';
export {difference} from './stage4_6b-run';

export const settings={base:'21799a2af7f5180cfdf18abdfe950ef201de19ad',fixtureSeed:45001,randomSeeds:[61001,61002,61003],
 controls:'original refineFreeForm: 40 nodes/full data/100 iterations/ftol=1e-5/default xtol,gtol/lambdaN=.25/lambdaK=.6',
 P9:'coarse ranks 1..4: reuse actual formal rank1/2 polish, additionally polish rank3/4 with original 100/1e-6; rank order; retain <=3 unique endpoints different from P1',
 distance:'max range-normalized difference over thickness and P1 fitted parameter IDs; P1 bounds; <1e-6 duplicates',
 selection:'R0 original chooseFreeFormOrigin incl relative 1e-6 tie; R1..Oracle lowest MSE_W, exact tie lowest totalCost then fixed evaluation order',
 R0:['P1','P7_original'],R1:['P1','P5','P7'],R2:['P1','P9*'],R3:['P1','P10*'],R4:['P1','P5','P7','P9*','P10*'],
 oraclePool:['P3','P4','P6','P8a','P8b','P8c'],median:'lower median, rank12 of24',
 P10:[-5,5,-10,10],random:'same as 4.6b: six cubic controls, n +/-15%, k additive 0.. .1, d +/-5; LCG seeds fixed',
 regret:'W(strategy)-W(Oracle); relative /W(Oracle); strictly >0 counts, no numerical threshold; no truth in selection',
 badP1:'P1 refined / Oracle >=2 AND absolute W gap >=1',rescue:'selected W <=1.01*Oracle W; diagnostic category only',
 timing:'serial wall time sums of free-form calls, includes final statistics; P9 extra physical rank3/4 polish separately and inclusive cost for R2/R4/Oracle; common Automatic excluded',
 oracleMeaning:'finite specified refined-start pool, not a proven global minimum; raw ladder belongs only to R0, negative R0 regret retained if it occurs'};
export const groups=['T1','T2','T3','T4'].flatMap(truth=>['gaussian','lorentz','tauc_lorentz'].map(model=>({id:truth+'-'+model,truth,model,matched:model===({T1:'tauc_lorentz',T2:'gaussian',T3:'lorentz',T4:'gaussian'}[truth])})));
export const save=(name:string,value:unknown)=>{mkdirSync('.qa',{recursive:true});writeFileSync(`.qa/stage4_6c-${name}.json`,JSON.stringify(value,null,2));};
export const read=(name:string)=>JSON.parse(readFileSync(`.qa/stage4_6c-${name}.json`,'utf8'));
export function guard(){assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'v2.2-integration');assert.equal(execFileSync('git',['diff',settings.base,'--','src','.github','wrangler.jsonc','.node-version','package.json','pnpm-lock.yaml'],{encoding:'utf8'}),'');assert.equal(execFileSync('git',['status','--porcelain','--','src'],{encoding:'utf8'}),'');}
const root=resolve('.qa/stage46c-source');
export function prepare(){
 guard();cpSync(resolve('src'),resolve(root,'src'),{recursive:true,force:true});
 const file=resolve(root,'src/fitting/autoWorkflow.ts'),original=readFileSync(file,'utf8').replaceAll('\r\n','\n');
 const once=(s:string,a:string,b:string)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b);};
 let source=original.replace(/await optimizeBoundedLM\(/g,(_match,offset)=>`await captureAt(${original.slice(0,offset).split('\n').length})(`);
 const anchor='    // Polish the top 2 winning starts on the complete experimental spectrum with tight tolerance';
 source=once(source,anchor,`    diagnosticContexts.push({modelId:cModelId,states:structuredClone(startStates),ambient:structuredClone(ambient),
      substrate:structuredClone(substrate),points:structuredClone(fittingPoints),config:structuredClone(config),primaryLayerIndex,tMin,tMax});\n`+anchor);
 const selected='    // Update the corresponding record in multiStartRuns';
 source=once(source,selected,'    diagnosticContexts[diagnosticContexts.length-1].selected=structuredClone(bestStartState);\n'+selected);
 const refine="  if(!freeFormWarning) {\n    reportProgress({stage:'stage_free_form_refine'";
 source=once(source,refine,"  if(false && !freeFormWarning) { // diagnostic: stop before production M2\n    reportProgress({stage:'stage_free_form_refine'");
 source=`export const diagnosticCalls:any[]=[],diagnosticContexts:any[]=[];
export function diagnosticReset(){diagnosticCalls.length=0;diagnosticContexts.length=0;}
`+source+`
function captureAt(line:number){return async(variables:any[],residualFn:any,options:any)=>{
 const initial=structuredClone(variables),start=performance.now(),result=await optimizeBoundedLM(variables,residualFn,options);
 diagnosticCalls.push({line,initial,options,elapsedMs:performance.now()-start,result:structuredClone(result)});return result;
};}
`;
 writeFileSync(file,source);
 save('settings',settings);
}
export async function workflow(){return import(pathToFileURL(resolve(root,'src/fitting/autoWorkflow.ts')).href);}
export const parameter=(id:string,current:number)=>({id,name:id,current,initial:current,min:0,max:2500,fit:false,unit:''});
export function endpoint(state:any,values:number[],index:number){const layers=structuredClone(state.layers),l=layers[index];l.thickness=values[0];let j=1;for(const p of Object.values(l.parameters) as any[])if(p.fit)p.current=values[j++];assert.equal(j,values.length);return layers;}
export function distance(a:any[],b:any[],index:number,template:any,tMin:number,tMax:number){
 const values=[Math.abs(a[index].thickness-b[index].thickness)/Math.max(tMax-tMin,Number.MIN_VALUE)];
 for(const [id,p] of Object.entries(template.parameters) as [string,any][])if(p.fit&&p.max>p.min)values.push(Math.abs(a[index].parameters[id].current-b[index].parameters[id].current)/(p.max-p.min));
 return Math.max(...values);
}
export function transient(layers:any[],index:number,id:string,calculate:(w:number)=>{n:number;k:number},thickness:number){
 const base=modelRegistry.get('constant_nk')!;modelRegistry.register({...base,id,calculate:w=>{const p=calculate(w);return{...p,eps1:p.n*p.n-p.k*p.k,eps2:2*p.n*p.k};},calculateN:w=>calculate(w).n,calculateK:w=>calculate(w).k});
 const out=structuredClone(layers);out[index].modelId=id;out[index].parameters={};out[index].thickness=thickness;return out;
}
export function perturb(seed:number,lo:number,hi:number){
 let state=seed;const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 const n=Array.from({length:6},()=>2*rng()-1),k=Array.from({length:6},()=>rng()),d=10*rng()-5,knots=n.map((_,i)=>lo+(hi-lo)*i/5);
 return{n,k,d,at:(w:number)=>{const b=cubicBasis(w,knots);return{n:b.reduce((s,v,i)=>s+v*n[i],0),k:b.reduce((s,v,i)=>s+v*k[i],0)};}};
}
export function choose(rows:any[]){return [...rows].sort((a,b)=>a.mseWoollam-b.mseWoollam||a.totalCost-b.totalCost)[0];}
export function selfCheck(){
 assert.equal(choose([{id:1,mseWoollam:2,totalCost:0},{id:2,mseWoollam:1,totalCost:10},{id:3,mseWoollam:1,totalCost:5}]).id,3);
 const a=[{thickness:100,parameters:{x:{current:1,fit:true,min:0,max:10}}}],b=structuredClone(a);b[0].parameters.x.current+=1e-7;
 assert.ok(distance(a,b,0,a[0],40,200)<1e-6);b[0].thickness+=1;assert.ok(distance(a,b,0,a[0],40,200)>1e-6);
 const p=perturb(61001,190,900),q=perturb(61001,190,900);assert.deepEqual([p.n,p.k,p.d],[q.n,q.k,q.d]);
 for(let w=190;w<=900;w++){const r=p.at(w);assert.ok(r.n>=-1&&r.n<=1&&r.k>=0&&r.k<=1);}
 console.log('SELF-CHECK: selection, parameter-distance deduplication and deterministic bounded perturbation passed');
}
