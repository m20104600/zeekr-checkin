/**
 * 反风控加固回归（**完全离线**，不打真接口）：
 *   ① UA 覆盖 / 内置 H5 UA；② H5 device_id（20 位）与原生身份（读文章/点赞）；
 *   ③ Token 失效即熔断，之后零请求；④ 点赞行为不变；⑤ 秒数参数解析；⑥ 读文章停留。
 *
 * 用法: node tests/hardening.js
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const CODE = fs.readFileSync(path.join(__dirname, "..", "dist", "zeekr.js"), "utf8");

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const FAKE_TOKEN =
  "Bearer " +
  b64({ alg: "none" }) +
  "." +
  b64({
    sub: JSON.stringify({
      accountInfoDTO: { accountId: "2007297210761002944" },
      accountLoginInfoDTO: { lastLoginDeviceId: "DEV-FROM-JWT" },
    }),
    exp: Math.floor(Date.now() / 1000) + 86400 * 30,
  }) +
  "." +
  b64({ sig: "x" });

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

/* 默认路由：一切正常；本周点赞未完成，广场第一页有一条可点赞的帖子 */
function okRouter(p) {
  if (p.indexOf("taskProgress/taskMsg") >= 0)
    return {
      code: "000000",
      data: {
        taskReachMsgList: [
          { name: "阅读文章", doc: { path: "/x?acticleId=A1" } },
          { name: "每周点赞帖子", taskTakeDTO: { currentComplete: 0, maxCompleteLimit: 1 } },
        ],
      },
    };
  if (p.indexOf("invitation/pub/detail") >= 0)
    return { code: "000000", data: { id: "A1", title: "文章A", accountId: 77, isFabulous: 0, invitationType: 2 } };
  if (p.indexOf("invitation/pub/list") >= 0)
    return { code: "000000", data: { list: [{ id: 9, accountId: 8, isFabulous: 0, title: "帖子" }] } };
  if (p.indexOf("getUncollectedBallsPageNew") >= 0) return { code: "000000", data: { uncollectedVal: [] } };
  return { code: "000000", data: {} };
}

/**
 * 跑一次成品脚本。route(path, n) 返回 { status, json }；fastSleep=true 时 sleep 立即返回，
 * 但每次 sleep 的毫秒数都记进 sleeps（停留断言靠它，不靠计时）。
 */
function run(argument, route, fastSleep) {
  const calls = [];
  const logs = [];
  const notifies = [];
  let doneCalled = 0;
  const sleeps = [];
  const realSetTimeout = setTimeout;
  const sbSetTimeout = (fn, ms) => {
    sleeps.push(ms);
    return realSetTimeout(fn, fastSleep ? 0 : ms);
  };
  const reply = (method) => (req, cb) => {
    const p = String(req.url).split("?")[0];
    calls.push({ path: p, method, headers: req.headers || {}, body: req.body });
    const r = route(p, calls.length);
    realSetTimeout(() => cb(null, { status: r.status || 200, headers: {} }, JSON.stringify(r.json)), 0);
  };
  const sandbox = {
    console: { log: (m) => logs.push(String(m)), error: (m) => logs.push("ERR " + String(m)) },
    setTimeout: sbSetTimeout,
    clearTimeout,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  sandbox.fetch = undefined;
  sandbox.$httpClient = { post: reply("POST"), get: reply("GET") };
  const store = {};
  sandbox.$persistentStore = { read: (k) => (k in store ? store[k] : null), write: (v, k) => ((store[k] = v), true) };
  sandbox.$notify = (t, s, b) => notifies.push({ title: t, body: b });
  sandbox.$notification = { post: (t, s, b) => notifies.push({ title: t, body: b }) };
  sandbox.$argument = JSON.stringify(Object.assign({ ZEEKR_TOKEN: FAKE_TOKEN, APPVER: "5.0.7", STEPS: "off", NOTIFY: "1" }, argument));
  sandbox.$done = () => {
    doneCalled++;
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: "zeekr.js" });
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (doneCalled || Date.now() - t0 > 120000) resolve({ calls, logs, notifies, sandbox, sleeps });
      else realSetTimeout(tick, 20);
    };
    tick();
  });
}

const has = (arr, s) => arr.some((l) => l.indexOf(s) >= 0);
const zeekrOnly = (calls) => calls.filter((c) => c.path.indexOf("zeekrlife.com") >= 0);

