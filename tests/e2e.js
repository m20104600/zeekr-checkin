/**
 * 端到端测试：在「模拟客户端运行时」里真正跑一遍 dist/zeekr.js
 *   - 模拟 $httpClient（Loon / Stash / Surge 系）
 *   - 模拟 $task.fetch（Quantumult X 系）
 *   - 模拟 $request（rewrite 抓 Token 场景）
 *   - 模拟持久化存储（自动抓取的 Token 兜底）
 * 真实的签到/领取请求会打到极氪服务器（mode=claim 是幂等的，安全）
 *
 * 用法: node tests/e2e.js
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const CODE = fs.readFileSync(path.join(__dirname, "..", "dist", "zeekr.js"), "utf8");

const TKEY = "ZEEKR_" + "TOKEN";

function readCk() {
  if (process.env.ZEEKR_TOKEN) return process.env.ZEEKR_TOKEN;
  const txt = fs.readFileSync("/root/.config/zeekr-checkin/env", "utf8");
  const re = new RegExp("^\\s*" + TKEY + "\\s*=\\s*(.+)$");
  for (const line of txt.split("\n")) {
    const m = line.match(re);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("没能从 /root/.config/zeekr-checkin/env 读到 Token");
}

const TOKEN = readCk();

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + (extra ? "  → " + extra : ""));
  }
}

/* ---------- 模拟各客户端的 HTTP 层 ---------- */
function hostFetch(req) {
  const method = String(req.method || "GET").toUpperCase();
  const init = { method, headers: req.headers || {} };
  if (method !== "GET" && req.body !== undefined && req.body !== null)
    init.body = req.body;
  return fetch(req.url, init).then((r) =>
    r.text().then((t) => ({ status: r.status, headers: {}, body: t }))
  );
}

function makeHttpClient(log) {
  const wrap = (req, cb) => {
    hostFetch(req).then(
      (r) => {
        log.push("mock $httpClient " + req.method + " " + req.url.slice(0, 90));
        cb(null, { status: r.status, headers: r.headers }, r.body);
      },
      (e) => cb(String((e && e.message) || e), null, null)
    );
  };
  return { get: (req, cb) => wrap(Object.assign({ method: "GET" }, req), cb), post: (req, cb) => wrap(req, cb) };
}

function makeTaskFetch(log) {
  return {
    fetch: (req) =>
      hostFetch(req).then((r) => {
        log.push("mock $task.fetch " + req.method + " " + req.url.slice(0, 90));
        return { statusCode: r.status, headers: r.headers, body: r.body };
      }),
  };
}

/* ---------- 在模拟运行时里跑一遍脚本 ---------- */
function runClassic(opts) {
  const logs = [];
  const notifies = [];
  const store = Object.assign({}, opts.store || {});
  let doneCalled = 0;

  const sandbox = {
    console: {
      log: (m) => logs.push(String(m)),
      error: (m) => logs.push("ERR " + String(m)),
    },
    setTimeout,
    clearTimeout,
    fetch: undefined,
  };
  sandbox.globalThis = sandbox;

  if (opts.client === "qx") {
    sandbox.$task = makeTaskFetch(logs);
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
        return true;
      },
    };
    if (opts.loon) sandbox.$loon = "iPhone15,2 18.0 3.5.1(983)";
    if (opts.stash) sandbox.$environment = { "stash-build": "1", "stash-version": "3.6.0" };
    if (opts.argument !== undefined) sandbox.$argument = opts.argument;
  }
  if (opts.request) sandbox.$request = opts.request;
  if (opts.scriptType) sandbox.$script = { type: opts.scriptType, name: "test" };

  if (!opts.onlyNotification)
    sandbox.$notify = (t, s, b) => notifies.push({ via: "$notify", title: t, body: b });
  sandbox.$notification = {
    post: (t, s, b) => notifies.push({ via: "$notification.post", title: t, body: b }),
  };
  sandbox.$done = () => {
    doneCalled++;
  };

  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: "zeekr.js" });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (doneCalled || Date.now() - t0 > 120000) {
        resolve({ logs, notifies, store, doneCalled, sandbox });
      } else setTimeout(tick, 200);
    };
    tick();
  });
}

const has = (logs, s) => logs.some((l) => l.indexOf(s) >= 0);

