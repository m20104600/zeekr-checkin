# 极氪 App 自动签到 · 多客户端脚本

每天自动完成极氪 App 的 **签到 → 上报步数 → 做任务（阅读文章 / 每周点赞）→ 领取奖励（碎片 / 能量球 / 极值）**。

一套逻辑，五个平台可用：**Quantumult X / Loon / Stash / Egern / 青龙**（同一份 `zeekr.js` 在 Surge、Node.js 上也能跑）。
跑在手机上（代理客户端）或服务器上（青龙），**不需要手机常开**。

| 客户端 | 用哪个脚本 | 原始地址（raw） |
|---|---|---|
| Quantumult X / Loon / Stash / Surge / Node | `zeekr.js` | `https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/dist/zeekr.js` |
| Egern | `zeekr.egern.js` | `https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/dist/zeekr.egern.js` |
| 青龙 / 任意 Node.js ≥ 14 | `zeekr.qinglong.js` | `https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/dist/zeekr.qinglong.js` |

> 国内访问 raw 慢/不稳的话，可换 jsDelivr 镜像：
> `https://cdn.jsdelivr.net/gh/m20104600/zeekr-checkin@main/dist/zeekr.js`
> 或者把文件下载后放自己的服务器/对象存储（客户端也支持本地文件）。

---

## v3.3.0 更新

已将实验仓库的已验证改动合回本项目。维护者已反馈 **青龙、Egern 使用成功**；其他客户端仍需按各自环境核对。不要同时运行原仓库与实验仓库两套任务。

- **Issue #6**：只有 JWT `accountLoginInfoDTO.platform` 精确等于 `WEB_PC` 时设置请求头 `platform: WEB_PC`；App IOS/ANDROID、缺省及其他值保持原空值。平台与运行脚本的客户端类型是两回事。
- 保留网页设备 ID 字符串 `"0"`、完整长账号 ID；显式设备参数优先于抓取存储；同 Token 的新设备头也更新，不额外刷屏。
- **手机登录取 Token**：直接填写手机号、图形验证码和短信验证码，点击登录后复制 Token，无需电脑 F12 或操作远程浏览器。通过手机操作网页获得的仍是 **WEB_PC Token**，不是 App Token。
- **PR #5 修后整合**：H5/原生请求头分层、可选辅助链失败降级、鉴权失败立即退出，不再继续等待或误报领净；保护原生响应中的长数字 ID。
- 原生额外请求链、每日固定步数、阅读等待和启动延迟全部可选。默认保持**每轮随机 10000–20000 步**。
- **Issue #7**：青龙推送在完整账号 ID 后加昵称，支持多账号独立昵称。
- 保留 #2 Loon 新语法、请求超时毫秒修复及手机六场定时。

JWT 解码不等于签名验证；声明的到期时间不保证服务器不会提前撤销。`000009` 表示鉴权失败，也可能是平台不匹配，不统一称为过期。接口成功不代表步行奖励已经生成。


## 特性

- **零依赖纯 JS**：SHA1 签名、base64（步数 secret 要套 6 层，与解码后的手机请求字段一致）都是手写实现，
  QX/Loon/Stash 这类没有 `crypto` / `Buffer` 的运行环境照样跑。
- **签到 + 步数 + 任务 + 领取**全套：阅读文章、每周点赞（自动判断本周是否已完成、
  只在需要时点一次）、能量球 / 极值 / 碎片领取。
- **处理「奖励延迟入账」**：极氪的碎片/能量球是任务做完后 **1~3 分钟**才到账的。
  默认「快跑 + 补领」：主任务跑完只领一轮，10 分钟后再跑一条只领取的任务收尾；
  客户端超时够宽的话也可以开 `POLL=1` 让脚本自己轮询到领光。
- **手机端自动抓 Token**：配一条抓取规则 + 开 MITM，打开极氪 App 点一下，
  Token 自动存进客户端（键名 `zeekr_val`），之后定时任务不用填 Token。
  抓取成功的通知里会附上**完整 Token 文本**，方便复制到青龙那种抓不了的平台。
