import {existsSync,readdirSync,readFileSync} from 'node:fs';
const prefix='.qa/stage4_7a-',read=(s:string)=>JSON.parse(readFileSync(prefix+s+'.json','utf8'));
const settings=read('settings'),files=readdirSync('.qa').filter(f=>f.startsWith('stage4_7a-')&&f.endsWith('-dataset.json'));
const datasets=files.map(f=>JSON.parse(readFileSync('.qa/'+f,'utf8')));
const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const full=datasets.filter(d=>d.gridName==='full'&&d.seed<47000),sparse=datasets.filter(d=>d.gridName!=='full'&&d.seed===46001),calibration=datasets.filter(d=>d.seed>=47000);
const primary=full.filter(d=>d.seed===46001),other=full.filter(d=>d.seed!==46001);
const automatic=settings.truths.filter((t:any)=>existsSync(prefix+t.id+'-46001-full-automatic.json')).map((t:any)=>read(t.id+'-46001-full-automatic'));
const cost=(d:any)=>d.automaticMs+d.refinementMs;
const globalMean=mean(datasets.map(cost)),estimate=(id:string,g:string)=>{
 const same=calibration.filter(d=>d.id===id&&d.gridName===g),sameTruthGrid=datasets.filter(d=>d.id===id&&d.gridName===g&&(g!=='full'||d.seed!==46001)),sameGrid=datasets.filter(d=>d.gridName===g),sameTruth=datasets.filter(d=>d.id===id);
 return mean((same.length?same:sameTruthGrid.length?sameTruthGrid:sameTruth.length?sameTruth:sameGrid.length?sameGrid:datasets).map(cost))||globalMean;
};
const done=new Set(datasets.map(d=>`${d.id}-${d.seed}-${d.gridName}`));let remaining=0;
for(const t of settings.truths)for(const seed of settings.selectionSeeds)if(!done.has(`${t.id}-${seed}-full`))remaining+=seed===46001?mean(primary.map(cost))||globalMean:mean(other.map(cost))||globalMean;
for(const id of ['T2','T3','T4','T6'])for(const g of ['S1','S2'])if(!done.has(`${id}-46001-${g}`))remaining+=estimate(id,g);
for(const id of settings.calibrationTruths)for(const g of settings.calibrationGrids)for(const seed of settings.calibrationSeeds)if(!done.has(`${id}-${seed}-${g}`))remaining+=estimate(id,g);
const verificationDone=existsSync(prefix+'verification.json');
// Until this stage has a measurement, retain the previous full verification wall-clock estimate explicitly.
const verifyEstimate=existsSync(prefix+'verify-timing.json')?read('verify-timing').elapsedMs:20*60*1000;
if(!verificationDone)remaining+=verifyEstimate;
const stages=[
 {stage:1,count:automatic.length,total:7,elapsedSeconds:automatic.reduce((s:number,a:any)=>s+a.automaticMs/1000,0)},
 {stage:2,count:primary.length,total:7,elapsedSeconds:primary.reduce((s,d)=>s+d.refinementMs/1000,0)},
 {stage:3,count:full.length,total:21,elapsedSeconds:other.reduce((s,d)=>s+cost(d)/1000,0)},
 {stage:4,count:sparse.length,total:8,elapsedSeconds:sparse.reduce((s,d)=>s+cost(d)/1000,0)},
 {stage:5,count:calibration.length,total:180,elapsedSeconds:calibration.reduce((s,d)=>s+cost(d)/1000,0)},
 {stage:6,count:verificationDone?1:0,total:1,elapsedSeconds:verificationDone?read('verify-timing').elapsedMs/1000:0},
];
console.log(JSON.stringify({stages,completedDatasets:datasets.length,elapsedSeconds:datasets.reduce((s,d)=>s+cost(d)/1000,0),estimatedRemainingSeconds:remaining/1000,verifyEstimateSeconds:verifyEstimate/1000}));