(async function main() {
  console.log("1. UA 覆盖");
  {
    const a = zeekrOnly((await run({ UA: "UA-FROM-PHONE" }, (p) => ({ json: okRouter(p) }), true)).calls);
    check("配置 UA → 所有请求都用它", a.length > 0 && a.every((c) => c.headers["User-Agent"] === "UA-FROM-PHONE"));
    const b = zeekrOnly((await run({}, (p) => ({ json: okRouter(p) }), true)).calls);
    check("不配 → 内置 H5 UA 带 App 版本", b.length > 0 && b.every((c) => /zeekr_iOS_v5\.0\.7$/.test(c.headers["User-Agent"])));
  }

  console.log("\n2. 签到页 device_id（真机是 H5 生成的 20 位数字）");
  {
    const a = zeekrOnly((await run({ DEVICE_ID: "12345678901234567890" }, (p) => ({ json: okRouter(p) }), true)).calls);
    check("配置 20 位 DEVICE_ID → 原样使用", a.length > 0 && a.every((c) => c.headers.device_id === "12345678901234567890"));
    const b = zeekrOnly((await run({}, (p) => ({ json: okRouter(p) }), true)).calls);
    const b2 = zeekrOnly((await run({}, (p) => ({ json: okRouter(p) }), true)).calls);
    const d = b[0] && b[0].headers.device_id;
    check("不配 → 20 位数字", /^\d{20}$/.test(d || ""), d);
    check("不配 → 同账号两次运行一致", b.concat(b2).every((c) => c.headers.device_id === d));
    const c = zeekrOnly((await run({ DEVICE_ID: "DEV-NOT-20-DIGITS" }, (p) => ({ json: okRouter(p) }), true)).calls);
    check("非 20 位数字的 DEVICE_ID 不用于 H5（改用派生值）", c.every((x) => x.headers.device_id === d));
  }

  console.log("\n2b. 原生身份（读文章 / 点赞）");
  {
    const SECRET = "TEST-APP-SECRET";
    const NATIVE = ["invitation/pub/detail", "clicks/fabulous", "behaviorTrack", "comment/pub/list", "invitation/pub/recommend"];
    const isNative = (c) => NATIVE.some((s) => c.path.indexOf(s) >= 0);
    const r = await run({ APP_SECRET: SECRET, PHONE_MODEL: "iPhone17,1", IOS_VERSION: "26.0" }, (p) => ({ json: okRouter(p) }), true);
    const calls = zeekrOnly(r.calls);
    const nat = calls.filter(isNative);
    check("五个原生接口都调到了", NATIVE.every((s) => nat.some((c) => c.path.indexOf(s) >= 0)), nat.map((c) => c.path.split("/").pop()).join(","));
    check("原生请求用 APP-SIGN-SECRET-KEY / toc_ios_zeekrapp", nat.every((c) => c.headers.x_ca_key === "APP-SIGN-SECRET-KEY" && c.headers.app_code === "toc_ios_zeekrapp"));
    check("原生 device_id = Token 里的 lastLoginDeviceId", nat.every((c) => c.headers.device_id === "DEV-FROM-JWT"));
    check("原生 UA 格式", nat.every((c) => c.headers["User-Agent"] === "ZeekrLife/5.0.7 (iPhone; iOS 26.0; Scale/3.00)DEV-FROM-JWT"), nat[0] && nat[0].headers["User-Agent"]);
    const crypto = require("crypto");
    check("原生签名 = sha1(sorted[secret, nonce, ts])", nat.every((c) => {
      const h = c.headers;
      return /^\d{8}$/.test(h.x_ca_nonce) && h.x_ca_sign === crypto.createHash("sha1").update([SECRET, h.x_ca_nonce, h.x_ca_timestamp].sort().join("")).digest("hex");
    }));
    check("H5 接口仍是 H5 身份", calls.filter((c) => !isNative(c)).every((c) => c.headers.x_ca_key === "H5-SIGN-SECRET-KEY" && c.headers.Origin === "https://activity-h5.zeekrlife.com"));
    check("调用链顺序 behaviorTrack → detail → 评论 → 推荐 → 点赞", (() => {
      const seq = nat.map((c) => NATIVE.findIndex((s) => c.path.indexOf(s) >= 0));
      return JSON.stringify(seq) === JSON.stringify([2, 0, 3, 4, 1]);
    })(), nat.map((c) => c.path.split("/").pop()).join(" → "));
    const fab = r.calls.find((c) => c.path.indexOf("clicks/fabulous") >= 0);
    check("点赞点的是刚读的那篇（moduleId=A1，不再去广场找）", fab && JSON.parse(fab.body).moduleId === "A1" && !r.calls.some((c) => c.path.indexOf("invitation/pub/list") >= 0), fab && fab.body);

    const liked = await run({ APP_SECRET: SECRET }, (p) => ({
      json: p.indexOf("invitation/pub/detail") >= 0 ? { code: "000000", data: { id: "A1", accountId: 77, isFabulous: 1 } } : okRouter(p),
    }), true);
    check("文章已赞过 → 退回广场找一篇", liked.calls.some((c) => c.path.indexOf("invitation/pub/list") >= 0));

    const old = zeekrOnly((await run({}, (p) => ({ json: okRouter(p) }), true)).calls);
    check("不配 APP_SECRET → 读文章用 H5 身份、不调额外原生接口（向后兼容）",
      old.filter((c) => c.path.indexOf("invitation/pub/detail") >= 0).every((c) => c.headers.x_ca_key === "H5-SIGN-SECRET-KEY") &&
      !old.some((c) => /behaviorTrack|comment\/pub\/list|pub\/recommend/.test(c.path)));
  }

  console.log("\n2c. 按接口带头 / 调用顺序");
  {
    const r = await run({ STEPS: "12000" }, (p) => ({
      json: p.indexOf("getUncollectedBallsPageNew") >= 0
        ? { code: "000000", data: { uncollectedVal: [{ id: "D1", valDefineCode: "DEBRIS", eventCode: "E1", sourceId: "x" }] } }
        : p.indexOf("batchApply") >= 0 ? { code: "000000", data: [{ success: true }] } : okRouter(p),
    }), true);
    const calls = zeekrOnly(r.calls);
    const last = (c) => c.path.split("/").pop();
    check("x_gray_code 只出现在步数/能量接口", calls.filter((c) => "x_gray_code" in c.headers).every((c) => /initDayWalkData|getUncollectedBallsPageNew/.test(c.path)) && calls.some((c) => "x_gray_code" in c.headers));
    check("riskVersion 只出现在 batchApply", calls.filter((c) => "riskVersion" in c.headers).map(last).join() === "batchApply", calls.filter((c) => "riskVersion" in c.headers).map(last).join());
    check("GET 不带 Content-Type", calls.filter((c) => c.method === "GET").every((c) => !("Content-Type" in c.headers)) && calls.some((c) => c.method === "GET"));
    check("H5 带 Sec-Fetch-* 与 Priority", calls.every((c) => c.headers["Sec-Fetch-Mode"] === "cors" && c.headers.Priority === "u=3, i"));
    const seq = calls.map(last);
    check("festival 在签到之前", seq.indexOf("festival") >= 0 && seq.indexOf("festival") < seq.indexOf("center"), seq.join(","));
    check("每次 taskMsg 前都有 taskGet", seq.every((s, i) => s !== "taskMsg" || seq[i - 1] === "taskGet"));
    const walk = r.calls.find((c) => c.path.indexOf("initDayWalkData") >= 0);
    check("步数请求体字段顺序与真机一致", walk && Object.keys(JSON.parse(walk.body)).join() === "accountId,stepCountsSecret,stepCounts,sourceType", walk && walk.body);
  }

  console.log("\n2c2. 步数当天固定（同一天不会变少）");
  {
    const stepsOf = (r) => {
      const w = r.calls.find((c) => c.path.indexOf("initDayWalkData") >= 0);
      return w && JSON.parse(w.body).stepCounts;
    };
    const ok = (p) => ({ json: okRouter(p) });
    const s1 = stepsOf(await run({ STEPS: "" }, ok, true));
    const s2 = stepsOf(await run({ STEPS: "" }, ok, true));
    const s3 = stepsOf(await run({ STEPS: "10000-20000" }, ok, true));
    check("默认范围内（10000~20000）", s1 >= 10000 && s1 <= 20000, String(s1));
    check("同一天两次运行步数相同", s1 === s2 && s2 === s3, [s1, s2, s3].join(","));
    check("固定整数仍原样上报", stepsOf(await run({ STEPS: "12345" }, ok, true)) === 12345);
  }

  console.log("\n2d. 与真机 HAR 的签名比对（设置 ZEEKR_HAR 时才跑）");
  {
    const harPath = process.env.ZEEKR_HAR || "";
    if (!harPath || !fs.existsSync(harPath)) console.log("  ⏭  未设置 ZEEKR_HAR（真机抓包 HAR 路径），跳过");
    else {
      const crypto = require("crypto");
      const sha = (a) => crypto.createHash("sha1").update(a.sort().join("")).digest("hex");
      const H5S = /var ZEEKR_SECRET = "([^"]+)"/.exec(CODE)[1];
      const ents = JSON.parse(fs.readFileSync(harPath, "utf8")).log.entries
        .filter((e) => e.request.url.indexOf("api-gw-toc.zeekrlife.com") >= 0 && e.request.method !== "OPTIONS" && e.request.method !== "CONNECT")
        .map((e) => Object.fromEntries(e.request.headers.map((h) => [h.name.toLowerCase(), h.value])));
      const h5 = ents.filter((h) => h.x_ca_key === "H5-SIGN-SECRET-KEY");
      const nat = ents.filter((h) => h.x_ca_key === "APP-SIGN-SECRET-KEY");
      check("真机 H5 签名全部能复算", h5.length > 0 && h5.every((h) => sha([H5S, h.x_ca_nonce, h.x_ca_timestamp]) === h.x_ca_sign));
      check("真机原生签名全部能用 x_ca_secret 复算", nat.length > 0 && nat.every((h) => sha([h.x_ca_secret, h.x_ca_nonce, h.x_ca_timestamp]) === h.x_ca_sign));
    }
  }

  console.log("\n3. Token 失效熔断");
  {
    /* 第 3 个极氪请求开始返回登录失效 */
    let n = 0;
    const r = await run({ MODE: "all" }, (p) => {
      if (p.indexOf("zeekrlife.com") >= 0) n++;
      return n >= 3 ? { json: { code: "401", msg: "登录已失效" } } : { json: okRouter(p) };
    }, true);
    check("失效后不再发出任何请求", zeekrOnly(r.calls).length === 3, String(zeekrOnly(r.calls).length));
    check("日志写明停止原因", has(r.logs, "检测到登录失效"));
    check("通知标题是「Token 失效」", r.notifies.length === 1 && r.notifies[0].title.indexOf("Token 失效") >= 0, r.notifies[0] && r.notifies[0].title);
    check("没有写「🎉 全部完成！」", !has(r.logs, "🎉 全部完成！"));

    const s = await run({ MODE: "claim" }, () => ({ status: 401, json: { code: "x" } }), true);
    check("HTTP 401 也触发熔断（只发 1 个请求）", zeekrOnly(s.calls).length === 1, String(zeekrOnly(s.calls).length));

    const ok = await run({ MODE: "all" }, (p) => ({ json: p.indexOf("invitation/pub/detail") >= 0 ? { code: "500", msg: "系统繁忙" } : okRouter(p) }), true);
    check("普通业务报错不触发熔断", !has(ok.logs, "检测到登录失效") && has(ok.logs, "🎉 全部完成！"));
  }

  console.log("\n4. 点赞行为不变");
  {
    const r = await run({}, (p) => ({ json: okRouter(p) }), true);
    check("本周未点赞 → 仍会请求 /clicks/fabulous", r.calls.some((c) => c.path.indexOf("clicks/fabulous") >= 0));
  }

  console.log("\n5. 秒数参数解析");
  {
    const sb = (await run({ MODE: "claim" }, (p) => ({ json: okRouter(p) }), true)).sandbox;
    const f = (v) => vm.runInContext("zeekrResolveSeconds(" + JSON.stringify(v) + ", 120)", sb);
    check("空 → 0", f("") === 0);
    check("off → 0", f("off") === 0);
    check("5 → 5", f("5") === 5);
    let inRange = true;
    for (let i = 0; i < 50; i++) {
      const v = f("8-20");
      if (v < 8 || v > 20) inRange = false;
    }
    check("8-20 → 落在 [8,20]", inRange);
    check("999 → 封顶 120", f("999") === 120);
    check("20-8（反向）→ 0", f("20-8") === 0);
  }

  console.log("\n6. 读文章停留");
  {
    /* 37 秒这个值不会和脚本里任何随机间隔（都 < 5 秒）撞上 */
    const a = await run({ MODE: "sign", READWAIT: "37" }, (p) => ({ json: okRouter(p) }), true);
    check("READWAIT=37 → 读文章后 sleep 37000ms", a.sleeps.indexOf(37000) >= 0, a.sleeps.join(","));
    const b = await run({ MODE: "sign" }, (p) => ({ json: okRouter(p) }), true);
    check("不配 → 没有 ≥5s 的停留", b.sleeps.every((ms) => !(ms >= 5000)), b.sleeps.join(","));
  }

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
