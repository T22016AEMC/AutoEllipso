import assert from 'node:assert/strict';
import {writeQaFileSync as writeFileSync} from './qa-files.mjs';
import {fixture} from './stage4_5c-support';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {chooseFreeFormOrigin,refineFreeForm} from '../src/fitting/freeFormRefine';
import {modelRegistry} from '../src/modelRegistry/registry';
import {opticalConstantsCsv,importProjectJson} from '../src/data/export';
import {createValidationReport} from '../src/data/validationReport';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {OpticalModelComparisonPanel} from '../src/components/OpticalModelComparisonPanel';
type Test=(name:string,fn:()=>void|Promise<void>)=>Promise<void>;
export const prototypeM2:Record<string,{mseWoollam:number;thicknessError:number}>={
 T0:{mseWoollam:.9976921241191087,thicknessError:.04701503095083126},T1:{mseWoollam:3.7321132174713822,thicknessError:.005831206557374458},
 T2:{mseWoollam:2.0457919413059407,thicknessError:.3345591519926927},T3:{mseWoollam:14.140032147332219,thicknessError:-1.4822655468194057},
 T4:{mseWoollam:27.828328987706463,thicknessError:1.556219790945704},T5:{mseWoollam:.9957966245733948,thicknessError:.033640873927964776}};
export async function stage45dTests(test:Test) {
 for(const id of ['T0','T1','T2','T3','T4','T5'])await test(`Stage4.5d: ${id} full Automatic selection and M2 comparison`,async()=>{
  const f=fixture(id),start=performance.now(),progress:any[]=[];
  const out=await runAutomatedEllipsometryFit({ambient:f.project.ambient,layers:f.project.layers,substrate:f.project.substrate,points:f.points,
   config:f.project.fittingConfig,targetModelId:id==='T0'||id==='T5'?'gaussian':f.truth.model,selectedAois:[65,70,75],onProgress:p=>{if(p.stage==='stage_free_form_refine')progress.push(p);}});
  const elapsedMs=performance.now()-start,r=out.fittingResult,s=r.freeFormRefinement!,physicalSeeded=s.physicalSeeded!,freeThickness=r.freeFormModel!.layers[0].thickness;
  const comparison={id,elapsedMs,selectedMse:r.opticalModelComparison!.freeForm.mseWoollam,freeThicknessError:freeThickness-100,
   origin:r.freeFormOrigin,ladder:s.ladder,physicalSeeded,prototype:prototypeM2[id],
   differences:{mseWoollam:physicalSeeded?.mseWoollam-prototypeM2[id].mseWoollam,thicknessError:(physicalSeeded?.thickness-100)-prototypeM2[id].thicknessError}};
  writeFileSync(`stage4_5d-${id}.json`,JSON.stringify({comparison,output:out,progress},null,2));console.log('STAGE4_5D '+JSON.stringify(comparison));
  assert.ok(physicalSeeded,'Refinement executed rather than silently keeping ladder');
  assert.ok(r.opticalModelComparison!.freeForm.mseWoollam<=s.ladder!.mseWoollam);
  assert.equal(r.freeFormOrigin,chooseFreeFormOrigin(s.ladder!.mseWoollam,physicalSeeded.mseWoollam));
  assert.ok(r.freeFormOpticalConstants!.every(q=>Number.isFinite(q.k)&&q.k>=0&&q.freeFormOrigin===r.freeFormOrigin));
  assert.ok(freeThickness>=40&&freeThickness<=200);assert.ok(progress.length>0);
  const csv=opticalConstantsCsv(r.freeFormOpticalConstants!,'free_form'),lines=csv.split('\n');
  assert.equal(lines[0],'Wavelength,n,k,k_sigma,flag,source,free_form_origin');
  assert.equal(lines[1].split(',')[5],'free_form');assert.equal(lines[1].split(',')[6],r.freeFormOrigin);
  const project={...f.project,deltaConventionVersion:2,layers:out.updatedLayers,experimentData:{...f.project.experimentData,points:out.updatedPoints},fittingResult:r};
  const restored=importProjectJson(JSON.stringify(project));assert.deepEqual(restored.fittingResult!.freeFormRefinement,s);
  assert.deepEqual(createValidationReport(restored).freeFormRefinement,s);
  assert.ok(renderToStaticMarkup(createElement(OpticalModelComparisonPanel,{result:r})).includes(r.freeFormOrigin!));
 });
 await test('Stage4.5d: zero-k Cauchy seed can develop absorption',async()=>{
  const f=fixture('T2'),layers=structuredClone(f.project.layers);layers[0].modelId='cauchy';layers[0].parameters=modelRegistry.createParameterSet('cauchy');layers[0].parameters.k0.current=0;
  const out=await refineFreeForm({ambient:f.project.ambient,layers,substrate:f.project.substrate,primaryLayerIndex:0,points:f.points,config:f.project.fittingConfig});
  const absorption=f.optics.filter((q:any)=>q.k>=.001).map((q:any)=>q.wavelength),maxK=Math.max(...out.curve.filter(q=>absorption.includes(q.wavelength)).map(q=>q.k));
  writeFileSync('stage4_5d-zero-k.json',JSON.stringify({maxK,initialMse:out.initialMetrics.mseWoollam,finalMse:out.metrics.mseWoollam,out},null,2));
  console.log('STAGE4_5D_ZERO_K '+JSON.stringify({maxK,initialMse:out.initialMetrics.mseWoollam,finalMse:out.metrics.mseWoollam}));
  assert.ok(maxK>.01);assert.ok(out.metrics.mseWoollam<out.initialMetrics.mseWoollam);
 });
 for(const [count,aois] of [[3,[70]],[5,[65,75]]] as const)await test(`Stage4.5d: ${count*aois.length} points skip refinement with warning`,async()=>{
  const f=fixture('T0'),wl=[190,200,210,220,230].slice(0,count),points=f.points.filter((p:any)=>wl.includes(p.wavelength)&&(aois as readonly number[]).includes(p.aoi));
  const out=await runAutomatedEllipsometryFit({ambient:f.project.ambient,layers:f.project.layers,substrate:f.project.substrate,points,config:f.project.fittingConfig,targetModelId:'gaussian',selectedAois:[...aois]});
  assert.ok(Number.isFinite(out.finalThickness));assert.ok(out.fittingResult.freeFormWarning);assert.equal(out.fittingResult.freeFormRefinement!.skipped,true);
  assert.equal(out.fittingResult.freeFormRefinement!.physicalSeeded,undefined);assert.equal(out.fittingResult.freeFormOpticalConstants,undefined);
  writeFileSync(`stage4_5d-small-${points.length}.json`,JSON.stringify(out,null,2));
 });
 await test('Stage4.5d: relative tie chooses physical_seeded and larger scores retain ladder',()=>{
  assert.equal(chooseFreeFormOrigin(1,1.0000005),'physical_seeded');assert.equal(chooseFreeFormOrigin(1,1),'physical_seeded');
  assert.equal(chooseFreeFormOrigin(1,2),'ladder');assert.equal(chooseFreeFormOrigin(1,.5),'physical_seeded');assert.equal(chooseFreeFormOrigin(1,NaN),'ladder');
 });
}
