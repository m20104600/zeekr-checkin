/**
 * 极氪汽车每日自动签到 · 多客户端通用版
 * 适用：Quantumult X（[task_local]）/ Loon / Stash / Surge / Node.js / 青龙（单账号）
 * 零依赖：SHA1、base64 全部用纯 JS 实现，不依赖 crypto / Buffer / fetch
 *
 * ── 用法 ──────────────────────────────────────────────────────────────
 * 1) 本地脚本：把 Token 填进下面的 ZEEKR_DEFAULT_CONFIG
 * 2) 远程脚本（推荐，Token 不进公网）：Token 走客户端参数
 *      QX    : script 的 # 参数（# 后面不会发到服务器）
 *      Loon  : argument="ZEEKR_TOKEN=*** xxx,ZEEKR_TAG=凌晨场"
 *      Stash : argument: '{"ZEEKR_TOKEN":"Bearer xxx","ZEEKR_TAG":"凌晨场"}'
 *      Surge : argument=%ZEEKR_TOKEN%;%ZEEKR_TAG% 或 argument="ZEEKR_TOKEN=*** xxx"
 * 2b) 或者完全不填 Token —— 配一条抓取规则（见 configs/），打开极氪 App 点一下：
 *      手机端自动把 Authorization 存进客户端持久化存储（键名 zeekr_val），
 *      并弹一条通知；通知里带完整 Token，**青龙没法自动抓，复制那行过去即可**。
 *      不想在通知里显示 Token：CAPSHOW=0（仍会存起来，定时任务照常用）。
 * 3) 参数：MODE=all|sign|claim  POLL=0|1  WAITS=45,60,75  SETTLE=180  MAX=600
 *          STEPS=10000|off    TAG=凌晨场    LIKE=1    NOTIFY=0    CAPSHOW=0    VERBOSE=1
 *          前缀 ZEEKR_ 可有可无，大小写不敏感
 *
 * ── 为什么默认「只查一轮」────────────────────────────────────────────
 * 极氪的碎片/能量球是异步入账的（任务做完后 1~3 分钟才可领）。
 * 各客户端对脚本执行时长有限制，所以这里默认快跑（约 10~20 秒）：
 *   cron A：MODE=all    （签到 + 步数 + 任务 + 领一轮）
 *   cron B：MODE=claim  （10 分钟后只领取，收掉延迟入账的部分）
 * 客户端超时足够宽（Loon/Stash/Egern/青龙 可设 300~600 秒）时，
 * 也可以只留一条 cron，用 POLL=1 让脚本自己轮询到领完。
 */

/* ── 也可以直接把参数写在这里（本地脚本用法；远程脚本千万别写 Token！） ── */
var ZEEKR_DEFAULT_CONFIG = {
  // ZEEKR_TOKEN: "Bearer eyJhbGciOi...",
  // ZEEKR_MODE: "all",
  // ZEEKR_TAG: "凌晨场",
  // ZEEKR_POLL: "0",
  // ZEEKR_STEPS: "10000",   // 或 "off"
};

/* ================= 以下为逻辑，一般不需要修改 ================= */

/* ==========================================================================
 * 极氪签到 · 核心逻辑（运行时无关）
 * 本文件由 build.py 内联进各个客户端模板，不要单独运行。
 * 依赖注入：RT = { platform, env, http(), notify(), log(), finish() }
 * ========================================================================== */

var ZEEKR_PORT_VERSION = "3.1.0";
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
 * 读一个布尔开关（跨客户端都一样）：
 *   - 大小写不敏感、前缀 ZEEKR_ 可有可无、值能带引号
 *   - 支持真布尔（有些客户端 env 传的是 boolean 而不是字符串）
 *   - 只有明确写成 0/false/off/no（或布尔 false）才算"关"
 *   - 未替换的插件占位符（${X}、<x>）当作"没配"，用默认值
 */
