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

/* ==========================================================================
 * 极氪签到 · 核心逻辑（运行时无关）
 * 本文件由 build.py 内联进各个客户端模板，不要单独运行。
 * 依赖注入：RT = { platform, env, http(), notify(), log(), finish() }
 * ========================================================================== */

var ZEEKR_PORT_VERSION = "2.3.0";
/* 签名密钥由 build.py 从本地 checkin.mjs 抽取后注入（避免密钥出现在源码/终端里被安全屏蔽器打码） */
var ZEEKR_SECRET = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCz09z6e9WOcNq+nUMX8Vq1Xe2EmJxuR3XbturefioF)E(Fl";
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
  claimSevenDayLottery: "/zeekrlife-mp-mkt/toc/v1/applyV2/apply",
  claimWalk: "/zeekrlife-mp-val/v1/carEnergy/collectedAllEnergy",
  claimIntegral: "/zeekrlife-mp-val/v1/carEnergy/collectIntegralZeekrBalls",
};
var ZEEKR_VAL_DEBRIS = "DEBRIS";
var ZEEKR_VAL_WALK = "CARBON_VALUE";
var ZEEKR_VAL_INTEGRAL = "ZEEKR_VALUE";
var ZEEKR_SCENE_SEVEN_DAY_LOTTERY = "SIGN_CONTINUOUS_7_LOTTERY";
var ZEEKR_RECORD_SEVEN_DAY_LOTTERY = "zgreen_7day_activity";
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
 *              —— **仅 QX / Loon / Stash 版实现**，Egern 版恒显示完整 Token
 *   VERBOSE    1 = 打印明细
 */
function zeekrNormKey(k) {
  return String(k)
    .replace(/^ZEEKR[-_]/i, "")
    .replace(/[-_]/g, "")
    .toUpperCase();
}

function zeekrDeviceIdFromStore(raw) {
  if (!raw) return "";
  try {
    var o = typeof raw === "string" && raw.charAt(0) === "{" ? JSON.parse(raw) : null;
    return o && o.device_id ? String(o.device_id) : "";
  } catch (e) {
    return "";
  }
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
    deviceId: str("DEVICE_ID", ""),
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
    if (!cfg.deviceId) cfg.deviceId = zeekrDeviceIdFromStore(v["VAL"]);
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
    "device_id": deviceId || "",
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

async function zeekrRequest(ctx, path, method, body) {
  var res = await ctx.RT.http({
    method: method,
    url: ZEEKR_BASE + path,
    headers: zeekrHeaders(ctx.token, ctx.appVersion, ctx.deviceId),
    body: method === "GET" ? null : JSON.stringify(body === undefined ? {} : body),
    timeoutMs: 20000,
  });
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
    return { debrisList: [], walkList: [], integralList: [], lotteryList: [] };
  }
  var items = (data.data && data.data.uncollectedVal) || [];
  var debrisList = [],
    walkList = [],
    integralList = [],
    lotteryList = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    if (it.sceneCode === ZEEKR_SCENE_SEVEN_DAY_LOTTERY) lotteryList.push(it);
    else if (it.valDefineCode === ZEEKR_VAL_DEBRIS) debrisList.push(it);
    else if (it.valDefineCode === ZEEKR_VAL_WALK) walkList.push(it);
    else if (it.valDefineCode === ZEEKR_VAL_INTEGRAL) integralList.push(it);
  }
  var summary =
    debrisList.length +
    " 个碎片, " +
    lotteryList.length +
    " 个七日抽奖球, " +
    walkList.length +
    " 个能量球, " +
    integralList.length +
    " 个极值";
  if (debrisList.length || lotteryList.length || walkList.length || integralList.length)
    ctx.out("📦 可领取: " + summary);
  else ctx.vlog("📦 可领取: " + summary);
  return { debrisList: debrisList, walkList: walkList, integralList: integralList, lotteryList: lotteryList };
}

/* 2026-09-21 加：把服务端返回的失败原因取出来（字段名不固定，都试一遍）——
   旧版把原因整个丢掉，导致「通知说领完了、App 里还在」查不出原因。 */
function zeekrFailReason(rec, fallback) {
  if (!rec || typeof rec !== "object") return (fallback || "") + "";
  var keys = ["msg", "message", "errorMsg", "remark"];
  for (var i = 0; i < keys.length; i++) {
    if (rec[keys[i]]) return String(rec[keys[i]]);
  }
  if (typeof rec.code === "string" && rec.code) return rec.code;
  return (fallback || JSON.stringify(rec).slice(0, 160)) + "";
}

