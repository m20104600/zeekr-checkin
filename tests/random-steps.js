const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../parts/core.js'), 'utf8');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(source, ctx);
  for (const [name, resolve] of [['core', ctx.zeekrResolveStepCounts]]) {
    assert.equal(typeof resolve, 'function', name + ': step resolver must exist');
    const bounds = [];
    assert.equal(resolve('', (lo, hi) => { bounds.push([lo, hi]); return lo; }), 10000);
    assert.deepEqual(bounds, [[10000, 20000]]);
    assert.equal(resolve('', (lo, hi) => hi), 20000);
    console.log('PASS default random bounds:', name);
    assert.equal(resolve(' 12000 - 18000 ', (lo, hi) => hi), 18000);
    assert.equal(resolve(' 12000 - 18000 ', (lo, hi) => lo), 12000);
    for (const value of ['15000', 15000]) assert.equal(resolve(value), 15000);
    for (const value of ['0', 0, 'off', 'NO', 'false']) assert.equal(resolve(value), 0);
    for (const value of ['random', 'bad', '20000-10000', '-2', '123abc', '10000-', '10000-9007199254740992']) {
      assert.equal(resolve(value, (lo, hi) => hi), 20000, 'invalid/default: ' + value);
    }
    const seen = new Set();
    for (let i=0; i<500; i++) {
      const n = resolve('10000-20000');
      assert.ok(Number.isInteger(n) && n >= 10000 && n <= 20000);
      seen.add(n);
    }
    assert.ok(seen.size > 1);
    console.log('PASS range/fixed/off/fallback + 500 samples:', name);
  }
})().catch(e => { console.error(e); process.exit(1); });
