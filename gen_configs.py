#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成各客户端的配置（configs/）。

避坑记录（2026-09-19，用户实测踩到）：
  1) 正则一律只在 **一个** 地方（本文件的 RE_* 变量）用 raw 字符串写，且只写一层反斜杠。
     之前多写一层（\\. 变成 \\\\.）→ 正则含义变成"反斜杠+任意字符"，
     抓取规则一条都不会命中（tests/configs-check.py 里有回归测试）。
  2) YAML 里的正则用**单引号**；双引号内 \\d 是非法转义，Egern 直接报 YAML 解析错误。
  3) Python 的 f-string 表达式里不能出现反斜杠，所以正则先算好再插值。
  4) Token 只写占位符，占位符文本用拼接生成（避免被安全屏蔽器当成密钥打码）。
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "configs"
OUT.mkdir(exist_ok=True)

REPO = "https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/dist"
REPO_ALT = "https://cdn.jsdelivr.net/gh/m20104600/zeekr-checkin@main/dist"
K = "ZEEKR_" + "TOKEN"
BEARER = "Bea" + "rer"
PH = "<把这里换成你的" + BEARER + " Token>"

# 抓 Token 的目标：App 必定会发的接口（与常见极氪脚本一致）
EP = r"zeekrlife-app-user/v\d/user/info/query"

# ── 各客户端要用的正则（都只写一层反斜杠）──
RE_QX = r"^https:\/\/api-gw-toc\.zeekrlife\.com\/" + EP + r"$"
RE_QX_BROAD = r"^https:\/\/api-gw-toc\.zeekrlife\.com\/"
RE_LOON = r"/^https:\/\/api-gw-toc\.zeekrlife\.com\/" + EP + r"/"
RE_LOON_BROAD = r"/^https:\/\/api-gw-toc\.zeekrlife\.com\//"
RE_STASH = r"^https://api-gw-toc\.zeekrlife\.com/" + EP
RE_STASH_BROAD = r"^https://api-gw-toc\.zeekrlife\.com/"
RE_STASH_NARROW_FULL = RE_STASH + r"$"

HEADER = f"""# ══════════════════════════════════════════════════════════════════════
# 极氪签到 · {{client}}
# 脚本地址：{REPO}/zeekr.js   （Egern 用 zeekr.egern.js）
# 国内更快的镜像：{REPO_ALT}
#
# 两种拿 Token 的方式（任选）：
#   A. 自动抓（推荐）：配好下面的抓取规则，开启 MITM（信任 CA）后打开极氪 App 点一下，
#      Token 自动存进客户端（键名 zeekr_val），并弹一条通知（通知里带完整 Token，
#      青龙那种抓不了的平台复制过去即可）。定时任务不用填 Token。
#   B. 手动填：把参数里的 {PH} 换成真 Token。
#      ⚠️ 千万别把 Token 写进公开托管的脚本文件里（本仓库里只有占位符）。
#
# 场次安排（与服务器版 systemd 三场一致；默认「快跑 + 10 分钟后补领」）：
#   00:01 全流程    00:10 只领取（补延迟入账的碎片/能量球）
#   08:10 全流程    08:20 只领取
#   21:30 全流程    21:40 只领取
# 客户端超时能放宽的话，也可以只留 3 条 + POLL=1（脚本自己轮询到领完，约 3~5 分钟）。
# ══════════════════════════════════════════════════════════════════════
"""

