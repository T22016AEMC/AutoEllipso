import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
export const qaDirectory=path.join(root,'.qa');
fs.mkdirSync(qaDirectory,{recursive:true});
const local=file=>file instanceof URL?fileURLToPath(file):String(file);
// Historical scripts may still name a root artifact; only root data outputs are redirected.
const artifact=file=>path.dirname(path.resolve(local(file)))===root&&/\.(json|log|csv|png)$/i.test(local(file))
  &&!['package.json','tsconfig.json','vercel.json','metadata.json'].includes(path.basename(local(file)));
export function writeQaFileSync(file,...args){
  return fs.writeFileSync(artifact(file)?path.join(qaDirectory,path.basename(local(file))):file,...args);
}
export function readQaFileSync(file,...args){
  const archived=path.join(qaDirectory,path.basename(local(file)));
  return fs.readFileSync(artifact(file)&&!fs.existsSync(file)&&fs.existsSync(archived)?archived:file,...args);
}
export function existsQaFileSync(file){
  return fs.existsSync(file)||(artifact(file)&&fs.existsSync(path.join(qaDirectory,path.basename(local(file)))));
}
