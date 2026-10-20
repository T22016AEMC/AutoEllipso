import {writeQaFileSync as writeFileSync} from './qa-files.mjs';
import { runAllUnitTests } from '../src/tests/unitTests';

const results = await runAllUnitTests();
writeFileSync(process.argv[2] || 'baseline-tests.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.passed).length, failures: results.filter(r => !r.passed) }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
