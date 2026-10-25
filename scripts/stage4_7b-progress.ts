import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {prefix,settings,grid,ladder,read,mean} from './stage4_7b-run';
const files=readdirSync('.qa').filter(f=>f.startsWith('stage4_7b-')&&f.endsWith('.json'));
const load=(f:string)=>JSON.parse(readFileSync('.qa/'+f,'utf8'));
const automatic=files.filter(f=>/^stage4_7b-U\d-4800[123]-automatic\.json$/.test(f)).map(load);
const fits=files.filter(f=>/^stage4_7b-U\d-4800[123]-(40|60|80)Ws[\d.]+\.json$/.test(f)).map(load);
const primary=fits.filter(r=>r.seed===48001),other=fits.filter(r=>r.seed!==48001),decisions=files.filter(f=>/-rules\.json$/.test(f)).map(load);
const historical=JSON.parse(readFileSync('.qa/stage4_7a-execution.json','utf8')).datasets.filter((d:any)=>d.seed<47000&&d.gridName==='full');
const autoMean=mean(automatic.map(r=>r.elapsedMs))??mean(historical.map((d:any)=>d.automaticMs))!;
const fitMean=mean(fits.map(r=>r.elapsedMs))??mean(historical.filter((d:any)=>d.seed===46001).map((d:any)=>d.refinementMs/9))!;
const ids=new Set(fits.map(r=>`${r.id}-${r.seed}-${r.setting.id}`));let fitRemaining=0;
for(const t of settings.truths)for(const seed of settings.selectionSeeds)for(const g of seed===48001?grid:ladder)if(!ids.has(`${t.id}-${seed}-${g.id}`))fitRemaining+=mean(fits.filter(r=>r.setting.id===g.id).map(r=>r.elapsedMs))??fitMean;
const verified=existsSync(prefix+'verification.json'),verifyDone=existsSync(prefix+'verify-timing.json');
const verifyMs=verifyDone?read('verify-timing').elapsedMs:JSON.parse(readFileSync('.qa/stage4_7a-verify-timing.json','utf8')).elapsedMs;
const check=existsSync(prefix+'equivalence.json')?read('equivalence'):null;
const stages=[{stage:0,count:check?.checks.length??0,total:6,seconds:(check?.elapsedMs??0)/1000},
 {stage:1,count:automatic.length,total:21,seconds:automatic.reduce((s,r)=>s+r.elapsedMs/1000,0)},
 {stage:2,count:primary.length,total:63,seconds:primary.reduce((s,r)=>s+r.elapsedMs/1000,0)},
 {stage:3,count:decisions.length*5,total:105,secondaryFits:other.length,secondaryTotal:70,seconds:other.reduce((s,r)=>s+r.elapsedMs/1000,0)+decisions.reduce((s,r)=>s+r.scoringMs/1000,0)},
 {stage:4,count:verifyDone?1:0,total:1,seconds:verifyDone?verifyMs/1000:0}];
console.log(JSON.stringify({stages,remainingSeconds:((21-automatic.length)*autoMean+fitRemaining+(verifyDone?0:verifyMs))/1000,stopped:existsSync(prefix+'stopped.json'),paused:existsSync(prefix+'paused.json'),verified}));
