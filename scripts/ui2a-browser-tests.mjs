import fs from 'node:fs';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright';
const out='.qa/ui2a';fs.mkdirSync(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:0}});
const url=process.env.UI2A_URL||`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
const disclosure=page.getByRole('button',{name:/色散模型參數/}),fields=page.locator('#model-parameter-fields');
const wait=async()=>{await page.waitForFunction(()=>!document.body.textContent.includes('完整 TMM 重算中'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
async function check(name,fn){await fn();checks.push({name,passed:true});console.log('PASS '+name);}
async function snapshot(name,region=false){await page.mouse.move(0,0);await wait();
 const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(layout.scroll<=layout.width+2,JSON.stringify(layout));
 if(region)await page.locator('#spectra-panel').screenshot({path:`${out}/${name}.png`});else await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
 fs.writeFileSync(`${out}/${name}-layout.json`,JSON.stringify(layout));
}
async function geometry(){return page.locator('.plot-card').evaluateAll(cards=>cards.map(e=>{const r=e.getBoundingClientRect(),svg=e.querySelector('svg'),scale=svg.getScreenCTM().a;return {width:r.width,height:r.height,minLabel:Math.min(...[...svg.querySelectorAll('text')].map(t=>parseFloat(getComputedStyle(t).fontSize)*scale)),minPoint:Math.min(...[...svg.querySelectorAll('circle')].map(c=>parseFloat(getComputedStyle(c).r)*scale))};}));}
async function controls(width){
 const data=await page.locator('.view-control-group').evaluateAll(groups=>groups.map(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {width:r.width,height:r.height,radius:parseFloat(getComputedStyle(e).borderRadius),right:r.right,parentRight:p.right,items:[...e.querySelectorAll('button,label')].map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width}))};}));
 fs.writeFileSync(`${out}/controls-${width}.json`,JSON.stringify(data,null,2));
 assert.equal(data.length,3);for(const g of data){assert.ok(g.right<=g.parentRight+1);assert.ok(g.height<=52||g.radius<=14);for(const item of g.items)assert.ok(item.height>=44&&item.height<=45,JSON.stringify(item));}
}
try {
 await page.goto(url+'/#empty');await wait();
 await check('Dispersion defaults closed, pointer and Enter/Space update aria-expanded; hidden fields skip Tab',async()=>{
  assert.equal(await disclosure.getAttribute('aria-expanded'),'false');assert.equal(await fields.isVisible(),false);
  await disclosure.click();assert.equal(await disclosure.getAttribute('aria-expanded'),'true');assert.ok(await fields.isVisible());
  await disclosure.press('Space');assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#model-parameter-fields')),false);}
  await disclosure.focus();await disclosure.press('Enter');assert.equal(await disclosure.getAttribute('aria-expanded'),'true');await disclosure.click();
 });
 await check('Model regeneration preserves open and closed UI state; JSON remains free of disclosure state',async()=>{
  await disclosure.click();await page.getByRole('combobox',{name:'最終物理光學模型',exact:true}).selectOption('gaussian');await wait();assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
  await disclosure.click();await page.getByRole('combobox',{name:'最終物理光學模型',exact:true}).selectOption('lorentz');await wait();assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
  const [d]=await Promise.all([page.waitForEvent('download'),page.locator('#btn-save-project').click()]);const raw=fs.readFileSync(await d.path(),'utf8');assert.doesNotMatch(raw,/parametersExpanded|model-parameter-fields|parameter-disclosure/);
 });
 await page.reload();await wait();
 for(const width of [1440,900,390]){await page.setViewportSize({width,height:1000});await check(`Empty layout ${width}`,()=>snapshot(`empty-${width}`));}
 await page.setViewportSize({width:1440,height:1000});await page.locator('#btn-new-project').click();await page.getByRole('button',{name:/100 nm SiO₂.*多角度/}).click();await wait();
 await page.locator('#btn-auto-fit').click();await page.locator('#btn-stop-fit').waitFor({state:'visible'});await page.locator('#btn-stop-fit').waitFor({state:'hidden',timeout:360000});
 await page.getByRole('button',{name:'關閉檢視',exact:true}).click();await wait();
 assert.match(await page.locator('footer').innerText(),/fitAdequacy/);
 const [fitted]=await Promise.all([page.waitForEvent('download'),page.locator('#btn-save-project').click()]);fs.copyFileSync(await fitted.path(),`${out}/fitted-project.json`);
 for(const width of [1440,900,390]){
  await page.setViewportSize({width,height:1000});await wait();
  await check(`Collapsed/expanded setup precedes results ${width}`,async()=>{
   assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
   const order=await page.evaluate(()=>['#btn-import-csv','#parameter-panel','#spectra-panel'].map(s=>document.querySelector(s).getBoundingClientRect().top+scrollY));assert.ok(order[0]<order[1]&&order[1]<order[2],JSON.stringify(order));
   await snapshot(`fitted-collapsed-${width}`);await disclosure.click();assert.equal(await disclosure.getAttribute('aria-expanded'),'true');await snapshot(`fitted-expanded-${width}`);await disclosure.click();
  });
  await check(`View controls, order, chart aspect and All/single AOI size stability ${width}`,async()=>{
   const order=await page.locator('#spectra-panel').evaluate(e=>['.view-controls','.plot-tabs','.plot-zoom','.plot-card'].map(s=>e.querySelector(s).getBoundingClientRect().top));assert.ok(order.every((y,i)=>i===0||y>order[i-1]));
   await page.getByRole('button',{name:'All AOIs',exact:true}).click();await snapshot(`all-aois-${width}`,true);await controls(width);const all=await geometry();
   await page.locator('.view-controls').getByRole('button',{name:'65°',exact:true}).click();await snapshot(`single-aoi-${width}`,true);const single=await geometry();
   assert.equal(all.length,4);assert.equal(single.length,4);
   all.forEach((r,i)=>{assert.ok(Math.abs(r.width/r.height-1.6)<.01,JSON.stringify(r));assert.ok(Math.abs(r.width-single[i].width)<1);assert.ok(Math.abs(r.height-single[i].height)<1);assert.ok(r.minLabel>=10.99&&single[i].minLabel>=10.99);assert.ok(r.minPoint>=1.99&&single[i].minPoint>=1.99);});
   const rows=await page.locator('.plot-card').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().top));assert.equal(Math.abs(rows[0]-rows[1])<1,width>=900);
   fs.writeFileSync(`${out}/geometry-${width}.json`,JSON.stringify({all,single},null,2));await page.getByRole('button',{name:'All AOIs',exact:true}).click();
  });
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:checks.length,url}));
} finally {fs.writeFileSync(`${out}/ui-results.json`,JSON.stringify({url,checks,errors},null,2));await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