# ───────────────────────────── Quantumult X ─────────────────────────────
qx = HEADER.format(client="Quantumult X") + f"""
[mitm]
hostname = api-gw-toc.zeekrlife.com

[rewrite_local]
# 自动抓 Token：默认匹配整个 api-gw-toc 域名（App 任何一条请求都会带上 Authorization）
{RE_QX_BROAD} url script-request-header {REPO}/zeekr.js
# 只想匹配「用户信息」那个接口（开销更小，但新版 App 不一定发这个请求）：
# {RE_QX} url script-request-header {REPO}/zeekr.js
# 若请求阶段不触发，用参考脚本（wf021325/qx）的「响应阶段」写法兜底（整域名）：
# {RE_QX_BROAD} url script-response-body {REPO}/zeekr.js
# 排查用：在 URL 的 # 后面加上 CAPDEBUG=1，就会为每条命中的请求弹一条通知（看规则到底有没有生效）
# {RE_QX_BROAD} url script-request-header {REPO}/zeekr.js#CAPDEBUG=1

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
# * QX 的 cron 是 5 段「分 时 日 月 周」，按设备本地时间（北京时间为准）。
# * QX 脚本执行上限约 30 秒且不可调，所以用「快跑 + 补领」，不要用 POLL=1。
# * 配上抓取规则后，上面每条 cron 的 {K}= 参数可以整段删掉（用抓到的 Token）。
# * 抓取规则只在「打开极氪 App」时生效；平时可以关掉 MITM，不影响定时任务。
"""

# ─────────────────────────────── Loon ───────────────────────────────
loon_plugin = f"""#!name = 极氪签到
#!desc = 极氪 App 每日自动签到：签到 / 上报步数 / 阅读文章 / 每周点赞 / 领取碎片·能量球·极值
#!author = m20104600
#!homepage = https://github.com/m20104600/zeekr-checkin
#!system = iOS,iPadOS,macOS
#!tag = 签到,工具
#!type = normal

""" + HEADER.format(client="Loon 插件 —— 添加方式：Loon → 配置 → 插件 → + → 粘贴本文件 URL") + f"""

[Argument]
TOKEN = input,"",tag=极氪 Token,desc=可留空：开着 MITM 打开一次极氪 App 就会自动抓取
TAG = input,"凌晨场",tag=场次标签,desc=只用于通知标题

[Script]
# ① 自动抓 Token（打开极氪 App 时触发，抓到就存进 Loon；通知里会带完整 Token）
#    默认匹配整个 api-gw-toc 域名，最稳；只想匹配「用户信息」接口就把下面那行换成窄版
http-request if ${{url}} ~= {RE_LOON_BROAD} then script("{REPO}/zeekr.js") with tag="极氪抓Token", timeout=20
# 窄版（开销更小；新版 App 不一定发这个请求）：
# http-request if ${{url}} ~= {RE_LOON} then script("{REPO}/zeekr.js") with tag="极氪抓Token", timeout=20
# 若请求阶段不触发，用「响应阶段」兜底（参考脚本 wf021325/qx 用的就是响应阶段；整域名）
# http-response if ${{url}} ~= {RE_LOON_BROAD} then script("{REPO}/zeekr.js") with tag="极氪抓Token(响应阶段兜底)", timeout=20
# 调试：临时把抓取那行换成这行（每条命中的请求都会弹通知，证明规则生效了）
# http-request if ${{url}} ~= {RE_LOON_BROAD} then script("{REPO}/zeekr.js", "CAPDEBUG=1") with tag="极氪抓Token(调试)", timeout=20

# ② 三场定时（快跑，单次约 10~25 秒）+ 每场 10 分钟后的「只领取」补领
cron "1 0 * * *" then script("{REPO}/zeekr.js", {{${{TOKEN}}, ${{TAG}}}}) with tag="极氪签到·凌晨场", timeout=60
cron "10 0 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=凌晨场·补领") with tag="极氪签到·凌晨补领", timeout=60
cron "10 8 * * *" then script("{REPO}/zeekr.js", "MODE=all&ZEEKR_TAG=早间场") with tag="极氪签到·早间场", timeout=60
cron "20 8 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=早间场·补领") with tag="极氪签到·早间补领", timeout=60
cron "30 21 * * *" then script("{REPO}/zeekr.js", "MODE=all&ZEEKR_TAG=晚间场") with tag="极氪签到·晚间场", timeout=60
cron "40 21 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=晚间场·补领") with tag="极氪签到·晚间补领", timeout=60

# 说明：
# * 本文件是 Loon **插件**：开头的 #!name / #!desc 等元数据头必须有，
#   少了这些 Loon 会「加载不出来」（这就是之前失败的原因）。
# * cron 支持 5 段「分 时 日 月 周」或 6 段「秒 分 时 日 月 周」。
# * 想改成一次跑完（POLL=1，约 3~5 分钟）就把 timeout 提到 600。
# * TOKEN 参数留空时会用「自动抓取」存下来的 Token；想手填就填 Bearer 开头的整串。

# ③ 手动自检：Loon → 脚本 → 选中「极氪Token自检」手动运行一次；
#    能跑到「🏁 本次领取」说明抓存的 Token 有效（读不到会明确提示缺少 Token）
generic then script("{REPO}/zeekr.js", "MODE=claim&TAG=自检") with tag="极氪Token自检", timeout=120

[Mitm]
hostname = api-gw-toc.zeekrlife.com
"""