- **Token 清洗**：带单/双引号、前后空格、零宽字符、只粘裸 JWT（自动补 `Bearer `）都能用。
- **通知只给结论**：不刷屏（`VERBOSE=1` 才输出逐轮明细）。
- **青龙多账号**：`ZEEKR_TOKEN` 里换行分隔多个 Token，或 `ZEEKR_TOKEN_1/2/...`。

---

## 快速开始

### 1. 配客户端

配置文件片段都在 [`configs/`](configs/) 里，照抄即可：

| 客户端 | 配置文件 | 安装方式 |
|---|---|---|
| Quantumult X | [`configs/qx.conf`](configs/qx.conf) | 把 `[mitm]` / `[rewrite_local]` / `[task_local]` 三段并进你的 QX 配置 |
| **Loon** | [`configs/loon.plugin`](configs/loon.plugin) | **Loon → 配置 → 插件 → 右上角 + → 粘贴上面的插件 URL**（必须是插件文件，首行要有 `#!name`，否则 Loon 加载不出来）。想并进自己的配置就用 [`configs/loon-snippet.conf`](configs/loon-snippet.conf) |
| Stash | [`configs/stash.yaml`](configs/stash.yaml) | 存成 `xxx.stoverride` 当覆写，或把 `http` / `cron` / `script-providers` 段并进配置 |
| **Egern** | [`configs/egern.yaml`](configs/egern.yaml) | **Egern → 模块 → 右上角 + → 粘贴上面的模块 URL**（是模块文件，带 `name`/`description` 元数据；不要整段贴到别处，YAML 里正则必须单引号） |
| 青龙 | [`configs/qinglong.md`](configs/qinglong.md) | 一个仓库订阅自动添加六条独立任务，详见下方青龙教程 |

**Loon 插件**（直接贴进 Loon 的插件页）：

```
https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/configs/loon.plugin
```

**Egern 模块**（直接贴进 Egern 的模块页）：

```
https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/configs/egern.yaml
```

**QX / Stash** 用 `configs/qx.conf`、`configs/stash.yaml` 里的内容（地址已经填好，直接复制）。

国内更快的镜像（jsDelivr，把 `raw.githubusercontent.com/m20104600/zeekr-checkin/main` 换成
`cdn.jsdelivr.net/gh/m20104600/zeekr-checkin@main` 即可）。

### 2. 拿 Token

