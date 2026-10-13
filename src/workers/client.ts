import type {EllipsometryProject} from '../types/ellipsometry';
import type {Operation,ComputeResult,Progress,WorkerResponse,StartMessage} from './protocol';
export function aborted(message='Calculation cancelled'):Error {return new DOMException(message,'AbortError');}
export class ComputationClient {
  private active:{worker:Worker;jobId:string;revision:number;reject:(e:Error)=>void}|null=null;
  get jobId(){return this.active?.jobId??null;}
  constructor(private factory=()=>new Worker(new URL('./compute.worker.ts',import.meta.url),{type:'module'})){}
  start(operation:Operation,project:EllipsometryProject|undefined,revision:number,
    options:{stage?:number;layerIndex?:number;onProgress?:(p:Progress)=>void}={}):Promise<ComputeResult> {
    this.cancel('Replaced by a newer calculation');
    const jobId=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      let worker:Worker;
      try {worker=this.factory();}catch(e){reject(new Error('Web Worker unavailable: '+String(e)));return;}
      const cleanup=()=>{worker.terminate();if(this.active?.jobId===jobId)this.active=null;};
      this.active={worker,jobId,revision,reject};
      worker.onmessage=(event:MessageEvent<WorkerResponse>)=>{
        const response=event.data;
        if(this.active?.jobId!==jobId||response.jobId!==jobId||response.revision!==revision)return;
        if(response.type==='progress')options.onProgress?.(response.progress);
        if(response.type==='result'){cleanup();resolve(response.result);}
        if(response.type==='cancelled'){cleanup();reject(aborted());}
        if(response.type==='error'){cleanup();const e=new Error(response.error.message);e.name=response.error.name;reject(e);}
      };
      worker.onerror=(event)=>{event.preventDefault();cleanup();reject(new Error('Worker interrupted: '+(event.message||'browser resource limit or script load failure')));};
      worker.onmessageerror=()=>{cleanup();reject(new Error('Worker message could not be decoded'));};
      try {
        // Candidates are kept only by the UI; an immutable, current-input payload
        // avoids retransmitting every saved spectrum on each drag or fit.
        const payload=project?{...project,expert:project.expert?{...project.expert,candidates:[]}:undefined}:undefined;
        worker.postMessage({type:'start',protocol:1,jobId,revision,operation,project:payload,stage:options.stage,layerIndex:options.layerIndex} satisfies StartMessage);
      }catch(e){cleanup();reject(new Error('Cannot transfer calculation input: '+String(e)));}
    });
  }
  cancel(reason='Calculation cancelled') {
    const active=this.active;if(!active)return;this.active=null;
    try{active.worker.postMessage({type:'cancel',jobId:active.jobId});active.worker.postMessage({type:'terminate'});}finally{active.worker.terminate();active.reject(aborted(reason));}
  }
  dispose(){this.cancel('Page or panel closed');}
}