function zeekrReadFlag(envMap, names, def) {
  if (!envMap) return def;
  var norm = {};
  for (var k in envMap) {
    if (!Object.prototype.hasOwnProperty.call(envMap, k)) continue;
    norm[zeekrNormKey(k)] = envMap[k];
  }
  for (var i = 0; i < names.length; i++) {
    var key = zeekrNormKey(names[i]);
    if (!Object.prototype.hasOwnProperty.call(norm, key)) continue;
    var v = norm[key];
    if (v === true) return true;
    if (v === false) return false;
    var t = String(v == null ? "" : v).replace(/^[\s"']+|[\s"']+$/g, "").toLowerCase();
    if (t === "") continue;
    if (t === "0" || t === "false" || t === "off" || t === "no") return false;
    if (t.charAt(0) === "$" || t.charAt(0) === "<") continue;
    return true;
  }
  return def;
}

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
  if (cfg.mode !== "sign" && cfg.mode !== "claim" && cfg.mode !== "selfcheck")
    cfg.mode = "all";
  // 抓取开关：只认 CAPOFF（停止抓取）。刻意不看 CAPON ——
  // 客户端模块里残留的 CAPON=false 会把抓取永久关掉（2026-09-19 踩过这个坑）。
  cfg.capOff = zeekrReadFlag(v, ["CAPOFF"], false);
  cfg.captureEnabled = !cfg.capOff;
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
        RT.notify(
          title,
          lines.join("\n") + "\n— 脚本 v" + ZEEKR_PORT_VERSION + " · " + RT.platform
        );
      } catch (e) {}
    }
  };

  // ── 参数自检：MODE=selfcheck（Egern 的「极氪参数自检」脚本就是这个）──
  if (cfg.mode === "selfcheck") {
    var dbgLines = [];
    dbgLines.push(
      "[极氪签到] 🔎 参数自检 @ " +
        zeekrNowCST() +
        " | 客户端: " +
        RT.platform +
        " | 脚本 v" +
        ZEEKR_PORT_VERSION
    );
    var ekeys = [];
    for (var ek in RT.env || {}) {
      if (Object.prototype.hasOwnProperty.call(RT.env, ek)) ekeys.push(ek);
    }
    ekeys.sort();
    dbgLines.push("[极氪签到] 客户端传进来的参数（" + ekeys.length + " 个）:");
    var hasDeprecated = false;
    for (var ei = 0; ei < ekeys.length; ei++) {
      var ekk = ekeys[ei];
      var evv = RT.env[ekk];
      var shown = String(evv == null ? "" : evv);
      if (/token|bearer|auth|cookie/i.test(ekk))
        shown = shown ? "已配置（" + shown.length + " 字符，不显示）" : "(空)";
      dbgLines.push("  · " + ekk + " = " + shown + " (" + typeof evv + ")");
      var nk = zeekrNormKey(ekk);
      if (nk === "CAPON" || nk === "NOCAP") hasDeprecated = true;
    }
    if (hasDeprecated) {
      dbgLines.push(
        "[极氪签到] ⚠️ 上面有已废弃的 ZEEKR_CAPON —— 它是旧版模块留下的残留值，" +
          "现在的脚本**完全不读它**（只认「停止抓取 ZEEKR_CAPOFF」）。" +
          "可以在模块设置里把这个环境变量删掉，留着也无害。"
      );
    }
    var rawStored = null;
    try {
      rawStored = RT.storeProbe ? RT.storeProbe() : null;
    } catch (eSC) {
      rawStored = null;
    }
    var storedTok = zeekrTokenFromStore(rawStored);
    if (storedTok) {
      var si = zeekrParseToken(storedTok);
      dbgLines.push(
        "[极氪签到] 持久化存储 zeekr_val: 有 Token（账号 " +
          (si.accountId || "?") +
          "，剩余 " +
          si.daysLeft +
          " 天）"
      );
    } else {
      dbgLines.push(
        "[极氪签到] 持久化存储 zeekr_val: " +
          (rawStored ? "有值但解析不出 Token（" + String(rawStored).slice(0, 40) + "…）" : "空（还没抓到过）")
      );
    }
    dbgLines.push(
      "[极氪签到] 抓取开关: " +
        (cfg.captureEnabled ? "开（会抓取）" : "关（CAPOFF=1，不抓取）") +
        " | 通知显示完整Token: " +
        (zeekrReadFlag(RT.env, ["CAPSHOW"], true) ? "开" : "关") +
        " | 抓取调试: " +
        (zeekrReadFlag(RT.env, ["CAPDEBUG"], false) ? "开" : "关")
    );
    // 定时任务实际会用哪个 Token（env 优先，其次存储）
    var scTok = "";
    for (var sk in RT.env || {}) {
      if (!Object.prototype.hasOwnProperty.call(RT.env, sk)) continue;
      if (zeekrNormKey(sk) === "TOKEN" && String(RT.env[sk] || "").trim())
        scTok = zeekrCleanToken(RT.env[sk]);
    }
    var scSrc = scTok ? "模块参数 / 脚本参数里填的" : storedTok ? "持久化存储里抓到的" : "";
    dbgLines.push(
      "[极氪签到] 定时任务用哪个 Token: " + (scSrc || "没有（既没填也没抓到，任务会报错）")
    );
    dbgLines.push(
      "[极氪签到] 说明: 模块设置里的「极氪 Token」**留空即可** —— 抓到的 Token 存在客户端" +
        "持久化存储里（键 zeekr_val），脚本运行时会自动读它；iOS 不允许脚本回写模块设置页，" +
        "所以那一栏永远是空的，不是没抓到。"
    );
    if (scTok || storedTok) {
      dbgLines.push(
        "[极氪签到] 当前可用的 Token（要填到别处就复制这一整行，含 Bearer）:\n" +
          (scTok || storedTok)
      );
    }
    for (var di = 0; di < dbgLines.length; di++) {
      lines.push(dbgLines[di]);
      RT.log(dbgLines[di]);
    }
    // 自检是手动触发的，必须无条件发通知（不看「任务通知」开关），否则查不出问题
    if (RT.notify) {
      try {
        RT.notify("🔎 极氪签到参数自检", dbgLines.join("\n"));
      } catch (eSN) {}
    }
    return { ok: true, lines: lines, selfcheck: true };
  }

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

