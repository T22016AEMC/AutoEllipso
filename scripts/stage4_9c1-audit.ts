import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'});
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const base='e81033f';
const tracked=git('ls-tree','-r','--name-only',base).trim().split('\n');
const tests=tracked.filter(p=>(p.startsWith('scripts/')&&p.includes('test')&&p.endsWith('.ts'))||p==='src/tests/unitTests.ts');
// Whole-file comparison is stronger than comparing assertion expressions alone.
const assertions=tests.map(path=>{
 const original=git('show',base+':'+path).replaceAll('\r\n','\n');
 let current=readFileSync(path,'utf8').replaceAll('\r\n','\n');
 if(path==='scripts/scientific-tests.ts')current=current.replace("await (await import('./stage4_9c1-tests')).stage49c1Tests(test);\n",'');
 assert.equal(current,original,`${path}: existing test text changed`);
 return {path,sha256:sha(original)};
});
const protectedPaths=['src/optics','src/models','src/solver/transferMatrix.ts','src/solver/ellipsometricAngles.ts','src/fitting/optimizer.ts','src/fitting/statistics.ts','src/fitting/svd.ts','src/fitting/numerics.ts','wrangler.jsonc','.node-version'];
assert.equal(git('diff',base,'--',...protectedPaths),'','Protected calculation/configuration files changed');
writeFileSync('.qa/stage4_9c1-preservation.json',JSON.stringify({base:git('rev-parse',base).trim(),testFiles:assertions,protectedPaths,unchanged:true},null,2));