loon_snippet = HEADER.format(client="Loon 配置片段（想合并进自己的 .conf 时用；手机上装插件请用 loon.plugin）") + f"""
[Script]
# 自动抓 Token（默认整域名；调试时加 "CAPDEBUG=1" 参数会为每条命中请求弹通知）
http-request if ${{url}} ~= {RE_LOON_BROAD} then script("{REPO}/zeekr.js") with tag="极氪抓Token", timeout=20
# 三场 + 补领（argument 直接写字面串）
cron "1 0 * * *" then script("{REPO}/zeekr.js", "{K}={PH}&TAG=凌晨场") with tag="极氪签到·凌晨场", timeout=60
cron "10 0 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=凌晨场·补领") with tag="极氪签到·凌晨补领", timeout=60
cron "10 8 * * *" then script("{REPO}/zeekr.js", "{K}={PH}&TAG=早间场") with tag="极氪签到·早间场", timeout=60
cron "20 8 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=早间场·补领") with tag="极氪签到·早间补领", timeout=60
cron "30 21 * * *" then script("{REPO}/zeekr.js", "{K}={PH}&TAG=晚间场") with tag="极氪签到·晚间场", timeout=60
cron "40 21 * * *" then script("{REPO}/zeekr.js", "MODE=claim&TAG=晚间场·补领") with tag="极氪签到·晚间补领", timeout=60

[Mitm]
hostname = api-gw-toc.zeekrlife.com
"""

# ─────────────────────────────── Stash ───────────────────────────────
stash = HEADER.format(client="Stash（存成 xxx.stoverride 当覆写用，或把各段并进配置）") + f"""
# 正则用单引号包起来：YAML 单引号内反斜杠不转义
http:
  # 开启 MITM 的域名（记得先装好 CA 证书）
  mitm:
    - api-gw-toc.zeekrlife.com
  # 自动抓 Token（type: request：只读请求头，不改请求）
  script:
    - name: zeekr
      match: '{RE_STASH_BROAD}'
      type: request
      timeout: 10
    # 窄版（开销更小；新版 App 不一定发这个请求）：match: '{RE_STASH}'
    # 若上面不触发，换成响应阶段兜底（type: response）
    # - name: zeekr
    #   match: '{RE_STASH_BROAD}'
    #   type: response
    #   timeout: 10
    # 调试：临时改成下面这样，每条命中的请求都会弹通知
    # - name: zeekr
    #   match: '{RE_STASH_BROAD}'
    #   type: request
    #   timeout: 10
    #   argument: '{{"ZEEKR_CAPDEBUG":"1"}}'

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
# * cron 里的 name 必须与 script-providers 的键（zeekr）一致。
# * argument 是 JSON 字符串；"ZEEKR_MODE=claim&ZEEKR_TAG=补领" 这种查询串也认。
# * 定时任务需要 Stash 的 Network Extension（VPN）处于已连接状态。
# * 想一次跑完：argument 里加 "ZEEKR_POLL":"1" 并把 timeout 提到 420。
"""

