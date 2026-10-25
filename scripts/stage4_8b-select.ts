import assert from 'node:assert/strict';
export interface Feature {
 setting:{count:number;scale:number;distribution:string;id:string};N:number;p:number;dof:number;
 rawRSS:number;rawMse:number;bic:number;aic:number;status:string;converged:boolean;elapsedMs:number;
}
/** Only these fields cross into a deployable selector; no truth, validation, sigma or weighted metrics. */
export function feature(r:any):Feature {
 const N=r.N,p=r.p,rawRSS=r.metrics.rawMse*N,log=N*Math.log(Math.max(1e-12,rawRSS)/N);
 return {setting:{...r.setting},N,p,dof:r.dof,rawRSS,rawMse:rawRSS/N,bic:log+p*Math.log(N),aic:log+2*p,status:r.status,converged:r.converged,elapsedMs:r.elapsedMs};
}
export const legal=(r:Feature)=>r.setting.count<=r.N/4&&r.dof>0&&r.converged&&r.status==='cost';
export function choose(rule:string,rows:Feature[],stepIds:string[],sparse=false){
 assert.ok(['N0','N1','N2','N3','N4','N5'].includes(rule));
 const baseline=rows.find(r=>r.setting.id===stepIds[0]);assert.ok(baseline);
 const attempts=rule==='N0'?[baseline]:rule==='N5'?rows:stepIds.map(id=>{const r=rows.find(r=>r.setting.id===id);assert.ok(r);return r;}),eligible=attempts.filter(legal),endpoint=attempts.at(-1)!,estimate=rule==='N3'||rule==='N4',variance=endpoint.rawRSS/endpoint.dof,sigmaHat2=estimate&&legal(endpoint)&&variance>0&&Number.isFinite(variance)?variance:null;
 const scores=attempts.map(r=>{const wHat=sigmaHat2===null||r.dof<=0?null:Math.sqrt(r.rawRSS/sigmaHat2/r.dof);return {setting:r.setting.id,legal:legal(r),rawRSS:r.rawRSS,bic:r.bic,aic:r.aic,p:r.p,N:r.N,dof:r.dof,chiHat:sigmaHat2===null?null:r.rawRSS/sigmaHat2,wHat,penalty:.5*r.p/r.N,penalized:wHat===null?null:wHat+.5*r.p/r.N};});
 if(sparse&&!legal(baseline))return {rule,selected:null,fallback:false,reason:'no available candidate; sparse baseline invalid',sigmaUnavailable:estimate&&sigmaHat2===null,sigmaHat2,attempts:attempts.map(r=>r.setting.id),elapsedMs:attempts.reduce((s,r)=>s+r.elapsedMs,0),scores};
 if(estimate&&sigmaHat2===null)return {rule,selected:baseline.setting.id,fallback:true,reason:'sigmaHat unavailable; baseline fallback',sigmaUnavailable:true,sigmaHat2,attempts:attempts.map(r=>r.setting.id),elapsedMs:attempts.reduce((s,r)=>s+r.elapsedMs,0),scores};
 const w=(r:Feature)=>Math.sqrt(r.rawRSS/sigmaHat2!/r.dof);let best:Feature|undefined;
 for(const r of eligible){
  if(!best){best=r;continue;}
  if((rule==='N1'||rule==='N5')&&r.bic<best.bic)best=r;
  if(rule==='N2'&&r.rawRSS<.95*best.rawRSS)best=r;
  if(rule==='N3'&&w(best)-w(r)>.05)best=r;
  if(rule==='N4'&&w(r)+.5*r.p/r.N<w(best)+.5*best.p/best.N)best=r;
 }
 return {rule,selected:best?.setting.id??baseline.setting.id,fallback:!best,reason:best?'selected':'all invalid; baseline fallback',sigmaUnavailable:false,sigmaHat2,attempts:attempts.map(r=>r.setting.id),elapsedMs:attempts.reduce((s,r)=>s+r.elapsedMs,0),scores};
}
export function selfCheck(){
 const ids=['40Ws1','40Ws0.1','40Ws0.01','60Ws0.01','80Ws0.01'],rows:Feature[]=ids.map((id,i)=>({setting:{id,count:i<3?40:i===3?60:80,scale:i===0?1:i===1?.1:.01,distribution:'wavelength'},N:432,p:81,dof:351,rawRSS:[100,95,94,91,90][i],rawMse:[100,95,94,91,90][i]/432,bic:[5,4,3,2,1][i],aic:0,status:'cost',converged:true,elapsedMs:1}));
 assert.equal(choose('N2',rows,ids).selected,'40Ws0.01','exact5% must not update; >5% must update');assert.equal(choose('N1',rows,ids).selected,'80Ws0.01');assert.equal(choose('N5',rows,ids).elapsedMs,5);
 const r:any={setting:rows[0].setting,N:432,p:81,dof:351,status:'cost',converged:true,elapsedMs:1,metrics:{rawMse:1}};
 for(const key of ['mseWoollam','weightedMse','chiSquare'])Object.defineProperty(r.metrics,key,{get(){throw Error('forbidden weighted field');}});
 Object.defineProperty(r,'truth',{get(){throw Error('forbidden truth');}});Object.defineProperty(r,'validation',{get(){throw Error('forbidden validation');}});assert.equal(feature(r).rawRSS,432);
 assert.equal(choose('N3',rows.map((r,i)=>i===4?{...r,status:'step'}:r),ids).selected,'40Ws1');assert.equal(choose('N4',rows.map((r,i)=>i===4?{...r,status:'step'}:r),ids).sigmaUnavailable,true);
 const bad=rows.map(r=>({...r,dof:0}));assert.equal(choose('N1',bad,ids).fallback,true);
 assert.equal(choose('N3',bad,ids,true).selected,null);assert.equal(choose('N3',bad,ids,true).fallback,false);
}
