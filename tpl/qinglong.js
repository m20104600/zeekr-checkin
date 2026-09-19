/**
 * 极氪汽车每日自动签到 · 青龙（Qinglong）版
 * 适用：青龙面板 / 任意 Node.js ≥ 14（Node 18+ 更好，有内置 fetch）
 *
 * ── 部署 ──────────────────────────────────────────────────────────────
 * 1) 把本文件上传到青龙：脚本管理 → 新建脚本 / 或者放进 /ql/scripts/
 *    （也可以在「订阅管理」里订阅存放本文件的仓库，脚本名填 zeekr.qinglong.js）
 * 2) 「定时任务」新建任务：
 *      任务名称: 极氪签到·凌晨场
 *      命令:     task zeekr.qinglong.js
 *      定时规则: 1 0 * * *
 *    再建两条只领取的补领任务（延迟入账的碎片/能量球）：
 *      命令:     task zeekr.qinglong.js
 *      定时规则: 10 0 * * * / 20 8 * * * / 40 21 * * *  (见 README)
 * 3) 「环境变量」添加：
 *      ZEEKR_TOKEN = Bearer eyJ...      ← 必填，多账号用换行 / & 分隔，
 *                                          或 ZEEKR_TOKEN_1、ZEEKR_TOKEN_2 ...
 *      ZEEKR_MODE  = all                ← all | sign | claim（补领任务用 claim）
 *      ZEEKR_TAG   = 凌晨场              ← 只影响通知标题
 *      ZEEKR_POLL  = 0                  ← 1 = 脚本内轮询领光（需放宽任务超时）
 *      ZEEKR_STEPS = 10000              ← 或 off 跳过步数上报
 *      ZEEKR_APPVER= 4.9.33             ← 可选，跳过 iTunes 版本查询
 *      ZEEKR_NOTIFY= 0                  ← 可选，关闭通知
 *    通知默认走青龙自带 sendNotify.js（在 环境变量/通知设置 里配好推送渠道）；
 *    找不到 sendNotify 时可用 ZEEKR_TG_BOT_TOKEN + ZEEKR_TG_CHAT_ID 走 Telegram。
 */

/* 一般不用改这里，参数走环境变量 */
var ZEEKR_DEFAULT_CONFIG = {};

/* ================= 以下为逻辑，一般不需要修改 ================= */

/*__CORE__*/

/* ================= 运行时适配（Node / 青龙） ================= */

var ZEEKR_QL_MODS = (function () {
  var mods = { https: null, http: null };
  try {
    mods.https = require("https");
  } catch (e) {}
  try {
    mods.http = require("http");
  } catch (e2) {}
  return mods;
})();

/** HTTP：优先用 Node 内置 fetch（Node 18+），否则退回 https/http 模块 */
function zeekrQLHttp(o) {
  return new Promise(function (resolve, reject) {
    if (typeof fetch === "function") {
      var ctrl =
        typeof AbortController === "function" ? new AbortController() : null;
      var timer = null;
      if (ctrl && o.timeoutMs)
        timer = setTimeout(function () {
          ctrl.abort();
        }, o.timeoutMs);
      fetch(o.url, {
        method: o.method || "GET",
        headers: o.headers,
        body: o.body === null || o.body === undefined ? undefined : o.body,
        signal: ctrl ? ctrl.signal : undefined,
      })
        .then(function (r) {
          return r.text().then(function (txt) {
            if (timer) clearTimeout(timer);
            resolve({ status: r.status, headers: {}, body: txt });
          });
        })
        .catch(function (e) {
          if (timer) clearTimeout(timer);
          reject(e);
        });
      return;
    }
    var mod = null;
    var isHttp = String(o.url).indexOf("http://") === 0;
    mod = isHttp ? ZEEKR_QL_MODS.http : ZEEKR_QL_MODS.https;
    if (!mod) {
      reject(new Error("Node 环境既没有 fetch 也没有 https 模块"));
      return;
    }
    var u = null;
    try {
      u = new URL(o.url);
    } catch (e1) {
      reject(new Error("URL 解析失败: " + o.url));
      return;
    }
    var req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (isHttp ? 80 : 443),
        path: u.pathname + (u.search || ""),
        method: o.method || "GET",
        headers: o.headers || {},
      },
      function (res) {
        var buf = "";
        res.setEncoding("utf8");
        res.on("data", function (c) {
          buf += c;
        });
        res.on("end", function () {
          resolve({ status: res.statusCode, headers: res.headers, body: buf });
        });
      }
    );
    req.on("error", function (e2) {
      reject(e2);
    });
    if (o.timeoutMs)
      req.setTimeout(o.timeoutMs, function () {
        req.destroy(new Error("请求超时"));
      });
    if (o.body !== null && o.body !== undefined) req.write(o.body);
    req.end();
  });
}

