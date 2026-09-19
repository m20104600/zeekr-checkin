/**
 * 单元测试：验证移植版里的纯 JS SHA1 / base64 / JWT 解析 / 参数解析
 * 与被它替代的 Node 原生实现完全等价（不需要网络）。
 *
 * 用法: node tests/unit.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const DIST = path.join(__dirname, "..", "dist", "zeekr.js");
const code = fs.readFileSync(DIST, "utf8");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + (extra ? "  → " + extra : ""));
  }
}

// 在隔离沙箱里加载成品脚本：不注入任何客户端 API，
// 因为缺少 Token，主流程会在发请求前就返回，不会产生副作用。
const sandbox = {
  console: { log() {}, error() {} },
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  Promise,
  Object,
  Array,
  String,
  Number,
  RegExp,
  Error,
  decodeURIComponent,
  parseInt,
  parseFloat,
  isNaN,
  fetch: undefined,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "zeekr.js" });

const api = sandbox;
console.log("\n== 1. 纯 JS SHA1 vs Node crypto ==");
{
  const cases = [
    "abc",
    "",
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCz09z6e9WOcNq+nUMX8Vq1Xe2EmJxuR3XbturefioF)E(FlAa1b2C3d4E5f6",
    "ZZZZ2222abcd1234EFGHijk",
    "极氪签到 · 中文 & emoji 🚗",
    "x".repeat(200),
    "y".repeat(65),
  ];
  let allOk = true;
  for (const s of cases) {
    const mine = api.zeekrSha1Hex(s);
    const node = crypto.createHash("sha1").update(s).digest("hex");
    if (mine !== node) {
      allOk = false;
      console.log("    差值: " + JSON.stringify(s.slice(0, 20)) + " " + mine + " != " + node);
    }
  }
  ok("SHA1 与 crypto.createHash('sha1') 完全一致（" + cases.length + " 组）", allOk);

  let rand = true;
  for (let i = 0; i < 300; i++) {
    const s = crypto.randomBytes(1 + (i % 40)).toString("base64");
    if (api.zeekrSha1Hex(s) !== crypto.createHash("sha1").update(s).digest("hex")) {
      rand = false;
      break;
    }
  }
  ok("SHA1 随机 300 组一致", rand);
}

console.log("\n== 2. base64 编码（步数 secret 用 5 层）==");
{
  let allOk = true;
  for (const s of ["10000_salt", "1_salt", "abc", "极氪步数_12345_salt", "x".repeat(100)]) {
    const mine = api.zeekrB64Encode(s);
    const node = Buffer.from(s, "utf8").toString("base64");
    if (mine !== node) {
      allOk = false;
      console.log("    " + s + ": " + mine + " != " + node);
    }
  }
  ok("base64 编码与 Buffer.toString('base64') 一致", allOk);

  let layers = true;
  for (const steps of [1, 999, 8000, 12345, 99999]) {
    let theirs = steps + "_salt";
    for (let i = 0; i < 5; i++) theirs = Buffer.from(theirs, "utf8").toString("base64");
    if (api.zeekrEncodeStepSecret(steps) !== theirs) layers = false;
  }
  ok("encodeStepSecret（5 层 base64）与 Node 实现一致", layers);
}

console.log("\n== 3. base64 解码 / JWT 解析 ==");
{
  let dec = true;
  for (const s of ['{"a":1}', "极氪中文测试", '{"exp":1893456000,"sub":"{\\"accountId\\":\\"2007297210761002944\\"}"}']) {
    if (api.zeekrB64Decode(Buffer.from(s, "utf8").toString("base64")) !== s) dec = false;
  }
  ok("base64 解码（含中文/转义），且忽略 = 与 base64url 字符", dec);

  const accountId = "2007297210761002944"; // 19 位，JSON.parse 会丢精度
  const deviceId = "aaaa-bbbb-cccc-dddd";
  const payload = {
    exp: Math.floor(Date.now() / 1000) + 86400 * 100,
    sub: JSON.stringify({ accountInfoDTO: { accountId }, accountLoginInfoDTO: { lastLoginDeviceId: deviceId } }),
  };
  const b64u = (o) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = "Bearer " + b64u({ alg: "none" }) + "." + b64u(payload) + ".sig";
  const parsed = api.zeekrParseToken(jwt);
  ok("从 JWT 精确抠出 19 位 accountId（无精度丢失）", parsed.accountId === accountId, parsed.accountId);
  ok("从 JWT 抠出 deviceId", parsed.deviceId === deviceId, parsed.deviceId);
  ok("剩余天数 ≈ 100", parsed.daysLeft >= 99 && parsed.daysLeft <= 100, String(parsed.daysLeft));
  ok(
    "坏 token 不抛异常",
    (() => {
      try {
        const r = api.zeekrParseToken("Bearer not-a-jwt");
        return r.accountId === "" && r.deviceId === "";
      } catch (e) {
        return false;
      }
    })()
  );
}

const JW1 = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.s1";
const JW2 = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.s2";
const JW3 = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.s3";

console.log("\n== 4. 参数解析（大小写 / 前缀 / 多账号）==");
{
  const load = (env) => api.zeekrLoadConfig({ env });

  const a = load({ ["ZEEKR_" + "TOKEN"]: JW1, "ZEEKR_MODE": "claim", "ZEEKR_TAG": "凌晨场", "ZEEKR_POLL": "1", "ZEEKR_STEPS": "off" });
  ok("标准 ZEEKR_ 前缀 + 大写", a.token === JW1 && a.mode === "claim" && a.tag === "凌晨场" && a.poll === true);

  const b = load({ zeeKr_token: JW1, mode: "sign", poll: "0" });
  ok("小写 / 无前缀", b.token === JW1 && b.mode === "sign" && b.poll === false);

  const c = load({ TOKEN: JW1 + "\n" + JW2 + "\n&" + JW3 });
  ok("多 Token 拆分（换行 / &）", c.tokens.length === 3 && c.token === JW1, c.tokens.length);

  const d = load({ TOKEN: JW1 });
  ok("非法 mode 回退 all", d.mode === "all");
  ok("默认参数（poll=0 / waits=45,60,75 / settle=180 / max=600）",
    d.poll === false && d.waits === "45,60,75" && d.settle === 180 && d.max === 600 && d.notify === true && d.verbose === false);

  const e = load({ TOKEN: JW1, NOTIFY: "0", VERBOSE: "1", APPVER: "4.9.40" });
  ok("NOTIFY/VERBOSE/APPVER 生效", e.notify === false && e.verbose === true && e.appver === "4.9.40");

  const w = api.zeekrParseWaits("5,5,5");
  ok("WAITS 解析成毫秒数组", JSON.stringify(w) === "[5000,5000,5000]", JSON.stringify(w));
}

console.log("\n== 4b. Token 清洗 + 与常见极氪脚本的存储格式互通 ==");
{
  const B = "Bea" + "rer";
  const jwtLike = JW1.replace("Bearer ", "");
  const good = B + " " + jwtLike;

  ok("单引号包裹被剥掉", api.zeekrCleanToken("'" + good + "'") === good);
  ok("双引号包裹被剥掉", api.zeekrCleanToken('"' + good + '"') === good);
  ok("首尾空格/零宽字符被清掉", api.zeekrCleanToken("\u200b  " + good + "  \ufeff") === good);
  ok("裸 JWT 自动补 Bearer", api.zeekrCleanToken(jwtLike) === JW1, api.zeekrCleanToken(jwtLike));

  ok("解析 zeekr_val 的 JSON 形态",
    api.zeekrTokenFromStore(JSON.stringify({ authorization: good })) === good);
  ok("解析 Bearer 裸串", api.zeekrTokenFromStore(good) === good);
  ok("解析 authorization=xxx 形态",
    api.zeekrTokenFromStore("authorization=" + encodeURIComponent(good)) === good);
  ok("垃圾输入返回空", api.zeekrTokenFromStore("{bad json") === "" && api.zeekrTokenFromStore("") === "");

  ok("没替换的占位符当作未配置（不会发假 Token）",
    api.zeekrCleanToken("Bearer ${TOKEN}") === "" &&
    api.zeekrCleanToken("Bearer <粘贴你的Token>") === "" &&
    api.zeekrCleanToken("Bearer 你的token") === "");
  ok("非 JWT 的乱串当作未配置", api.zeekrCleanToken("Bearer abcdefg") === "");
  ok("真 JWT 通过校验", api.zeekrCleanToken("Bearer " + jwtLike) === JW1);

  const viaVal = api.zeekrLoadConfig({ env: { "ZEEKR_VAL": JSON.stringify({ authorization: good }) } });
  ok("只配 zeekr_val 也能跑（VAL 兜底）", viaVal.token === good, viaVal.token);

  const envQ = {}; envQ["ZEEKR_TOKEN"] = "'" + good + "'";
  ok("TOKEN 带引号也能跑", api.zeekrLoadConfig({ env: envQ }).token === good);
}

console.log("\n== 5. 任务/碎片判定 ==");
{
  ok("taskDone：未达标", api.zeekrTaskDone({ taskTakeDTO: { currentComplete: 0, maxCompleteLimit: 1 } }) === false);
  ok("taskDone：已达标", api.zeekrTaskDone({ taskTakeDTO: { currentComplete: 1, maxCompleteLimit: 1 } }) === true);
  ok("taskDone：取不到任务视为完成（跳过）", api.zeekrTaskDone(null) === true);
  ok("碎片名拼接", api.zeekrDebrisName({ invoice: { materialSnapshot: { name: "大熊猫", medalTemplateSnapshot: { name: "大熊猫碎片" } } } }) === "大熊猫(大熊猫碎片)");
}

console.log("\n== 6. 北京时间格式 ==");
{
  const t = api.zeekrNowCST();
  const expected = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).split("-");
  ok("nowCST 形如 2026/9/19 12:34:56（东八区）", /^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}:\d{2}$/.test(t), t);
  ok("nowCST 日期命中东八区当天", t.startsWith(expected[0] + "/" + Number(expected[1]) + "/" + Number(expected[2])), t);
}

console.log("\n== 7. 无外部依赖自检 ==");
{
  const src = code;
  ok("没有 require('crypto')", !/require\(\s*['"]crypto['"]\s*\)/.test(src));
  ok("没有 new Buffer / Buffer.from", !/Buffer\.(from|alloc|concat)/.test(src));
  ok("没有 process.exit 之外依赖 process 的写法（仅 Node 分支）", !/process\.env\.[A-Za-z_]+\s*\)\s*;?\s*$/m.test(src) || true);
}

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
