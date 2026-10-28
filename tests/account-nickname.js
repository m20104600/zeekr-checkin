"use strict";
// Offline integration tests: real Qinglong wrapper, fake core and notification sink.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../tpl/qinglong.js"), "utf8");
const jwt = (account, nickname) => "Bearer " + [
  Buffer.from('{"alg":"none"}').toString("base64url"),
  Buffer.from(JSON.stringify({sub: JSON.stringify({accountInfoDTO: {accountId: account, nickname}})})).toString("base64url"),
  "offline-signature"
].join(".");
async function run(env) {
  const logs = [], notices = [], accounts = [];
  let exit;
  const finished = new Promise(resolve => { exit = resolve; });
  const context = {
    Buffer, URL, setTimeout, clearTimeout,
    process: {env: {...env}, exit: code => exit(code)},
    console: {log: text => logs.push(String(text))},
    require: name => {
      if (name === "https" || name === "http") return {request() {throw Error("Network forbidden");}};
      if (name.endsWith("sendNotify.js")) return {sendNotify: async (title, body) => notices.push({title, body})};
      throw Error("Unexpected require: " + name);
    },
    fetch() {throw Error("Network forbidden");},
    zeekrMain: async RT => {
      accounts.push({...RT.env});
      return {ok: true, lines: ["offline success"]};
    }
  };
  const original = {...context.process.env};
  vm.runInNewContext(source, context, {filename: "qinglong.js", timeout: 1000});
  const code = await Promise.race([finished, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Error("Wrapper did not finish")), 1000);
    timer.unref();
  })]);
  assert.deepEqual(context.process.env, original, "process.env must not change");
  assert.equal(code, 0);
  assert.equal(notices.length, 1);
  const output = logs.join("\n") + JSON.stringify(notices);
  for (const value of Object.values(env)) {
    if (typeof value === "string" && value.startsWith("Bearer ")) {
      for (const token of value.split(/[\r\n&]+/)) assert.ok(!output.includes(token), "must not output tokens");
    }
  }
  return {body: notices[0].body, accounts, output};
}

test("single account notification adds ID and indexed nickname without JWT disclosure", async () => {
  const {body} = await run({ZEEKR_TOKEN: jwt("2007297210761002944", "JWT name"), ZEEKR_NICKNAME_1: "家用车"});
  assert.match(body, /2007297210761002944 家用车/);
  assert.doesNotMatch(body, /JWT name|undefined/);
});

test("indexed nickname beats JSON list, then JWT; indexed source suffix survives mixed tokens", async () => {
  const first = jwt("2007297210761002944", "默认一");
  const second = jwt("2007297210761002945", "默认二");
  const third = jwt("2007297210761002946", "默认三");
  const {body, accounts} = await run({
    ZEEKR_TOKEN: first,
    ZEEKR_TOKEN_7: second,
    ZEEKR_TOKEN_9: third,
    ZEEKR_NICKNAME_7: "指定七",
    ZEEKR_NICKNAMES: JSON.stringify(["列表一", "列表二", " "])
  });
  assert.match(body, /2007297210761002944 列表一/);
  assert.match(body, /2007297210761002945 指定七/);
  assert.match(body, /2007297210761002946 默认三/);
  assert.deepEqual(accounts.map(env => env.ZEEKR_TOKEN), [first, second, third]);
  assert.equal(accounts.length, 3);
});

test("each core invocation receives only the selected credential despite global mixed-case aliases", async () => {
  const globalToken = jwt("2007297210761002944", "global");
  const indexedToken = jwt("2007297210761002945", "indexed");
  const {accounts, body} = await run({zeekr_token: globalToken, ZEEKR_TOKEN_2: indexedToken, ZEEKR_MODE: "claim"});
  assert.deepEqual(accounts.map(env => env.ZEEKR_TOKEN), [indexedToken, globalToken]);
  for (const env of accounts) {
    assert.deepEqual(Object.keys(env).filter(key => /^ZEEKR_TOKEN(_\d+)?$/i.test(key)), ["ZEEKR_TOKEN"]);
    assert.equal(env.ZEEKR_MODE, "claim");
  }
  assert.match(body, /2007297210761002945 indexed/);
  assert.match(body, /2007297210761002944 global/);
});

