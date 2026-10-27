import fs from 'node:fs';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright';
const out='.qa/ui0';fs.mkdirSync(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:0}}),url=process.env.UI0_URL||`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];
await page.addInitScript(()=>{
 window.__ui0Jobs=[];const NativeWorker=window.Worker;
 window.Worker=class extends NativeWorker {
  constructor(...args){super(...args);this.addEventListener('message',({data})=>window.__ui0Jobs.push({direction:'in',type:data.type,jobId:data.jobId,operation:data.operation}));}
  postMessage(data,...args){window.__ui0Jobs.push({direction:'out',type:data.type,jobId:data.jobId,operation:data.operation});return super.postMessage(data,...args);}
 };
});
page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
const auto=page.getByRole('tab',{name:'自動擬合',exact:true}),manual=page.getByRole('tab',{name:'手動擬合',exact:true});
const manualPanel=page.getByRole('tabpanel',{name:'手動擬合',exact:true}),autoPanel=page.getByRole('tabpanel',{name:'自動擬合',exact:true});
const wait=async()=>{await page.waitForFunction(()=>!document.body.textContent.includes('完整 TMM 重算中'),null,{timeout:60000});};
async function check(name,fn){await fn();checks.push({name,passed:true});console.log('PASS '+name);}
async function saved(){const[d]=await Promise.all([page.waitForEvent('download'),page.locator('#btn-save-project').click()]);return JSON.parse(fs.readFileSync(await d.path(),'utf8'));}
async function screenshot(name){await page.mouse.move(0,0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:`${out}/${name}.png`,fullPage:true});}
async function hiddenFocus(id){
 const targets=page.locator(`#${id} button,#${id} input,#${id} select,#${id} a`);assert.ok(await targets.count());
 assert.equal(await targets.evaluateAll(es=>es.some(e=>e.getClientRects().length>0)),false);
 await targets.first().evaluate(e=>e.focus());assert.equal(await page.evaluate(id=>!!document.activeElement.closest('#'+id),id),false);
 await (id==='manual-mode-panel'?auto:manual).focus();
 for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(id=>!!document.activeElement.closest('#'+id),id),false);}
}
async function assertJob(operation,id){const jobs=await page.evaluate(()=>window.__ui0Jobs);fs.writeFileSync(`${out}/${operation}-jobs.json`,JSON.stringify(jobs,null,2));assert.equal(jobs.filter(j=>j.direction==='out'&&j.type==='start'&&j.jobId===id).length,1);assert.ok(jobs.some(j=>j.direction==='in'&&j.type==='result'&&j.jobId===id));assert.equal(jobs.filter(j=>j.jobId===id&&['cancel','cancelled','error'].includes(j.type)).length,0);}
try {
 await page.goto(url+'/#empty');await wait();
 await check('Default automatic mode, ARIA tabs, arrow keys and Enter/Space',async()=>{
  assert.equal(await auto.getAttribute('aria-selected'),'true');assert.ok(await autoPanel.isVisible());
  await auto.focus();await auto.press('ArrowRight');await page.getByRole('region',{name:'Expert fitting controls',exact:true}).waitFor();assert.equal(await manual.getAttribute('aria-selected'),'true');assert.ok(await manualPanel.isVisible());assert.equal(await autoPanel.isVisible(),false);
  await manual.press('ArrowLeft');assert.equal(await auto.getAttribute('aria-selected'),'true');await manual.focus();await manual.press('Enter');assert.ok(await manualPanel.isVisible());await auto.focus();await auto.press('Space');assert.ok(await autoPanel.isVisible());
 });
 await check('Hidden panels are excluded from focus; retained report/clear controls; removed legacy entries',async()=>{
  await hiddenFocus('manual-mode-panel');await manual.click();await hiddenFocus('automatic-mode-panel');await auto.click();
  assert.equal(await page.getByRole('button',{name:'手動計算',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Close Expert',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Expert Fitting Mode',exact:true}).count(),0);
  assert.equal(await page.locator('.expert-panel').innerText().then(t=>/AutoEllipso V/.test(t)),false);
  for(const tab of [manual,auto]){await tab.click();assert.ok(await page.getByRole('button',{name:'Download Validation Report',exact:true}).isVisible());assert.ok(await page.getByRole('button',{name:'清除本分頁資料',exact:true}).isVisible());}
 });
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await screenshot(`automatic-empty-${width}`);}
 await page.setViewportSize({width:1440,height:1000});await page.locator('#btn-new-project').click();await page.getByRole('button',{name:/100 nm SiO₂.*多角度/}).click();await wait();
 await check('Automatic Worker survives mode switches, shared progress remains visible and output is fresh',async()=>{
  await page.evaluate(()=>{document.getElementById('btn-auto-fit').click();document.getElementById('manual-mode-tab').click();});assert.equal(await manual.getAttribute('aria-selected'),'true');
  await page.getByRole('status',{name:'自動擬合進度',exact:true}).waitFor();await auto.click();await manual.click();
  const id=await page.evaluate(()=>window.__ui0Jobs.findLast(j=>j.direction==='out'&&j.type==='start'&&j.operation==='automatic').jobId);
  await page.getByRole('button',{name:'關閉檢視',exact:true}).waitFor({timeout:360000});await page.getByRole('button',{name:'關閉檢視',exact:true}).click();await assertJob('automatic',id);
  const p=await saved();assert.equal(p.fittingResult.freshCalculationVerified,true);assert.ok(Number.isFinite(p.fittingResult.rawMse));assert.equal(p.experimentData.points.length,216);fs.writeFileSync(`${out}/automatic-project.json`,JSON.stringify(p));
 });
 await check('Automatic project, fit AOIs, chart AOI and result/status survive round-trip switching',async()=>{
  await auto.click();await page.locator('.view-controls').getByRole('button',{name:'65°',exact:true}).click();const before=await saved(),status=await page.locator('footer').innerText(),workflow=await page.getByRole('status',{name:'自動擬合進度',exact:true}).innerText();
  await manual.click();await auto.click();assert.deepEqual(await saved(),before);assert.equal(await page.locator('footer').innerText(),status);assert.equal(await page.getByRole('status',{name:'自動擬合進度',exact:true}).innerText(),workflow);
  assert.equal(await page.locator('.view-controls').getByRole('button',{name:'65°',exact:true}).getAttribute('aria-pressed'),'true');
 });
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await screenshot(`automatic-fitted-${width}`);}
 await page.setViewportSize({width:1440,height:1000});await manual.click();
 await check('Manual thickness Undo/Redo, candidates, current Stage and display AOI survive switching',async()=>{
  await page.getByRole('button',{name:'Stage 2: B-spline / Peak Editor',exact:true}).click();await page.getByRole('combobox',{name:'Display AOI',exact:true}).selectOption('75');
  const input=page.getByRole('spinbutton',{name:'Expert thickness',exact:true}),before=Number(await input.inputValue());await input.fill(String(before+.25));await input.blur();await wait();
  await page.getByRole('textbox',{name:'Candidate name',exact:true}).fill('UI0 retained');await page.getByRole('button',{name:'Save Candidate',exact:true}).click();
  await auto.click();await manual.click();assert.equal(await page.getByRole('combobox',{name:'Display AOI',exact:true}).inputValue(),'75');assert.ok(await page.getByRole('button',{name:'Run Stage 2',exact:true}).isVisible());assert.ok(await page.getByRole('button',{name:'Restore UI0 retained (S2)',exact:true}).isVisible());
  await page.getByRole('button',{name:'Undo',exact:true}).click();await wait();assert.equal(Number(await input.inputValue()),before);await page.getByRole('button',{name:'Redo',exact:true}).click();await wait();assert.equal(Number(await input.inputValue()),before+.25);
  const p=await saved();assert.equal(p.expert.stage,2);assert.ok(p.expert.candidates.some(c=>c.name==='UI0 retained'));assert.equal('mode' in p,false);assert.equal('manualVisited' in p,false);
 });
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await screenshot(`manual-${width}`);}
 await check('Toolbar order and phone wrapping with >=44px mode targets',async()=>{
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const r=await page.locator('.toolbar-fitting-controls').evaluate(e=>{const rect=s=>{const r=e.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};return {tabs:rect('.fitting-mode-tabs'),settings:rect('#btn-fitting-strategy'),library:rect('#btn-model-library'),tests:rect('#btn-unit-tests'),right:e.getBoundingClientRect().right};});
   assert.ok(r.tests.x>r.library.x);assert.ok(Math.abs(r.tests.right-r.right)<2);if(width<900)assert.ok(r.tabs.y+r.tabs.height<=r.settings.y);else assert.ok(r.tabs.x+r.tabs.width<=r.settings.x);assert.ok((await auto.boundingBox()).height>=44);assert.ok((await manual.boundingBox()).height>=44);fs.writeFileSync(`${out}/toolbar-${width}.json`,JSON.stringify(r));}
 });
 await check('Expert Worker survives switching back to automatic and keeps locked parameters',async()=>{
  await page.setViewportSize({width:1440,height:1000});const fixture=JSON.parse(fs.readFileSync('.qa/worker-fixtures.json','utf8')).spline;
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:'expert-job.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await wait();await manual.click();
  await page.evaluate(()=>{[...document.querySelectorAll('#manual-mode-panel button')].find(b=>b.textContent==='Run Stage 2').click();document.getElementById('automatic-mode-tab').click();});
  await page.getByRole('status',{name:'手動擬合進度',exact:true}).waitFor();await manual.click();await auto.click();
  const id=await page.evaluate(()=>window.__ui0Jobs.findLast(j=>j.direction==='out'&&j.type==='start'&&j.operation==='expert').jobId);
  await page.waitForFunction(id=>window.__ui0Jobs.some(j=>j.direction==='in'&&j.type==='result'&&j.jobId===id),id,{timeout:180000});await assertJob('expert',id);
  const p=await saved();assert.equal(p.fittingResult.freshCalculationVerified,true);assert.equal(p.layers[0].thickness,fixture.layers[0].thickness);assert.equal(p.layers[0].parameters.N0.current,fixture.layers[0].parameters.N0.current);
  await manual.click();
  const names=['N0','N2','N3','K3','Expert thickness'];
  const readParameters=async()=>Object.fromEntries(await Promise.all(names.map(async name=>[name,Number(await page.getByRole('spinbutton',{name,exact:true}).inputValue())])));
  const before=await readParameters();await auto.click();await manual.click();const after=await readParameters();
  for(const name of names)assert.ok(Math.abs(after[name]-before[name])<1e-12,`${name} changed during mode switch`);
  const n3=page.getByRole('spinbutton',{name:'N3',exact:true});await n3.fill('1.8');await n3.blur();await wait();
  assert.ok(Math.abs(Number(await n3.inputValue())-1.8)<1e-12);
  await auto.click();await manual.click();assert.ok(Math.abs(Number(await n3.inputValue())-1.8)<1e-12);
  fs.writeFileSync(`${out}/expert-retention-values.json`,JSON.stringify({before,after,tolerance:1e-12,manualN3AfterRoundTrip:Number(await n3.inputValue())},null,2));
 });
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:checks.length,url}));
}finally{fs.writeFileSync(`${out}/ui-results.json`,JSON.stringify({url,checks,errors},null,2));await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
