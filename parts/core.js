/* ==========================================================================
 * 极氪签到 · 核心逻辑（运行时无关）
 * 本文件由 build.py 内联进各个客户端模板，不要单独运行。
 * 依赖注入：RT = { platform, env, http(), notify(), log(), finish() }
 * ========================================================================== */

var ZEEKR_PORT_VERSION = "2.0.0";
/* 签名密钥由 build.py 从本地 checkin.mjs 抽取后注入（避免密钥出现在源码/终端里被安全屏蔽器打码） */
var ZEEKR_SECRET = "__ZEEKR_SECRET__";
var ZEEKR_BASE = "https://api-gw-toc.zeekrlife.com";
var ZEEKR_API = {
  signIn: "/zeekrlife-mp-val/toc/v1/zgreen/center",
  taskMsg: "/zeekrlife-mp-mkt/open/v1/taskProgress/taskMsg",
  walkData: "/zeekrlife-mp-val/v1/walkData/initDayWalkData",
  articleDetail: "/zeekrlife-bbs-theme/v1/invitation/pub/detail",
  squareList: "/zeekrlife-bbs-theme/v1/invitation/pub/list",
  fabulous: "/zeekrlife-bbs-theme/v1/clicks/fabulous",
  uncollected: "/zeekrlife-mp-val/v1/carEnergy/getUncollectedBallsPageNew",
  claimDebris: "/zeekrlife-mp-mkt/toc/v1/apply/batchApply",
  claimWalk: "/zeekrlife-mp-val/v1/carEnergy/collectedAllEnergy",
  claimIntegral: "/zeekrlife-mp-val/v1/carEnergy/collectIntegralZeekrBalls",
};
var ZEEKR_VAL_DEBRIS = "DEBRIS";
var ZEEKR_VAL_WALK = "CARBON_VALUE";
var ZEEKR_VAL_INTEGRAL = "ZEEKR_VALUE";
var ZEEKR_TASK_ARTICLE = "阅读文章";
var ZEEKR_TASK_WALK = "步行3000步";
var ZEEKR_TASK_PRAISE = "每周点赞帖子";

/* ---------------- 基础工具（纯 JS，不依赖任何客户端 API） ---------------- */

var ZEEKR__B64C =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function zeekrUtf8Bytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c <= 0xdbff) {
      var c2 = str.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63)
      );
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function zeekrUtf8Decode(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; ) {
    var c = bytes[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0)
      s += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
    else if (c < 0xf0)
      s += String.fromCharCode(
        ((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63)
      );
    else {
      var cp =
        ((c & 7) << 18) |
        ((bytes[i++] & 63) << 12) |
        ((bytes[i++] & 63) << 6) |
        (bytes[i++] & 63);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    }
  }
  return s;
}

/** base64 编码（标准字母表 + 补 =，与 Node Buffer.toString("base64") 一致） */
function zeekrB64Encode(str) {
  var b = zeekrUtf8Bytes(str);
  var out = "";
  for (var i = 0; i < b.length; i += 3) {
    var n = b[i] << 16;
    var rem = b.length - i - 1;
    if (rem >= 1) n |= b[i + 1] << 8;
    if (rem >= 2) n |= b[i + 2];
    out += ZEEKR__B64C.charAt((n >> 18) & 63);
    out += ZEEKR__B64C.charAt((n >> 12) & 63);
    out += rem >= 1 ? ZEEKR__B64C.charAt((n >> 6) & 63) : "=";
    out += rem >= 2 ? ZEEKR__B64C.charAt(n & 63) : "=";
  }
  return out;
}

