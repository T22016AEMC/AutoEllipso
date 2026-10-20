import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {generateAdaptiveKnots} from '../src/models/bspline';
import {bestSplineStage,continueSplineRefinement,effectiveSplineParameters,splineBic} from '../src/fitting/splineRefinement';
import {assessFitAdequacy,freeFormCurve} from '../src/fitting/freeFormOptics';
import {computeFitStatistics} from '../src/fitting/statistics';
import {opticalConstantsCsv,importProjectJson} from '../src/data/export';
import {createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {initializeSpline,changeSplineGrid,validateExpert,initializeMixed} from '../src/fitting/expertWorkflow';
import {modelRegistry} from '../src/modelRegistry/registry';
import {ParameterEstimate} from '../src/components/FitStatisticsPanel';
import type {FittingResult,FittedParameterResult} from '../src/types/ellipsometry';

export async function stage43Tests(test:(name:string,fn:()=>void|Promise<void>)=>Promise<void>) {
  await test('Stage4.3: deterministic 24/32/40 grids and JSON/Expert round-trip',()=>{
    for(const count of [24,32,40]){
      const grid=generateAdaptiveKnots(190,900,count);
      assert.deepEqual(grid,generateAdaptiveKnots(190,900,count));assert.equal(grid.length,count);
      assert.equal(grid[0],190);assert.equal(grid.at(-1),900);assert.ok(grid.every((w,i)=>i===0||w>grid[i-1]));
      const p=initializeSpline(createMultiAoiSiO2OnSiProject(),0);p.layers[0]=changeSplineGrid(p.layers[0],grid);validateExpert(p);
      const restored=importProjectJson(JSON.stringify({...p,deltaConventionVersion:2}));validateExpert(restored);
      assert.equal(restored.layers[0].parameters._knotCount.current,count);
      const mixed=initializeMixed(restored,0);validateExpert(mixed);
      for(const w of [190,350,633,900])assert.deepEqual(modelRegistry.get('bspline')!.calculate(w,Object.fromEntries(Object.entries(restored.layers[0].parameters).map(([k,v])=>[k,v.current]))),modelRegistry.get('bspline')!.calculate(w,Object.fromEntries(Object.entries(p.layers[0].parameters).map(([k,v])=>[k,v.current]))));
    }
  });
  await test('Stage4.3: BIC evidence, selection, ties and effective parameter count',()=>{
    assert.equal(continueSplineRefinement(undefined,100),true);assert.equal(continueSplineRefinement(100,89),true);
    assert.equal(continueSplineRefinement(100,90),false);assert.equal(continueSplineRefinement(100,95),false);
    assert.equal(continueSplineRefinement(100,101),false);
    assert.equal(bestSplineStage([{knots:8,bic:100,skipped:false},{knots:12,bic:80,skipped:false},{knots:16,bic:81,skipped:false}]),1);
    assert.equal(bestSplineStage([{knots:16,bic:80,skipped:false},{knots:12,bic:80,skipped:false},{knots:8,bic:1,skipped:true}]),1);
    assert.equal(splineBic(100,3,120,2,true),120+3*Math.log(100));
    assert.equal(splineBic(100,3,120,2,false),100*Math.log(.02)+3*Math.log(100));
    const vars=[{id:'a',name:'a',value:.5,min:0,max:1},{id:'b',name:'b',value:0,min:0,max:1},{id:'c',name:'c',value:1,min:1,max:1}];
    assert.equal(effectiveSplineParameters(vars,[.5,0,1]),1);
  });
  await test('Stage4.3: adequacy flags preserve k, sigma and detection with non-color UI warning',()=>{
    const variables=[0,1,2,3].map(i=>({id:'K'+i,name:'K'+i,value:.001,min:0,max:1,splineCoefficient:true}));
    const s=computeFitStatistics(variables,variables.map(v=>v.value),x=>[...x.map(v=>v-.001),.01,.01],{isAngularResidual:()=>false});
    for(const [reduced,expected] of [[1.2,'good'],[1.8,'marginal'],[3,'poor']] as const){
      const statistics={...s,reducedChiSquare:reduced},adequacy=assessFitAdequacy(statistics,'sigma');assert.equal(adequacy.fitAdequacy,expected);
      const curve=freeFormCurve([400,500,600,700],[400,500,600,700],[1.6,1.6,1.6,1.6],[.001,.001,.001,.001],statistics,'sigma');
      const original=freeFormCurve([400,500,600,700],[400,500,600,700],[1.6,1.6,1.6,1.6],[.001,.001,.001,.001],statistics);
      for(let i=0;i<curve.length;i++){assert.equal(curve[i].k,.001);assert.equal(curve[i].kSigma,original[i].kSigma);assert.deepEqual(curve[i].kCi95,original[i].kCi95);}
      const flag=opticalConstantsCsv(curve,'free_form').split('\n')[1].split(',')[4];
      assert.equal(flag,expected==='good'?'below_detection':'below_detection;unreliable');
      const stat={...s.parameters[0],id:'film.A',value:1,stdError:.1,stdErrorUnscaled:.1,ci95:[.8,1.2] as [number,number]};
      const result={statistics:{...statistics,parameters:[stat]},fitAdequacy:expected,fitAdequacyWarning:adequacy.warning} as FittingResult;
      const html=renderToStaticMarkup(createElement(ParameterEstimate,{result,parameter:{layerId:'film',paramId:'A',finalValue:1,unit:''} as FittedParameterResult}));
      assert.equal(html.includes('不確定度不可信'),expected!=='good');
    }
    assert.equal(assessFitAdequacy(s,'uniform').fitAdequacy,'unknown');assert.match(assessFitAdequacy(s,'uniform').warning!,/沒有 σ/);
  });
}
