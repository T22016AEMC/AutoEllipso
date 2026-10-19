import React, { useRef, useState } from 'react';
import { EllipsometryProject, Layer, ParameterValue } from '../types/ellipsometry';
import { modelRegistry } from '../modelRegistry/registry';
import { APP_VERSION } from '../version';
import { peakTypes } from '../models/expertMixed';
import { computeMultiAoiResidualMetrics } from '../fitting/residual';
import { addPeak, changeSplineGrid, clone, deletePeak, ExpertProgress, freshForward, initializeMixed,
  initializeSpline, runExpertStage, session, snapshot, splineGrid, stageNames, values, validateExpert } from '../fitting/expertWorkflow';

interface Props {project:EllipsometryProject;onChange:(p:EllipsometryProject)=>void;onClose:()=>void;disabled:boolean;forwardPending:boolean;forwardError:string;onRecalculate:()=>void;onCancel:()=>void;onRunStage:(stage:number,index:number,onProgress:(p:ExpertProgress)=>void)=>Promise<void>}
const btn='px-2 py-1 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 disabled:opacity-40';
const input='w-24 p-1 rounded bg-slate-900 border border-slate-600';
function capture(svg:SVGSVGElement,id:number){try{svg.setPointerCapture(id);}catch{/* A cancelled or synthetic pointer may no longer be active. */}}
function Numeric({label,value,onChange,...rest}:{label:string;value:number;onChange:(v:number)=>void;min?:number;max?:number;disabled?:boolean}) {
  return <input aria-label={label} title={label} className={input} type="number" step="any" value={Number.isFinite(value)?value:''}
    onChange={e=>{if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))onChange(e.target.valueAsNumber);}} {...rest}/>;
}
function Curves({series,title}:{title:string;series:{name:string;color:string;points:[number,number][];dots?:boolean}[]}) {
  let xmin=Infinity,xmax=-Infinity,ymin=0,ymax=1;
  for(const s of series)for(const [x,y] of s.points){xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
  if(!Number.isFinite(xmin)){xmin=0;xmax=1;}
  const pos=([x,y]:[number,number])=>`${40+(x-xmin)/Math.max(1,xmax-xmin)*700},${175-(y-ymin)/Math.max(1,ymax-ymin)*145}`;
  return <div className="border border-slate-700 rounded p-2"><div>{title} <span className="text-xs text-slate-400">{series.map(s=>s.name).join(' / ')}</span></div>
    <svg viewBox="0 0 780 200" role="img" aria-label={title} className="w-full">
      <path d="M40 20V175H740" stroke="#64748b" fill="none"/>
      <text x="2" y="30" fill="#94a3b8" fontSize="12">{ymax.toFixed(2)}</text><text x="5" y="175" fill="#94a3b8" fontSize="12">{ymin.toFixed(1)}</text>
      <text x="40" y="195" fill="#94a3b8" fontSize="12">{xmin.toFixed(0)} nm</text><text x="680" y="195" fill="#94a3b8" fontSize="12">{xmax.toFixed(0)} nm</text>
      {series.map(s=>s.dots&&s.points.length<=2000?s.points.map((p,i)=>{const [cx,cy]=pos(p).split(',');return <circle key={s.name+i} cx={cx} cy={cy} r="1.6" fill={s.color}/>;}):
        <polyline key={s.name} points={s.points.map(pos).join(' ')} fill="none" stroke={s.color} strokeWidth="1.8"/>)}
    </svg></div>;
}
export function ExpertFittingPanel({project,onChange,onClose,disabled,forwardPending,forwardError,onRecalculate,onCancel,onRunStage}:Props) {
  const [index,setIndex]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState<ExpertProgress|null>(null);
  const [undo,setUndo]=useState<EllipsometryProject[]>([]),[redo,setRedo]=useState<EllipsometryProject[]>([]),[candidateName,setCandidateName]=useState('Manual candidate');
  const [kind,setKind]=useState(0),[viewAoi,setViewAoi]=useState(project.experimentData?.points[0]?.aoi??70);
  const stop=useRef(false),drag=useRef<{key:string;initial:EllipsometryProject}|null>(null),latest=useRef(project);latest.current=project;
  const initial=useRef(clone(project));
  const l=project.layers[index],s=session(project),locked=busy||disabled;
  const allPoints=project.experimentData?.points??[],pts=allPoints.filter(p=>p.aoi===viewAoi).sort((a,b)=>a.wavelength-b.wavelength);
  const metrics=computeMultiAoiResidualMetrics(allPoints,project.fittingConfig.activeFitAois,project.fittingConfig.fitWeighting,project.fittingConfig.psiWeight,project.fittingConfig.deltaWeight,project.fittingResult?.numParameters??0);
  function remember(p:EllipsometryProject){setUndo(u=>[...u.slice(-Math.max(1,Math.min(63,Math.floor(50000/Math.max(1,p.experimentData?.points.length??1))))),{...p,expert:p.expert?{...p.expert,candidates:[]}:undefined}]);setRedo([]);}
  function commit(p:EllipsometryProject,record=true) {
    try { if(p.experimentData?.points.length)validateExpert(p); const next=p;if(record)remember(latest.current);onChange(next);setError(''); }
    catch(e){setError(String(e));}
  }
  function layerChange(next:Layer,record=true) {const p=clone(latest.current);p.layers[index]=next;commit(p,record);}
  function edit(key:string,change:Partial<ParameterValue>,record=true) {
    const next=clone(latest.current.layers[index]),v=next.parameters[key];
    if(v&&!v.fit&&change.current!==undefined && (key.startsWith('N')||key.startsWith('K')||key.startsWith('base_')||key.startsWith('p')&&!key.endsWith('enabled')))return;
    if(v)next.parameters[key]={...v,...change};layerChange(next,record);
  }
  async function run(stage:number){setBusy(true);stop.current=false;setError('');remember(project);
    try {await onRunStage(stage,index,setProgress);}
    catch(e){if(!(typeof e==='object'&&e!==null&&'name' in e&&e.name==='AbortError'))setError(String(e));}finally{setBusy(false);setProgress(null);}
  }
  const grid=l&&(l.modelId==='bspline'||l.modelId==='expert_mixed')?splineGrid(l):[];
  const params=l?values(l):{};
  const model=l?modelRegistry.get(l.modelId):undefined;
  const wavelengths=Array.from({length:121},(_,i)=>{
    const lo=project.experimentData?.wavelengthMin??190,hi=project.experimentData?.wavelengthMax??900;return lo+i/120*(hi-lo);});
  let optical:{w:number;n:number;k:number;eps1:number;eps2:number}[]=[];
  try{optical=wavelengths.map(w=>{const o=model?.calculate(w,params);return {w,n:o?.n??0,k:o?.k??0,eps1:o?.eps1??0,eps2:o?.eps2??0};});}catch{}
  const nmax=Math.max(3,...optical.map(o=>o.n),...grid.map((_,i)=>params[`N${i}`]??0));
  const kmax=Math.max(1,...optical.map(o=>o.k),...grid.map((_,i)=>params[`K${i}`]??0));
  const amax=Math.max(4,...Object.entries(params).filter(([key])=>/^p\d+_A$/.test(key)).map(([,v])=>v*1.2));
  const freeScale=Math.max(1,...Object.entries(params).filter(([key])=>/^p\d+_[RI]\d+$/.test(key)).map(([,v])=>Math.abs(v)*1.2));
  const lo=grid[0],hi=grid[grid.length-1],x=(w:number)=>40+(w-lo)/(hi-lo)*700,y=(v:number,prefix:string)=>180-v/(prefix==='N'?nmax:kmax)*145;
  function move(event:React.PointerEvent<SVGSVGElement>) {
    if(!drag.current||locked)return;
    const point=event.currentTarget.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const matrix=event.currentTarget.getScreenCTM();if(!matrix)return;
    const {x:px,y:py}=point.matrixTransform(matrix.inverse());
    const key=drag.current.key;
    if(key.startsWith('N')||key.startsWith('K')) {
      const v=latest.current.layers[index].parameters[key],scale=key.startsWith('N')?nmax:kmax;
      edit(key,{current:Math.max(v.min,Math.min(v.max,(180-py)/145*scale))},false);
    } else if(/^p\d+_[RI]\d+$/.test(key)) {
      const v=latest.current.layers[index].parameters[key];
      edit(key,{current:Math.max(v.min,Math.min(v.max,(100-py)/70*freeScale))},false);
    } else {
      const p=clone(latest.current.layers[index]),i=Number(key),e=p.parameters[`p${i}_E0`],a=p.parameters[`p${i}_A`];
      if(e?.fit)e.current=Math.max(e.min,Math.min(e.max,1239.841984/(lo+(px-40)/700*(hi-lo))));
      if(p.parameters[`p${i}_type`].current===3) {
        if(a?.fit)a.current=Math.max(a.min,Math.min(a.max,1239.841984/(lo+(px-40)/700*(hi-lo))));
        const w=p.parameters[`p${i}_w`];if(w.fit)w.current=Math.max(w.min,Math.min(w.max,(180-py)/145*2));
      } else if(a?.fit)a.current=Math.max(a.min,Math.min(a.max,(180-py)/145*amax));
      layerChange(p,false);
    }
  }
  function end(){if(drag.current){remember(drag.current.initial);drag.current=null;onRecalculate();}}
  const aois=Array.from(new Set(allPoints.map(p=>p.aoi))).sort((a,b)=>a-b);
  return <div className="expert-panel fixed inset-0 z-50 bg-slate-950/95 text-slate-100 overflow-auto p-4" role="dialog" aria-label="Expert Fitting Mode">
    <div className="max-w-[1500px] mx-auto space-y-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-bold">AutoEllipso V{APP_VERSION} · Expert Fitting</h2>
        <button className={btn} disabled={busy} onClick={onClose}>Close Expert</button></div>
      <p className="text-slate-400">Each stage runs on the current saved parameters. Stage 1 explicitly initializes Cauchy; Stage 3 projects a numerical spline to a physical seed. Mixed peaks retain their types, bounds and locks.</p>
      <div className="flex flex-wrap gap-2">{stageNames.map((name,i)=><button key={name} className={btn+(s.stage===i?' border-cyan-400 text-cyan-300':'')} disabled={locked} onClick={()=>onChange({...project,expert:{...s,stage:i}})}>Stage {i}: {name}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label>Film <select aria-label="Expert film" className={input} disabled={locked} value={index} onChange={e=>setIndex(+e.target.value)}>{project.layers.map((v,i)=><option key={v.id} value={i}>{v.name}</option>)}</select></label>
        <button className={btn} disabled={locked} onClick={()=>run(s.stage)}>Run Stage {s.stage}</button>
        <button className={btn} disabled={locked||s.stage===5} onClick={()=>onChange({...project,expert:{...s,stage:Math.min(5,s.stage+1)}})}>Continue to Next Stage</button>
        <button className={btn} disabled={!busy} onClick={()=>{stop.current=true;onCancel();}}>Stop Fit</button>
        <button className={btn} disabled={locked} onClick={onRecalculate}>Fresh TMM Recalculate</button>
        <span className="text-cyan-300">{model?.name}</span>
      </div>
      {progress&&<p role="status">Start {progress.start}/{progress.totalStarts} · Iteration {progress.iteration} · Current MSE (Woollam) {progress.currentMse.toPrecision(7)} · Best MSE (Woollam) {progress.bestMse.toPrecision(7)}</p>}
      {(error||forwardError)&&<p role="alert" className="p-2 bg-red-950 border border-red-600">{error||forwardError}</p>}
      <p role="status" className="expert-forward-status text-amber-300">{forwardPending?'完整 TMM 重算中；目前 Ψ/Δ 曲線與 MSE 為上一輪。':forwardError?'計算失敗；保留上一輪曲線，請修正參數。':project.experimentData?.points.length?'完整光譜 TMM 已更新。':'尚未匯入實驗資料。'}</p>
      <div className="flex flex-wrap gap-5 p-3 border border-cyan-900 rounded bg-cyan-950/20">
        <span>MSE (Woollam): <b>{metrics.mseWoollam.toPrecision(8)}</b> <small>Raw MSE {metrics.rawMse.toPrecision(8)} deg² · χ²ᵣ {metrics.reducedChiSquare.toPrecision(6)}</small></span>
        {metrics.weightingWarning&&<span role="alert" className="text-amber-300">{metrics.weightingWarning}</span>}
        {project.fittingResult?.converged===false&&<span className="text-amber-300">未收斂</span>}<span>Ψ RMSE: {Math.sqrt(metrics.psiMse).toPrecision(6)}°</span><span>Δ RMSE: {Math.sqrt(metrics.deltaMse).toPrecision(6)}°</span>
        {Object.values(metrics.perAoi).map(m=><span key={m.aoi}>AOI {m.aoi}° MSE (Woollam) {m.mseWoollam.toPrecision(6)}</span>)}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button className={btn} disabled={locked||!undo.length} onClick={()=>{const p=undo[undo.length-1];setRedo(r=>[...r,clone(project)]);setUndo(u=>u.slice(0,-1));onChange({...p,expert:{...session(p),candidates:s.candidates}});}}>Undo</button>
        <button className={btn} disabled={locked||!redo.length} onClick={()=>{const p=redo[redo.length-1];setUndo(u=>[...u,clone(project)]);setRedo(r=>r.slice(0,-1));onChange({...p,expert:{...session(p),candidates:s.candidates}});}}>Redo</button>
        <button className={btn} disabled={locked} onClick={()=>commit({...initial.current,expert:{...s,stage:0}})}>Restore Session Start</button>
        <input aria-label="Candidate name" className="p-1 bg-slate-900 border border-slate-600" value={candidateName} onChange={e=>setCandidateName(e.target.value)}/>
        <button className={btn} disabled={locked} onClick={()=>onChange({...project,expert:{...s,candidates:[...s.candidates,{id:crypto.randomUUID(),name:candidateName,stage:s.stage,snapshot:snapshot(project)}]}})}>Save Candidate</button>
        {s.candidates.map(c=><button className={btn} disabled={locked} key={c.id} onClick={()=>{remember(project);onChange({...clone(c.snapshot),expert:{...s,stage:c.stage}});}}>Restore {c.name} (S{c.stage})</button>)}
      </div>
      {l&&<div className="flex flex-wrap gap-4 p-2 border border-slate-700">
        <label>Thickness (nm) <Numeric label="Expert thickness" disabled={locked||!l.thicknessFit} value={l.thickness} onChange={v=>layerChange({...l,thickness:v})}/></label>
        <label><input aria-label="Thickness fit unlocked" type="checkbox" disabled={locked} checked={l.thicknessFit} onChange={e=>layerChange({...l,thicknessFit:e.target.checked})}/> Thickness Unlock</label>
        <Numeric label="Thickness min" disabled={locked} value={l.thicknessMin} onChange={v=>layerChange({...l,thicknessMin:v})}/><Numeric label="Thickness max" disabled={locked} value={l.thicknessMax} onChange={v=>layerChange({...l,thicknessMax:v})}/>
        <label>Substrate <select aria-label="Expert substrate" className="p-1 bg-slate-900" disabled={locked} value={project.substrate.modelId} onChange={e=>commit({...project,substrate:{...project.substrate,modelId:e.target.value,parameters:modelRegistry.createParameterSet(e.target.value)}})}>
          {modelRegistry.getAll().filter(m=>m.type==='tabulated'||m.id==='constant'||m.id==='cauchy').map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {aois.map(a=><label key={a}><input aria-label={`Fit AOI ${a}`} type="checkbox" disabled={locked} checked={!project.fittingConfig.activeFitAois?.length||project.fittingConfig.activeFitAois.includes(a)} onChange={e=>{
          const active=project.fittingConfig.activeFitAois?.length?project.fittingConfig.activeFitAois:aois;
          const next=e.target.checked?[...active,a]:active.filter(v=>v!==a);if(!next.length){setError('Select at least one AOI');return;}
          commit({...project,fittingConfig:{...project.fittingConfig,activeFitAois:next}});
        }}/> Fit AOI {a}°</label>)}
      </div>}
      <div className="flex flex-wrap gap-3 border border-slate-700 p-2">
        <span>Substrate parameters</span>{Object.entries(project.substrate.parameters).map(([key,v])=><label key={key}>{key} <Numeric label={'Substrate '+key} disabled={locked||!v.fit} value={v.current} onChange={x=>{const p=clone(project);p.substrate.parameters[key].current=x;commit(p);}}/>
          <Numeric label={'Substrate '+key+' min'} disabled={locked} value={v.min} onChange={x=>{const p=clone(project);p.substrate.parameters[key].min=x;commit(p);}}/>
          <Numeric label={'Substrate '+key+' max'} disabled={locked} value={v.max} onChange={x=>{const p=clone(project);p.substrate.parameters[key].max=x;commit(p);}}/>
          <input aria-label={'Substrate '+key+' unlocked'} type="checkbox" checked={v.fit} disabled={locked} onChange={e=>{const p=clone(project);p.substrate.parameters[key].fit=e.target.checked;commit(p);}}/> Unlock</label>)}
      </div>
      {s.stage===2&&l&&<>
        <div className="flex flex-wrap gap-2 items-center">
          <button className={btn} disabled={locked||l.modelId==='bspline'} onClick={()=>{try{commit(initializeSpline(project,index));}catch(e){setError(String(e));}}}>Initialize n/k B-spline from Current Model</button>
          <button className={btn} disabled={locked||l.modelId==='expert_mixed'} onClick={()=>{try{commit(initializeMixed(project,index));}catch(e){setError(String(e));}}}>Initialize Physical Peak Builder</button>
          <label>Smoothing λ <Numeric label="Spline smoothing" min={0} disabled={locked} value={s.smoothing} onChange={v=>{if(v>=0)onChange({...project,expert:{...s,smoothing:v}});}}/></label>
          <button className={btn} disabled={locked} onClick={()=>run(2)}>Continue Fitting from Manual n/k / Peaks</button>
        </div>
        {!!grid.length&&<div className="grid lg:grid-cols-2 gap-3">
          <div className="border border-slate-700 p-2 rounded">
            <p>Drag coefficients (cyan n / amber k) or physical peak handles. Control coefficients are not interpolation points.</p>
            <svg viewBox="0 0 780 205" className="w-full touch-none" aria-label="Interactive optical editor" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
              <path d="M40 20V180H740" stroke="#64748b" fill="none"/>
              <text x="40" y="200" fill="#94a3b8">{lo.toFixed(0)} nm</text><text x="660" y="200" fill="#94a3b8">{hi.toFixed(0)} nm</text>
              <text x="40" y="18" fill="#22d3ee">n scale {nmax.toFixed(2)}</text><text x="450" y="18" fill="#fbbf24">k scale {kmax.toFixed(2)}</text>
              {['N','K'].map(pre=><polyline key={pre} points={optical.map(o=>`${x(o.w)},${y(pre==='N'?o.n:o.k,pre)}`).join(' ')} stroke={pre==='N'?'#22d3ee':'#fbbf24'} strokeWidth="2" fill="none"/>)}
              {l.modelId==='bspline'&&['N','K'].flatMap(pre=>grid.map((w,i)=>{
                const key=pre+i,v=l.parameters[key];return <circle key={key} data-testid={`control-${key}`} aria-label={`Drag ${key}`} cx={x(w)} cy={y(v.current,pre)} r={v.fit?6:4} fill={v.fit?(pre==='N'?'#22d3ee':'#fbbf24'):'#64748b'} stroke="white"
                  onPointerDown={e=>{if(locked||!v.fit)return;capture(e.currentTarget.ownerSVGElement!,e.pointerId);drag.current={key,initial:clone(project)};}}><title>{key} = {v.current}</title></circle>;
              }))}
              {l.modelId==='expert_mixed'&&Array.from({length:params._peakCount??0},(_,i)=>i).filter(i=>params[`p${i}_enabled`]&&params[`p${i}_type`]!==4).map(i=><rect key={i} aria-label={`Drag peak ${i+1}`} data-testid={`peak-${i}`} x={Math.max(40,Math.min(740,x(1239.841984/(params[`p${i}_E0`]??params[`p${i}_A`]))))-6} y={180-(params[`p${i}_type`]===3?params[`p${i}_w`]/2:params[`p${i}_A`]/amax)*145-6} width="12" height="12" fill="#c084fc"
                onPointerDown={e=>{if(locked)return;capture(e.currentTarget.ownerSVGElement!,e.pointerId);drag.current={key:String(i),initial:clone(project)};}}/>)}
            </svg>
          </div>
          <Curves title="ε1 / ε2 (dielectric function)" series={[{name:'ε1',color:'#c084fc',points:optical.map(o=>[o.w,o.eps1])},{name:'ε2',color:'#fb7185',points:optical.map(o=>[o.w,o.eps2])}]}/>
        </div>}
        {l.modelId==='bspline'&&<div className="overflow-x-auto max-h-72 border border-slate-700"><table className="w-full"><thead><tr><th>Control location nm</th><th>n coefficient</th><th>n min</th><th>n max</th><th>n Unlock</th><th>k coefficient</th><th>k min</th><th>k max</th><th>k Unlock</th><th>Topology</th></tr></thead><tbody>
          {grid.map((w,i)=><tr key={i}>
            <td><Numeric label={`Control location ${i}`} disabled={locked} value={w} onChange={v=>{try{layerChange(changeSplineGrid(l,grid.map((x,j)=>i===j?v:x)));}catch(e){setError(String(e));}}}/></td>
            {['N','K'].flatMap(pre=>{const key=pre+i,v=l.parameters[key];return [
              <td key={key+'v'}><Numeric label={key} disabled={locked||!v.fit} value={v.current} onChange={x=>edit(key,{current:x})}/></td>,
              <td key={key+'min'}><Numeric label={key+' min'} disabled={locked} value={v.min} onChange={x=>edit(key,{min:x})}/></td>,
              <td key={key+'max'}><Numeric label={key+' max'} disabled={locked} value={v.max} onChange={x=>edit(key,{max:x})}/></td>,
              <td key={key+'lock'}><input aria-label={key+' unlocked'} disabled={locked} type="checkbox" checked={v.fit} onChange={e=>edit(key,{fit:e.target.checked})}/></td>];})}
            <td><button className={btn} disabled={locked||grid.length<=4} onClick={()=>{try{layerChange(changeSplineGrid(l,grid.filter((_,j)=>j!==i)));}catch(e){setError(String(e));}}}>Remove</button>
              <button className={btn} disabled={locked||i===grid.length-1||grid.length>=20} onClick={()=>{try{layerChange(changeSplineGrid(l,[...grid.slice(0,i+1),(w+grid[i+1])/2,...grid.slice(i+1)]));}catch(e){setError(String(e));}}}>Insert After</button></td>
          </tr>)}
        </tbody></table><p className="p-2 text-slate-400">Changing topology projects the old curve into the new basis. Unlock all spline coefficients first.</p></div>}
      </>}
      {l?.modelId==='expert_mixed'&&<div className="space-y-2 border border-slate-700 p-3">
        {l.parameters._baseEnabled&&<details className="border border-amber-800 p-2"><summary className="text-amber-300">Retained manual n/k baseline · numerical, not KK constrained</summary>
          <label><input aria-label="Retained numerical baseline enabled" type="checkbox" disabled={locked} checked={!!params._baseEnabled} onChange={e=>edit('_baseEnabled',{current:e.target.checked?1:0})}/> Include manual baseline (disable for a purely causal peak model)</label>
          <div className="flex flex-wrap gap-2">{Object.entries(l.parameters).filter(([key])=>key.startsWith('base_')).map(([key,v])=><label key={key}>{key}
            <Numeric label={key} value={v.current} disabled={locked||!v.fit} onChange={x=>edit(key,{current:x})}/>
            <Numeric label={key+' min'} value={v.min} disabled={locked} onChange={x=>edit(key,{min:x})}/><Numeric label={key+' max'} value={v.max} disabled={locked} onChange={x=>edit(key,{max:x})}/>
            <input type="checkbox" aria-label={key+' unlocked'} disabled={locked} checked={v.fit} onChange={e=>edit(key,{fit:e.target.checked})}/> Unlock</label>)}</div>
        </details>}
        <div className="flex gap-2 items-center"><select aria-label="Peak type" className="p-1 bg-slate-900" disabled={locked} value={kind} onChange={e=>setKind(+e.target.value)}>{peakTypes.map((t,i)=><option key={t} value={i}>{t}</option>)}</select>
          <button className={btn} disabled={locked} onClick={()=>{try{layerChange(addPeak(l,kind));}catch(e){setError(String(e));}}}>Add Peak</button>
          <span>ε∞</span><Numeric label="eps_inf" disabled={locked||!l.parameters.eps_inf.fit} value={params.eps_inf} onChange={v=>edit('eps_inf',{current:v})}/>
          <Numeric label="eps_inf min" disabled={locked} value={l.parameters.eps_inf.min} onChange={v=>edit('eps_inf',{min:v})}/>
          <Numeric label="eps_inf max" disabled={locked} value={l.parameters.eps_inf.max} onChange={v=>edit('eps_inf',{max:v})}/>
          <label><input aria-label="eps_inf unlocked" type="checkbox" checked={l.parameters.eps_inf.fit} disabled={locked} onChange={e=>edit('eps_inf',{fit:e.target.checked})}/> Unlock</label>
        </div>
        {s.stage===2&&<div className="flex flex-wrap gap-2"><span>Free correction grid (nm)</span>{grid.map((w,j)=><div key={j}>
          <Numeric label={`Free knot ${j}`} disabled={locked} value={w} onChange={v=>{try{layerChange(changeSplineGrid(l,grid.map((x,k)=>k===j?v:x)));}catch(e){setError(String(e));}}}/>
          <button className={btn} disabled={locked||grid.length>=20||j===grid.length-1} onClick={()=>{try{layerChange(changeSplineGrid(l,[...grid.slice(0,j+1),(w+grid[j+1])/2,...grid.slice(j+1)]));}catch(e){setError(String(e));}}}>Insert</button>
          <button className={btn} disabled={locked||grid.length<=4} onClick={()=>{try{layerChange(changeSplineGrid(l,grid.filter((_,k)=>k!==j)));}catch(e){setError(String(e));}}}>Remove</button>
        </div>)}</div>}
        {Array.from({length:params._peakCount??0},(_,i)=>i).map(i=><div key={i} className="p-2 border border-slate-700 rounded space-y-2">
          <div className="flex flex-wrap gap-2"><b>Peak {i+1}: {peakTypes[params[`p${i}_type`]]}</b>
            <label><input aria-label={`Peak ${i+1} enabled`} type="checkbox" disabled={locked} checked={!!params[`p${i}_enabled`]} onChange={e=>edit(`p${i}_enabled`,{current:e.target.checked?1:0})}/> Enabled</label>
            <button className={btn} disabled={locked} onClick={()=>layerChange(addPeak(l,params[`p${i}_type`],i))}>Duplicate Peak {i+1}</button>
            <button className={btn} disabled={locked} onClick={()=>layerChange(deletePeak(l,i))}>Delete Peak {i+1}</button>
          </div>
          {params[`p${i}_type`]===4&&<p className="text-amber-300">Free correction acts on ε1/ε2; it is not Kramers–Kronig constrained. Negative total ε2 is rejected.</p>}
          {params[`p${i}_type`]===4&&<svg viewBox="0 0 780 205" className="w-full touch-none max-h-44" aria-label={`Free correction ${i+1} editor`} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
            <path d="M40 100H740" stroke="#64748b"/><text x="40" y="20" fill="#94a3b8">Drag δε1 (purple) / δε2 (rose) coefficients; scale ±{freeScale.toFixed(2)}</text>
            {['R','I'].flatMap(pre=>grid.map((w,j)=>{const key=`p${i}_${pre}${j}`,v=l.parameters[key];return <circle key={key} aria-label={`Drag ${key}`} cx={x(w)} cy={100-v.current/freeScale*70} r="6" fill={v.fit?(pre==='R'?'#c084fc':'#fb7185'):'#64748b'}
              onPointerDown={e=>{if(locked||!v.fit)return;capture(e.currentTarget.ownerSVGElement!,e.pointerId);drag.current={key,initial:clone(project)};}}/>;}))}
          </svg>}
          <div className="flex flex-wrap gap-3">{Object.entries(l.parameters).filter(([key])=>key.startsWith(`p${i}_`)&&!key.endsWith('type')&&!key.endsWith('enabled')).map(([key,v])=><div key={key} className="border border-slate-800 p-1">
            <label>{key.replace(`p${i}_`,'')} <Numeric label={key} value={v.current} disabled={locked||!v.fit} onChange={x=>edit(key,{current:x})}/></label>
            <label> min <Numeric label={key+' min'} value={v.min} disabled={locked} onChange={x=>edit(key,{min:x})}/></label>
            <label> max <Numeric label={key+' max'} value={v.max} disabled={locked} onChange={x=>edit(key,{max:x})}/></label>
            <label><input aria-label={key+' unlocked'} type="checkbox" disabled={locked} checked={v.fit} onChange={e=>edit(key,{fit:e.target.checked})}/> Unlock</label>
          </div>)}</div>
        </div>)}
      </div>}
      {l&&s.stage!==2&&l.modelId!=='expert_mixed'&&<div className="flex flex-wrap gap-3 border border-slate-700 p-2">{Object.entries(l.parameters).filter(([key])=>!key.startsWith('_')).map(([key,v])=><div key={key}>
        <label>{key} <Numeric label={'Stage '+key} disabled={locked||!v.fit} value={v.current} onChange={x=>edit(key,{current:x})}/></label>
        <Numeric label={'Stage '+key+' min'} value={v.min} disabled={locked} onChange={x=>edit(key,{min:x})}/><Numeric label={'Stage '+key+' max'} value={v.max} disabled={locked} onChange={x=>edit(key,{max:x})}/>
        <label><input type="checkbox" aria-label={'Stage '+key+' unlocked'} disabled={locked} checked={v.fit} onChange={e=>edit(key,{fit:e.target.checked})}/> Unlock</label>
      </div>)}</div>}
      <div className="flex gap-2 items-center"><label>Display AOI <select aria-label="Display AOI" className={input} value={viewAoi} onChange={e=>setViewAoi(+e.target.value)}>{aois.map(a=><option key={a} value={a}>{a}°</option>)}</select></label><span className="text-slate-400">Metrics and fitting use the selected fit AOIs above.</span></div>
      {s.stage!==2&&optical.length>0&&<div className="grid lg:grid-cols-2 gap-3">
        <Curves title="n / k optical constants" series={[{name:'n',color:'#22d3ee',points:optical.map(o=>[o.w,o.n])},{name:'k',color:'#fbbf24',points:optical.map(o=>[o.w,o.k])}]}/>
        <Curves title="ε1 / ε2 dielectric function" series={[{name:'ε1',color:'#c084fc',points:optical.map(o=>[o.w,o.eps1])},{name:'ε2',color:'#fb7185',points:optical.map(o=>[o.w,o.eps2])}]}/>
      </div>}
      {pts.length>0&&<div className="grid lg:grid-cols-2 gap-3">
        <Curves title="Ψ measured / TMM calculated (degrees)" series={[{name:'measured',color:'#94a3b8',dots:true,points:pts.map(p=>[p.wavelength,p.psiExp])},{name:'TMM',color:'#22d3ee',points:pts.filter(p=>p.psiCalc!==undefined).map(p=>[p.wavelength,p.psiCalc!])}]}/>
        <Curves title="Δ measured / TMM calculated (degrees)" series={[{name:'measured',color:'#94a3b8',dots:true,points:pts.map(p=>[p.wavelength,p.deltaExp])},{name:'TMM',color:'#fb7185',points:pts.filter(p=>p.deltaCalc!==undefined).map(p=>[p.wavelength,p.deltaCalc!])}]}/>
        <Curves title="Residual (degrees), circular Δ" series={[{name:'Ψ',color:'#22d3ee',points:pts.map(p=>[p.wavelength,p.psiResidual??0])},{name:'Δ',color:'#fb7185',points:pts.map(p=>[p.wavelength,p.deltaResidual??0])}]}/>
      </div>}
      <details><summary>Stage audit ({s.records.length})</summary>{s.records.map((r,i)=><p key={i}>Stage {r.stage} · {r.message} · Raw MSE {r.rawMse.toPrecision(8)} · {r.at}</p>)}</details>
    </div>
  </div>;
}