/** base64 解码为 UTF-8 字符串，兼容 JWT 的 base64url 与缺失补位 */
function zeekrB64Decode(str) {
  str = String(str)
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  var out = [];
  var buf = 0;
  var bits = 0;
  for (var i = 0; i < str.length; i++) {
    if (str.charAt(i) === "=") break;
    var idx = ZEEKR__B64C.indexOf(str.charAt(i));
    if (idx < 0) continue;
    buf = (buf << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return zeekrUtf8Decode(out);
}

/** SHA1（hex），与 Node crypto.createHash("sha1") 等价 —— 各客户端没有 crypto */
function zeekrSha1Hex(str) {
  var bytes = zeekrUtf8Bytes(str);
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0);
  bytes.push(
    (bitLen >>> 24) & 255,
    (bitLen >>> 16) & 255,
    (bitLen >>> 8) & 255,
    bitLen & 255
  );

  var h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  var w = new Array(80);

  for (var i = 0; i < bytes.length; i += 64) {
    for (var j = 0; j < 16; j++) {
      w[j] =
        (bytes[i + 4 * j] << 24) |
        (bytes[i + 4 * j + 1] << 16) |
        (bytes[i + 4 * j + 2] << 8) |
        bytes[i + 4 * j + 3];
    }
    for (var j2 = 16; j2 < 80; j2++) {
      var n = w[j2 - 3] ^ w[j2 - 8] ^ w[j2 - 14] ^ w[j2 - 16];
      w[j2] = ((n << 1) | (n >>> 31)) >>> 0;
    }
    var a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (var k = 0; k < 80; k++) {
      var f, kk;
      if (k < 20) {
        f = (b & c) | (~b & d);
        kk = 0x5a827999;
      } else if (k < 40) {
        f = b ^ c ^ d;
        kk = 0x6ed9eba1;
      } else if (k < 60) {
        f = (b & c) | (b & d) | (c & d);
        kk = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        kk = 0xca62c1d6;
      }
      var t =
        ((((a << 5) | (a >>> 27)) >>> 0) + (f >>> 0) + e + kk + (w[k] >>> 0)) >>>
        0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  var hex = function (x) {
    var s = x.toString(16);
    while (s.length < 8) s = "0" + s;
    return s;
  };
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
}

function zeekrSleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}
function zeekrRand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function zeekrRandomString(len) {
  var chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz1234567890";
  var s = "";
  for (var i = 0; i < len; i++)
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function zeekrPad2(n) {
  return n < 10 ? "0" + n : String(n);
}
/** 北京时间字符串，不依赖 Intl / 时区设置 */
function zeekrNowCST() {
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  return (
    d.getUTCFullYear() +
    "/" +
    (d.getUTCMonth() + 1) +
    "/" +
    d.getUTCDate() +
    " " +
    zeekrPad2(d.getUTCHours()) +
    ":" +
    zeekrPad2(d.getUTCMinutes()) +
    ":" +
    zeekrPad2(d.getUTCSeconds())
  );
}
function zeekrCSTDate(ms) {
  var d = new Date(ms + 8 * 3600 * 1000);
  return (
    d.getUTCFullYear() + "/" + (d.getUTCMonth() + 1) + "/" + d.getUTCDate()
  );
}

/* ---------------- 参数读取 ---------------- */

/**
 * 清洗 Token：用户到处复制粘贴，常见带单/双引号、首尾空格、零宽字符
 * （零宽空格 U+200B、BOM U+FEFF、双向标记 U+200E/F 等），
 * 青龙环境变量里还经常写 ZEEKR_TOKEN="Bearer ..."，这里统一收拾干净。
 * 顺带：只粘了裸 JWT（没带 Bearer 前缀）也自动补上。
 */
function zeekrCleanToken(t) {
  var s = String(t == null ? "" : t);
  s = s.replace(/[\u200b-\u200f\ufeff\u2060\u00a0\t\r\n]/g, " ");
  s = s.replace(/^[\s"']+|[\s"']+$/g, "");
  var i = s.search(/Bearer\s/i);
  if (i > 0) s = s.slice(i);
  s = s.replace(/\s+/g, " ").trim();
  if (s && !/^Bearer\s/i.test(s) && /^eyJ[\w-]+\.[\w-]+\./.test(s))
    s = "Bearer " + s;
  // 极氪的 Token 一定是 JWT（脚本要用里面的 accountId / deviceId）。
  // 这里做一次校验，好处是：插件/配置里没替换掉的占位符（如 ${TOKEN}、<粘贴你的Token>）
  // 会被当成"没配 Token"，走自动抓取的兜底，而不是发一个假 Token 出去变成"登录已失效"。
  if (s && !/^Bearer\s+[\w-]+\.[\w-]+\.[\w-]*$/.test(s)) return "";
  return s;
}

/**
 * 从「存量字符串」里取出 Token。兼容常见极氪脚本（如 wf021325/qx）的存储格式：
 *   {"authorization":"Bearer eyJ..."}（键名 zeekr_val / ZEEKR_VAL）
 *   Bearer eyJ...
 *   authorization=Bearer%20eyJ...
 *   裸的 eyJ...
 * 抓取规则写进客户端的值就是这个格式，所以两边可以互通。
 */
function zeekrTokenFromStore(raw) {
  if (!raw) return "";
  var s = String(raw).trim();
  if (s.charAt(0) === "{") {
    try {
      var o = JSON.parse(s) || {};
      return zeekrCleanToken(
        o.authorization ||
          o.Authorization ||
          o.token ||
          o.TOKEN ||
          o.ZEEKR_TOKEN ||
          ""
      );
    } catch (e) {
      return "";
    }
  }
  var m = s.match(/authorization=([^&\n]+)/i);
  if (m) {
    s = m[1];
    try {
      s = decodeURIComponent(s);
    } catch (e2) {}
  }
  return zeekrCleanToken(s);
}

/**
 * 支持的参数（大小写不敏感，前缀 ZEEKR_ 可有可无）：
 *   TOKEN      必填，Bearer eyJ...
 *   MODE       all（默认，签到+步数+任务+领取）/ sign（只签到做任务）/ claim（只领取）
 *   TAG        场次标签，只影响通知标题，例如 凌晨场 / 早间场 / 晚间场
 *   STEPS      上报步数，数字；off 表示跳过上报
 *   POLL       1 = 领取阶段做长时间复查轮询（需要客户端超时 ≥ ZEEKR_MAX，默认 0 只查一轮）
 *   WAITS      复查间隔（秒，逗号分隔，默认 45,60,75）
 *   SETTLE     距最后一次成功领取至少观察多少秒（默认 180）
 *   MAX        领取阶段上限（秒，默认 600）
 *   APPVER     App 版本号，跳过 iTunes 查询，例如 4.9.33
 *   LIKE       1 = 不管本周是否已完成都点一次赞（排查用）
 *   NOTIFY     0 = 不发通知
 *   CAPSHOW    1(默认) = 抓到 Token 时在通知里显示完整 Token（方便复制到青龙）；
 *              0 = 只显示账号/有效期（Token 仍会存进客户端持久化存储）
 *   VERBOSE    1 = 打印明细
 */
function zeekrNormKey(k) {
  return String(k)
    .replace(/^ZEEKR[-_]/i, "")
    .replace(/[-_]/g, "")
    .toUpperCase();
}

function zeekrLoadConfig(RT) {
  var raw = RT.env || {};
  var v = {};
  for (var k in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    var val = raw[k];
    if (val === null || val === undefined) continue;
    v[zeekrNormKey(k)] = val;
  }
  var str = function (name, def) {
    var x = v[name];
    if (x === undefined || x === null || x === "") return def;
    return String(x).trim();
  };
  var cfg = {
    token: str("TOKEN", ""),
    mode: str("MODE", "all").toLowerCase(),
    tag: str("TAG", ""),
    stepsRaw: str("STEPS", ""),
    poll: str("POLL", "0") === "1",
    waits: str("WAITS", "45,60,75"),
    settle: parseInt(str("SETTLE", "180"), 10) || 180,
    max: parseInt(str("MAX", "600"), 10) || 600,
    appver: str("APPVER", ""),
    forceLike: str("LIKE", "0") === "1",
    notify: str("NOTIFY", "1") !== "0",
    verbose: str("VERBOSE", "0") === "1",
  };
  var toks = [];
  if (cfg.token) {
    toks = String(cfg.token)
      .split(/[\r\n&]+/)
      .map(function (t) {
        return zeekrCleanToken(t);
      })
      .filter(function (t) {
        return t && t.charAt(0) !== "#";
      });
  } else if (v["VAL"]) {
    // 兼容常见极氪脚本的 zeekr_val / ZEEKR_VAL（值是 {"authorization":"Bearer ..."}）
    var one = zeekrTokenFromStore(v["VAL"]);
    if (one) toks = [one];
  }
  cfg.tokens = toks.length ? toks : [];
  cfg.token = cfg.tokens[0] || "";
  if (cfg.mode !== "sign" && cfg.mode !== "claim") cfg.mode = "all";
  return cfg;
}

function zeekrParseToken(token) {
  var part = String(token).replace(/^Bearer\s+/i, "").split(".")[1] || "";
  var payload = {};
  try {
    payload = JSON.parse(zeekrB64Decode(part));
  } catch (e) {
    payload = {};
  }
  var subRaw =
    typeof payload.sub === "string"
      ? payload.sub
      : JSON.stringify(payload.sub || {});
  var sub = {};
  try {
    sub = JSON.parse(subRaw);
  } catch (e2) {
    sub = {};
  }
  var mAcc = subRaw.match(/"accountId"\s*:\s*"?(\d{10,})/);
  var accountId =
    (mAcc && mAcc[1]) ||
    String(
      (sub.accountInfoDTO && sub.accountInfoDTO.accountId) || ""
    );
  var mDev = subRaw.match(/"lastLoginDeviceId"\s*:\s*"([^"]+)"/);
  var deviceId =
    (mDev && mDev[1]) ||
    (sub.accountLoginInfoDTO && sub.accountLoginInfoDTO.lastLoginDeviceId) ||
    "";
  var exp = (payload.exp || 0) * 1000;
  var daysLeft = exp ? Math.floor((exp - Date.now()) / 86400000) : 999;
  return { accountId: accountId, deviceId: deviceId, exp: exp, daysLeft: daysLeft };
}

/* ---------------- 请求层 ---------------- */

function zeekrHeaders(token, appVersion, deviceId) {
  var timestamp = Date.now();
  var nonce = zeekrRandomString(15);
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
    Authorization: token,
    x_ca_key: "H5-SIGN-SECRET-KEY",
    x_ca_nonce: nonce,
    x_ca_timestamp: String(timestamp),
    x_ca_sign: zeekrSha1Hex(
      [ZEEKR_SECRET, nonce, String(timestamp)].sort().join("")
    ),
    WorkspaceId: "prod",
    Version: "2",
    app_type: "h5",
    app_code: "toc_h5_green_zeekrapp",
    platform: "",
    platform_h5: "IOS",
    risk_platform: "h5",
    riskTimeStamp: String(timestamp),
    riskVersion: "1",
    device_id: deviceId,
    x_gray_code: "gray45",
    AppId: "ONEX97FB91F061405",
    "X-CORS-ONEX97FB91F061405-prod": "1",
    "Eagleeye-Sessionid": "",
    "Eagleeye-Traceid": "",
    Origin: "https://activity-h5.zeekrlife.com",
    Referer: "https://activity-h5.zeekrlife.com/",
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) zeekr_iOS_v" +
      appVersion,
  };
}

/**
 * 发一次请求（带网络重试）。
 * 「fetch failed」这类是网络层错误（连接被 RST / DNS / TLS 抖动），
 * 这个域名是 GSLB 多 IP 池，偶发单连接失败很常见 —— 直接重试就能救回来。
 * 签到 / 步数 / 领取本身都是幂等的，重试安全。
 */
async function zeekrRequest(ctx, path, method, body) {
  var attempts = 3;
  var lastErr = null;
  var res = null;
  for (var attempt = 1; attempt <= attempts; attempt++) {
    try {
      res = await ctx.RT.http({
        method: method,
        url: ZEEKR_BASE + path,
        headers: zeekrHeaders(ctx.token, ctx.appVersion, ctx.deviceId),
        body: method === "GET" ? null : JSON.stringify(body === undefined ? {} : body),
        timeoutMs: 20000,
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      ctx.vlog(
        "网络请求失败（第 " + attempt + "/" + attempts + " 次）: " +
          ((e && e.message) || e) +
          " —— " + path
      );
      if (attempt < attempts) await zeekrSleep(1200 + attempt * 900);
    }
  }
  if (lastErr) {
    throw new Error(
      "网络请求失败（已重试 " + attempts + " 次）: " + ((lastErr && lastErr.message) || lastErr) + " —— " + path
    );
  }
  var text = res && res.body !== undefined && res.body !== null ? res.body : "";
  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text);
    } catch (e) {
      text = String(text);
    }
  }
  try {
    return JSON.parse(text);
  } catch (e2) {
    return { code: "PARSE_ERROR", msg: String(text).slice(0, 200) };
  }
}

function zeekrGet(ctx, path) {
  return zeekrRequest(ctx, path, "GET", null);
}
function zeekrPost(ctx, path, body) {
  return zeekrRequest(ctx, path, "POST", body);
}

/** 拼步数上报的 secret："<步数>_salt" 连续 base64 5 次（与 App 抓包一致） */
function zeekrEncodeStepSecret(stepCounts, layers) {
  var out = stepCounts + "_salt";
  for (var i = 0; i < (layers || 5); i++) out = zeekrB64Encode(out);
  return out;
}

/* ---------------- 各业务动作 ---------------- */

async function zeekrSignIn(ctx) {
  var data = await zeekrPost(ctx, ZEEKR_API.signIn, {});
  if (data.code === "000000") {
    var info = (data.data && data.data.signInZgreenInfo) || [];
    var today = null,
      streak = null;
    for (var i = 0; i < info.length; i++) {
      var t = info[i] || {};
      if (t.taskName === "每日签到") today = t;
      if (t.taskName && String(t.taskName).indexOf("连续签到") === 0) streak = t;
    }
    ctx.out("✅ 签到成功" + (today && today.taskStatus ? "（今日已签到）" : ""));
    if (streak) ctx.out("🔥 " + streak.taskName);
    return true;
  }
  ctx.out("❌ 签到失败: " + (data.msg || JSON.stringify(data)));
  return false;
}

async function zeekrSyncWalk(ctx, steps, sourceType) {
  var base = {
    stepCounts: steps,
    stepCountsSecret: zeekrEncodeStepSecret(steps),
    sourceType: sourceType || 20,
  };
  var body = {};
  for (var k in base) body[k] = base[k];
  if (ctx.accountId) body.accountId = ctx.accountId;
  var data = await zeekrPost(ctx, ZEEKR_API.walkData, body);
  if (data.code !== "000000" && ctx.accountId) {
    ctx.out(
      "⚠️ 步数上报带 accountId 失败（" +
        data.code +
        " " +
        (data.msg || "") +
        "），改用不带 accountId 重试"
    );
    data = await zeekrPost(ctx, ZEEKR_API.walkData, base);
  }
  if (data.code === "000000") {
    ctx.out("🚶 步数上报成功: " + steps + " 步");
    return true;
  }
  ctx.out("❌ 步数上报失败: " + (data.msg || JSON.stringify(data)));
  return false;
}

async function zeekrGetTasks(ctx) {
  var data = await zeekrPost(ctx, ZEEKR_API.taskMsg, {
    activityRecord: "medal_compose_task_manage",
    optional: { fetchTaskTakeAndReachTimesInfo: true },
  });
  if (data.code !== "000000") {
    ctx.out("❌ 查询任务列表失败: " + (data.msg || JSON.stringify(data)));
    return [];
  }
  return (data.data && data.data.taskReachMsgList) || [];
}

async function zeekrReadArticle(ctx, tasks) {
  var task = null;
  for (var i = 0; i < tasks.length; i++)
    if (tasks[i].name === ZEEKR_TASK_ARTICLE) task = tasks[i];
  if (!task) return null;
  var url = (task.doc && task.doc.path) || "";
  var m = url.match(/acticleId=([^&]+)/);
  if (!m) {
    ctx.out("❌ 阅读文章: 任务里没拿到文章 ID");
    return null;
  }
  var data = await zeekrGet(
    ctx,
    ZEEKR_API.articleDetail + "?id=" + m[1]
  );
  if (data.code === "000000") {
    ctx.out(
      "📖 阅读文章成功: " + ((data.data && data.data.title) || m[1])
    );
    return true;
  }
  ctx.out("❌ 阅读文章失败: " + (data.msg || JSON.stringify(data)));
  return null;
}

async function zeekrLikeSquarePost(ctx) {
  var target = null;
  var pages = [1, 2, 3];
  for (var p = 0; p < pages.length; p++) {
    var list = await zeekrGet(
      ctx,
      ZEEKR_API.squareList +
        "?pageNo=" +
        pages[p] +
        "&pageSize=20&sort=0"
    );
    var items = (list && list.data && list.data.list) || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && it.isFabulous === 0 && it.id && it.accountId) {
        target = it;
        break;
      }
    }
    if (target || !items.length) break;
  }
  if (!target) {
    ctx.out("⚠️ 广场列表里没有可点赞的帖子（前三页都点过了）");
    return null;
  }
  var data = await zeekrPost(ctx, ZEEKR_API.fabulous, {
    moduleId: String(target.id),
    accountId: ctx.accountId,
    fabulousState: 1,
    moduleType: 1,
    toAccountId: String(target.accountId),
    invitationType: 2,
  });
  if (data.code === "000000") {
    var label = target.title
      ? "《" + String(target.title).slice(0, 18) + "》"
      : "帖子 " + String(target.id).slice(-6);
    ctx.out("👍 社区点赞成功: " + label);
    return true;
  }
  ctx.out("❌ 社区点赞失败: " + (data.msg || JSON.stringify(data)));
  return null;
}

