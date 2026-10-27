import React, {useEffect, useId, useMemo, useRef, useState} from 'react';
import {displayAutoAxis, formatDisplayTick} from './resultPlotView';
import type {PlotDisplay, PlotId} from './resultPlotView';
import type {EllipsometryProject, FittingResult} from '../types/ellipsometry';
import type {OpticalConstantPoint} from '../fitting/freeFormOptics';

type Curve = {name:string;color:string;dashed:boolean;points:OpticalConstantPoint[]};
const width=640,height=240,padding={top:20,right:40,bottom:45,left:100};
const plotWidth=width-padding.left-padding.right,plotHeight=height-padding.top-padding.bottom;

function nearestIndex(waves:number[],target:number) {
  let lo=0,hi=waves.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(waves[mid]<target)lo=mid+1;else hi=mid;}
  if(lo===0)return 0;if(lo===waves.length)return lo-1;
  return target-waves[lo-1]<=waves[lo]-target?lo-1:lo;
}

function OpticalPlot({kind,curves,view}:{kind:'n'|'k';curves:Curve[];view:PlotDisplay}) {
  const log=kind==='k'&&view.kLog;
  const id:PlotId=log?'k_log':kind;
  const clipId=useId();
  const [xMin,xMax]=view.xRange;
  const [hover,setHover]=useState<{wavelength:number;source:Curve[];log:boolean}|null>(null);
  const drawing=useMemo(()=>{
    const visible=curves.map(c=>({...c,points:c.points.filter(p=>Number.isFinite(p.wavelength)&&p.wavelength>=xMin&&p.wavelength<=xMax&&Number.isFinite(p[kind])&&(!log||p[kind]>0))})).filter(c=>c.points.length).map(c=>({...c,waves:c.points.map(p=>p.wavelength)}));
    const waves=[...new Set(visible.flatMap(c=>c.waves))].sort((a,b)=>a-b);
    const axis=displayAutoAxis(visible.flatMap(c=>c.points.map(p=>log?Math.log10(p[kind]):p[kind])),[0,1]);
    return {visible,waves,axis};
  },[curves,kind,log,xMin,xMax]);
  const {visible,waves,axis}=drawing;
  const [yMin,yMax]=view.manualY[id]??axis.range;
  const {onAutoRange}=view;
  useEffect(()=>onAutoRange(id,axis),[onAutoRange,id,axis]);
  const x=(wl:number)=>padding.left+(wl-xMin)/(xMax-xMin||1)*plotWidth;
  const y=(v:number)=>padding.top+plotHeight-((log?Math.log10(v):v)-yMin)/(yMax-yMin)*plotHeight;
  const paths=useMemo(()=>curves.map(c=>{
    let pen=false;const path=c.points.map(p=>{
          if(!Number.isFinite(p.wavelength)||p.wavelength<xMin||p.wavelength>xMax||!Number.isFinite(p[kind])||(log&&p[kind]<=0)){pen=false;return '';}
          const command=`${pen?'L':'M'} ${x(p.wavelength)} ${y(p[kind])}`;pen=true;return command;
        }).join(' ');
    return {...c,path};
  }),[curves,kind,log,xMin,xMax,yMin,yMax]);
  const active=hover?.source===curves&&hover.log===log&&hover.wavelength>=xMin&&hover.wavelength<=xMax?hover:null;
  const title=kind==='n'?'折射率 n(λ)':'消光係數 k(λ)';
  const values=active?visible.flatMap(c=>{const i=nearestIndex(c.waves,active.wavelength),p=c.points[i];return p?.wavelength===active.wavelength?[{name:c.name,value:p[kind]}]:[];}):[];
  return <div role="group" tabIndex={0} data-plot-id={id} data-active={view.activePlot===id} data-y-mode={view.manualY[id]?'manual':'auto'} data-y-min={yMin} data-y-max={yMax} onPointerDownCapture={()=>view.onActivate(id)} onFocusCapture={()=>view.onActivate(id)} className="plot-card nk-card bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col flex-1 shadow-sm" aria-label={title}>
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-semibold text-slate-100">{title}</span>
      <div className="plot-title-actions">{kind==='k'&&<div className="nk-scale" role="group" aria-label="k 座標尺度">
        <button type="button" aria-pressed={!log} onClick={()=>{view.onKLogChange(false);view.onActivate('k');}}>線性</button>
        <button type="button" aria-pressed={log} onClick={()=>{view.onKLogChange(true);view.onActivate('k_log');}}>對數</button>
      </div>}<span className="plot-y-mode">{view.manualY[id]?'Y 手動':'Y 自動'}</span></div>
    </div>
    <div className="plot-canvas relative flex-1 min-h-[180px]">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full cursor-crosshair overflow-visible select-none" aria-label={`${title}曲線`}
        onPointerMove={event=>{
          if(!waves.length)return;const svg=event.currentTarget,point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
          const matrix=svg.getScreenCTM();if(!matrix)return;
          const target=xMin+(point.matrixTransform(matrix.inverse()).x-padding.left)/plotWidth*(xMax-xMin);
          setHover({wavelength:waves[nearestIndex(waves,target)],source:curves,log});
        }} onPointerLeave={()=>setHover(null)}>
        <defs><clipPath id={clipId}><rect x={padding.left} y={padding.top} width={plotWidth} height={plotHeight}/></clipPath></defs>
        <rect x={padding.left} y={padding.top} width={plotWidth} height={plotHeight} fill="var(--card)" stroke="var(--card-border)"/>
        {Array.from({length:6},(_,i)=>{const tick=yMin+(yMax-yMin)*i/5,py=padding.top+plotHeight-i/5*plotHeight,value=log?10**tick:tick;
          return <g key={i}><line x1={padding.left} y1={py} x2={padding.left+plotWidth} y2={py} stroke="var(--card-border)" strokeDasharray="3 3"/>
            <text x={padding.left-8} y={py+3} textAnchor="end" fill="var(--text-muted)">{formatDisplayTick(value,log?10**(tick+(yMax-yMin)/5)-value:(yMax-yMin)/5)}</text></g>;
        })}
        {Array.from({length:7},(_,i)=>{const wl=xMin+(xMax-xMin)*i/6,px=padding.left+i/6*plotWidth;
          return <g key={i}><line x1={px} y1={padding.top} x2={px} y2={padding.top+plotHeight} stroke="var(--card-border)" strokeDasharray="3 3"/>
            <text x={px} y={padding.top+plotHeight+16} textAnchor="middle" fill="var(--text-muted)">{Math.round(wl)}</text></g>;
        })}
        <text x={padding.left+plotWidth/2} y={height-4} textAnchor="middle" fill="var(--text-muted)">波長 λ (nm)</text>
        <text transform={`rotate(-90 16 ${padding.top+plotHeight/2})`} x={16} y={padding.top+plotHeight/2} textAnchor="middle" fill="var(--text-muted)">{kind}</text>
        <g clipPath={`url(#${clipId})`}>{paths.map(c=><path key={c.name} d={c.path} fill="none" stroke={c.color} strokeWidth="2" strokeDasharray={c.dashed?'6 3':undefined}/>)}
        {active&&<line x1={x(active.wavelength)} x2={x(active.wavelength)} y1={padding.top} y2={padding.top+plotHeight} stroke="var(--accent)" strokeDasharray="2 2"/>}
        </g>
      </svg>
      {!!visible.length&&<div className="nk-legend">{visible.map(c=><div key={c.name}><span style={{borderTopColor:c.color,borderTopStyle:c.dashed?'dashed':'solid'}}/>{c.name}</div>)}</div>}
      {active&&<div className="nk-tooltip font-mono" role="status">波長 {active.wavelength} nm{values.map(v=><div key={v.name}>{v.name}：{v.value.toFixed(kind==='n'?4:5)}</div>)}</div>}
      {kind==='k'&&log&&curves.some(c=>c.points.some(p=>p.wavelength>=xMin&&p.wavelength<=xMax))&&!visible.length&&<p className="nk-empty">k ≤ 0，無法以對數顯示</p>}
    </div>
  </div>;
}

