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
 *         ZEEKR_TOKEN: "Bearer 粘贴你的Token"
 *         ZEEKR_MODE: "all"     # all | sign | claim
 *         ZEEKR_TAG: "凌晨场"
 *         # ZEEKR_POLL: "1"     # 1 = 脚本内部轮询到领完（配合 timeout: 600）
 *         # ZEEKR_STEPS: "10000"
 *
 * ── 说明 ──────────────────────────────────────────────────────────────
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
    try {
      if (ctx.storage && typeof ctx.storage.get === "function")
        return ctx.storage.get(ZEEKR_STORE_KEY);
    } catch (e) {}
    return null;
  }
  function storeWrite(val) {
    try {
      if (ctx.storage && typeof ctx.storage.set === "function") {
        ctx.storage.set(ZEEKR_STORE_KEY, val);
        return true;
      }
    } catch (e) {}
    return false;
  }
  function hasTokenInEnv() {
    for (var k in env) {
      if (!Object.prototype.hasOwnProperty.call(env, k)) continue;
      if (zeekrNormKey(k) === "TOKEN" && String(env[k]).trim()) return true;
    }
    return false;
  }
  function headerGet(hdrs, name) {
    try {
      if (hdrs && typeof hdrs.get === "function") return hdrs.get(name) || "";
      if (hdrs) return hdrs[name] || hdrs[name.toLowerCase()] || "";
    } catch (e) {}
    return "";
  }

  // HTTP 脚本上下文（Egern 把请求交给我们时带 ctx.request）：抓 Token 后立刻返回
  if (ctx.request && ctx.request.headers) {
    var auth = String(headerGet(ctx.request.headers, "authorization") || "");
    var dbg = String(env.ZEEKR_CAPDEBUG || env.CAPDEBUG || "").toLowerCase();
    var capDebug = !(dbg === "" || dbg === "0" || dbg === "false" || dbg === "off" || dbg === "no");
    if (capDebug) {
      var uu = String((ctx.request && ctx.request.url) || "");
      try {
        ctx.notify({
          title: "🔍 极氪抓取调试（命中一条请求）",
          body:
            ((ctx.request && ctx.request.method) || "?") +
            " " +
            uu.replace(/^https?:\/\/[^/]+/, "") +
            "\n" +
            (auth ? "带 Authorization ✓" : "没有 Authorization ✗"),
        });
      } catch (e) {}
      log("[极氪签到] 🔍 抓取调试: " + uu + " auth=" + (auth ? "有" : "无"));
    }
    if (auth && /^Bearer\s/i.test(auth)) {
      var prevEg = zeekrTokenFromStore(storeRead());
      var backEg = prevEg;
      if (prevEg !== auth) {
        storeWrite(
          JSON.stringify({
            authorization: auth,
            device_id: headerGet(ctx.request.headers, "device_id"),
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
      if (prevEg !== auth || capDebug) {
        var bodyEg =
          tipEg +
          "\n" +
          (storedEg
            ? "已存入客户端持久化存储 ✓，定时任务会自动使用"
            : "⚠️ 存储写入失败：定时任务无法自动使用，请改用模块参数手填 ZEEKR_TOKEN") +
          (ruleNameEg ? "\n触发规则：" + ruleNameEg : "") +
          "\n\n青龙等无法自动抓取的平台，把这行复制过去当 Token：\n" +
          auth;
        log("[极氪签到] 🔐 可复制给青龙的 Token: " + auth);
        try {
          ctx.notify({ title: "✅ 极氪 Token 已自动保存", body: bodyEg });
        } catch (e) {}
      }
    } else {
      log("[极氪签到] ⚠️ 这条请求没有 Authorization 头，未抓取");
    }
    return;
  }

  if (!hasTokenInEnv()) {
    var storedEg = zeekrTokenFromStore(storeRead());
    if (storedEg) {
      env.ZEEKR_TOKEN = storedEg;
      log("[极氪签到] 🔐 使用持久化存储里的 Token（自动抓取）");
    } else
      log(
        "[极氪签到] ⚠️ 既没有配置 Token，也没有抓取过；请先按 README 配好抓取规则（打开极氪 App 点一下即可）"
      );
  }

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
    env: env,
    http: http,
    notify: notify,
    log: log,
    finish: function () {},
  };

  return await zeekrMain(RT);
}
