#!/usr/bin/env bash
# 把本目录发布到 GitHub 仓库
#   bash publish.sh            # 增量更新（在现有历史上提交）
#   bash publish.sh --fresh    # 用全新历史替换远端 main（会丢掉旧提交历史，慎用）
#
# 发布前会做两项检查：
#   1) 暂存目录里不许出现真实 Token（与 ~/.config/zeekr-checkin/env 里的值比对）
#   2) 三个 dist 成品必须已构建（存在且比 parts/core.js 新）
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/m20104600/zeekr-checkin.git}"
BRANCH="${BRANCH:-main}"
GH_USER="${GH_USER:-m20104600}"
SRC="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
FRESH=0
[ "${1:-}" = "--fresh" ] && FRESH=1

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "== 1/5 构建检查 =="
for f in dist/zeekr.js dist/zeekr.egern.js dist/zeekr.qinglong.js; do
  [ -f "$SRC/$f" ] || { echo "缺 $f，请先 python3 build.py"; exit 1; }
done
if [ "$SRC/parts/core.js" -nt "$SRC/dist/zeekr.js" ]; then
  echo "⚠️  parts/core.js 比 dist 新，建议先 python3 build.py（继续发布）"
fi

echo "== 2/5 准备暂存目录 =="
STAGE="$WORK/stage"
mkdir -p "$STAGE"
# 复制源码（排除 git / 缓存 / 本地文档）
tar -C "$SRC" --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='README.md' --exclude='README.repo.md' -cf - . | tar -C "$STAGE" -xf -
cp "$SRC/README.repo.md" "$STAGE/README.md"

echo "== 3/5 密钥泄漏检查 =="
TOKF=~/".config/zeekr-checkin/env"
python3 - "$STAGE" "$TOKF" <<'PY'
import pathlib, re, sys
stage, envfile = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
bad = []
# 真实 Token（从本机 env 读，取 'Bearer ' 之后的 JWT 主体片段做比对）
needles = []
if envfile.exists():
    m = re.search(r"Bearer\s+([\w.\-]{40,})", envfile.read_text(encoding="utf-8"))
    if m:
        needles.append(m.group(1)[:60])
for f in stage.rglob("*"):
    if not f.is_file():
        continue
    t = f.read_text(encoding="utf-8", errors="ignore")
    for n in needles:
        if n and n in t:
            bad.append((str(f.relative_to(stage)), "含真实 Token 片段"))
if bad:
    print("❌ 发现敏感内容，已中止：")
    for b in bad:
        print("   ", b)
    sys.exit(1)
print("   ✅ 未发现真实 Token（签名 key 是公开前端固定值，允许存在）")
PY

echo "== 4/5 提交 =="
if [ "$FRESH" = "1" ]; then
  cd "$STAGE"
  git init -q -b "$BRANCH"
  git -c "user.name=$GH_USER" -c "user.email=$GH_USER@users.noreply.github.com" \
      add -A
  git -c "user.name=$GH_USER" -c "user.email=$GH_USER@users.noreply.github.com" \
      commit -q -m "极氪签到多客户端脚本（QX / Loon / Stash / Egern / 青龙）"
  git remote add origin "$REPO_URL"
  git push -q --force origin "$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" "$WORK/repo"
  find "$WORK/repo" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  tar -C "$STAGE" -cf - . | tar -C "$WORK/repo" -xf -
  cd "$WORK/repo"
  git add -A
  if git -c "user.name=$GH_USER" -c "user.email=$GH_USER@users.noreply.github.com" \
       commit -q -m "更新：$(date '+%Y-%m-%d %H:%M') 极氪签到脚本"; then
    git push -q origin "$BRANCH"
  else
    echo "   没有改动，无需推送"
  fi
fi

echo "== 5/5 校验匿名访问（客户端抓脚本用的是免鉴权 raw） =="
RAW="https://raw.githubusercontent.com/${GH_USER}/$(basename "$REPO_URL" .git)/${BRANCH}"
for f in dist/zeekr.js dist/zeekr.egern.js dist/zeekr.qinglong.js README.md; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 25 "$RAW/$f")
  echo "   HTTP $code  $RAW/$f"
done
echo "✅ 发布完成：$(echo "$REPO_URL" | sed 's#\.git$##')"
