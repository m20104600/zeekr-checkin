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

/*__CORE__*/

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

  function storeRead() {
    try {
      if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.read)
        return $persistentStore.read(ZEEKR_STORE_KEY);
    } catch (e) {}
    try {
      if (typeof $prefs !== "undefined" && $prefs && $prefs.valueForKey)
        return $prefs.valueForKey(ZEEKR_STORE_KEY);
    } catch (e2) {}
    return null;
  }
  function storeWrite(val) {
    try {
      if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.write) {
        $persistentStore.write(val, ZEEKR_STORE_KEY);
        return true;
      }
    } catch (e) {}
    try {
      if (typeof $prefs !== "undefined" && $prefs && $prefs.setValueForKey) {
        $prefs.setValueForKey(val, ZEEKR_STORE_KEY);
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
  /** 读一个布尔型参数（大小写不敏感、前缀 ZEEKR_ 可有可无） */
  function envFlag(name, def) {
    for (var k in env) {
      if (!Object.prototype.hasOwnProperty.call(env, k)) continue;
      if (zeekrNormKey(k) !== name) continue;
      var v = String(env[k]).trim().toLowerCase();
      if (v === "0" || v === "false" || v === "off" || v === "no" || v === "") return false;
      return true;
    }
    return def;
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
    var rawHeaders = ($request && $request.headers) || {};
    var lower = {};
    for (var hk in rawHeaders) {
      if (!Object.prototype.hasOwnProperty.call(rawHeaders, hk)) continue;
      lower[String(hk).toLowerCase()] = rawHeaders[hk];
    }
    var auth = lower["authorization"] || lower["Authorization"] || "";
    if (auth && /^Bearer\s/i.test(String(auth))) {
      var prev = zeekrTokenFromStore(storeRead());
      storeWrite(
        JSON.stringify({
          authorization: auth,
          device_id: lower["device_id"] || "",
          ts: Date.now(),
        })
      );
      var ti = zeekrParseToken(auth);
      var tip =
        "账号 " +
        (ti.accountId || "未知") +
        "，有效期至 " +
        (ti.exp ? zeekrCSTDate(ti.exp) : "未知") +
        "（剩余 " +
        ti.daysLeft +
        " 天）";
      log("[极氪签到] 🔐 已抓取 Token: " + tip);
      if (prev !== auth) {
        var showTok = envFlag("CAPSHOW", true);
        var body = tip + "\n定时任务会自动使用，无需手填 Token";
        if (showTok) {
          body +=
            "\n\n青龙等无法自动抓取的平台，把这行复制过去当 Token：\n" + auth;
          log("[极氪签到] 🔐 可复制给青龙的 Token: " + auth);
        }
        notify("✅ 极氪 Token 已自动保存", body);
      }
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