(async function main() {
  console.log("== A. Loon：真正的签到流程（claim 模式）==");
  {
    const r = await runClassic({
      client: "http",
      loon: true,
      argument: "ZEEKR_MODE=claim&ZEEKR_APPVER=4.9.33&ZEEKR_TAG=测试场&" + TKEY + "=" + TOKEN,
    });
    console.log(r.logs.join("\n"));
    check("脚本正常结束（$done 被调用）", r.doneCalled === 1, String(r.doneCalled));
    check("识别客户端为 Loon", has(r.logs, "客户端: Loon"));
    check("Token 有效期解析成功", r.logs.some((l) => /Token 过期: \d{4}\/\d{1,2}\/\d{1,2}/.test(l)));
    check("19 位 accountId 精确（无精度丢失）", r.logs.some((l) => /账号: 2007\d{15}/.test(l)));
    check("走到领取阶段", has(r.logs, "本次领取"));
    check("通知已发出", r.notifies.length === 1 && r.notifies[0].title.indexOf("极氪签到") >= 0);
    check("通知标题带场次标签", r.notifies[0].title.indexOf("测试场") >= 0, r.notifies[0].title);
  }

  console.log("\n== B. Stash：JSON argument + $notification.post ==");
  {
    const arg = JSON.stringify({ ZEEKR_MODE: "claim", ZEEKR_APPVER: "4.9.33", [TKEY]: TOKEN });
    const r = await runClassic({ client: "http", stash: true, argument: arg, onlyNotification: true });
    check("识别客户端为 Stash", has(r.logs, "客户端: Stash"));
    check("走的是 $notification.post", r.notifies.length === 1 && r.notifies[0].via === "$notification.post");
    check("JSON argument 解析成功（Token 被用上）", has(r.logs, "本次领取"));
  }

  console.log("\n== C. Quantumult X：$task.fetch + URL # 参数 ==");
  {
    const vars = { ZEEKR_MODE: "claim", ZEEKR_APPVER: "4.9.33", ZEEKR_TAG: "QX场" };
    vars[TKEY] = TOKEN;
    const r = await runClassic({ client: "qx", qxVars: vars });
    check("识别客户端为 Quantumult X", has(r.logs, "客户端: Quantumult X"));
    check("URL # 参数里的 Token 生效", has(r.logs, "本次领取"));
    check("通知走 $notify", r.notifies.length === 1 && r.notifies[0].via === "$notify");
    check("$done 被调用", r.doneCalled === 1);
  }

  console.log("\n== D. rewrite 抓取 Token（Loon/Stash 系）==");
  {
    const r = await runClassic({
      client: "http",
      loon: true,
      scriptType: "http-request",
      request: {
        url: "https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/query",
        method: "GET",
        headers: { Authorization: TOKEN, device_id: "abc-123", "Content-Type": "application/json" },
      },
    });
    check("抓取后立刻 $done（不改写请求）", r.doneCalled === 1);
    check("写进了持久化存储 zeekr_val", typeof r.store.zeekr_val === "string");
    check("存的是 JSON 且含 authorization", (() => {
      try {
        return !!JSON.parse(r.store.zeekr_val).authorization;
      } catch (e) {
        return false;
      }
    })());
    check("发了「Token 已自动保存」通知", r.notifies.some((n) => n.title.indexOf("已自动保存") >= 0));
    check("没有跑签到（抓取场景不签到）", !has(r.logs, "本次领取"));
    check("通知里带 Token 到期日", r.notifies.some((n) => /有效期至 \d{4}\//.test(n.body || "")));
    check("通知里带完整 Token（手机抓完复制给青龙用）",
      r.notifies.some((n) => (n.body || "").indexOf(TOKEN) >= 0));
    check("通知里回显触发规则 + 已存入存储",
      r.notifies.some((n) => (n.body || "").indexOf("触发规则：") >= 0 && (n.body || "").indexOf("已存入客户端持久化存储") >= 0));
  }

  console.log("\n== D2. CAPSHOW=0：通知里不显示 Token，但存储照写 ==");
  {
    const r = await runClassic({
      client: "http",
      loon: true,
      scriptType: "http-request",
      argument: "CAPSHOW=0",
      request: {
        url: "https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/query",
        method: "GET",
        headers: { authorization: TOKEN },
      },
    });
    check("存储里依然有 Token", !!JSON.parse(r.store.zeekr_val).authorization);
    check("通知里看不到 Token", !r.notifies.some((n) => (n.body || "").indexOf(TOKEN) >= 0));
    check("通知仍然发出（账号/有效期）", r.notifies.length === 1 && /有效期至 \d{4}\//.test(r.notifies[0].body));
  }

  console.log("\n== E. rewrite 抓取 Token（Quantumult X，$prefs）==");
  {
    const r = await runClassic({
      client: "qx",
      scriptType: "request",
      request: { url: "https://api-gw-toc.zeekrlife.com/x", method: "POST", headers: { authorization: TOKEN } },
    });
    check("QX 写入 $prefs 成功", !!r.store.zeekr_val);
    check("QX 通知已发出", r.notifies.length === 1);
  }

  console.log("\n== F. 自动 Token：不填 Token，用存储里的（抓一次之后就能免填）==");
  {
    const r = await runClassic({
      client: "http",
      loon: true,
      store: { zeekr_val: JSON.stringify({ authorization: TOKEN, ts: Date.now() }) },
      argument: "ZEEKR_MODE=claim&ZEEKR_APPVER=4.9.33",
    });
    check("提示使用了存储里的 Token", has(r.logs, "使用持久化存储里的 Token"));
    check("用存储的 Token 成功领到阶段", has(r.logs, "本次领取"));
  }

  console.log("\n== G. 无 Token：给出可操作的报错 ==");
  {
    const r = await runClassic({ client: "http", loon: true, argument: "ZEEKR_MODE=claim" });
    check("通知标题含失败", r.notifies.length === 1 && r.notifies[0].title.indexOf("❌") === 0, r.notifies[0] && r.notifies[0].title);
    check("提示缺少 Token", (r.notifies[0].body || "").indexOf("缺少 Token") >= 0);
    check("$done 仍被调用（不留悬空脚本）", r.doneCalled === 1);
  }

  console.log("\n== H. 完整流程（MODE=all：签到 + 步数 + 任务 + 领取）==");
  {
    const r = await runClassic({
      client: "http",
      loon: true,
      argument: "ZEEKR_MODE=all&ZEEKR_APPVER=4.9.33&ZEEKR_TAG=全流程&" + TKEY + "=" + TOKEN,
    });
    console.log(r.logs.filter((l) => !/^\[极氪签到·明细\]/.test(l)).join("\n"));
    check("签到成功", has(r.logs, "签到成功"));
    check("步数上报成功", has(r.logs, "步数上报成功"));
    check("任务列表拿到", has(r.logs, "📋 任务:"));
    check("完成收尾", has(r.logs, "全部完成"));
    check("通知只给结论（不带逐轮明细）", !(r.notifies[0].body || "").split("\n").some((l) => l.indexOf("第 ") === 0 && l.indexOf("轮暂无可领") > 0));
  }

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("测试自身异常: ", e);
  process.exit(1);
});
