/**
 * 校验「远端发布的脚本」真的能跑（不只是能下载）：
 *   1) 从 URL 拉脚本
 *   2) 在模拟 Loon/Stash 运行时里跑一遍（MODE=claim，幂等、真实请求）
 *   3) 在模拟 Quantumult X 运行时里再跑一遍（$task.fetch 分支）
 *   4) 校验源码里没有真实 Token
 *
 * 用法: ZEEKR_TOKEN="Bearer eyJ..." node tests/verify-remote.js <脚本URL>
 *      （不传 URL 默认用本仓库的 raw 地址）
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const URL_DEFAULT =
  "https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/dist/zeekr.js";
const url = process.argv[2] || URL_DEFAULT;
const TKEY = "ZEEKR_" + "TOKEN";

function readCk() {
  if (process.env[TKEY]) return process.env[TKEY].trim();
  const txt = fs.readFileSync("/root/.config/zeekr-checkin/env", "utf8");
  const re = new RegExp("^\\s*" + TKEY + "\\s*=\\s*(.+)$");
  for (const line of txt.split("\n")) {
    const m = line.match(re);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("没有 Token：请设置环境变量 " + TKEY);
}

const CK = readCk();
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

function makeHttpClient(logs) {
  const wrap = (req, cb) => {
    const method = String(req.method || "GET").toUpperCase();
    const init = { method, headers: req.headers || {} };
    if (method !== "GET" && req.body != null) init.body = req.body;
    fetch(req.url, init).then(
      (r) =>
        r.text().then((t) => {
          if (req.url.indexOf("zeekrlife") >= 0)
            logs.push("mock " + method + " " + req.url.slice(0, 80));
          cb(null, { status: r.status, headers: {} }, t);
        }),
      (e) => cb(String((e && e.message) || e), null, null)
    );
  };
  return {
    get: (req, cb) => wrap(Object.assign({ method: "GET" }, req), cb),
    post: (req, cb) => wrap(req, cb),
  };
}

function runSandbox(code, opts) {
  const logs = [];
  const notifies = [];
  const store = {};
  let done = 0;
  const sandbox = {
    console: { log: (m) => logs.push(String(m)), error: (m) => logs.push("ERR " + String(m)) },
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  if (opts.client === "qx") {
    sandbox.$task = {
      fetch: (req) => {
        const method = String(req.method || "GET").toUpperCase();
        const init = { method, headers: req.headers || {} };
        if (method !== "GET" && req.body != null) init.body = req.body;
        return fetch(req.url, init).then((r) =>
          r.text().then((t) => {
            if (req.url.indexOf("zeekrlife") >= 0) logs.push("mock " + method + " " + req.url.slice(0, 80));
            return { statusCode: r.status, headers: {}, body: t };
          })
        );
      },
    };
    sandbox.$prefs = {
      valueForKey: (k) => (k in store ? store[k] : null),
      setValueForKey: (v, k) => {
        store[k] = v;
      },
    };
    if (opts.qxVars) sandbox.$environment = { variables: opts.qxVars };
  } else {
    sandbox.$httpClient = makeHttpClient(logs);
    sandbox.$persistentStore = {
      read: (k) => (k in store ? store[k] : null),
      write: (v, k) => {
        store[k] = v;
      },
    };
    sandbox.$loon = "iPhone15,2 18.0 3.5.1(983)";
    sandbox.$argument = opts.argument;
  }
  sandbox.$notify = (t, s, b) => notifies.push({ title: t, body: b });
  sandbox.$notification = { post: (t, s, b) => notifies.push({ title: t, body: b }) };
  sandbox.$done = () => done++;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "remote-zeekr.js" });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (done || Date.now() - t0 > 90000) resolve({ logs, notifies, done, store });
      else setTimeout(tick, 150);
    };
    tick();
  });
}

(async function () {
  console.log("目标: " + url);
  const res = await fetch(url);
  const code = await res.text();
  console.log("下载: HTTP " + res.status + " / " + code.length + " 字节");

  check("HTTP 200 且非空", res.status === 200 && code.length > 20000, String(code.length));
  check("脚本结构完整（含核心函数）",
    code.indexOf("zeekrMain") > 0 && code.indexOf("zeekrClaimAll") > 0);
  check("没有把真实 Token 写进脚本", code.indexOf(CK) < 0);

  console.log("\n-- Loon/Stash 分支（$httpClient + $argument）--");
  const a = await runSandbox(code, {
    client: "http",
    argument: "MODE=claim&APPVER=4.9.33&TAG=远端校验&" + TKEY + "=" + CK,
  });
  check("$done 被调用", a.done === 1, String(a.done));
  check("签权与账号解析正常", a.logs.some((l) => /Token 过期: \d{4}\//.test(l)));
  check("走到领取阶段（说明请求签名被服务端接受）", a.logs.some((l) => l.indexOf("本次领取") >= 0));
  check("没有登录失效", !a.logs.some((l) => l.indexOf("登录已失效") >= 0));
  check("通知已发出", a.notifies.length === 1 && a.notifies[0].title.indexOf("极氪签到") >= 0);

  console.log("\n-- Quantumult X 分支（$task.fetch + # 参数）--");
  const vars = { MODE: "claim", APPVER: "4.9.33", TAG: "远端校验QX" };
  vars[TKEY] = CK;
  const b = await runSandbox(code, { client: "qx", qxVars: vars });
  check("识别为 Quantumult X", b.logs.some((l) => l.indexOf("客户端: Quantumult X") >= 0));
  check("走到领取阶段", b.logs.some((l) => l.indexOf("本次领取") >= 0));
  check("$done 被调用", b.done === 1);

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
