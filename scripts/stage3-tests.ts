import {readQaFileSync as readFileSync} from './qa-files.mjs';
import assert from 'node:assert/strict';

import {svd,solveLeastSquaresSvd} from '../src/fitting/svd';
import {computeFitStatistics,studentT975} from '../src/fitting/statistics';
import {optimizeBoundedLM} from '../src/fitting/optimizer';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {modelRegistry} from '../src/modelRegistry/registry';
import {calculatePoint,calculateSpectrum} from '../src/solver/calculator';
import {normalizeDeltaDeg} from '../src/solver/ellipsometricAngles';
import {fitExpert,clone} from '../src/fitting/expertWorkflow';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {createValidationReport} from '../src/data/validationReport';
import {importProjectJson} from '../src/data/export';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FitStatisticsPanel,StatisticsWarning,ParameterEstimate} from '../src/components/FitStatisticsPanel';

type Test=(name:string,fn:()=>void|Promise<void>)=>Promise<void>;
const transpose=(a:number[][])=>a[0].map((_,j)=>a.map(row=>row[j]));
const multiply=(a:number[][],b:number[][])=>a.map(row=>b[0].map((_,j)=>row.reduce((s,x,k)=>s+x*b[k][j],0)));
const error=(a:number[][],b:number[][])=>Math.hypot(...a.flatMap((row,i)=>row.map((x,j)=>x-b[i][j])))/Math.max(1,Math.hypot(...b.flat()));
function random(seed:number) {return ()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return (seed+.5)/4294967296;};}
const variable=(id:string,value=0,min=-10,max=10)=>({id,name:id,value,min,max});
function near(x:number,y:number,tol:number) {assert.ok(Math.abs(x-y)<tol,`${x} != ${y}, tolerance ${tol}`);}

