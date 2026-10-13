import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
const root=path.resolve(import.meta.dirname,'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'v2-baseline-manifest.json'),'utf8'));
const v2=path.resolve(root,'../AutoEllipso_V2');
const changed=manifest.filter(e=>!fs.existsSync(path.join(v2,e.path))||hash(fs.readFileSync(path.join(v2,e.path)))!==e.sha256);
if(changed.length)throw new Error('V2 original changed: '+changed.map(e=>e.path));
const core=manifest.filter(e=>/^src\/(models|fitting|solver|optics|modelRegistry|materialRegistry)\//.test(e.path));
if(core.some(e=>hash(fs.readFileSync(path.join(root,e.path)))!==e.sha256))throw new Error('Scientific core differs from V2');
const archive=path.resolve(root,'../autoellipso.zip');
const originalHash=hash(fs.readFileSync(archive));
if(originalHash!=='f511d681dde4fc20ab4e2bcd809327744b6bd579b5967dd48be24b8535fb8c88')throw new Error('Original archive changed');
const originalManifest=JSON.parse(fs.readFileSync(path.join(root,'original-manifest.json'),'utf8').replace(/^\uFEFF/,''));
for(const e of originalManifest)if(hash(fs.readFileSync(path.resolve(root,'../AutoEllipso_Original',e.path))).toUpperCase()!==e.sha256)throw new Error('Original source changed: '+e.path);
const exclude=new Set(['node_modules','.git','dist','build','coverage','.qa','.playwright','test-results']);
function walk(dir,skip=true){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  if(skip&&(exclude.has(e.name)||/\.(zip|log)$/.test(e.name)||e.name==='v21-packages.json'||/^expert-ui.*\.png$/.test(e.name)||e.name.startsWith('.env')&&e.name!=='.env.example.txt'))return [];
  const full=path.join(dir,e.name);return e.isDirectory()?walk(full,skip):[full];
});}
const existing=walk(root), baseline=new Map(manifest.map(e=>[e.path,e.sha256]));
fs.writeFileSync(path.join(root,'v21-modified-files.json'),JSON.stringify({modified:existing.map(f=>path.relative(root,f).replaceAll('\\','/')).filter(p=>baseline.has(p)&&hash(fs.readFileSync(path.join(root,p)))!==baseline.get(p)),added:existing.map(f=>path.relative(root,f).replaceAll('\\','/')).filter(p=>!baseline.has(p)),removed:manifest.map(e=>e.path).filter(p=>!fs.existsSync(path.join(root,p)))},null,2));
fs.writeFileSync(path.join(root,'v21-integrity.json'),JSON.stringify({at:new Date().toISOString(),originalArchiveSha256:originalHash,originalFilesVerified:originalManifest.length,v2FilesVerified:manifest.length,v2Unchanged:true,scientificCoreFilesVerified:core.length,scientificCoreUnchanged:true},null,2));
const table=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
function zip(files,base,prefix,dest){const local=[],central=[];let offset=0;
  for(const full of files.sort()){
    const name=Buffer.from(prefix+path.relative(base,full).replaceAll('\\','/')),raw=fs.readFileSync(full),compressed=deflateRawSync(raw),sum=crc(raw);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt32LE(sum,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(name.length,26);local.push(h,name,compressed);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt32LE(sum,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+compressed.length;
  }
  const cb=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cb.length,12);end.writeUInt32LE(offset,16);
  const bytes=Buffer.concat([...local,cb,end]);fs.writeFileSync(dest,bytes);return {file:path.basename(dest),files:files.length,bytes:bytes.length,sha256:hash(bytes)};
}
const packages=[zip(walk(root),root,'AutoEllipso_V2.1/',path.join(root,'AutoEllipso_V2.1.zip')),zip(walk(path.join(root,'dist'),false),path.join(root,'dist'),'',path.join(root,'AutoEllipso_V2.1_static.zip'))];
fs.writeFileSync(path.join(root,'v21-packages.json'),JSON.stringify(packages,null,2));console.log(JSON.stringify(packages,null,2));
