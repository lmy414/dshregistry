# 服务器迁移操作单:M-A 多源搜索引擎上线(2026-08-18)

> 给运维 AI 的执行指令。按编号顺序执行,每步核对"预期输出",不符合预期就停在该步并汇报,不要自行发挥。
> 全程在 `/root/dshregistry` 下操作。预计耗时:准备 10 分钟 + 首轮全量抓取约 2.5 小时(后台跑,不阻塞)。

## 背景(让你知道在做什么,但不许改动方案)

仓库上线了新的多源数据管道(分支 feat/m-a-search-index,已合并入 main)。服务器需要:切换运行分支 → 安装新依赖 → 验证 → 跑一轮同步。三个远程分支(main / feat/m-a-search-index / seo/p0-initial)当前指向同一提交,拉哪个代码都一样,但按工作流服务器必须运行在 feat/m-a-search-index。

## Step 0 · 前置检查(全部通过才继续)

```bash
cd /root/dshregistry
node --version          # 必须 ≥ v22.19;sync.sh 用的是 /root/.hermes/node/bin 里的 node,也查一下:
/root/.hermes/node/bin/node --version 2>/dev/null || true
pnpm --version          # 没有 pnpm 则执行: npm i -g pnpm@9 (再重查)
gh auth token >/dev/null && echo "gh OK"   # 无输出报错则汇报,不要继续
git status --short
```

- `git status` 若显示 `web/data/` 或 `web/sitemap.xml` 有修改:执行 `git checkout -- web/data web/sitemap.xml`(全是爬虫产物,可丢弃)。
- 若显示本地有未推送提交(`git status` 提示 ahead):先 `git push origin $(git branch --show-current)`,推不动就停下来汇报。
- 其他文件(如 tools/、web/*.html)有修改:停下来汇报,不要覆盖。

## Step 1 · 切换分支

```bash
cd /root/dshregistry
git fetch origin --prune
git checkout -B feat/m-a-search-index origin/feat/m-a-search-index
git pull --ff-only
git rev-parse --short HEAD    # 预期: 33857f73 或更新
```

## Step 2 · 安装依赖

```bash
cd /root/dshregistry
pnpm install --frozen-lockfile
```

- 预期:无 ERR,结尾 `Done in xxs`。
- 会新增 crawlee/cheerio 等约 100+ 包;**不会**下载浏览器(无 Playwright),看到下载 Chromium 才是异常,立即停止并汇报。
- 内存占用峰值约 300MB,1G 机器可承受;若 OOM 被杀,加 `--reporter=silent` 重试。

## Step 3 · 测试验证

```bash
cd /root/dshregistry
node --test
```

- 预期结尾:`# pass 52`、`# fail 0`。
- 失败:贴出失败详情汇报,不要继续。

## Step 4 · 快速冒烟(2 分钟,先证明爬虫能跑)

```bash
cd /root/dshregistry
export GITHUB_TOKEN="$(gh auth token)"
DSH_WEB_MAX=10 DSH_WEB_MIN_INTERVAL=2000 node tools/crawl-web.js
```

- 预期末行类似:`[crawl-web] 完成:合并 N 条 listedOn,留存 M 页,反哺候选 K`。
- 失败:贴日志汇报,不要继续。
- 冒烟产生的数据改动保留即可(下一轮全量会覆盖合并,无需还原)。

## Step 5 · 全量首轮(后台,约 2.5 小时)

```bash
cd /root/dshregistry
nohup ./tools/sync.sh > /var/log/dshregistry/manual-ma-first.log 2>&1 &
echo $!   # 记下 PID
tail -f /var/log/dshregistry/manual-ma-first.log   # 看几分钟确认进入"网页源抓取"阶段后可 Ctrl+C 退出 tail(不影响后台任务)
```

- 关键日志行,出现即正常:`[crawl-web] dshfind: 目录 5600+,discover 5600+,refresh 0`。
- 该任务跑完后,cron 的每 6 小时例行同步会自动接管(脚本使用当前分支,无需改 crontab;可用 `crontab -l | grep sync` 确认任务存在)。

## Step 6 · 验收(全量首轮完成后执行)

```bash
cd /root/dshregistry
ls -la web/data/search.json web/data/pages.json web/data/changelog.json web/data/trending.json
node -e "
const fs=require('fs')
const plugins=JSON.parse(fs.readFileSync('web/data/plugins.json','utf8'))
const pages=JSON.parse(fs.readFileSync('web/data/pages.json','utf8'))
const meta=JSON.parse(fs.readFileSync('web/data/meta.json','utf8'))
console.log('插件总数:',plugins.length)
console.log('带 listedOn:',plugins.filter(p=>p.listedOn?.length).length)
console.log('带 external.dshfind 评分:',plugins.filter(p=>p.external?.dshfind?.grade).length)
console.log('pages.json:',pages.pages.length)
console.log('schemaVersion:',meta.schemaVersion)"
```

- 预期:search.json 存在且 <3MB;listedOn 数千级;dshfind 评分数百级;schemaVersion "1.1"。

## Step 7 · 汇报格式(完成后按此回报)

```
分支/HEAD: feat/m-a-search-index @ <hash>
依赖: crawlee <版本> / cheerio <版本>
测试: pass N / fail N
冒烟: <crawl-web 末行输出>
全量: 开始时间 / 结束时间 / 日志中 [crawl-web] 完成行
验收: Step 6 的全部输出
异常: 任何 WARN/ERROR 原文(没有就写"无")
```

## 回滚(仅在站长明确要求时执行)

```bash
cd /root/dshregistry
git checkout -B feat/m-a-search-index 3ff9d08   # M-A 前的状态
./tools/sync.sh
```

注意:回滚只回退代码;web/data 已被新管道演进,不影响旧管道工作。
