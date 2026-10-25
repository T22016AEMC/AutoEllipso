import {refineFreeForm} from './freeFormRefine';
export interface LadderSetting {count:number;scale:number}
export interface LadderStep extends LadderSetting {
 status:string;converged:boolean;dof:number|null;rawRSS:number|null;w:number|null;
 accepted:boolean;legal:boolean;elapsedMs:number;guarded?:boolean;warning?:string;
}
export interface LadderSelection {
 mode:'sigma'|'sigmaHat';sigmaHat2:number|null;steps:LadderStep[];
 selected:LadderSetting|null;fallback:boolean;sigmaUnavailable:boolean;noAvailableCandidate:boolean;
}
export function freeFormSteps(N:number):LadderSetting[] {
 return (40<=N/4?[[40,1],[40,.1],[40,.01],[60,.01],[80,.01]]:
  [[12,1],[12,.1],[12,.01],[16,.01],[20,.01],[24,.01]]).map(([count,scale])=>({count,scale}));
}
export function legalFreeForm(step:Pick<LadderStep,'count'|'converged'|'status'|'dof'>,N:number) {
 return step.count<=N/4&&step.converged&&step.status==='cost'&&step.dof!>0;
}
export function selectFreeForm(steps:LadderStep[],mode:LadderSelection['mode']):LadderSelection {
 const sparse=steps[0].count===12,last=steps.at(-1)!;
 const variance=last.rawRSS!/last.dof!;
 const sigmaHat2=mode==='sigmaHat'&&last.legal&&variance>0&&Number.isFinite(variance)?variance:null;
 const selection:LadderSelection={mode,sigmaHat2,steps,selected:null,fallback:false,
  sigmaUnavailable:mode==='sigmaHat'&&sigmaHat2===null,noAvailableCandidate:sparse&&!steps[0].legal};
 for(const step of steps){step.accepted=false;if(mode==='sigmaHat')step.w=sigmaHat2===null||!(step.dof!>0)?null:Math.sqrt(step.rawRSS!/sigmaHat2/step.dof!);}
 if(selection.noAvailableCandidate)return selection;
 let best:LadderStep|undefined;
 if(!selection.sigmaUnavailable)for(const step of steps){
  if(step.legal&&Number.isFinite(step.w)&&(!best||best.w!-step.w!>.05)){best=step;step.accepted=true;}
 }
 selection.fallback=!best;best??=steps[0];selection.selected={count:best.count,scale:best.scale};
 return selection;
}
type Refinement=Awaited<ReturnType<typeof refineFreeForm>>;
/** Results are local until every step finishes; cancellation never publishes a partial selection. */
export async function runFreeFormLadder(options:Parameters<typeof refineFreeForm>[0],mode:LadderSelection['mode'],
 onStep:(step:LadderStep,index:number,total:number)=>void) {
 const N=2*options.points.length,settings=freeFormSteps(N),steps:LadderStep[]=[],results:Map<string,Refinement>=new Map();
 for(const [index,setting] of settings.entries()){
  if(options.shouldStop?.())throw new Error('使用者中止擬合');
  const start=performance.now();let step:LadderStep={...setting,status:'guarded',converged:false,dof:null,rawRSS:null,w:null,accepted:false,legal:false,elapsedMs:0,guarded:setting.count>N/4};
  if(!step.guarded)try {
   const out=await refineFreeForm({...options,ladderSetting:setting});
   if(options.shouldStop?.())throw new Error('使用者中止擬合');
   results.set(`${setting.count}/${setting.scale}`,out);
   step={...step,status:out.result.status,converged:out.result.converged,dof:out.statistics.dof,
    rawRSS:out.metrics.rawMse*N,w:mode==='sigma'?out.metrics.mseWoollam:null,elapsedMs:out.elapsedMs};
   step.legal=legalFreeForm(step,N);
  }catch(error){
   if(options.shouldStop?.())throw error;
   step={...step,status:'error',elapsedMs:performance.now()-start,warning:error instanceof Error?error.message:String(error)};
  }
  steps.push(step);onStep(step,index,settings.length);
 }
 if(options.shouldStop?.())throw new Error('使用者中止擬合');
 const selection=selectFreeForm(steps,mode),chosen=selection.selected;
 return {selection,output:chosen?results.get(`${chosen.count}/${chosen.scale}`):undefined,
  baseline:results.get(`${settings[0].count}/${settings[0].scale}`)};
}
