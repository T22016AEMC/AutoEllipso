import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {calculateSpectrum} from '../src/solver/calculator';
import {computeResidualMetrics} from '../src/fitting/residual';
import {score} from './stage4_6d-run';
const prefix='.qa/stage4_8c-',read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
function save(name:string,value:unknown){const path=prefix+name+'.json';writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(path+'.tmp',path);}
const settings={base:'db0ae4b2150877314b80ecb00988b96073db02c2',truths:['V0','V1','V2','V3','V4','V5','V6'],seed:49001,outSeeds:[49004,49005],modes:['sigma','sigmaHat'],
 ladder:[[40,1],[40,.1],[40,.01],[60,.01],[80,.01]],small:[[12,1],[12,.1],[12,.01],[16,.01],[20,.01],[24,.01]],
 modeInput:'sigma: original points/config; sigmaHat: remove psiSigma/deltaSigma only; original standard_deviation configuration falls back to uniform. No changes to physical-stage algorithm or objective weighting implementation.',
 selection:'cost converged dof>0 M<=N_eq/4; first legal; strict score drop>.05; sigmaHat uses last legal endpoint only, unavailable=>baseline flagged; small baseline invalid=>no candidate. Old sources compared under same score/estimate; new source strict lower than both, old-source ties retain existing rule.',
 score:'known sigma used only after selection to compare Win/Wout across modes; original formal metric also recorded. E on original72 wavelengths; evaluation p from selected statistics. Original source fixtures and results never overwritten.',
 criteria:'for each mode >=6/7 setting matches; every mismatching Wout minus reference <=.05 (signed); no tolerance/assertion/iteration changes; existing scientific90/92 same failure details. Median Automatic time versus original4.5d saved timing. Full verify once.',
 interruption:'atomic output checkpoints; saved outputs never rerun; report any unpersisted interrupted fit. No interruption requested at initialization.'};
const settingsText=JSON.stringify(settings,null,2)+'\n';
async function main(){
 if(existsSync(prefix+'settings.json'))assert.equal(readFileSync(prefix+'settings.json','utf8'),settingsText);else{writeFileSync(prefix+'settings.json',settingsText);save('settings-sha256',{sha256:createHash('sha256').update(settingsText).digest('hex')});}
 const started=Date.now(),cards:any[]=[];
 for(const mode of settings.modes)for(const id of settings.truths){
  const f=read(`.qa/stage4_8a-${id}-49001-data.json`),name=`${id}-${mode}-automatic`;
  let stored:any;
  if(existsSync(prefix+name+'.json'))stored=read(prefix+name+'.json');else{
   const points=structuredClone(f.points);if(mode==='sigmaHat')for(const point of points){delete point.psiSigma;delete point.deltaSigma;}
   const at=performance.now(),progress:any[]=[];
   const output=await runAutomatedEllipsometryFit({ambient:f.project.ambient,layers:f.project.layers,substrate:f.project.substrate,points,
    config:f.project.fittingConfig,targetModelId:id==='V0'||id==='V5'?'gaussian':f.truth.model,selectedAois:[65,70,75],onProgress:p=>{if(p.stage==='stage_free_form_refine')progress.push(p);}});
   stored={id,mode,elapsedMs:performance.now()-at,output,progress};save(name,stored);
  }
  const r=stored.output.fittingResult,model=r.freeFormModel,setting=r.freeFormRefinement.selectedSetting,p=r.freeFormStatistics.covariance.ids.length;
  const evaluated=calculateSpectrum(f.project.ambient,model.layers,f.project.substrate,f.points);
  const Win=computeResidualMetrics(evaluated,f.project.fittingConfig.fitWeighting,1,1,p).mseWoollam;
  const outs=settings.outSeeds.map(seed=>{const out=read(`.qa/stage4_8a-${id}-${seed}-data.json`);return computeResidualMetrics(calculateSpectrum(f.project.ambient,model.layers,f.project.substrate,out.points),f.project.fittingConfig.fitWeighting,1,1,p).mseWoollam;});
  const curve=f.optics.map((q:any)=>r.freeFormOpticalConstants.find((p:any)=>p.wavelength===q.wavelength));assert.ok(curve.every(Boolean));
  const errors=score(f,{curve,result:{finalParams:model.variables.map((q:any)=>q.value)}});
  const reference=mode==='sigma'?read(`.qa/stage4_8a-${id}-49001-rules.json`).rules.find((q:any)=>q.rule==='R1c'):read(`.qa/stage4_8b-${id}-49001-choices.json`).choices.find((q:any)=>q.rule==='N3');
  const refEval=read(`.qa/stage4_8a-${id}-49001-${reference.selected}-evaluation.json`),refFit=read(`.qa/stage4_8a-${id}-49001-${reference.selected}.json`);
  const refScore=refEval.score??score(f,refFit.out),selected=`${setting.count}Ws${setting.scale}`,Wout=(outs[0]+outs[1])/2;
  const physicalReference=read(`.qa/stage4_8a-${id}-49001-automatic.json`).output;
  const card={id,mode,selected,origin:r.freeFormOrigin,reference:reference.selected,match:selected===reference.selected,
   Win,Wout,E:errors.error,errors,originalMetric:r.opticalModelComparison.freeForm.mseWoollam,p,dof:r.freeFormStatistics.dof,
   referenceWin:refFit.metrics.mseWoollam,referenceWout:refEval.oosW,referenceE:refScore.error,
   deltaWin:Win-refFit.metrics.mseWoollam,deltaWout:Wout-refEval.oosW,deltaE:errors.error-refScore.error,
   elapsedMs:stored.elapsedMs,physicalThicknessDelta:stored.output.finalThickness-physicalReference.finalThickness,
   steps:r.freeFormRefinement.ladderV2.steps.length,fallback:r.freeFormRefinement.ladderV2.fallback,sigmaUnavailable:r.freeFormRefinement.ladderV2.sigmaUnavailable};
  cards.push(card);save(`${id}-${mode}-evaluation`,card);save('progress',{completed:cards.length,total:14,elapsedMs:Date.now()-started,latest:`${id}/${mode}`});
 }
 const median=(a:number[])=>{a.sort((x,y)=>x-y);return a.length%2?a[Math.floor(a.length/2)]:(a[a.length/2-1]+a[a.length/2])/2;};
 // Historical full-Automatic seconds, as published in STAGE4_5D_REPORT.md (six original truths).
 const baseline=[24.70891090,16.10097730,38.65120940,65.59843910,11.30289630,18.63061340].map(seconds=>1000*seconds);
 save('regression-summary',{cards,modes:settings.modes.map(mode=>{const rows=cards.filter(c=>c.mode===mode),matches=rows.filter(c=>c.match).length,medianMs=median(rows.map(c=>c.elapsedMs));return {mode,matches,pass:matches>=6&&rows.filter(c=>!c.match).every(c=>c.deltaWout<=.05),medianMs,baselineMedianMs:median([...baseline]),ratio:medianMs/median([...baseline])};}),elapsedMs:cards.reduce((s,c)=>s+c.elapsedMs,0),interruption:{savedResultsRerun:0,unpersistedFitsRerun:0,scope:[]}});
}
if(process.argv[1]?.endsWith('stage4_8c-regression.ts'))main().catch(error=>{save('stopped',{stage:'regression',error:String(error),at:new Date().toISOString()});process.exitCode=1;});
