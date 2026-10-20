import {writeQaFileSync as writeFileSync,readQaFileSync as readFileSync} from './qa-files.mjs';

import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base='5d73894ce3faae3d6988eb75818abce1057206e5';
const report:any={base,checks:[]};
for(const name of ['typecheck','build','original-tests','scientific-tests','worker-tests'])
  writeFileSync(`stage4_2-verify-${name}.log`,readFileSync(`v2-${name}.log`));
for(const file of ['scientific-tests.json','v2-original-tests.json','worker-tests.json']){
  const old=JSON.parse(execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'}));
  const current=JSON.parse(readFileSync(file,'utf8'));
  const tests=(x:any)=>Array.isArray(x)?x:x.tests??x.results;
  const signature=(x:any)=>tests(x).map((r:any)=>({name:r.name,passed:r.passed}));
  assert.deepEqual(signature(current),signature(old),`Changed test status: ${file}`);
  const rows=tests(current);
  report.checks.push({file,total:rows.length,passed:rows.filter((r:any)=>r.passed).length,
    failures:rows.filter((r:any)=>!r.passed),sameNamesAndStatuses:true});
  writeFileSync(`stage4_2-${file}`,readFileSync(file));
}
assert.equal(report.checks[0].total,73);assert.equal(report.checks[0].passed,72);
assert.equal(report.checks[0].failures[0].name,'Stage4.1: Automatic transparent k and propagated uncertainty');
writeFileSync('stage4_2-regression-comparison.json',JSON.stringify(report,null,2));
console.log('STAGE4_2_REGRESSION '+JSON.stringify(report));
// Preserve Stage 4.1 tracked outputs; current run output has its own Stage 4.2 copies.
for(const file of ['stage4_1-results.json','v2-original-tests.json','verification-summary.json']){
  writeFileSync(`stage4_2-${file}`,readFileSync(file));
  writeFileSync(file,execFileSync('git',['show',`${base}:${file}`]));
}
