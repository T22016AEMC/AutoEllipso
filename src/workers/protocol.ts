import type { EllipsometryProject } from '../types/ellipsometry';
import type { AutoFitWorkflowOutput, WorkflowProgress } from '../fitting/autoWorkflow';
import type { ExpertProgress } from '../fitting/expertWorkflow';
import type { TestResult } from '../tests/unitTests';
export const WORKER_PROTOCOL_VERSION = 1;
export type Operation = 'automatic' | 'expert' | 'local' | 'forward' | 'validation' | 'tests';
export type Progress = WorkflowProgress | ExpertProgress | { iteration:number;currentMse:number;previousMse:number|null;currentRmse:number;paramValues:{name:string;value:number}[] };
export interface StartMessage {
  type:'start';protocol:1;jobId:string;revision:number;operation:Operation;
  project?:EllipsometryProject;stage?:number;layerIndex?:number;
}
export type WorkerRequest = StartMessage | {type:'cancel';jobId:string} | {type:'terminate'};
export interface ComputeResult {project?:EllipsometryProject;workflow?:AutoFitWorkflowOutput;report?:unknown;tests?:TestResult[]}
export type WorkerResponse =
  | {type:'started';jobId:string;revision:number}
  | {type:'progress';jobId:string;revision:number;progress:Progress}
  | {type:'result';jobId:string;revision:number;result:ComputeResult}
  | {type:'cancelled';jobId:string;revision:number}
  | {type:'error';jobId:string;revision:number;error:{name:string;message:string}};