**推荐：自行部署独立 [zeekr-token-web](https://github.com/m20104600/zeekr-token-web)**，访问自己的工具页面，填写手机号、图形验证码与短信验证码登录，然后复制完整 `Bearer ...`。本项目不提供公共在线取 Token 服务；验证码只在自己的工具页面填写，不发给机器人。

通过手机操作网页登录获得的仍是 **WEB_PC Token**，不是 App Token。脚本会按签发平台正确设置请求头；App Token 继续兼容。Token 的声明到期日不保证服务器始终接受，不要公开凭据。

- **Egern**：刷新/重新导入最新模块，在模块设置 →「手动 Token（可选）」粘贴一个完整网页或 App Token；有效手填值优先，留空/占位符则用抓取存储。修改后断开重连 VPN。仅手填网页 Token 可关闭抓取，不需要 MITM。设置页不会被脚本自动回写。
- **QX/Loon/Stash**：可手填 `ZEEKR_TOKEN`，也可继续开启 MITM、信任 CA 证书，并启用配置里的抓取规则；打开本人极氪 App 后自动保存 Token。
- **青龙**：在「环境变量」中保存 `ZEEKR_TOKEN`；多账号用 `ZEEKR_TOKEN_1`、`ZEEKR_TOKEN_2`。青龙不会从手机自动抓取，完整步骤见下面的订阅教程。

**手机脚本每次只执行首个账号**；手填网页 Token 优先于抓取的 App Token，不是新增第二个同时运行的账号。青龙支持多账号。不要在手机的同一个输入框粘贴多个 Token。

Egern「抓取 Token」开启时才抓取、存储和通知；关闭时连调试通知也关闭。抓取值保存在客户端存储，不会自动回填模块设置；点抓取通知可复制到青龙。改模块参数后断开重连 VPN。

### 3. 定时

推荐「三场 × 2 条」（与服务器版 systemd 三场一致，00:01 / 08:10 / 21:30 各一场，
10 分钟后再补一条只领取）：

```
00:01 全流程    00:10 只领取（补延迟入账的奖励）
08:10 全流程    08:20 只领取
21:30 全流程    21:40 只领取
```

超时能放宽的客户端（Loon 600s / Stash 420s / Egern 600s / 青龙 420s+）可以只用
3 条 cron + `POLL=1`，脚本自己轮询到领完（单次约 3~5 分钟）。
**QX 的脚本执行上限约 30 秒且不可配置，别用 `POLL=1`。**

---

## 青龙：一个仓库订阅，自动添加六条定时任务

新手请用 **「订阅管理」添加仓库**，不要把 JS 下载地址粘到「定时任务」的命令里。一次订阅会导入六个独立脚本，每条任务都能单独改时间、启用或禁用。完整步骤与排错见 [青龙详细说明](configs/qinglong.md)。

### 1. 准备 Token 和时区

- 青龙运行环境建议 **Node.js 18+**；六个脚本自包含，**不需要安装 npm 依赖**。
- 面板/容器时区设为 **`Asia/Shanghai`（UTC+8，北京时间）**。下方时间均按此时区；只改浏览器或电脑时区不等于改了青龙调度时区。
- 使用自己部署的 [zeekr-token-web](https://github.com/m20104600/zeekr-token-web) 获取 Token，或从本人极氪 App 抓取请求头 `Authorization`；本项目不提供公共取 Token 服务。
- 青龙 → **环境变量 → 新建变量**：名称填 `ZEEKR_TOKEN`，值填**自己的完整 Bearer Token**（包含 `Bearer ` 前缀），保存并启用。不要把 `ZEEKR_TOKEN=` 一起填进值，也不要添加引号。多账号可分别添加 `ZEEKR_TOKEN_1`、`ZEEKR_TOKEN_2`，每个值各放一个完整 Token；不要与无后缀变量重复配置同一账号。

### 2. 创建仓库订阅（只创建一次）

进入 **订阅管理 → 创建订阅**，逐项填写：

| 字段 | 填写内容 |
|---|---|
| 名称 | 极氪签到 |
| 类型 | 公开仓库 |
| 链接 | `https://github.com/m20104600/zeekr-checkin.git` |
| 分支 | `main` |
| 白名单 | `zeekr_.*\.js$` |
| 黑名单 | 留空 |
| 依赖文件 | 留空（六个入口均为自包含脚本） |
| 文件后缀（若显示） | `js` |
| 自动添加任务 | 开启 |
| 自动删除任务 | 建议关闭，避免误删 |
| 定时规则 | `23 4 * * *` |

白名单是**普通正则表达式**，直接填 `zeekr_.*\.js$`，不加引号，也不加 `/…/`。仓库链接只填仓库地址，不填某个 JS 的 raw 地址。

**这里的 `23 4 * * *` 仅表示每天 04:23 更新仓库脚本，不是签到时间。** 不要把六场签到时间合并填写到订阅的定时规则中。

### 3. 保存后，运行一次订阅

1. 保存订阅，在「订阅管理」对这条订阅点 **运行一次**（部分版本显示「运行」）。
2. 等待拉库和导入完成，查看订阅日志是否下载成功并添加任务。
3. 打开 **定时任务**，搜索 **极氪**，确认出现下表六条任务。

**运行订阅只负责下载/更新脚本、导入定时任务，不会直接执行签到或领取。** 任务导入并启用后，会按各自时间执行；需要立即验收时，由账号本人在「定时任务」手动运行一条主任务并查看日志，这会实际签到、做任务和领取。

### 4. 核对六条任务，按需修改时间

| 任务名称 | 默认时间（UTC+8） | 定时规则 | 独立脚本 |
|---|---|---|---|
| 极氪签到·凌晨场 | 00:01 | `1 0 * * *` | `qinglong/zeekr_0001_all.js` |
| 极氪签到·凌晨补领 | 00:10 | `10 0 * * *` | `qinglong/zeekr_0010_claim.js` |
| 极氪签到·早间场 | 08:10 | `10 8 * * *` | `qinglong/zeekr_0810_all.js` |
| 极氪签到·早间补领 | 08:20 | `20 8 * * *` | `qinglong/zeekr_0820_claim.js` |
| 极氪签到·晚间场 | 21:30 | `30 21 * * *` | `qinglong/zeekr_2130_all.js` |
| 极氪签到·晚间补领 | 21:40 | `40 21 * * *` | `qinglong/zeekr_2140_claim.js` |

三条主任务固定为 `all`（完整流程），三条补领固定为 `claim`（仅领取）。场次标签分别固定为凌晨场/早间场/晚间场，补领标签带「·补领」；**无需设置全局 `MODE` / `TAG`**，也不要用它们切换这六条任务。

在「定时任务」找到某一条 → **编辑 → 定时规则 → 保存**，即可单独调整；例如将早间主任务改为 08:30，填 `30 8 * * *`，再独立调整早间补领的时间。任务命令由青龙自动生成，为 `task` 加本地脚本路径；**保留生成的路径，不要照抄别人的目录前缀，也不要替换成网页 URL**。

同一订阅、同一脚本路径下重新拉取，应保留在面板修改的定时和禁用状态；不要为了更新而删除重建订阅或改入口文件名。版本兼容与排错见详细说明，不代表所有面板版本或你的实际面板都已验收。

### 5. 从旧方案迁移与常见问题

- **防重复**：启用新六条前，先禁用旧的极氪手动任务及旧订阅，避免新旧任务同时运行。保留现有环境变量凭据，不要为迁移删除 Token。不要重复创建本仓库订阅。
- **没有六条任务**：先看订阅日志是否拉取成功；核对白名单、`main` 分支和「自动添加任务」开关，然后重新运行原订阅。若曾删过自动任务，检查面板是否记录了忽略/禁止再次添加，再按对应版本设置恢复。
- **任务重复**：按命令里的本地路径排查旧手动任务、重复订阅和旧通用脚本，禁用多余项；不要仅凭任务显示名批量删除。
- **缺 Token / 登录失败**：检查环境变量名称、启用状态、完整 `Bearer ` 前缀与是否粘贴了占位符；鉴权失败也可能是平台不匹配或被撤销，必要时重新获取自己的 Token。
- **补领却在签到 / 场次不对**：确认命令指向对应的 `_claim.js` 或 `_all.js`，不是旧通用入口；新入口模式与标签固定，无需全局 `MODE` / `TAG`。
- **下载失败 / 网络错误**：订阅下载失败查青龙服务器到 GitHub 的网络；任务请求失败查服务器到极氪接口的网络，二者不是同一问题。先保留脱敏日志，不要把 Token 发到公开 Issue。
- **把 URL 当命令导致报错**：返回「订阅管理」按上述步骤导入，使用青龙生成的本地 `task` 命令，不要在命令框粘贴下载链接。

旧的 `dist/zeekr.qinglong.js` 通用入口仍可用于原有手动任务，但**不要加入本订阅白名单**；它不是自动六任务入口，不要与新六条同时启用。

## 青龙昵称

凭据支持 `ZEEKR_TOKEN` 换行分隔，或 `ZEEKR_TOKEN_1/2/...`；兼容 `ZEEKR_VAL` JSON。

昵称优先级：`ZEEKR_NICKNAME_n` → `ZEEKR_NICKNAMES` JSON 数组条目（例如 `["主账号","家人"]`）→ JWT `accountInfoDTO.nickname` → `userName`。没有昵称就只显示 ID。

带后缀的凭据按原后缀匹配昵称；未带后缀的一组按运行顺序匹配。通知形如 `【账号 1/2 · 完整账号ID 主账号】`；昵称过滤换行和控制字符，最多 40 字符。


## 参数

写在客户端的 argument / `#` 参数 / env 里，或者本地脚本顶部的 `ZEEKR_DEFAULT_CONFIG`。
**前缀 `ZEEKR_` 可有可无，大小写不敏感**（`TOKEN`、`zeeKr_token`、`ZEEKR_TOKEN` 都认）。

| 参数 | 默认 | 说明 |
|---|---|---|
| `TOKEN` | — | Bearer Token；不填则用抓取存的（青龙必须填/复制，可使用网页 Token）。**Egern 有效手填值优先，留空则用抓取存储** |
| `MODE` | `all` | `all`=签到+步数+任务+领取；`sign`=只签到做任务；`claim`=只领取 |
| `TAG` | — | 场次标签，只影响通知标题，如 `凌晨场` |
| `STEPS` | 随机 10000~20000 | 可填 `10000-20000` 范围、固定整数；`off` 跳过。同次运行补报沿用首次抽样。旧固定配置需改为范围或留空。 |
| `POLL` | `0` | `1` = 领取阶段长时间复查轮询（客户端 timeout 需 ≥ 420s） |
| `WAITS` | `45,60,75` | `POLL=1` 时的复查间隔（秒） |
| `SETTLE` | `180` | 距最后一次成功领取至少观察多少秒（`POLL=1`） |
| `MAX` | `600` | 领取阶段总上限（秒，`POLL=1`） |
| `APPVER` | 查 iTunes | 指定 App 版本号，跳过 iTunes 查询 |
| `LIKE` | `0` | `1` = 强制点一次赞（排查用） |
| `NOTIFY` | `1` | `0` = 不发通知 |
| `CAPSHOW` | `1` | 抓到 Token 时通知里显示完整 Token（复制到青龙用）；`0` 只显示账号/有效期 |
| `VERBOSE` | `0` | `1` = 输出逐轮明细 |

示例：

```
QX   : script-path=.../zeekr.js#TOKEN=Bearer eyJ...&TAG=凌晨场
Loon : argument="TOKEN=Bearer eyJ...,TAG=凌晨场"
Stash: argument: '{"ZEEKR_TOKEN":"Bearer eyJ...","ZEEKR_TAG":"凌晨场"}'
Egern: env: { ZEEKR_TOKEN: "Bearer eyJ...", ZEEKR_TAG: "凌晨场" }
青龙 : 环境变量 ZEEKR_TOKEN；六个订阅入口自带模式/标签，无需全局 MODE/TAG
```

---

## 目录结构

```
├── dist/                  ★成品脚本（客户端引用这三个）
│   ├── zeekr.js           QX / Loon / Stash / Surge / Node
│   ├── zeekr.egern.js     Egern（ES Module + ctx API）
│   └── zeekr.qinglong.js  青龙（多账号 + sendNotify + 无 fetch 时 https 兜底）
├── qinglong/              六个自包含订阅入口（面板自动生成可编辑任务）
├── configs/               各客户端配置（qx.conf / loon.plugin / loon-snippet.conf / stash.yaml / egern.yaml / qinglong.md）
├── parts/core.js          核心逻辑（运行时无关）
├── tpl/{classic,egern,qinglong}.js   三个模板，含 /*__CORE__*/ 占位
├── build.py               把 core 内联进模板 → dist/，并做 node --check
├── gen_configs.py         生成 configs/
└── tests/                 4 套自动化测试
```

自行改逻辑：改 `parts/core.js`（或 `tpl/*`）后

```bash
python3 build.py        # 重新生成 dist/ + 语法检查
python3 gen_configs.py  # 重新生成 configs/（一般不用动）
```

签名密钥在源码里是 `__ZEEKR_SECRET__` 占位符，构建时自动填入；来源优先级：
`ZEEKR_SECRET_SRC` 环境变量 → 本机 node 版脚本 → **已有的 `dist/zeekr.js`**
（所以直接克隆本仓库也能构建）。

---

## 测试

默认只运行离线检查，不使用真实账号、不签到/上报/领取：

```bash
node tests/unit.js
node tests/web-platform.js
node --test tests/account-nickname.js tests/qinglong-subscription.test.cjs
python3 tests/configs-check.py  # 需 PyYAML
```

青龙订阅回归使用固定版本官方解析/导入逻辑及内存测试 API，覆盖自动六任务、模式隔离、不重复创建与保留自定义定时。不是所有面板版本的实网验收。
`tests/e2e*`、`tests/verify-remote.js` 会真实请求极氪接口，可能签到、上报、点赞或领取；只有账号本人明确允许时才能运行，不属于默认验证。

---

## 常见问题

| 现象 | 处理 |
|---|---|
| `❌ 查询可领取奖品失败: 登录已失效` | 可能是过期、撤销或签发平台不匹配；先更新脚本并核对平台，再获取自己的新 Token，不要仅凭到期时间判断有效性 |
| `❌ JWT 里没有设备 ID` | Token 复制不完整（应是 `Bearer eyJ...` 三段） |
| 抓不到 Token | MITM 没开 / CA 没信任 / 域名不在 MITM 列表；QX 需 `[rewrite_local]` + `[mitm]` 配套。仍抓不到就把正则放宽为整域名（片段里有注释写法） |
| 客户端提示脚本超时 | 用默认 `MODE=all`（约 10~25 秒），别用 `POLL=1`；QX 建议拆成 `sign` + `claim` 两条 |
| App 里还留着没领的碎片 | 手动跑一次 `MODE=claim`；或改 `POLL=1` 并放宽 timeout |
| 一直是 `⏳ 减碳2000g` | 正常。这项要靠当天真开车/充电产生减碳，脚本只能「达标就领」 |
| Loon 插件「加载不出来」 | 用 [`configs/loon.plugin`](configs/loon.plugin)：Loon 只在文件首行是 `#!name` 时才当作插件；只含 `[Script]` 的片段不会被识别 |
| Egern 报「发生错误，位于第 N 行」 | 用模块方式加载 [`configs/egern.yaml`](configs/egern.yaml)（Egern → 模块 → +）。原因：模块文件需要元数据字段，且 YAML 里 `\d` 必须写在单引号里，双引号内是非法转义 |
| 抓取规则配了却抓不到 Token | 早期版本的 `configs/*` 正则被多转义一层（`\.` 错写成 `\\.`），匹配不上真实 URL —— 已修。用最新 `configs/`，`tests/configs-check.py` 现在会验证每条正则真的能匹配目标 URL |
| 抓取开了 MITM 还是抓不到 Token（推荐排查顺序） | ① **确认 MITM 生效**：MITM/HTTPS 解密已开启 + CA 证书已安装并在 iOS「证书信任设置」里信任（这步最常漏）+ `api-gw-toc.zeekrlife.com` 在 MITM 列表里；② **打开调试开关**（Egern 模块里的「抓取调试」/ QX 的 `#CAPDEBUG=1` / Loon 的 `argument="CAPDEBUG=1"` / Stash 的 `ZEEKR_CAPDEBUG`），再打开极氪 App：<br>没任何通知 = 规则没命中或 MITM 没生效；<br>通知写「没有 Authorization ✗」= 命中了但那条请求不带 token（多点几个页面再试）；<br>通知写「带 Authorization ✓」+「已存入 ✓」= 抓到了；若写「⚠️ 存储写入失败」请把该情况反馈<br>③ 请求阶段不触发就改用**响应阶段兜底**（配置里已备好注释行，参考脚本 wf021325/qx 用的就是响应阶段） |
| 定时任务报「缺少 Token」但手机已经抓到 | 用 Egern 的「极氪Token自检（手动跑一次）」脚本确认能否读到存储；若仍报缺 Token，刷新/重新导入配置；Egern 可在新模块的「手动 Token（可选）」填入完整凭据，修改后重连 VPN |
| 通知里一大串乱码/长文本 | 是抓取到的 Token（给青龙复制的）。不想显示设 `CAPSHOW=0` |

---

## 说明与免责

- 脚本只使用你自己抓包/抓取得到的 `Authorization` Token，**签到脚本不保存账号密码、不执行短信登录；登录工具在独立的 `zeekr-token-web` 项目自行部署**。
- 源码里内嵌的 `SECRET` 是极氪 H5 前端的**固定签名 key**（公开前端里就有，非账号凭证），
  用于生成 `x_ca_sign` 请求头。
- 仅供个人学习与自用；上游接口/页面一旦调整可能失效，请自行评估使用风险。
- 本仓库此前用于存放签到记录存档，现已改为多客户端脚本；旧存档已转入私有仓库。

用到的接口（2026-09 实测）：
`zgreen/center`（签到）、`walkData/initDayWalkData`（步数）、
`taskProgress/taskMsg`（任务列表）、`invitation/pub/detail`（阅读）、
`invitation/pub/list` + `clicks/fabulous`（点赞）、
`carEnergy/getUncollectedBallsPageNew`（可领取）、
`apply/batchApply`（碎片）、`carEnergy/collectedAllEnergy`（能量球）、
`carEnergy/collectIntegralZeekrBalls`（极值）。

---

## 更新记录

- **2026-10-28（UTC+8）· v3.3.0**：将 `zeekr-checkin-new` 已验证版本合回原项目（来源提交 `98b1a82`），统一恢复本仓库脚本/配置/订阅地址。增加 WEB_PC Token 支持、Egern 手动 Token 与抓取存储分流、设备参数优先级与长账号 ID 保护、按需吸收 PR #5 的请求分层/鉴权熔断改进、青龙账号昵称及一个订阅自动六条可编辑任务。默认仍为每轮随机 10000–20000 步，保留手机六场及 Loon 超时修复。维护者已反馈青龙、Egern 使用成功，不据此宣称其他客户端或所有版本均验收。手机端需刷新/重新导入本仓库配置；青龙迁移前禁用实验仓库旧订阅及旧任务，保留凭据，避免重复执行。取 Token 工具仍独立自部署，不公开私人入口；MPv3 和本机 timer 不变。感谢 PR #5、Issue #6/#7 的贡献者；相关讨论仅回复，暂不关闭。

- **2026-10-27（v2.3.3）**：合入 PR #2 的 Loon 修复：HTTP 抓取改用 `request if` / `response if` 新语法，修正路径正则转义并保留 `/i`；Loon `$httpClient.timeout` 按毫秒传递，20 秒不再误传成 20 毫秒，Stash/Surge 维持原单位。手机端恢复三场主签到（00:01 / 08:10 / 21:30）及三场仅领取补领（00:10 / 08:20 / 21:40），均为北京时间。新增模板与成品的超时单位离线回归、五类手机配置的六场时间与 claim 模式校验。更新后需刷新/重新导入模块或插件配置，单独更新 JS 不会恢复定时。未合入 PR #5，不改变 MPv3 与本机定时。
- **2026-10-27（配置调整）**：此前曾移除手机端三场独立补领，仅保留三场主签到；本次 v2.3.3 已按用户要求恢复补领。

- **2026-10-10（v2.3.2）**：默认随机上报 10000–20000 步，支持范围字符串、固定整数、关闭；同次运行补报沿用一个抽样，保留六层编码。旧配置若固定为 10000，需自行改成 `10000-20000` 或留空。
- **2026-10-10（v2.3.1）**：步数 `stepCountsSecret` 从五层修正为六层 Base64，加入解码后手机字段的逐字节回归。不领取探针已验证上报被接受；当日任务此前已由手机完成，尚不能证明奖励由此次脚本上报生成。
- **2026-09-25（v2.3.0）**：修七日连签抽奖球领取 —— `SIGN_CONTINUOUS_7_LOTTERY` 不再按普通碎片走 `batchApply`，改用 App 抓包确认的 `applyV2/apply` + `record=zgreen_7day_activity` + `fixedZgreenAssetId`，可领取锦鲤泡泡 / 5Kr 等七日奖励。

- **2026-09-21（v2.2.0）**：修**「通知说领完了、App 里碎片/能量还在」**（真事故）——
  ① 批量领取碎片里有个别失败时**真的逐个重试**（旧版只打一句「逐个重试」的日志、实际没重试），
  并把服务端返回的失败原因原样写进日志（旧版把原因丢掉，事故因此查不出来）；
  ② 领取循环只有在**确实领到**之后才把条目记为已领 —— 旧版在领取**之前**就记，
  一次失败就永不重试，列表还被过滤成空，于是打出「✅ 可取皆已领完」；
  失败项现在会留到下一轮再试（最多 3 次）；
  ③ 还有没领掉的时结论写「⚠️ 仍有 N 项未领到」，通知标题变 **「⚠️ 极氪签到（未领净）」**、
  正文列出 `名称→原因`，**不再**写「🎉 全部完成！」。
  新增离线回归 `tests/claim-retry.js`（12 项断言，不打真接口）。

- **2026-09-19（v2.1.0）**：修 Egern 抓取 + 加「抓取 Token」开关 ——
  ① **取头大小写**：Egern 递进来的 `ctx.request.headers` 是普通对象、键名保留原始大小写
  （`Authorization`），旧代码只试小写键 → 恒取不到值（现象：日志写「这条请求没有
  Authorization 头」）。现在键名一律小写归一化后再匹配（对齐参考脚本 wf021325/qx 的
  `ObjectKeys2LowerCase` 写法），Headers 对象（`get`/`forEach`）与普通对象都认；
  ② 跳过 `OPTIONS` 预检请求，裸 JWT（无 `Bearer ` 前缀）也自动补齐后保存；
  ③ 模块设置新增 **「抓取 Token」开关**（默认开）：开 = 开 App 就抓并弹通知（Token 变了
  立刻弹，没变则 10 分钟最多一条）；关 = 不抓、不存、不弹任何通知（含调试）；
  ④ 抓取通知**点一下即把 Token 复制进剪贴板**（iOS 不允许脚本回写模块设置页，
  想填那一栏就点通知再粘贴）；通知里也会标明开关状态与脚本版本；
  ⑤ 补硬闸：HTTP 上下文里只抓 Token，绝不误跑签到流程；
  ⑥ **模块设置里删掉「极氪 Token」栏**（用户要求：Egern 不允许脚本回写设置页，
  留一个填不进去的输入框只会误导），同时把「env 里的 Token」改成**必须形态合法才算配置**
  —— 占位符/垃圾值一律忽略，回落到抓到的那个。
  回归测试见 `tests/e2e-egern.mjs`（B2 取头兼容 6 条 + D 开关门控 8 条）。

- **2026-09-19**：修正配置文件的两个致命问题 ——
  ① Loon 配置改成**真正的插件**（`configs/loon.plugin`，首行 `#!name`，带 `[Argument]` 参数 UI），
  之前的片段式写法 Loon 加载不出来；
  ② Egern 配置改成**真正的模块**（元数据 + `mitm` + `scriptings`，正则改单引号），
  之前的双引号 `\d` 会让 Egern 直接报 YAML 解析错误；
  ③ 修正所有客户端**抓取正则多转义一层**的问题（原来 `\.` 写成 `\\.`，等于匹配"反斜杠+任意字符"，一条都命中不了），
  并新增 `tests/configs-check.py` 做回归（校验 YAML 可解析 + 每条正则真能匹配目标 URL + 插件/模块格式）。
