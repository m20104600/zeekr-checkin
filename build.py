#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 parts/core.js 内联进各客户端模板，生成 dist/ 下的成品脚本。

签名密钥（极氪 H5 前端的固定签名 key，不是你的账号凭证）在源码里以
__ZEEKR_SECRET__ 占位符存在，构建时自动填进 dist/。密钥来源按优先级：
  1) 环境变量 ZEEKR_SECRET_SRC 指向的文件
  2) 本机开发环境里的 node 版脚本 checkin.mjs（只读，不修改）
  3) 已有的 dist/zeekr.js（所以克隆本仓库后直接 building 也能跑）

用法:  python3 build.py [--check]
"""
import os
import json
import re
import subprocess
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
CORE_FILE = ROOT / "parts" / "core.js"
# 本机开发环境里的密钥来源（可选，仓库被克隆到别处时不存在也能构建）
LOCAL_SKILL_SRC = pathlib.Path(
    os.environ.get("ZEEKR_SKILL_MJS", "")
    or "/root/.hermes/skills/zeekr-auto-checkin/scripts/checkin.mjs"
)
TARGETS = [
    ("tpl/classic.js", "zeekr.js"),
    ("tpl/egern.js", "zeekr.egern.js"),
    ("tpl/qinglong.js", "zeekr.qinglong.js"),
]

# Stable paths are Qinglong task identities: do not rename during routine updates.
QL_ADAPTER_VERSION = "3.3.0"
QL_SLOTS = [
    ("zeekr_0001_all.js", "1 0 * * *", "all", "凌晨场", "极氪签到·凌晨场"),
    ("zeekr_0010_claim.js", "10 0 * * *", "claim", "凌晨场·补领", "极氪签到·凌晨补领"),
    ("zeekr_0810_all.js", "10 8 * * *", "all", "早间场", "极氪签到·早间场"),
    ("zeekr_0820_claim.js", "20 8 * * *", "claim", "早间场·补领", "极氪签到·早间补领"),
    ("zeekr_2130_all.js", "30 21 * * *", "all", "晚间场", "极氪签到·晚间场"),
    ("zeekr_2140_claim.js", "40 21 * * *", "claim", "晚间场·补领", "极氪签到·晚间补领"),
]


def secret_sources():
    """按顺序找签名密钥的来源文件（谁先存在用谁）：
    1) 环境变量 ZEEKR_SECRET_SRC 指定的文件
    2) 本机 Hermes 技能里的 node 版脚本（开发机）
    3) 已有的 dist/zeekr.js —— 让仓库克隆下来也能自行构建
    """
    out = []
    env_src = os.environ.get("ZEEKR_SECRET_SRC", "").strip()
    if env_src:
        out.append(pathlib.Path(env_src))
    out.append(LOCAL_SKILL_SRC)
    pat = re.compile(r"var ZEEKR_SECRET = \"([^\"]+)\"")
    for f in (ROOT / "dist" / "zeekr.js",):
        if f.exists():
            m = pat.search(f.read_text(encoding="utf-8"))
            if m:
                out.append(f)
    return out


def read_secret() -> str:
    pats = [
        re.compile(r'export const SECRET\s*=\s*\n?\s*"([^"]+)"'),   # checkin.mjs
        re.compile(r'var ZEEKR_SECRET = "([^"]+)"'),                 # dist/zeekr.js
    ]
    for src in secret_sources():
        if not src.exists():
            continue
        text = src.read_text(encoding="utf-8")
        for p in pats:
            m = p.search(text)
            if m:
                print(f"密钥来源: {src}")
                return m.group(1)
    sys.exit(
        "找不到签名密钥来源。请设置环境变量 ZEEKR_SECRET_SRC 指向含密钥的脚本"
        "（node 版 checkin.mjs 或已构建好的 dist/zeekr.js）"
    )


def check(path: pathlib.Path, esm: bool = False) -> bool:
    target = path
    cleanup = None
    if esm:
        target = path.with_suffix(".mjs")
        target.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        cleanup = target
    r = subprocess.run(
        ["node", "--check", str(target)], capture_output=True, text=True
    )
    if cleanup:
        cleanup.unlink()
    if r.returncode != 0:
        print(f"  ✗ 语法检查失败: {path.name}\n{r.stderr.strip()}")
        return False
    print(f"  ✓ {path.name} 语法 OK")
    return True


def main() -> int:
    secret = read_secret()
    core = CORE_FILE.read_text(encoding="utf-8")
    if "__ZEEKR_SECRET__" not in core:
        sys.exit("parts/core.js 里没有 __ZEEKR_SECRET__ 占位符，无法注入密钥")
    m = re.search(r'ZEEKR_PORT_VERSION\s*=\s*"([^"]+)"', core)
    version = m.group(1) if m else "?"
    print(f"脚本版本（来自 parts/core.js）: {version}")

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    ok = True
    for tpl_name, out_name in TARGETS:
        tpl = (ROOT / tpl_name).read_text(encoding="utf-8")
        if "/*__CORE__*/" not in tpl:
            sys.exit(f"{tpl_name} 缺少 /*__CORE__*/ 标记")
        out = tpl.replace("/*__CORE__*/", core.rstrip("\n")).replace(
            "__ZEEKR_SECRET__", secret
        )
        out = out.replace("__ZEEKR_PORT_VERSION__", version)  # 版本只在 core.js 定义一处
        out = out.replace("/*__QL_SCHEDULE__*/null", "null")
        path = dist / out_name
        path.write_text(out, encoding="utf-8")
        leak = "__ZEEKR_SECRET__" in out
        print(f"写入 {path} ({len(out)} 字节, {out.count(chr(10)) + 1} 行)"
              + ("  ⚠️ 占位符未替换！" if leak else ""))
        ok = check(path, esm=out_name.endswith(".egern.js")) and ok

    ql_dir = ROOT / "qinglong"
    ql_dir.mkdir(exist_ok=True)
    ql_tpl = (ROOT / "tpl/qinglong.js").read_text(encoding="utf-8")
    for filename, cron, mode, tag, name in QL_SLOTS:
        slot = json.dumps({"mode": mode, "tag": tag}, ensure_ascii=False)
        # Keep the cron line FREE of a leading comment '*': legacy parsers
        # otherwise mistake it for a sixth cron field (seconds).
        header = (f'/*\nnew Env("{name}");\ncron: {cron}\n'
                  f'{cron} {filename}\n'
                  f'青龙订阅适配 v{QL_ADAPTER_VERSION}；默认时区 UTC+8。\n'
                  '生成文件，请勿直接修改；时间在青龙定时任务中编辑。\n*/\n')
        out = header + ql_tpl.replace("/*__CORE__*/", core.rstrip("\n"))
        out = out.replace("__ZEEKR_SECRET__", secret)
        out = out.replace("__ZEEKR_PORT_VERSION__", version)
        out = out.replace("/*__QL_SCHEDULE__*/null", slot)
        target = ql_dir / filename
        target.write_text(out, encoding="utf-8")
        print(f"写入 {target}: {cron}, MODE={mode}")
        ok = check(target) and ok

    # 安全检查：确认核心逻辑里没有把密钥写死成明文常量以外的敏感信息
    print("\n自检:")
    probe = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ"
    need_quote = 'require(' + chr(34) + 'crypto' + chr(34) + ')'
    for f in sorted(dist.iterdir()):
        t = f.read_text(encoding="utf-8")
        has_key = "有" if probe in t else "无!"
        has_ph = "有!" if "__ZEEKR_SECRET__" in t else "无"
        has_dep = "有" if (need_quote in t or "Buffer" in t) else "无"
        print(f"  {f.name}: 签名密钥={has_key} 占位符={has_ph} 外部依赖={has_dep}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
