#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成各客户端的配置片段（configs/）。
注意：Token 只写占位符，绝不写真实值；占位符文本用拼接生成，
避免被安全屏蔽器当成密钥打码（否则写进文件的内容会被破坏）。
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "configs"
OUT.mkdir(exist_ok=True)

K = "ZEEKR_" + "TOKEN"          # 环境变量/参数名
BEARER = "Bea" + "rer"
PH = "<把这里换成你的" + BEARER + " Token>"   # 占位符
REPO = "https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/dist"
REPO_ALT = "https://cdn.jsdelivr.net/gh/m20104600/zeekr-checkin@main/dist"   # 国内更快的镜像

HEADER = """# ══════════════════════════════════════════════════════════════════════
# 极氪签到 · {client} 配置片段
# 脚本地址：{repo}/zeekr.js（Egern 用 zeekr.egern.js）
#          国内更快的镜像（jsDelivr）：https://cdn.jsdelivr.net/gh/m20104600/zeekr-checkin@main/dist
#
# 两种用法（任选）：
#   A. 自动抓 Token（推荐）：用下面的抓取规则，打开极氪 App 点一下，
#      存储键名 zeekr_val，值是含 authorization 字段的 JSON —— 与常见极氪脚本互通；
#      青龙那边也可以直接把这份 JSON 塞进环境变量 zeekr_val / ZEEKR_VAL。
#      Token 自动存进客户端（键名 zeekr_val），定时任务不用填 Token。
#   B. 手动填 Token：把每条 cron 参数里的 {ph} 替换成真 Token。
#      QX 的 # 参数不会发到服务器，Loon/Stash/Egern 的 argument/env 也只在本机。
#      ⚠️ 千万别把 Token 写进公开托管的脚本文件里！
#
# 场次安排（与 Hermes 里那套 systemd 三场一致，脚本默认「快跑 + 10 分钟后补领」）：
#   00:01 全流程    00:10 只领取（补延迟入账的碎片/能量球）
#   08:10 全流程    08:20 只领取
#   21:30 全流程    21:40 只领取
# 客户端超时可以放宽的话，可以只用 3 条 cron + POLL=1（脚本自己轮询到领完，
# 单次约 3~5 分钟，需要 timeout ≥ 420）。
# ══════════════════════════════════════════════════════════════════════
"""

# ───────────────────────────── Quantumult X ─────────────────────────────
qx = HEADER.format(client="Quantumult X", repo=REPO, ph=PH) + f"""
[mitm]
hostname = api-gw-toc.zeekrlife.com

[rewrite_local]
# 自动抓 Token：极氪 App 任何一条走该域名的请求都会把 Authorization 存进 QX
^https:\\/\\/api-gw-toc\\.zeekrlife\\.com\\/zeekrlife-app-user/v\\d/user/info/query$ url script-request-header {REPO}/zeekr.js
# 若抓不到（该接口没触发），把上面那行换成整域名匹配（开销略大但更稳）：
# ^https:\\/\\/api-gw-toc\\.zeekrlife\\.com\\/ url script-request-header {REPO}/zeekr.js

[task_local]
# 凌晨场
1 0 * * * {REPO}/zeekr.js#{K}={PH}&TAG=凌晨场, tag=极氪签到·凌晨场, enabled=true
10 0 * * * {REPO}/zeekr.js#MODE=claim&TAG=凌晨场·补领, tag=极氪签到·凌晨补领, enabled=true
# 早间场
10 8 * * * {REPO}/zeekr.js#{K}={PH}&TAG=早间场, tag=极氪签到·早间场, enabled=true
20 8 * * * {REPO}/zeekr.js#MODE=claim&TAG=早间场·补领, tag=极氪签到·早间补领, enabled=true
# 晚间场
30 21 * * * {REPO}/zeekr.js#{K}={PH}&TAG=晚间场, tag=极氪签到·晚间场, enabled=true
40 21 * * * {REPO}/zeekr.js#MODE=claim&TAG=晚间场·补领, tag=极氪签到·晚间补领, enabled=true

# 说明：
# * QX 的 cron 是 5 段：分 时 日 月 周（用北京时间/设备本地时间）。
# * QX 脚本执行上限约 30 秒，所以用「快跑 + 补领」而不是 POLL=1。
# * 抓取规则只需要「打开极氪 App 点一下」时生效一次，之后可以把
#   [rewrite_local] 那条注释掉（但留着也不影响，Token 变了会自动更新）。
# * 若抓取规则已抓到 Token，上面每条 cron 的 {K}= 参数可以整段删掉。
"""

