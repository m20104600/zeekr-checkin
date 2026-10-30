/**
 * 极氪汽车每日自动签到 · 青龙（Qinglong）版
 * 适用：青龙面板 / 任意 Node.js ≥ 14（Node 18+ 更好，有内置 fetch）
 *
 * ── 部署 ──────────────────────────────────────────────────────────────
 * 推荐：按 README 的「青龙订阅」说明订阅仓库，白名单填 zeekr_.*\.js$。
 * 订阅会下载 qinglong/ 下六个独立入口并自动建六条任务，无需手工填写六次。
 * 每条任务自带 all/claim 模式；时间在青龙「定时任务」编辑，不修改脚本。
 * 本通用文件 dist/zeekr.qinglong.js 保留给手动部署/任意 Node.js 使用：
 *   上传本地脚本后以 task zeekr.qinglong.js 执行；不要把脚本网址当命令。
 *   手动模式的 ZEEKR_MODE / ZEEKR_TAG 仍由环境变量控制。
 * 「环境变量」添加：
 *      ZEEKR_TOKEN = Bearer eyJ...      ← 必填，多账号用换行 / & 分隔，
 *                                          或 ZEEKR_TOKEN_1、ZEEKR_TOKEN_2 ...
 *      ZEEKR_MODE  = all                ← all | sign | claim（补领任务用 claim）
 *      ZEEKR_TAG   = 凌晨场              ← 只影响通知标题
 *      ZEEKR_POLL  = 0                  ← 1 = 脚本内轮询领光（需放宽任务超时）
 *      ZEEKR_STEPS = 10000-20000        ← 可选；默认每轮随机，off 跳过步数上报
 *      ZEEKR_APPVER= 4.9.33             ← 可选，跳过 iTunes 版本查询
 *      ZEEKR_NOTIFY= 0                  ← 可选，关闭通知
 *      ZEEKR_NICKNAME_1 = 家用车        ← 可选，TOKEN_1 / VAL_1 对应的通知昵称
 *      ZEEKR_NICKNAMES = ["家用车","通勤"] ← 可选，JSON 数组按账号执行顺序匹配
 *    昵称优先级：对应编号 NICKNAME_n > NICKNAMES 数组 > JWT sub 中
 *    accountInfoDTO.nickname > accountInfoDTO.userName；空值跳过，不查资料接口。
 *    无编号的 TOKEN 多账号按执行位置使用 NICKNAME_1、_2 ...；有编号时按源编号。
 *    执行顺序沿用环境变量名排序、再按行/& 拆分；昵称显示在完整账号 ID 后。
 *    昵称移除换行/控制字符/通知标题括号，最多显示 40 个 Unicode 字符。
 *    通知默认走青龙自带 sendNotify.js（在 环境变量/通知设置 里配好推送渠道）；
 *    找不到 sendNotify 时可用 ZEEKR_TG_BOT_TOKEN + ZEEKR_TG_CHAT_ID 走 Telegram。
 */

/* 一般不用改这里，参数走环境变量 */
var ZEEKR_DEFAULT_CONFIG = {};

// Generated subscription entrypoints pin mode/tag; the generic manual script does not.
var ZEEKR_QL_SCHEDULE = /*__QL_SCHEDULE__*/null;

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
        redirect: o.noRedirect ? "error" : "follow",
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
      if (t && t.charAt(0) !== "#") list.push({ raw: t, index: (keys[i].match(/_(\d+)$/) || [])[1] || "" });
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
    if (raw && raw.charAt(0) !== "#") list.push({ raw: raw, index: (keys[i].match(/_(\d+)$/) || [])[1] || "" });
  }
  return list;
}

