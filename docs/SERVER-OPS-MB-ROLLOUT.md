# 服务器同步操作单:M-B 新版 UI + 12 类分类 + CI 修复上线(2026-08-18)

> 给运维 AI 的执行指令。按编号顺序执行,每步核对"预期输出",不符合预期就停在该步并汇报,不要自行发挥。
> 全程在 `/root/dshregistry` 下操作。预计耗时:10 分钟(不含爬虫全量;数据增量由后续例行同步自动完成)。

## 背景(让你知道在做什么,但不许改动方案)

仓库主干的 `feat/m-a-search-index` 分支已包含:新版搜索主页/分类页/详情页/文档页/周边下载页(五页新 UI)、12 能力域分类(其他类占比从 48% 降到 22%)、hub 数据源切换与去重、CI 修复。**服务器需要:拉取最新 → 验证 → 恢复例行同步**。服务器继续运行在 `feat/m-a-search-index` 分支(工作流规则:服务器运行分支,数据提交落分支)。

## Step 0 · 前置检查(全部通过才继续)

```bash
cd /root/dshregistry
node --version                        # 必须 ≥ v22.19(用 sync.sh 的 /root/.hermes/node/bin 也查一下)
/root/.hermes/node/bin/node --version 2>/dev/null || true
pnpm --version                        # 必须 11.x(不是 9);没有 pnpm 则: npm i -g pnpm@11
gh auth token >/dev/null && echo "gh OK"
git status --short
```

- `git status` 若显示 `web/data/` 或 `web/sitemap.xml` 修改:执行 `git checkout -- web/data web/sitemap.xml`(全是爬虫产物,可丢弃)。
- 若显示本地有未推送提交(ahead):先 `git push origin $(git branch --show-current)`,推不动就停下来汇报。
- 其他文件有修改(如 tools/、web/*.html、package.json):**停下来汇报,不要覆盖**。

## Step 1 · 拉取最新

```bash
cd /root/dshregistry
git fetch origin --prune
git checkout -B feat/m-a-search-index origin/feat/m-a-search-index
git pull --ff-only
git rev-parse --short HEAD            # 预期: 5979a221 或更新
```

## Step 2 · 安装依赖(版本敏感,必须执行)

```bash
cd /root/dshregistry
pnpm install --frozen-lockfile
```

- 预期:无 ERR,结尾 `Done in xxs`。
- **必须用 pnpm 11**(Step 0 已确认);用 9 会报 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`。
- 不会下载浏览器(无 Playwright);看到下载 Chromium 是异常,立即停止汇报。

## Step 3 · 测试验证

```bash
cd /root/dshregistry
node --test
```

- 预期结尾:`# pass 95`、`# fail 0`。
- 失败:贴出失败详情汇报,不要继续。

## Step 4 · 数据一致性校验(重点:12 类分类)

```bash
cd /root/dshregistry
node -e "
const fs=require('fs')
const p=JSON.parse(fs.readFileSync('web/data/plugins.json','utf8'))
const d={};for(const x of p)d[x.category]=(d[x.category]??0)+1
const cats=Object.keys(d)
console.log('插件总数:',p.length,'| 分类数:',cats.length)
console.log('分类:',cats.join('/'))
console.log('其他占比:',Math.round((d.other??0)/p.length*100)+'%')"
```

- 预期:`分类数: 12`、分类含 memory/security/media/integration、`其他占比: ~22%`。
- 若分类数仍为 8(无新四类):执行 `node tools/reclassify.js && node tools/split-data.js`,再重跑本校验。

## Step 5 · 站点冒烟(本地页面)

```bash
cd /root/dshregistry
node tools/dev/dom-smoke.mjs 2>&1 | tail -1
node tools/dev/dom-smoke-category.mjs 2>&1 | tail -1
node tools/dev/dom-smoke-plugin.mjs 2>&1 | tail -1
node tools/dev/dom-smoke-docs.mjs 2>&1 | tail -1
```

- 预期:四行都是 `ALL ... DOM SMOKE TESTS PASSED`。
- 任一 FAIL:贴输出汇报,不要继续。

## Step 6 · 恢复例行同步

```bash
cd /root/dshregistry
crontab -l | grep sync          # 确认定时任务存在(每 6h 增量 + 每天 full)
```

- 若 cron 缺失,恢复(用 `crontab -e` 添加):
  ```
  17 */6 * * * /root/dshregistry/tools/sync.sh >> /var/log/dshregistry/cron.log 2>&1
  23 4 * * * /root/dshregistry/tools/sync.sh full >> /var/log/dshregistry/cron.log 2>&1
  ```
- 不需要手动立即跑 sync(数据已是最新);若要立即验证一次,执行:
  ```bash
  nohup ./tools/sync.sh > /var/log/dshregistry/manual-sync.log 2>&1 &
  tail -f /var/log/dshregistry/manual-sync.log    # 看到"网页源抓取成功"等正常推进即可 Ctrl+C
  ```
- 注意:sync.sh 单轮上限(网页源 ≤400 页)已内置,不会撞节点;hub 数据源已切 api/v1 并聚合去重,首轮会看到 pages.json 的 hub 条目减少(toybox 散件合并)属正常。

## Step 7 · 验收(可选:确认静态服务正常)

```bash
cd /root/dshregistry
ls -la web/docs.html web/stickers.html web/category.html    # 三个新页面文件存在
node -e "console.log('index title:', require('fs').readFileSync('web/index.html','utf8').match(/<title>([^<]*)<\/title>/)?.[1])"
```

- 预期:三个文件存在;index title 为「DSH-Registry · DSH 插件搜索」(或对应英文)。

## Step 8 · 汇报格式(完成后按此回报)

```
分支/HEAD: feat/m-a-search-index @ <hash>
pnpm: <版本>
测试: pass <N> / fail 0
数据校验: 分类数 <N> / 其他占比 <P>%
冒烟: 四套 DOM SMOKE 结果
cron: <存在/已恢复>
异常: 任何 WARN/ERROR 原文(没有就写"无")
```

## 回滚(仅在站长明确要求时执行)

```bash
cd /root/dshregistry
git checkout -B feat/m-a-search-index a67a8ae9    # M-B 合并前的状态(旧 UI + 8 类)
pnpm install --frozen-lockfile
./tools/sync.sh
```

注意:回滚只回退代码;web/data 已被新管道演进(12 类分类),不影响旧管道工作。