# ─────────────────────────────── Egern ───────────────────────────────
egern = f"""# ══════════════════════════════════════════════════════════════════════
# 极氪签到 · Egern **模块** 
#
# 添加方式（推荐模块方式，别直接整段贴到别处）：
#   Egern → 模块 → 右上角 + → URL 填：
#     {REPO.replace('/dist', '')}/configs/egern.yaml
#   或把下面的 mitm / scriptings 两段复制进你的 Profile.yaml。
#
# 注意：Egern 的模块文件需要 name/description 这类元数据；YAML 里正则必须用
# **单引号**（双引号里 \\d 是非法转义，会直接报「发生错误」——之前就是这个报错）。
#
# Token：默认走「打开极氪 App 自动抓取」（第一个 http_request 规则，需开 MITM）；
#        抓到的 Token 存在客户端持久化存储（键 zeekr_val），定时任务自动读。
#        模块设置页里**刻意没有 Token 栏** —— Egern 不许脚本回写设置页，抓到的东西
#        进不了那个输入框，放一个填不进去的框只会让人误会（2026-09-20 用户要求删掉）。
#        真要手填 Token，在 Profile 的模块引用处给该模块加一条 env（ZEEKR_TOKEN = "Bearer eyJ..."）。
#
# 抓取开关：模块设置里的「抓取 Token」——
#        开（默认）= 打开极氪 App 就抓取并存起来，Token 变了立刻弹一条通知，
#                   没变则 10 分钟内最多弹一条（等于每次开 App 有一条确认）；
#        关 = 完全不抓取、不写存储、不弹任何通知（含「抓取调试」）。
#        改完开关把 Egern 的 VPN 开关断开重连一次，让模块参数重新加载。
#
# 要拿 Token 去别处用（比如青龙）：**点一下抓取通知即可复制到剪贴板**（不用去设置页找）。
#
# 场次：00:01 全流程 → 00:10 只领取；08:10 → 08:20；21:30 → 21:40。
# 想一次跑完（约 3~5 分钟）就在 env 里加 ZEEKR_POLL: "1" 并把 timeout 提到 600。
# ══════════════════════════════════════════════════════════════════════
name: "极氪签到"
description: "极氪 App 每日自动签到 / 步数 / 阅读文章 / 每周点赞 / 领取碎片·能量球·极值"
author: "m20104600"
homepage: "https://github.com/m20104600/zeekr-checkin"
icon: "car.fill"

env_schema:
  ZEEKR_CAPTURE:
    name: "抓取 Token"
    description: "开 = 打开极氪 App 就抓取 Token 并存进持久化存储（抓到会弹一条通知）；关 = 不抓取、不写存储、不弹任何通知"
    options: ["true", "false"]
    default_value: "true"
  ZEEKR_CAPDEBUG:
    name: "抓取调试"
    description: "打开后，每条命中的抓取请求都会弹通知（列出命中的 URL 和实际收到的头名），排查完记得关掉"
    options: ["false", "true"]

# 需要 MITM 才能抓到 HTTPS 请求里的 Token（启用模块后会合并进主配置）
mitm:
  hostnames:
    - "api-gw-toc.zeekrlife.com"

scriptings:
  # ① 自动抓 Token（HTTP 请求脚本）
  - http_request:
      name: "极氪抓Token"
      # 默认匹配整个 api-gw-toc 域名（App 任何一条请求都会带 Authorization，最稳）
      match: '{RE_STASH_BROAD}'
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 20
      # 窄版（开销更小；新版 App 不一定发这个请求）：'{RE_STASH}'

  # ①b 兜底：万一请求阶段不触发，用响应阶段再抓一次（参考脚本 wf021325/qx 用的就是响应阶段；
  #      只匹配「用户信息」接口，开销很小；同一个 Token 不会重复通知）
  - http_response:
      name: "极氪抓Token(响应阶段兜底)"
      match: '{RE_STASH_BROAD}'
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 20

  # 手动自检：在 Egern「脚本」里点一下就跑 —— 能跑到「本次领取」说明抓存的 Token 有效
  - generic:
      name: "极氪Token自检（手动跑一次）"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
        ZEEKR_MODE: "claim"
        ZEEKR_TAG: "自检"

  # ② 三场定时 + 每场 10 分钟后的补领
  - schedule:
      name: "极氪签到·凌晨场"
      cron: "1 0 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
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
  - schedule:
      name: "极氪签到·早间场"
      cron: "10 8 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
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
  - schedule:
      name: "极氪签到·晚间场"
      cron: "30 21 * * *"
      script_url: "{REPO}/zeekr.egern.js"
      timeout: 120
      env:
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
"""

