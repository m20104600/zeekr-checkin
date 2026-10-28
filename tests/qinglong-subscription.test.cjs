/* Offline subscription contract. No real account APIs or user panel are used. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const { stripTypeScriptTypes } = require('node:module');
const runFile = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const TMP = process.env.TMPDIR || path.join(ROOT, '.test-tmp');
const FIXTURE = path.join(__dirname, 'fixtures/qinglong-v2.23.0');
const INCLUDE = String.raw`zeekr_.*\.js$`;
const SLOTS = [
  ['zeekr_0001_all.js', '1 0 * * *', 'all', '凌晨场', '极氪签到·凌晨场'],
  ['zeekr_0010_claim.js', '10 0 * * *', 'claim', '凌晨场·补领', '极氪签到·凌晨补领'],
  ['zeekr_0810_all.js', '10 8 * * *', 'all', '早间场', '极氪签到·早间场'],
  ['zeekr_0820_claim.js', '20 8 * * *', 'claim', '早间场·补领', '极氪签到·早间补领'],
  ['zeekr_2130_all.js', '30 21 * * *', 'all', '晚间场', '极氪签到·晚间场'],
  ['zeekr_2140_claim.js', '40 21 * * *', 'claim', '晚间场·补领', '极氪签到·晚间补领'],
];
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

// Unmodified upstream sources, with Apache-2.0 license and pinned provenance.
// Only type erasure / selecting functions is done; algorithm text is not rewritten.
function officialFunctions() {
  const runner = fs.readFileSync(path.join(FIXTURE, 'subscriptionRunner.ts.fixture'), 'utf8');
  const filter = fs.readFileSync(path.join(FIXTURE, 'subscriptionFilter.ts.fixture'), 'utf8');
  assert.equal(crypto.createHash('sha256').update(runner).digest('hex'),
    '1378970a2ba58bce49c844b679366d9dce7a562eace1d616b6d017d77e1e8ea2');
  assert.equal(crypto.createHash('sha256').update(filter).digest('hex'),
    '5686fb9285e4aa42d6ad01faac27f1efbbd47e4c7f38520649bc76c28b35dba1');
  function section(from, to) {
    const start = runner.indexOf(from), end = runner.indexOf(to, start + from.length);
    assert.ok(start >= 0 && end > start, `missing upstream section ${from}`);
    return runner.slice(start, end);
  }
  return [
    section('export function cronMetadata(', 'async function copyRegular('),
    section('async function reconcile(', 'export async function syncRepository('),
    filter.slice(filter.indexOf('export async function matchSubscriptionPaths(')),
  ].map(code => stripTypeScriptTypes(code).replace(/^export\s+/gm, '')).join('\n');
}

function officialRuntime(apiCall) {
  const context = vm.createContext({
    fs: fsp, path, Buffer, randomInt: crypto.randomInt, randomUUID: crypto.randomUUID,
    isRecord: value => !!value && typeof value === 'object' && !Array.isArray(value),
    within: (root, relative) => {
      const value = path.resolve(root, relative);
      assert.ok(value.startsWith(path.resolve(root) + path.sep));
      return value;
    },
    translate: (_env, message) => message,
    fail: message => { throw new Error(message); },
    operationOutput: () => {},
    // These are intentional test boundaries: real local files + in-memory API.
    LocalApi: class { async call(...args) { return apiCall(...args); } },
    runProcess: async (command, args, options) => {
      assert.equal(command, 'grep'); // Actual POSIX ERE behavior used by Qinglong.
      try {
        const { stdout, stderr } = await runFile(command, args, { env: { ...process.env, ...options.env } });
        return { code: 0, stdout, stderr };
      } catch (error) {
        if (typeof error.code !== 'number') throw error;
        return { code: error.code, stdout: error.stdout, stderr: error.stderr };
      }
    },
  });
  vm.runInContext(officialFunctions(), context);
  return context;
}

test('exactly six stable self-contained Qinglong subscription entrypoints', () => {
  const dir = path.join(ROOT, 'qinglong');
  const actual = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.js')).sort() : [];
  assert.deepEqual(actual, SLOTS.map(s => s[0]).sort());
  for (const [file] of SLOTS) {
    const text = source('qinglong/' + file);
    assert.ok(text.includes('function zeekrMain('));
    assert.ok(!text.includes('/*__CORE__*/') && !text.includes('/*__QL_SCHEDULE__*/'));
    assert.ok(!text.includes('__ZEEKR_SECRET__'));
  }
});

