import {writeQaFileSync as writeFileSync,readQaFileSync as readFileSync} from './qa-files.mjs';
import {stage41Fixture,trueK} from './stage4_1-fixture';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {modelRegistry} from '../src/modelRegistry/registry';
import {opticalConstantsCsv,importProjectJson} from '../src/data/export';
import {createValidationReport} from '../src/data/validationReport';
import {computeFitStatistics} from '../src/fitting/statistics';
import {freeFormCurve,compareOpticalModels} from '../src/fitting/freeFormOptics';
import {computeResidualMetrics} from '../src/fitting/residual';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {OpticalModelComparisonPanel} from '../src/components/OpticalModelComparisonPanel';
type Test=(name:string,fn:()=>void|Promise<void>)=>Promise<void>;
const details:Record<string,unknown>={};
function record(key:string,value:unknown){details[key]=value;console.log('STAGE4_1_'+key+' '+JSON.stringify(value));writeFileSync('stage4_1-results.json',JSON.stringify(details,null,2));}
export async function stage41Tests(test:Test) {
  await test('Stage4.1: flat-spectrum fallback stays in band with positive absorption',()=>{
    const spectrum=Array.from({length:50},(_,i)=>({wavelength:250+i*10,n:1.6,k:0}));
    const low=1239.841984/740,high=1239.841984/250;
    for(const modelId of ['gaussian','lorentz','tauc_lorentz','multi_oscillator']) {
      let initialization:any;
      const params=modelRegistry.initializePhysicalModelFromBSpline(modelId,spectrum,undefined,{onInitialization:v=>initialization=v});
      const record=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,v.current]));
      const energy=record[modelId==='multi_oscillator'?'E01':'E0'];
      assert.equal(initialization.peaksDetected,0);assert.equal(initialization.oscillatorsUsed,1);
      assert.ok(energy>=low&&energy<=high);assert.ok(modelRegistry.get(modelId)!.calculateEpsilon(1239.841984/energy,record).eps2>0);
    }
  });
  for(const scenario of ['absorbing','transparent','weak'] as const)await test(`Stage4.1: Automatic ${scenario} k and propagated uncertainty`,async()=>{
    const {project:p,points}=stage41Fixture(scenario);
    const kTruth=(w:number)=>trueK(scenario,w);
    const start=performance.now();
    const out=await runAutomatedEllipsometryFit({ambient:p.ambient,layers:p.layers,substrate:p.substrate,points,config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]});
    const result=out.fittingResult,curve=result.freeFormOpticalConstants!;
    assert.ok(curve?.length);const table=curve.filter(q=>(q.wavelength-200)%50===0).map(q=>({wavelength:q.wavelength,trueK:kTruth(q.wavelength),fittedK:q.k,sigmaK:q.kSigma,flag:q.belowDetection?'below_detection':q.kSigma===null?'uncertainty_unavailable':''}));
    record(scenario,{elapsedMs:performance.now()-start,thickness:out.finalThickness,converged:result.converged,
      comparison:result.opticalModelComparison,table,warnings:result.freeFormStatistics?.warnings,coefficientBounds:result.freeFormCoefficientBounds});
    assert.ok(curve.every(q=>Number.isFinite(q.k)&&q.k>=0&&q.kSigma!==undefined&&(q.kSigma===null||Number.isFinite(q.kSigma)&&q.kSigma>=0)));
    if(scenario==='absorbing')for(const q of curve.filter(q=>q.wavelength>=400&&q.wavelength<=450)) {
      assert.ok(q.k>=.5*kTruth(q.wavelength),`k at ${q.wavelength}: ${q.k}`);
      assert.equal(q.belowDetection,false,`detection at ${q.wavelength}`);
    }
    if(scenario==='transparent')assert.ok(curve.filter(q=>q.wavelength>=800).every(q=>q.belowDetection===true),'high wavelength detection flags');
    assert.ok(curve.some(q=>q.k!==Number(q.k.toFixed(4))),'full precision retained');
    const restored=importProjectJson(JSON.stringify({...p,layers:out.updatedLayers,experimentData:{...p.experimentData!,points:out.updatedPoints},fittingResult:result,deltaConventionVersion:2}));
    assert.deepEqual(restored.fittingResult!.freeFormOpticalConstants,curve);
    assert.deepEqual(createValidationReport(restored).opticalModelComparison,result.opticalModelComparison);
    assert.match(renderToStaticMarkup(createElement(OpticalModelComparisonPanel,{result})),/下載自由形式/);
  });
  await test('Stage4.1: covariance propagation uses existing statistics and retains below-detection k',()=>{
    const variables=[0,1,2,3].map(i=>({id:`K${i}`,name:`K${i}`,value:.001,min:0,max:1,splineCoefficient:true}));
    const statistics=computeFitStatistics(variables,variables.map(v=>v.value),x=>[...x.map(v=>v-.001),.01,.01],{isAngularResidual:()=>false});
    const curve=freeFormCurve([400,500,600,700],[400,500,600,700],[1.6,1.6,1.6,1.6],[.001,.001,.001,.001],statistics);
    assert.equal(curve[0].kSigma,Math.sqrt(statistics.covariance.matrix[0][0]));
    assert.equal(curve[0].belowDetection,true);assert.equal(curve[0].k,.001);
    const metrics=computeResidualMetrics([{id:'a',wavelength:500,aoi:70,psiExp:1,psiCalc:2,deltaExp:0,deltaCalc:0}], 'uniform',1,1,1);
    const comparison=compareOpticalModels([{wavelength:500,n:1.6,k:.02,kSigma:.001}],[{wavelength:500,n:1.6,k:0}],metrics,metrics,1,1);
    assert.match(comparison.warning!,/k 偏低/);
  });
  await test('Stage4.1: optical CSV small k survives round-trip with stable first columns and both sources',()=>{
    for(const source of ['physical','free_form'] as const) {
      const csv=opticalConstantsCsv([{wavelength:633,n:1.600000000123,k:1.234567891234567e-8,kSigma:1e-7,belowDetection:true}],source);
      const [header,line]=csv.split('\n'),cells=line.split(',');
      assert.equal(header,'Wavelength,n,k,k_sigma,flag,source');assert.equal(Number(cells[2]),1.234567891234567e-8);
      assert.equal(Number(cells[1]),1.600000000123);assert.equal(cells[4],'below_detection');assert.equal(cells[5],source);
    }
  });
  await test('Stage4.1: SiO2 regression and timing against Stage3/4 baseline',async()=>{
    const p=createMultiAoiSiO2OnSiProject(),start=performance.now();
    const out=await runAutomatedEllipsometryFit({ambient:p.ambient,layers:p.layers,substrate:p.substrate,points:p.experimentData!.points,config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]});
    const elapsedMs=performance.now()-start;
    const baselines=['stage3-before.json','stage4-after.json','stage4_1-before.json'].map(file=>{
      const b=JSON.parse(readFileSync(new URL('./fixtures/'+file,import.meta.url),'utf8'));
      return {file,oldThickness:b.thickness,newThickness:out.finalThickness,deltaThickness:out.finalThickness-b.thickness,
        oldRawMse:b.rawMse,newRawMse:out.fittingResult.rawMse,deltaRawMse:out.fittingResult.rawMse!-b.rawMse,
        oldConverged:b.converged,newConverged:out.fittingResult.converged,oldMedianMs:b.medianMs,newElapsedMs:elapsedMs};
    });
    record('regression',baselines);assert.equal(out.fittingResult.converged,true);
    const previous=baselines.at(-1)!;assert.ok(Math.abs(previous.deltaThickness)<1e-3);assert.ok(Math.abs(previous.deltaRawMse)<1e-5);
  });
  await test('Stage4.1: no absorption threshold branching or optical four-decimal rounding',()=>{
    function scan(path:string):string[]{return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(join(path,e.name)):/\.(ts|tsx)$/.test(e.name)?[join(path,e.name)]:[]);}
    for(const file of scan('src')) {
      const text=readFileSync(file,'utf8');assert.doesNotMatch(text,/maxK\s*<\s*0\.035|\bisTransparent\w*\b/,file);
      if(!file.includes('components')&&!file.includes('tests'))assert.doesNotMatch(text,/(?:opt\.[nk]|[nk]Init|[nk]Coeffs\[[^\]]+\])\.toFixed\(4\)/,file);
    }
  });
}