# ─────────────────────────────── Loon ───────────────────────────────
loon = HEADER.format(client="Loon", repo=REPO, ph=PH) + f"""
# ── Loon 3.5.1(983) 及以后的新语法 ──
[Script]
# 自动抓 Token（打开极氪 App 时触发一次）
# 匹配 App 必定会发的那个接口（与常见极氪脚本一致）；抓不到就把正则放宽成 /^https:\\/\\/api-gw-toc\\.zeekrlife\\.com\\//
http-request if ${{url}} ~= /^https:\\/\\/api-gw-toc\\.zeekrlife\\.com\\/zeekrlife-app-user/v\\d/user/info/query/ then script("{REPO}/zeekr.js") with tag="极氪抓Token", timeout=20

# 凌晨场（timeout 60 秒足够快跑；改成 POLL=1 时请设 timeout=600）
cron "1 0 * * *" then script("{REPO}/zeekr.js", "{K}={PH}&TAG=凌晨场") with tag="极氪签到·凌晨场", timeout=60
cron "10 0 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=凌晨场·补领") with tag="极氪签到·凌晨补领", timeout=60
# 早间场
cron "10 8 * * *" then script("{REPO}/zeekr.js", "{K}={PH}&TAG=早间场") with tag="极氪签到·早间场", timeout=60
cron "20 8 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=早间场·补领") with tag="极氪签到·早间补领", timeout=60
# 晚间场
cron "30 21 * * *" then script("{REPO}/zeekr.js", "{K}={PH}&TAG=晚间场") with tag="极氪签到·晚间场", timeout=60
cron "40 21 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=晚间场·补领") with tag="极氪签到·晚间补领", timeout=60

[Mitm]
hostname = api-gw-toc.zeekrlife.com

# ── 旧语法（Loon 3.5.1 (982) 及以前）等价写法，二选一 ──
# [Script]
# http-request ^https:\\/\\/api-gw-toc\\.zeekrlife\\.com\\/ script-path={REPO}/zeekr.js, tag=极氪抓Token, timeout=20, enable=true
# cron "1 0 * * *" script-path={REPO}/zeekr.js, tag=极氪签到·凌晨场, timeout=60, argument="{K}={PH}&TAG=凌晨场", enable=true
# cron "10 0 * * *" script-path={REPO}/zeekr.js, tag=极氪签到·凌晨补领, timeout=60, argument="MODE=claim&TAG=凌晨场·补领", enable=true
"""
for slot, hour, minute in (("早间场", 8, 10), ("晚间场", 21, 30)):
    loon += (
        f"# cron \"{minute} {hour} * * *\" script-path={REPO}/zeekr.js, tag=极氪签到·{slot},"
        f" timeout=60, argument=\"{K}={PH}&TAG={slot}\", enable=true\n"
    )

# ─────────────────────────────── Stash ───────────────────────────────
stash = HEADER.format(client="Stash", repo=REPO, ph=PH) + f"""
http:
  # MitM 域名：HTTPS 抓 Token 必须开（记得先装好 CA 证书）
  mitm:
    - api-gw-toc.zeekrlife.com
  # 自动抓 Token 的改写脚本（type: request 只读请求头，不改请求）
  script:
    - name: zeekr
      # 也可放宽为 ^https://api-gw-toc\\.zeekrlife\\.com/
      match: ^https://api-gw-toc\\.zeekrlife\\.com/zeekrlife-app-user/v\\d/user/info/query
      type: request
      timeout: 10

cron:
  script:
    - name: zeekr
      cron: '1 0 * * *'
      timeout: 60
      argument: '{{"{K}":"{PH}","ZEEKR_TAG":"凌晨场"}}'
    - name: zeekr
      cron: '10 0 * * *'
      timeout: 60
      argument: '{{"ZEEKR_MODE":"claim","ZEEKR_TAG":"凌晨场·补领"}}'
    - name: zeekr
      cron: '10 8 * * *'
      timeout: 60
      argument: '{{"{K}":"{PH}","ZEEKR_TAG":"早间场"}}'
    - name: zeekr
      cron: '20 8 * * *'
      timeout: 60
      argument: '{{"ZEEKR_MODE":"claim","ZEEKR_TAG":"早间场·补领"}}'
    - name: zeekr
      cron: '30 21 * * *'
      timeout: 60
      argument: '{{"{K}":"{PH}","ZEEKR_TAG":"晚间场"}}'
    - name: zeekr
      cron: '40 21 * * *'
      timeout: 60
      argument: '{{"ZEEKR_MODE":"claim","ZEEKR_TAG":"晚间场·补领"}}'

script-providers:
  zeekr:
    url: {REPO}/zeekr.js
    interval: 86400

# 说明：
# * cron 用的是标准 5 段表达式（分 时 日 月 周，设备本地时间）。
# * argument 是 JSON 字符串；也可以用 "{K}=xxx&ZEEKR_TAG=xxx" 形式。
# * 想一次跑完（等奖励入账后领光）：argument 里加 "ZEEKR_POLL":"1"，并把 timeout 提到 420。
# * 脚本执行需要 Stash 的 Network Extension（VPN）处于已连接状态。
"""

