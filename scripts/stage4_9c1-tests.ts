import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {computeResidualMetrics} from '../src/fitting/residual';
import {evaluateLayerOpticalConstants,evaluateSubstrateOpticalConstants} from '../src/solver/calculator';
import {fitAssessment,defaultOpticalExport} from '../src/fitting/fitPresentation';
import {FitAssessmentSummary} from '../src/components/FitAssessmentSummary';
import {opticalConstantsCsv,exportOpticalConstantsCsv} from '../src/data/export';
import {OpticalModelComparisonPanel} from '../src/components/OpticalModelComparisonPanel';
import {runAutoFit} from '../src/fitting/engine';
import {synthetic,v2Values} from './stage4_9c1-support';
import {refineFreeForm} from '../src/fitting/freeFormRefine';
import {modelRegistry} from '../src/modelRegistry/registry';
type Test=(name:string,fn:()=>void|Promise<void>)=>Promise<void>;
export async function stage49c1Tests(test:Test){
  await test('Stage4.9c1: caller thickness bounds clamp starts and preserve layer metadata; omitted bounds stay 40–200',async()=>{
    const f=synthetic('cauchy',{A:1.52,B:.0045,C:.00008,k0:0},20,62001);
    const options={ambient:f.project.ambient,layers:f.project.layers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points.filter(p=>(p.wavelength-190)%100===0),config:f.project.fittingConfig,ladderSetting:{count:12,scale:1}};
    const legacy=await refineFreeForm(options);
    assert.equal(legacy.model.variables[0].min,40);assert.equal(legacy.model.variables[0].max,200);
    assert.equal(legacy.model.layers[0].thicknessInitial,40);
    assert.equal(legacy.model.layers[0].thicknessMin,1);assert.equal(legacy.model.layers[0].thicknessMax,500);
    const custom=await refineFreeForm({...options,thicknessBounds:{min:1,max:500}});
    assert.equal(custom.model.variables[0].min,1);assert.equal(custom.model.variables[0].max,500);
    assert.equal(custom.model.layers[0].thicknessInitial,20);assert.equal(f.project.layers[0].thickness,20);
  });
  await test('Stage4.9c1: unknown layer/substrate models throw their IDs',()=>{
    const p=createMultiAoiSiO2OnSiProject();p.layers[0].modelId='missing-film';p.substrate.modelId='missing-substrate';
    assert.throws(()=>evaluateLayerOpticalConstants(p.layers[0],500),/missing-film/);
    assert.throws(()=>evaluateSubstrateOpticalConstants(p.substrate,500),/missing-substrate/);
  });
  await test('Stage4.9c1: underdetermination flags preserve clamped DOF and numerical metrics',()=>{
    const points=[{id:'p',wavelength:500,aoi:70,psiExp:10,deltaExp:20,psiCalc:11,deltaCalc:22}];
    const m=computeResidualMetrics(points,'uniform',1,1,2);
    assert.equal(m.underdetermined,true);assert.equal(m.dof,1);assert.equal(m.rawMse,2.5);assert.equal(m.mseWoollam,Math.sqrt(5));
    assert.equal(computeResidualMetrics(points,'uniform',1,1,1).underdetermined,false);
    assert.match(opticalConstantsCsv([{wavelength:500,n:1.5,k:0,underdetermined:true}]),/underdetermined/);
  });
  await test('Stage4.9c1: adequacy ignores target statuses and unknown sigma displays no verdict',()=>{
    const r:any={statistics:{reducedChiSquare:1},weightingMode:'uniform',status:'target_achieved',targetAchieved:true,rawMse:0,finalMse:0,mseWoollam:0,underdetermined:true};
    assert.equal(fitAssessment(r).fitAdequacy,'unknown');
    const html=renderToStaticMarkup(createElement(FitAssessmentSummary,{result:r}));
    assert.match(html,/無法評估擬合是否充分/);assert.match(html,/欠定/);assert.doesNotMatch(html,/TARGET|達成|成功|失敗/);
    r.weightingMode='sigma';assert.equal(fitAssessment(r).fitAdequacy,'good');
    r.statistics.reducedChiSquare=1.6;assert.equal(fitAssessment(r).fitAdequacy,'marginal');
    r.statistics.reducedChiSquare=3;assert.equal(fitAssessment(r).fitAdequacy,'poor');
  });
  await test('Stage4.9c1: default optical export uses lower raw MSE and physical ties',()=>{
    const p={wavelength:500,n:1.5,k:0},r:any={finalMse:0,finalOpticalConstants:[p],freeFormOpticalConstants:[{...p,n:1.6}],opticalModelComparison:{physical:{rawMse:2},freeForm:{rawMse:1}}};
    assert.equal(defaultOpticalExport(r).source,'free_form');assert.equal(defaultOpticalExport(r).points![0].n,1.6);
    assert.match(defaultOpticalExport(r).label,/預設：自由形式/);
    r.opticalModelComparison.freeForm.rawMse=2;assert.equal(defaultOpticalExport(r).source,'physical');
    r.opticalModelComparison.freeForm.rawMse=3;assert.equal(defaultOpticalExport(r).source,'physical');
    const header=opticalConstantsCsv([p],'physical').split('\n')[0];assert.equal(header,'Wavelength,n,k,k_sigma,flag,source');
  });
  await test('Stage4.9c1: explicit optical exports keep source filenames and show both downloads',()=>{
    const saved=Object.getOwnPropertyDescriptor(globalThis,'document'),downloads:string[]=[];
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>{const a={download:'',href:'',click:()=>downloads.push(a.download)};return a;},body:{appendChild(){},removeChild(){}}}});
    const q={wavelength:500,n:1.5,k:0};
    try{
      exportOpticalConstantsCsv([q],'AutoEllipso_physical_optical_constants.csv','physical');
      exportOpticalConstantsCsv([q],'AutoEllipso_free_form_optical_constants.csv','free_form');
      assert.deepEqual(downloads,['AutoEllipso_physical_optical_constants.csv','AutoEllipso_free_form_optical_constants.csv']);
    }finally{if(saved)Object.defineProperty(globalThis,'document',saved);else delete (globalThis as any).document;}
    const metrics={mseWoollam:1,rawMse:1,effectiveParameters:1,aic:0,bic:0};
    const r:any={finalMse:1,finalOpticalConstants:[q],freeFormOpticalConstants:[q],opticalModelComparison:{physical:metrics,freeForm:metrics}};
    const html=renderToStaticMarkup(createElement(OpticalModelComparisonPanel,{result:r}));
    assert.match(html,/下載物理模型/);assert.match(html,/下載自由形式/);assert.match(html,/預設：物理模型/);
  });
  for(const [id,seed] of [['SiO2',62003],['V2',62004]] as const)await test(`Stage4.9c1: different-substrate ${id} regression converges with finite output`,async()=>{
    const f=synthetic(id==='SiO2'?'cauchy':'gaussian',id==='SiO2'?{A:1.46,B:.004,C:0,k0:0}:v2Values,100,seed,true);
    // A matched-model LM regression from the true film; only substrate is mismatched.
    const at=performance.now(),out=await runAutoFit({ambient:f.project.ambient,layers:f.project.layers,substrate:f.project.substrate,points:f.points,config:f.project.fittingConfig});
    const layer=out.updatedLayers[0],values=Object.fromEntries(Object.entries(layer.parameters).map(([k,v])=>[k,v.current]));
    const curve=f.optics.map(q=>({wavelength:q.wavelength,...modelRegistry.get(layer.modelId)!.calculate(q.wavelength,values),trueN:q.n,trueK:q.k}));
    mkdirSync('.qa',{recursive:true});writeFileSync(`.qa/stage4_9c1-perturbed-${id}.json`,JSON.stringify({seed,generation:f.substrateGeneration,elapsedMs:performance.now()-at,thicknessError:layer.thickness-100,curve,output:out},null,2));
    assert.equal(out.fittingResult.converged,true);
    assert.ok(out.updatedLayers.every(l=>Number.isFinite(l.thickness)&&Object.values(l.parameters).every(p=>Number.isFinite(p.current))));
    assert.ok(out.updatedPoints.every(p=>Number.isFinite(p.psiCalc)&&Number.isFinite(p.deltaCalc)));
  });
}
if(process.argv[1]?.endsWith('stage4_9c1-tests.ts')){
 const results:any[]=[];await stage49c1Tests(async(name,fn)=>{const at=performance.now();try{await fn();results.push({name,passed:true,elapsedMs:performance.now()-at});}catch(error){results.push({name,passed:false,error:String(error)});throw error;}finally{writeFileSync('.qa/stage4_9c1-new-tests.json',JSON.stringify(results,null,2));}});
}
