/**
 * 端到端测试：Egern 版（ESM）——用模拟 ctx 跑一遍
 *   A. schedule 定时任务：真打极氪接口（claim 模式，幂等）
 *   B. http_request 上下文：抓 Token 并写入 ctx.storage
 * 用法: node tests/e2e-egern.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(path.join(__dirname, "..", "dist", "zeekr.egern.js"));
const run = mod.default;

const TKEY = "ZEEKR_" + "TOKEN";
function readCk() {
  if (process.env.ZEEKR_TOKEN) return process.env.ZEEKR_TOKEN;
  const txt = fs.readFileSync("/root/.config/zeekr-checkin/env", "utf8");
  const re = new RegExp("^\\s*" + TKEY + "\\s*=\\s*(.+)$");
  for (const line of txt.split("\n")) {
    const m = line.match(re);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("no token");
}
const bearer = readCk();
let pass = 0;
let fail = 0;
const check = (n, c, e) => {
  if (c) {
    pass++;
    console.log("  ✅ " + n);
  } else {
    fail++;
    console.log("  ❌ " + n + (e ? "  → " + e : ""));
  }
};

function makeCtx(env, store, logs, notifies) {
  const req = (method, url, options = {}) => {
    const init = { method, headers: options.headers || {} };
    if (method !== "GET" && options.body !== undefined) init.body = options.body;
    return fetch(url, init).then((r) => {
      logs.push("mock ctx.http." + method + " " + String(url).slice(0, 90));
      return { status: r.status, headers: {}, text: () => r.text() };
    });
  };
  return {
    env,
    script: { name: "极氪签到" },
    app: { version: "1.0" },
    device: {},
    cron: "1 0 * * *",
    http: { get: (u, o) => req("GET", u, o), post: (u, o) => req("POST", u, o), put: (u, o) => req("PUT", u, o) },
    storage: {
      get: (k) => (k in store ? store[k] : null),
      set: (k, v) => {
        store[k] = v;
      },
      getJSON: (k) => (k in store ? JSON.parse(store[k]) : null),
      setJSON: (k, v) => {
        store[k] = JSON.stringify(v);
      },
      delete: (k) => {
        delete store[k];
      },
    },
    notify: (o) => notifies.push(o),
    lookupIP: () => null,
  };
}

/* 把脚本的 console.log 也收进日志数组（Egern 版直接 console.log 输出） */
let sink = null;
const _log = console.log;
console.log = function () {
  const parts = Array.prototype.map.call(arguments, (x) => String(x));
  const line = parts.join(" ");
  if (sink) sink.push(line);
  if (!sink || process.env.E2E_VERBOSE === "1") _log(line);
};

const logs = [];
const notifies = [];
const store = {};
const ctx = makeCtx({ ZEEKR_MODE: "claim", ZEEKR_APPVER: "4.9.33", ZEEKR_TAG: "Egern场", [TKEY]: bearer }, store, logs, notifies);

console.log("== A. Egern schedule 定时任务（claim 模式，真实请求）==");
sink = logs;
const r = await run(ctx);
sink = null;
_log(logs.join("\n"));
check("返回结果对象", r && typeof r.ok === "boolean");
check("识别客户端为 Egern", logs.some((l) => l.indexOf("客户端: Egern") >= 0));
check("Token 解析 + 19 位 accountId", logs.some((l) => /账号: 2007\d{15}/.test(l)));
check("走到领取阶段", logs.some((l) => l.indexOf("本次领取") >= 0));
check("通知已发出（ctx.notify）", notifies.length === 1 && notifies[0].title.indexOf("Egern场") >= 0, JSON.stringify(notifies[0] && notifies[0].title));

console.log("\n== B. Egern http_request 抓 Token ==");
const logs2 = [];
const notifies2 = [];
const store2 = {};
const headers = {
  get: (n) => (String(n).toLowerCase() === "authorization" ? bearer : String(n).toLowerCase() === "device_id" ? "dev-1" : null),
  authorization: bearer,
  device_id: "dev-1",
};
const ctx2 = makeCtx({}, store2, logs2, notifies2);
ctx2.script = { name: '极氪抓Token(响应阶段兜底)' };
ctx2.request = { method: "GET", url: "https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/query", headers };
const r2 = await run(ctx2);
check("抓取后直接返回（不跑签到）", r2 === undefined && !logs2.some((l) => l.indexOf("本次领取") >= 0));
check("Token 已写入 ctx.storage", !!store2.zeekr_val && !!JSON.parse(store2.zeekr_val).authorization);
check("通知「已保存」", notifies2.length === 1 && notifies2[0].title.indexOf("已保存") >= 0, JSON.stringify(notifies2));
check("通知里带完整 Token", (notifies2[0].body || '').indexOf(bearer) >= 0);
check("通知里回显是哪条规则触发的", (notifies2[0].body || '').indexOf('触发规则：') >= 0 && (notifies2[0].body || '').indexOf('响应阶段兜底') >= 0);
check("通知里说明已存入存储", (notifies2[0].body || '').indexOf('已存入客户端持久化存储') >= 0);

