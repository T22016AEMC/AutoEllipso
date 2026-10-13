/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse, StartMessage, ComputeResult, Progress } from './protocol';
import {runAutomatedEllipsometryFit} from '../fitting/autoWorkflow';
import {runExpertStage,freshForward} from '../fitting/expertWorkflow';
import {runAutoFit} from '../fitting/engine';
import {createValidationReport} from '../data/validationReport';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let current:{jobId:string;cancelled:boolean}|null=null;
scope.onmessage=(event:MessageEvent<WorkerRequest>)=>{
  const message=event.data;
  if(message.type==='terminate'){if(current)current.cancelled=true;scope.close();return;}
  if(message.type==='cancel'){if(current?.jobId===message.jobId)current.cancelled=true;return;}
  if(message.type==='start')void execute(message);
};
async function execute(message:StartMessage) {
  const job={jobId:message.jobId,cancelled:false};
  const send=(payload:Record<string,unknown>)=>scope.postMessage({...payload,jobId:message.jobId,revision:message.revision} as WorkerResponse);
  if(current){send({type:'error',error:{name:'BusyError',message:'A worker job is already running'}});return;}
  current=job;
  try {
    if(message.protocol!==1)throw new Error('Unsupported worker protocol');
    send({type:'started'});
    const onProgress=(progress:Progress)=>{if(!job.cancelled)send({type:'progress',progress});};
    const shouldStop=()=>job.cancelled;
    let result:ComputeResult={};const project=message.project;
    if(message.operation==='tests') {
      const {runAllUnitTests}=await import('../tests/unitTests');result.tests=await runAllUnitTests();
    } else {
      if(!project)throw new Error('Missing project');
      if(message.operation==='forward')result.project=freshForward(project);
      else if(message.operation==='validation')result.report=JSON.stringify(createValidationReport(project),null,2);
      else if(message.operation==='expert')result.project=await runExpertStage(project,message.stage??0,message.layerIndex??0,onProgress,shouldStop);
      else if(message.operation==='local') {
        const fit=await runAutoFit({ambient:project.ambient,layers:project.layers,substrate:project.substrate,points:project.experimentData?.points??[],config:project.fittingConfig,onProgress,shouldStop});
        result.project={...project,layers:fit.updatedLayers,substrate:fit.updatedSubstrate,experimentData:project.experimentData?{...project.experimentData,points:fit.updatedPoints}:null,fittingResult:fit.fittingResult};
      } else if(message.operation==='automatic') {
        if(project.expert?.manualSource||project.expert?.records.length||project.layers.some(l=>l.modelId==='expert_mixed'||(l.modelId==='bspline'&&project.expert))) {
          let resumed=project;
          if(resumed.layers[0]?.modelId==='bspline')resumed=await runExpertStage(resumed,3,0,onProgress,shouldStop);
          if(!shouldStop())resumed=await runExpertStage(resumed,4,0,onProgress,shouldStop);
          if(!shouldStop())resumed=await runExpertStage(resumed,5,0);
          result.project=resumed;
        } else {
          const fit=await runAutomatedEllipsometryFit({ambient:project.ambient,layers:project.layers,substrate:project.substrate,
            points:project.experimentData?.points??[],config:project.fittingConfig,
            targetModelId:project.fittingConfig.finalPhysicalModelSelection==='auto'?'auto':project.fittingConfig.finalPhysicalModelSelection||project.layers[0]?.modelId||'gaussian',
            selectedAois:project.fittingConfig.activeFitAois,onProgress,shouldStop});
          result.workflow=fit;result.project={...project,layers:fit.updatedLayers,substrate:fit.updatedSubstrate,experimentData:project.experimentData?{...project.experimentData,points:fit.updatedPoints}:null,fittingResult:fit.fittingResult};
        }
      } else throw new Error('Unknown operation');
    }
    send(job.cancelled?{type:'cancelled'}:{type:'result',result});
  } catch(error) {
    const e=error instanceof Error?error:new Error(String(error));
    send(job.cancelled?{type:'cancelled'}:{type:'error',error:{name:e.name,message:e.message}});
  } finally {if(current===job)current=null;}
}