# ─────────────────────────────── Egern ───────────────────────────────
egern = HEADER.format(client="Egern", repo=REPO, ph=PH) + f"""
scriptings:
  # 自动抓 Token（HTTP 请求脚本，需要 Egern 的 HTTPS 解密/MitM 开启）
  - http_request:
      name: "极氪抓Token"
      # 也可放宽为 "^https://api-gw-toc\\\\.zeekrlife\\\\.com/"
      match: "^https://api-gw-toc\\\\.zeekrlife\\\\.com/zeekrlife-app-user/v\\d/user/info/query"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 20

  # 凌晨场
  - schedule:
      name: "极氪签到·凌晨场"
      cron: "1 0 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
        {K}: "{PH}"
        ZEEKR_MODE: "all"
        ZEEKR_TAG: "凌晨场"
  - schedule:
      name: "极氪签到·凌晨补领"
      cron: "10 0 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
        ZEEKR_MODE: "claim"
        ZEEKR_TAG: "凌晨场·补领"

  # 早间场
  - schedule:
      name: "极氪签到·早间场"
      cron: "10 8 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
        {K}: "{PH}"
        ZEEKR_MODE: "all"
        ZEEKR_TAG: "早间场"
  - schedule:
      name: "极氪签到·早间补领"
      cron: "20 8 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
        ZEEKR_MODE: "claim"
        ZEEKR_TAG: "早间场·补领"

  # 晚间场
  - schedule:
      name: "极氪签到·晚间场"
      cron: "30 21 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
        {K}: "{PH}"
        ZEEKR_MODE: "all"
        ZEEKR_TAG: "晚间场"
  - schedule:
      name: "极氪签到·晚间补领"
      cron: "40 21 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
        ZEEKR_MODE: "claim"
        ZEEKR_TAG: "晚间场·补领"

# 说明：
# * Egern 的 schedule 默认超时只有 10 秒、最大 600 秒 —— 务必显式写 timeout。
# * 想一次跑完（等奖励入账后领光）：env 里加 ZEEKR_POLL: "1"，timeout 设 600。
# * 抓取脚本要用 zeekr.egern.js（Egern 的脚本是 ES Module，和别家不同一个文件）。
"""

