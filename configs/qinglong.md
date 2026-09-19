# ══════════════════════════════════════════════════════════════════════
# 极氪签到 · 青龙 / 任意 Node.js
# 脚本地址：https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/dist/zeekr.js   （Egern 用 zeekr.egern.js）
# 国内更快的镜像：https://cdn.jsdelivr.net/gh/m20104600/zeekr-checkin@main/dist
#
# 两种拿 Token 的方式（任选）：
#   A. 自动抓（推荐）：配好下面的抓取规则，开启 MITM（信任 CA）后打开极氪 App 点一下，
#      Token 自动存进客户端（键名 zeekr_val），并弹一条通知（通知里带完整 Token，
#      青龙那种抓不了的平台复制过去即可）。定时任务不用填 Token。
#   B. 手动填：把参数里的 <把这里换成你的Bearer Token> 换成真 Token。
#      ⚠️ 千万别把 Token 写进公开托管的脚本文件里（本仓库里只有占位符）。
#
# 场次安排（与服务器版 systemd 三场一致；默认「快跑 + 10 分钟后补领」）：
#   00:01 全流程    00:10 只领取（补延迟入账的碎片/能量球）
#   08:10 全流程    08:20 只领取
#   21:30 全流程    21:40 只领取
# 客户端超时能放宽的话，也可以只留 3 条 + POLL=1（脚本自己轮询到领完，约 3~5 分钟）。
# ══════════════════════════════════════════════════════════════════════

# 零、怎么拿 Token（青龙没有 MITM，抓不了 —— 用手机抓完复制过来）
#   1) 手机上装 QX / Loon / Stash / Egern 任一个，按 configs/ 里对应文件配好「抓取规则」，
#      开启 MITM（HTTPS 解密）并信任 CA 证书；
#   2) 打开极氪 App 随便点一下（进「我的」即可）；
#   3) 手机会弹通知「✅ 极氪 Token 已自动保存」，正文最后有一整行 Bearer eyJ...；
#   4) 长按复制那一行 -> 粘贴到青龙环境变量 ZEEKR_TOKEN（或把整段 JSON 粘到 zeekr_val）；
#   5) 平时可以关掉 MITM。Token 大约半年有效，过期后再抓一次即可。
#   （也可以自己抓包：过滤域名 api-gw-toc.zeekrlife.com，复制请求头 Authorization 的值。）
#
# 一、放脚本
#   方式 A：青龙「脚本管理」→ 新建脚本，粘贴 dist/zeekr.qinglong.js 的内容；
#   方式 B：把 zeekr.qinglong.js 放进 /ql/scripts/；
#   方式 C：青龙「订阅管理」→ 新建订阅，链接指向存放该文件的仓库，
#           白名单填 zeekr.qinglong.js（定时任务里的脚本名要对应）。

# 二、环境变量（青龙「环境变量」页新增）
ZEEKR_TOKEN = <把这里换成你的Bearer Token>          # 必填；多账号用换行分隔，或用 ZEEKR_TOKEN_1 / ZEEKR_TOKEN_2 ...
ZEEKR_MODE   = all            # all(默认) | sign | claim（补领任务用 claim）
#   兼容写法：不配 ZEEKR_TOKEN 而配 zeekr_val / ZEEKR_VAL
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
