import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ComputationClient} from '../src/workers/client';
import type {StartMessage} from '../src/workers/protocol';
import {createSiO2OnSiProject,createMultiAoiSiO2OnSiProject} from '../src/data/defaultProjects';
import {createValidationReport} from '../src/data/validationReport';
import {computeMultiAoiResidualMetrics} from '../src/fitting/residual';
import {inspectCsv} from '../src/data/csvParser';
const results:{name:string;passed:boolean;error?:string}[]=[];
async function test(name:string,fn:()=>unknown){try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:String(e)});}}
class FakeWorker {
  onmessage:((e:unknown)=>void)|null=null;onerror:((e:unknown)=>void)|null=null;onmessageerror:(()=>void)|null=null;
  messages:unknown[]=[];terminated=false;
  postMessage(v:unknown){this.messages.push(v);}terminate(){this.terminated=true;}
  start(){return this.messages.find((m:any)=>m.type==='start') as StartMessage;}
  emit(data:unknown){this.onmessage?.({data});}
}
function fixture(){const workers:FakeWorker[]=[];const client=new ComputationClient(()=>{const w=new FakeWorker();workers.push(w);return w as unknown as Worker;});return {workers,client};}
await test('Worker protocol Start / Progress / Result validates exact job and revision',async()=>{
  const {workers,client}=fixture(),progress:number[]=[];
  const promise=client.start('forward',createSiO2OnSiProject(),7,{onProgress:p=>progress.push(p.currentMse)}),w=workers[0],m=w.start();
  assert.equal(m.operation,'forward');assert.equal(m.protocol,1);assert.equal(m.revision,7);
  w.emit({type:'progress',jobId:m.jobId,revision:6,progress:{currentMse:999}});w.emit({type:'progress',jobId:'old',revision:7,progress:{currentMse:999}});
  w.emit({type:'progress',jobId:m.jobId,revision:7,progress:{currentMse:12}});assert.deepEqual(progress,[12]);
  w.emit({type:'result',jobId:m.jobId,revision:7,result:{project:m.project}});const result=await promise;assert.equal(result.project!.layers[0].thickness,m.project!.layers[0].thickness);assert.equal(w.terminated,true);
});
await test('Cancel posts Cancel / Termination, rejects and destroys worker',async()=>{
  const {workers,client}=fixture(),promise=client.start('automatic',createSiO2OnSiProject(),1).catch(e=>e.name);client.cancel();
  assert.equal(await promise,'AbortError');assert.equal(workers[0].terminated,true);assert.deepEqual(workers[0].messages.slice(1).map((m:any)=>m.type),['cancel','terminate']);assert.equal(client.jobId,null);
});
await test('Replacement cannot accept the obsolete async result',async()=>{
  const {workers,client}=fixture(),one=client.start('expert',createSiO2OnSiProject(),1).catch(e=>e.name),old=workers[0].start();
  const two=client.start('forward',createSiO2OnSiProject(),2),fresh=workers[1].start();
  workers[0].emit({type:'result',jobId:old.jobId,revision:1,result:{report:'stale'}});
  workers[1].emit({type:'result',jobId:fresh.jobId,revision:2,result:{report:'current'}});
  assert.equal(await one,'AbortError');assert.equal((await two).report,'current');
});
await test('Worker exception and message-decode failure surface without losing input',async()=>{
  for(const mode of ['error','decode']) {
    const {workers,client}=fixture(),project=createSiO2OnSiProject(),before=JSON.stringify(project),promise=client.start('expert',project,1).catch(e=>e.message);
    if(mode==='error')workers[0].onerror?.({preventDefault(){},message:'out of memory'});else workers[0].onmessageerror?.();
    assert.match(await promise,/Worker/);assert.equal(JSON.stringify(project),before);assert.equal(workers[0].terminated,true);
  }
});
await test('Structured error response is delivered and worker is disposed',async()=>{
  const {workers,client}=fixture(),p=client.start('automatic',createSiO2OnSiProject(),1).catch(e=>({name:e.name,message:e.message})),m=workers[0].start();
  workers[0].emit({type:'error',jobId:m.jobId,revision:1,error:{name:'DataError',message:'invalid AOI'}});
  assert.deepEqual(await p,{name:'DataError',message:'invalid AOI'});assert.equal(workers[0].terminated,true);
});
await test('Worker input omits candidate history but preserves manual parameter values',()=>{
  const {workers,client}=fixture(),p=createSiO2OnSiProject();p.expert={stage:2,smoothing:.1,records:[],candidates:[{id:'a',name:'saved',stage:2,snapshot:{...p}}]};
  const pending=client.start('expert',p,0).catch(()=>{});assert.equal(workers[0].start().project!.expert!.candidates.length,0);assert.equal(p.expert.candidates.length,1);client.dispose();return pending;
});
await test('Validation Report independently forwards the complete spectrum at full precision',()=>{
  const p=createMultiAoiSiO2OnSiProject();p.layers[0].thickness=87.123456789;
  const r=createValidationReport(p),m=computeMultiAoiResidualMetrics(r.finalComparison,p.fittingConfig.activeFitAois);
  assert.equal(r.version,'2.1.0');assert.equal(r.finalRawMse,m.rawMse);assert.equal(r.finalComparison.length,p.experimentData!.points.length);
  assert.equal(r.filmStack[0].finalThicknessNm,87.123456789);assert.equal(r.filmStack[0].finalNk.length,new Set(p.experimentData!.points.map(p=>p.wavelength)).size);
  assert.equal(r.finalFreshForwardVerified,true);assert.deepEqual(r.substrate,p.substrate);assert.equal(Object.keys(r.individualAoiMse).length,3);
});
await test('CSV preserves full measurement precision and rejects nonfinite inputs without phase loops',()=>{
  const parsed=inspectCsv('Wavelength,Psi,Delta\n450.123456789,30.123456789,155.123456789\n500,31,-10\n550,32,1e20\nInfinity,33,170\n600,Infinity,180');
  assert.equal(parsed.points.length,3);assert.equal(parsed.points[0].wavelength,450.123456789);assert.equal(parsed.points[0].psiExp,30.123456789);assert.equal(parsed.points[0].deltaExp,155.123456789);assert.equal(parsed.points[1].deltaExp,350);assert.ok(parsed.points[2].deltaExp>=0&&parsed.points[2].deltaExp<360);
});
fs.writeFileSync('worker-tests.json',JSON.stringify(results,null,2));console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.passed).length,failures:results.filter(r=>!r.passed)},null,2));if(results.some(r=>!r.passed))process.exitCode=1;
