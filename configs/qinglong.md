# ══════════════════════════════════════════════════════════════════════
# 极氪签到 · 青龙 / 任意 Node.js 配置片段
# 脚本地址：<你的脚本地址前缀>/zeekr.js（Egern 用 zeekr.egern.js）
#
# 两种用法（任选）：
#   A. 手机抓 Token（推荐）：青龙没有 MITM 抓不了，用手机 QX/Loon/Stash/Egern 抓一次，
#      存储键名 zeekr_val，值是含 authorization 字段的 JSON —— 与常见极氪脚本互通；
#      青龙那边也可以直接把这份 JSON 塞进环境变量 zeekr_val / ZEEKR_VAL。
#      然后把 Token 复制过来（见下面「零、怎么拿 Token」），定时任务不用填。
#   B. 手动填 Token：把每条 cron 参数里的 <把这里换成你的Bearer Token> 替换成真 Token。
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

# 零、怎么拿 Token（青龙没有 MITM，抓不了 —— 用手机抓完复制过来）
#   1) 手机上装 QX / Loon / Stash / Egern 任一个，按 configs/ 里对应片段配好「抓取规则」，
#      开启 MITM（HTTPS 解密）并信任 CA 证书；
#   2) 打开极氪 App 随便点一下（进「我的」即可）；
#   3) 手机会弹通知「✅ 极氪 Token 已自动保存」，正文最后有一整行 Bearer eyJ...；
#   4) 长按复制那一行 -> 粘贴到青龙环境变量 ZEEKR_TOKEN（或把整段 JSON 粘到 zeekr_val）；
#   5) 平时可以关掉 MITM。Token 大约半年有效，过期后再抓一次即可。
#   （想自己抓包也行：过滤域名 api-gw-toc.zeekrlife.com，复制请求头 Authorization 的值。）
#
# 一、放脚本
#   方式 A：青龙「脚本管理」→ 新建脚本，粘贴 dist/zeekr.qinglong.js 的内容；
#   方式 B：把 zeekr.qinglong.js 放进 /ql/scripts/；
#   方式 C：青龙「订阅管理」→ 新建订阅，链接指向存放该文件的仓库，
#           白名单填 zeekr.qinglong.js（定时任务里脚本名要对应）。

# 二、环境变量（青龙「环境变量」页新增）
ZEEKR_TOKEN = <把这里换成你的Bearer Token>          # 必填；多账号用换行分隔，或用 ZEEKR_TOKEN_1 / ZEEKR_TOKEN_2 ...
ZEEKR_MODE   = all            # all(默认) | sign | claim（补领任务用 claim）
#   兼容写法：不配 ZEEKR_TOKEN 而配 zeekr_val / ZEEKR_VAL（值是含 authorization 字段的 JSON，
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
