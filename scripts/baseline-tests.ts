import { runAllUnitTests } from '../src/tests/unitTests';
import { writeFileSync } from 'node:fs';
const results = await runAllUnitTests();
writeFileSync(process.argv[2] || 'baseline-tests.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.passed).length, failures: results.filter(r => !r.passed) }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
