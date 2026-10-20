import {writeQaFileSync,readQaFileSync} from './qa-files.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const dest=path.resolve(import.meta.dirname,'..'),source=path.resolve(dest,'../AutoEllipso_V2');
if(fs.existsSync(path.join(dest,'package.json')))throw new Error('V2.1 already exists');
const skipped=new Set(['node_modules','.git','dist','build','coverage']);
const records=[];
function copy(dir,relative='') {for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
  if(skipped.has(item.name)||item.name.endsWith('.zip')||item.name.endsWith('.log')||/^expert-ui.*\.png$/.test(item.name))continue;
  const next=path.join(relative,item.name),from=path.join(dir,item.name),to=path.join(dest,next);
  if(item.isDirectory()){fs.mkdirSync(to,{recursive:true});copy(from,next);}else{fs.copyFileSync(from,to);records.push({path:next.replaceAll('\\','/'),sha256:createHash('sha256').update(readQaFileSync(from)).digest('hex')});}
}}
copy(source);writeQaFileSync(path.join(dest,'v2-baseline-manifest.json'),JSON.stringify(records,null,2));
console.log('Copied complete V2 source: '+records.length+' files');
