import {centralDifferenceJacobian, OptimizationVariable} from './optimizer';
import {FIT_NUMERICS} from './numerics';
import {svd} from './svd';

export interface StatisticalVariable extends OptimizationVariable { locked?:boolean; splineCoefficient?:boolean }
export function isSplineCoefficient(key:string):boolean {return /^(?:[NK]|base_[NK]|p\d+_[RI])\d+$/.test(key);}
export interface FitStatistics {
  available:boolean;
  parameters:{id:string;value:number;stdError:number|null;stdErrorUnscaled:number|null;ci95:[number,number]|null;
    boundaryHit:boolean;nonIdentifiable:boolean;locked:boolean;transform:'linear';derivative:number}[];
  dof:number;chiSquare:number;reducedChiSquare:number|null;scaleFactor:number|null;
  covariance:{ids:string[];matrix:number[][];unscaledMatrix:number[][]};
  correlation:{ids:string[];matrix:(number|null)[][];topPairs:{ids:[string,string];correlation:number}[]};
  conditionNumber:number|null;conditionLevel:'ok'|'caution'|'severe';
  truncatedSingularValues:number;warnings:string[];elapsedMs:number;
}

function logGamma(z:number):number {
  const c=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
  z-=1;let x=.99999999999980993;
  c.forEach((a,i)=>x+=a/(z+i+1));const t=z+c.length-.5;
  return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);
}
function betaFraction(a:number,b:number,x:number):number {
  const tiny=1e-300;let c=1,d=1-(a+b)*x/(a+1);if(Math.abs(d)<tiny)d=tiny;
  d=1/d;let h=d;
  for(let m=1;m<=300;m++) {
    const m2=2*m;
    let aa=m*(b-m)*x/((a+m2-1)*(a+m2));
    d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;h*=d*c;
    aa=-(a+m)*(a+b+m)*x/((a+m2)*(a+m2+1));
    d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;
    const change=d*c;h*=change;if(Math.abs(change-1)<3e-14)return h;
  }
  throw new Error('Incomplete beta continued fraction did not converge');
}
function regularizedBeta(x:number,a:number,b:number):number {
  if(x<=0)return 0;if(x>=1)return 1;
  const factor=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
  return x<(a+1)/(a+b+2)?factor*betaFraction(a,b,x)/a:1-factor*betaFraction(b,a,1-x)/b;
}
/** 97.5% Student t quantile, inverted through the regularized incomplete beta. */
export function studentT975(dof:number):number {
  if(!Number.isInteger(dof)||dof<=0)throw new Error('Student t requires positive integer dof');
  if(dof>1000)return 1.959963984540054;
  let lo=0,hi=16;
  for(let i=0;i<70;i++){const t=(lo+hi)/2,cdf=1-.5*regularizedBeta(dof/(dof+t*t),dof/2,.5);if(cdf<.975)lo=t;else hi=t;}
  return (lo+hi)/2;
}