/** 通知身份仅本地解析 JWT，不请求用户资料，也不输出原始凭据。 */
function zeekrQLDisplayText(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return Array.from(String(value)
    .replace(/[\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/[【】]/g, " ")
    .replace(/\s+/g, " ").trim()).slice(0, 40).join("");
}

function zeekrQLIdentity(raw) {
  var token = String(raw || "").trim();
  try {
    if (token.charAt(0) === "{") {
      var stored = JSON.parse(token);
      token = stored.authorization || stored.Authorization || stored.token || stored.TOKEN || stored.ZEEKR_TOKEN || "";
    }
    var part = String(token).replace(/^Bearer\s+/i, "").split(".")[1];
    var preserveId = function (text) {
      // accountId can be an unquoted 64-bit integer: quote it BEFORE JSON.parse.
      return text.replace(/("accountId"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"');
    };
    var payload = JSON.parse(preserveId(Buffer.from(part, "base64").toString("utf8")));
    var sub = typeof payload.sub === "string" ? JSON.parse(preserveId(payload.sub)) : payload.sub;
    var info = sub && sub.accountInfoDTO || {};
    var id = String(info.accountId || "");
    return {
      accountId: /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : "",
      nickname: zeekrQLDisplayText(info.nickname) || zeekrQLDisplayText(info.userName),
    };
  } catch (e) {
    return { accountId: "", nickname: "" };
  }
}

/** Optional privacy-preserving per-account result reporting. Never send tokens or raw logs. */
async function zeekrQLReport(accountId, result) {
  var url = process.env.ZEEKR_REPORT_URL || "";
  var key = process.env.ZEEKR_REPORT_KEY || "";
  if (!url || !key || !/^\d{1,30}$/.test(accountId)) return;
  try {
    var dest = new URL(url);
    if (dest.protocol !== "https:" || dest.username || dest.password || dest.search || dest.hash || dest.pathname !== "/api/report") return;
    var rawTag = String(ZEEKR_QL_SCHEDULE ? ZEEKR_QL_SCHEDULE.tag : (process.env.ZEEKR_TAG || ""));
    var tagMap = {"凌晨场":"凌晨场", "早间场":"早间场", "晚间场":"晚间场", "凌晨场·补领":"凌晨补领", "早间场·补领":"早间补领", "晚间场·补领":"晚间补领"};
    var tag = tagMap[rawTag] || "其他";
    var outcome = !result || result.ok !== true ? "error" : (result.result && Array.isArray(result.result.failed) && result.result.failed.length ? "partial" : "ok");
    var details = result && result.result;
    var number = function (value) { return Number.isSafeInteger(value) && value >= 0 && value < 1000000; };
    var summary = details && number(details.debrisCount) && number(details.walkVal) ? "碎片 " + details.debrisCount + "，能量 " + details.walkVal + "，未领 " + (Array.isArray(details.failed) ? Math.min(details.failed.length, 9999) : 0) : (outcome === "error" ? "执行失败" : "结果不完整");
    var response = await zeekrQLHttp({method: "POST", url: dest.href, noRedirect: true, headers: {"Content-Type": "application/json", "X-Report-Key": key}, body: JSON.stringify({account: accountId, tag: tag, state: outcome, summary: summary}), timeoutMs: 3000});
    if (response.status < 200 || response.status >= 300) throw new Error("report rejected");
  } catch (e) {
    console.log("[极氪签到] ⚠️ 个人记录同步失败（不影响签到）");
  }
}

/** 复制全局 ZEEKR_* 环境变量（每个账号一份，互不干扰） */
function zeekrQLBaseEnv() {
  var env = {};
  for (var k in process.env) {
    if (!Object.prototype.hasOwnProperty.call(process.env, k)) continue;
    // Credentials are injected below, never leave a global alias that can win
    // core's case-insensitive normalization for a different indexed account.
    if (/^ZEEKR_TOKEN(_\d+)?$/i.test(k) || /^(ZEEKR_)?VAL(_\d+)?$/i.test(k)) continue;
    if (/^ZEEKR/i.test(k)) env[k] = process.env[k];
  }
  if (ZEEKR_QL_SCHEDULE) {
    // Remove accepted case/separator aliases before pinning this task's mode.
    // Never mutate process.env or affect another task/account's configuration.
    for (var name in env) {
      if (!Object.prototype.hasOwnProperty.call(env, name)) continue;
      var normalized = zeekrNormKey(name);
      if (normalized === "MODE" || normalized === "TAG") delete env[name];
    }
    env.ZEEKR_MODE = ZEEKR_QL_SCHEDULE.mode;
    env.ZEEKR_TAG = ZEEKR_QL_SCHEDULE.tag;
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

  var nicknames = [];
  try {
    var parsedNames = JSON.parse(process.env.ZEEKR_NICKNAMES || "[]");
    if (Array.isArray(parsedNames)) nicknames = parsedNames;
  } catch (e) {} // Invalid optional nickname JSON must never block account execution.
  var blocks = [];
  var fails = 0;
  for (var i = 0; i < count; i++) {
    var env = zeekrQLBaseEnv();
    var account = tokens.length ? tokens[i] : vals[i];
    if (tokens.length) env.ZEEKR_TOKEN = account.raw;
    else env.ZEEKR_VAL = account.raw;
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
    var identity = zeekrQLIdentity(account.raw);
    await zeekrQLReport(identity.accountId, r);
    // Explicit suffix matches TOKEN_n / VAL_n; unindexed input uses run position.
    // Then the JSON array (run order), then JWT nickname / userName.
    var nickname = zeekrQLDisplayText(process.env["ZEEKR_NICKNAME_" + (account.index || (i + 1))]) ||
      zeekrQLDisplayText(nicknames[i]) || identity.nickname;
    var detail = [identity.accountId, nickname].filter(function (s) { return !!s; }).join(" ");
    var label = "【账号 " + (i + 1) + "/" + count + (detail ? " · " + detail : "") + "】\n";
    blocks.push(label + (r && r.lines ? r.lines.join("\n") : ""));
  }

  var tag = String(
    ZEEKR_QL_SCHEDULE ? ZEEKR_QL_SCHEDULE.tag : (process.env.ZEEKR_TAG || "")
  ).trim();
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
