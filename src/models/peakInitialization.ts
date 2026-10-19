import type {ModelDefinition,ParameterValue} from '../types/ellipsometry';
export interface DetectedPeak {energy:number;height:number;prominence:number;width:number;edgePeak:boolean}
export interface PeakInitialization {peaksDetected:number;peaks:DetectedPeak[];oscillatorsUsed:number;edgePeak:boolean;method:string}
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export function dielectricBackground(points:{target:number;contribution:number}[]):number {
  return points.reduce((sum,p)=>sum+(p.target-p.contribution),0)/points.length;
}
/** Quadratic Savitzky–Golay on an equispaced energy grid, with translated end windows. */
export function detectEpsilonPeaks(input:{energy:number;eps2:number}[],maximum=4):PeakInitialization {
  const data=[...input].sort((a,b)=>a.energy-b.energy);
  if(data.length<2||data.some(p=>!Number.isFinite(p.energy)||!Number.isFinite(p.eps2)))return {peaksDetected:0,peaks:[],oscillatorsUsed:1,edgePeak:false,method:'fallback'};
  const lo=data[0].energy,hi=data.at(-1)!.energy,range=hi-lo,n=data.length;
  if(range<=0)throw new Error('Peak initialization requires an energy range');
  // Interpolate nonuniform wavelength samples before fixed-width energy smoothing.
  let cursor=0;
  const energy=Array.from({length:n},(_,i)=>lo+range*i/(n-1));
  const raw=energy.map(x=>{while(cursor<n-2&&data[cursor+1].energy<x)cursor++;
    const a=data[cursor],b=data[cursor+1];return Math.max(0,a.eps2+(b.eps2-a.eps2)*(x-a.energy)/(b.energy-a.energy));});
  let window=Math.max(5,Math.round(n/15));if(window%2===0)window++;
  window=Math.min(window,n%2?n:n-1);const half=(window-1)/2;
  const smooth=raw.map((_,i)=>{
    if(n<5)return raw.slice(Math.max(0,i-1),Math.min(n,i+2)).reduce((s,v)=>s+v,0)/(Math.min(n,i+2)-Math.max(0,i-1));
    const start=clamp(i-half,0,n-window),mom=[0,0,0,0,0],rhs=[0,0,0];
    for(let j=start;j<start+window;j++){const x=j-i;for(let k=0;k<5;k++)mom[k]+=x**k;for(let k=0;k<3;k++)rhs[k]+=raw[j]*x**k;}
    const a=Array.from({length:3},(_,r)=>[...Array.from({length:3},(_,c)=>mom[r+c]),rhs[r]]);
    for(let k=0;k<3;k++){const d=a[k][k];for(let j=k;j<4;j++)a[k][j]/=d;for(let r=0;r<3;r++)if(r!==k){const f=a[r][k];for(let j=k;j<4;j++)a[r][j]-=f*a[k][j];}}
    return Math.max(0,a[0][3]);
  });
  const max=Math.max(...smooth),peaks:DetectedPeak[]=[];
  for(let i=1;i<n-1;i++)if(smooth[i]>smooth[i-1]&&smooth[i]>=smooth[i+1]) {
    let left=i,right=i,lmin=smooth[i],rmin=smooth[i];
    while(left>0){left--;lmin=Math.min(lmin,smooth[left]);if(smooth[left]>smooth[i])break;}
    while(right<n-1){right++;rmin=Math.min(rmin,smooth[right]);if(smooth[right]>smooth[i])break;}
    const prominence=smooth[i]-Math.max(lmin,rmin);if(prominence<.05*max||prominence<=0)continue;
    const level=smooth[i]-prominence/2;left=i;right=i;
    while(left>0&&smooth[left]>level)left--;while(right<n-1&&smooth[right]>level)right++;
    const crossing=(a:number,b:number)=>energy[a]+(energy[b]-energy[a])*(level-smooth[a])/(smooth[b]-smooth[a]||1);
    const width=crossing(right-1,right)-crossing(left,left+1);
    peaks.push({energy:energy[i],height:smooth[i],prominence,width:clamp(width,.01*range,.3*range),edgePeak:false});
  }
  const selected:DetectedPeak[]=[];
  for(const peak of peaks.sort((a,b)=>b.prominence-a.prominence||a.energy-b.energy))
    if(selected.every(p=>Math.abs(p.energy-peak.energy)>=.04*range)&&selected.length<maximum)selected.push(peak);
  const edge=max>0&&((smooth[0]===max&&smooth[0]>smooth[1])||(smooth[n-1]===max&&smooth[n-1]>smooth[n-2]));
  return {peaksDetected:selected.length,peaks:selected,oscillatorsUsed:Math.max(1,selected.length),edgePeak:edge,method:'epsilon2-Savitzky-Golay'};
}