test('official Qinglong v2.23.0 parser reads six correct unique names and FIVE-field crons', () => {
  const runtime = officialRuntime(() => { throw new Error('no API calls expected'); });
  const names = new Set();
  for (const [file, cron, , , name] of SLOTS) {
    const meta = plain(runtime.cronMetadata(source('qinglong/' + file), file, '59 23 * * *'));
    assert.deepEqual(meta, { name, schedule: cron });
    assert.equal(meta.schedule.split(/\s+/).length, 5);
    // Also exercise annotation-only and legacy filename-bearing branches separately.
    assert.equal(runtime.cronMetadata(source('qinglong/' + file).replace(/^cron:.*\n/m, ''), file, 'fallback').schedule, cron);
    assert.equal(runtime.cronMetadata(source('qinglong/' + file).replace(new RegExp('^.*' + file.replace(/\./g, '\\.') + '.*\\n', 'm'), ''), file, 'fallback').schedule, cron);
    names.add(meta.name);
  }
  assert.equal(names.size, 6);
});

// Deliberately unsigned alg=none JWTs for offline parsing ONLY; never accepted
// as verified credentials and never sent to any server.
const OFFLINE_TOKENS = ['A', 'B'].map(id => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return 'Bearer ' + encode({ alg: 'none', typ: 'JWT', testOnly: true }) + '.' +
    encode({ fixture: 'unsigned-offline-only', sub: JSON.stringify({ accountInfoDTO: { accountId: 'offline-' + id } }) }) + '.';
});
async function runAdapter(relative, overrides = {}) {
  const env = {
    ZEEKR_TOKEN_1: OFFLINE_TOKENS[0], ZEEKR_TOKEN_2: OFFLINE_TOKENS[1],
    ZEEKR_NOTIFY: '0', ZEEKR_STEPS: '15000', ...overrides,
  };
  const before = { ...env }, calls = [], logs = [], exits = [];
  const sandbox = vm.createContext({
    console: { log: (...args) => logs.push(args.join(' ')) },
    process: { env, exit: code => exits.push(code) }, Buffer, URL,
    require: () => { throw new Error('Fixture blocks all external transports/dependencies'); },
  });
  const text = source(relative), split = text.lastIndexOf('\n(async function () {');
  assert.ok(split > 0);
  vm.runInContext(text.slice(0, split), sandbox);
  sandbox.zeekrMain = async rt => {
    calls.push({ env: plain(rt.env), cfg: plain(sandbox.zeekrLoadConfig(rt)) });
    return { ok: true, lines: ['offline adapter fixture; no account calls'] };
  };
  await vm.runInContext(text.slice(split), sandbox);
  assert.deepEqual(env, before, 'must not mutate process.env');
  assert.deepEqual(exits, [0]);
  return { calls, logs };
}

test('each scheduled adapter pins its own mode/tag despite global case/separator aliases; two isolated accounts', async () => {
  for (const [file, , mode, tag] of SLOTS) {
    const { calls, logs } = await runAdapter('qinglong/' + file, {
      ZEEKR_MODE: 'sign', zeekr_mode: 'claim', 'ZEEKR-MODE': 'sign',
      ZEEKR_TAG: 'wrong global title', zeekr_tag: 'wrong alias title',
      'ZEEKR-TAG': 'wrong separator title',
    });
    assert.equal(calls.length, 2);
    for (let i = 0; i < calls.length; i++) {
      assert.equal(calls[i].cfg.mode, mode);
      assert.equal(calls[i].cfg.tag, tag);
      assert.equal(calls[i].cfg.stepsRaw, '15000');
      assert.equal(calls[i].cfg.tokens.length, 1);
      assert.equal(calls[i].env.ZEEKR_TOKEN, OFFLINE_TOKENS[i]);
      assert.ok(!('ZEEKR_TOKEN_1' in calls[i].env) && !('ZEEKR_TOKEN_2' in calls[i].env));
    }
    assert.ok(logs.some(text => text.includes('青龙·' + tag)));
    assert.ok(logs.every(text => !text.includes('wrong global title') && !text.includes('wrong alias title')));
  }
});