# ─────────────────────────────── 青龙 ───────────────────────────────
ql = HEADER.format(client="青龙 / 任意 Node.js") + f"""
# 零、怎么拿 Token（青龙没有 MITM，抓不了 —— 用手机抓完复制过来）
#   1) 手机上装 QX / Loon / Stash / Egern 任一个，按 configs/ 里对应文件配好「抓取规则」，
#      开启 MITM（HTTPS 解密）并信任 CA 证书；
#   2) 打开极氪 App 随便点一下（进「我的」即可）；
#   3) 手机会弹通知「✅ 极氪 Token 已自动保存」，正文最后有一整行 {BEARER} eyJ...；
#   4) 长按复制那一行 -> 粘贴到青龙环境变量 {K}（或把整段 JSON 粘到 zeekr_val）；
#   5) 平时可以关掉 MITM。Token 大约半年有效，过期后再抓一次即可。
#   （也可以自己抓包：过滤域名 api-gw-toc.zeekrlife.com，复制请求头 Authorization 的值。）
#
# 一、放脚本
#   方式 A：青龙「脚本管理」→ 新建脚本，粘贴 dist/zeekr.qinglong.js 的内容；
#   方式 B：把 zeekr.qinglong.js 放进 /ql/scripts/；
#   方式 C：青龙「订阅管理」→ 新建订阅，链接指向存放该文件的仓库，
#           白名单填 zeekr.qinglong.js（定时任务里的脚本名要对应）。

# 二、环境变量（青龙「环境变量」页新增）
{K} = {PH}          # 必填；多账号用换行分隔，或用 {K}_1 / {K}_2 ...
ZEEKR_MODE   = all            # all(默认) | sign | claim（补领任务用 claim）
#   兼容写法：不配 {K} 而配 zeekr_val / ZEEKR_VAL
#   （值是含 authorization 字段的 JSON，与手机端抓出来的格式一致），脚本会自动认。
ZEEKR_TAG    = 凌晨场          # 只影响通知标题
ZEEKR_STEPS  = 10000          # 或 off 跳过步数上报
ZEEKR_APPVER = 4.9.33         # 可选，跳过 iTunes 版本查询
ZEEKR_POLL   = 0              # 1 = 脚本内轮询到领完（任务超时要 ≥ 420 秒）
ZEEKR_NOTIFY = 1              # 0 关闭通知
# 通知：默认走青龙自带 sendNotify.js（在「通知设置」里配好渠道）；
#       找不到时可用 ZEEKR_TG_BOT_TOKEN + ZEEKR_TG_CHAT_ID 走 Telegram。

# 三、定时任务（「定时任务」页新建，命令都是 task zeekr.qinglong.js）
#   任务名               定时规则      说明
#   极氪签到·凌晨场       1 0 * * *     全流程
#   极氪签到·凌晨补领     10 0 * * *    只领取（补延迟入账的奖励）
#   极氪签到·早间场       10 8 * * *
#   极氪签到·早间补领     20 8 * * *
#   极氪签到·晚间场       30 21 * * *
#   极氪签到·晚间补领     40 21 * * *
#   MODE 用「任务级环境变量」覆盖（青龙支持在定时任务编辑页给单条任务加环境变量）；
#   懒人做法：只建 3 条「全流程」+ ZEEKR_POLL=1 + 任务超时 600 秒，一次跑完。
"""

FILES = {
    "qx.conf": qx,
    "loon.plugin": loon_plugin,
    "loon-snippet.conf": loon_snippet,
    "stash.yaml": stash,
    "egern.yaml": egern,
    "qinglong.md": ql,
}

if __name__ == "__main__":
    for name, text in FILES.items():
        p = OUT / name
        p.write_text(text, encoding="utf-8")
        bad = text.count("\\\\/") + text.count("\\\\.")
        print(
            f"写入 {p} ({len(text)} 字节) 占位符 {text.count(PH)} 处"
            + (f"  ⚠️ 双反斜杠残留 {bad} 处" if bad else "")
        )
