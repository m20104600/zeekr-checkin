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
#   （也可以自己抓包：过滤域名 api-gw-toc.zeekrlife.com，复制请求头 Authorization 的值。
#    注意要 Authorization 以 Bearer 开头、Token 里带 accountLoginInfoDTO 的那条；
#    gric-z-api.geely.com 上那个 7 天有效的 Token 不能用。）
#   抓完记得到 iOS「证书信任设置」里关掉抓包证书的信任。
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
ZEEKR_STEPS  = 10000-20000    # 范围内随机；固定整数或 off 也支持
ZEEKR_APPVER = 5.0.7          # 可选；手机开了 App 自动更新就别填（查 App Store 最新版，跟手机一致）
ZEEKR_POLL   = 0              # 1 = 脚本内轮询到领完（任务超时要 ≥ 420 秒）
ZEEKR_NOTIFY = 1              # 0 关闭通知
# 降低风控（v2.4.0）：
ZEEKR_DELAY    = 1800         # 随机延迟启动：0~1800 秒（也可写 300-1800）；不受青龙整点/半点不延迟的限制
ZEEKR_READWAIT = 8-20         # 读文章后停留秒数（青龙版默认就是 8-20；off 关闭）
#   以下从真机抓包复制（v2.5.0），让请求与真机一致：
ZEEKR_DEVICE_ID   = <签到页请求里的 20 位数字 device_id>     # Origin 为 activity-h5.zeekrlife.com 的请求；不填按账号派生
ZEEKR_APP_SECRET  = <原生请求头 x_ca_secret 的值>           # 配了才用 App 原生身份读文章/点赞
ZEEKR_PHONE_MODEL = iPhone17,1                             # 原生请求头 phone_model
ZEEKR_IOS_VERSION = 26.0                                   # 原生请求头 phone_version（手机升级系统后改）
#   ZEEKR_UA 一般不用填：真机签到页 UA 与内置一致
#   Token 失效（被顶号/过期）时脚本会立刻停止后续请求，通知标题写「Token 失效」
# 通知：默认走青龙自带 sendNotify.js（在「通知设置」里配好渠道）；
#       找不到时可用 ZEEKR_TG_BOT_TOKEN + ZEEKR_TG_CHAT_ID 走 Telegram。
# 部署在国内 IP 的服务器上：海外机房 IP 与手机所在地差异太大，是最容易被风控盯上的信号。

# 三、定时任务（「定时任务」页新建，命令都是 task zeekr.qinglong.js）
#   推荐：一天两条、放晚上（比三场更像真人；分钟别选 0 / 30）
#   任务名               定时规则      任务级环境变量
#   极氪签到·全流程       47 20 * * *   ZEEKR_DELAY=1800
#   极氪签到·补领         13 22 * * *   ZEEKR_MODE=claim  ZEEKR_DELAY=600
#   放晚上：要上报 1~2 万步，早上 8 点就走了一两万步不合常理。
#   补领要晚于全流程的最大延迟（这里 20:47+30 分 < 22:13），奖励 1~3 分钟后入账，补领能收干净。
#   MODE 用「任务级环境变量」覆盖（青龙支持在定时任务编辑页给单条任务加环境变量）。
