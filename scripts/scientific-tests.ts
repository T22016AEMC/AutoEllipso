import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Complex} from '../src/optics/complex';
import {calculateFresnelInterface} from '../src/optics/fresnel';
import {solveEllipsometryTMM,LayerOpticalState} from '../src/solver/transferMatrix';
import {calculatePoint,calculateSpectrum} from '../src/solver/calculator';
import {cubicBasis,cubicEvaluate} from '../src/models/cubicSpline';
import {dielectricToRefractiveIndex} from '../src/models/base';
import {computeGaussianEps1,computeGaussianEps2} from '../src/models/gaussian';
import {computeTaucLorentzEps1,computeTaucLorentzEps2} from '../src/models/taucLorentz';
import {mixedOptics} from '../src/models/expertMixed';
import {kkReal} from '../src/models/kk';
import {circularDifferenceDeg,computeMultiAoiResidualMetrics,computeResidualMetrics,residualWeights} from '../src/fitting/residual';
import {createSiO2OnSiProject,createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {modelRegistry} from '../src/modelRegistry/registry';
import {addPeak,changeSplineGrid,clone,deletePeak,fitExpert,freshForward,initializeMixed,initializeSpline,parameter,preparePhysical,runExpertStage,snapshot,splineGrid,validateExpert,values} from '../src/fitting/expertWorkflow';
import {optimizeBoundedLM,centralDifferenceJacobian} from '../src/fitting/optimizer';
import {importProjectJson} from '../src/data/export';
import {inspectCsv,convertRowsToPoints} from '../src/data/csvParser';
import {normalizeDeltaDeg,psiDeltaFromRho} from '../src/solver/ellipsometricAngles';
import {runAutoFit} from '../src/fitting/engine';
import {stage3Tests} from './stage3-tests';
import {stage43Tests} from './stage4_3-tests';
import {stage44aTests} from './stage4_4a-tests';
import {stage41Tests} from './stage4_1-tests';
import {stage4Tests} from './stage4-tests';
const results:{name:string;passed:boolean;detail:string}[]=[];
async function test(name:string,fn:()=>void|Promise<void>) {try{await fn();results.push({name,passed:true,detail:'PASS'});}catch(e){results.push({name,passed:false,detail:String(e)});}}
function near(a:number,b:number,tol=1e-9){assert.ok(Number.isFinite(a)&&Math.abs(a-b)<tol,`${a} != ${b} (tol ${tol})`);}
/** Independent bottom-up Fresnel recursion using exp(+2 i beta) for N=n+ik. */
function reference(layers:LayerOpticalState[],sub:Complex,w:number,aoi:number) {
  const N=[Complex.ONE,...layers.map(l=>l.N),sub];
  const q=N.map(n=>n.mul(n).sub(Math.sin(aoi*Math.PI/180)**2).sqrt());
  function polarization(p:boolean) {
    const adm=N.map((n,i)=>p?n.mul(n).div(q[i]):q[i]);let r=Complex.ZERO;
    for(let i=N.length-2;i>=0;i--) {
      const ri=adm[i].sub(adm[i+1]).div(adm[i].add(adm[i+1]));
      const d=layers[i]?.thicknessNm??0,phase=q[i+1].mul(2*Math.PI*d/w);
      const propagation=new Complex(-2*phase.im,2*phase.re).exp();
      const next=r.mul(propagation);r=ri.add(next).div(Complex.ONE.add(ri.mul(next)));
    }
    return p?r.neg():r;
  }
  return {rp:polarization(true),rs:polarization(false)};
}
await test('Woollam MSE on synthetic data at ground truth',()=>{
  const p=createSiO2OnSiProject(),truth={...p.layers[0],thickness:100,parameters:modelRegistry.createParameterSet('cauchy')};
  const points=calculateSpectrum(p.ambient,[truth],p.substrate,p.experimentData!.points);
  const m=computeResidualMetrics(points,'standard_deviation',1,1,0);
  near(m.mseWoollam,.9385,.0005);near(m.rawMse,1.4094e-3,1e-6);near(m.chiSquare,126.85,.01);
  near(m.reducedChiSquare,m.mseWoollam**2);assert.equal(m.dof,144);assert.equal(m.weightingMode,'sigma');near(m.mse,m.rawMse);
  const multi=createMultiAoiSiO2OnSiProject();
  const mm=computeResidualMetrics(calculateSpectrum(multi.ambient,[truth],multi.substrate,multi.experimentData!.points),'standard_deviation',1,1,0);
  near(mm.mseWoollam,.9164,.0005);
});
await test('Sigma weighting changes the objective but not Raw MSE',()=>{
  const points=[{id:'a',wavelength:500,aoi:70,psiExp:10,deltaExp:20,psiCalc:11,deltaCalc:30,psiSigma:1,deltaSigma:1}];
  const a=computeResidualMetrics(points,'standard_deviation'),b=computeResidualMetrics(points.map(p=>({...p,deltaSigma:p.deltaSigma*100})),'standard_deviation');
  near(a.rawMse,b.rawMse);assert.ok(b.chiSquare<a.chiSquare*.02);near(b.chiSquare,1.01);
});
await test('Missing sigma falls back to uniform with warning',()=>{
  const pts=[{id:'a',wavelength:500,aoi:65,psiExp:10,deltaExp:20,psiCalc:11,deltaCalc:21,psiSigma:.01,deltaSigma:.02},
    {id:'b',wavelength:500,aoi:75,psiExp:10,deltaExp:20,psiCalc:11,deltaCalc:21}];
  const w=residualWeights(pts,{fitWeighting:'standard_deviation'});assert.equal(w.mode,'uniform');assert.deepEqual(w.weights,[1,1,1,1]);
  assert.equal(w.warning,'部分資料點缺少 σ，已改用均勻權重（MSE 以 σ = 1° 計算）');
  const m=computeMultiAoiResidualMetrics(pts,undefined,'standard_deviation',1,1,1);near(m.chiSquare,4);assert.equal(m.dof,3);assert.equal(m.weightingMode,'uniform');
  for(const a of [65,75]){near(m.perAoi[a].mseWoollam,Math.sqrt(2));assert.equal(m.perAoi[a].dof,1);}
});
await test('Central-difference Jacobian',()=>{
  const v=[{id:'p',name:'p',value:.7,min:0,max:2}];
  const J=centralDifferenceJacobian(v,[.7],([p])=>[p*p,Math.sin(p)],()=>false);
  near(J[0][0]/2,1.4,1e-6);near(J[1][0]/2,Math.cos(.7),1e-6);
  for(const p of [0,2])assert.ok(centralDifferenceJacobian(v,[p],([p])=>[p*p,Math.sin(p)],()=>false).flat().every(Number.isFinite));
  const angular=centralDifferenceJacobian(v,[.7],([p])=>[0,circularDifferenceDeg(180+p-.7,0)]);
  near(angular[1][0]/2,1,1e-6);
});
await test('Converged flag is not set by mere improvement',async()=>{
  const out=await optimizeBoundedLM([{id:'p',name:'p',value:0,min:0,max:2}],([p])=>[p-1,0],{maxIterations:1});
  assert.equal(out.converged,false);assert.equal(out.improved,true);assert.ok(out.finalRawMse<.5);assert.match(out.message,/not converged/);
});
await test('Optimizer weighting, regularization scaling and weight count validation',async()=>{
  const out=await optimizeBoundedLM([],()=>[3,4],{residualWeights:[2,3],regularizationResidualsFn:()=>[2]});
  near(out.finalRawMse,12.5);near(out.finalChiSquare,180);near(out.finalWeightedCost,90);near(out.finalRegularizationPenalty,13);near(out.finalCost,103);
  await assert.rejects(optimizeBoundedLM([],()=>[3,4],{residualWeights:[1]}),/residualWeights/);
  const w=residualWeights([{id:'a',wavelength:500,aoi:70,psiExp:0,deltaExp:0,weight:4}],{fitWeighting:'psi_dominant',psiWeight:4,deltaWeight:9});
  near(w.weights[0],Math.sqrt(32));near(w.weights[1],Math.sqrt(18));
});
await test('Weighted LM optimum and seventh progress argument are consistent',async()=>{
  const progress:number[]=[];
  const out=await optimizeBoundedLM([{id:'p',name:'p',value:2,min:0,max:4}],([p])=>[p-1,p-3],{
    residualWeights:[1,.1],isAngularResidual:()=>false,tolerance:1e-10,maxIterations:30,onIteration:(_i,_cost,_prev,_p,_raw,_reg,weighted)=>progress.push(weighted!)});
  near(out.finalParams[0],1.03/1.01,1e-5);assert.ok(progress.every(Number.isFinite));near(progress[0],.505);
  const stopped=await optimizeBoundedLM([{id:'p',name:'p',value:0,min:0,max:4}],([p])=>[p-1,0],{shouldStop:()=>true});
  assert.equal(stopped.stopped,true);assert.equal(stopped.converged,false);
});
await test('Engine and Expert jointly optimize heterogeneous sigma across AOIs',async()=>{
  const p=createMultiAoiSiO2OnSiProject();p.layers[0].thickness=90;
  Object.values(p.layers[0].parameters).forEach(v=>v.fit=false);Object.values(p.substrate.parameters).forEach(v=>v.fit=false);
  p.fittingConfig.maxIterations=60;p.fittingConfig.tolerance=1e-10;p.fittingConfig.activeFitAois=[65,75];
  const truth={...p.layers[0],parameters:modelRegistry.createParameterSet('cauchy')};
  p.experimentData!.points=p.experimentData!.points.filter((pt,i)=>pt.aoi!==70&&i%6===0).map(pt=>{
    const c=calculatePoint(p.ambient,[{...truth,thickness:pt.aoi===65?100:140}],p.substrate,pt.wavelength,pt.aoi);
    return {...pt,psiExp:c.psiDeg,deltaExp:c.deltaDeg,psiSigma:pt.aoi===65?.01:100,deltaSigma:pt.aoi===65?.01:100};
  });
  // Match the locked optical model used to generate the two conflicting AOI stacks.
  p.layers[0].parameters=truth.parameters;Object.values(p.layers[0].parameters).forEach(v=>v.fit=false);
  const engine=await runAutoFit({ambient:p.ambient,layers:p.layers,substrate:p.substrate,points:p.experimentData!.points,config:p.fittingConfig});
  const progress:number[]=[];const expert=await fitExpert(p,false,v=>progress.push(v.currentMse));
  near(engine.updatedLayers[0].thickness,100,.01);near(expert.layers[0].thickness,100,.01);assert.ok(progress.length>0&&progress.every(Number.isFinite));
  for(const [points,result] of [[engine.updatedPoints,engine.fittingResult],[expert.experimentData!.points,expert.fittingResult!]] as const) {
    const m=computeMultiAoiResidualMetrics(points,[65,75],'standard_deviation',1,1,1);
    assert.equal(result.weightingMode,'sigma');assert.equal(result.numParameters,1);near(result.mseWoollam!,m.mseWoollam);
    near(result.chiSquare!,m.chiSquare);near(result.dof!,m.dof);assert.equal(typeof result.converged,'boolean');
  }
});
await test('Delta convention matches Woollam/Horiba/Fujiwara',()=>{
  const sub=new Complex(3.8814827782459407,0.01895389085237777);
  for(const [d,psi,delta] of [[0,10.569,179.231],[2,10.614,173.519],[5,10.815,165.118],[10,11.475,152.027],[25,15.100,122.377]]) {
    const t=solveEllipsometryTMM(Complex.ONE,[{thicknessNm:d,N:new Complex(1.457,0)}],sub,633,70);
    near(t.psiDeg,psi,.001);near(t.deltaDeg,delta,.001);
  }
  const opaque=(d:number)=>solveEllipsometryTMM(Complex.ONE,[{thicknessNm:d,N:new Complex(2,5)}],sub,633,70);
  const a=opaque(5000),b=opaque(2000);
  near(a.deltaDeg,psiDeltaFromRho(a.rho).deltaDeg);near(a.psiDeg,psiDeltaFromRho(a.rho).psiDeg);
  near(circularDifferenceDeg(a.deltaDeg,b.deltaDeg),0,.01);
  near(solveEllipsometryTMM(Complex.ONE,[],sub,633,0).deltaDeg,180);
});
await test('CSV sigma columns and delta convention',()=>{
  const csv=inspectCsv('Wavelength(nm),AOI,Psi,Delta,sig_psi,sig_delta\n500,70,25,-30,0.03,0.04\n600,70,30,100,0.05,0.06\n700,70,35,180,0,NaN');
  const m=csv.suggestedMapping;
  assert.deepEqual([m.wavelengthCol,m.aoiCol,m.psiCol,m.deltaCol,m.sigmaPsiCol,m.sigmaDeltaCol],[0,1,2,3,4,5]);
  assert.equal(m.deltaConvention,'standard');assert.equal(csv.points[0].psiExp,25);assert.equal(csv.points[0].deltaExp,330);
  assert.equal(csv.points[0].psiSigma,.03);assert.equal(csv.points[0].deltaSigma,.04);
  assert.equal(csv.points[1].psiSigma,.05);assert.equal(csv.points[1].deltaSigma,.06);
  assert.ok(!('psiSigma' in csv.points[2])&&!('deltaSigma' in csv.points[2]));
  const reversed=convertRowsToPoints(csv.rawRows,{...m,deltaConvention:'reversed'});assert.equal(reversed.points[1].deltaExp,260);
  const headers=inspectCsv('sig_psi,err_delta,Psi(deg),Delta(deg),AOI, Wavelength(µm),Psi,Delta,std_other\n.1,.2,30,100,65,.633,99,99,1').suggestedMapping;
  assert.deepEqual([headers.psiCol,headers.deltaCol,headers.aoiCol,headers.sigmaPsiCol,headers.sigmaDeltaCol,headers.wavelengthCol],[2,3,4,0,1,5]);assert.equal(headers.wavelengthUnit,'um');
  const noHeader=inspectCsv('500,30,100\n600,32,120').suggestedMapping;
  assert.deepEqual([noHeader.wavelengthCol,noHeader.psiCol,noHeader.deltaCol,noHeader.aoiCol,noHeader.sigmaPsiCol,noHeader.sigmaDeltaCol],[0,1,2,-1,-1,-1]);
  for(const mapping of [inspectCsv('').suggestedMapping,inspectCsv(' \n ').suggestedMapping])assert.equal(mapping.deltaConvention,'standard');
});
await test('Synthetic sigma describes reproducible Box-Muller noise without measurement rounding',()=>{
  const p=createMultiAoiSiO2OnSiProject(),again=createMultiAoiSiO2OnSiProject();
  assert.deepEqual(p.experimentData!.points,again.experimentData!.points);assert.equal(p.experimentData!.deltaConvention,'standard');
  const truth={...p.layers[0],thickness:100,parameters:modelRegistry.createParameterSet('cauchy')};
  for(const pt of p.experimentData!.points) {
    const q1=Math.sin(pt.wavelength*12.9898+pt.aoi*78.233)*43758.5453,q2=Math.cos(pt.wavelength*43.123+pt.aoi*19.456)*23421.678;
    const u1=Math.max(Number.EPSILON,Math.min(1-Number.EPSILON,q1-Math.floor(q1))),u2=Math.max(Number.EPSILON,Math.min(1-Number.EPSILON,q2-Math.floor(q2)));
    const r=Math.sqrt(-2*Math.log(u1)),calc=calculatePoint(p.ambient,[truth],p.substrate,pt.wavelength,pt.aoi);
    near(pt.psiExp,Math.max(0,Math.min(90,calc.psiDeg+r*Math.cos(2*Math.PI*u2)*.04)),1e-12);
    near(pt.deltaExp,normalizeDeltaDeg(calc.deltaDeg+r*Math.sin(2*Math.PI*u2)*.04),1e-12);
    assert.equal(pt.psiSigma,.04);assert.equal(pt.deltaSigma,.04);
  }
});
await test('Legacy project clears calculated spectra and MSE in candidates without changing measurements',()=>{
  const legacy=JSON.parse(JSON.stringify(createSiO2OnSiProject()));delete legacy.deltaConventionVersion;delete legacy.experimentData.deltaConvention;
  legacy.fittingResult={rawMse:123,finalMse:123};
  const saved=JSON.parse(JSON.stringify(legacy));legacy.expert={stage:2,smoothing:.1,records:[{rawMse:123}],manualSource:saved,candidates:[{id:'old',name:'old',stage:2,snapshot:saved}]};
  const measured=legacy.experimentData.points.map((pt:any)=>[pt.psiExp,pt.deltaExp]);let notifications=0;
  const imported=importProjectJson(JSON.stringify(legacy),()=>notifications++);
  assert.equal(notifications,1);assert.equal(imported.deltaConventionVersion,2);assert.equal(imported.fittingResult,null);assert.deepEqual(imported.expert!.records,[]);
  for(const s of [imported,imported.expert!.candidates[0].snapshot,imported.expert!.manualSource!]) {
    assert.equal(s.deltaConventionVersion,2);assert.equal(s.fittingResult,null);assert.equal(s.experimentData!.deltaConvention,'standard');
    assert.deepEqual(s.experimentData!.points.map(pt=>[pt.psiExp,pt.deltaExp]),measured);
    for(const pt of s.experimentData!.points)for(const field of ['psiCalc','deltaCalc','psiResidual','deltaResidual'])assert.ok(!(field in pt));
  }
  const forwarded=freshForward(imported);assert.ok(forwarded.experimentData!.points.every(pt=>Number.isFinite(pt.deltaCalc)));
  importProjectJson(JSON.stringify(imported),()=>notifications++);assert.equal(notifications,1);
});
await test('Bare interface TMM agrees with analytic Fresnel at several AOIs',()=>{
  for(const aoi of [0,35,65,75])for(const sub of [new Complex(1.5,0),new Complex(3.8,0.4)]) {
    const f=calculateFresnelInterface(Complex.ONE,sub,aoi*Math.PI/180),t=solveEllipsometryTMM(Complex.ONE,[],sub,550,aoi);
    near(t.rp.re,f.rp.re);near(t.rp.im,f.rp.im);near(t.rs.re,f.rs.re);near(t.rs.im,f.rs.im);
  }
});
await test('Single transparent and absorbing layers agree with independent recursion',()=>{
  for(const k of [0,0.08,0.8])for(const aoi of [35,65,75]) {
    const layers=[{thicknessNm:137,N:new Complex(2.1,k)}],sub=new Complex(3.8,0.03);
    const r=reference(layers,sub,530,aoi),t=solveEllipsometryTMM(Complex.ONE,layers,sub,530,aoi);
    near(t.rp.re,r.rp.re);near(t.rp.im,r.rp.im);near(t.rs.re,r.rs.re);near(t.rs.im,r.rs.im);
  }
});
await test('Multi-layer absorbing stack agrees with independent recursion',()=>{
  const layers=[{thicknessNm:42,N:new Complex(1.45,0)},{thicknessNm:160,N:new Complex(2.6,0.4)},{thicknessNm:21,N:new Complex(1.7,0.02)}];
  for(const w of [220,450,850]) {const r=reference(layers,new Complex(3.8,0.04),w,70),t=solveEllipsometryTMM(Complex.ONE,layers,new Complex(3.8,0.04),w,70);
    near(t.rp.re,r.rp.re);near(t.rp.im,r.rp.im);near(t.rs.re,r.rs.re);near(t.rs.im,r.rs.im);}
});
await test('Zero thickness removes a layer',()=>{
  const sub=new Complex(3.8,0.05),a=solveEllipsometryTMM(Complex.ONE,[],sub,550,70),b=solveEllipsometryTMM(Complex.ONE,[{thicknessNm:0,N:new Complex(9,2)}],sub,550,70);
  near(a.psiDeg,b.psiDeg);near(a.deltaDeg,b.deltaDeg);
});
await test('Opaque passive layer has finite physical limiting reflection',()=>{
  const layers=[{thicknessNm:5000,N:new Complex(2,5)}],sub=new Complex(3.8,0.1),t=solveEllipsometryTMM(Complex.ONE,layers,sub,190,70),r=reference(layers,sub,190,70);
  near(t.rp.re,r.rp.re,1e-8);near(t.rs.im,r.rs.im,1e-8);assert.ok(t.rp.abs()<=1&&t.rs.abs()<=1);
});
await test('Delta circular wrapping including ±360 and multiple rotations',()=>{near(circularDifferenceDeg(359,1),-2);near(circularDifferenceDeg(1,359),2);near(circularDifferenceDeg(1081,359),2);});
await test('Unscaled Raw MSE and per AOI use both psi and wrapped delta',()=>{
  const p=[{id:'a',wavelength:500,aoi:60,psiExp:30,deltaExp:359,psiCalc:32,deltaCalc:1},{id:'b',wavelength:500,aoi:70,psiExp:30,deltaExp:10,psiCalc:34,deltaCalc:16}];
  const m=computeMultiAoiResidualMetrics(p);near(m.rawMse,15);near(m.perAoi[60].mse,4);near(m.perAoi[70].mse,26);
});
await test('Nonuniform cubic basis partition of unity and endpoint interpolation',()=>{
  const grid=[190,240,310,440,650,760,900];for(let x=190;x<=900;x+=7){const b=cubicBasis(x,grid);near(b.reduce((s,v)=>s+v,0),1);assert.ok(b.every(x=>x>=0));}
  near(cubicEvaluate(190,grid,[1,2,3,4,5,6,7]),1);near(cubicEvaluate(900,grid,[1,2,3,4,5,6,7]),7);
});
await test('Four controls give exact cubic Bezier basis',()=>{const b=cubicBasis(0.25,[0,0.3,0.7,1]);[.75**3,3*.25*.75**2,3*.25**2*.75,.25**3].forEach((v,i)=>near(b[i],v));});
await test('Dielectric square root reconstruction including negative eps1 / n below 1',()=>{for(const [a,b] of [[4,0],[3,2],[-12,4],[-4,0],[.1,.05]]) {const o=dielectricToRefractiveIndex(a,b);near(o.n*o.n-o.k*o.k,a);near(2*o.n*o.k,b);}});
await test('Gaussian analytic Hilbert transform agrees with independent KK quadrature',()=>{
  for(const E of [.5,2.7,3.5,5])near(computeGaussianEps1(E,0,3,3.5,.6),kkReal(E,x=>computeGaussianEps2(x,3,3.5,.6),[1,2.9,3.5,4.1,7]),2e-6);
});
await test('KK principal value reproduces analytic Lorentz susceptibility including narrow peaks',()=>{
  for(const width of [.03,.4])for(const E of [1,3,4.5]){
    const E0=3,A=2,den=(E0*E0-E*E)**2+width*width*E*E,expected=A*E0*(E0*E0-E*E)/den;
    near(kkReal(E,x=>A*E0*width*x/((E0*E0-x*x)**2+width*width*x*x),[E0-width,E0,E0+width]),expected,2e-5);
  }
});
await test('Tauc-Lorentz band gap, positivity, linearity and quadrature convergence',()=>{
  near(computeTaucLorentzEps2(.9,20,3,.4,1),0);
  for(const E of [.5,1,2,3,5]){
    const eps1=computeTaucLorentzEps1(E,20,3,.4,1),ref=kkReal(E,x=>computeTaucLorentzEps2(x,20,3,.4,1),[1,2.6,3,3.4,5.4],1e-9);
    near(eps1,ref,1e-5);near(computeTaucLorentzEps1(E,40,3,.4,1),2*eps1,1e-6);
    assert.ok(computeTaucLorentzEps2(E,20,3,.4,1)>=0);
  }
});
await test('Mixed Lorentz + Drude responses sum epsilon, not n/k',()=>{
  const E=2,w=1239.841984/E,p={eps_inf:2,_peakCount:2,p0_type:1,p0_enabled:1,p0_A:3,p0_E0:4,p0_w:.5,p1_type:3,p1_enabled:1,p1_A:2,p1_w:.2};
  const o=mixedOptics(w,p),d=(16-4)**2+.25*4;
  near(o.eps1!,2+12*12/d-4/(4+.04));near(o.eps2!,12*.5*2/d+4*.2/(2*(4+.04)));
  near(o.n*o.n-o.k*o.k,o.eps1!);
});
await test('Every mixed peak type supports duplicate/delete/disable/serialization and free correction',()=>{
  let p=initializeMixed(createSiO2OnSiProject(),0);for(let i=0;i<5;i++)p.layers[0]=addPeak(p.layers[0],i);
  const source=clone(p);p.layers[0]=addPeak(p.layers[0],2,2);assert.equal(p.layers[0].parameters.p5_type.current,2);
  assert.deepEqual(p.layers[0].parameters.p5_Eg.min,p.layers[0].parameters.p2_Eg.min);
  p.layers[0]=deletePeak(p.layers[0],1);assert.equal(p.layers[0].parameters.p1_type.current,2);
  const l=source.layers[0],before=mixedOptics(190,values(l));l.parameters.p4_R0.current=.2;
  near(mixedOptics(190,values(l)).eps1!,before.eps1!+.2);
  l.parameters.p0_enabled.current=0;assert.ok(Number.isFinite(mixedOptics(500,values(l)).n));assert.deepEqual(clone(source),JSON.parse(JSON.stringify(source)));
});
await test('Manual spline changes affect real TMM and knot projection retains constant response',()=>{
  const p=initializeSpline(createSiO2OnSiProject(),0),l=p.layers[0],grid=splineGrid(l);
  grid.forEach((_,i)=>{l.parameters[`N${i}`].current=1.5;l.parameters[`K${i}`].current=0;});
  const before=calculatePoint(p.ambient,p.layers,p.substrate,500,70);
  l.parameters.N3.current=2;assert.notEqual(calculatePoint(p.ambient,p.layers,p.substrate,500,70).psiDeg,before.psiDeg);
  l.parameters.N3.current=1.5;
  const extended=changeSplineGrid(l,[...grid.slice(0,2),(grid[1]+grid[2])/2,...grid.slice(2)]);
  const mod=modelRegistry.get('bspline')!;for(const w of [190,500,900])near(mod.calculate(w,values(extended)).n,1.5,1e-7);
  l.parameters.N0.fit=false;assert.throws(()=>changeSplineGrid(l,grid.slice(0,-1)),/Unlock/);
});
await test('Validation rejects absent AOI, invalid bounds and nonfinite data',()=>{
  const p=createSiO2OnSiProject();p.fittingConfig.activeFitAois=[12];assert.throws(()=>validateExpert(p));
  p.fittingConfig.activeFitAois=[70];p.layers[0].parameters.A.current=NaN;assert.throws(()=>validateExpert(p));
});
await test('Synthetic multi-AOI jointly recovers thickness and n from manual parameters',async()=>{
  const truth=createMultiAoiSiO2OnSiProject(),l=truth.layers[0];l.thickness=87.3;l.parameters.A.current=1.73;l.parameters.B.current=.004;l.parameters.C.current=0;
  truth.experimentData!.points=truth.experimentData!.points.map(pt=>{const c=calculatePoint(truth.ambient,truth.layers,truth.substrate,pt.wavelength,pt.aoi);return {...pt,psiExp:c.psiDeg,deltaExp:c.deltaDeg};});
  const p=clone(truth);p.layers[0].thickness=93;p.layers[0].parameters.A.current=1.65;
  Object.values(p.layers[0].parameters).forEach(v=>v.fit=v.id==='A');p.layers[0].thicknessFit=true;
  p.fittingConfig.activeFitAois=Array.from(new Set(p.experimentData!.points.map(x=>x.aoi)));p.fittingConfig.maxIterations=70;p.fittingConfig.tolerance=1e-10;
  const fit=await fitExpert(p);near(fit.layers[0].thickness,87.3,1e-3);near(fit.layers[0].parameters.A.current,1.73,1e-5);
  assert.ok(fit.fittingResult!.rawMse!<1e-8);assert.equal(fit.fittingResult!.fittingMode,'multi_aoi');assert.ok(Object.keys(fit.fittingResult!.perAoiMse!).length>=2);
  assert.equal(fit.fittingResult!.freshCalculationVerified,true);
  const pts=calculateSpectrum(fit.ambient,fit.layers,fit.substrate,fit.experimentData!.points);assert.deepEqual(pts,fit.experimentData!.points);
  // Changing observations at just one AOI changes joint optimum (all AOIs actually enter residual).
  const biased=clone(p),angle=biased.experimentData!.points[0].aoi;
  biased.experimentData!.points.filter(x=>x.aoi===angle).forEach(x=>x.psiExp+=.4);
  const changed=await fitExpert(biased);assert.ok(Math.abs(changed.layers[0].parameters.A.current-fit.layers[0].parameters.A.current)>1e-4);
});
await test('Manual physical handoff preserves peak metadata, locked values, substrate, AOI and thickness',async()=>{
  let p=initializeMixed(createMultiAoiSiO2OnSiProject(),0);p.layers[0]=addPeak(p.layers[0],1);p.layers[0]=addPeak(p.layers[0],3);
  p.layers[0].parameters.p0_A.current=1.234;p.layers[0].parameters.p0_A.fit=false;p.layers[0].parameters.p0_E0.min=2;
  const prepared=await preparePhysical(p,0);assert.deepEqual(prepared,p);
  p.fittingConfig.maxIterations=3;const out=await runExpertStage(p,3,0);near(out.layers[0].parameters.p0_A.current,1.234);
  assert.equal(out.layers[0].parameters.p0_type.current,1);assert.equal(out.layers[0].parameters.p1_type.current,3);
  assert.equal(out.layers[0].parameters.p0_E0.min,2);assert.deepEqual(out.fittingConfig.activeFitAois,p.fittingConfig.activeFitAois);
});
await test('All locked parameters keep true forward error (no fabricated zero objective)',async()=>{
  const p=createSiO2OnSiProject();p.layers[0].thickness=147;p.layers[0].thicknessFit=false;
  [...p.layers,p.substrate].forEach(l=>Object.values(l.parameters).forEach(v=>v.fit=false));
  const expected=freshForward(p);const out=await fitExpert(p);near(out.fittingResult!.rawMse!,computeMultiAoiResidualMetrics(expected.experimentData!.points).rawMse);
  assert.ok(out.fittingResult!.rawMse!>0);near(out.layers[0].thickness,147);
});
await test('Candidate snapshots preserve project data and exclude recursive history',()=>{
  const p=createSiO2OnSiProject();p.expert={stage:2,smoothing:.1,records:[],candidates:[]};const shot=snapshot(p);
  assert.equal('expert' in shot,false);assert.deepEqual(shot.substrate,p.substrate);assert.deepEqual(shot.experimentData,p.experimentData);
});
await test('Manual n and k spline coefficients are optimized from their actual edited values',async()=>{
  const truth=initializeSpline(createMultiAoiSiO2OnSiProject(),0),l=truth.layers[0];
  for(const v of Object.values(l.parameters))v.fit=false;l.thicknessFit=false;
  l.parameters.N3.current=1.8;l.parameters.K3.current=.045;
  truth.experimentData!.points=truth.experimentData!.points.map(pt=>{const c=calculatePoint(truth.ambient,truth.layers,truth.substrate,pt.wavelength,pt.aoi);return {...pt,psiExp:c.psiDeg,deltaExp:c.deltaDeg};});
  const p=clone(truth);p.expert={stage:2,smoothing:0,candidates:[],records:[]};
  p.layers[0].parameters.N3.current=1.7;p.layers[0].parameters.K3.current=.02;
  p.layers[0].parameters.N3.fit=true;p.layers[0].parameters.K3.fit=true;p.fittingConfig.maxIterations=70;p.fittingConfig.tolerance=1e-10;
  const out=await runExpertStage(p,2,0);near(out.layers[0].parameters.N3.current,1.8,1e-5);near(out.layers[0].parameters.K3.current,.045,1e-5);
  near(out.layers[0].parameters.N0.current,l.parameters.N0.current);assert.ok(out.fittingResult!.rawMse!<1e-8);
  const initial=out.fittingResult!.parameters.find(v=>v.paramId==='N3');near(initial!.initialValue,1.7);
});
await test('Global thickness search evaluates physical TMM and 20 starts recover distant solution',async()=>{
  const truth=createMultiAoiSiO2OnSiProject();truth.layers[0].thickness=87.3;
  truth.experimentData!.points=truth.experimentData!.points.map(pt=>{const c=calculatePoint(truth.ambient,truth.layers,truth.substrate,pt.wavelength,pt.aoi);return {...pt,psiExp:c.psiDeg,deltaExp:c.deltaDeg};});
  const p=clone(truth);p.layers[0].thickness=330;p.layers[0].thicknessMin=1;p.layers[0].thicknessMax=400;p.layers[0].thicknessFit=true;
  [...p.layers,p.substrate].forEach(l=>Object.values(l.parameters).forEach(v=>v.fit=false));p.fittingConfig.enableMultiStart=true;p.fittingConfig.maxIterations=40;p.fittingConfig.tolerance=1e-9;
  const out=await runExpertStage(p,4,0);near(out.layers[0].thickness,87.3,1e-4);assert.ok(out.fittingResult!.rawMse!<1e-8);
  assert.equal(out.fittingResult!.multiStartSummary!.totalStarts,20);
  const final=await runExpertStage(out,5,0);near(final.fittingResult!.rawMse!,out.fittingResult!.rawMse!,1e-12);assert.equal(final.fittingResult!.freshCalculationVerified,true);
});
await test('Locked-variable optimizer returns measured nonzero cost and regularization',async()=>{
  const out=await optimizeBoundedLM([],()=>[2,4],{regularizationResidualsFn:()=>[3]});near(out.finalRawMse,10);near(out.finalCost,14.5);
});
await test('Legacy Lorentz / Tauc / mixed models preserve dielectric conversion without n or eps1 floor',()=>{
  const lorentz=modelRegistry.get('lorentz')!,p={eps_inf:1,A:50,E0:2,gamma:.1};const opt=lorentz.calculate(1239.841984/3,p);
  assert.ok(opt.eps1!<0);near(opt.n*opt.n-opt.k*opt.k,opt.eps1!);
  const mixed=modelRegistry.get('multi_oscillator')!.calculate(1239.841984/3,{eps_inf:1,A1:50,E01:2,w1:.1,osc1_type_code:2});
  near(mixed.n*mixed.n-mixed.k*mixed.k,mixed.eps1!);
});
await test('Mixed Lorentz and Drude synthetic response recovers manually seeded peak amplitudes',async()=>{
  let truth=initializeMixed(createMultiAoiSiO2OnSiProject(),0);truth.layers[0]=addPeak(truth.layers[0],1);truth.layers[0]=addPeak(truth.layers[0],3);
  const l=truth.layers[0];l.thicknessFit=false;Object.values(l.parameters).forEach(v=>v.fit=false);
  l.parameters.p0_A.current=2.4;l.parameters.p1_A.current=.9;
  truth.experimentData!.points=truth.experimentData!.points.filter((_,i)=>i%3===0).map(pt=>{const c=calculatePoint(truth.ambient,truth.layers,truth.substrate,pt.wavelength,pt.aoi);return {...pt,psiExp:c.psiDeg,deltaExp:c.deltaDeg};});
  const p=clone(truth);p.layers[0].parameters.p0_A.current=2.1;p.layers[0].parameters.p1_A.current=.75;
  p.layers[0].parameters.p0_A.fit=true;p.layers[0].parameters.p1_A.fit=true;p.fittingConfig.maxIterations=60;p.fittingConfig.tolerance=1e-10;
  const out=await runExpertStage(p,3,0);near(out.layers[0].parameters.p0_A.current,2.4,1e-4);near(out.layers[0].parameters.p1_A.current,.9,1e-4);
  assert.ok(out.fittingResult!.rawMse!<1e-8);assert.equal(out.layers[0].parameters.p0_type.current,1);assert.equal(out.layers[0].parameters.p1_type.current,3);
});
await test('Multi-layer multi-AOI synthetic thickness recovery',async()=>{
  const truth=createMultiAoiSiO2OnSiProject();truth.fittingConfig.sampleStructure='multi_layer';const film=clone(truth.layers[0]);film.id='second';film.name='Second film';film.thickness=23.4;film.parameters.A.current=2.1;truth.layers[0].thickness=87.3;truth.layers.push(film);
  truth.experimentData!.points=truth.experimentData!.points.map(pt=>{const c=calculatePoint(truth.ambient,truth.layers,truth.substrate,pt.wavelength,pt.aoi);return {...pt,psiExp:c.psiDeg,deltaExp:c.deltaDeg};});
  const p=clone(truth);p.layers[0].thickness=90;p.layers[1].thickness=27;
  p.layers.forEach(l=>{l.thicknessFit=true;l.thicknessMin=1;l.thicknessMax=300;Object.values(l.parameters).forEach(v=>v.fit=false);});
  p.fittingConfig.maxIterations=70;p.fittingConfig.tolerance=1e-10;const out=await fitExpert(p);
  near(out.layers[0].thickness,87.3,1e-3);near(out.layers[1].thickness,23.4,1e-3);assert.ok(out.fittingResult!.rawMse!<1e-8);
});
await test('Independent Expert stages 0 through 5 execute and preserve full data and handoff source',async()=>{
  let p=createSiO2OnSiProject();p.experimentData!.points=p.experimentData!.points.filter((_,i)=>i%5===0);
  const count=p.experimentData!.points.length;p.fittingConfig.maxIterations=10;p.fittingConfig.tolerance=1e-6;
  for(let stage=0;stage<=5;stage++)p=await runExpertStage(p,stage,0);
  assert.equal(p.expert!.records.length,6);assert.equal(p.experimentData!.points.length,count);assert.equal(p.expert!.manualSource!.layers[0].modelId,'bspline');
  assert.equal(p.fittingResult!.freshCalculationVerified,true);assert.equal(p.layers[0].modelId,'expert_mixed');
  near(computeMultiAoiResidualMetrics(p.experimentData!.points).rawMse,p.fittingResult!.rawMse!,1e-12);
});
await test('Legacy project JSON upgrades spline grid, while V2 candidate/peak locks round-trip exactly',()=>{
  const old=createSiO2OnSiProject();old.layers[0].modelId='bspline';old.layers[0].parameters=modelRegistry.createParameterSet('bspline');
  const imported=importProjectJson(JSON.stringify(old));assert.ok(imported.layers[0].parameters._knot0);assert.equal(splineGrid(imported.layers[0]).length,8);
  let v2=initializeMixed(createSiO2OnSiProject(),0);v2.layers[0]=addPeak(v2.layers[0],2);v2.layers[0].parameters.p0_Eg.fit=false;
  v2.expert={stage:3,smoothing:.1,records:[],candidates:[{id:'a',name:'Source',stage:2,snapshot:snapshot(v2)}]};
  assert.deepEqual(importProjectJson(JSON.stringify(v2)),v2);
});
await test('Entering peak builder retains manual n/k exactly as a labeled noncausal baseline',()=>{
  const p=initializeSpline(createSiO2OnSiProject(),0);p.layers[0].parameters.N3.current=1.85;p.layers[0].parameters.K3.current=.045;p.layers[0].parameters.N3.fit=false;
  const before=modelRegistry.get('bspline')!,source=values(p.layers[0]),mixed=initializeMixed(p,0);
  for(const w of [190,250,450,650,900]) {
    const opt=before.calculate(w,source),next=mixedOptics(w,values(mixed.layers[0]));near(next.n,opt.n,1e-8);near(next.k,opt.k,1e-8);
    const oldCalc=calculatePoint(p.ambient,p.layers,p.substrate,w,70),newCalc=calculatePoint(mixed.ambient,mixed.layers,mixed.substrate,w,70);
    near(oldCalc.psiDeg,newCalc.psiDeg,1e-8);near(circularDifferenceDeg(oldCalc.deltaDeg,newCalc.deltaDeg),0,1e-8);
  }
  assert.equal(mixed.layers[0].parameters.base_N3.fit,false);assert.equal(mixed.layers[0].parameters._baseEnabled.current,1);
  mixed.layers[0]=addPeak(mixed.layers[0],1);const v=values(mixed.layers[0]),E=1239.841984/500,d=(9-E*E)**2+.25*E*E;
  near(mixedOptics(500,v).eps1!,before.calculate(500,source).eps1!+6*(9-E*E)/d,1e-8);
});
await stage3Tests(test);
await stage4Tests(test);
await stage41Tests(test);
await stage43Tests(test);
await stage44aTests(test);
writeFileSync('scientific-tests.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.passed).length,failures:results.filter(r=>!r.passed)},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
