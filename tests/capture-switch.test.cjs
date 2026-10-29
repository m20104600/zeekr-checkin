// Offline capture-switch regression: no real credentials, requests or rewards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tpl/classic.js'), 'utf8').replace('/*__CORE__*/',
  fs.readFileSync(path.join(root, 'parts/core.js'), 'utf8') + '\nzeekrMain = function(rt) { onTask(rt); return Promise.resolve({ok:true}); };');
// These intentionally fake strings are syntax fixtures, never verified credentials.
const cached = JSON.stringify({ authorization: 'Bearer offline.cached.signature' });
async function run(platform, capture, rewrite = true, extra = {}) {
  const values = { ZEEKR_CAPDEBUG: '1', ...extra };
  if (capture !== undefined) values.ZEEKR_CAPTURE = capture;
  const store = { zeekr_val: cached }, calls = { writes: 0, notifications: 0, tasks: 0, done: 0, http: 0 };
  const transport = () => { calls.http++; throw new Error('Network forbidden in offline fixture'); };
  const box = {
    console: { log() {} }, onTask: rt => { calls.tasks++; assert.equal(rt.env.ZEEKR_TOKEN, 'Bearer offline.cached.signature'); },
    $script: { type: rewrite ? 'http-request' : 'cron', name: 'offline-capture-fixture' },
    $done: () => { calls.done++; }, $notify: () => { calls.notifications++; },
    $persistentStore: { read: k => store[k] || '', write: (v, k) => { store[k] = v; calls.writes++; return true; } },
    $prefs: { valueForKey: k => store[k] || '', setValueForKey: (v, k) => { store[k] = v; calls.writes++; return true; } },
  };
  if (rewrite) box.$request = { method: 'GET', url: 'https://example.invalid/offline', headers: { Authorization: 'Bearer offline.fresh.signature' } };
  if (platform === 'qx') { box.$task = { fetch: transport }; box.$environment = { variables: values }; }
  else { box.$httpClient = { get: transport, post: transport }; box.$argument = platform === 'loon' ? values : Object.entries(values).map(([k,v]) => k + '=' + v).join('&'); }
  if (platform === 'loon') box.$loon = {};
  vm.runInNewContext(source, box);
  await new Promise(resolve => setImmediate(resolve));
  return { calls, store };
}
test('Loon/QX/Surge off means no writes, no debug/capture notification, no HTTP or task', async () => {
  for (const p of ['loon', 'qx', 'surge']) for (const value of [false, 'false', '0', 'off', 'no']) {
    const { calls, store } = await run(p, value);
    assert.deepEqual(calls, { writes: 0, notifications: 0, tasks: 0, done: 1, http: 0 }, p + ':' + value);
    assert.equal(store.zeekr_val, cached);
  }
});
test('missing/true/placeholder capture setting keeps existing default ON; stale CAPON/CAPOFF ignored', async () => {
  for (const p of ['loon', 'qx', 'surge']) for (const value of [undefined, true, 'true', '${ZEEKR_CAPTURE}']) {
    const { calls } = await run(p, value, true, { CAPON: false, CAPOFF: true });
    assert.equal(calls.writes, 1, p + ':' + value);
    assert.equal(calls.tasks, 0);
    assert.equal(calls.http, 0);
    assert.equal(calls.done, 1);
  }
});
test('turning capture OFF never stops scheduled task from reading previously saved credential', async () => {
  for (const p of ['loon', 'qx', 'surge']) {
    const { calls, store } = await run(p, false, false);
    assert.equal(calls.tasks, 1);
    assert.equal(calls.writes, 0);
    assert.equal(calls.done, 1);
    assert.equal(store.zeekr_val, cached);
  }
});
test('generated configs wire independent native capture controls, never gate cron jobs', () => {
  const read = name => fs.readFileSync(path.join(root, 'configs', name), 'utf8');
  const loon = read('loon.plugin');
  assert.match(loon, /ZEEKR_CAPTURE = switch,true,type=boolean,tag=抓取 Token/);
  const captureRules = loon.split('\n').filter(line => /^(request|response) if /.test(line));
  assert.equal(captureRules.length, 1);
  for (const line of captureRules) {
    assert.ok(line.includes('{${ZEEKR_CAPTURE}}'));
    assert.ok(line.includes('enable=${ZEEKR_CAPTURE}'));
  }
  const cron = loon.split('\n').filter(line => line.startsWith('cron '));
  assert.equal(cron.length, 6);
  assert.ok(cron.every(line => !line.includes('CAPTURE')));
  assert.match(read('qx.conf'), /configs\/qx-capture\.conf, tag=极氪Token抓取, enabled=true/);
  assert.ok(!read('qx.conf').split('\n').some(line => /^[^#;\n].*url script-request-header/.test(line)));
  assert.match(read('qx-capture.conf'), /hostname = api-gw-toc\.zeekrlife\.com/);
  assert.ok(!read('qx-capture.conf').includes('[task_local]'));
  assert.match(read('surge-capture.sgmodule'), /type=http-request/);
  assert.ok(!read('surge-capture.sgmodule').includes('type=cron'));
});
