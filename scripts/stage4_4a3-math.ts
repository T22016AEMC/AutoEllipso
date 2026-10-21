import {svd} from '../src/fitting/svd';
import type {OptimizationVariable} from '../src/fitting/optimizer';

export function parameterSnapshot(variables:OptimizationVariable[],values:number[]) {
 return variables.map((v,i)=>{
  const u=(values[i]-v.min)/(v.max-v.min);
  return {id:v.id,value:values[i],u,min:v.min,max:v.max,nearLower:u<1e-3,nearUpper:1-u<1e-3};
 });
}
function decomposition(J:number[][],ids:string[]) {
 if(!ids.length)return {ids,error:'No columns'};
 try{
  const raw=svd(J),norms=ids.map((_,j)=>Math.hypot(...J.map(row=>row[j])));
  const normalized=svd(J.map(row=>row.map((x,j)=>norms[j]>0?x/norms[j]:0)));
  const summary=(s:ReturnType<typeof svd>)=>({maximum:s.singularValues[0],minimum:s.singularValues.at(-1),
   singularValues:s.singularValues,truncated:s.truncated,
   condition:s.singularValues.at(-1)!>0?s.singularValues[0]/s.singularValues.at(-1)!:'Infinity',
   minimumVector:ids.map((id,i)=>({id,component:s.v[i].at(-1)!})).sort((a,b)=>Math.abs(b.component)-Math.abs(a.component))});
  return {ids,columnNorms:norms,raw:summary(raw),normalized:summary(normalized)};
 }catch(error){return {ids,error:String(error)};}
}
export function matrixDiagnostics(J:number[][],variables:OptimizationVariable[],u:number[],g:number[]) {
 const ids=variables.map(v=>v.id),norms=ids.map((_,j)=>Math.hypot(...J.map(row=>row[j])));
 const active=ids.map((_,j)=>j).filter(j=>!((u[j]<=1e-8&&g[j]>0)||(u[j]>=1-1e-8&&g[j]<0)));
 const informative=active.filter(j=>norms[j]>0);
 return {rows:J.length,columns:ids.length,full:decomposition(J,ids),
  activeNonzero:decomposition(J.map(row=>informative.map(j=>row[j])),informative.map(j=>ids[j])),
  excludedActive:ids.filter((_,j)=>!active.includes(j)),zeroColumns:ids.filter((_,j)=>norms[j]===0)};
}