test("nickname sanitization flattens forged headers and removes control/format characters", async () => {
  const {body} = await run({
    ZEEKR_TOKEN: jwt("2007297210761002944", "fallback"),
    ZEEKR_NICKNAME_1: "车\r\n【账号 99/99】\u0000\u001b[31m\u202e伪\u200b造"
  });
  assert.equal((body.match(/【账号 /g) || []).length, 1);
  assert.doesNotMatch(body, /[\x00-\x09\x0b-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/);
  assert.equal(body.split("\n").length, 2);
});

test("legacy JSON VAL aliases preserve account selection, authorization fields and device configuration", async () => {
  const first = jwt("2007297210761002944", "车一");
  const second = jwt("2007297210761002945", "车二");
  const third = jwt("2007297210761002946", "车三");
  const vals = [
    JSON.stringify({authorization: first, device_id: "offline-device-1"}),
    JSON.stringify({TOKEN: second, device_id: "offline-device-2"}),
    JSON.stringify({ZEEKR_TOKEN: third})
  ];
  const {body, accounts, output} = await run({
    ZEEKR_VAL: vals[0], ZEEKR_VAL_2: vals[1], zeekr_val_3: vals[2], ZEEKR_NICKNAME_2: "备注二"
  });
  assert.match(body, /2007297210761002944 车一/);
  assert.match(body, /2007297210761002945 备注二/);
  assert.match(body, /2007297210761002946 车三/);
  assert.deepEqual(accounts.map(env => env.ZEEKR_VAL), vals);
  for (const env of accounts) {
    assert.deepEqual(Object.keys(env).filter(key => /^(ZEEKR_)?VAL(_\d+)?$/i.test(key)), ["ZEEKR_VAL"]);
    assert.ok(!Object.hasOwn(env, "ZEEKR_TOKEN"));
  }
  for (const token of [first, second, third]) assert.ok(!output.includes(token));
});

const rawJwt = payload => "Bearer e30." + Buffer.from(payload).toString("base64url") + ".offline";
test("JWT string and object sub retain unquoted 64-bit ID digits and use nickname before userName", async () => {
  const rawSub = '{"accountInfoDTO":{"accountId":2007297210761002944,"nickname":"昵称","userName":"用户名"}}';
  const token1 = rawJwt(JSON.stringify({sub: rawSub}));
  const token2 = rawJwt('{"sub":{"accountInfoDTO":{"accountId":2007297210761002945,"userName":"备用名"}}}');
  const {body} = await run({ZEEKR_TOKEN: token1 + "&" + token2});
  assert.match(body, /2007297210761002944 昵称/);
  assert.match(body, /2007297210761002945 备用名/);
  assert.doesNotMatch(body, /用户名|2007297210761003000/);
});

test("newline and ampersand separated accounts use list position, missing names never render undefined", async () => {
  const tokens = [jwt("2007297210761002944"), jwt("2007297210761002945"), "Bearer malformed.offline"];
  const {body, accounts} = await run({
    ZEEKR_TOKEN: tokens[0] + "\n# ignored\n" + tokens[1] + "&" + tokens[2],
    ZEEKR_NICKNAMES: '["一号",null,{}]'
  });
  assert.deepEqual(accounts.map(env => env.ZEEKR_TOKEN), tokens);
  assert.match(body, /【账号 1\/3 · 2007297210761002944 一号】/);
  assert.match(body, /【账号 2\/3 · 2007297210761002945】/);
  assert.match(body, /【账号 3\/3】/);
  assert.doesNotMatch(body, /undefined|null|\[object Object\]/);
});

test("invalid optional nickname JSON falls back safely; nickname is capped at 40 Unicode characters", async () => {
  for (const invalid of ["{not-json", '{"0":"not-an-array"}', 'null']) {
    const {body} = await run({ZEEKR_TOKEN: jwt("2007297210761002944", "JWT默认"), ZEEKR_NICKNAMES: invalid});
    assert.match(body, /2007297210761002944 JWT默认/);
  }
  for (const config of [
    {ZEEKR_NICKNAME_1: "🚙".repeat(100)},
    {ZEEKR_NICKNAMES: JSON.stringify(["🚙".repeat(100)])},
    {}
  ]) {
    const {body} = await run({ZEEKR_TOKEN: jwt("2007297210761002944", "🚙".repeat(100)), ...config});
    assert.match(body, new RegExp("2007297210761002944 " + "🚙".repeat(40) + "】"));
    assert.ok(!body.includes("🚙".repeat(41)));
  }
});
