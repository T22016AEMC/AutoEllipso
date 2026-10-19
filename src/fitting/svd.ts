import {FIT_NUMERICS} from './numerics';

export interface SvdResult { u:number[][]; singularValues:number[]; v:number[][]; truncated:number }

/** Thin, one-sided cyclic Jacobi SVD. Columns of v are right singular vectors. */
export function svd(a:number[][],rcond=FIT_NUMERICS.rcond):SvdResult {
  const m=a.length,n=a[0]?.length??0;
  if(m<n||a.some(row=>row.length!==n||row.some(x=>!Number.isFinite(x)))||!Number.isFinite(rcond)||rcond<0)
    throw new Error('SVD requires a finite rectangular matrix with m >= n and rcond >= 0');
  const b=a.map(row=>Float64Array.from(row));
  const v=Array.from({length:n},(_,i)=>Float64Array.from({length:n},(_,j)=>i===j?1:0));
  let done=n<2;
  for(let sweep=0;sweep<100&&!done;sweep++) {
    done=true;
    for(let p=0;p<n-1;p++)for(let q=p+1;q<n;q++) {
      let alpha=0,beta=0,gamma=0;
      for(let i=0;i<m;i++){alpha+=b[i][p]**2;beta+=b[i][q]**2;gamma+=b[i][p]*b[i][q];}
      if(alpha===0||beta===0||Math.abs(gamma)<=2e-15*Math.sqrt(alpha)*Math.sqrt(beta))continue;
      done=false;
      const zeta=(beta-alpha)/(2*gamma);
      const t=(zeta>=0?1:-1)/(Math.abs(zeta)+Math.hypot(1,zeta)),c=1/Math.hypot(1,t),s=c*t;
      for(let i=0;i<m;i++){const x=b[i][p],y=b[i][q];b[i][p]=c*x-s*y;b[i][q]=s*x+c*y;}
      for(let i=0;i<n;i++){const x=v[i][p],y=v[i][q];v[i][p]=c*x-s*y;v[i][q]=s*x+c*y;}
    }
  }
  if(!done)throw new Error('Jacobi SVD did not converge in 100 sweeps');
  const sigma=Array.from({length:n},(_,j)=>Math.hypot(...b.map(row=>row[j])));
  const order=Array.from({length:n},(_,i)=>i).sort((i,j)=>sigma[j]-sigma[i]);
  const singularValues=order.map(j=>sigma[j]),cutoff=(singularValues[0]??0)*rcond;
  return {singularValues,truncated:singularValues.filter(s=>s===0||s<cutoff).length,
    u:b.map(row=>order.map(j=>sigma[j]>0?row[j]/sigma[j]:0)),v:v.map(row=>order.map(j=>row[j]))};
}

export function solveLeastSquaresSvd(a:number[][],b:number[],rcond=FIT_NUMERICS.rcond) {
  if(b.length!==a.length||b.some(x=>!Number.isFinite(x)))throw new Error('Invalid SVD right hand side');
  const decomposition=svd(a,rcond),{u,v,singularValues}=decomposition,cutoff=(singularValues[0]??0)*rcond;
  const projections=singularValues.map((s,j)=>s>0&&s>=cutoff?u.reduce((sum,row,i)=>sum+row[j]*b[i],0)/s:0);
  return {solution:v.map(row=>row.reduce((sum,x,j)=>sum+x*projections[j],0)),truncated:decomposition.truncated};
}
