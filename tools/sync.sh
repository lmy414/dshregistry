#!/bin/bash
# dshregistry 定时同步脚本
# 用法: ./sync.sh [full]
#   full  → 全量重扫（信任更新，每天一次）
#   无参   → 增量抓取（每 6 小时）
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

cd "$REPO_DIR" || { log "ERROR: 无法进入 $REPO_DIR"; exit 1; }

# 1) 拉取远端最新（flags/seeds/他人 PR）
log "=== 开始同步 (模式: ${1:-增量}) ==="
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  log "git pull 成功"
else
  log "git pull 失败（继续，可能无网络或已最新）"
fi

# 2) 运行爬虫
export GITHUB_TOKEN="$(gh auth token 2>/dev/null || echo '')"
if [ -z "$GITHUB_TOKEN" ]; then
  log "ERROR: 无法获取 GITHUB_TOKEN"
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
  log "ERROR: 爬虫运行失败 (exit=$?)"
  exit 1
fi

# 3) 有变更则提交推送
if ! git diff --quiet -- web/data/; then
  CHANGE_INFO=$(git diff --stat -- web/data/ | tail -1)
  git add web/data/
  if git -c user.name="hermes-ops" -c user.email="hermes-ops@dshregistry.xyz" \
       commit -m "crawl: ${1:-增量} 同步 $CHANGE_INFO" >> "$LOG_FILE" 2>&1; then
    log "提交成功: $CHANGE_INFO"
    if timeout 180 git push origin main >> "$LOG_FILE" 2>&1; then
      log "推送成功"
    else
      log "ERROR: 推送失败"
      exit 1
    fi
  else
    log "提交失败（可能无变更）"
  fi
else
  log "无数据变更，跳过提交"
fi

log "=== 同步完成 ==="