function zeekrCountKeys(obj) {
  var n = 0;
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) n++;
  return n;
}

function zeekrFailedList(obj) {
  var out = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(obj[k]);
  return out;
}

function zeekrMergeFailed(target, list) {
  for (var i = 0; i < (list || []).length; i++) target[list[i].id] = list[i];
}

function zeekrDebrisName(r) {
  var snap = r && r.invoice && r.invoice.materialSnapshot;
  var name = (snap && snap.name) || "碎片";
  var fragment = (snap && snap.medalTemplateSnapshot && snap.medalTemplateSnapshot.name) || "";
  return fragment ? name + "(" + fragment + ")" : name;
}

/**
 * 批量领取碎片（与 App 一致：一次 batchApply 提交全部）；失败则**真的**逐个重试。
 *
 * ⚠️ 2026-09-21 修（真事故）：旧版遇到「批量里有 1 个失败」时只打了一句「逐个重试」
 * 的日志、**实际没有重试**，失败原因还被整个丢掉 —— 于是通知写「可取皆已领完」，
 * App 里那张碎片还在，只能手动领。现在返回 { claimed: [], failed: [{id,label,reason}] }，
 * 由 zeekrClaimAll 决定「下一轮再试」还是「进通知」。
 */
async function zeekrClaimDebris(ctx, debrisList) {
  if (!debrisList.length) return { claimed: [], failed: [] };
  var toCmd = function (item) {
    return {
      record: item.eventCode,
      payContent: { bubbleAssetsId: item.id },
      applyExt: { origin: item.sourceId },
    };
  };
  var labelOf = function (item) {
    return String(item.sourceId || item.sceneRemark || item.id);
  };

  var claimed = [];
  var pending = [];
  var data = await zeekrPost(ctx, ZEEKR_API.claimDebris, {
    applyCmdList: debrisList.map(toCmd),
  });
  if (data.code === "000000" && Object.prototype.toString.call(data.data) === "[object Array]") {
    for (var i = 0; i < data.data.length; i++) {
      var r = data.data[i];
      var item = debrisList[i] || {};
      if (r && r.success) claimed.push(zeekrDebrisName(r));
      else pending.push({ item: item, reason: zeekrFailReason(r, data.msg || "") });
    }
    if (pending.length)
      ctx.out("⚠️ 批量领取有 " + pending.length + " 个失败，改为逐个重试");
  } else {
    ctx.out(
      "⚠️ 批量领取碎片失败（" +
        (data.msg || JSON.stringify(data)) +
        "），改为逐个领取"
    );
    for (var k = 0; k < debrisList.length; k++)
      pending.push({ item: debrisList[k], reason: (data.msg || "批量接口返回异常") + "" });
  }

  var failed = [];
  for (var p = 0; p < pending.length; p++) {
    var it = pending[p].item;
    var one = await zeekrPost(ctx, ZEEKR_API.claimDebris, {
      applyCmdList: [toCmd(it)],
    });
    var arr = one.data;
    var isArr = Object.prototype.toString.call(arr) === "[object Array]";
    var anyOk = false;
    if (one.code === "000000" && isArr) {
      for (var q = 0; q < arr.length; q++) {
        if (arr[q] && arr[q].success) {
          anyOk = true;
          claimed.push(zeekrDebrisName(arr[q]));
        }
      }
    }
    if (!anyOk) {
      var why = zeekrFailReason(
        isArr && arr.length ? arr[0] : null,
        one.msg || pending[p].reason
      );
      ctx.out("❌ 碎片领取失败（" + labelOf(it) + "）: " + why);
      failed.push({ id: it.id, label: labelOf(it), reason: why });
    }
    await zeekrSleep(zeekrRand(800, 1500));
  }
  if (claimed.length) ctx.out("🧩 碎片奖励: " + claimed.join("、"));
  return { claimed: claimed, failed: failed };
}

