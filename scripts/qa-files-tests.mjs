import assert from 'node:assert/strict';
import fs from 'node:fs';
import {writeQaFileSync,readQaFileSync,existsQaFileSync,qaDirectory} from './qa-files.mjs';
const name='stage4_4a2-io-probe.json',content='{"precision":0.0000001234567890123456}\n';
writeQaFileSync(name,content);
assert.equal(fs.existsSync(name),false);
assert.equal(existsQaFileSync(name),true);
assert.equal(readQaFileSync(name,'utf8'),content);
assert.ok(Buffer.isBuffer(readQaFileSync(name)));
assert.equal(readQaFileSync(new URL('./fixtures/stage3-before.json',import.meta.url),'utf8'),
 fs.readFileSync(new URL('./fixtures/stage3-before.json',import.meta.url),'utf8'));
assert.equal(readQaFileSync('package.json','utf8'),fs.readFileSync('package.json','utf8'));
console.log(JSON.stringify({outputDirectory:qaDirectory,checks:6,passed:6}));
