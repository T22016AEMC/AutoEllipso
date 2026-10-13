/** Adaptive quadrature with a nonsingular principal-value integrand on [0,infinity).
 * xi = scale*tan(t); subtraction has zero PV integral on this complete domain.
 */
function integrate(f:(x:number)=>number, a:number,b:number,tol:number,depth=18):number {
  const m=(a+b)/2, fa=f(a),fm=f(m),fb=f(b), whole=(b-a)*(fa+4*fm+fb)/6;
  function refine(a:number,b:number,fa:number,fm:number,fb:number,s:number,tol:number,d:number):number {
    const m=(a+b)/2,l=(a+m)/2,r=(m+b)/2,fl=f(l),fr=f(r);
    const sl=(m-a)*(fa+4*fl+fm)/6,sr=(b-m)*(fm+4*fr+fb)/6,err=sl+sr-s;
    if(d===0 || Math.abs(err)<=15*tol) return sl+sr+err/15;
    return refine(a,m,fa,fl,fm,sl,tol/2,d-1)+refine(m,b,fm,fr,fb,sr,tol/2,d-1);
  }
  return refine(a,b,fa,fm,fb,whole,tol,depth);
}
export function kkReal(E:number, eps2:(E:number)=>number, features:number[], tolerance=1e-7):number {
  if (!(E>0)) throw new Error('KK requires positive photon energy');
  const scale=Math.max(1,E,...features.filter(Number.isFinite));
  const y=eps2(E), h=Math.max(1e-6, E*1e-5),dy=(eps2(E+h)-eps2(E-h))/(2*h);
  const f=(t:number)=>{
    if(t===Math.PI/2) return -E*y/scale;
    const x=scale*Math.tan(t),jac=scale/(Math.cos(t)**2);
    return (Math.abs(x-E)<h*0.01 ? (y+E*dy)/(2*E) : (x*eps2(x)-E*y)/(x*x-E*E))*jac;
  };
  const breaks=[0,...features.filter(v=>v>0).map(v=>Math.atan(v/scale)),Math.atan(E/scale),Math.PI/2].sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]>1e-12);
  let value=0;
  for(let i=1;i<breaks.length;i++) value+=integrate(f,breaks[i-1],breaks[i],tolerance/(breaks.length-1));
  return 2/Math.PI*value;
}
/** Dawson via stable quadrature, with large-argument asymptotic expansion. */
export function dawson(x:number):number {
  if(Math.abs(x)>8) {
    let term=1/(2*x),sum=term;
    for(let j=1;j<10;j++) { term*=(2*j-1)/(2*x*x); sum+=term; }
    return sum;
  }
  return x*integrate(t=>Math.exp(-x*x*(1-t*t)),0,1,1e-10);
}
