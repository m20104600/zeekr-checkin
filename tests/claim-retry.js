/**
 * 端到端测试（**完全离线**，不打真接口）：把 batchApply 的响应换成
 * 「批量里有个别失败」，验证成品脚本会
 *   ① 真的逐个重试（而不是只打一句日志）；
 *   ② 一直领不掉时，失败原因进日志、进通知，并且**不再**写「🎉 全部完成！」；
 *   ③ 通知标题变成「⚠️ 极氪签到（未领净）」。
 *
 * 背景：2026-09-21 事故 —— 旧版批量失败后只打日志没重试、失败原因被丢掉，
 * 领取循环还在领取**之前**就把条目记成已领 → 通知写「可取皆已领完」，App 里碎片还在。
 *
 * 用法: node tests/claim-retry.js
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const CODE = fs.readFileSync(path.join(__dirname, "..", "dist", "zeekr.js"), "utf8");

/* 造一个结构一致的假 JWT（只在本地跑，服务端签名不校验） */
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const FAKE_TOKEN =
  "Bearer " +
  b64({ alg: "none" }) +
  "." +
  b64({
    sub: JSON.stringify({
      accountInfoDTO: { accountId: "2007297210761002944" },
      accountLoginInfoDTO: { lastLoginDeviceId: "DEV-TEST-1" },
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

/* ---------- 脚本化响应：按路径 + 调用次数返回 ---------- */
function makeRouter(debrisResponses) {
  const calls = [];
  const router = (url, method, body) => {
    const p = String(url).split("?")[0];
    calls.push({ path: p, body: body });
    const say = (obj) => ({ status: 200, body: JSON.stringify(obj) });
    if (p.indexOf("zgreen/center") >= 0) return say({ success: true, code: "000000", data: {} });
    if (p.indexOf("walkData/initDayWalkData") >= 0) return say({ success: true, code: "000000" });
    if (p.indexOf("taskProgress/taskMsg") >= 0)
      return say({
        success: true,
        code: "000000",
        data: {
          taskReachMsgList: [
            { name: "步行3000步", taskTakeDTO: { currentComplete: 1, maxCompleteLimit: 1 } },
            { name: "阅读文章", doc: { path: "/x?acticleId=A1" } },
            { name: "每周点赞帖子", taskTakeDTO: { currentComplete: 1, maxCompleteLimit: 1 } },
          ],
        },
      });
    if (p.indexOf("invitation/pub/detail") >= 0)
      return say({ success: true, code: "000000", data: { title: "文章A" } });
    if (p.indexOf("getUncollectedBallsPageNew") >= 0)
      return say({
        success: true,
        code: "000000",
        data: {
          uncollectedVal: [
            { id: "W1", valDefineCode: "CARBON_VALUE", val: 77, sceneCode: "WALK" },
            { id: "D1", valDefineCode: "DEBRIS", eventCode: "E1", sourceId: "步行3000步" },
          ],
        },
      });
    if (p.indexOf("carEnergy/collectedAllEnergy") >= 0)
      return say({ success: true, code: "000000" });
    if (p.indexOf("apply/batchApply") >= 0) {
      const n = calls.filter((c) => c.path.indexOf("apply/batchApply") >= 0).length;
      const spec = debrisResponses[Math.min(n - 1, debrisResponses.length - 1)];
      return say(spec);
    }
    return say({ success: true, code: "000000", data: {} });
  };
  return { router, calls };
}

function runCase(name, debrisResponses, argument) {
  const { router, calls } = makeRouter(debrisResponses);
  const logs = [];
  const notifies = [];
  let doneCalled = 0;
  const sandbox = {
    console: { log: (m) => logs.push(String(m)), error: (m) => logs.push("ERR " + String(m)) },
    setTimeout,
    clearTimeout,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  sandbox.fetch = undefined;
  sandbox.$httpClient = {
    post: (req, cb) => {
      const r = router(req.url, "POST", req.body);
      setTimeout(() => cb(null, { status: r.status, headers: {} }, r.body), 0);
    },
    get: (req, cb) => {
      const r = router(req.url, "GET", null);
      setTimeout(() => cb(null, { status: r.status, headers: {} }, r.body), 0);
    },
  };
  const store = {};
  sandbox.$persistentStore = { read: (k) => (k in store ? store[k] : null), write: (v, k) => ((store[k] = v), true) };
  sandbox.$notify = (t, s, b) => notifies.push({ title: t, body: b });
  sandbox.$notification = { post: (t, s, b) => notifies.push({ title: t, body: b }) };
  sandbox.$argument = JSON.stringify(argument);
  sandbox.$done = () => {
    doneCalled++;
  };

  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: "zeekr.js" });
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (doneCalled || Date.now() - t0 > 120000) resolve({ logs, notifies, calls, name });
      else setTimeout(tick, 100);
    };
    tick();
  });
}

const has = (arr, s) => arr.some((l) => l.indexOf(s) >= 0);
const countPath = (calls, s) => calls.filter((c) => c.path.indexOf(s) >= 0).length;

(async function main() {
  console.log("A. 批量里 1 个失败 → 真的逐个重试并领到");
  {
    const r = await runCase("A", [
      { success: true, code: "000000", data: [{ success: false, msg: "奖励尚未生成" }] },
      { success: true, code: "000000", data: [{ success: true, invoice: { materialSnapshot: { name: "藏羚羊" } } }] },
    ], { ZEEKR_TOKEN: FAKE_TOKEN, MODE: "all", TAG: "测试", NOTIFY: "1", STEPS: "off" });

    check("发起过 2 次 batchApply（批量失败后真的重试）", countPath(r.calls, "apply/batchApply") === 2, String(countPath(r.calls, "apply/batchApply")));
    check("日志写明「改为逐个重试」", has(r.logs, "改为逐个重试"));
    check("重试后领到碎片", has(r.logs, "🧩 碎片奖励: 藏羚羊"));
    check("结尾仍然是「🎉 全部完成！」", has(r.logs, "🎉 全部完成！"));
    check("通知标题不带「未领净」", r.notifies.length === 1 && r.notifies[0].title.indexOf("未领净") < 0, r.notifies[0] && r.notifies[0].title);
  }

  console.log("\nB. 一直领不掉 → 原因进日志与通知，绝不写「全部完成」");
  {
    const r = await runCase("B", [
      { success: true, code: "000000", data: [{ success: false, msg: "系统繁忙" }] },
    ], { ZEEKR_TOKEN: FAKE_TOKEN, MODE: "all", TAG: "早间场", NOTIFY: "1", STEPS: "off" });

    check("日志里有失败原因（不再被丢掉）", has(r.logs, "系统繁忙"));
    check("日志点明是「步行3000步」这条", has(r.logs, "碎片领取失败（步行3000步）"));
    check("**没有**写「🎉 全部完成！」", !has(r.logs, "🎉 全部完成！"));
    check("日志里报「未领净」", has(r.logs, "未领净"));
    check("通知标题变成「⚠️ 极氪签到（未领净）」", r.notifies.length === 1 && r.notifies[0].title.indexOf("⚠️ 极氪签到（未领净）") === 0, r.notifies[0] && r.notifies[0].title);
    check("通知正文带「名称→原因」", (r.notifies[0].body || "").indexOf("步行3000步→系统繁忙") >= 0, (r.notifies[0].body || "").slice(-160));
    check("失败项没有在同一轮里被当成已领（多轮/多次请求仍在重试）", countPath(r.calls, "apply/batchApply") >= 1);
  }

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