function zeekrTaskDone(t) {
  if (!t) return true;
  var dto = t.taskTakeDTO || {};
  return (dto.currentComplete || 0) >= (dto.maxCompleteLimit || 1);
}
function zeekrTaskLine(t) {
  return (zeekrTaskDone(t) ? "✅" : "⏳") + " " + t.name;
}

async function zeekrDoTasks(ctx, forceLike) {
  var tasks = await zeekrGetTasks(ctx);
  if (!tasks.length) {
    ctx.out("⚠️ 未取到任务列表（跳过做任务）");
    return { tasks: tasks };
  }
  await zeekrReadArticle(ctx, tasks);
  var weekly = null;
  for (var i = 0; i < tasks.length; i++)
    if (tasks[i].name === ZEEKR_TASK_PRAISE) weekly = tasks[i];
  if (!forceLike && zeekrTaskDone(weekly)) {
    ctx.out("👍 每周点赞帖子: 本周已完成，跳过");
  } else {
    await zeekrLikeSquarePost(ctx);
  }
  return { tasks: tasks };
}

async function zeekrGetUncollected(ctx) {
  var data = await zeekrPost(ctx, ZEEKR_API.uncollected, {
    accountId: ctx.accountId,
  });
  if (data.code !== "000000") {
    ctx.out("❌ 查询可领取奖品失败: " + (data.msg || JSON.stringify(data)));
    return { debrisList: [], walkList: [], integralList: [] };
  }
  var items = (data.data && data.data.uncollectedVal) || [];
  var debrisList = [],
    walkList = [],
    integralList = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    if (it.valDefineCode === ZEEKR_VAL_DEBRIS) debrisList.push(it);
    else if (it.valDefineCode === ZEEKR_VAL_WALK) walkList.push(it);
    else if (it.valDefineCode === ZEEKR_VAL_INTEGRAL) integralList.push(it);
  }
  var summary =
    debrisList.length +
    " 个碎片, " +
    walkList.length +
    " 个能量球, " +
    integralList.length +
    " 个极值";
  if (debrisList.length || walkList.length || integralList.length)
    ctx.out("📦 可领取: " + summary);
  else ctx.vlog("📦 可领取: " + summary);
  return { debrisList: debrisList, walkList: walkList, integralList: integralList };
}