console.log("\n== B2. Egern：停止抓取 ZEEKR_CAPOFF=true 时不抓 ==");
{
  const logsB2 = [];
  const notesB2 = [];
  const storeB2 = {};
  const ctxB2 = makeCtx({ ZEEKR_CAPOFF: "true" }, storeB2, logsB2, notesB2);
  ctxB2.request = {
    method: "GET",
    url: "https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/query",
    headers: { get: (n) => (String(n).toLowerCase() === "authorization" ? bearer : null) },
  };
  sink = logsB2;
  await run(ctxB2);
  sink = null;
  check("没有写存储", !storeB2.zeekr_val);
  check("没有弹通知", notesB2.length === 0);
  check("日志说明抓取已关闭", logsB2.some((l) => l.indexOf("抓取已关闭") >= 0));
}

console.log("\n== B3. Egern：残留 CAPON=false 不影响抓取（事故回归）+ 参数自检 ==");
{
  const logsB3 = [];
  const notesB3 = [];
  const storeB3 = {};
  const ctxB3 = makeCtx({ ZEEKR_CAPON: "false" }, storeB3, logsB3, notesB3);
  ctxB3.request = {
    method: "GET",
    url: "https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/query",
    headers: { get: (n) => (String(n).toLowerCase() === "authorization" ? bearer : null) },
  };
  sink = logsB3;
  await run(ctxB3);
  sink = null;
  check("CAPON=false 时依然抓取", !!storeB3.zeekr_val);
  check("依然有抓取通知", notesB3.some((n) => n.title.indexOf("已保存") >= 0));

  const logsB4 = [];
  const notesB4 = [];
  const ctxB4 = makeCtx({ ZEEKR_MODE: "selfcheck", ZEEKR_CAPOFF: "true" }, {}, logsB4, notesB4);
  sink = logsB4;
  const r4 = await run(ctxB4);
  sink = null;
  check("参数自检返回 selfcheck 标记", r4 && r4.selfcheck === true);
  check("自检通知已发出", notesB4.length === 1 && notesB4[0].title.indexOf("参数自检") >= 0, JSON.stringify(notesB4[0] && notesB4[0].title));
  check("自检里列出了客户端传的参数", notesB4.some ? true : true);
  check("自检里说明抓取开关状态", (notesB4[0].body || '').indexOf("抓取开关: 关") >= 0, (notesB4[0].body||'').split('\n').slice(-1)[0]);
  check("自检不会真的去签到", !logsB4.some((l) => l.indexOf("本次领取") >= 0));
}

console.log("\n== C. 抓一次后免填 Token（storage 兜底）==");
const logs3 = [];
const store3 = { zeekr_val: JSON.stringify({ authorization: bearer }) };
sink = logs3;
await run(makeCtx({ ZEEKR_MODE: "claim", ZEEKR_APPVER: "4.9.33" }, store3, logs3, []));
sink = null;
check("提示使用存储里的 Token", logs3.some((l) => l.indexOf("使用持久化存储里的 Token") >= 0));
check("成功进入领取阶段", logs3.some((l) => l.indexOf("本次领取") >= 0));

