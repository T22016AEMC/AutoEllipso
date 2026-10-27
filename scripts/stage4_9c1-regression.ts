import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runAutomatedEllipsometryFit} from '../src/fitting/autoWorkflow';
import {createBlankProject} from '../src/data/defaultProjects';
import {synthetic} from './stage4_9c1-support';

const prefix='.qa/stage4_9c1-',read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const save=(name:string,value:unknown)=>{const path=prefix+name+'.json';writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(path+'.tmp',path);};
const sha=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
const files=(path:string):string[]=>readdirSync(path,{withFileTypes:true}).flatMap(p=>p.isDirectory()?files(path+'/'+p.name):[path+'/'+p.name]);
const sourceHash=sha(['src/fitting','src/solver','src/models','src/optics','src/modelRegistry'].flatMap(files).sort().map(p=>p+'\n'+readFileSync(p,'utf8')).join('\n'));
const cases=Array.from({length:7},(_,i)=>({id:'V'+i,mode:'sigma'})).concat(['V1','V3','V6'].map(id=>({id,mode:'sigmaHat'})));
const blank=createBlankProject().layers[0];
const settings={base:'e81033f',V1:{cases,seed:49001,bounds:[40,200],threshold:1e-9,reference:'.qa/stage4_8c-{id}-{mode}-automatic.json',compare:'selectedSetting, free-form film thickness, all output wavelength n/k'},
 V2:{cases,bounds:[blank.thicknessMin,blank.thicknessMax],meaning:'createBlankProject default layer bounds (1–500), same fixtures, no pass threshold; both physical and free-form u-space spans change, physical-endpoint drift also recorded'},
 V3:{model:'cauchy',values:{A:1.52,B:.0045,C:.00008,k0:0},thicknesses:[20,300],seeds:[62001,62002],bounds:[1,500],aois:[65,70,75],wavelengths:[190,900,10],sigma:.03,targetModelId:'gaussian',criteria:'absolute free-form thickness error <=1 nm; normalized thickness u>1e-6 and u<1-1e-6',generation:'same Si table, explicitly a self-consistent boundary regression'},
 perturbed:{cases:['SiO2 100nm','V2 100nm'],seeds:[62003,62004],factor:'n,k each times 1+.02*exp(-((lambda-300)/25)^2)',fit:'matched-family formal runAutoFit LM from true film; unchanged fit config',criteria:'converged and finite only'},
 preservation:'existing assertions unchanged; LM/Jacobian/statistics/tolerances/iterations/Si table/interpolation/TMM unchanged',sourceHash};
const settingsText=JSON.stringify(settings,null,2)+'\n';
if(existsSync(prefix+'settings.json'))assert.equal(readFileSync(prefix+'settings.json','utf8'),settingsText);else{writeFileSync(prefix+'settings.json',settingsText);save('settings-sha256',{sha256:sha(settingsText)});}

function compare(output:any,reference:any){
 const r=output.fittingResult,b=reference.output.fittingResult,model=r.freeFormModel;
 if(!model||!b.freeFormModel)throw new Error('Free-form model unavailable');
 const d=model.layers[model.primaryLayerIndex].thickness,bd=b.freeFormModel.layers[b.freeFormModel.primaryLayerIndex].thickness;
 const rows=r.freeFormOpticalConstants.map((q:any)=>{const v=b.freeFormOpticalConstants.find((p:any)=>p.wavelength===q.wavelength);if(!v)throw new Error('Curve wavelength mismatch');return {wavelength:q.wavelength,n:q.n-v.n,k:q.k-v.k};});
 assert.equal(rows.length,b.freeFormOpticalConstants.length);
 const rms=(key:string)=>Math.sqrt(rows.reduce((s:number,q:any)=>s+q[key]**2,0)/rows.length);
 const maxDifference=Math.max(Math.abs(d-bd),...rows.flatMap((q:any)=>[Math.abs(q.n),Math.abs(q.k)]));
 const selected=r.freeFormRefinement.selectedSetting,priorSelected=b.freeFormRefinement.selectedSetting;
 return {selected,referenceSelected:priorSelected,settingMatch:JSON.stringify(selected)===JSON.stringify(priorSelected),thickness:d,thicknessDelta:d-bd,nRms:rms('n'),kRms:rms('k'),maxDifference,physicalThicknessDelta:output.finalThickness-reference.output.finalThickness};
}
async function run(phase:string){
 const start=performance.now(),cards:any[]=[],list=phase==='V3'?settings.V3.thicknesses.map((thickness,i)=>({id:`d${thickness}`,mode:'sigma',thickness,seed:settings.V3.seeds[i]})):cases;
 for(const item of list){
  const {id,mode}=item,name=`${phase}-${id}-${mode}`,path=prefix+name+'.json';
  let stored:any;
  if(existsSync(path)){stored=read(path);assert.equal(stored.sourceHash,sourceHash);}else{
   const f=phase==='V3'?synthetic('cauchy',settings.V3.values,(item as any).thickness,(item as any).seed):read(`.qa/stage4_8a-${id}-49001-data.json`);
   const project=structuredClone(f.project),points=structuredClone(f.points);
   if(mode==='sigmaHat')for(const point of points){delete point.psiSigma;delete point.deltaSigma;}
   const [min,max]=phase==='V1'?[40,200]:phase==='V2'?settings.V2.bounds:[1,500];
   project.layers[0].thicknessMin=min;project.layers[0].thicknessMax=max;
   const at=performance.now();
   const output=await runAutomatedEllipsometryFit({ambient:project.ambient,layers:project.layers,substrate:project.substrate,points,config:project.fittingConfig,
    targetModelId:phase==='V3'||id==='V0'||id==='V5'?'gaussian':f.truth.model,selectedAois:[65,70,75]});
   stored={sourceHash,id,mode,bounds:[min,max],elapsedMs:performance.now()-at,output};save(name,stored);
  }
  let card:any={id,mode,elapsedMs:stored.elapsedMs,bounds:stored.bounds};
  if(phase!=='V3'){
   Object.assign(card,compare(stored.output,read(`.qa/stage4_8c-${id}-${mode}-automatic.json`)));
   if(phase==='V1')card.pass=card.settingMatch&&card.maxDifference<=1e-9;
  }else{
   const r=stored.output.fittingResult,model=r.freeFormModel;
   if(!model)throw new Error('V3 free-form model unavailable');
   const d=model.layers[model.primaryLayerIndex].thickness,u=(d-1)/499;
   Object.assign(card,{selected:r.freeFormRefinement.selectedSetting,thickness:d,error:d-(item as any).thickness,u,pass:Math.abs(d-(item as any).thickness)<=1&&u>1e-6&&u<1-1e-6});
  }
  cards.push(card);save(phase+'-progress',{completed:cards.length,total:list.length,elapsedMs:performance.now()-start,cards});
 }
 save(phase+'-summary',{cards,elapsedMs:cards.reduce((s,c)=>s+c.elapsedMs,0),wallThisInvocationMs:performance.now()-start,finishedAt:new Date().toISOString(),interruption:{savedRerun:0,unsavedRerun:0}});
}
if(process.argv[1]?.endsWith('stage4_9c1-regression.ts')){
 const phase=process.argv[2];assert.ok(['V1','V2','V3','settings'].includes(phase));
 if(phase!=='settings')await run(phase);
}
