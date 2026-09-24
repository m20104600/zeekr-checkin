/**
 * 极氪汽车每日自动签到 · Egern 版
 * 适用：Egern（schedule 定时脚本）
 *
 * ── 配置（Profile.yaml）───────────────────────────────────────────────
 * scriptings:
 *   - schedule:
 *       name: "极氪签到·凌晨场"
 *       cron: "1 0 * * *"
 *       script_url: "https://raw.githubusercontent.com/你的用户名/仓库名/main/zeekr.egern.js"
 *       timeout: 600            # 默认只有 10 秒，务必放大（领取轮询最长约 10 分钟）
 *       env:
 *         ZEEKR_MODE: "all"     # all | sign | claim
 *         ZEEKR_TAG: "凌晨场"
 *         # ZEEKR_POLL: "1"     # 1 = 脚本内部轮询到领完（配合 timeout: 600）
 *         # ZEEKR_STEPS: "10000"
 *
 * ── 说明 ──────────────────────────────────────────────────────────────
 * **Token 只有一个来源：打开极氪 App 时自动抓取**（存进客户端持久化存储，键 zeekr_val）。
 * 本脚本**不读** ZEEKR_TOKEN 环境变量（模块设置页里也没有 Token 栏）—— 别人给了也会被忽略，
 * 这样不会出现"填了却不生效"的误会（2026-09-20 起）。
 * Egern 的 schedule 脚本默认超时 10 秒、最大 600 秒。默认 ZEEKR_POLL=0 时脚本
 * 只查一轮（约 10~20 秒），请把 timeout 设到 120 以上留点余量；
 * 想一次跑完（等奖励入账后领光）就把 ZEEKR_POLL 设为 1，timeout 设 600。
 * 也可以两条 cron：`MODE=all` 做任务 + 10 分钟后 `MODE=claim` 只领取。
 *
 * 参数：MODE=all|sign|claim  POLL=0|1  WAITS=45,60,75  SETTLE=180  MAX=600
 *       STEPS=10000|off  TAG=场次  LIKE=1  NOTIFY=0  VERBOSE=1  APPVER=4.9.33
 *       （前缀 ZEEKR_ 可有可无，大小写不敏感）
 */

/* ================= 以下为逻辑，一般不需要修改 ================= */

/*__CORE__*/

/* ================= 运行时适配（Egern ctx） ================= */

