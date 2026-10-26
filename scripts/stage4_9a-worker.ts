import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,renameSync,existsSync,realpathSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {modelRegistry} from '../src/modelRegistry/registry';
import {Complex} from '../src/optics/complex';
import {SI_SUBSTRATE_DATA,getSiliconOpticalConstants} from '../src/optics/materials';
import {solveEllipsometryTMM} from '../src/solver/transferMatrix';
import {calculatePoint} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {circularDifferenceDeg,residualWeights} from '../src/fitting/residual';
import {optimizeBoundedLM} from '../src/fitting/optimizer';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';

const prefix='.qa/stage4_9a-';
const settings=JSON.parse(readFileSync(prefix+'settings.json','utf8'));
const save=(key:string,value:any)=>{const file=prefix+key+'.json';writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(file+'.tmp',file);};
const read=(key:string)=>JSON.parse(readFileSync(prefix+key+'.json','utf8'));
const rms=(values:number[])=>values.length?Math.sqrt(values.reduce((s,x)=>s+x*x,0)/values.length):null;
function stats(rows:any[],key:string){
 if(!rows.length)return null;const at=rows.reduce((a,b)=>Math.abs(b[key])>Math.abs(a[key])?b:a);
 return {maxAbs:Math.abs(at[key]),at_nm:at.wavelength,rms:rms(rows.map(p=>p[key])),bias:rows.reduce((s,p)=>s+p[key],0)/rows.length};
}
function regional(rows:any[],keys:string[]){return settings.bands.map(([lo,hi,closed]:[number,number,boolean])=>{
 const inside=rows.filter(p=>p.wavelength>=lo&&(closed?p.wavelength<=hi:p.wavelength<hi));
 return {band:`${lo}-${hi}`,points:inside.length,...Object.fromEntries(keys.map(k=>[k,stats(inside,k)]))};
});}
function makeCase(req:any){
 const film=settings.films[req.film],parameters=modelRegistry.createParameterSet(film.model),truth=film.parameters;
 assert.deepEqual(Object.keys(parameters).sort(),Object.keys(truth).sort());
 for(const [key,p] of Object.entries(parameters)){p.current=p.initial=truth[key];p.fit=film.fit.includes(key);}
 const layer:any={id:'audit-film',name:film.id,modelId:film.model,thickness:req.thickness,thicknessInitial:req.thickness,
  thicknessFit:true,thicknessMin:1,thicknessMax:200,parameters};
 const ambient={name:'Air',n:1,k:0},substrate:any={name:'Application Si',materialType:'tabulated',modelId:'tabulated_si',parameters:modelRegistry.createParameterSet('tabulated_si')};
 const model=modelRegistry.get(film.model)!,optics=req.si.map((p:any)=>({wavelength:p.wavelength,...model.calculate(p.wavelength,truth)}));
 const reference=new Map(req.si.map((q:any)=>[q.wavelength,q]));let state=req.seed;
 const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 const rows:any[]=[],points:any[]=[];
 for(const aoi of settings.aois)for(const optical of optics){
  const si:any=reference.get(optical.wavelength);assert.ok(si&&[si.n,si.k].every(Number.isFinite));
  const actual=solveEllipsometryTMM(new Complex(1,0),[{thicknessNm:req.thickness,N:new Complex(optical.n,optical.k)}],new Complex(si.n,si.k),optical.wavelength,aoi);
  const ours=calculatePoint(ambient,[layer],substrate,optical.wavelength,aoi);
  rows.push({wavelength:optical.wavelength,aoi,psiError:ours.psiDeg-actual.psiDeg,deltaError:circularDifferenceDeg(ours.deltaDeg,actual.deltaDeg)});
  const r=Math.sqrt(-2*Math.log(rng())),angle=2*Math.PI*rng();
  points.push({wavelength:optical.wavelength,aoi,psiExp:actual.psiDeg+.03*r*Math.cos(angle),deltaExp:normalizeDeltaDeg(actual.deltaDeg+.03*r*Math.sin(angle)),psiSigma:.03,deltaSigma:.03,weight:1});
 }
 return {layer,ambient,substrate,optics,points,forward:regional(rows,['psiError','deltaError']),forwardRows:rows,
  meta:{reference:req.reference,range:req.range,modelOutput:req.modelOutput,film:film.id,model:film.model,truth:film.parameters,thickness:req.thickness,seed:req.seed,wavelengths:optics.length}};
}
function curveErrors(curve:any[],truth:any[],thickness:number,d:number){
 const rows=truth.map(q=>{const p=curve.find(p=>p.wavelength===q.wavelength);assert.ok(p);return {wavelength:q.wavelength,nError:p.n-q.n,kError:p.k-q.k,n:p.n,k:p.k,trueN:q.n,trueK:q.k};});
 return {thicknessError:thickness-d,regions:regional(rows,['nError','kError']),rows};
}
async function local(req:any){
 const started=performance.now(),c=makeCase(req),film=settings.films[req.film];
 const variables=[{id:'thickness',name:'thickness',value:req.thickness,min:1,max:200},...film.fit.map((id:string)=>{
  const p=c.layer.parameters[id];return{id,name:id,value:p.current,min:p.min,max:p.max};})];
 const apply=(v:number[])=>{c.layer.thickness=v[0];film.fit.forEach((id:string,i:number)=>c.layer.parameters[id].current=v[i+1]);};
 const config:any={fitWeighting:'standard_deviation',psiWeight:1,deltaWeight:1};
 const residual=(v:number[])=>{apply(v);return c.points.flatMap(p=>{const out=calculatePoint(c.ambient,[c.layer],c.substrate,p.wavelength,p.aoi);return [out.psiDeg-p.psiExp,circularDifferenceDeg(out.deltaDeg,p.deltaExp)];});};
 const result=await optimizeBoundedLM(variables,residual,{maxIterations:50,tolerance:1e-5,initialLambda:.01,residualWeights:residualWeights(c.points,config).weights});
 apply(result.finalParams);const values=Object.fromEntries(Object.entries(c.layer.parameters).map(([k,p]:[string,any])=>[k,p.current]));
 const curve=c.optics.map((p:any)=>({wavelength:p.wavelength,...modelRegistry.get(film.model)!.calculate(p.wavelength,values)}));
 return {meta:c.meta,elapsedMs:performance.now()-started,forward:c.forward,forwardRows:c.forwardRows,points:c.points,result,
  fitted:values,errors:curveErrors(curve,c.optics,c.layer.thickness,req.thickness)};
}
async function automatic(req:any){
 const started=performance.now(),c=makeCase(req),initial=createMultiAoiSiO2OnSiProject();
 const localSaved=read(req.localKey);assert.deepEqual(c.points,localSaved.points,'local/Automatic must share identical dataset');
 const output=await runAutomatedEllipsometryFit({ambient:initial.ambient,layers:initial.layers,substrate:initial.substrate,points:c.points,
  config:{...initial.fittingConfig,fitWavelengthMin:req.range[0],fitWavelengthMax:req.range[1]},targetModelId:'gaussian',selectedAois:settings.aois});
 const r=output.fittingResult;assert.ok(r.freeFormModel&&r.freeFormOpticalConstants);
 return {meta:c.meta,elapsedMs:performance.now()-started,output,errors:curveErrors(r.freeFormOpticalConstants,c.optics,r.freeFormModel.layers[r.freeFormModel.primaryLayerIndex].thickness,req.thickness)};
}
async function counter(req:any){
 const require=createRequire(import.meta.url),esbuild=createRequire(realpathSync('node_modules/tsx/package.json'))('esbuild');
 const bundle=path.resolve(prefix+'instrumented.mjs');
 if(!existsSync(bundle))await esbuild.build({stdin:{contents:"export {runAutomatedEllipsometryFit} from './src/fitting/autoWorkflow';export {Complex} from './src/optics/complex';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:bundle,sourcemap:'external',sourcesContent:false,
  plugins:[{name:'audit-complex-constructor',setup(build:any){build.onLoad({filter:/[\\/]optics[\\/]complex\.ts$/},async(args:any)=>{
   const source=readFileSync(args.path,'utf8'),needle='this.re = Number.isFinite(re) ? re : 0;';assert.equal(source.split(needle).length,2);
   const hook="if(!Number.isFinite(re)||!Number.isFinite(im))(globalThis as any).__stage49Coercion?.(re,im,new Error().stack); ";
   return {contents:source.replace(needle,hook+needle),loader:'ts'};
  });}}]});
 const events=new Map<string,any>();let calls=0,reals=0,imaginaries=0;
 (globalThis as any).__stage49Coercion=(re:number,im:number,stack:string)=>{calls++;if(!Number.isFinite(re))reals++;if(!Number.isFinite(im))imaginaries++;
  const frames=(stack??'unknown').split('\n').slice(2,10).map(s=>s.trim()),key=frames.join('\n'),row=events.get(key)??{frames,constructors:0,real:0,imaginary:0};
  row.constructors++;if(!Number.isFinite(re))row.real++;if(!Number.isFinite(im))row.imaginary++;events.set(key,row);};
 const instrumented=await import(pathToFileURL(bundle).href),control=new instrumented.Complex(NaN,Infinity);
 assert.equal(control.re,0);assert.equal(control.im,0);assert.equal(calls,1);assert.equal(reals+imaginaries,2);events.clear();calls=reals=imaginaries=0;
 const data=JSON.parse(readFileSync(`.qa/stage4_8a-${req.id}-49001-data.json`,'utf8')),
  baseline=JSON.parse(readFileSync(`.qa/stage4_8c-${req.id}-sigma-automatic.json`,'utf8')).output;
 const started=performance.now();
 const output=await instrumented.runAutomatedEllipsometryFit({ambient:data.project.ambient,layers:data.project.layers,substrate:data.project.substrate,points:data.points,config:data.project.fittingConfig,targetModelId:data.truth.model,selectedAois:[65,70,75]});
 const a=output.fittingResult,b=baseline.fittingResult;
 const difference=Math.max(Math.abs(output.finalThickness-baseline.finalThickness),Math.abs(a.finalMse-b.finalMse),
  ...a.freeFormOpticalConstants.flatMap((p:any,i:number)=>[Math.abs(p.n-b.freeFormOpticalConstants[i].n),Math.abs(p.k-b.freeFormOpticalConstants[i].k)]),
  ...a.freeFormModel.variables.map((v:any,i:number)=>Math.abs(v.value-b.freeFormModel.variables[i].value)));
 assert.ok(difference<=1e-9,'instrumentation altered formal result');assert.equal(a.freeFormOrigin,b.freeFormOrigin);
 return {id:req.id,seed:49001,elapsedMs:performance.now()-started,constructors:calls,realComponents:reals,imaginaryComponents:imaginaries,locations:[...events.values()],control:{constructors:1,components:2},difference,output};
}
async function staticInventory(){
 const resolve=createRequire(realpathSync('node_modules/vite/package.json'));
 const {parseAst}=await import(pathToFileURL(resolve.resolve('rolldown/parseAst')).href);
 const probe='//中文\nfoo(1)',probeAst=parseAst(probe,{lang:'ts'},'probe.ts');
 const start=probeAst.body[0].expression.start,useBytes=start!==probe.indexOf('foo');
 assert.equal(start,useBytes?Buffer.byteLength(probe.slice(0,probe.indexOf('foo'))):probe.indexOf('foo'));
 const files:string[]=[];function visit(dir:string){for(const item of readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())visit(p);else if(/\.tsx?$/.test(p))files.push(p);}}visit('src');
 const calls:any[]=[],producers:any[]=[];
 for(const file of files){const text=readFileSync(file,'utf8'),source=parseAst(text,{lang:file.endsWith('x')?'tsx':'ts'},file);
  const slice=(start:number,end:number)=>useBytes?Buffer.from(text).subarray(start,end).toString('utf8'):text.slice(start,end);
  const position=(start:number)=>{const before=slice(0,start).split('\n');return{path:file.replaceAll('\\','/'),line:before.length,column:before.at(-1)!.length+1};};
  function scan(node:any){
   if(node.type==='CallExpression'){
    const callee=slice(node.callee.start,node.callee.end),argument:string[]=node.arguments.map((a:any)=>slice(a.start,a.end));
    const direct=/BSplineModel\.(calculateN|calculateK|calculate)$/.test(callee)||callee==='getEffectiveKnotsAndCount';
    const dispatcher=/\.(calculate|calculateN|calculateK)$/.test(callee)&&!/(GaussianModel|CauchyModel|LorentzModel|TaucLorentzModel|DrudeModel|ConstantModel|SellmeierModel|CustomModel)\./.test(callee);
    const gateway=['calculatePoint','calculateSpectrum','evaluateLayerOpticalConstants','evaluateSubstrateOpticalConstants'].includes(callee);
    if(direct||dispatcher||gateway)calls.push({...position(node.start),callee,arguments:argument,kind:direct?'direct bspline':gateway?'calculator caller':'model dispatch; type depends on receiver/input',
     knot0:argument.some((a:string)=>a.includes('_knot0'))?'有：明列_knot0':argument.some((a:string)=>a.includes('Object.fromEntries')&&a.includes('_knot${i}'))?'有：索引節點映射，須非空陣列':'無法判定：傳遞參數字典，須結合metadataSites追溯',knotCount:argument.some((a:string)=>a.includes('_knotCount'))?'有：明列_knotCount':'無法判定：傳遞參數字典，須結合metadataSites追溯'});
   }
   for(const child of Object.values(node)){if(Array.isArray(child)){for(const element of child)if(element&&typeof element==='object'&&typeof element.type==='string')scan(element);}else if(child&&typeof child==='object'&&typeof(child as any).type==='string')scan(child);}
  }scan(source);
  text.split(/\r?\n/).forEach((line,index)=>{if(line.includes('_knot'))producers.push({path:file.replaceAll('\\','/'),line:index+1,text:line.trim()});});
 }
 return {calls,metadataSites:producers,note:'conservative call inventory includes conditional registry/calculator routes; unknown dynamic input metadata is not claimed absent. See exact source producers and serialized/imported parameter records.'};
}
async function main(){
 const req=JSON.parse(readFileSync(0,'utf8'));assert.ok(!existsSync(prefix+req.key+'.json'),'saved checkpoint must not be rerun');
 let out:any;
 if(req.task==='si')out={knots:SI_SUBSTRATE_DATA.map(r=>r[0]),curve:settings.stage1_grid_nm.map((w:number)=>({wavelength:w,...getSiliconOpticalConstants(w)}))};
 else if(req.task==='local')out=await local(req);
 else if(req.task==='auto')out=await automatic(req);
 else if(req.task==='counter')out=await counter(req);
 else if(req.task==='static')out=await staticInventory();
 else throw new Error('Unknown diagnostic task');
 save(req.key,out);console.log(JSON.stringify({key:req.key,elapsedMs:out.elapsedMs??0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
