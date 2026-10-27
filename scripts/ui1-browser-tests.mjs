import fs from 'node:fs';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright';
const out='.qa/ui1';fs.mkdirSync(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:0}});
const url=process.env.UI1_URL||`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
const wait=async()=>{await page.waitForFunction(()=>!document.body.textContent.includes('完整 TMM 重算中'));};
const checks=[];
async function contrastAudit(name) {
 const result=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
  const rgba=c=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=c;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
  const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
  const rows=[];
  for(const e of document.querySelectorAll('.ui1-surface *')) {
   if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden')continue;
   let bg=[255,255,255,1],chain=[];for(let n=e;n;n=n.parentElement)chain.unshift(n);
   for(const n of chain){const c=rgba(getComputedStyle(n).backgroundColor);bg=c.map((v,i)=>i===3?1:v*c[3]+bg[i]*(1-c[3]));}
   const st=getComputedStyle(e),fg=rgba(e instanceof SVGElement?st.fill:st.color),l1=lum(fg),l2=lum(bg),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
   rows.push({text:e.textContent.trim().slice(0,90),ratio:Number(ratio.toFixed(2)),color:st.color,bg});
  }
  return {minimum:Math.min(...rows.map(r=>r.ratio)),failures:rows.filter(r=>r.ratio<4.5),samples:rows.length};
 });
 fs.writeFileSync(`${out}/${name}-contrast.json`,JSON.stringify(result,null,2));assert.deepEqual(result.failures,[]);checks.push({name:`${name} text contrast >= 4.5`,passed:true,minimum:result.minimum});
}

async function layout(name){
 const data=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.ui1-surface *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+2}).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,80)})).slice(0,15)}));
 fs.writeFileSync(`${out}/${name}-layout.json`,JSON.stringify(data,null,2));
 await page.screenshot({path:`${out}/${name}.png`,fullPage:true});assert.ok(data.scroll<=data.width+2,JSON.stringify(data));checks.push({name,passed:true});
}
try{
 await page.goto(url+'/#empty');await wait();
 for(const width of [1440,900,390]){await page.setViewportSize({width,height:1000});await layout(`main-${width}`);await contrastAudit(`main-${width}`);}
 await page.setViewportSize({width:1440,height:1000});
 assert.equal(await page.locator('img[alt="AutoEllipso"]').evaluate(e=>e.complete&&e.naturalWidth>0),true);
 assert.equal((await page.request.get(url+'/logo/autoellipso-icon.png')).status(),200);
 assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'),'/logo/autoellipso-icon.png');
 checks.push({name:'Original logo, favicon response and link',passed:true});
 await page.locator('#btn-import-csv').focus();assert.notEqual(await page.locator('#btn-import-csv').evaluate(e=>getComputedStyle(e).outlineStyle),'none');checks.push({name:'Visible keyboard focus',passed:true});
 await page.locator('#btn-new-project').click();await page.getByRole('button',{name:/100 nm SiO₂.*單角度/}).click();await wait();
 await page.locator('#btn-auto-fit').click();
 await page.locator('#btn-stop-fit').waitFor({state:'visible'});await page.locator('#btn-stop-fit').waitFor({state:'hidden',timeout:240000});
 await page.waitForTimeout(500);
 // The detailed result dialog keeps its existing style; capture the approved summary underneath.
 const close=page.getByRole('button',{name:/關閉/});
 if(await close.count())await close.last().click();
 fs.writeFileSync(`${out}/automatic-summary.txt`,await page.locator('footer').innerText());
 for(const width of [1440,900,390]){await page.setViewportSize({width,height:1000});await layout(`automatic-${width}`);await contrastAudit(`automatic-${width}`);}
 await page.locator('#btn-fitting-strategy').click();await page.locator('.ui1-modal').waitFor();await page.screenshot({path:`${out}/settings-390.png`,fullPage:false});await page.getByRole('button',{name:'關閉',exact:true}).click();
 await page.locator('#btn-import-csv').click();await page.locator('.ui1-modal').waitFor();await page.screenshot({path:`${out}/import-390.png`,fullPage:false});await page.locator('.ui1-modal input[type="file"]').setInputFiles({name:'ui1.csv',mimeType:'text/csv',buffer:Buffer.from('Wavelength,Psi,Delta\n450,30.1234567,155.1234567\n500,31,158\n550,32,160\n600,33,165\n650,34,170')});
 await page.screenshot({path:`${out}/import-mapping-390.png`});
 await page.getByRole('button',{name:/確認並匯入光譜數據/}).click();await wait();
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#btn-save-project').click()]);
 const saved=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(saved.experimentData.points.length,5);assert.equal(saved.experimentData.points[0].psiExp,30.1234567);
 checks.push({name:'CSV mapping/import and project JSON precision',passed:true});
 await page.getByRole('tab',{name:'手動擬合',exact:true}).click();await page.getByRole('region',{name:'Expert fitting controls',exact:true}).waitFor();await page.screenshot({path:`${out}/expert-smoke.png`});await page.getByRole('tab',{name:'自動擬合',exact:true}).click();checks.push({name:'Deferred Expert opens and closes',passed:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:checks.length,url}));
}finally{fs.writeFileSync(`${out}/ui-results.json`,JSON.stringify({url,checks,errors},null,2));await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}

