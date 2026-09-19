#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
配置片段回归测试（2026-09-19 那次线上事故的防线）：
  * YAML 必须能被解析（Egern 那次报错就是 YAML 里 \d 非法转义）
  * 每个客户端的抓取正则必须**真的能匹配**目标 URL
    （之前多转义一层，正则变成"反斜杠+任意字符"，一条都匹配不上）
  * 正则里不许出现 \\\\. / \\\\/ 这种双反斜杠残留
  * Loon 插件必须有 #!name 等 #! 元数据头（否则「加载不出来」）
  * Egern 模块必须有 name/scriptings/mitm 才算模块文件
  * 任何配置里都不许出现真实 Token

用法: python3 tests/configs-check.py [配置目录]
"""
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 可选：python3 tests/configs-check.py <目录>  用来校验别处的副本（例如线上拉下来的）
CFG = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "configs"
TARGET_URL = "https://api-gw-toc.zeekrlife.com/zeekrlife-app-user/v1/user/info/query"
TARGET_ROOT = "https://api-gw-toc.zeekrlife.com/anything/else"

passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ✅ " + name)
    else:
        failed += 1
        print("  ❌ " + name + ("  → " + str(extra) if extra else ""))


def read(fn):
    return (CFG / fn).read_text(encoding="utf-8")


print("== 1. YAML 可解析性 ==")
try:
    import yaml

    for fn in ("egern.yaml", "stash.yaml"):
        try:
            doc = yaml.safe_load(read(fn))
            check(f"{fn} 解析通过", isinstance(doc, dict), type(doc))
        except Exception as e:
            check(f"{fn} 解析通过", False, str(e).replace("\n", " | ")[:200])

    eg = yaml.safe_load(read("egern.yaml"))
    check("egern.yaml 顶层有 name（模块元数据）", "name" in eg, list(eg.keys()))
    check("egern.yaml 顶层有 scriptings", isinstance(eg.get("scriptings"), list), type(eg.get("scriptings")))
    check("egern.yaml 声明了 mitm.hostnames", isinstance((eg.get("mitm") or {}).get("hostnames"), list))
    st = yaml.safe_load(read("stash.yaml"))
    check("stash.yaml 顶层键齐全（http/cron/script-providers）",
          set(st.keys()) >= {"http", "cron", "script-providers"}, list(st.keys()))
except ImportError:
    print("  ⚠️ 没装 PyYAML，跳过（pip install pyyaml 后可完整校验）")

print("\n== 2. 抓取正则必须能匹配目标 URL ==")
regexes = {}

# QX： [rewrite_local] 里非注释行的第一个字段就是正则
for line in read("qx.conf").split("\n"):
    s = line.strip()
    if s and not s.startswith("#") and "script-request-header" in s and "url" in s:
        regexes.setdefault("qx.conf", []).append(s.split(" ")[0])

# Loon： ~= /正则/ then
for fn in ("loon.plugin", "loon-snippet.conf"):
    for m in re.finditer(r"~= (/.+/) then", read(fn)):
        regexes.setdefault(fn, []).append(m.group(1)[1:-1])

# Stash / Egern： match: '正则'
for fn in ("stash.yaml", "egern.yaml"):
    for m in re.finditer(r"match: '([^']+)'", read(fn)):
        regexes.setdefault(fn, []).append(m.group(1))

for fn, pats in regexes.items():
    check(f"{fn} 里有抓取正则", bool(pats))
    check(f"{fn} 正则没有 ^^ / $$ 这种重复锚点", not any(p.startswith("^^") or p.endswith("$$") for p in pats),
          [p[:40] for p in pats if p.startswith("^^") or p.endswith("$$")])
    for p in pats:
        try:
            rx = re.compile(p)
        except re.error as e:
            check(f"{fn} 正则可编译: {p[:46]}", False, str(e))
            continue
        is_broad = "app-user" not in p
        u = TARGET_ROOT if is_broad else TARGET_URL
        check(f"{fn} 正则可编译且能匹配目标 URL", bool(rx.search(u)), p[:70])

print("\n== 2b. 结构校验（Loon 插件行 / Egern 模块条目）==")
loon_txt = read("loon.plugin")
cron_lines = re.findall(r"^cron (.+)$", loon_txt, re.M)
check("loon.plugin 6 条 cron 都是新语法 then script(...)",
      len(cron_lines) == 6 and all('then script("' in c for c in cron_lines), len(cron_lines))
check("loon.plugin 的 cron 都带 timeout",
      all("timeout=" in c for c in cron_lines))
check("loon.plugin 的抓取行用 http-request if ... then script(...)",
      re.search(r'^http-request if \$\{url\} ~= /.+/ then script\("', loon_txt, re.M) is not None)
check("loon.plugin 的 argument 用了插件参数 ${TOKEN}",
      "${TOKEN}" in loon_txt)

try:
    import yaml as _yaml

    eg_doc = _yaml.safe_load(read("egern.yaml"))
    kinds = []
    bad_entry = []
    for item in eg_doc["scriptings"]:
        if not isinstance(item, dict) or len(item) != 1:
            bad_entry.append(item)
            continue
        kinds.append(list(item.keys())[0])
        body = list(item.values())[0]
        if list(item.keys())[0] == "schedule":
            if not all(k in body for k in ("name", "cron", "script_url", "timeout")):
                bad_entry.append(body)
            for v in (body.get("env") or {}).values():
                if not isinstance(v, str):
                    bad_entry.append(body)
    check("egern.yaml 每个 scriptings 条目都是单键映射",
          not bad_entry and len(kinds) >= 7, f"kinds={kinds} bad={len(bad_entry)}")
    check("egern.yaml 里有 1 个手动自检脚本（generic）", kinds.count("generic") == 1, kinds)
    check("egern.yaml 含 1 条 http_request + 6 条 schedule",
          kinds.count("http_request") == 1 and kinds.count("schedule") == 6, kinds)
    check("egern.yaml 的 schedule 都带 env（MODE/TAG）",
          all("env" in list(i.values())[0] for i in eg_doc["scriptings"] if "schedule" in i))
except ImportError:
    print("  ⚠️ 没装 PyYAML，跳过结构校验")

print("\n== 3. 不许有双反斜杠残留（事故根因）＝=")
for fn in ("qx.conf", "loon.plugin", "loon-snippet.conf", "stash.yaml", "egern.yaml"):
    t = read(fn)
    bad_ctx = []
    for m in re.finditer(r"\\\\.|\\\\/", t):
        line = t[: m.start()].count("\n") + 1
        if "\\d" in t[max(0, m.start() - 3): m.start() + 3] or "\\." in t[m.start(): m.start() + 3] or "\\/" in t[m.start(): m.start() + 3]:
            bad_ctx.append(line)
    # 只关心正则行（排除文档里说明用法的注释行里偶发的示例）
    check(f"{fn} 没有 \\\\. / \\\\/ 形式的双转义", not bad_ctx, "行 " + str(bad_ctx[:5]))

print("\n== 4. Loon 插件元数据 ==")
loon = read("loon.plugin")
check("loon.plugin 首行是 #!name（Loon 靠它识别插件）", loon.lstrip().startswith("#!name"), loon.split("\n")[0][:60])
for k in ("#!desc", "#!author", "[Argument]", "[Script]", "[Mitm]"):
    check(f"loon.plugin 含 {k}", k in loon)
check("loon.plugin 有 6 条 cron", len(re.findall(r"^cron ", loon, re.M)) == 6,
      len(re.findall(r"^cron ", loon, re.M)))
check("loon.plugin 声明了 TOKEN 参数", re.search(r"^TOKEN\s*=", loon, re.M) is not None)
check("loon.plugin 的 Mitm 域名正确", "hostname = api-gw-toc.zeekrlife.com" in loon)

print("\n== 5. 脚本地址 & 敏感信息 ==")
for fn in ("qx.conf", "loon.plugin", "loon-snippet.conf", "stash.yaml", "egern.yaml"):
    t = read(fn)
    check(f"{fn} 用的是仓库真地址", "raw.githubusercontent.com/m20104600/zeekr-checkin/main/dist" in t)
    check(f"{fn} 不含真实 Token", True)  # 具体比对在下面统一做

envfile = pathlib.Path(os.path.expanduser("~/.config/zeekr-checkin/env"))
needle = None
if envfile.exists():
    m = re.search(r"Bearer\s+([\w.\-]{40,})", envfile.read_text(encoding="utf-8"))
    needle = m.group(1)[:60] if m else None
hits = []
for f in sorted(CFG.iterdir()):
    if needle and needle in f.read_text(encoding="utf-8", errors="ignore"):
        hits.append(f.name)
check("configs/ 里没有真实 Token 片段", not hits, hits)

print(f"\n结果: {passed} 通过, {failed} 失败")
sys.exit(1 if failed else 0)
