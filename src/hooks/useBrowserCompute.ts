import {useCallback,useEffect,useRef,useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import type {EllipsometryProject} from '../types/ellipsometry';
import type {Operation,Progress} from '../workers/protocol';
import {ComputationClient,aborted} from '../workers/client';
const isAbort=(e:unknown)=>typeof e==='object'&&e!==null&&'name' in e&&e.name==='AbortError';
function inputsChanged(a:EllipsometryProject,b:EllipsometryProject){return a.id!==b.id||a.ambient!==b.ambient||a.layers!==b.layers||a.substrate!==b.substrate||a.experimentData!==b.experimentData||a.fittingConfig!==b.fittingConfig||a.expert?.smoothing!==b.expert?.smoothing;}
export function useBrowserCompute(initial:()=>EllipsometryProject) {
  // This ref is updated only by apply(), never by a speculative React render.
  // Concurrent rendering must not restore an older input snapshot.
  const [project,rawSet]=useState(initial),current=useRef(project);
  const revision=useRef(0),fit=useRef(new ComputationClient()),forward=useRef(new ComputationClient());
  const [busy,setBusy]=useState(false),[forwardPending,setForwardPending]=useState(false),[error,setError]=useState('');
  const busyRef=useRef(false),forwardTimer=useRef<ReturnType<typeof setTimeout>|null>(null),mounted=useRef(true);
  const apply=(next:EllipsometryProject)=>{current.current=next;rawSet(next);};
  const refresh=useCallback((delay=0)=>{
    if(forwardTimer.current)clearTimeout(forwardTimer.current);
    forward.current.cancel();setForwardPending(!!current.current.experimentData?.points.length);
    const version=revision.current;
    forwardTimer.current=setTimeout(async()=>{
      if(!current.current.experimentData?.points.length){setForwardPending(false);return;}
      try {
        const output=await forward.current.start('forward',current.current,version);
        if(!mounted.current||version!==revision.current)return;
        const p=current.current,next={...p,experimentData:p.experimentData?{...p.experimentData,points:output.project!.experimentData!.points}:null};
        apply(next);setError('');setForwardPending(false);
      }catch(e){if(!isAbort(e)&&mounted.current){setError(String(e));setForwardPending(false);}}
    },delay);
  },[]);
  const setProject:Dispatch<SetStateAction<EllipsometryProject>>=useCallback(update=>{
    const previous=current.current,next=typeof update==='function'?update(previous):update;
    const changed=inputsChanged(previous,next);
    if(changed){revision.current++;fit.current.cancel('Inputs changed; stale fitting result discarded');}
    apply(changed?{...next,fittingResult:null}:next);
    if(changed)refresh(70);
  },[refresh]);
  const run=useCallback(async(operation:Exclude<Operation,'forward'|'tests'>,stage?:number,layerIndex?:number,onProgress?:(p:Progress)=>void)=>{
    if(busyRef.current)throw new Error('A calculation is already running');
    busyRef.current=true;setBusy(true);setError('');
    const version=revision.current;
    if(forwardTimer.current)clearTimeout(forwardTimer.current);forward.current.cancel();setForwardPending(false);
    try {
      const output=await fit.current.start(operation,current.current,version,{stage,layerIndex,onProgress});
      if(!mounted.current||revision.current!==version)throw aborted('Stale calculation result discarded');
      if(output.project) {
        const p=current.current,w=output.project;
        apply({...p,layers:w.layers,substrate:w.substrate,ambient:w.ambient,
          experimentData:p.experimentData?{...p.experimentData,points:w.experimentData!.points}:null,
          fittingResult:w.fittingResult,expert:w.expert?{...w.expert,candidates:p.expert?.candidates??[]}:p.expert});
      }
      return output;
    }catch(e){if(!isAbort(e)&&mounted.current)setError(String(e));throw e;}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  },[]);
  const cancel=useCallback(()=>{revision.current++;fit.current.cancel();forward.current.cancel();if(forwardTimer.current)clearTimeout(forwardTimer.current);setForwardPending(false);},[]);
  const ensureForward=useCallback(async()=>{
    if(forwardTimer.current)clearTimeout(forwardTimer.current);
    const version=revision.current;setForwardPending(true);
    try {
      const output=await forward.current.start('forward',current.current,version);
      if(!mounted.current||version!==revision.current)throw aborted('Inputs changed during export');
      const p=current.current,next={...p,experimentData:p.experimentData?{...p.experimentData,points:output.project!.experimentData!.points}:null};
      apply(next);setForwardPending(false);return next;
    }catch(e){if(!isAbort(e)){setError(String(e));setForwardPending(false);}throw e;}
  },[]);
  useEffect(()=>{mounted.current=true;refresh();return()=>{mounted.current=false;if(forwardTimer.current)clearTimeout(forwardTimer.current);fit.current.dispose();forward.current.dispose();};},[refresh]);
  useEffect(()=>{const close=()=>{fit.current.dispose();forward.current.dispose();};window.addEventListener('pagehide',close);return()=>window.removeEventListener('pagehide',close);},[]);
  return {project,setProject,run,cancel,refresh,ensureForward,busy,forwardPending,error,revision};
}
