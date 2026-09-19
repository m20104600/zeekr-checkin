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
check("通知「已自动保存」", notifies2.length === 1 && notifies2[0].title.indexOf("已自动保存") >= 0, JSON.stringify(notifies2));
check("通知里带完整 Token", (notifies2[0].body || '').indexOf(bearer) >= 0);
check("通知里回显是哪条规则触发的", (notifies2[0].body || '').indexOf('触发规则：') >= 0 && (notifies2[0].body || '').indexOf('响应阶段兜底') >= 0);
check("通知里说明已存入存储", (notifies2[0].body || '').indexOf('已存入客户端持久化存储') >= 0);

console.log("\n== C. 抓一次后免填 Token（storage 兜底）==");
const logs3 = [];
const store3 = { zeekr_val: JSON.stringify({ authorization: bearer }) };
sink = logs3;
await run(makeCtx({ ZEEKR_MODE: "claim", ZEEKR_APPVER: "4.9.33" }, store3, logs3, []));
sink = null;
check("提示使用存储里的 Token", logs3.some((l) => l.indexOf("使用持久化存储里的 Token") >= 0));
check("成功进入领取阶段", logs3.some((l) => l.indexOf("本次领取") >= 0));

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