test('generic manual Node/Qinglong script still respects global mode/tag', async () => {
  const { calls, logs } = await runAdapter('dist/zeekr.qinglong.js', { ZEEKR_MODE: 'sign', ZEEKR_TAG: ' 自定义手动任务 ' });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.cfg.mode, 'sign');
    assert.equal(call.cfg.tag, '自定义手动任务');
  }
  assert.ok(logs.some(text => text.includes('青龙·自定义手动任务')));
});

test('all six entries embed the unchanged shared business core', () => {
  const match = source('dist/zeekr.js').match(/var ZEEKR_SECRET = "([^"]+)"/);
  assert.ok(match);
  const core = source('parts/core.js').replaceAll('__ZEEKR_SECRET__', match[1]).trimEnd();
  for (const [file] of SLOTS) assert.ok(source('qinglong/' + file).includes(core), file);
});

test('official POSIX whitelist selects SIX paths; official reconcile adds once, preserves edits/disabled state on resubscribe', async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const workspace = await fsp.mkdtemp(path.join(TMP, 'ql-subscription-'));
  const rows = [], apiCalls = [];
  const runtime = officialRuntime(async (endpoint, method = 'GET', payload) => {
    apiCalls.push({ endpoint, method, payload: payload === undefined ? null : plain(payload) });
    if (endpoint === 'crons' && method === 'GET') return { data: { data: rows } };
    if (endpoint === 'crons' && method === 'POST') {
      rows.push({ id: rows.length + 1, ...plain(payload), isDisabled: 0 });
      return { data: { code: 200 } };
    }
    if (endpoint === 'system/notify' && method === 'PUT') return { data: { code: 200 } };
    throw new Error('Unexpected API boundary: ' + method + ' ' + endpoint);
  });
  try {
    // Include distracting generic/mobile scripts and fixtures to catch overly broad filters.
    const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
    const matched = Array.from(await runtime.matchSubscriptionPaths(candidates, INCLUDE, workspace, {})).sort();
    assert.deepEqual(matched, SLOTS.map(s => 'qinglong/' + s[0]).sort());
    const namespace = 'm20104600_zeekr-checkin_main/';
    const relativePaths = matched.map(file => namespace + file);
    const scriptRoot = path.join(workspace, 'scripts');
    for (const relative of matched) {
      const target = path.join(scriptRoot, namespace, relative);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, source(relative));
    }
    const context = { env: { TZ: 'Asia/Shanghai' }, paths: { dir_scripts: scriptRoot } };
    const input = { autoAdd: true, autoDelete: false, subscriptionId: 7 };
    assert.deepEqual(plain(await runtime.reconcile(context, input, namespace, relativePaths)), { added: 6, removed: 0 });
    assert.equal(rows.length, 6);
    for (const [file, cron, , , name] of SLOTS) {
      const row = rows.find(row => row.command.endsWith('/' + file));
      assert.ok(row);
      assert.equal(row.command, 'task ' + namespace + 'qinglong/' + file);
      assert.equal(row.schedule, cron);
      assert.equal(row.name, name);
      assert.equal(row.sub_id, 7);
    }
    rows[0].schedule = '7 9 * * *';
    rows[0].name = '用户自定义任务名';
    rows[1].isDisabled = 1;
    const snapshot = plain(rows);
    assert.deepEqual(plain(await runtime.reconcile(context, input, namespace, relativePaths)), { added: 0, removed: 0 });
    assert.deepEqual(rows, snapshot);
    assert.equal(apiCalls.filter(call => call.method === 'POST').length, 6);
    assert.equal(apiCalls.filter(call => call.method === 'DELETE').length, 0);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});