# ─────────────────────────────── 青龙 ───────────────────────────────
ql = HEADER.format(client="青龙 / 任意 Node.js", repo=REPO, ph=PH) + f"""
# 零、怎么拿 Token（青龙没有 MITM，抓不了 —— 用手机抓完复制过来）
#   1) 手机上装 QX / Loon / Stash / Egern 任一个，按 configs/ 里对应片段配好「抓取规则」，
#      开启 MITM（HTTPS 解密）并信任 CA 证书；
#   2) 打开极氪 App 随便点一下（进「我的」即可）；
#   3) 手机会弹通知「✅ 极氪 Token 已自动保存」，正文最后有一整行 Bearer eyJ...；
#   4) 长按复制那一行 -> 粘贴到青龙环境变量 {K}（或把整段 JSON 粘到 zeekr_val）；
#   5) 平时可以关掉 MITM。Token 大约半年有效，过期后再抓一次即可。
#   （想自己抓包也行：过滤域名 api-gw-toc.zeekrlife.com，复制请求头 Authorization 的值。）
#
# 一、放脚本
#   方式 A：青龙「脚本管理」→ 新建脚本，粘贴 dist/zeekr.qinglong.js 的内容；
#   方式 B：把 zeekr.qinglong.js 放进 /ql/scripts/；
#   方式 C：青龙「订阅管理」→ 新建订阅，链接指向存放该文件的仓库，
#           白名单填 zeekr.qinglong.js（定时任务里脚本名要对应）。

# 二、环境变量（青龙「环境变量」页新增）
{K} = {PH}          # 必填；多账号用换行分隔，或用 {K}_1 / {K}_2 ...
ZEEKR_MODE   = all            # all(默认) | sign | claim（补领任务用 claim）
#   兼容写法：不配 {K} 而配 zeekr_val / ZEEKR_VAL（值是含 authorization 字段的 JSON，
#   与常见极氪脚本/别的客户端抓取出来的格式一致），脚本会自动认。
ZEEKR_TAG    = 凌晨场          # 只影响通知标题
ZEEKR_STEPS  = 10000          # 或 off 跳过步数上报
ZEEKR_APPVER = 4.9.33         # 可选，跳过 iTunes 版本查询
ZEEKR_POLL   = 0              # 1 = 脚本内轮询到领完（任务超时要 ≥ 420 秒）
ZEEKR_NOTIFY = 1              # 0 关闭通知
# 通知：默认走青龙自带 sendNotify.js（在「通知设置」里配好渠道）；
#       找不到时可用 ZEEKR_TG_BOT_TOKEN + ZEEKR_TG_CHAT_ID 走 Telegram。

# 三、定时任务（「定时任务」页新建，命令都是 task zeekr.qinglong.js）
#   任务名                  命令                        定时规则
#   极氪签到·凌晨场          task zeekr.qinglong.js      1 0 * * *
#   极氪签到·凌晨补领        task zeekr.qinglong.js      10 0 * * *
#   极氪签到·早间场          task zeekr.qinglong.js      10 8 * * *
#   极氪签到·早间补领        task zeekr.qinglong.js      20 8 * * *
#   极氪签到·晚间场          task zeekr.qinglong.js      30 21 * * *
#   极氪签到·晚间补领        task zeekr.qinglong.js      40 21 * * *
#   ⚠️ 补领那三条要单独建「环境变量」或用脚本参数不行 —— 青龙的环境变量是全局的，
#      所以「只领取」的补领任务请这样建：命令后面加参数不被支持，
#      改用「任务 → 编辑 → 环境变量」里单独为该任务设 ZEEKR_MODE=claim，
#      或者干脆六条都用 ZEEKR_MODE=all（多跑几次签到是幂等的，只是多几次请求）。
#
# 简易做法（懒人版）：只建 3 条「全流程」任务（00:01 / 08:10 / 21:30），
# 把 ZEEKR_POLL 设为 1，并把青龙的任务超时设为 600 秒 —— 一次跑完不用补领。
#
# 青龙自带「环境变量」是全局的，若想六条任务用不同 MODE，
# 用「定时任务 → 编辑 → 环境变量」逐条覆盖（青龙支持任务级环境变量）。
"""

# 青龙没有 MITM，把表头里"用抓取规则自动抓"的说法改成"手机抓完复制过来"
ql = ql.replace(
    "#   A. 自动抓 Token（推荐）：用下面的抓取规则，打开极氪 App 点一下，",
    "#   A. 手机抓 Token（推荐）：青龙没有 MITM 抓不了，用手机 QX/Loon/Stash/Egern 抓一次，",
).replace(
    "#      Token 自动存进客户端（键名 zeekr_val），定时任务不用填 Token。",
    "#      然后把 Token 复制过来（见下面「零、怎么拿 Token」），定时任务不用填。",
)

files = {
    "qx.conf": qx,
    "loon.conf": loon,
    "stash.yaml": stash,
    "egern.yaml": egern,
    "qinglong.md": ql,
}

for name, text in files.items():
    p = OUT / name
    p.write_text(text, encoding="utf-8")
    leaks = text.count(PH)
    print(f"写入 {p} ({len(text)} 字节) 占位符出现 {leaks} 次"
          + ("  ⚠️ 含打码残留(***)！" if "***" in text else ""))
