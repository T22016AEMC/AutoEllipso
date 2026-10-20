import {writeQaFileSync as writeFileSync} from './qa-files.mjs';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {OpticalModelComparisonPanel} from '../src/components/OpticalModelComparisonPanel';
import {createValidationReport} from '../src/data/validationReport';


export async function stage44aTests(test:(name:string,fn:()=>void|Promise<void>)=>Promise<void>) {
 for(const [wavelengthCount,aois] of [[3,[70]],[5,[65,75]]] as const) {
  await test(`Stage4.4a: ${wavelengthCount} wavelengths x ${aois.length} AOI gracefully skips free-form`,async()=>{
   const p=createMultiAoiSiO2OnSiProject();
   const wavelengths=[...new Set(p.experimentData!.points.map(q=>q.wavelength))].slice(0,wavelengthCount);
   const points=p.experimentData!.points.filter(q=>wavelengths.includes(q.wavelength)&&aois.includes(q.aoi as never));
   assert.equal(points.length,wavelengthCount*aois.length);
   const out=await runAutomatedEllipsometryFit({ambient:p.ambient,layers:p.layers,substrate:p.substrate,points,
    config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[...aois]});
   const r=out.fittingResult;
   writeFileSync(`stage4_4a-small-${points.length}.json`,JSON.stringify(out,null,2));
   assert.match(r.freeFormWarning!,/資料點數不足.*自由形式 n\/k 已略過/);
   assert.ok(Number.isFinite(out.finalThickness)&&Number.isFinite(r.mseWoollam));
   assert.equal(out.updatedPoints.length,points.length);
   assert.equal(r.freeFormOpticalConstants,undefined);assert.equal(r.freeFormStatistics,undefined);
   assert.equal(r.bsplineDiagnostic?.skipped,true);assert.equal(r.bsplineDiagnostic?.sourceModel,'cauchy');
   assert.ok(r.bsplineDiagnostic!.knotRefinementHistory!.every(s=>s.skipped));
   assert.ok(r.freshCalculationVerified);
   assert.ok(renderToStaticMarkup(createElement(OpticalModelComparisonPanel,{result:r})).includes(r.freeFormWarning!));
   p.layers=out.updatedLayers;p.fittingResult=r;p.experimentData!.points=out.updatedPoints;
   assert.equal(createValidationReport(p).freeFormWarning,r.freeFormWarning);
   console.log('STAGE4_4A_SMALL '+JSON.stringify({points:points.length,warning:r.freeFormWarning,thickness:out.finalThickness,mseWoollam:r.mseWoollam}));
  });
 }
}