function zeekrDebrisName(r) {
  var snap = r && r.invoice && r.invoice.materialSnapshot;
  var name = (snap && snap.name) || "碎片";
  var fragment = (snap && snap.medalTemplateSnapshot && snap.medalTemplateSnapshot.name) || "";
  return fragment ? name + "(" + fragment + ")" : name;
}

async function zeekrClaimDebris(ctx, debrisList) {
  if (!debrisList.length) return [];
  var toCmd = function (item) {
    return {
      record: item.eventCode,
      payContent: { bubbleAssetsId: item.id },
      applyExt: { origin: item.sourceId },
    };
  };
  var results = [];
  var data = await zeekrPost(ctx, ZEEKR_API.claimDebris, {
    applyCmdList: debrisList.map(toCmd),
  });
  if (data.code === "000000" && Object.prototype.toString.call(data.data) === "[object Array]") {
    for (var i = 0; i < data.data.length; i++) {
      var r = data.data[i];
      if (r && r.success) results.push(zeekrDebrisName(r));
    }
    var failed = 0;
    for (var j = 0; j < data.data.length; j++) if (!data.data[j].success) failed++;
    if (failed) ctx.out("⚠️ 批量领取有 " + failed + " 个失败，逐个重试");
  } else {
    ctx.out(
      "⚠️ 批量领取碎片失败（" +
        (data.msg || JSON.stringify(data)) +
        "），改为逐个领取"
    );
    for (var k = 0; k < debrisList.length; k++) {
      var one = await zeekrPost(ctx, ZEEKR_API.claimDebris, {
        applyCmdList: [toCmd(debrisList[k])],
      });
      if (one.code === "000000" && Object.prototype.toString.call(one.data) === "[object Array]") {
        for (var q = 0; q < one.data.length; q++)
          if (one.data[q] && one.data[q].success)
            results.push(zeekrDebrisName(one.data[q]));
      } else {
        ctx.out(
          "❌ 碎片领取失败（" +
            (debrisList[k].sourceId || debrisList[k].id) +
            "）: " +
            (one.msg || "")
        );
      }
      await zeekrSleep(zeekrRand(800, 1500));
    }
  }
  if (results.length) ctx.out("🧩 碎片奖励: " + results.join("、"));
  return results;
}

