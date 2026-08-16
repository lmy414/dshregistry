#!/bin/bash
# dshregistry 定时同步脚本
# 用法: ./sync.sh [full]
#   full  → 全量重扫（信任更新，每天一次）
#   无参   → 增量抓取（每 6 小时）
# 纪律: 服务器端改动只提交当前分支，不直接推 main（主干只做功能性改动）
set -uo pipefail

REPO_DIR="/root/dshregistry"
LOG_DIR="/var/log/dshregistry"
LOG_FILE="$LOG_DIR/sync.log"

# cron 环境没有交互 PATH，显式设置
export PATH="/root/.hermes/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 失败告警: 发送到飞书 (cron 环境用 hermes send 独立进程)
alert() {
  local msg="$1"
  log "ALERT: $msg"
  export PATH="/root/.hermes/bin:$PATH"
  timeout 30 hermes send --to feishu:"${FEISHU_CHAT_ID:-oc_8b9d4bdf8c49af3d4c1cfd614fddd3cf}" "⚠️ dshregistry 同步告警: $msg" 2>/dev/null \
    || echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT 发送失败: $msg" >> "$LOG_FILE"
}

cd "$REPO_DIR" || { log "ERROR: 无法进入 $REPO_DIR"; exit 1; }

# 当前分支（数据源头=分支，不写死 main）
BRANCH="$(git branch --show-current 2>/dev/null)"
[ -z "$BRANCH" ] && BRANCH="main"
log "=== 开始同步 (模式: ${1:-增量}, 分支: $BRANCH) ==="

# 1) 拉取远端最新（本分支 + 主干，保持同步）
if timeout 180 git fetch origin 2>>"$LOG_FILE"; then
  if timeout 180 git pull --ff-only origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
    log "git pull 成功 (origin/$BRANCH)"
  else
    log "git pull 失败（分支可能落后主干，继续）"
  fi
else
  log "git fetch 失败（继续，可能网络问题）"
fi

# 2) 运行爬虫
export GITHUB_TOKEN="$(gh auth token 2>/dev/null || echo '')"
if [ -z "$GITHUB_TOKEN" ]; then
  alert "无法获取 GITHUB_TOKEN"
  exit 1
fi

CRAWL_OPTS=""
if [ "${1:-}" = "full" ]; then
  CRAWL_OPTS="CRAWL_FULL=1"
  log "全量模式: 信任更新"
fi

if env $CRAWL_OPTS timeout 3500 node tools/crawl.js >> "$LOG_FILE" 2>&1; then
  log "爬虫运行成功"
else
  alert "爬虫运行失败 (exit=$?)"
  exit 1
fi

# 2.5) 重新生成 sitemap（保持详情页静态入口新鲜）
if node tools/gen-sitemap.js >> "$LOG_FILE" 2>&1; then
  log "sitemap 重新生成成功"
else
  log "WARN: sitemap 生成失败（继续）"
fi

# 2.6) 拆分单插件数据（详情页性能优化: 每插件独立 JSON + 分类子集）
if node tools/split-data.js >> "$LOG_FILE" 2>&1; then
  log "单插件数据拆分成功"
else
  log "WARN: 数据拆分失败（继续）"
fi

# 2.7) 预渲染静态页（web/p/ 详情页 + web/c/ 分类页，产物不入库，Caddy 直接服务）
if node tools/prerender.js >> "$LOG_FILE" 2>&1; then
  log "预渲染生成成功"
else
  log "WARN: 预渲染失败（继续）"
fi

# 3) 有变更则提交推送（推当前分支，不直接推主干）
if ! git diff --quiet -- web/data/ web/sitemap.xml; then
  CHANGE_INFO=$(git diff --stat -- web/data/ web/sitemap.xml | tail -1)
  git add web/data/ web/sitemap.xml
  if git -c user.name="hermes-ops" -c user.email="hermes-ops@dshregistry.xyz" \
       commit -m "crawl: ${1:-增量} 同步 $CHANGE_INFO" >> "$LOG_FILE" 2>&1; then
    log "提交成功: $CHANGE_INFO"
    if timeout 180 git push origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
      log "推送成功 (origin/$BRANCH)"
    else
      alert "git push 失败 (origin/$BRANCH)"
      exit 1
    fi
  else
    alert "git commit 失败"
  fi
else
  log "无数据变更，跳过提交"
fi

log "=== 同步完成 ==="
