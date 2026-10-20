import {writeQaFileSync,readQaFileSync} from './qa-files.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const original=path.resolve(root,'../AutoEllipso_Original');
const manifest=JSON.parse(readQaFileSync(path.join(root,'original-manifest.json'),'utf8').replace(/^\uFEFF/,''));
const hash=data=>createHash('sha256').update(data).digest('hex').toUpperCase();
const archiveHash=hash(readQaFileSync(path.resolve(root,'../autoellipso.zip')));
if(archiveHash!=='F511D681DDE4FC20AB4E2BCD809327744B6BD579B5967DD48BE24B8535FB8C88')throw new Error('Original archive changed');
const changed=[];
for(const entry of manifest)if(hash(readQaFileSync(path.join(original,entry.path)))!==entry.sha256)changed.push(entry.path);
if(changed.length)throw new Error('Original files changed: '+changed.join(', '));
const git=process.env.AUTOELLIPSO_GIT||'git';
let baseline=null;
try {
  baseline=execFileSync(git,['rev-parse','original-baseline'],{cwd:root,encoding:'utf8'}).trim();
  for(const entry of manifest) {
    const bytes=execFileSync(git,['show',`${baseline}:${entry.path.replaceAll('\\','/')}`],{cwd:root,maxBuffer:10*1024*1024});
    if(hash(bytes)!==entry.sha256)throw new Error('Baseline differs from original: '+entry.path);
  }
  const changedFiles=execFileSync(git,['diff',baseline,'--name-only'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  const addedFiles=execFileSync(git,['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  writeQaFileSync(path.join(root,'modified-files.json'),JSON.stringify({baseline,modified:changedFiles,added:addedFiles.filter(p=>!p.endsWith('.zip')&&!p.endsWith('.png'))},null,2));
} catch(e) {if(baseline)throw e;}
writeQaFileSync(path.join(root,'integrity-verification.json'),JSON.stringify({originalArchiveSHA256:archiveHash,originalFilesVerified:manifest.length,baseline,baselineMatchesArchive:!!baseline,originalUnchanged:true},null,2));
const excluded=new Set(['node_modules','.git','dist','build','coverage']);
const files=[];
function walk(folder) {for(const item of fs.readdirSync(folder,{withFileTypes:true})) {
  if(excluded.has(item.name)||item.name.endsWith('.zip')||['expert-ui.png','expert-ui-failure.png'].includes(item.name)||item.name.endsWith('.log')||item.name.startsWith('.env')&&item.name!=='.env.example')continue;
  const full=path.join(folder,item.name);if(item.isDirectory())walk(full);else files.push(full);
}}
walk(root);
const table=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const local=[],central=[];let offset=0;
for(const full of files.sort()) {
  const name=Buffer.from('AutoEllipso_V2/'+path.relative(root,full).replaceAll('\\','/'));
  const raw=readQaFileSync(full),compressed=deflateRawSync(raw),sum=crc(raw);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt32LE(sum,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(name.length,26);
  local.push(h,name,compressed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt32LE(sum,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
  central.push(c,name);offset+=h.length+name.length+compressed.length;
}
const centralBuffer=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralBuffer.length,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...local,centralBuffer,end]),dest=path.join(root,'AutoEllipso_V2.zip');writeQaFileSync(dest,zip);
console.log(JSON.stringify({zip:dest,files:files.length,bytes:zip.length,sha256:hash(zip),originalFilesVerified:manifest.length,baselineMatchesArchive:!!baseline},null,2));
