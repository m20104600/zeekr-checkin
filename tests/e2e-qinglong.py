#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
端到端测试：青龙版 dist/zeekr.qinglong.js
  A. 正常单账号跑（claim 模式，真实请求）
  B. 没有 fetch 的运行时 → 退回 https 模块
  C. 多账号（ZEEKR_TOKEN 里放两个，换行分隔）
  D. 未配置 Token → 退出码 1 + 明确报错
不打印任何 Token 明文。
"""
import os
import re
import subprocess
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "dist" / "zeekr.qinglong.js"
KEY = "ZEEKR_" + "TOKEN"

pass_n = 0
fail_n = 0


def check(name, cond, extra=""):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print("  ✅ " + name)
    else:
        fail_n += 1
        print("  ❌ " + name + ("  → " + str(extra) if extra else ""))


def raw_value():
    """环境变量文件里的原始值，可能带引号/空格/零宽字符（本机就是带单引号的）"""
    txt = (pathlib.Path("/root/.config/zeekr-checkin/env")).read_text(encoding="utf-8")
    m = re.search(r"^\s*" + KEY + r"\s*=\s*(.+)$", txt, re.M)
    if not m:
        sys.exit("读不到本机 Token")
    return m.group(1).strip()


def real_token():
    """去掉引号/零宽字符后的干净值；优先读环境变量 ZEEKR_TOKEN"""
    if os.environ.get("ZEEKR_TOKEN"):
        return os.environ["ZEEKR_TOKEN"].strip()
    v = raw_value()
    v = re.sub(r"[\u200b-\u200f\ufeff\u2060\u00a0]", "", v).strip().strip('"').strip("'").strip()
    i = v.find("Bearer")
    return v[i:] if i > 0 else v


def run(env_extra, preload=None, timeout=180):
    env = dict(os.environ)
    for k in list(env):
        if k.upper().startswith("ZEEKR"):
            del env[k]
    env.update(env_extra)
    cmd = ["node"]
    if preload:
        cmd += ["-r", str(ROOT / preload)]
    cmd.append(str(SCRIPT))
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env,
                       cwd=str(ROOT))
    return r


TOK = real_token()
RAW = raw_value()
print("环境变量原始值：引号=%r 长度=%d（真实的青龙环境变量长这样）" % (RAW[:1] + RAW[-1:], len(RAW)))

print("== A. 青龙单账号（claim 模式，真实请求）==")
r = run({KEY: RAW, "ZEEKR_MODE": "claim", "ZEEKR_APPVER": "4.9.33", "ZEEKR_TAG": "青龙场"})
out = r.stdout
print("\n".join(out.strip().split("\n")[:14]))
check("退出码 0", r.returncode == 0, r.returncode)
check("识别客户端为青龙", "客户端: 青龙" in out)
check("Token 有效期解析", bool(re.search(r"Token 过期: \d{4}/\d{1,2}/\d{1,2}", out)))
check("19 位 accountId 精确", bool(re.search(r"账号: 2007\d{15}", out)))
check("走到领取阶段", "本次领取" in out)
check("带引号的 Token 被自动清洗（真实场景）", "登录已失效" not in out, out[:200])
check("通知标题含场次（合并成一条）", "极氪签到（青龙·青龙场" in out, out.split(chr(10))[0])
check("没有明文打印 Token", TOK not in out and TOK[:40] not in out)

print("\n== A2. 兼容常见极氪脚本的 zeekr_val（JSON）写法 ==")
r_a2 = run({"zeekr_val": '{"authorization": "' + TOK + '"}', "ZEEKR_MODE": "claim",
            "ZEEKR_APPVER": "4.9.33", "ZEEKR_NOTIFY": "0"})
check("退出码 0", r_a2.returncode == 0, r_a2.returncode)
check("从 zeekr_val 里认出 Token", "账号: 2007" in r_a2.stdout)
check("没有「缺少 Token」报错", "缺少 Token" not in r_a2.stdout)
check("走到领取阶段", "本次领取" in r_a2.stdout)

print("\n== A3. 裸 JWT（没带 Bearer 前缀）也能用 ==")
BARE = TOK.split(" ", 1)[1] if " " in TOK else TOK
r_a3 = run({KEY: BARE, "ZEEKR_MODE": "claim", "ZEEKR_APPVER": "4.9.33", "ZEEKR_NOTIFY": "0"})
check("退出码 0", r_a3.returncode == 0, r_a3.returncode)
check("自动补上 Bearer 后可用", "本次领取" in r_a3.stdout and "登录已失效" not in r_a3.stdout)

print("\n== B. 无 fetch 运行时 → https 兜底 ==")
r2 = run({KEY: TOK, "ZEEKR_MODE": "claim", "ZEEKR_APPVER": "4.9.33"}, preload="tests/no-fetch.cjs")
check("预加载生效", "global fetch 已移除" in r2.stdout)
check("退出码 0（https 分支可用）", r2.returncode == 0, r2.stderr[-300:])
check("https 分支也走到了领取", "本次领取" in r2.stdout)

print("\n== C. 多账号（两个 Token，换行分隔）==")
r3 = run({KEY: TOK + "\n" + TOK, "ZEEKR_MODE": "claim", "ZEEKR_APPVER": "4.9.33", "ZEEKR_NOTIFY": "0"})
check("退出码 0", r3.returncode == 0, r3.returncode)
check("账号 1/2 各跑一遍", "【账号 1/2】" in r3.stdout and "【账号 2/2】" in r3.stdout)
check("ZEEKR_NOTIFY=0 时不发通知尝试", "没找到可用的通知渠道" not in r3.stdout)

print("\n== D. 未配置 Token ==")
r4 = run({"ZEEKR_MODE": "claim"})
check("退出码 1（能被青龙标记失败）", r4.returncode == 1, r4.returncode)
check("报错明确", "未找到环境变量" in r4.stdout)

print(f"\n结果: {pass_n} 通过, {fail_n} 失败")
sys.exit(1 if fail_n else 0)
