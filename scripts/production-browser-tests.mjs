import {writeQaFileSync,readQaFileSync} from './qa-files.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {preview} from 'vite';
const require=createRequire(import.meta.url);
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.playwright');
let pw;try{pw=require('playwright');}catch{pw=createRequire('C:/Users/T22016/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');}
const tls=fs.existsSync('.qa/test-cert.pem')?{cert:readQaFileSync('.qa/test-cert.pem'),key:readQaFileSync('.qa/test-key.pem')}:undefined;
const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:true,https:tls}});
const url=`${tls?'https':'http'}://127.0.0.1:${server.httpServer.address().port}`;
const fixtures=JSON.parse(readQaFileSync('.qa/worker-fixtures.json','utf8'));
const workerFile=fs.readdirSync('dist/assets').find(x=>/^compute\.worker-.*\.js$/.test(x));assert.ok(workerFile,'Production must include a real module worker');
fs.mkdirSync('.qa/test-results',{recursive:true});
const results=[];
let activePage;
async function check(engine,name,fn){const start=Date.now();try{await fn();results.push({engine,name,passed:true,ms:Date.now()-start});console.log(engine+': PASS '+name);}catch(e){
  const alerts=activePage?await activePage.getByRole('alert').allTextContents().catch(()=>[]):[];
  results.push({engine,name,passed:false,error:String(e),alerts,ms:Date.now()-start});console.log(engine+': FAIL '+name+' '+String(e)+' '+JSON.stringify(alerts));
  if(activePage)await activePage.screenshot({path:`.qa/test-results/${engine}-failure.png`,fullPage:true}).catch(()=>{});
}}
const waitForward=async page=>{await page.waitForFunction(()=>!document.body.textContent.includes('完整 TMM 重算中'),null,{timeout:60000});};
const value=async(page,label)=>Number(await page.getByRole('spinbutton',{name:label,exact:true}).inputValue());
async function fill(page,label,value){await page.getByRole('spinbutton',{name:label,exact:true}).fill(String(value));await page.getByRole('spinbutton',{name:label,exact:true}).blur();}
async function saveProject(page){const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#btn-save-project').click()]);return JSON.parse(readQaFileSync(await download.path(),'utf8'));}
async function importProject(page,project){await page.locator('#btn-open-project').click();await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.waitForTimeout(250);await waitForward(page);}
async function callWorker(page,operation,project,options={}) {
  return page.evaluate(({workerFile,operation,project,options})=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('/assets/'+workerFile,location.href),{type:'module'}),jobId=crypto.randomUUID(),revision=41,events=[];
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Worker timeout'));},120000);
    worker.onerror=e=>{e.preventDefault();clearTimeout(timer);worker.terminate();reject(new Error(e.message));};
    worker.onmessage=({data})=>{events.push(data);if(data.type==='result'||data.type==='error'||data.type==='cancelled'){clearTimeout(timer);worker.terminate();resolve({events,result:data.result,error:data.error,type:data.type});}};
    worker.postMessage({type:'start',protocol:1,jobId,revision,operation,project,...options});
  }),{workerFile,operation,project,options});
}
const engines=(process.env.QA_ENGINES||'edge,firefox,webkit').split(',');
for(const engine of engines) {
  let browser;
  try {browser=await (engine==='edge'?pw.chromium.launch({headless:true,channel:'msedge'}):pw[engine].launch({headless:true}));}
  catch(e){results.push({engine,name:'Browser launch',passed:false,unavailable:true,error:String(e)});continue;}
  const context=await browser.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true}),page=await context.newPage();
  activePage=page;
  const errors=[],network=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>network.push({url:r.url(),method:r.method(),type:r.resourceType()}));
  const failedRequests=[];page.on('requestfailed',r=>failedRequests.push({url:r.url(),failure:r.failure(),type:r.resourceType()}));
  await check(engine,'Production HTTPS, version and deep-link refresh',async()=>{
    const response=await page.goto(url+'/validation/direct-link');assert.equal(response.status(),200);assert.ok(response.headers()['content-security-policy'].includes("connect-src 'none'"));
    await page.getByRole('button',{name:'Expert Fitting Mode',exact:true}).waitFor();await waitForward(page);assert.ok((await page.locator('h1').innerText()).includes('2.1.0'));
    await page.reload();await page.getByRole('button',{name:'Expert Fitting Mode',exact:true}).waitFor();await waitForward(page);assert.equal(new URL(page.url()).protocol,tls?'https:':'http:');
  });
  await check(engine,'Real module-worker Forward equals core TMM point-for-point',async()=>{
    const out=await callWorker(page,'forward',fixtures.spline);assert.equal(out.type,'result');
    assert.equal(out.result.project.experimentData.points.length,fixtures.expectedForward.length);
    out.result.project.experimentData.points.forEach((p,i)=>{const expected=fixtures.expectedForward[i];for(const key of ['wavelength','aoi','psiExp','deltaExp'])assert.equal(p[key],expected[key]);for(const key of ['psiCalc','deltaCalc','psiResidual','deltaResidual'])assert.ok(Math.abs(p[key]-expected[key])<1e-9,key+' cross-engine tolerance');});
    assert.equal(out.events[0].type,'started');
  });
  await check(engine,'Real worker multi-AOI expert fit restores edited B-spline parameter',async()=>{
    const out=await callWorker(page,'expert',fixtures.spline,{stage:2,layerIndex:0});assert.equal(out.type,'result');assert.ok(Math.abs(out.result.project.layers[0].parameters.N3.current-1.8)<1e-3);
    assert.equal(out.result.project.fittingResult.fittingMode,'multi_aoi');assert.equal(out.result.project.fittingResult.freshCalculationVerified,true);assert.ok(out.events.some(e=>e.type==='progress'));
  });
  await check(engine,'Real worker automatic fitting and final full-spectrum verification',async()=>{
    const out=await callWorker(page,'automatic',fixtures.project);assert.equal(out.type,'result');assert.equal(out.result.project.experimentData.points.length,fixtures.project.experimentData.points.length);
    assert.equal(out.result.project.fittingResult.freshCalculationVerified,true);assert.ok(out.events.some(e=>e.type==='progress'));
  });
  await check(engine,'Real worker physical mixed-model handoff retains locked peak types',async()=>{
    const out=await callWorker(page,'expert',fixtures.mixed,{stage:3,layerIndex:0});assert.equal(out.type,'result');assert.equal(out.result.project.layers[0].parameters.p0_type.current,1);assert.equal(out.result.project.layers[0].parameters.p1_type.current,3);assert.equal(out.result.project.layers[0].parameters.p0_A.fit,false);
  });
  await check(engine,'Worker Error / cooperative Cancel / Termination protocol',async()=>{
    const invalid=await callWorker(page,'expert',undefined,{stage:2});assert.equal(invalid.type,'error');assert.match(invalid.error.message,/Missing project/);
    const cancelled=await page.evaluate(({workerFile,project})=>new Promise((resolve,reject)=>{
      const w=new Worker(new URL('/assets/'+workerFile,location.href),{type:'module'}),id=crypto.randomUUID(),timer=setTimeout(()=>{w.terminate();reject(new Error('Cancel timeout'));},90000);
      w.onmessage=({data})=>{if(data.type==='started')w.postMessage({type:'cancel',jobId:id});if(['cancelled','result','error'].includes(data.type)){clearTimeout(timer);w.postMessage({type:'terminate'});w.terminate();resolve(data.type);}};
      w.postMessage({type:'start',protocol:1,jobId:id,revision:1,operation:'automatic',project});
    }),{workerFile,project:fixtures.project});assert.equal(cancelled,'cancelled');
  });
  await check(engine,'UI Cancel stays responsive and manual edits remain current',async()=>{
    await page.locator('#btn-auto-fit').click();const started=Date.now();await page.locator('#btn-stop-fit').click();
    await page.locator('#btn-auto-fit').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('btn-auto-fit').disabled,null,{timeout:5000});assert.ok(Date.now()-started<5000);
    await page.getByRole('button',{name:'Expert Fitting Mode',exact:true}).click();await page.getByRole('button',{name:'Stage 2: B-spline / Peak Editor',exact:true}).click();await page.getByRole('button',{name:'Initialize n/k B-spline from Current Model',exact:true}).click();
    await waitForward(page);const n=await value(page,'N3');await fill(page,'N3',n+.11);await waitForward(page);assert.ok(Math.abs(await value(page,'N3')-n-.11)<1e-12);
    await page.getByRole('button',{name:'Close Expert',exact:true}).click();
  });
  await check(engine,'Duplicate start and new input invalidate the obsolete UI job',async()=>{
    const close=page.getByRole('button',{name:'Close Expert',exact:true});if(await close.isVisible())await close.click();
    const replacement=structuredClone(fixtures.project);replacement.layers[0].thickness=77.777;replacement.layers[0].thicknessInitial=77.777;
    await page.locator('#btn-auto-fit').evaluate(button=>{button.click();button.click();});
    await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:'replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replacement))});
    await page.waitForTimeout(300);await waitForward(page);await page.waitForTimeout(500);
    const saved=await saveProject(page);assert.equal(saved.layers[0].thickness,77.777);assert.equal(saved.layers[0].modelId,'cauchy');
  });
  await check(engine,'CSV browser import and Validation Report / CSV / project download',async()=>{
    const close=page.getByRole('button',{name:'Close Expert',exact:true});if(await close.isVisible())await close.click();
    await page.locator('#btn-import-csv').click();await page.locator('input[type="file"]').last().setInputFiles({name:'measurement-private.csv',mimeType:'text/csv',buffer:Buffer.from('Wavelength,Psi,Delta\n450,30.1234567,155.1234567\n500,31.1234567,158.1234567\n550,32.1234567,160.1234567\n600,33.1234567,165.1234567\n650,34.1234567,170.1234567')});
    await page.getByRole('button',{name:/確認並匯入光譜數據/}).click();await waitForward(page);
    const [d]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download Validation Report',exact:true}).click()]);const report=JSON.parse(readQaFileSync(await d.path(),'utf8'));
    assert.equal(report.version,'2.1.0');assert.equal(report.finalComparison.length,5);assert.equal(report.finalComparison[0].psiExp,30.1234567);assert.ok(report.finalFreshForwardVerified);assert.ok(Number.isFinite(report.finalRawMse));assert.equal(report.filmStack[0].finalNk.length,5);
    const saved=await saveProject(page);assert.equal(saved.experimentData.points.length,5);
    await page.locator('#btn-export-menu').click();const [csv]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/AutoEllipso_fitted_curve.csv/}).click()]);const text=readQaFileSync(await csv.path(),'utf8');assert.equal(text.trim().split('\n').length,6);
  });
  await check(engine,'Independent tabs and browser sessions; no stored or uploaded experimental data',async()=>{
    const saved=await saveProject(page),other=await context.newPage();await other.goto(url);await waitForward(other);const clean=await saveProject(other);assert.notEqual(clean.experimentData.points.length,saved.experimentData.points.length);
    const isolated=await browser.newContext({ignoreHTTPSErrors:true});const third=await isolated.newPage();await third.goto(url);await waitForward(third);const untouched=await saveProject(third);assert.equal(untouched.experimentData.points.length,clean.experimentData.points.length);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(await page.evaluate(async()=>await indexedDB.databases()),[]);await other.close();await isolated.close();
    assert.ok(network.every(r=>r.method==='GET'&&new URL(r.url).origin===new URL(url).origin),JSON.stringify(network.filter(r=>r.method!=='GET'||new URL(r.url).origin!==new URL(url).origin)));
  });
  await check(engine,'Wide production layout and real wavelength zoom',async()=>{
    await page.getByRole('button',{name:'Zoom wavelength in',exact:true}).click();assert.ok((await page.locator('#spectra-panel').innerText()).includes('1.50×'));
    await page.getByRole('button',{name:'Reset wavelength zoom',exact:true}).click();assert.ok((await page.locator('#spectra-panel').innerText()).includes('1.00×'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[],JSON.stringify(failedRequests));await page.screenshot({path:`.qa/test-results/${engine}-desktop.png`,fullPage:true});
  });
  for(const device of [{name:'phone',width:390,height:844},{name:'tablet',width:820,height:1180}]) {
    await check(engine,`Responsive ${device.name}: all scientific controls and touch-style pointer edit`,async()=>{
      const mobile=await browser.newContext({viewport:{width:device.width,height:device.height},hasTouch:true,ignoreHTTPSErrors:true}),p=await mobile.newPage();
      const mobileErrors=[];p.on('pageerror',e=>mobileErrors.push(String(e)));await p.goto(url);await waitForward(p);
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await p.getByRole('button',{name:'Expert Fitting Mode',exact:true}).click();
      await p.getByRole('button',{name:'Stage 2: B-spline / Peak Editor',exact:true}).click();await p.getByRole('button',{name:'Initialize n/k B-spline from Current Model',exact:true}).click();await waitForward(p);
      const control=p.getByTestId('control-N3');
      try {await control.waitFor({state:'attached',timeout:5000});}
      catch(e){await p.screenshot({path:`.qa/test-results/${engine}-${device.name}-failure.png`,fullPage:false});console.log('MOBILE STATE '+engine+' '+JSON.stringify({text:(await p.getByRole('dialog').innerText()).slice(0,2800),inputs:await p.getByRole('spinbutton').evaluateAll(xs=>xs.map(x=>({label:x.getAttribute('aria-label'),value:x.value})).slice(0,12))}));throw e;}
      await control.scrollIntoViewIfNeeded();const before=await value(p,'N3');
      if(engine==='edge') {
        const box=await control.boundingBox(),cdp=await mobile.newCDPSession(p),x=box.x+box.width/2,y=box.y+box.height/2;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-12}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
      } else await control.evaluate(el=>{
        const svg=el.ownerSVGElement,m=svg.getScreenCTM(),point=svg.createSVGPoint();point.x=Number(el.getAttribute('cx'));point.y=Number(el.getAttribute('cy'));const pos=point.matrixTransform(m);
        el.dispatchEvent(new PointerEvent('pointerdown',{pointerId:17,pointerType:'touch',clientX:pos.x,clientY:pos.y,bubbles:true}));
        svg.dispatchEvent(new PointerEvent('pointermove',{pointerId:17,pointerType:'touch',clientX:pos.x,clientY:pos.y-12,bubbles:true}));svg.dispatchEvent(new PointerEvent('pointerup',{pointerId:17,pointerType:'touch',clientX:pos.x,clientY:pos.y-12,bubbles:true}));
      });
      await waitForward(p);assert.ok(await value(p,'N3')>before);await p.getByRole('checkbox',{name:'N3 unlocked',exact:true}).uncheck();assert.ok(await p.getByRole('spinbutton',{name:'N3',exact:true}).isDisabled());
      await p.getByRole('button',{name:'Initialize Physical Peak Builder',exact:true}).click();await p.getByRole('combobox',{name:'Peak type',exact:true}).selectOption('2');await p.getByRole('button',{name:'Add Peak',exact:true}).click();await waitForward(p);assert.equal(await value(p,'p0_Eg'),1);
      await p.getByRole('button',{name:'Continue to Next Stage',exact:true}).click();assert.equal(await value(p,'p0_Eg'),1);assert.deepEqual(mobileErrors,[]);
      await p.screenshot({path:`.qa/test-results/${engine}-${device.name}.png`,fullPage:false});await mobile.close();
    });
  }
  await context.close();await browser.close();
}
await new Promise(resolve=>server.httpServer.close(resolve));
writeQaFileSync('browser-production-results.json',JSON.stringify({productionOnly:true,https:!!tls,selfSignedLocalQa:!!tls,url,results},null,2));
const passed=results.filter(r=>r.passed).length;console.log(JSON.stringify({total:results.length,passed,failures:results.filter(r=>!r.passed)},null,2));if(passed!==results.length)process.exitCode=1;
