#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校验 README / configs 里出现的所有链接：
  1. raw / jsDelivr 地址 HTTP 200 可下载（客户端直接用的就是这些）
  2. 脚本地址下载回来与本地 dist/ 逐字节一致（防止「文档写了但没推」）
  3. 仓库内相对链接（configs/xxx）指向的文件真的存在
  4. 文档里不该出现的真实 Token 片段（复用 publish.sh 的思路，粗筛）

用法：
  python3 tests/links-check.py                 # 用本地 README/configs 里的地址
  python3 tests/links-check.py /tmp/pubcfg     # 校验发布副本目录里的地址
"""

import base64
import hashlib
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = "https://raw.githubusercontent.com/m20104600/zeekr-checkin/main/"
JSD = "https://cdn.jsdelivr.net/gh/m20104600/zeekr-checkin@main/"
UA = {"User-Agent": "curl/8.0"}

ok = 0
bad = []
warns = []


def good(msg):
    global ok
    ok += 1
    print(f"  ✅ {msg}")


def warn(msg):
    warns.append(msg)
    print(f"  ⚠️  {msg}")


def fail(msg):
    bad.append(msg)
    print(f"  ❌ {msg}")


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def api_content(rel):
    """GitHub API（权威）取文件内容；拿不到返回 None。
    raw.githubusercontent.com 有 CDN 缓存，发布后 1~2 分钟内可能还是旧内容，
    判断线上到底是什么必须看 API。"""
    for cmd in (["gh", "api", f"repos/m20104600/zeekr-checkin/contents/{rel}",
                 "--jq", ".content"],):
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=60)
        except Exception:  # noqa: BLE001
            return None
        if r.returncode == 0 and r.stdout.strip():
            try:
                return base64.b64decode(r.stdout)
            except Exception:  # noqa: BLE001
                return None
    return None


def collect(root: pathlib.Path):
    """返回文档里出现过的所有 http(s) 链接"""
    urls = set()
    for p in sorted(root.rglob("*.md")) + sorted(root.rglob("*.conf")) + \
             sorted(root.rglob("*.yaml")) + sorted(root.rglob("*.plugin")):
        if ".git" in p.parts:
            continue
        for m in re.finditer(r"https?://[^\s`'\"<>)\]|]+", p.read_text(encoding="utf-8")):
            u = m.group(0).rstrip(".,;：:，。")
            urls.add(u)
    return urls


def main():
    root = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT
    print(f"== 扫描 {root} ==")
    urls = collect(root)
    print(f"   共发现 {len(urls)} 条链接\n")

    print("== 1. 仓库外链接（raw / jsDelivr）可达性 + 内容一致性 ==")
    for u in sorted(urls):
        if not (u.startswith(RAW) or u.startswith(JSD)):
            continue
        rel = u.replace(RAW, "").replace(JSD, "").split("?")[0]
        try:
            status, body = fetch(u)
        except urllib.error.HTTPError as e:
            fail(f"HTTP {e.code}  {u}")
            continue
        except Exception as e:  # noqa: BLE001
            fail(f"{type(e).__name__}: {e}  {u}")
            continue
        if status != 200:
            fail(f"HTTP {status}  {u}")
            continue
        # jsDelivr 有缓存，只查可达性
        if not u.startswith(RAW):
            good(f"镜像可达  {rel}")
            continue
        # raw 地址：可达 + 内容以 GitHub API 为权威
        rel_clean = rel.split("#")[0].split("?")[0]
        local = ROOT / rel_clean
        if not local.exists():
            good(f"可达  {rel_clean}（本地无对应文件，跳过比对）")
            continue
        lh = hashlib.sha256(local.read_bytes()).hexdigest()
        if hashlib.sha256(body).hexdigest() == lh:
            good(f"一致  {rel_clean}")
            continue
        api = api_content(rel_clean)
        if api is None:
            fail(f"内容不一致（raw ≠ 本地，且拿不到 API 对照）  {rel_clean}")
        elif hashlib.sha256(api).hexdigest() == lh:
            warn(f"raw CDN 缓存未刷新（API 已是最新且与本地一致，等 1~2 分钟）  {rel_clean}")
        else:
            fail(f"内容不一致（线上 API ≠ 本地）  {rel_clean}")

    print("\n== 2. 仓库内相对链接（configs/xxx 等）真的存在 ==")
    for p in sorted(root.rglob("*.md")):
        if ".git" in p.parts:
            continue
        text = p.read_text(encoding="utf-8")
        for m in re.finditer(r"\]\((?!https?://)([^)#]+)\)", text):
            target = (p.parent / m.group(1)).resolve()
            if target.exists():
                good(f"{p.name} → {m.group(1)}")
            else:
                fail(f"{p.name} → {m.group(1)} 不存在")

    print("\n== 3. 文档里不应该有真实 Token 片段 ==")
    envfile = pathlib.Path.home() / ".config/zeekr-checkin/env"
    frag = ""
    if envfile.exists():
        raw = envfile.read_text(errors="ignore")
        for line in raw.splitlines():
            if "=" in line and "TOKEN" in line.split("=")[0]:
                val = line.split("=", 1)[1].strip().strip("'\"")
                if len(val) > 60:
                    frag = val[40:80]  # 取中段，避免首尾常见前缀
                    break
    if not frag:
        print("  ⏭️  跳过（没读到本机 env 里的 Token）")
    else:
        hits = []
        for p in sorted(root.rglob("*")):
            if p.is_file() and ".git" not in p.parts and p.suffix in (
                ".md", ".conf", ".yaml", ".plugin", ".js", ".py", ".txt", ".json"
            ):
                if frag.encode() in p.read_bytes():
                    hits.append(str(p.relative_to(root)))
        if hits:
            for h in hits:
                fail(f"含真实 Token 片段: {h}")
        else:
            good("文档 / 配置里没有真实 Token 片段")

    print(f"\n结果: {ok} 通过, {len(bad)} 失败, {len(warns)} 警告")
    if warns:
        print("\n警告（不阻塞）:")
        for w in warns:
            print(f"  - {w}")
    if bad:
        print("\n失败项:")
        for b in bad:
            print(f"  - {b}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
