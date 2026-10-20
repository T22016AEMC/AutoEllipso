import {writeQaFileSync as writeFileSync} from './qa-files.mjs';

import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';

const p=createMultiAoiSiO2OnSiProject();
const times:number[]=[];
const outcomes:string[]=[];
let last:any;
for(let i=0;i<3;i++) {
  const start=performance.now();
  const out=await runAutomatedEllipsometryFit({ambient:p.ambient,layers:p.layers,substrate:p.substrate,
    points:p.experimentData!.points,config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]});
  times.push(performance.now()-start);
  last={thickness:out.finalThickness,parameters:out.updatedLayers[0].parameters,rawMse:out.fittingResult.rawMse,
    converged:out.fittingResult.converged,status:out.fittingResult.status,statistics:out.fittingResult.statistics};
  outcomes.push(JSON.stringify({thickness:last.thickness,parameters:last.parameters,rawMse:last.rawMse,converged:last.converged,initialization:out.fittingResult.initialization}));
}
if(outcomes.some(v=>v!==outcomes[0]))throw new Error('Automatic results are not bit-identical across repetitions');
const report={timesMs:times,medianMs:[...times].sort((a,b)=>a-b)[1],bitIdentical:true,...last};
console.log(JSON.stringify(report,null,2));
writeFileSync(`stage4-${process.argv[2]??'after'}.json`,JSON.stringify(report,null,2));
