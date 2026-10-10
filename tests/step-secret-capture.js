// Offline phone-field regression; fixtures contain no account credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const expected = 'Vm10amVHUXlUbkpPVmxwUFZsZFNVVll3YUVOWlZscHhWRzAxYTJSNk1Eaz0=';
const root = path.resolve(__dirname, '..');
for (const filename of ['parts/core.js', 'dist/zeekr.js', 'dist/zeekr.egern.js', 'dist/zeekr.qinglong.js']) {
  let source = fs.readFileSync(path.join(root, filename), 'utf8');
  // Keep only the shared core; do not execute client/network entrypoints.
  const start = source.indexOf('var ZEEKR_PORT_VERSION');
  const end = source.indexOf('async function zeekrMain', start);
  assert(start >= 0 && end > start, 'shared-core boundary is present');
  source = source.slice(start, end);
  const context = vm.createContext({});
  vm.runInContext(source, context);
  assert.equal(context.zeekrEncodeStepSecret(6994), expected, filename);
  console.log('PASS phone field: ' + filename);
}
(async () => {
  if (process.env.ZEEKR_REFERENCE_MJS) {
    const {pathToFileURL} = require('node:url');
    const reference = await import(pathToFileURL(process.env.ZEEKR_REFERENCE_MJS));
    assert.equal(reference.encodeStepSecret(6994), expected);
    console.log('PASS phone field: local reference');
  }
})().catch(e => {console.error(e.message); process.exitCode = 1;});