/** 通知：青龙自带 sendNotify.js 优先，其次 Telegram Bot */
async function zeekrQLNotify(title, body) {
  var cands = [];
  if (process.env.QL_DIR) cands.push(process.env.QL_DIR + "/scripts/sendNotify.js");
  cands.push(
    "/ql/scripts/sendNotify.js",
    "/ql/data/scripts/sendNotify.js",
    "/ql/data/scripts/sendNotify/index.js",
    "./sendNotify.js",
    "../sendNotify.js"
  );
  for (var i = 0; i < cands.length; i++) {
    var mod = null;
    try {
      mod = require(cands[i]);
    } catch (e) {
      continue;
    }
    var fn = null;
    if (typeof mod === "function") fn = mod;
    else if (mod && typeof mod.sendNotify === "function") fn = mod.sendNotify;
    else if (mod && typeof mod.default === "function") fn = mod.default;
    if (!fn) continue;
    try {
      var r = fn(title, body);
      if (r && typeof r.then === "function") await r;
      console.log("[极氪签到] 🔔 通知已通过 sendNotify 发送");
      return true;
    } catch (e2) {
      console.log("[极氪签到] ⚠️ sendNotify 发送失败: " + (e2 && e2.message));
    }
  }
  var tk = process.env.ZEEKR_TG_BOT_TOKEN || process.env.TG_BOT_TOKEN || "";
  var cid = process.env.ZEEKR_TG_CHAT_ID || process.env.TG_CHAT_ID || "";
  if (tk && cid) {
    try {
      await zeekrQLHttp({
        method: "POST",
        url: "https://api.telegram.org/bot" + tk + "/sendMessage",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cid, text: title + "\n\n" + body }),
        timeoutMs: 15000,
      });
      console.log("[极氪签到] 🔔 通知已通过 Telegram 发送");
      return true;
    } catch (e3) {
      console.log("[极氪签到] ⚠️ Telegram 通知失败: " + (e3 && e3.message));
    }
  }
  console.log("[极氪签到] ⚠️ 没找到可用的通知渠道（sendNotify.js / Telegram），仅打印日志");
  return false;
}

/** 收集所有账号的 Token（支持 ZEEKR_TOKEN 多行/& 分隔 与 ZEEKR_TOKEN_1、_2 ...） */
function zeekrQLTokens() {
  var keys = [];
  for (var k in process.env) {
    if (!Object.prototype.hasOwnProperty.call(process.env, k)) continue;
    if (/^ZEEKR_TOKEN(_\d+)?$/i.test(k)) keys.push(k);
  }
  keys.sort();
  var list = [];
  for (var i = 0; i < keys.length; i++) {
    var parts = String(process.env[keys[i]] || "").split(/[\r\n&]+/);
    for (var j = 0; j < parts.length; j++) {
      var t = parts[j].trim();
      if (t && t.charAt(0) !== "#") list.push(t);
    }
  }
  return list;
}

/** 兼容写法：zeekr_val / ZEEKR_VAL（值是含 authorization 字段的 JSON 或 Bearer 串） */
function zeekrQLVals() {
  var keys = [];
  for (var k in process.env) {
    if (!Object.prototype.hasOwnProperty.call(process.env, k)) continue;
    if (/^(ZEEKR_)?VAL(_\d+)?$/i.test(k)) keys.push(k);
  }
  keys.sort();
  var list = [];
  for (var i = 0; i < keys.length; i++) {
    var raw = String(process.env[keys[i]] || "").trim();
    if (raw && raw.charAt(0) !== "#") list.push(raw);
  }
  return list;
}

/** 复制全局 ZEEKR_* 环境变量（每个账号一份，互不干扰） */
function zeekrQLBaseEnv() {
  var env = {};
  for (var k in process.env) {
    if (!Object.prototype.hasOwnProperty.call(process.env, k)) continue;
    if (/^ZEEKR/i.test(k)) env[k] = process.env[k];
  }
  return env;
}

(async function () {
  var tokens = zeekrQLTokens();
  var vals = tokens.length ? [] : zeekrQLVals();
  var count = tokens.length || vals.length;

  if (!count) {
    var msg =
      "[极氪签到] ❌ 未找到环境变量 " +
      "ZEEKR_" +
      "TOKEN" +
      "（也没找到 zeekr_val / ZEEKR_VAL）";
    console.log(msg);
    await zeekrQLNotify("❌ 极氪签到未配置", msg);
    process.exit(1);
  }

  var blocks = [];
  var fails = 0;
  for (var i = 0; i < count; i++) {
    var env = zeekrQLBaseEnv();
    if (tokens.length) env.ZEEKR_TOKEN = tokens[i];
    else env.ZEEKR_VAL = vals[i];
    var RT = {
      platform: "青龙",
      tokenHint:
        "❌ 缺少 Token：请在青龙环境变量里配置 ZEEKR_TOKEN（手机抓一次，把通知里那行 Bearer … 复制过来）",
      env: env,
      http: zeekrQLHttp,
      notify: null, // 多个账号合并成一条通知，最后统一发
      log: function (m) {
        console.log(m);
      },
      finish: function () {},
    };
    var r = null;
    try {
      r = await zeekrMain(RT);
    } catch (e) {
      fails++;
      r = {
        ok: false,
        lines: ["[极氪签到] ❌ 执行异常: " + ((e && e.message) || String(e))],
      };
    }
    if (r && r.ok === false) fails++;
    var label =
      count > 1 ? "【账号 " + (i + 1) + "/" + count + "】\n" : "";
    blocks.push(label + (r && r.lines ? r.lines.join("\n") : ""));
  }

  var tag = String(process.env.ZEEKR_TAG || "").trim();
  var title =
    (fails ? "❌" : "✅") +
    " 极氪签到（青龙" +
    (tag ? "·" + tag : "") +
    (count > 1 ? "，" + count + " 个账号" : "") +
    (fails ? "，失败 " + fails + " 个" : "") +
    "）";
  var body = blocks.join("\n──────────\n");
  console.log("\n" + title + "\n" + body);
  if (process.env.ZEEKR_NOTIFY !== "0") await zeekrQLNotify(title, body);
  process.exit(fails ? 1 : 0);
})();
