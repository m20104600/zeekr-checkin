// Offline runtime regression: no application requests or account credentials.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const root = path.resolve(__dirname, '..');
function source(file) {
  return process.env.ZEEKR_TEST_REF
    ? cp.execFileSync('git', ['show', process.env.ZEEKR_TEST_REF + ':' + file], {cwd: root, encoding: 'utf8'})
    : fs.readFileSync(path.join(root, file), 'utf8');
}
(async () => {
  let count = 0;
  for (const file of ['tpl/classic.js', 'dist/zeekr.js']) {
    for (const platform of ['Loon', 'Stash', 'Surge']) {
      let captured;
      let code = source(file).replace('/*__CORE__*/', `
        function zeekrCleanToken() { return ''; }
        function zeekrTokenFromStore() { return ''; }
      `);
      assert(code.includes('  zeekrMain(RT)\n    .then'));
      code = code.replace('  zeekrMain(RT)\n    .then', '  __review(RT)\n    .then');
      const box = {
        console: {log() {}}, $done() {},
        $httpClient: {get(options, callback) {
          captured = options;
          callback(null, {status: 200}, '{}');
        }},
        __review: async RT => RT.http({url: 'https://offline.invalid/', method: 'GET', timeoutMs: 20000}),
      };
      if (platform === 'Loon') box.$loon = {};
      if (platform === 'Stash') box.$environment = {'stash-build': 'test'};
      vm.runInNewContext(code, box, {timeout: 2000});
      await new Promise(resolve => setImmediate(resolve));
      assert(captured, file + ' ' + platform + ' adapter was not exercised');
      assert.strictEqual(captured.timeout, platform === 'Loon' ? 20000 : 20, file + ' ' + platform + ' timeout unit');
      count++;
    }
  }
  console.log('PASS: ' + count + ' offline timeout cases (template + built script; Loon/Stash/Surge)');
})().catch(error => {console.error(error.message); process.exitCode = 1;});
