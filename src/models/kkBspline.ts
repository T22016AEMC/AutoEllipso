import type {ModelDefinition,ParameterDef} from '../types/ellipsometry';
import {cubicBasis,cubicKnotVector} from './cubicSpline';
import {dielectricToRefractiveIndex,wavelengthNmToEnergyEv} from './base';

export function kkSplineGrid(p:Record<string,number>):number[] {
  const n=p._knotCount??24,lo=p._emin??.5,hi=p._emax??6.5;
  if(!Number.isInteger(n)||n<4||n>64||!(lo>0&&hi>lo))throw new Error('KK B-spline requires 4–64 controls and 0 < Emin < Emax');
  const grid=Array.from({length:n},(_,i)=>p[`_energy${i}`]??(i===n-1?hi:lo+(hi-lo)*i/(n-1)));
  cubicKnotVector(grid);return grid;
}
const hash=(text:string)=>{let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16);};
function gauss(f:(x:number)=>number[],a:number,b:number,n:8|16):number[] {
  const nodes=n===8?[.1834346424956498,.525532409916329,.7966664774136267,.9602898564975363]:
    [.09501250983763744,.2816035507792589,.4580167776572274,.6178762444026438,.755404408355003,.8656312023878318,.9445750230732326,.9894009349916499];
  const weights=n===8?[.362683783378362,.3137066458778873,.2223810344533745,.1012285362903763]:
    [.1894506104550685,.1826034150449236,.16915651939500254,.14959598881657673,.12462897125553387,.09515851168249278,.06225352393864789,.027152459411754095];
  let sum:number[]=[];const mid=(a+b)/2,half=(b-a)/2;
  nodes.forEach((x,j)=>{for(const sign of [-1,1]){const value=f(mid+sign*half*x);if(!sum.length)sum=value.map(()=>0);value.forEach((v,i)=>sum[i]+=weights[j]*half*v);}});
  return sum;
}
function integrateBasis(f:(x:number)=>number[],a:number,b:number,tol:number,depth=12):number[] {
  const low=gauss(f,a,b,8),high=gauss(f,a,b,16);
  if(high.every((v,i)=>Math.abs(v-low[i])<=tol))return high;
  if(depth===0)throw new Error('KK B-spline basis integral failed requested tolerance');
  const left=integrateBasis(f,a,(a+b)/2,tol/2,depth-1),right=integrateBasis(f,(a+b)/2,b,tol/2,depth-1);
  return left.map((x,i)=>x+right[i]);
}
/** Endpoint coefficients are fixed zero: compact cubic epsilon2 is continuous at both cutoffs. */
export function kkBasisAtEnergy(E:number,grid:number[]):{real:number[];imaginary:number[]} {
  const lo=grid[0],hi=grid.at(-1)!,n=grid.length;
  const basis=(x:number)=>{const b=x<lo||x>hi?grid.map(()=>0):cubicBasis(x,grid);b[0]=0;b[n-1]=0;return b;};
  const y=basis(E),breaks=[...new Set(cubicKnotVector(grid))];
  const total=grid.map(()=>0);
  const f=(x:number)=>{const b=basis(x);
    if(Math.abs(x-E)<1e-9){const h=1e-5*Math.max(1,E),plus=basis(E+h),minus=basis(E-h);return y.map((v,i)=>.5*((plus[i]-minus[i])/(2*h)+v/(2*E)));}
    return b.map((v,i)=>.5*((v-y[i])/(x-E)+v/(x+E)));};
  for(let k=1;k<breaks.length;k++){
    const integral=integrateBasis(f,breaks[k-1],breaks[k],1e-9/breaks.length);
    integral.forEach((v,i)=>total[i]+=v);
  }
  if(E!==lo&&E!==hi){const log=.5*Math.log(Math.abs((hi-E)/(lo-E)));y.forEach((v,i)=>total[i]+=v*log);}
  return {real:total.map(v=>2/Math.PI*v),imaginary:y};
}