/* 领取能量球。返回 { val, failed }（失败要能被重试/上报，不能再静默吞掉）。 */
async function zeekrClaimSevenDayLottery(ctx, lotteryList) {
  if (!lotteryList.length) return { claimed: [], failed: [] };
  var claimed = [];
  var failed = [];
  for (var i = 0; i < lotteryList.length; i++) {
    var item = lotteryList[i];
    var label = String(item.sourceId || item.sceneRemark || "七日连签抽奖球");
    var data = await zeekrPost(ctx, ZEEKR_API.claimSevenDayLottery, {
      record: ZEEKR_RECORD_SEVEN_DAY_LOTTERY,
      fixedZgreenAssetId: item.id,
      optional: { mappingMsg: true },
    });
    var ok = data.code === "000000" && data.data && data.data.success;
    if (ok) {
      var prize =
        (data.data.invoice &&
          data.data.invoice.materialSnapshot &&
          data.data.invoice.materialSnapshot.name) ||
        "七日连签奖励";
      claimed.push(prize);
      ctx.out("🎁 七日连签奖励已领: " + prize);
    } else {
      var why = zeekrFailReason(data.data, data.msg || "七日连签领取失败");
      ctx.out("❌ 七日连签奖励领取失败（" + label + "）: " + why);
      failed.push({ id: item.id, label: label, reason: why });
    }
    await zeekrSleep(zeekrRand(1000, 2000));
  }
  return { claimed: claimed, failed: failed };
}

async function zeekrClaimWalk(ctx, walkList) {
  if (!walkList.length) return { val: 0, failed: [] };
  var total = 0;
  var failed = [];
  for (var i = 0; i < walkList.length; i++) {
    var it = walkList[i];
    var val = it.val || 0;
    var data = await zeekrPost(ctx, ZEEKR_API.claimWalk, { energyIds: [it.id] });
    if (data.code === "000000") {
      total += val;
      ctx.out("♻️ 能量球已领: +" + val);
    } else {
      var why = (data.msg || JSON.stringify(data)) + "";
      ctx.out("❌ 能量球领取失败（" + val + "g）: " + why);
      failed.push({ id: it.id, label: val + "g 能量球", reason: why.slice(0, 160) });
    }
    await zeekrSleep(zeekrRand(800, 1500));
  }
  return { val: total, failed: failed };
}

