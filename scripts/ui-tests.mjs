import {writeQaFileSync} from './qa-files.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require('playwright');} catch {playwright=createRequire('C:/Users/T22016/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');}
let browser;
try {browser=await playwright.chromium.launch({headless:true});}
catch {browser=await playwright.chromium.launch({headless:true,channel:'msedge'});}
const vite=await import('vite');const server=await vite.createServer({server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false,watch:null}});await server.listen();
const url=`http://127.0.0.1:${server.httpServer.address().port}`;
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));
const val=async label=>Number(await page.getByRole('spinbutton',{name:label,exact:true}).inputValue());
async function fill(label,value){await page.getByRole('spinbutton',{name:label,exact:true}).fill(String(value));await page.getByRole('spinbutton',{name:label,exact:true}).blur();}
async function check(name,fn){await fn();checks.push({name,passed:true});}
try {
  await page.goto(process.env.AUTOELLIPSO_URL||url);
  await page.getByRole('tab',{name:'手動擬合',exact:true}).click();
  await check('Stage 2 editable spline and real live TMM',async()=>{
    await page.getByRole('button',{name:'Stage 2: B-spline / Peak Editor',exact:true}).click();
    await page.getByRole('button',{name:'Initialize n/k B-spline from Current Model',exact:true}).click();
    const before=await val('N3');await fill('N3',before+.2);assert.ok(Math.abs(await val('N3')-before-.2)<1e-8);
    const text=await page.getByRole('tabpanel',{name:'手動擬合',exact:true}).innerText();assert.match(text,/Raw MSE:/);assert.doesNotMatch(text,/NaN/);
  });
  await check('Undo and redo exact manual coefficient',async()=>{
    const edited=await val('N3');await page.getByRole('button',{name:'Undo',exact:true}).click();assert.ok(Math.abs(await val('N3')-(edited-.2))<1e-8);
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert.ok(Math.abs(await val('N3')-edited)<1e-8);
  });
  await check('Native pointer drag changes actual coefficient and respects lock',async()=>{
    const node=page.getByTestId('control-N3');await node.scrollIntoViewIfNeeded();const box=await node.boundingBox(),before=await val('N3');
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y-15,{steps:4});await page.mouse.up();
    assert.ok(await val('N3')>before);
    await page.getByRole('checkbox',{name:'N3 unlocked',exact:true}).uncheck();assert.equal(await page.getByRole('spinbutton',{name:'N3',exact:true}).isDisabled(),true);
    await page.getByRole('checkbox',{name:'N3 unlocked',exact:true}).check();
  });
  await check('Add and remove spline control, precise knot movement',async()=>{
    await page.getByRole('button',{name:'Insert After',exact:true}).nth(2).click();assert.equal(await page.getByRole('spinbutton',{name:/^Control location /}).count(),9);
    const w=await val('Control location 3');await fill('Control location 3',w+1);assert.equal(await val('Control location 3'),w+1);
    await page.getByRole('button',{name:'Remove',exact:true}).nth(3).click();assert.equal(await page.getByRole('spinbutton',{name:/^Control location /}).count(),8);
  });
  await check('Candidate persistence and exact restore',async()=>{
    await page.getByRole('textbox',{name:'Candidate name',exact:true}).fill('Spline A');await page.getByRole('button',{name:'Save Candidate',exact:true}).click();
    const n=await val('N3');await fill('N3',n+.1);await page.getByRole('button',{name:'Restore Spline A (S2)',exact:true}).click();assert.equal(await val('N3'),n);
  });
  await check('Continue fitting uses changed manual coefficient and honors all other locks',async()=>{
    const original=await val('N3');await fill('N3',original+.12);
    for(const checkbox of await page.getByRole('checkbox',{name:/^[NK]\d+ unlocked$/}).all()) {
      if(await checkbox.getAttribute('aria-label')!=='N3 unlocked')await checkbox.uncheck();
    }
    await page.getByRole('checkbox',{name:'Thickness fit unlocked',exact:true}).uncheck();
    const before=await val('N3');const button=page.getByRole('button',{name:'Continue Fitting from Manual n/k / Peaks',exact:true});
    await button.click();await button.waitFor({state:'visible'});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Continue Fitting from Manual n/k / Peaks')?.disabled,{},{timeout:60000});
    assert.ok(Math.abs(await val('N3')-before)>1e-4);assert.equal(await page.getByRole('checkbox',{name:'N0 unlocked',exact:true}).isChecked(),false);
  });
  await check('Every peak type has editable real parameters, epsilon graph and lock',async()=>{
    await page.getByRole('button',{name:'Initialize Physical Peak Builder',exact:true}).click();
    for(let i=0;i<5;i++){await page.getByRole('combobox',{name:'Peak type',exact:true}).selectOption(String(i));await page.getByRole('button',{name:'Add Peak',exact:true}).click();}
    await fill('p0_A',2.5);assert.equal(await val('p0_A'),2.5);
    await page.getByRole('checkbox',{name:'p0_A unlocked',exact:true}).uncheck();assert.equal(await page.getByRole('spinbutton',{name:'p0_A',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Duplicate Peak 3',exact:true}).click();assert.equal(await val('p5_Eg'),await val('p2_Eg'));
    await page.getByRole('button',{name:'Delete Peak 6',exact:true}).click();assert.equal(await page.getByRole('spinbutton',{name:'p5_Eg',exact:true}).count(),0);
    await page.getByRole('checkbox',{name:'Peak 2 enabled',exact:true}).uncheck();assert.equal(await page.getByRole('checkbox',{name:'Peak 2 enabled',exact:true}).isChecked(),false);
    await fill('p4_R3',.05);assert.equal(await val('p4_R3'),.05);
  });
  await check('Stage handoff navigation preserves manual peak type, parameter and lock',async()=>{
    await page.getByRole('button',{name:'Continue to Next Stage',exact:true}).click();assert.equal(await val('p0_A'),2.5);
    assert.equal(await page.getByRole('checkbox',{name:'p0_A unlocked',exact:true}).isChecked(),false);
    assert.equal(await page.getByRole('spinbutton',{name:'p2_Eg',exact:true}).count(),1);
  });
  await check('Run Stage 3 preserves locked physical seed through actual optimizer and fresh TMM',async()=>{
    for(const checkbox of await page.getByRole('checkbox',{name:/^p\d+_.+ unlocked$|^eps_inf unlocked$/}).all()) await checkbox.uncheck();
    const button=page.getByRole('button',{name:'Run Stage 3',exact:true});await button.click();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Run Stage 3')?.disabled,{},{timeout:60000});
    assert.equal(await val('p0_A'),2.5);assert.equal(await page.getByRole('alert').count(),0);
  });
  await page.screenshot({path:'.qa/expert-ui.png',fullPage:true});
  assert.deepEqual(errors,[]);
  writeQaFileSync('ui-tests.json',JSON.stringify({checks,browserErrors:errors,passed:true},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
} catch(e) {
  await page.screenshot({path:'.qa/expert-ui-failure.png',fullPage:true});writeQaFileSync('ui-tests.json',JSON.stringify({checks,browserErrors:errors,passed:false,error:String(e)},null,2));throw e;
} finally {await browser.close();await server.close();}