export default async function (ctx) {
  var env = {};
  if (ctx && ctx.env) {
    for (var k in ctx.env) {
      if (Object.prototype.hasOwnProperty.call(ctx.env, k) && ctx.env[k] != null)
        env[k] = ctx.env[k];
    }
  }

  /* ── 持久化存储 + Token 自动抓取 ─────────────────────────────────────── */
  var ZEEKR_STORE_KEY = "zeekr_val";

  function storeRead() {
    return storeGet(ZEEKR_STORE_KEY);
  }
  function storeWrite(val) {
    return storeSet(ZEEKR_STORE_KEY, val);
  }
  function storeGet(k) {
    try {
      if (ctx.storage && typeof ctx.storage.get === "function") {
        var v = ctx.storage.get(k);
        return v == null ? null : v;
      }
    } catch (e) {}
    return null;
  }
  function storeSet(k, v) {
    try {
      if (ctx.storage && typeof ctx.storage.set === "function") {
        ctx.storage.set(k, v);
        return true;
      }
    } catch (e) {}
    return false;
  }

  /**
   * 读一个布尔开关（键名大小写不敏感、ZEEKR_ 前缀可有可无）：
   *   - 真布尔（有些运行环境传的是 boolean）与字符串都认
   *   - 只有明确写成 0 / false / off / no 才算"关"
   *   - 没配、空值、未替换的占位符（${X} / <x>）→ 用默认值
   */
  function envFlag(name, def) {
    var want = zeekrNormKey(name);
    for (var k in env) {
      if (!Object.prototype.hasOwnProperty.call(env, k)) continue;
      if (zeekrNormKey(k) !== want) continue;
      var v = env[k];
      if (v === true) return true;
      if (v === false) return false;
      var t = String(v == null ? "" : v)
        .replace(/^[\s"']+|[\s"']+$/g, "")
        .toLowerCase();
      if (t === "" || t.charAt(0) === "$" || t.charAt(0) === "<") return def;
      if (t === "0" || t === "false" || t === "off" || t === "no") return false;
      return true;
    }
    return def;
  }
  // ── 取头：键名一律小写归一化后再匹配（对齐参考脚本 wf021325/qx 的 ObjectKeys2LowerCase）──
  //   Egern 交过来的 headers 可能是 Headers 对象（有 get / forEach），也可能是普通对象；
  //   普通对象的键名**保留原始大小写**（实测出现过 `Authorization`）。早期只试小写键，
  //   于是恒取不到值 —— 2026-09-20 实测日志：「这条请求没有 Authorization 头，未抓取」。
  function headerAll(hdrs) {
    var out = {};
    try {
      if (!hdrs) return out;
      if (typeof hdrs.forEach === "function") {
        hdrs.forEach(function (v, k) {
          out[String(k).toLowerCase()] = v;
        });
        return out;
      }
      for (var k in hdrs) {
        if (Object.prototype.hasOwnProperty.call(hdrs, k)) out[String(k).toLowerCase()] = hdrs[k];
      }
    } catch (e) {}
    return out;
  }
  function headerGet(hdrs, name) {
    var ln = String(name).toLowerCase();
    try {
      var m = headerAll(hdrs);
      if (m[ln] !== undefined && m[ln] !== null && String(m[ln]) !== "") return m[ln];
      if (hdrs && typeof hdrs.get === "function") {
        var v = hdrs.get(ln) || hdrs.get(name);
        if (v) return v;
      }
    } catch (e) {}
    return "";
  }
  function headerNames(hdrs) {
    var ks = [];
    try {
      var m = headerAll(hdrs);
      for (var k in m) {
        if (Object.prototype.hasOwnProperty.call(m, k)) ks.push(k);
      }
    } catch (e) {}
    return ks;
  }

  // HTTP 脚本上下文（Egern 把请求交给我们时带 ctx.request）：**只做「抓 Token」一件事**，
  // 做完立刻 return —— 绝不落到下面的签到流程（否则定时任务会在每个请求里被重跑一遍）。
  var reqEg = ctx.request || null;
  if (reqEg && reqEg.headers) {
    // 「抓取 Token」开关（模块设置页可编辑，默认开）：关 = 不抓取、不写存储、不弹任何通知（含调试）
    if (!envFlag("CAPTURE", true)) {
      log("[极氪签到] ⏸️「抓取 Token」开关=关：不抓取、不写存储、不通知");
      return;
    }
    var rawAuth = String(headerGet(reqEg.headers, "authorization") || "");
    var auth = zeekrCleanToken(rawAuth);
    var methodEg = String(reqEg.method || "").toUpperCase();
    var capDebug = envFlag("CAPDEBUG", false);
    if (capDebug) {
      var uu = String(reqEg.url || "");
      var hns = headerNames(reqEg.headers);
      try {
        ctx.notify({
          title: "🔍 极氪抓取调试（命中一条请求）",
          body:
            (reqEg.method || "?") +
            " " +
            uu.replace(/^https?:\/\/[^/]+/, "") +
            "\n" +
            (auth ? "带 Authorization ✓" : rawAuth ? "取到 authorization 但形态不认识 ✗" : "没有 Authorization ✗") +
            "\n收到的头 " +
            hns.length +
            " 个: " +
            hns.slice(0, 20).join(", ") +
            (methodEg === "OPTIONS" ? "\n（OPTIONS 预检请求，正常不带 Token）" : ""),
        });
      } catch (e) {}
      log(
        "[极氪签到] 🔍 抓取调试: " +
          uu +
          " auth=" +
          (auth ? "有" : "无") +
          " headers=" +
          hns.join(",")
      );
    }
    if (auth && /^Bearer\s/i.test(auth)) {
      var prevEg = zeekrTokenFromStore(storeRead());
      var backEg = prevEg;
      if (prevEg !== auth) {
        storeWrite(
          JSON.stringify({
            authorization: auth,
            "device_id": headerGet(ctx.request.headers, "device_id"),
            ts: Date.now(),
          })
        );
        // 回读确认（有些运行环境在请求脚本里不允许写存储）
        backEg = zeekrTokenFromStore(storeRead());
      }
      var storedEg = backEg === auth;
      var ruleNameEg = (ctx && ctx.script && ctx.script.name) || "";
      var tiEg = zeekrParseToken(auth);
      var tipEg =
        "账号 " +
        (tiEg.accountId || "未知") +
        "，有效期至 " +
        (tiEg.exp ? zeekrCSTDate(tiEg.exp) : "未知") +
        "（剩余 " +
        tiEg.daysLeft +
        " 天）";
      log(
        "[极氪签到] 🔐 已抓取 Token: " +
          tipEg +
          (storedEg ? "（已存 ✓）" : "（⚠️ 存储写入失败）") +
          (ruleNameEg ? " 规则:" + ruleNameEg : "")
      );
      // 通知门控：Token 变了 → 立刻一条；没变 → 10 分钟内最多一条
      //（防止"开一次 App 弹几十条"，同时保证开关开着时每次打开 App 都能看到一条确认）
      var changedEg = prevEg !== auth;
      var nowEg = Date.now();
      var lastEg = Number(storeGet("zeekr_cap_last") || 0) || 0;
      var quietEg = lastEg > 0 && nowEg - lastEg < 10 * 60 * 1000;
      if (changedEg || capDebug || !quietEg) {
        var bodyEg =
          tipEg +
          "\n" +
          (storedEg
            ? "已存入客户端持久化存储 ✓，定时任务会自动使用"
            : "⚠️ 存储写入失败：请把下面这行 Token 手填到模块设置的「极氪 Token」栏") +
          "\n抓取开关：开 ｜ 脚本 v" +
          ZEEKR_PORT_VERSION +
          " · Egern" +
          (ruleNameEg ? "\n触发规则：" + ruleNameEg : "") +
          "\n点这条通知 = Token 已复制到剪贴板（可粘进模块的「极氪 Token」栏）" +
          "\n\n青龙等无法自动抓取的平台，把这行复制过去当 Token：\n" +
          auth;
        log("[极氪签到] 🔐 可复制给青龙的 Token: " + auth);
        try {
          storeSet("zeekr_cap_last", String(nowEg));
          ctx.notify({
            title: "✅ 极氪 Token 已自动保存" + (changedEg ? "" : "（未变化）"),
            body: bodyEg,
            action: { type: "clipboard", text: auth },
          });
        } catch (e) {}
      }
    } else if (methodEg === "OPTIONS") {
      log("[极氪签到] ⏭️ OPTIONS 预检请求，不带 Token，跳过（参考脚本同样跳过）");
    } else if (rawAuth) {
      log(
        "[极氪签到] ⚠️ 取到 authorization 但不是可用的 JWT（长度 " +
          rawAuth.length +
          "，Bearer 前缀=" +
          (/^Bearer\s/i.test(rawAuth) ? "有" : "无") +
          "），未保存"
      );
    } else {
      log("[极氪签到] 这条请求没有 Authorization 头，未抓取（等带 Token 的请求即可）");
    }
    return;
  }

  // HTTP 上下文但拿不到请求头（例如响应阶段不提供 ctx.request.headers）：
  // 只记一句日志就结束，**绝不**往下跑签到流程
  if (reqEg || ctx.response) {
    log("[极氪签到] HTTP 上下文里没有可用的请求头，本次不抓取（也不会跑签到）");
    return;
  }

  // Token 只有一个来源：抓取后存在持久化存储里的那份（模块设置页里已经没有 Token 栏了）。
  // env 里若被谁塞了 ZEEKR_TOKEN（例如 Profile 的模块引用处），**一律忽略**并记一句日志 ——
  // 免得"填了却不生效"被当成 bug（2026-09-20 用户要求：别再让环境变量误导使用者）。
  var envTokenEg = "";
  for (var kEg in env) {
    if (!Object.prototype.hasOwnProperty.call(env, kEg)) continue;
    if (zeekrNormKey(kEg) !== "TOKEN") continue;
    if (String(env[kEg] == null ? "" : env[kEg]).trim()) envTokenEg = String(env[kEg]);
    delete env[kEg]; // core 是从 env 读 TOKEN 的，这里直接摘掉，确保抓到的那个说了算
  }
  var storedEg = zeekrTokenFromStore(storeRead());
  if (storedEg) {
    env.ZEEKR_TOKEN = storedEg;
    env.ZEEKR_DEVICE_ID = zeekrDeviceIdFromStore(storeRead());
    if (ctx.request && ctx.request.headers)
      env.ZEEKR_DEVICE_ID = headerGet(ctx.request.headers, "device_id") || "";
    log("[极氪签到] 🔐 使用抓取到的 Token（持久化存储 zeekr_val）");
  } else {
    log(
      "[极氪签到] ⚠️ 还没抓到过 Token：把模块里的「抓取 Token」开着，打开一次极氪 App 即可（没有手填的地方）"
    );
  }
  if (envTokenEg)
    log(
      "[极氪签到] ⚠️ env 里带了 TOKEN（长度 " +
        envTokenEg.length +
        "），本脚本只认抓取到的那份，已忽略"
    );

  function http(o) {
    var opts = { timeout: o.timeoutMs || 20000 };
    if (o.headers) opts.headers = o.headers;
    if (o.body !== null && o.body !== undefined) opts.body = o.body;
    var m = String(o.method || "GET").toUpperCase();
    var p;
    if (m === "GET") {
      delete opts.body;
      p = ctx.http.get(o.url, opts);
    } else if (m === "POST") p = ctx.http.post(o.url, opts);
    else if (m === "PUT") p = ctx.http.put(o.url, opts);
    else p = ctx.http.post(o.url, opts);
    return p.then(function (resp) {
      return resp.text().then(function (txt) {
        return { status: resp.status, headers: resp.headers, body: txt };
      });
    });
  }

  function notify(title, body) {
    try {
      if (ctx && typeof ctx.notify === "function") {
        ctx.notify({ title: title, body: body });
        return true;
      }
    } catch (e) {}
    return false;
  }

  function log(msg) {
    try {
      if (typeof console !== "undefined" && console.log) console.log(msg);
    } catch (e) {}
  }

  var RT = {
    platform: "Egern",
    // 缺 Token 时的提示语：Egern 版不给手填（模块设置页里没有 Token 栏），只能靠抓取
    tokenHint:
      "❌ 缺少 Token：把模块里的「抓取 Token」开着，打开一次极氪 App 就会自动抓取并存起来（Egern 版没有手填 Token 的地方）",
    env: env,
    http: http,
    notify: notify,
    log: log,
    finish: function () {},
  };

  return await zeekrMain(RT);
}