async function zeekrClaimWalk(ctx, walkList) {
  if (!walkList.length) return 0;
  var total = 0;
  for (var i = 0; i < walkList.length; i++) {
    var it = walkList[i];
    var val = it.val || 0;
    var data = await zeekrPost(ctx, ZEEKR_API.claimWalk, { energyIds: [it.id] });
    if (data.code === "000000") {
      total += val;
      ctx.out("♻️ 能量球已领: +" + val);
    } else {
      ctx.out("❌ 能量球领取失败: " + (data.msg || JSON.stringify(data)));
    }
    await zeekrSleep(zeekrRand(800, 1500));
  }
  return total;
}

async function zeekrClaimIntegral(ctx, integralList) {
  if (!integralList.length) return 0;
  var total = 0;
  for (var i = 0; i < integralList.length; i++) {
    var it = integralList[i];
    var val = it.val || 0;
    var data = await zeekrPost(ctx, ZEEKR_API.claimIntegral, {
      energyIds: [it.id],
    });
    if (data.code === "000000") {
      total += val;
      ctx.out("🏆 极值已领: +" + val);
    } else {
      ctx.out("❌ 极值领取失败: " + (data.msg || JSON.stringify(data)));
    }
    await zeekrSleep(zeekrRand(800, 1500));
  }
  return total;
}

