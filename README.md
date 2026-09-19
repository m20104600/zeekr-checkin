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

## 特性

- **零依赖纯 JS**：SHA1 签名、base64（步数 secret 要套 5 层）都是手写实现，
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
| 青龙 | [`configs/qinglong.md`](configs/qinglong.md) | 环境变量 + `task zeekr.qinglong.js` 定时任务 |

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

**手机端（QX / Loon / Stash / Egern）自动抓**：开 MITM（信任 CA 证书）+
配上片段里的抓取规则 → 打开极氪 App 随便点一下 → 收到
「✅ 极氪 Token 已自动保存」通知，Token 已存进客户端，定时任务无需再填。

**青龙没有 MITM，抓不了** —— 用手机抓一次，把通知正文最后那行
`Bearer eyJ...` 复制过去，粘到环境变量 `ZEEKR_TOKEN`；
或者把整段 JSON 粘给 `zeekr_val` / `ZEEKR_VAL`（与常见极氪脚本格式互通，脚本会自动认）。

也可以自己抓包：过滤域名 `api-gw-toc.zeekrlife.com`，复制任意请求头里的 `Authorization`。

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

## 参数

写在客户端的 argument / `#` 参数 / env 里，或者本地脚本顶部的 `ZEEKR_DEFAULT_CONFIG`。
**前缀 `ZEEKR_` 可有可无，大小写不敏感**（`TOKEN`、`zeeKr_token`、`ZEEKR_TOKEN` 都认）。

| 参数 | 默认 | 说明 |
|---|---|---|
| `TOKEN` | — | Bearer Token；不填则用抓取存的（青龙必须填/复制） |
| `MODE` | `all` | `all`=签到+步数+任务+领取；`sign`=只签到做任务；`claim`=只领取 |
| `TAG` | — | 场次标签，只影响通知标题，如 `凌晨场` |
| `STEPS` | 随机 8000~12000 | 上报步数；`off` 跳过上报 |
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
青龙 : 环境变量 ZEEKR_TOKEN / ZEEKR_MODE / ZEEKR_TAG
```

---

## 目录结构

```
├── dist/                  ★成品脚本（客户端引用这三个）
│   ├── zeekr.js           QX / Loon / Stash / Surge / Node
│   ├── zeekr.egern.js     Egern（ES Module + ctx API）
│   └── zeekr.qinglong.js  青龙（多账号 + sendNotify + 无 fetch 时 https 兜底）
├── configs/               各客户端配置片段（qx.conf / loon.conf / stash.yaml / egern.yaml / qinglong.md）
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

```bash
node tests/unit.js            # 35 项：纯 JS SHA1/base64 与 Node 原生逐字节比对、JWT 解析、参数解析、Token 清洗
node tests/e2e.js             # 36 项：模拟 Loon/Stash/QX 运行时，真打极氪接口（claim 幂等）
node tests/e2e-egern.mjs      # 10 项：模拟 Egern ctx（schedule + http_request 抓取）
python3 tests/e2e-qinglong.py # 22 项：真跑青龙脚本（多账号、zeekr_val、裸 JWT、无 fetch 的 https 兜底）
```

合计 103 项断言。E2E 会真的请求极氪接口，需要一个属于你自己的 Token：
读环境变量 `ZEEKR_TOKEN`，没有则读 `/root/.config/zeekr-checkin/env`。
其中 `MODE=claim`（只领取）与 `MODE=all`（签到当天幂等、步数重复上报无副作用）都是安全的。

---

## 常见问题

| 现象 | 处理 |
|---|---|
| `❌ 查询可领取奖品失败: 登录已失效` | Token 失效/被顶号。重新抓一次（手机端开 MITM 打开 App，或自己抓包） |
| `❌ JWT 里没有设备 ID` | Token 复制不完整（应是 `Bearer eyJ...` 三段） |
| 抓不到 Token | MITM 没开 / CA 没信任 / 域名不在 MITM 列表；QX 需 `[rewrite_local]` + `[mitm]` 配套。仍抓不到就把正则放宽为整域名（片段里有注释写法） |
| 客户端提示脚本超时 | 用默认 `MODE=all`（约 10~25 秒），别用 `POLL=1`；QX 建议拆成 `sign` + `claim` 两条 |
| App 里还留着没领的碎片 | 手动跑一次 `MODE=claim`；或改 `POLL=1` 并放宽 timeout |
| 一直是 `⏳ 减碳2000g` | 正常。这项要靠当天真开车/充电产生减碳，脚本只能「达标就领」 |
| Loon 插件「加载不出来」 | 用 [`configs/loon.plugin`](configs/loon.plugin)：Loon 只在文件首行是 `#!name` 时才当作插件；只含 `[Script]` 的片段不会被识别 |
| Egern 报「发生错误，位于第 N 行」 | 用模块方式加载 [`configs/egern.yaml`](configs/egern.yaml)（Egern → 模块 → +）。原因：模块文件需要元数据字段，且 YAML 里 `\d` 必须写在单引号里，双引号内是非法转义 |
| 抓取规则配了却抓不到 Token | 早期版本的 `configs/*` 正则被多转义一层（`\.` 错写成 `\\.`），匹配不上真实 URL —— 已修。用最新 `configs/`，`tests/configs-check.py` 现在会验证每条正则真的能匹配目标 URL |
| 通知里一大串乱码/长文本 | 是抓取到的 Token（给青龙复制的）。不想显示设 `CAPSHOW=0` |

---

## 说明与免责

- 脚本只使用你自己抓包/抓取得到的 `Authorization` Token，**不保存账号密码、不模拟登录**。
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

- **2026-09-19**：修正配置文件的两个致命问题 ——
  ① Loon 配置改成**真正的插件**（`configs/loon.plugin`，首行 `#!name`，带 `[Argument]` 参数 UI），
  之前的片段式写法 Loon 加载不出来；
  ② Egern 配置改成**真正的模块**（元数据 + `mitm` + `scriptings`，正则改单引号），
  之前的双引号 `\d` 会让 Egern 直接报 YAML 解析错误；
  ③ 修正所有客户端**抓取正则多转义一层**的问题（原来 `\.` 写成 `\\.`，等于匹配"反斜杠+任意字符"，一条都命中不了），
  并新增 `tests/configs-check.py` 做回归（校验 YAML 可解析 + 每条正则真能匹配目标 URL + 插件/模块格式）。
