import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {settings,groups,save,read,guard,data,prepare,workflow,polish,spearman,diverse,selfCheck} from './stage4_6a-support';
guard();const id=process.argv[2];
if(id==='prepare'){selfCheck();prepare();console.log(JSON.stringify(settings));}
else {
 const group=groups.find(g=>g.id===id);assert.ok(group,'Unknown group');assert.deepEqual(read('settings'),settings,'Settings frozen before all data');
 const f=data(group),w=await workflow();w.diagnosticReset();const start=performance.now();console.log('START '+id);
 const output=await w.runAutomatedEllipsometryFit({ambient:structuredClone(f.project.ambient),layers:structuredClone(f.project.layers),substrate:structuredClone(f.project.substrate),points:structuredClone(f.points),config:structuredClone(f.project.fittingConfig),targetModelId:group.model,selectedAois:[65,70,75]});
 assert.equal(w.diagnosticContexts.length,1);const ctx=w.diagnosticContexts[0],states=ctx.states.map((s:any,i:number)=>({...s,rank:i+1}));
 const formalCalls=w.diagnosticCalls.filter((c:any)=>c.options.maxIterations===100&&c.options.tolerance===1e-6);
 assert.equal(formalCalls.length,2,'Formal top-two polishing captured');
 const prior=group.scenario.startsWith('T')?`.qa/stage4_5d-${group.scenario}.json`:group.model==='gaussian'?`.qa/stage4_5d-reg-${group.scenario}-after.json`:undefined;
 let baselineChecked=false;
 if(prior&&existsSync(prior)){const old=JSON.parse(readFileSync(prior,'utf8')).output;assert.equal(output.fittingResult.mseWoollam,old.fittingResult.mseWoollam);assert.equal(output.finalThickness,old.finalThickness);assert.deepEqual(output.finalOpticalConstants,old.finalOpticalConstants);baselineChecked=true;}
 save(id+'-formal',{group,output,context:ctx,calls:w.diagnosticCalls,elapsedMs:performance.now()-start,baselineChecked});
 const oracle:any[]=[],short:any[]=[],continued:any[]=[];
 const checkpoint=()=>save(id+'-journal',{group,oracle,short,continued});
 for(const state of states) {
  const r=await polish(ctx,state);oracle.push(r);checkpoint();
  if(state.rank<=2){const actual=formalCalls[state.rank-1];for(const key of ['finalParams','finalCost','iterations','status','converged'] as const)assert.deepEqual(r.result[key],actual.result[key],'Exact formal polish replay '+id+' rank'+state.rank+' '+key);}
  console.log('ORACLE '+JSON.stringify({rank:r.rank,index:r.startIndex,cost:r.cost,mseWoollam:r.mseWoollam,status:r.status,iterations:r.iterations,elapsedMs:r.elapsedMs}));
 }
 for(const state of states){const r=await polish(ctx,state,settings.S3.first);short.push(r);checkpoint();}
 const survivors=[...short].sort((a,b)=>a.cost-b.cost||a.rank-b.rank).slice(0,settings.S3.survivors);
 for(const r of survivors){const state=states.find((s:any)=>s.startIndex===r.startIndex),next=await polish(ctx,state,settings.S3.second,r.result.finalParams);continued.push(next);checkpoint();}
 const best=[...oracle].sort((a,b)=>a.cost-b.cost||a.rank-b.rank)[0];
 const fallback={startIndex:states[0].startIndex,rank:1,cost:states[0].weightedMse,mseWoollam:Math.sqrt(states[0].weightedMse*2*ctx.points.length/Math.max(1,2*ctx.points.length-(1+Object.values(states[0].layers[ctx.primaryLayerIndex].parameters).filter((p:any)=>p.fit).length))),thickness:states[0].layers[ctx.primaryLayerIndex].thickness,source:'coarse'};
 const strategies:any[]=[];
 function strategy(name:string,picks:any[],work:any[],extras:any[]=[]) {
  let selected:any=fallback;for(const candidate of [...extras,...picks])if(candidate.cost<=selected.cost)selected=candidate;
  strategies.push({name,selected:{startIndex:selected.startIndex,rank:selected.rank,cost:selected.cost,mseWoollam:selected.mseWoollam,thickness:selected.thickness},
   picks:picks.map(p=>p.startIndex),regret:selected.cost-best.cost,mseRegret:selected.mseWoollam-best.mseWoollam,
   iterations:ctx.prefixIterations+work.reduce((s,r)=>s+r.iterations,0),polishIterations:work.reduce((s,r)=>s+r.iterations,0),
   elapsedMs:ctx.prefixElapsedMs+work.reduce((s,r)=>s+r.elapsedMs,0),polishElapsedMs:work.reduce((s,r)=>s+r.elapsedMs,0),timing:'estimated: common measured prefix + sum of serial measured polish calls'});
 }
 strategy('S0',oracle.slice(0,2),oracle.slice(0,2));strategy('S1',oracle.slice(0,4),oracle.slice(0,4));strategy('S2',oracle.slice(0,6),oracle.slice(0,6));
 strategy('S3',continued,[...short,...continued],short);
 const diversity=diverse(states),s4=oracle.filter(r=>diversity.selected.some(s=>s.startIndex===r.startIndex));strategy('S4',s4,s4);
 const formalCost=ctx.selected.weightedMse,s0=strategies[0];assert.equal(s0.selected.cost,formalCost,'S0 reproduces exact formal choice cost');assert.equal(s0.selected.startIndex,ctx.selected.startIndex);
 const table=oracle.map(r=>{const state=states.find((s:any)=>s.startIndex===r.startIndex),coarse=ctx.coarse.find((c:any)=>c.startIndex===r.startIndex);return {...r,coarseCost:state.weightedMse,coarseStatus:coarse.result.status,coarseIterations:coarse.result.iterations,coarseCap:coarse.maxIterations,coarseTrainingPoints:coarse.points,coarseTrainingCost:coarse.result.finalWeightedCost};});
 const highRejected=table.filter(r=>r.coarseCost>settings.highCoarseFactor*states[0].weightedMse&&r.cost<=settings.lowFinalFactor*best.cost);
 const summary={id,model:group.model,count:states.length,formalIndex:ctx.selected.startIndex,formalCost,formalMseWoollam:output.fittingResult.mseWoollam,
  oracleIndex:best.startIndex,oracleRank:best.rank,oracleCost:best.cost,oracleMseWoollam:best.mseWoollam,regret:formalCost-best.cost,mseRegret:output.fittingResult.mseWoollam-best.mseWoollam,
  formalThickness:output.finalThickness,oracleThickness:best.thickness,formalThicknessError:f.truth?output.finalThickness-100:undefined,oracleThicknessError:f.truth?best.thickness-100:undefined,
  spearman:spearman(table.map(r=>r.coarseCost),table.map(r=>r.cost)),minimumK:best.rank,coarseMaxIter:table.filter(r=>r.coarseStatus==='max_iter').length,
  coarseStalled:table.filter(r=>r.coarseStatus==='stalled').length,coarseAtCap:table.filter(r=>r.coarseIterations>=r.coarseCap).length,highRejected:highRejected.map(r=>({rank:r.rank,startIndex:r.startIndex,coarseCost:r.coarseCost,finalCost:r.cost})),baselineChecked,
  totalDiagnosticElapsedMs:performance.now()-start,oraclePolishElapsedMs:oracle.reduce((s,r)=>s+r.elapsedMs,0)};
 save(id,{summary,strategies,table,short,continued,diversity:diversity.rows,settings});guard();console.log('RESULT '+JSON.stringify({summary,strategies}));
}