function zeekrParseWaits(str) {
  var parts = String(str || "").split(",");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var n = parseFloat(parts[i]);
    if (!isNaN(n) && n > 0) out.push(Math.round(n * 1000));
  }
  return out.length ? out : [45000, 60000, 75000, 60000];
}

/**
 * 领取循环：先领能量球 → 领极值 → 批量领碎片 → 复查。
 * 顺序不能反：能量球入账会让「减碳2000g」任务达标，进而生成新碎片。
 * 奖励是异步入账的（1~3 分钟），所以：
 *   poll=0（默认）：只查一轮，把「延迟入账的补领」交给 10 分钟后的第二条 cron（ZEEKR_MODE=claim）
 *   poll=1        ：按 WAITS / SETTLE / MAX 做时间窗口轮询（客户端超时必须放宽到 ≥ MAX）
 */
async function zeekrClaimAll(ctx, cfg) {
  var waits = zeekrParseWaits(cfg.waits);
  var silentRounds = 3;
  var minSettleMs = cfg.settle * 1000;
  var maxMs = cfg.max * 1000;
  var startedAt = Date.now();
  var claimed = {};
  var debrisCount = 0,
    walkVal = 0,
    integralVal = 0,
    emptyStreak = 0,
    round = 0,
    lastClaimAt = 0;
  var conclusion = "";
  var fresh = function (list) {
    var out = [];
    for (var i = 0; i < list.length; i++)
      if (!Object.prototype.hasOwnProperty.call(claimed, list[i].id))
        out.push(list[i]);
    return out;
  };

  while (true) {
    round++;
    var got = await zeekrGetUncollected(ctx);
    var d = fresh(got.debrisList);
    var w = fresh(got.walkList);
    var g = fresh(got.integralList);
    var elapsed = Date.now() - startedAt;

    if (!d.length && !w.length && !g.length) {
      emptyStreak++;
      var sinceClaim = Date.now() - (lastClaimAt || startedAt);
      if (!cfg.poll || (emptyStreak >= silentRounds && sinceClaim >= minSettleMs)) {
        conclusion = cfg.poll
          ? "✅ 复查确认：可取皆已领完（共 " +
            round +
            " 轮 / " +
            Math.round(elapsed / 1000) +
            "s）"
          : "✅ 本次查询无待领取奖励";
        break;
      }
      var waitTry =
        waits[Math.max(0, Math.min(emptyStreak - 1, waits.length - 1))];
      if (elapsed + waitTry > maxMs) {
        conclusion =
          "⏰ 观察到 " + Math.round(elapsed / 1000) + "s，到领取窗口上限，结束复查";
        break;
      }
      ctx.vlog("第 " + round + " 轮暂无可领（已观察 " + Math.round(elapsed / 1000) + "s）...");
    } else {
      for (var i1 = 0; i1 < w.length; i1++) claimed[w[i1].id] = 1;
      walkVal += await zeekrClaimWalk(ctx, w);
      for (var i2 = 0; i2 < g.length; i2++) claimed[g[i2].id] = 1;
      integralVal += await zeekrClaimIntegral(ctx, g);
      for (var i3 = 0; i3 < d.length; i3++) claimed[d[i3].id] = 1;
      debrisCount += (await zeekrClaimDebris(ctx, d)).length;
      emptyStreak = 0;
      lastClaimAt = Date.now();
    }

    if (!cfg.poll) {
      conclusion = "✅ 已领取一轮（延迟入账的奖励由稍后的「只领取」任务补上）";
      break;
    }

    var wait = waits[Math.max(0, Math.min(emptyStreak - 1, waits.length - 1))];
    if (Date.now() - startedAt + wait > maxMs) {
      conclusion = "⏰ 到领取窗口上限，结束复查";
      break;
    }
    ctx.vlog(Math.round(wait / 1000) + "s 后复查（新奖励可能还在入账路上）...");
    await zeekrSleep(wait);
  }

  if (conclusion) ctx.out(conclusion);
  return {
    debrisCount: debrisCount,
    walkVal: walkVal,
    integralVal: integralVal,
    rounds: round,
  };
}