export async function stage3Tests(test:Test) {
  await test('SVD reconstruction and Moore-Penrose identities: random, Hilbert and rank deficient',()=>{
    const rng=random(731),randomMatrix=Array.from({length:9},()=>Array.from({length:4},()=>rng()*2-1));
    const hilbert=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>1/(i+j+1)));
    for(const a of [randomMatrix,hilbert,[[1,1],[2,2],[3,3]]]) {
      const s=svd(a),reconstructed=multiply(s.u.map(row=>row.map((x,j)=>x*s.singularValues[j])),transpose(s.v));
      assert.ok(error(reconstructed,a)<1e-12);
      const pinv=multiply(s.v.map(row=>row.map((x,j)=>s.singularValues[j]>s.singularValues[0]*1e-12?x/s.singularValues[j]:0)),transpose(s.u));
      assert.ok(error(multiply(multiply(a,pinv),a),a)<1e-10);
      assert.ok(error(multiply(multiply(pinv,a),pinv),pinv)<1e-10);
      assert.ok(pinv.flat().every(Number.isFinite));
    }
  });
  await test('SVD solution agrees with normal equations on a well-conditioned problem to 1e-9',()=>{
    const rng=random(42),a=Array.from({length:12},()=>Array.from({length:4},()=>rng()*2-1)),b=a.map(()=>rng());
    const at=transpose(a),h=multiply(at,a),rhs=at.map(row=>row.reduce((s,x,i)=>s+x*b[i],0));
    const augmented=h.map((row,i)=>[...row,rhs[i]]);
    for(let k=0;k<4;k++) {
      const d=augmented[k][k];for(let j=k;j<=4;j++)augmented[k][j]/=d;
      for(let i=0;i<4;i++)if(i!==k){const f=augmented[i][k];for(let j=k;j<=4;j++)augmented[i][j]-=f*augmented[k][j];}
    }
    solveLeastSquaresSvd(a,b).solution.forEach((x,i)=>near(x,augmented[i][4],1e-9));
    assert.equal(solveLeastSquaresSvd([[1,1],[2,2]],[3,6]).truncated,1);
  });
  await test('Student t 97.5 percent quantiles against tabulated values',()=>{
    for(const [dof,expected] of [[1,12.706],[2,4.303],[5,2.571],[10,2.228],[30,2.042],[100,1.984]])near(studentT975(dof),expected,.0005);
    near(studentT975(1001),1.959963984540054,1e-14);assert.throws(()=>studentT975(0));
  });
  await test('Relative convergence is invariant to uniform sigma scaling',async()=>{
    for(const weight of [1,25,100]) {
      const out=await optimizeBoundedLM([variable('p',.1,0,2)],([p])=>[p-.7,p-.7],{residualWeights:[weight,weight],maxIterations:60});
      assert.equal(out.converged,true);assert.ok(['cost','step','gradient','no_better_step'].includes(out.status));near(out.finalParams[0],.7,1e-7);
    }
    const stopped=await optimizeBoundedLM([variable('p')],([p])=>[p-1,0],{shouldStop:()=>true});assert.equal(stopped.status,'cancelled');
  });
  await test('Fresh final Jacobian, physical scaling, covariance and unscaled standard errors',()=>{
    let evaluations=0;
    const stats=computeFitStatistics([variable('p',.5,0,2)],[.5],([p])=>{evaluations++;return [p-1,2*p-1,0,0];},{weights:[2,2,2,2],isAngularResidual:()=>false});
    assert.ok(evaluations>=4);assert.equal(stats.dof,3);near(stats.chiSquare,1,1e-12);near(stats.scaleFactor!,1/3,1e-12);
    near(stats.parameters[0].stdErrorUnscaled!,1/Math.sqrt(20),1e-8);
    near(stats.parameters[0].stdError!,1/Math.sqrt(60),1e-8);assert.equal(stats.parameters[0].derivative,2);
    assert.ok(stats.parameters[0].ci95![0]<.5&&stats.parameters[0].ci95![1]>.5);
  });
  await test('Boundary parameters have no uncertainty; remaining errors are conditional',async()=>{
    const vars=[variable('bound',.5,0,1),variable('other',.5,0,2)];
    const fn=([a,b]:number[])=>[a-2,b-.8,a-2,b-.9];
    const out=await optimizeBoundedLM(vars,fn,{isAngularResidual:()=>false,maxIterations:60});
    const s=computeFitStatistics(vars,out.finalParams,fn,{isAngularResidual:()=>false});
    assert.equal(s.parameters[0].boundaryHit,true);assert.equal(s.parameters[0].stdError,null);
    assert.ok(s.parameters[1].stdError!>0);assert.equal(s.dof,3);assert.match(s.warnings.join(),/條件/);
  });
  await test('Locked variables excluded and spline coefficients included in dof and covariance',()=>{
    const s=computeFitStatistics([{...variable('locked'),locked:true},{...variable('N0'),splineCoefficient:true},variable('physical')],[0,0,0],([a,b,c])=>[a+b,b-c,c,1],{isAngularResidual:()=>false});
    assert.deepEqual(s.parameters.map(p=>p.id),['physical']);assert.equal(s.dof,2);assert.deepEqual(s.covariance.ids,['N0','physical']);
  });
  await test('Rank deficiency flags non-identifiable parameters without nonfinite JSON values',()=>{
    const s=computeFitStatistics([variable('a'),variable('b')],[0,0],([a,b])=>[a+b-1,2*(a+b)-1,3*(a+b)-2,4*(a+b)-3],{isAngularResidual:()=>false});
    assert.equal(s.truncatedSingularValues,1);assert.ok(s.parameters.every(p=>p.nonIdentifiable&&p.stdError===null&&p.ci95===null));assert.ok(s.warnings.length);
    function check(v:any){if(typeof v==='number')assert.ok(Number.isFinite(v));else if(v&&typeof v==='object')Object.values(v).forEach(check);}check(s);
  });
  await test('Nonpositive dof returns warning without uncertainty calculation',()=>{
    const s=computeFitStatistics([variable('a'),variable('b')],[0,0],([a,b])=>[a,b],{isAngularResidual:()=>false});
    assert.equal(s.available,false);assert.equal(s.dof,0);assert.equal(s.parameters.length,0);assert.match(s.warnings.join(),/dof/);
  });
  await test('Monte Carlo: 100 seeded multi-AOI thickness fits and reported uncertainties',async()=>{
    const truth=createMultiAoiSiO2OnSiProject();truth.layers[0].thickness=100;truth.layers[0].parameters=modelRegistry.createParameterSet('cauchy');
    const exact=calculateSpectrum(truth.ambient,truth.layers,truth.substrate,truth.experimentData!.points),rng=random(0x12345678),fits:number[]=[],errors:number[]=[];
    let coverage=0,converged=0;
    for(let run=0;run<100;run++) {
      const p=clone(truth);p.layers[0].thickness=90;
      [...p.layers,p.substrate].forEach(l=>Object.values(l.parameters).forEach(v=>v.fit=false));
      p.fittingConfig.maxIterations=60;
      p.experimentData!.points=exact.map(pt=>{
        const radius=Math.sqrt(-2*Math.log(rng())),theta=2*Math.PI*rng();
        return {...pt,psiExp:pt.psiCalc!+.04*radius*Math.cos(theta),deltaExp:normalizeDeltaDeg(pt.deltaCalc!+.04*radius*Math.sin(theta)),psiSigma:.04,deltaSigma:.04};
      });
      const out=await fitExpert(p),d=out.layers[0].thickness,se=out.fittingResult!.statistics!.parameters.find(x=>x.id.endsWith('.thickness'))!.stdError!;
      assert.ok(se>0);fits.push(d);errors.push(se);coverage+=Math.abs(d-100)<=2*se?1:0;converged+=out.fittingResult!.converged?1:0;
    }
    const mean=fits.reduce((s,x)=>s+x,0)/100,sampleSd=Math.sqrt(fits.reduce((s,x)=>s+(x-mean)**2,0)/99),meanSe=errors.reduce((s,x)=>s+x,0)/100,ratio=sampleSd/meanSe;
    console.log('STAGE3_MONTE_CARLO '+JSON.stringify({seed:'0x12345678',runs:100,sampleSd,meanStdError:meanSe,ratio,coverage:coverage/100,converged:converged/100}));
    assert.ok(ratio>=.7&&ratio<=1.4);assert.ok(coverage>=85&&coverage<=99);assert.equal(converged,100);
  });
  await test('Ultrathin film: thickness-index correlation and condition warning fields',async()=>{
    const p=createMultiAoiSiO2OnSiProject();p.layers[0].parameters=modelRegistry.createParameterSet('cauchy');p.layers[0].thickness=2;
    p.experimentData!.points=p.experimentData!.points.filter(pt=>pt.aoi===75&&pt.wavelength>=630&&pt.wavelength<=650).map(pt=>{
      const c=calculatePoint(p.ambient,p.layers,p.substrate,pt.wavelength,pt.aoi);return {...pt,psiExp:c.psiDeg,deltaExp:c.deltaDeg};
    });
    p.fittingConfig.activeFitAois=[75];p.layers[0].thicknessMin=.01;p.layers[0].thicknessMax=10;
    Object.values(p.layers[0].parameters).forEach(v=>v.fit=v.id==='A');p.layers[0].thickness=2.01;p.fittingConfig.maxIterations=100;
    const out=await fitExpert(p),s=out.fittingResult!.statistics!,i=s.correlation.ids.findIndex(x=>x.endsWith('.thickness')),j=s.correlation.ids.findIndex(x=>x.endsWith('.A'));
    const r=s.correlation.matrix[i][j];console.log('STAGE3_ULTRATHIN '+JSON.stringify({r,conditionNumber:s.conditionNumber,conditionLevel:s.conditionLevel}));
    assert.equal(typeof r,'number');assert.ok(['caution','severe'].includes(s.conditionLevel));
  });
  await test('Automatic multi-AOI sigma fit converges and retains baseline fit within tolerance',async()=>{
    const p=createMultiAoiSiO2OnSiProject();
    const out=await runAutomatedEllipsometryFit({ambient:p.ambient,layers:p.layers,substrate:p.substrate,points:p.experimentData!.points,config:p.fittingConfig,targetModelId:'gaussian',selectedAois:[65,70,75]});
    console.log('STAGE3_AUTOMATIC '+JSON.stringify({thickness:out.finalThickness,rawMse:out.fittingResult.rawMse,converged:out.fittingResult.converged,reason:out.fittingResult.convergenceStatus,statisticsMs:out.fittingResult.statistics?.elapsedMs}));
    assert.equal(out.fittingResult.converged,true);assert.ok(['cost','step','gradient','no_better_step'].includes(out.fittingResult.convergenceStatus!));
    const baseline=JSON.parse(readFileSync(new URL('./fixtures/stage3-before.json',import.meta.url),'utf8'));
    near(out.finalThickness,baseline.thickness,1e-3);near(out.fittingResult.rawMse!,baseline.rawMse,1e-5);
    for(const [key,param] of Object.entries(out.updatedLayers[0].parameters))if(param.fit)
      near(param.current,baseline.parameters[key].current,p.fittingConfig.tolerance*Math.max(1,Math.abs(baseline.parameters[key].current)));
    assert.ok(out.fittingResult.statistics?.available);
  });
  await test('Fit statistics survive project JSON and validation report; legacy fields remain optional',async()=>{
    const p=createMultiAoiSiO2OnSiProject();p.layers[0].parameters=modelRegistry.createParameterSet('cauchy');p.layers[0].thickness=100;
    Object.values(p.layers[0].parameters).forEach(v=>v.fit=false);
    const out=await fitExpert(p),s=out.fittingResult!.statistics;
    assert.deepEqual(importProjectJson(JSON.stringify(out)).fittingResult!.statistics,s);
    assert.deepEqual(createValidationReport(out).statistics,s);
    delete out.fittingResult!.statistics;assert.equal(importProjectJson(JSON.stringify(out)).fittingResult!.statistics,undefined);
  });
  await test('Statistics UI renders errors, confidence intervals, warnings and correlation matrix',()=>{
    const statistics=computeFitStatistics([variable('film.d'),variable('film.n')],[0,0],([a,b])=>[a-1,b-1,a-b,1],{isAngularResidual:()=>false});
    const result={statistics,converged:true,convergenceStatus:'cost'} as any;
    const html=renderToStaticMarkup(createElement(FitStatisticsPanel,{result}));
    assert.match(html,/95% CI/);assert.match(html,/±/);assert.match(html,/參數相關矩陣/);assert.match(html,/scaleFactor/);
    const parameter={layerId:'film',paramId:'d',finalValue:0,unit:'nm'} as any;
    statistics.parameters[0].boundaryHit=true;statistics.parameters[0].stdError=null;statistics.parameters[0].ci95=null;
    assert.match(renderToStaticMarkup(createElement(ParameterEstimate,{result,parameter})),/在邊界/);
    statistics.parameters[0].nonIdentifiable=true;
    assert.match(renderToStaticMarkup(createElement(ParameterEstimate,{result,parameter})),/不可識別/);
    assert.match(renderToStaticMarkup(createElement(StatisticsWarning,{statistics})),/建議固定其中一個參數/);
    statistics.correlation.ids=Array.from({length:13},(_,i)=>'p'+i);
    assert.match(renderToStaticMarkup(createElement(FitStatisticsPanel,{result})),/最大的 5 對/);
  });
}
