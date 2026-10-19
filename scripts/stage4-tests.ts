import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {computeTaucLorentzEps1 as tl1,computeTaucLorentzEps2 as tl2,validateTaucLorentzParameters} from '../src/models/taucLorentz';
import {dielectricToRefractiveIndex} from '../src/models/base';
import {kkReal} from '../src/models/kk';
import {detectEpsilonPeaks} from '../src/models/peakInitialization';
import {createKkBsplineModel,kkSplineGrid,fitKkEpsilon2} from '../src/models/kkBspline';
import {cubicEvaluate} from '../src/models/cubicSpline';
import {modelRegistry} from '../src/modelRegistry/registry';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {calculatePoint,calculateSpectrum} from '../src/solver/calculator';
import {clone,fitExpert,initializeSpline,initializeKkSpline,runExpertStage,values} from '../src/fitting/expertWorkflow';
import {computeFitStatistics} from '../src/fitting/statistics';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {importProjectJson} from '../src/data/export';
type Test=(name:string,fn:()=>void|Promise<void>)=>Promise<void>;
const detail:Record<string,unknown>={};
function rng(seed:number){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};}
function record(key:string,data:unknown){detail[key]=data;console.log('STAGE4_'+key+' '+JSON.stringify(data));}
export async function stage4Tests(test:Test) {
  await test('Stage4 A: analytic TL versus independent KK, domain and boundary protection',()=>{
    const table:any[]=[];
    for(const [A,E0,C,Eg] of [[100,3.5,1.5,1.5],[20,3,.4,1],[60,4,2.5,2]])for(const E of [.5,1,2,3,3.5,4.5,6,Eg,Eg+1e-10]) {
      const analytic=tl1(E,A,E0,C,Eg),numeric=kkReal(E,x=>tl2(x,A,E0,C,Eg),[Eg,E0-C,E0,E0+C,E0+6*C],1e-9);
      const absolute=Math.abs(analytic-numeric),relative=absolute/Math.max(1e-12,Math.abs(numeric));
      table.push({A,E0,C,Eg,E,analytic,numeric,absolute,relative});
      assert.ok(Math.abs(E-Eg)<1e-8?absolute<=1e-3:relative<=1e-4);
      if(E<=Eg)assert.equal(tl2(E,A,E0,C,Eg),0);
    }
    for(const E of [0,1e-16,1,3.5,6])assert.ok(Number.isFinite(tl1(E,100,3.5,7*(1-1e-10),1.5)));
    const p=createMultiAoiSiO2OnSiProject();p.layers[0].modelId='tauc_lorentz';p.layers[0].parameters=modelRegistry.createParameterSet('tauc_lorentz');p.layers[0].parameters.C.current=10;
    assert.throws(()=>importProjectJson(JSON.stringify(p)),/C < 2/);
    p.layers[0].parameters.C.current=1;p.layers[0].parameters.Eg.current=4;assert.throws(()=>importProjectJson(JSON.stringify(p)),/E0 > Eg/);
    record('TL_ERROR_TABLE',table);
  });
  await test('Stage4 B: deterministic two/three peak detection with and without noise',()=>{
    const results:any[]=[];
    for(const centers of [[2,4],[1.5,3,5]])for(const noise of [0,.025]) {
      const random=rng(412);const sigma=.22,fwhm=2*Math.sqrt(Math.log(2))*sigma;
      const data=Array.from({length:401},(_,i)=>{const energy=.5+6*i/400;
        const z=Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
        return {energy,eps2:Math.max(0,centers.reduce((s,c,j)=>s+(2+j*.5)*Math.exp(-(((energy-c)/sigma)**2)),0)+noise*z)};});
      const detected=detectEpsilonPeaks(data);assert.equal(detected.peaksDetected,centers.length);
      assert.equal(JSON.stringify(detected),JSON.stringify(detectEpsilonPeaks(data)));
      for(const center of centers)assert.ok(Math.min(...detected.peaks.map(p=>Math.abs(p.energy-center)))<=.25*fwhm);
      results.push({centers,noise,...detected});
    }
    const monotone=Array.from({length:101},(_,i)=>({energy:1+i*.05,eps2:i*.02}));
    const edge=detectEpsilonPeaks(monotone);assert.equal(edge.peaksDetected,0);assert.equal(edge.edgePeak,true);
    assert.equal(detectEpsilonPeaks(monotone.map(p=>({...p,eps2:1}))).peaksDetected,0);
    record('PEAK_DETECTION',{results,edge});
  });
  await test('Stage4 B: model-specific multi-peak seeds, metadata and edge seed are reproducible',()=>{
    const spectrum=Array.from({length:401},(_,i)=>{const E=.5+6*i/400,eps2=2*Math.exp(-(((E-2)/.22)**2))+3*Math.exp(-(((E-4)/.25)**2));
      return {wavelength:1239.841984/E,...dielectricToRefractiveIndex(3,eps2)};});
    const table:any[]=[];
    for(const modelId of ['gaussian','lorentz','tauc_lorentz','multi_oscillator']) {
      let initialization:any;
      const a=modelRegistry.initializePhysicalModelFromBSpline(modelId,spectrum,undefined,{onInitialization:v=>initialization=v});
      const b=modelRegistry.initializePhysicalModelFromBSpline(modelId,spectrum);
      assert.deepEqual(a,b);assert.equal(initialization.peaksDetected,2);assert.equal(initialization.oscillatorsUsed,2);
      assert.equal(a.A2.fit,true);assert.equal(a.A3.fit,false);assert.ok(Math.abs((a.E0??a.E01).current-4)<.1||Math.abs(a.E02.current-4)<.1);
      table.push({modelId,initialization,parameters:Object.fromEntries(Object.entries(a).map(([k,p])=>[k,p.current]))});
    }
    let edge:any;
    const monotone=spectrum.map((p,i)=>({wavelength:p.wavelength,...dielectricToRefractiveIndex(3,.5+i*.01)}));
    const seeded=modelRegistry.initializePhysicalModelFromBSpline('gaussian',monotone,undefined,{onInitialization:v=>edge=v});
    assert.equal(edge.peaksDetected,0);assert.equal(edge.edgePeak,true);assert.ok(seeded.E0.current>6.5);
    const lowEdge=monotone.map((p,i)=>({...p,...dielectricToRefractiveIndex(3,5-i*.01)}));
    const tlSeed=modelRegistry.initializePhysicalModelFromBSpline('tauc_lorentz',lowEdge);
    validateTaucLorentzParameters('tauc_lorentz',Object.fromEntries(Object.entries(tlSeed).map(([k,p])=>[k,p.current])));
    record('MODEL_INITIALIZATION',{table,edgeSeed:seeded.E0.current,edge});
  });
  await test('Stage4 C: explicit grids remain bit-identical under interleaved calls and fits',async()=>{
    const a=initializeSpline(createMultiAoiSiO2OnSiProject(),0),b=clone(a),model=modelRegistry.get('bspline')!;
    for(let i=0;i<8;i++)b.layers[0].parameters['_knot'+i].current=220+i*600/7;
    const va=values(a.layers[0]),vb=values(b.layers[0]);const wavelengths=[250,400,550,700,800];
    const sa=wavelengths.map(w=>model.calculate(w,va)),sb=wavelengths.map(w=>model.calculate(w,vb));
    for(let repeat=0;repeat<5;repeat++){assert.deepEqual(wavelengths.map(w=>model.calculate(w,va)),sa);assert.deepEqual(wavelengths.map(w=>model.calculate(w,vb)),sb);}
    for(const p of [a,b]){p.experimentData!.points=p.experimentData!.points.filter((_,i)=>i%8===0);p.fittingConfig.maxIterations=3;Object.values(p.layers[0].parameters).forEach(v=>v.fit=false);p.layers[0].parameters.N3.fit=true;p.layers[0].thicknessFit=true;}
    const alone=await fitExpert(b);await fitExpert(a);const second=await fitExpert(b);
    assert.equal(second.layers[0].thickness,alone.layers[0].thickness);assert.equal(second.fittingResult!.rawMse,alone.fittingResult!.rawMse);
    assert.deepEqual(second.experimentData!.points,alone.experimentData!.points);assert.deepEqual(values(second.layers[0]),values(alone.layers[0]));
    const before=JSON.parse(readFileSync(new URL('../stage4-before.json',import.meta.url),'utf8')),after=JSON.parse(readFileSync(new URL('../stage4-c-only.json',import.meta.url),'utf8'));
    const thicknessRelative=Math.abs(after.thickness-before.thickness)/Math.abs(before.thickness),mseRelative=Math.abs(after.rawMse-before.rawMse)/Math.abs(before.rawMse);
    assert.ok(thicknessRelative<=1e-9&&mseRelative<=1e-9);record('C_ISOLATION',{thicknessRelative,mseRelative,interleaved:'bit-identical',sequential:'bit-identical'});
  });
  await test('Stage4 D: KK basis independent quadrature, positivity, linear Jacobian and instance cache',()=>{
    const model=createKkBsplineModel(),random=rng(914),params=Object.fromEntries(Object.entries(modelRegistry.createParameterSet('kk_bspline')).map(([k,p])=>[k,p.current]));
    const grid=kkSplineGrid(params),coeff=grid.map((_,i)=>i===0||i===grid.length-1?0:random()*2);
    coeff.forEach((v,i)=>params['c'+i]=v);params.uv_A=0;
    const eps2=(E:number)=>E<grid[0]||E>grid.at(-1)!?0:cubicEvaluate(E,grid,coeff);
    const table:any[]=[];let maximumJacobianError=0;
    for(let i=0;i<22;i++) {
      const E=.6+i*5.8/21,w=1239.841984/E,out=model.calculateEpsilon(w,params);
      const numeric=kkReal(E,eps2,grid,1e-9),relative=Math.abs(out.eps1-params.eps_inf-numeric)/Math.max(1e-12,Math.abs(numeric));
      assert.ok(relative<=1e-5,`${E}: KK relative ${relative}`);table.push({E,analyticBasis:out.eps1-params.eps_inf,numeric,relative});
      const derivative=model.coefficientJacobian(w,params),h=1e-4;
      for(let j=1;j<grid.length-1;j++) {
        const plus=model.calculateEpsilon(w,{...params,['c'+j]:params['c'+j]+h}),minus=model.calculateEpsilon(w,{...params,['c'+j]:params['c'+j]-h});
        const fd=(plus.eps1-minus.eps1)/(2*h),error=Math.abs(fd-derivative.real[j])/Math.abs(derivative.real[j]);
        maximumJacobianError=Math.max(maximumJacobianError,error);assert.ok(error<=1e-7);
      }
    }
    for(const E of [.01,.5,.5000001,1,3,6.4999999,6.5,10,50]){const o=model.calculateEpsilon(1239.841984/E,params);assert.ok(Number.isFinite(o.eps1)&&Number.isFinite(o.eps2)&&o.eps2>=0);}
    const before=model.cacheInfo().integrations;model.calculateEpsilon(1239.841984/3,params);model.calculateEpsilon(1239.841984/3,{...params,c4:3});assert.equal(model.cacheInfo().integrations,before);
    const withPoles=model.calculateEpsilon(1239.841984/3,{...params,uv_A:2,_irEnabled:1,ir_A:1});
    assert.ok(Number.isFinite(withPoles.eps1)&&withPoles.eps2>model.calculateEpsilon(1239.841984/3,params).eps2);
    assert.equal(createKkBsplineModel().cacheInfo().entries,0);record('KK_BASIS',{table,maximumJacobianError,cache:model.cacheInfo()});
  });
  await test('Stage4 D: TL epsilon2 projection records epsilon1 truncation deviation',()=>{
    const model=createKkBsplineModel(),params=Object.fromEntries(Object.entries(modelRegistry.createParameterSet('kk_bspline')).map(([k,p])=>[k,p.current]));
    const data=Array.from({length:241},(_,i)=>{const energy=.5+6*i/240;return {energy,eps2:tl2(energy,100,3.5,1.5,1.5),eps1:1.8+tl1(energy,100,3.5,1.5,1.5)};});
    const fitted=fitKkEpsilon2(data,params,model),table=Array.from({length:19},(_,i)=>{const E=1+i*.25,truth=1.8+tl1(E,100,3.5,1.5,1.5),fit=model.calculateEpsilon(1239.841984/E,fitted).eps1;return {E,truth,fit,deviation:fit-truth};});
    record('TL_SPLINE_PROJECTION',{table,maxDeviation:Math.max(...table.map(p=>Math.abs(p.deviation))),uvAmplitude:fitted.uv_A,epsilonInf:fitted.eps_inf});
  });
  await test('Stage4 D: synthetic multi-AOI TL layer fitted by KK spline',async()=>{
    const p=createMultiAoiSiO2OnSiProject();p.layers[0].modelId='tauc_lorentz';p.layers[0].thickness=100;
    p.layers[0].parameters=modelRegistry.createParameterSet('tauc_lorentz');
    for(const [key,value] of Object.entries({A:100,E0:3.5,C:1.5,Eg:1.5,eps_inf:1.8,A2:0,A3:0}))p.layers[0].parameters[key].current=value;
    const random=rng(20261019),sigma=.03;
    p.experimentData!.points=[65,70,75].flatMap(aoi=>Array.from({length:37},(_,i)=>{
      const energy=1+4.5*i/36,wavelength=1239.841984/energy,c=calculatePoint(p.ambient,p.layers,p.substrate,wavelength,aoi);
      const r=Math.sqrt(-2*Math.log(random())),phi=2*Math.PI*random();
      return {id:`${aoi}-${i}`,aoi,wavelength,psiExp:c.psiDeg+sigma*r*Math.cos(phi),deltaExp:normalizeDeltaDeg(c.deltaDeg+sigma*r*Math.sin(phi)),psiSigma:sigma,deltaSigma:sigma};
    }));
    p.fittingConfig.fitWavelengthMin=1239.841984/5.5;p.fittingConfig.fitWavelengthMax=1239.841984;p.fittingConfig.maxIterations=100;
    const model=createKkBsplineModel(),params=modelRegistry.createParameterSet('kk_bspline'),paramsRecord=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,v.current]));
    const data=Array.from({length:241},(_,i)=>{const energy=.5+6*i/240;return {energy,eps1:1.8+tl1(energy,100,3.5,1.5,1.5),eps2:tl2(energy,100,3.5,1.5,1.5)};});
    const fitted=fitKkEpsilon2(data,paramsRecord,model);for(const [key,value] of Object.entries(fitted))if(params[key])params[key].current=value;
    p.layers[0].modelId='kk_bspline';p.layers[0].parameters=params;p.layers[0].thickness=97;
    p.expert={stage:2,smoothing:0,candidates:[],records:[]};
    const out=await fitExpert(p);record('KK_SYNTHETIC_FIT',{thickness:out.layers[0].thickness,error:out.layers[0].thickness-100,converged:out.fittingResult!.converged,status:out.fittingResult!.convergenceStatus,mseWoollam:out.fittingResult!.mseWoollam});
    assert.ok(Math.abs(out.layers[0].thickness-100)<.5);assert.equal(out.fittingResult!.converged,true);
  });
  await test('Stage4 E: high physical correlation upgrades condition level without changing kappa',()=>{
    const p=createMultiAoiSiO2OnSiProject();p.layers[0].parameters=modelRegistry.createParameterSet('cauchy');
    const vars=[{id:'d',name:'d',value:2,min:.01,max:10},{id:'A',name:'A',value:1.457,min:1,max:3.5}];
    const s=computeFitStatistics(vars,[2,1.457],([d,n])=>{p.layers[0].thickness=d;p.layers[0].parameters.A.current=n;
      return Array.from({length:11},(_,i)=>{const c=calculatePoint(p.ambient,p.layers,p.substrate,600+10*i,70);return [c.psiDeg,c.deltaDeg];}).flat();});
    assert.ok(s.conditionNumber!<1000);assert.equal(s.conditionLevel,'severe');assert.ok(s.warnings.some(w=>w.includes('d ↔ A')));
    record('CORRELATION_LEVEL',{r:s.correlation.matrix[0][1],kappa:s.conditionNumber,previousLevel:'ok',level:s.conditionLevel,warnings:s.warnings});
  });
  await test('Stage4 D: Expert stages preserve optional KK model and expose independent parameters',async()=>{
    const p=initializeKkSpline(createMultiAoiSiO2OnSiProject(),0);p.fittingConfig.maxIterations=1;
    const expected=values(p.layers[0]);assert.equal(p.layers[0].modelId,'kk_bspline');assert.ok(expected._emax>expected._emin);
    assert.ok(expected._uvE0>=1.5*expected._emax);assert.equal(expected._irEnabled,0);
    const stage2=await runExpertStage(p,2,0),stage3=await runExpertStage(stage2,3,0);
    assert.equal(stage2.layers[0].modelId,'kk_bspline');assert.equal(stage3.layers[0].modelId,'kk_bspline');
    assert.equal(stage3.layers[0].parameters.c0.fit,false);assert.ok(!stage3.fittingResult!.statistics!.parameters.some(p=>/\.c\d+$/.test(p.id)));
    assert.equal(modelRegistry.getPhysicalModels().some(m=>m.id==='kk_bspline'),false);
  });
  writeFileSync('stage4-test-details.json',JSON.stringify(detail,null,2));
}