/* ================= 运行时适配（QX / Loon / Stash / Surge / Node） ============ */

(function () {
  var isNode =
    typeof process !== "undefined" &&
    process.versions &&
    !!process.versions.node;
  var hasTask =
    typeof $task !== "undefined" && $task && typeof $task.fetch === "function";
  var hasHttpClient =
    typeof $httpClient !== "undefined" && $httpClient !== null;
  var platform = "Node";
  if (hasTask) platform = "Quantumult X";
  else if (hasHttpClient) {
    if (
      typeof $environment !== "undefined" &&
      $environment &&
      ($environment["stash-build"] || $environment["stash-version"])
    )
      platform = "Stash";
    else if (typeof $loon !== "undefined") platform = "Loon";
    else platform = "Loon/Stash/Surge";
  } else if (!isNode) platform = "未知客户端";

  function merge(target, obj) {
    if (!obj || typeof obj !== "object") return target;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var val = obj[k];
      if (val === undefined || val === null || val === "") continue;
      target[k] = val;
    }
    return target;
  }

  function parseArgString(str) {
    var out = {};
    str = String(str).trim();
    if (!str) return out;
    if (str.charAt(0) === "{") {
      try {
        var o = JSON.parse(str);
        if (o && typeof o === "object") return o;
      } catch (e) {}
    }
    var parts = str.split(/[&\n\r]+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var idx = p.indexOf("=");
      var key = idx < 0 ? p : p.slice(0, idx).trim();
      var val = idx < 0 ? "1" : p.slice(idx + 1).trim();
      try {
        val = decodeURIComponent(val);
      } catch (e2) {}
      if (key) out[key] = val;
    }
    return out;
  }

  var env = {};
  merge(env, ZEEKR_DEFAULT_CONFIG);

  // Node / 青龙：环境变量
  if (isNode && process.env) {
    for (var pe in process.env) {
      if (!Object.prototype.hasOwnProperty.call(process.env, pe)) continue;
      if (/^ZEEKR/i.test(pe)) env[pe] = process.env[pe];
    }
  }

  // Loon / Stash / Surge：$argument
  try {
    if (typeof $argument !== "undefined" && $argument) {
      if (typeof $argument === "object") merge(env, $argument);
      else merge(env, parseArgString($argument));
    }
  } catch (e3) {}

  // Loon：$environment.params
  try {
    if (
      typeof $environment !== "undefined" &&
      $environment &&
      $environment.params
    ) {
      if (typeof $environment.params === "object")
        merge(env, $environment.params);
      else merge(env, parseArgString($environment.params));
    }
  } catch (e4) {}

  // Quantumult X：URL # 参数（不会发到服务器）
  try {
    if (
      typeof $environment !== "undefined" &&
      $environment &&
      $environment.variables
    ) {
      for (var vk in $environment.variables) {
        if (!Object.prototype.hasOwnProperty.call($environment.variables, vk))
          continue;
        var vv = $environment.variables[vk];
        if (typeof vv === "string") {
          try {
            vv = decodeURIComponent(vv);
          } catch (e5) {}
        }
        env[vk] = vv;
      }
    }
  } catch (e6) {}

  function http(o) {
    return new Promise(function (resolve, reject) {
      if (hasTask) {
        var qxReq = { url: o.url, method: o.method, headers: o.headers };
        if (o.body !== null && o.body !== undefined) qxReq.body = o.body;
        if (o.method === "GET") delete qxReq.body;
        qxReq.opts = {
          redirection: true,
          "skip-cert-verify": false,
          "auto-cookie": false,
        };
        $task.fetch(qxReq).then(
          function (r) {
            resolve({ status: r.statusCode, headers: r.headers, body: r.body });
          },
          function (e) {
            reject(
              new Error("请求失败: " + ((e && (e.error || e.message)) || e))
            );
          }
        );
        return;
      }
      if (hasHttpClient) {
        var req = { url: o.url, method: o.method, headers: o.headers };
        if (o.body !== null && o.body !== undefined) req.body = o.body;
        if (o.timeoutMs) req.timeout = Math.max(1, Math.round(o.timeoutMs / 1000));
        var fn =
          String(o.method || "GET").toUpperCase() === "GET"
            ? $httpClient.get
            : $httpClient.post;
        if (typeof fn !== "function") {
          reject(new Error("当前客户端不支持该请求方法"));
          return;
        }
        fn(req, function (err, resp, data) {
          if (err) {
            reject(new Error("请求失败: " + err));
            return;
          }
          resolve({
            status: (resp && resp.status) || 0,
            headers: (resp && resp.headers) || {},
            body: data,
          });
        });
        return;
      }
      if (isNode && typeof fetch === "function") {
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
          body:
            o.body === null || o.body === undefined ? undefined : o.body,
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
      reject(new Error("当前运行环境没有可用的 HTTP 客户端"));
    });
  }

  function notify(title, body) {
    try {
      if (typeof $notify === "function") {
        $notify(title, "", body);
        return true;
      }
    } catch (e) {}
    try {
      if (
        typeof $notification !== "undefined" &&
        $notification &&
        typeof $notification.post === "function"
      ) {
        $notification.post(title, "", body);
        return true;
      }
    } catch (e2) {}
    return false;
  }

  function log(msg) {
    try {
      if (typeof console !== "undefined" && console.log) console.log(msg);
    } catch (e) {}
  }

  function finish() {
    try {
      if (typeof $done === "function") $done({});
    } catch (e) {}
  }

  /* ── 持久化存储 + Token 自动抓取 ────────────────────────────────────────
   * rewrite/HTTP 脚本上下文（App 请求经 MITM 时触发）：把请求头里的
   * Authorization 存进客户端持久化存储（键名 zeekr_val，与常见极氪脚本通用），
   * 之后定时任务不填 TOKEN 也能跑。
   * 定时任务上下文：env 里没 Token 就用存储里的兜底。
   * ─────────────────────────────────────────────────────────────────── */
  var ZEEKR_STORE_KEY = "zeekr_val";
  function storeRead(key) {
    var k = key || ZEEKR_STORE_KEY;
    try {
      if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.read)
        return $persistentStore.read(k);
    } catch (e) {}
    try {
      if (typeof $prefs !== "undefined" && $prefs && $prefs.valueForKey)
        return $prefs.valueForKey(k);
    } catch (e2) {}
    return null;
  }
  function storeWrite(val, key) {
    var k = key || ZEEKR_STORE_KEY;
    try {
      if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.write) {
        $persistentStore.write(val, k);
        return true;
      }
    } catch (e) {}
    try {
      if (typeof $prefs !== "undefined" && $prefs && $prefs.setValueForKey) {
        $prefs.setValueForKey(val, k);
        return true;
      }
    } catch (e2) {}
    return false;
  }
  function hasTokenInEnv() {
    for (var k in env) {
      if (!Object.prototype.hasOwnProperty.call(env, k)) continue;
      if (zeekrNormKey(k) === "TOKEN" && String(env[k]).trim()) return true;
    }
    return false;
  }

  var scriptType = "";
  try {
    if (typeof $script !== "undefined" && $script && $script.type)
      scriptType = String($script.type);
  } catch (eS) {}
  var inRewrite = /request|response|http/i.test(scriptType)
    ? true
    : !scriptType && typeof $request !== "undefined" && !!$request && !!$request.headers;

  if (inRewrite) {
    // 抓取开关：只认 CAPOFF（「停止抓取」打开时跳过）。刻意不看 CAPON —— 客户端里残留的
    // CAPON=false 会把抓取永久关掉（2026-09-19 踩过这个坑）。抓过一次就能关掉，免得每次开 App 都写存储/弹通知。
    // 客户端关法：Egern 模块设置 / Loon 插件参数 / QX 的 # 参数 / Stash 的 argument。
    if (zeekrReadFlag(env, ["CAPOFF", "NOCAP"], false)) {
      log("[极氪签到] 抓取已关闭（CAPOFF=1 / 「停止抓取」开关已打开），跳过本次抓取");
      finish();
      return;
    }
    var rawHeaders = ($request && $request.headers) || {};
    var lower = {};
    for (var hk in rawHeaders) {
      if (!Object.prototype.hasOwnProperty.call(rawHeaders, hk)) continue;
      lower[String(hk).toLowerCase()] = rawHeaders[hk];
    }
    var auth = lower["authorization"] || lower["Authorization"] || "";
    var capDebug = zeekrReadFlag(env, ["CAPDEBUG"], false);
    var showTokFlag = zeekrReadFlag(env, ["CAPSHOW"], true);
    if (capDebug) {
      var u = String(($request && $request.url) || "");
      notify(
        "🔍 极氪抓取调试（命中一条请求）",
        ($request && $request.method ? $request.method : "?") +
          " " +
          u.replace(/^https?:\/\/[^/]+/, "") +
          "\n" +
          (auth ? "带 Authorization ✓" : "没有 Authorization ✗") +
          "\n（把 CAPDEBUG 关掉就不会再弹）"
      );
    }
    if (auth && /^Bearer\s/i.test(String(auth))) {
      var prev = zeekrTokenFromStore(storeRead());
      var back = prev;
      if (prev !== auth) {
        storeWrite(
          JSON.stringify({
            authorization: auth,
            device_id: lower["device_id"] || "",
            ts: Date.now(),
          })
        );
        // 回读一次，确认真的写进去了（有些客户端在 request 脚本里不允许写存储）
        back = zeekrTokenFromStore(storeRead());
      }
      var ti = zeekrParseToken(auth);
      var tip =
        "账号 " +
        (ti.accountId || "未知") +
        "，有效期至 " +
        (ti.exp ? zeekrCSTDate(ti.exp) : "未知") +
        "（剩余 " +
        ti.daysLeft +
        " 天）";
      var stored = back === auth;
      var ruleName = "";
      try {
        if (typeof $script !== "undefined" && $script && $script.name) ruleName = String($script.name);
      } catch (e) {}
      log(
        "[极氪签到] 🔐 已抓取 Token: " +
          tip +
          (stored ? "（已存 ✓）" : "（⚠️ 存储写入失败）") +
          (ruleName ? " 规则:" + ruleName : "")
      );
      // 抓到就通知（开关没关就一定有反馈）
      var changed = prev !== auth;
      var body =
        tip +
        "\n" +
        (stored
          ? changed
            ? "已存入客户端持久化存储 ✓，定时任务会自动使用"
            : "和上次抓到的一样，已存着；定时任务会自动使用"
          : "⚠️ 存储写入失败：定时任务无法自动使用，请改用参数手填 TOKEN") +
        (ruleName ? "\n触发规则：" + ruleName : "") +
        "\n脚本 v" + ZEEKR_PORT_VERSION;
      if (showTokFlag) {
        body += "\n\n青龙等无法自动抓取的平台，把这行复制过去当 Token：\n" + auth;
        log("[极氪签到] 🔐 可复制给青龙的 Token: " + auth);
      }
      notify("✅ 极氪 Token 已保存", body);
    } else {
      log("[极氪签到] ⚠️ 这条请求没有 Authorization 头，未抓取");
    }
    finish();
    return;
  }

  if (!hasTokenInEnv()) {
    var stored = zeekrTokenFromStore(storeRead());
    if (stored) {
      env.ZEEKR_TOKEN = stored;
      log("[极氪签到] 🔐 使用持久化存储里的 Token（抓取时间见通知/日志）");
    } else {
      log(
        "[极氪签到] ⚠️ 既没有配置 Token，也没有抓取过；请先按 README 配好抓取规则（打开极氪 App 点一下即可）"
      );
    }
  }

  var RT = {
    platform: platform,
    env: env,
    storeProbe: storeRead,
    http: http,
    notify: notify,
    log: log,
    finish: finish,
  };

  zeekrMain(RT)
    .then(function (r) {
      RT.finish();
      if (isNode && r && r.ok === false) process.exit(1);
    })
    .catch(function (err) {
      var msg = "❌ 执行异常: " + ((err && err.message) || String(err));
      log("[极氪签到] " + msg);
      notify("❌ 极氪签到异常", msg);
      RT.finish();
      if (isNode) process.exit(1);
    });
})();