/* 领取极值。返回 { val, failed }。 */
async function zeekrClaimIntegral(ctx, integralList) {
  if (!integralList.length) return { val: 0, failed: [] };
  var total = 0;
  var failed = [];
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
      var why = (data.msg || JSON.stringify(data)) + "";
      ctx.out("❌ 极值领取失败（" + val + "）: " + why);
      failed.push({ id: it.id, label: val + " 极值", reason: why.slice(0, 160) });
    }
    await zeekrSleep(zeekrRand(800, 1500));
  }
  return { val: total, failed: failed };
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
  var attempts = {}; /* id → 已尝试次数：失败项下一轮再试，不再"领之前就记成已领" */
  var failedMap = {}; /* id → { id, label, reason }：领失败且还没领到的项 */
  var maxAttempts = 3;
  var debrisCount = 0,
    lotteryCount = 0,
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
  /* 本轮还能尝试的项（每项最多 maxAttempts 次） */
  var bump = function (list) {
    var todo = [];
    for (var i = 0; i < list.length; i++) {
      var key = list[i].id;
      var n = (attempts[key] || 0) + 1;
      attempts[key] = n;
      if (n <= maxAttempts) todo.push(list[i]);
    }
    return todo;
  };
  /* 只有**确实领到**的项才记成已领（旧版领之前就记，失败后永不重试） */
  var settle = function (list, failList) {
    for (var i = 0; i < list.length; i++) {
      var bad = false;
      for (var j = 0; j < (failList || []).length; j++) {
        if (failList[j].id === list[i].id) {
          bad = true;
          break;
        }
      }
      if (!bad) {
        claimed[list[i].id] = 1;
        delete failedMap[list[i].id];
      }
    }
  };

  while (true) {
    round++;
    var got = await zeekrGetUncollected(ctx);
    var d = fresh(got.debrisList);
    var w = fresh(got.walkList);
    var g = fresh(got.integralList);
    var l = fresh(got.lotteryList);
    var elapsed = Date.now() - startedAt;

    var wTry = bump(w),
      gTry = bump(g),
      dTry = bump(d),
      lTry = bump(l);

    if (!wTry.length && !gTry.length && !dTry.length && !lTry.length) {
      if (d.length || w.length || g.length || l.length) {
        /* 列表里还有东西，但都重试到上限了 —— 绝不能报「已领完」 */
        var left = d.concat(w).concat(g).concat(l);
        for (var a1 = 0; a1 < left.length; a1++) {
          if (!failedMap[left[a1].id]) {
            failedMap[left[a1].id] = {
              id: left[a1].id,
              label: String(left[a1].sourceId || left[a1].sceneRemark || left[a1].id),
              reason: "重试 " + maxAttempts + " 次仍未领到",
            };
          }
        }
        conclusion =
          "⚠️ 仍有 " +
          zeekrCountKeys(failedMap) +
          " 项未领到（每项已重试 " +
          maxAttempts +
          " 次）";
        break;
      }
      emptyStreak++;
      var sinceClaim = Date.now() - (lastClaimAt || startedAt);
      if (!cfg.poll || (emptyStreak >= silentRounds && sinceClaim >= minSettleMs)) {
        if (zeekrCountKeys(failedMap)) {
          var fparts = [];
          var flist = zeekrFailedList(failedMap);
          for (var f1 = 0; f1 < flist.length; f1++)
            fparts.push(flist[f1].label + "(" + flist[f1].reason + ")");
          conclusion =
            "⚠️ 复查结束，但仍有 " + flist.length + " 项领取失败：" + fparts.join("、");
        } else {
          conclusion = cfg.poll
            ? "✅ 复查确认：可取皆已领完（共 " +
              round +
              " 轮 / " +
              Math.round(elapsed / 1000) +
              "s）"
            : "✅ 本次查询无待领取奖励";
        }
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
      /* ⚠️ 2026-09-21 修：旧版在**领取之前**就把 id 记进 claimed，一次失败就永不重试，
         列表还会被过滤成空 → 打出「✅ 可取皆已领完」而东西仍在。 */
      var rw = await zeekrClaimWalk(ctx, wTry);
      walkVal += rw.val || 0;
      settle(wTry, rw.failed);
      zeekrMergeFailed(failedMap, rw.failed);

      var rg = await zeekrClaimIntegral(ctx, gTry);
      integralVal += rg.val || 0;
      settle(gTry, rg.failed);
      zeekrMergeFailed(failedMap, rg.failed);

      var rd = await zeekrClaimDebris(ctx, dTry);
      debrisCount += (rd.claimed || []).length;
      settle(dTry, rd.failed);
      zeekrMergeFailed(failedMap, rd.failed);

      var rl = await zeekrClaimSevenDayLottery(ctx, lTry);
      lotteryCount += (rl.claimed || []).length;
      settle(lTry, rl.failed);
      zeekrMergeFailed(failedMap, rl.failed);

      emptyStreak = 0;
      lastClaimAt = Date.now();
    }

    if (!cfg.poll) {
      var nfail = zeekrCountKeys(failedMap);
      conclusion = nfail
        ? "⚠️ 未领净 " + nfail + " 项（稍后的「只领取」任务会再试）"
        : "✅ 已领取一轮（延迟入账的奖励由稍后的「只领取」任务补上）";
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
    lotteryCount: lotteryCount,
    walkVal: walkVal,
    integralVal: integralVal,
    rounds: round,
    failed: zeekrFailedList(failedMap),
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
    ctx.out(
      RT.tokenHint ||
        "❌ 缺少 Token：这台设备上还没有可用的 Bearer Token（各客户端的获取方式见 README）"
    );
    send();
    return { ok: false, lines: lines };
  }

  var info = zeekrParseToken(cfg.token);
  ctx.accountId = info.accountId;
  ctx.loginDeviceId = info.deviceId;
  ctx.deviceId = cfg.deviceId;

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
        lotteryCount: (res.lotteryCount || 0) + (again.lotteryCount || 0),
        walkVal: res.walkVal + again.walkVal,
        integralVal: res.integralVal + again.integralVal,
        rounds: res.rounds + again.rounds,
        failed: again.failed || [],
      };
    }
  }

  ctx.out(
    "🏁 本次领取: 碎片 " +
      res.debrisCount +
      " 个, 七日奖励 " +
      (res.lotteryCount || 0) +
      " 个, 能量球 +" +
      res.walkVal +
      ", 极值 +" +
      res.integralVal
  );
  var failures = res.failed || [];
  if (failures.length) {
    /* 还有没领掉的：正文写清楚、标题也要能一眼看出来，别再写「全部完成」 */
    var fmsg = [];
    for (var f2 = 0; f2 < failures.length; f2++)
      fmsg.push((failures[f2].label || "") + "→" + (failures[f2].reason || ""));
    ctx.out(
      "⚠️ 未领净 " + failures.length + " 项（稍后的补领任务会再试）：" + fmsg.join("；")
    );
    if (ctx.ok) title = "⚠️ 极氪签到（未领净）" + (cfg.tag ? "（" + cfg.tag + "）" : "");
  } else {
    ctx.out("🎉 全部完成！");
  }
  send();
  return { ok: ctx.ok, lines: lines, result: res };
}

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