export function createKkBsplineModel() {
  // Owned by this model instance, with signatures retained to check hash collisions.
  const cache=new Map<string,{signature:string;response:ReturnType<typeof kkBasisAtEnergy>}>();
  let integrations=0;
  const response=(w:number,p:Record<string,number>)=>{
    const grid=kkSplineGrid(p),E=wavelengthNmToEnergyEv(w),signature=JSON.stringify(grid)+'|'+E.toPrecision(17),key=hash(signature);
    const found=cache.get(key);if(found?.signature===signature)return found.response;
    const result=kkBasisAtEnergy(E,grid);integrations++;
    if(cache.size>=8192)cache.delete(cache.keys().next().value!);cache.set(key,{signature,response:result});return result;
  };
  const def=(id:string,value:number,min:number,max:number,fit=true):ParameterDef=>({id,name:id,symbol:id,unit:'',description:id,
    defaultValue:value,min,max,fitSupported:fit,isFittingCandidate:fit});
  const parameters=[def('eps_inf',2,0.01,30),def('_emin',.5,.001,40,false),def('_emax',6.5,.002,100,false),def('_knotCount',24,4,64,false),
    def('uv_A',0,0,1000),def('_uvE0',9.75,.001,1000,false),def('_uvWidth',.05,.001,20,false),
    def('_irEnabled',0,0,1,false),{...def('ir_A',0,0,1000),isFittingCandidate:false},def('_irE0',.1,.0001,100,false),def('_irWidth',.01,.00001,10,false),
    ...Array.from({length:24},(_,i)=>def('c'+i,i===0||i===23?0:1,0,i===0||i===23?0:100,i!==0&&i!==23))];
  const epsilon=(w:number,p:Record<string,number>)=>{
    const E=wavelengthNmToEnergyEv(w),grid=kkSplineGrid(p),b=response(w,p);
    let eps1=p.eps_inf??2,eps2=0;
    grid.forEach((_,i)=>{const c=p['c'+i]??0;if(!Number.isFinite(c)||c<0)throw new Error('KK B-spline coefficients must be finite and nonnegative');
      if((i===0||i===grid.length-1)&&c!==0)throw new Error('KK B-spline endpoint coefficients must be zero');
      eps1+=c*b.real[i];eps2+=c*b.imaginary[i];});
    for(const pole of ['uv',...(p._irEnabled?['ir']:[])]) {
      const E0=p['_'+pole+'E0']??(pole==='uv'?1.5*grid.at(-1)!:grid[0]/2),width=p['_'+pole+'Width']??.05,A=p[pole+'_A']??0;
      if(!(E0>0&&width>0&&A>=0)||(pole==='uv'&&E0<1.5*grid.at(-1)!)||(pole==='ir'&&E0>=grid[0]))throw new Error('KK B-spline pole must lie outside the data range (UV ≥ 1.5 Emax)');
      const diff=E0*E0-E*E,den=diff*diff+width*width*E*E;
      eps1+=A*E0*diff/den;eps2+=A*E0*width*E/den;
    }
    if(![eps1,eps2].every(Number.isFinite))throw new Error('Nonfinite KK B-spline response');return {eps1,eps2};
  };
  const model:ModelDefinition={id:'kk_bspline',name:'KK-consistent ε₂ B-spline',type:'dispersion',description:'Compact cubic epsilon2 with KK basis transforms and external Lorentz poles; endpoint coefficients fixed zero.',
    reference:'Johs & Hale, Phys. Status Solidi A 205, 715–719 (2008), concept; singularity-subtracted basis quadrature',equation:'epsilon2 = sum(c_j B_j); epsilon1 = eps_inf + sum(c_j K_j) + poles',
    parameters,validRange:{minWavelengthNm:1,maxWavelengthNm:1e6},version:'2.2.0-dev',fitSupported:true,isVerified:false,
    calculateEpsilon:epsilon,calculate:(w,p)=>{const e=epsilon(w,p);return dielectricToRefractiveIndex(e.eps1,e.eps2);},
    calculateN:(w,p)=>model.calculate(w,p).n,calculateK:(w,p)=>model.calculate(w,p).k};
  return Object.assign(model,{coefficientJacobian:(w:number,p:Record<string,number>)=>{const b=response(w,p);return {real:[...b.real],imaginary:[...b.imaginary]};},cacheInfo:()=>({entries:cache.size,integrations})});
}

/** Deterministic nonnegative least-squares projection of epsilon2, followed by background/UV matching. */
export function fitKkEpsilon2(data:{energy:number;eps2:number;eps1?:number}[],p:Record<string,number>,model:ReturnType<typeof createKkBsplineModel>) {
  const grid=kkSplineGrid(p),indices=grid.map((_,i)=>i).slice(1,-1),A=data.map(d=>cubicBasis(d.energy,grid));
  const c=grid.map(()=>0),residual=data.map(d=>d.eps2);
  for(let sweep=0;sweep<2000;sweep++) {
    let change=0;
    for(const j of indices){const norm=A.reduce((sum,row)=>sum+row[j]**2,0);if(norm===0)continue;
      const next=Math.max(0,c[j]+A.reduce((sum,row,i)=>sum+row[j]*residual[i],0)/norm),delta=next-c[j];
      c[j]=next;change=Math.max(change,Math.abs(delta));A.forEach((row,i)=>residual[i]-=delta*row[j]);}
    if(change<1e-10)break;
  }
  const result={...p,...Object.fromEntries(c.map((v,i)=>['c'+i,v]))};
  if(data.every(d=>d.eps1!==undefined)) {
    const responses=data.map(d=>{const wavelength=1239.841984/d.energy;
      const base=model.calculateEpsilon(wavelength,{...result,eps_inf:0,uv_A:0,ir_A:0}).eps1;
      const pole=model.calculateEpsilon(wavelength,{...result,eps_inf:0,uv_A:1,ir_A:0}).eps1-base;
      return {target:d.eps1!-base,pole};});
    const n=responses.length,sx=responses.reduce((s,d)=>s+d.pole,0),sy=responses.reduce((s,d)=>s+d.target,0),xx=responses.reduce((s,d)=>s+d.pole*d.pole,0),xy=responses.reduce((s,d)=>s+d.pole*d.target,0);
    result.uv_A=Math.max(0,(n*xy-sx*sy)/(n*xx-sx*sx));
    result.eps_inf=Math.max(.01,(sy-result.uv_A*sx)/n);
  }
  return result;
}