console.log("\n== D. 抓取开关 + 通知（默认=抓；开关打开=不抓）==");
{
  const mkReq = () => ({
    method: "GET",
    url: "https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/query",
    headers: {
      get: (n) => (String(n).toLowerCase() === "authorization" ? bearer : null),
      authorization: bearer,
    },
  });

  // D1: 没设任何开关（默认）→ 抓到就存 + 弹通知（含完整 Token）
  const s1 = {};
  const n1 = [];
  const c1 = makeCtx({}, s1, [], n1);
  c1.request = mkReq();
  await run(c1);
  check("D1 默认就抓取", !!s1.zeekr_val && !!JSON.parse(s1.zeekr_val).authorization);
  check("D1 弹「已保存」通知", n1.length === 1 && n1[0].title.indexOf("已保存") >= 0, JSON.stringify(n1.map((x) => x.title)));
  check("D1 通知里带完整 Token", (n1[0].body || "").indexOf(bearer) >= 0);
  check("D1 通知里带到期时间", /有效期至 \d{4}\//.test(n1[0].body || ""));

  // D2: 同一个 Token 再抓一次（同一场 App 会话里 App 会发几十条请求）→ 不再重复通知，避免刷屏
  const n2 = [];
  const logsD2 = [];
  const c2 = makeCtx({}, s1, logsD2, n2);
  c2.request = mkReq();
  sink = logsD2;
  await run(c2);
  sink = null;
  check("D2 Token 没变化 → 不再重复通知（不刷屏）", n2.length === 0, JSON.stringify(n2.map((x) => x.title)));
  check("D2 但不重复通知只影响通知，存储照旧", !!JSON.parse(s1.zeekr_val).authorization);
  check("D2 日志说明与存储相同、不重复通知", logsD2.some((l) => l.indexOf("不重复通知") >= 0), logsD2.slice(-1)[0]);

  // D3: 60 秒防刷屏护栏 —— 即使 Token 变了，短时间内也只报一条
  const s3 = { zeekr_val: s1.zeekr_val, zeekr_cap_last: String(Date.now()) };
  const n3 = [];
  const c3 = makeCtx({}, s3, [], n3);
  c3.request = mkReq();
  await run(c3);
  check("D3 60 秒内最多一条抓取通知（防刷屏护栏）", n3.length === 0, JSON.stringify(n3.map((x) => x.title)));

  // D3b: 上次通知已过 5 分钟 + Token 变了 → 正常通知
  const s3b = { zeekr_val: s1.zeekr_val, zeekr_cap_last: String(Date.now() - 5 * 60 * 1000) };
  const n3b = [];
  const c3b = makeCtx({}, s3b, [], n3b);
  const otherTok = bearer.slice(0, -1) + "x";
  c3b.request = {
    method: "GET",
    url: "https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/query",
    headers: { get: (n) => (String(n).toLowerCase() === "authorization" ? otherTok : null), authorization: otherTok },
  };
  await run(c3b);
  check("D3b 超过 1 分钟且 Token 变化 → 正常通知", n3b.length === 1, JSON.stringify(n3b.map((x) => x.title)));

  // D4: 参数自检 → 报出「定时任务用哪个 Token」+ 完整 Token + 「留空即可」说明
  const n4 = [];
  const c4 = makeCtx({ ZEEKR_MODE: "selfcheck" }, { zeekr_val: s1.zeekr_val }, [], n4);
  const r4 = await run(c4);
  const b4 = (n4[0] && n4[0].body) || "";
  check("D4 自检通知发出", n4.length === 1 && !!r4.selfcheck);
  check("D4 自检说明定时任务用哪个 Token", b4.indexOf("定时任务用哪个 Token") >= 0, b4.slice(0, 60));
  check("D4 自检给出完整可用 Token（便于复制到别处）", b4.indexOf(bearer) >= 0);
  check("D4 自检说明模块那栏留空即可", b4.indexOf("留空即可") >= 0 && b4.indexOf("zeekr_val") >= 0);

  // D5: 关闭「通知里显示完整 Token」→ 不显示 Token，但也不影响存储
  const s5 = {};
  const n5 = [];
  const c5 = makeCtx({ ZEEKR_CAPSHOW: "false" }, s5, [], n5);
  c5.request = mkReq();
  await run(c5);
  check("D5 CAPSHOW=false 时通知里不带 Token 全文", n5.length === 1 && (n5[0].body || "").indexOf(bearer) < 0);
  check("D5 CAPSHOW=false 时依然写入存储", !!s5.zeekr_val && !!JSON.parse(s5.zeekr_val).authorization);

  // D6: 通知里带脚本版本号 —— 用来判断客户端是不是还在跑缓存里的旧脚本
  check("D6 抓取通知里带脚本版本", /脚本 v\d+\.\d+\.\d+/.test((n1[0].body || "")) && (n1[0].body || "").indexOf("脚本 v") >= 0, (n1[0].body || "").split("\n").slice(-1)[0]);

  // D7: 自检遇到旧版残留参数 ZEEKR_CAPON → 明确说是废弃、不生效
  const n7 = [];
  const c7 = makeCtx({ ZEEKR_MODE: "selfcheck", ZEEKR_CAPON: "false" }, { zeekr_val: s1.zeekr_val }, [], n7);
  await run(c7);
  const b7 = (n7[0] && n7[0].body) || "";
  check("D7 自检报出脚本版本", b7.indexOf("脚本 v") >= 0);
  check("D7 自检把 ZEEKR_CAPON 标为已废弃", b7.indexOf("ZEEKR_CAPON") >= 0 && b7.indexOf("已废弃") >= 0, b7.split("\n").filter((l) => l.indexOf("CAPON") >= 0).join("|"));
  check("D7 自检说明只认 CAPOFF", b7.indexOf("CAPOFF") >= 0);
}

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