export function OpticalConstantsPanel({project,busy,view}:{project:EllipsometryProject;busy:boolean;view:PlotDisplay}) {
  const [layer,setLayer]=useState(0);
  const {activeFitAois:ignored,...otherConfig}=project.fittingConfig;
  const configKey=JSON.stringify(otherConfig);
  const inputs=useMemo(()=>({}),[project.id,project.layers,project.ambient,project.substrate,project.experimentData?.filename,project.experimentData?.importedAt,configKey]);
  const cached=useRef<{inputs:object;result:FittingResult|null}|null>(null);
  // AOI-only selections clear the shared result; n/k is independent of those selections.
  const result=project.fittingResult??(cached.current?.inputs===inputs?cached.current.result:null);
  useEffect(()=>{cached.current={inputs,result};},[inputs,result]);
  const selected=project.layers[layer]?layer:0;
  const curves=useMemo(()=>{
    if(busy||!result)return [];
    const entries:Curve[]=[];
    if(selected===0&&result.finalOpticalConstants?.length)entries.push({name:'物理模型',color:'var(--accent)',dashed:false,points:result.finalOpticalConstants});
    if(selected===(result.freeFormModel?.primaryLayerIndex??0)&&result.freeFormOpticalConstants?.length)entries.push({name:'自由形式',color:'var(--primary)',dashed:true,points:result.freeFormOpticalConstants});
    return entries.map(c=>({...c,points:[...c.points].sort((a,b)=>a.wavelength-b.wavelength)}));
  },[result,selected,busy]);
  return <section className="nk-section" aria-label="光學常數曲線">
    {project.layers.length>1&&<label className="nk-layer">層 <select aria-label="光學常數層" value={selected} onChange={event=>setLayer(Number(event.target.value))}>{project.layers.map((l,i)=><option key={l.id} value={i}>{l.name}</option>)}</select></label>}
    <div className="plot-grid"><OpticalPlot kind="n" curves={curves} view={view}/><OpticalPlot kind="k" curves={curves} view={view}/></div>
  </section>;
}
