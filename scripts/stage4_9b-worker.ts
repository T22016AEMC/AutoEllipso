/** Diagnostic-only substrate registration; original source files are never patched. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelRegistry} from '../src/modelRegistry/registry';
import {getSiliconOpticalConstants} from '../src/optics/materials';
import {Complex} from '../src/optics/complex';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {calculatePoint} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {circularDifferenceDeg,residualWeights} from '../src/fitting/residual';
import {optimizeBoundedLM,centralDifferenceJacobian} from '../src/fitting/optimizer';
import {computeFitStatistics} from '../src/fitting/statistics';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';

const settings=JSON.parse(readFileSync('.qa/stage4_9b-settings.json','utf8'));
function statistic(rows:any[],key:string){
 const valid=rows.filter(p=>Number.isFinite(p[key]));if(!valid.length)return null;
 const at=valid.reduce((a,b)=>Math.abs(b[key])>Math.abs(a[key])?b:a);
 return {maxAbs:Math.abs(at[key]),at_nm:at.wavelength,rms:Math.sqrt(valid.reduce((s,p)=>s+p[key]**2,0)/valid.length),bias:valid.reduce((s,p)=>s+p[key],0)/valid.length,points:valid.length,missing:rows.length-valid.length};
}
function regions(rows:any[],mapping:Record<string,string>){
 return [...settings.bands,[190,settings.hc_eVnm/6.5,false]].map(([lo,hi,closed]:[number,number,boolean])=>{
  const subset=rows.filter(p=>p.wavelength>=lo&&(closed?p.wavelength<=hi:p.wavelength<hi));
  return {band:[lo,hi,closed],points:subset.length,...Object.fromEntries(Object.entries(mapping).map(([name,key])=>[name,statistic(subset,key)]))};
 });
}
function makeCase(req:any){
 const film=settings.films[req.film],definition=modelRegistry.get(film.model)!;
 const params=modelRegistry.createParameterSet(film.model);
 assert.deepEqual(Object.keys(params).sort(),Object.keys(film.parameters).sort());
 for(const [key,p]of Object.entries(params)){p.current=p.initial=film.parameters[key];p.fit=film.fit.includes(key);}
 const layer:any={id:'audit-film',name:film.id,modelId:film.model,parameters:params,thickness:req.thickness,thicknessInitial:req.thickness,thicknessMin:1,thicknessMax:200,thicknessFit:true};
 const ambient={name:'Air',n:1,k:0};
 let substrate:any={name:'Current Si',materialType:'tabulated',modelId:'tabulated_si',parameters:modelRegistry.createParameterSet('tabulated_si')};
 if(req.candidate!=='C0'){
  const grid=req.fitSi;assert.ok(grid.length>1);const byWavelength=new Map<number,any>(grid.map((p:any)=>[p.wavelength,p]));
  modelRegistry.register({id:'audit_si',name:'RAM-only audit Si',type:'tabulated',parameters:[],fitSupported:false,calculate:(w:number)=>{
   assert.ok(w>=grid[0].wavelength-1e-9&&w<=grid.at(-1).wavelength+1e-9,'audit substrate outside provided native-valid domain');
   const exact=byWavelength.get(w);if(exact)return{n:exact.n,k:exact.k};
   const upper=grid.findIndex((p:any)=>p.wavelength>=w);const hi=upper<0?grid.length-1:upper;
   if(hi===0||grid[hi].wavelength===w)return{n:grid[hi].n,k:grid[hi].k};
   const lo=hi-1,u=(w-grid[lo].wavelength)/(grid[hi].wavelength-grid[lo].wavelength);
   return{n:grid[lo].n+(grid[hi].n-grid[lo].n)*u,k:grid[lo].k+(grid[hi].k-grid[lo].k)*u};
  }} as any);
  substrate={name:req.candidate,materialType:'tabulated',modelId:'audit_si',parameters:{}};
 }
 let seed=req.seed;
 const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
 const points:any[]=[],truth:any[]=[],forward:any[]=[];
 for(const si of req.truthSi)truth.push({wavelength:si.wavelength,...definition.calculate(si.wavelength,film.parameters)});
 for(const aoi of settings.aois)for(let i=0;i<req.truthSi.length;i++){
  const si=req.truthSi[i],optical=truth[i];
  const actual=solveEllipsometryTMM(new Complex(1,0),[{thicknessNm:req.thickness,N:new Complex(optical.n,optical.k)}],new Complex(si.n,si.k),si.wavelength,aoi);
  const radius=Math.sqrt(-2*Math.log(rng())),angle=2*Math.PI*rng();
  const point={wavelength:si.wavelength,aoi,psiExp:actual.psiDeg+.03*radius*Math.cos(angle),deltaExp:normalizeDeltaDeg(actual.deltaDeg+.03*radius*Math.sin(angle)),psiSigma:.03,deltaSigma:.03,weight:1};
  if(req.fitRange&&(si.wavelength<req.fitRange[0]||si.wavelength>req.fitRange[1]))continue;
  points.push(point);
  const fitted=calculatePoint(ambient,[layer],substrate,si.wavelength,aoi);
  forward.push({wavelength:si.wavelength,aoi,psiError:fitted.psiDeg-actual.psiDeg,deltaError:circularDifferenceDeg(fitted.deltaDeg,actual.deltaDeg)});
 }
 const range=req.fitRange??[req.truthSi[0].wavelength,req.truthSi.at(-1).wavelength];
 return{ambient,layer,substrate,points,forward,truth:truth.filter(p=>p.wavelength>=range[0]&&p.wavelength<=range[1]),definition,film,range};
}
function errors(curve:any[],truth:any[],thickness:number,actual:number){
 const rows=truth.map(q=>{const p=curve.find(p=>p.wavelength===q.wavelength);assert.ok(p);return{wavelength:q.wavelength,nError:p.n-q.n,kError:p.k-q.k};});
 return{thicknessError:thickness-actual,regions:regions(rows,{n:'nError',k:'kError'}),rows};
}
async function local(req:any){
 const started=performance.now(),c=makeCase(req);
 const variables=[{id:'thickness',name:'thickness',value:req.thickness,min:1,max:200},...c.film.fit.map((id:string)=>{const p=c.layer.parameters[id];return{id,name:id,value:p.current,min:p.min,max:p.max};})];
 const apply=(v:number[])=>{c.layer.thickness=v[0];c.film.fit.forEach((id:string,i:number)=>c.layer.parameters[id].current=v[i+1]);};
 const residual=(v:number[])=>{apply(v);return c.points.flatMap(p=>{const q=calculatePoint(c.ambient,[c.layer],c.substrate,p.wavelength,p.aoi);return[q.psiDeg-p.psiExp,circularDifferenceDeg(q.deltaDeg,p.deltaExp)];});};
 const weights=residualWeights(c.points,{fitWeighting:'standard_deviation',psiWeight:1,deltaWeight:1}).weights;
 const result=await optimizeBoundedLM(variables,residual,{maxIterations:50,tolerance:1e-5,initialLambda:.01,residualWeights:weights});
 apply(result.finalParams);
 const parameters=()=>Object.fromEntries(Object.entries(c.layer.parameters).map(([key,p]:[string,any])=>[key,p.current]));
 const curve=c.truth.map(q=>({wavelength:q.wavelength,...c.definition.calculate(q.wavelength,parameters())}));
 const output:any={elapsedMs:0,result,points:c.points,forward:regions(c.forward,{psi:'psiError',delta:'deltaError'}),forwardRows:c.forward,errors:errors(curve,c.truth,c.layer.thickness,req.thickness),fitted:parameters(),thickness:c.layer.thickness};
 if(req.statistics){
  const statistics=computeFitStatistics(variables,result.finalParams,residual,{weights});
  const curveFn=(v:number[])=>{apply(v);return c.truth.flatMap(q=>{const p=c.definition.calculate(q.wavelength,parameters());return[p.n,p.k];});};
  const jacobian=centralDifferenceJacobian(variables,result.finalParams,curveFn,()=>false);
  apply(result.finalParams);
  const rows=c.truth.map((q,i)=>{
   const sigma=(component:number)=>{
    const ids=statistics.covariance.ids,indices=ids.map(id=>variables.findIndex(v=>v.id===id));
    if(!ids.length||statistics.parameters.some(p=>p.nonIdentifiable&&!p.locked))return null;
    const derivative=indices.map(j=>jacobian[2*i+component][j]/(variables[j].max-variables[j].min));
    const variance=derivative.reduce((sum,x,j)=>sum+x*derivative.reduce((s,y,k)=>s+y*statistics.covariance.matrix[j][k],0),0);
    return Number.isFinite(variance)&&variance>=0?Math.sqrt(variance):null;
   };
   return{wavelength:q.wavelength,nSigma:sigma(0),kSigma:sigma(1)};
  });
  output.statistics=statistics;output.uncertaintyRows=rows;output.uncertainty=regions(rows,{n:'nSigma',k:'kSigma'});
 }
 output.elapsedMs=performance.now()-started;return output;
}
async function automatic(req:any){
 const started=performance.now(),c=makeCase(req),initial=createMultiAoiSiO2OnSiProject();
 const output=await runAutomatedEllipsometryFit({ambient:initial.ambient,layers:initial.layers,substrate:c.substrate,points:c.points,
  config:{...initial.fittingConfig,fitWavelengthMin:c.range[0],fitWavelengthMax:c.range[1]},targetModelId:'gaussian',selectedAois:settings.aois});
 const fit=output.fittingResult;assert.ok(fit.freeFormModel&&fit.freeFormOpticalConstants);
 return{elapsedMs:performance.now()-started,output,errors:errors(fit.freeFormOpticalConstants,c.truth,fit.freeFormModel.layers[fit.freeFormModel.primaryLayerIndex].thickness,req.thickness)};
}
async function main(){
 const req=JSON.parse(readFileSync(0,'utf8'));
 if(req.task==='application'){console.log(JSON.stringify(req.grid.map((wavelength:number)=>({wavelength,...getSiliconOpticalConstants(wavelength)}))));return;}
 const output=req.task==='auto'?await automatic(req):await local(req);
 console.log(JSON.stringify(output));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
