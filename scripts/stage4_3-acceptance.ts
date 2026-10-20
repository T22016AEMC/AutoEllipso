import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const runs=JSON.parse(readFileSync('stage4_3-runs.json','utf8')).runs;
const results:{name:string;passed:boolean;error?:string}[]=[];
function test(name:string,fn:()=>void){try{fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:String(e)});}}
for(const scenario of ['absorbing','transparent','weak']){
  const r=runs.find((r:any)=>r.key==='timing/'+scenario+'/gaussian/0/41001');
  test(scenario+': MSE_W <= 1.3',()=>assert.ok(r.metrics.mseWoollam<=1.3));
  test(scenario+': thickness error <= 0.2 nm',()=>assert.ok(Math.abs(r.metrics.thickness-100)<=.2));
  test(scenario+': max k error 600–900 nm <= 0.002',()=>assert.ok(r.metrics.maxKError<=.002));
  test(scenario+': max n error 300–900 nm <= 0.003',()=>assert.ok(r.metrics.maxNError<=.003));
  test(scenario+': BIC stage admission/selection/stop',()=>{
    const stages=r.free.stages,executed=stages.filter((s:any)=>!s.skipped),selected=executed.filter((s:any)=>s.selected);
    assert.equal(stages.length,7);assert.equal(selected.length,1);
    assert.equal(selected[0].bic,Math.min(...executed.map((s:any)=>s.bic)));
    executed.forEach((s:any,i:number)=>{assert.ok(s.effectiveParameters<=216);if(i>0){assert.equal(s.deltaBic,executed[i-1].bic-s.bic);if(i<executed.length-1)assert.ok(s.deltaBic>10);}});
    assert.ok(stages.filter((s:any)=>s.skipped).every((s:any)=>s.skipReason));
  });
}
test('original transparent high-wavelength detection assertion',()=>assert.equal(runs.find((r:any)=>r.key==='timing/transparent/gaussian/0/41001').transparentLegacyAssertion,true));
const current=JSON.parse(readFileSync('scientific-tests.json','utf8'));
const previous=JSON.parse(execFileSync('git',['show','46f114b:scientific-tests.json'],{encoding:'utf8'}));
const oldNames=new Set(previous.map((r:any)=>r.name)),regressions=current.filter((r:any)=>oldNames.has(r.name)&&!r.passed);
test('existing 73 tests: no failure except the already known transparent assertion',()=>assert.ok(regressions.every((r:any)=>r.name==='Stage4.1: Automatic transparent k and propagated uncertainty')));
const report={total:results.length,passed:results.filter(r=>r.passed).length,results,
  old73:{total:previous.length,present:current.filter((r:any)=>oldNames.has(r.name)).length,passed:current.filter((r:any)=>oldNames.has(r.name)&&r.passed).length,failures:regressions}};
console.log(JSON.stringify(report,null,2));writeFileSync('stage4_3-acceptance.json',JSON.stringify(report,null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