/* ---------------- 主流程 ---------------- */

async function zeekrMain(RT) {
  var cfg = zeekrLoadConfig(RT);
  var lines = [];
  var ctx = {
    RT: RT,
    token: cfg.token,
    accountId: "",
    deviceId: "",
    appVersion: cfg.appver || "",
    out: function (msg) {
      lines.push("[极氪签到] " + msg);
      RT.log("[极氪签到] " + msg);
    },
    vlog: function (msg) {
      if (cfg.verbose) RT.log("[极氪签到·明细] " + msg);
    },
    ok: true,
  };
  var title =
    "✅ 极氪签到" + (cfg.tag ? "（" + cfg.tag + "）" : "");

  var send = function () {
    if (!cfg.notify) return;
    if (RT.notify) {
      try {
        RT.notify(title, lines.join("\n"));
      } catch (e) {}
    }
  };

  if (!cfg.token) {
    ctx.ok = false;
    title = "❌ 极氪签到失败" + (cfg.tag ? "（" + cfg.tag + "）" : "");
    ctx.out("❌ 缺少 Token：请在客户端参数的 TOKEN/ZEEKR_TOKEN 里填 Bearer Token");
    send();
    return { ok: false, lines: lines };
  }

  var info = zeekrParseToken(cfg.token);
  ctx.accountId = info.accountId;
  ctx.deviceId = info.deviceId;

  if (cfg.tokens.length > 1) {
    ctx.out("⚠️ 检测到 " + cfg.tokens.length + " 个 Token，本脚本只用第 1 个（多账号请用青龙版）");
  }
  if (!info.deviceId) {
    ctx.ok = false;
    title = "❌ 极氪签到失败" + (cfg.tag ? "（" + cfg.tag + "）" : "");
    ctx.out("❌ JWT 里没有设备 ID（accountLoginInfoDTO.lastLoginDeviceId），Token 可能不完整");
    send();
    return { ok: false, lines: lines };
  }

  ctx.out(
    zeekrNowCST() +
      " | 账号: " +
      info.accountId +
      " | 客户端: " +
      RT.platform
  );
  ctx.out(
    "Token 过期: " +
      (info.exp ? zeekrCSTDate(info.exp) : "未知") +
      " (剩余 " +
      info.daysLeft +
      " 天)"
  );
  if (info.daysLeft <= 0) {
    ctx.ok = false;
    title = "❌ 极氪签到失败（Token 过期）" + (cfg.tag ? "（" + cfg.tag + "）" : "");
    ctx.out("❌ Token 已过期，请重新抓包更新");
    send();
    return { ok: false, lines: lines };
  }
  if (info.daysLeft < 7) ctx.out("⚠️ Token 即将过期，请尽快更新！");

  // App 版本号：默认查 iTunes（失败退回 4.9.33），可用 APPVER 直接指定跳过查询
  if (!ctx.appVersion) {
    try {
      var vres = await RT.http({
        method: "GET",
        url: "https://itunes.apple.com/cn/lookup?id=1570277888",
        headers: {},
        body: null,
        timeoutMs: 8000,
      });
      var vjson = JSON.parse(vres.body || "{}");
      ctx.appVersion =
        (vjson.results && vjson.results[0] && vjson.results[0].version) || "4.9.33";
    } catch (e) {
      ctx.appVersion = "4.9.33";
    }
  }
  ctx.vlog("App 版本: v" + ctx.appVersion);

  if (cfg.mode === "all" || cfg.mode === "sign") {
    var signOk = await zeekrSignIn(ctx);
    if (!signOk) {
      ctx.ok = false;
      title = "❌ 极氪签到失败（签到接口报错）" + (cfg.tag ? "（" + cfg.tag + "）" : "");
      send();
      return { ok: false, lines: lines };
    }
    var stepOff = /^(off|0|no|false)$/i.test(cfg.stepsRaw);
    var steps = stepOff ? 0 : parseInt(cfg.stepsRaw, 10) || zeekrRand(8000, 12000);
    var pushSteps = async function () {
      await zeekrSleep(zeekrRand(1200, 2200));
      return zeekrSyncWalk(ctx, steps, 20);
    };
    if (!stepOff) await pushSteps();
    await zeekrSleep(zeekrRand(1200, 2200));
    var t = await zeekrDoTasks(ctx, cfg.forceLike);
    if (t.tasks.length) ctx.vlog("📋 任务(初查): " + t.tasks.map(zeekrTaskLine).join("  "));
    ctx.stepOff = stepOff;
    ctx.pushSteps = pushSteps;
  }

  var res = { debrisCount: 0, walkVal: 0, integralVal: 0, rounds: 0 };
  if (cfg.mode === "all" || cfg.mode === "claim") {
    await zeekrSleep(zeekrRand(2000, 3500));
    res = await zeekrClaimAll(ctx, cfg);
  }

  if (cfg.mode === "all" || cfg.mode === "sign") {
    var finalTasks = await zeekrGetTasks(ctx);
    if (finalTasks.length) ctx.out("📋 任务: " + finalTasks.map(zeekrTaskLine).join("  "));
    var walkTask = null;
    for (var i = 0; i < finalTasks.length; i++)
      if (finalTasks[i].name === ZEEKR_TASK_WALK) walkTask = finalTasks[i];
    if (!ctx.stepOff && walkTask && !zeekrTaskDone(walkTask) && cfg.mode === "all") {
      ctx.out("🔁 「步行3000步」仍未达标：补报步数后重新扫描");
      await ctx.pushSteps();
      var again = await zeekrClaimAll(ctx, {
        poll: cfg.poll,
        waits: cfg.waits,
        settle: Math.min(cfg.settle, 120),
        max: cfg.max,
      });
      res = {
        debrisCount: res.debrisCount + again.debrisCount,
        walkVal: res.walkVal + again.walkVal,
        integralVal: res.integralVal + again.integralVal,
        rounds: res.rounds + again.rounds,
      };
    }
  }

  ctx.out(
    "🏁 本次领取: 碎片 " +
      res.debrisCount +
      " 个, 能量球 +" +
      res.walkVal +
      ", 极值 +" +
      res.integralVal
  );
  ctx.out("🎉 全部完成！");
  send();
  return { ok: ctx.ok, lines: lines, result: res };
}