/** Fresh final-point Jacobian only. Never called inside an LM iteration or per-start loop. */
export function computeFitStatistics(variables:StatisticalVariable[],params:number[],residualFn:(p:number[])=>number[],
  options:{weights?:number[];isAngularResidual?:(i:number)=>boolean;regularizationResidualsFn?:(p:number[])=>number[]}={}):FitStatistics {
  const start=performance.now(),base=residualFn(params),weights=options.weights??base.map(()=>1);
  if(params.length!==variables.length||base.some(x=>!Number.isFinite(x))||weights.length!==base.length||weights.some(w=>!Number.isFinite(w)||w<0))throw new Error('Invalid statistics residuals or weights');
  const unlocked=variables.map((v,i)=>i).filter(i=>!variables[i].locked&&variables[i].max>variables[i].min);
  const boundary=new Set(unlocked.filter(i=>{const u=(params[i]-variables[i].min)/(variables[i].max-variables[i].min);return u<=FIT_NUMERICS.boundaryEpsilon||u>=1-FIT_NUMERICS.boundaryEpsilon;}));
  const free=unlocked.filter(i=>!boundary.has(i)),dof=base.length-free.length;
  const chiSquare=base.reduce((sum,r,i)=>sum+(r*weights[i])**2,0),scale=dof>0?chiSquare/dof:null;
  const warnings:string[]=[];
  if(boundary.size)warnings.push('其餘參數的不確定度為條件於該參數固定在邊界。');
  const result:FitStatistics={available:dof>0,parameters:[],dof,chiSquare,reducedChiSquare:scale,scaleFactor:scale,
    covariance:{ids:[],matrix:[],unscaledMatrix:[]},correlation:{ids:[],matrix:[],topPairs:[]},
    conditionNumber:null,conditionLevel:'ok',truncatedSingularValues:0,warnings,elapsedMs:0};
  if(dof<=0){warnings.push('dof ≤ 0，無法計算參數不確定度。');result.elapsedMs=performance.now()-start;return result;}
  const nonIdentifiable=new Set<number>();
  if(free.length) {
    const vars=free.map(i=>variables[i]),values=free.map(i=>params[i]);
    const meanW2=weights.reduce((sum,w)=>sum+w*w,0)/Math.max(1,base.length);
    const dataCount=base.length;
    let J:number[][];
    try {
      J=centralDifferenceJacobian(vars,values,vector=>{
        const full=[...params];free.forEach((index,j)=>full[index]=vector[j]);
        return [...residualFn(full),...(options.regularizationResidualsFn?.(full)??[])];
      },i=>i<dataCount&&(options.isAngularResidual?.(i)??i%2===1))
        .map((row,i)=>row.map(x=>x*(i<dataCount?weights[i]:Math.sqrt(meanW2))));
    } finally { residualFn(params);options.regularizationResidualsFn?.(params); }
    if(options.regularizationResidualsFn)warnings.push('共變異包含擬合所用正則化的局部曲率；χ² 與 dof 僅使用實驗資料。');
    const decomp=svd(J),{singularValues:s,v}=decomp,smax=s[0];
    result.truncatedSingularValues=decomp.truncated;
    const cutoff=smax*FIT_NUMERICS.rcond;
    s.forEach((sigma,k)=>{
      if(sigma===0||sigma<cutoff||sigma/smax<FIT_NUMERICS.nonIdentifiableRatio)
        free.forEach((index,j)=>{if(Math.abs(v[j][k])>.3)nonIdentifiable.add(index);});
    });
    const norms=free.map((_,j)=>Math.hypot(...J.map(row=>row[j])));
    const normalized=svd(J.map(row=>row.map((x,j)=>norms[j]>0?x/norms[j]:0)));
    const normalizedS=normalized.singularValues,min=normalizedS[normalizedS.length-1];
    const condition=min>0?normalizedS[0]/min:Infinity;
    result.conditionNumber=Number.isFinite(condition)?condition:null;
    result.conditionLevel=condition>FIT_NUMERICS.severeCondition?'severe':condition>FIT_NUMERICS.cautionCondition?'caution':'ok';
    const unscaled=free.map((pi,i)=>free.map((pj,j)=>{
      let sum=0;for(let k=0;k<s.length;k++)if(s[k]>0&&s[k]>=cutoff)sum+=v[i][k]*v[j][k]/s[k]**2;
      return sum*(variables[pi].max-variables[pi].min)*(variables[pj].max-variables[pj].min);
    }));
    const covariance=unscaled.map(row=>row.map(x=>x*scale!));
    const ids=free.map(i=>variables[i].id);
    const correlation=unscaled.map((row,i)=>row.map((x,j)=>{
      if(nonIdentifiable.has(free[i])||nonIdentifiable.has(free[j]))return null;
      const den=Math.sqrt(unscaled[i][i]*unscaled[j][j]);return den>0?Math.max(-1,Math.min(1,x/den)):null;
    }));
    const pairs:FitStatistics['correlation']['topPairs']=[];
    for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)if(correlation[i][j]!==null)pairs.push({ids:[ids[i],ids[j]],correlation:correlation[i][j]!});
    pairs.sort((a,b)=>Math.abs(b.correlation)-Math.abs(a.correlation));
    result.covariance={ids,matrix:covariance,unscaledMatrix:unscaled};
    result.correlation={ids,matrix:correlation,topPairs:pairs.slice(0,5)};
  } else result.conditionNumber=1;
  const t=studentT975(dof);
  result.parameters=unlocked.filter(i=>!variables[i].splineCoefficient).map(i=>{
    const j=free.indexOf(i),bad=boundary.has(i)||nonIdentifiable.has(i);
    const unscaled=bad?null:Math.sqrt(Math.max(0,result.covariance.unscaledMatrix[j][j]));
    const se=unscaled===null?null:unscaled*Math.sqrt(scale!);
    return {id:variables[i].id,value:params[i],stdError:se,stdErrorUnscaled:unscaled,ci95:se===null?null:[params[i]-t*se,params[i]+t*se],
      boundaryHit:boundary.has(i),nonIdentifiable:nonIdentifiable.has(i),locked:false,transform:'linear',derivative:variables[i].max-variables[i].min};
  });
  if(nonIdentifiable.size)warnings.push('存在不可識別參數；相關方向的標準誤與信賴區間不予輸出。');
  if(result.conditionLevel!=='ok')warnings.push(`欄正規化 Jacobian 條件數等級：${result.conditionLevel}。`);
  result.elapsedMs=performance.now()-start;
  return result;
}