export function initializeDetectedPeaks(modelId:string,spectrum:{wavelength:number;n:number;k:number}[],
  params:Record<string,ParameterValue>,model:ModelDefinition,maximum=4):{parameters:Record<string,ParameterValue>;initialization:PeakInitialization;useLegacyFallback:boolean} {
  const data=spectrum.map(p=>({...p,energy:1239.841984/p.wavelength,eps2:2*p.n*p.k,eps1:p.n*p.n-p.k*p.k})).sort((a,b)=>a.energy-b.energy);
  const supported=['gaussian','lorentz','tauc_lorentz','multi_oscillator'].includes(modelId);
  const capacity=supported?Math.min(maximum,1+Number(!!params.A2)+Number(!!params.A3)):1;
  const info=detectEpsilonPeaks(data,capacity),result=structuredClone(params);
  const transparent=Math.max(...data.map(p=>p.k))<.035&&Math.max(...data.map(p=>p.eps2))<.18;
  if(!supported||transparent||(!info.peaksDetected&&!info.edgePeak))
    return {parameters:result,initialization:{...info,oscillatorsUsed:1,method:transparent?'transparent-legacy-fallback':'single-legacy-fallback'},useLegacyFallback:true};
  const lo=data[0].energy,hi=data.at(-1)!.energy,range=hi-lo;
  const peaks=[...info.peaks];
  if(info.edgePeak&&peaks.length<capacity)peaks.push({energy:data[0].eps2>data.at(-1)!.eps2?Math.max(.01,lo-.15*range):hi+.15*range,
    height:Math.max(...data.map(p=>p.eps2)),prominence:0,width:.15*range,edgePeak:true});
  const set=(key:string,value:number,fit=true)=>{const p=result[key];if(p){p.current=clamp(value,p.min,p.max);p.initial=p.current;p.fit=fit;}};
  for(let i=1;i<=3;i++){const suffix=i===1&&modelId!=='multi_oscillator'?'':String(i);set('A'+suffix,0,false);}
  const first=Math.min(...peaks.map(p=>p.energy));
  const onset=data.find(p=>p.eps2>.02*Math.max(...peaks.map(p=>p.height)))?.energy??lo;
  const gap=clamp(onset,lo,first*.95);if(modelId==='tauc_lorentz')set('Eg',gap);
  peaks.forEach((peak,i)=>{
    const mixed=modelId==='multi_oscillator',suffix=i===0&&!mixed?'':String(i+1);
    const type=mixed?(result[`osc${i+1}_type_code`]?.current??(i===2?2:1)):modelId==='gaussian'?1:modelId==='lorentz'?2:3;
    const widthKey=mixed?'w':modelId==='gaussian'?'sigma':modelId==='lorentz'?'gamma':'C';
    set('E0'+suffix,peak.energy);let width=type===1?peak.width/(2*Math.sqrt(Math.log(2))):peak.width;
    if(modelId==='tauc_lorentz')width=Math.min(width,1.999*result['E0'+suffix].current);
    set(widthKey+suffix,width);
    const record=Object.fromEntries(Object.entries(result).map(([k,p])=>[k,p.current]));
    const single={...record,eps_inf:0,A:1,A1:1,A2:0,A3:0,E0:record['E0'+suffix],E01:record['E0'+suffix],
      [widthKey]:record[widthKey+suffix],[widthKey+'1']:record[widthKey+suffix],...(mixed?{osc1_type_code:type}:{})};
    const unit=model.calculateEpsilon(1239.841984/peak.energy,single).eps2;
    set('A'+suffix,peak.height/Math.max(1e-12,unit));
  });
  // One background estimate: long-wavelength n/k minus all initialized oscillator contributions.
  const long=data.slice(0,Math.max(1,Math.ceil(data.length*.15)));
  const record=Object.fromEntries(Object.entries(result).map(([k,p])=>[k,p.current]));
  const offset=dielectricBackground(long.map(p=>({target:p.eps1,contribution:model.calculateEpsilon(p.wavelength,{...record,eps_inf:0}).eps1})));
  set('eps_inf',offset);
  return {parameters:result,initialization:{...info,peaks,oscillatorsUsed:peaks.length},useLegacyFallback:false};
}
