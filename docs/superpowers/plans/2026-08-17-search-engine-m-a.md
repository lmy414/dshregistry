# M-A 蜘蛛与索引(搜索引擎形态)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/SEARCH-ENGINE-DESIGN.md` 的 M-A:GitHub 自研爬虫扩展双流程(增量 discover + 存量 refresh)+ 网页源适配器(dshfind / DSH Hub)+ 多源标记与反哺 + changelog/trending + 倒排索引 `search.json`。

**Architecture:** 三层拆分。① GitHub 源 = 现有 `tools/crawl.js` 自研保留,接入 refresh planner、404 下架、backfill 候选消费、schema 1.1 增量字段;② 网页源 = Crawlee(CheerioCrawler)抓取,适配器 = discover / extract / normalize 三段纯函数;③ 抓取后管道自研:实体解析(listedOn 合并 / 反哺)、changelog、trending、倒排索引。产物全部是 `web/data/*.json`;爬虫状态全部是 `tools/.cache/`(gitignored)。

**Tech Stack:** Node ^22.19 || >=24、ESM、pnpm;Crawlee 3.18 + Cheerio 1.2(仅网页源);测试 node:test(不引入测试框架)。

## 前置条件(Before you start)

- 工作区现有未提交改动(`docs/SEARCH-ENGINE-DESIGN.md`、`plugin/marketplace.mjs`)与 M-A 无关,先单独提交或 stash,保证每个 Task 的 commit 干净。
- spike 侦察已完成,结论见 Task 2 的 `docs/spike-dshfind.md`(本计划 Task 2 把它落盘)。关键事实:
  - dshfind.com = Next.js SSR,`Allow: /`(禁 /api/、login),sitemap.xml(16.8MB,22756 URL)枚举全部详情页 `/zh/plugins/<owner>/<name>`;
  - 详情页评分锚点 `span[title="综合评分"]`(文本如 `B57`)、徽章文本 `优质项目`/`内测用户`、JSON-LD `SoftwareSourceCode.codeRepository` 含 GitHub 仓库链接、统计卡 `近 7 天增长`(主数字=总 stars,绿色 span=7 天增长);
  - hub.omdsh.dev = 静态站,`catalog.json`(schema `dsh-hub-index/v0.4`,680 包,`packages[].repository` 直接给 GitHub URL);projects.html 为 JS 渲染无每包锚点 → hub 的 listedOn.url 统一用 `https://hub.omdsh.dev/projects.html`;
  - 仓库 lmy414/dshregistry 为**公开仓** → Actions 免费不限时,§8 的"2000 分钟/月"约束不适用。

## Global Constraints

- 零后端:对外产物只写 `web/data/`;爬虫状态只写 `tools/.cache/`(gitignored);不新增常驻进程。
- 出站白名单 HTTPS-only:`api.github.com`、`cdn.jsdelivr.net`、`dshfind.com`、`hub.omdsh.dev`;网页源 UA 统一 `DSHRegistryBot/1.0`。
- robots 遵守:dshfind 不抓 `/api/`、登录页;DSH Hub 只取公开 `catalog.json`,不抓其 HTML 页。
- 网页文档只存元数据 + 摘要(`description` ≤200 字),不复制全文。
- `external.dshfind` 只作展示数据,**不参与** `computeState` 信任判定;`flags.json` 人工覆盖永远优先。
- schemaVersion 1.1 = 记录级 additive 字段(`type`/`source`/`listedOn`/`external`),`plugins.json` 顶层数组结构不变;`schemaVersion` 标在 `meta.json`。
- 包管理 pnpm(仓库有 `pnpm-lock.yaml`);测试 `node --test tools/tests/ plugin/tests/`。
- 注释风格同 `tools/crawl.js`(中文块注释 + 关键行内中文)。
- 每域名限速:dshfind ≥1500ms、hub ≥1000ms(测试可注入更小值);GitHub 沿用现有 search/core 双闸。

## 文件地图

| 文件 | 责任 |
|---|---|
| `tools/lib/http.js` | sleep / makeGate / 白名单断言(工厂)/ makeGhApi / fetchText(带 UA、ETag、304) |
| `tools/lib/crawler.js` | Crawlee 封装:makeDomainGates + createCheerioRunner(独立 Configuration、purgeOnStart:false) |
| `tools/lib/state.js` | 爬取状态读写 + planRefresh(网页源)+ planGithubRefresh(GitHub 源,确定性轮转) |
| `tools/lib/resolve.js` | GitHub 仓库链接解析校验 + resolveDocs(合并/反哺/独立留存)+ mergeListedOn + preserveCrossSource |
| `tools/lib/changelog.js` | changelog 追加与轮转(90 天 / 5000 条) |
| `tools/lib/trending.js` | star 快照 diff → trending Top 20 |
| `tools/lib/search-index.js` | 分词(EN 轻 stem + 中文 bigram + 停用词)+ 倒排构建 + 体积预算断言 |
| `tools/sources/dshfind.js` | dshfind 适配器:parseSitemap / extractDetail / normalize |
| `tools/sources/dshhub.js` | DSH Hub 适配器:parseCatalog / normalizeEntry |
| `tools/crawl-web.js` | 网页源编排:双流程任务集 → Cheerio 抓取 → 归一 → 实体解析 → 产物落盘 |
| `tools/build-search-index.js` | CLI:plugins.json + pages.json → web/data/search.json |
| `tools/crawl.js`(改) | 共享 http 库接入;refresh planner;404 下架;backfill 消费;schema 1.1 字段;changelog/trending 接线 |
| `tools/sync.sh`(改) | 链序:crawl → crawl-web → gen-sitemap → build-search-index → split-data → prerender |
| `package.json`(改) | scripts(crawl:web / index:build / test)+ deps(crawlee、cheerio) |
| `.github/workflows/crawl.yml` | 定时爬虫(每 6h)+ 手动触发 + 缓存 + 产物 commit |
| `tools/tests/*.test.mjs` | 上述各模块单测 + crawl-web 集成测试(本地假站) |
| `docs/spike-dshfind.md` | spike 决策记录(Task 2 落盘) |

## 共享数据契约(跨 Task 接口)

```js
// 归一化网页文档(normalize 产物)
webDoc = {
  type: 'page',                 // 文档类型(插件=plugin,网页=page)
  source: 'dshfind' | 'dshhub',
  url,                          // 源站详情页 URL
  name, author,                 // author 可为 null
  description,                  // ≤200 字
  category: null,               // 网页文档不做分类归一(M-A)
  repoUrl,                      // 提取到的 GitHub 仓库 URL,可为 null
  external: { [source]: {...} } // 源站富数据
}

// plugins.json 记录增量字段(additive,schemaVersion 1.1)
record += {
  type: 'plugin',
  source: 'github-topic' | 'seeds' | `backfill:${from}`,
  listedOn: [{ source, url, firstSeenAt }],   // 可选
  external: { [source]: {...} }               // 可选,仅做了结构化抽取的源
}

// tools/.cache/state-<source>.json
{ version: 1, urls: { [url]: { lastCheckedAt, lastChangedAt, unchangedRounds, hash } } }

// tools/.cache/backfill.json
{ updatedAt, candidates: [{ repo, from, firstSeenAt }] }

// web/data/changelog.json(新条目在前)
{ version: 1, updatedAt, entries: [{ ts, type: 'added'|'updated'|'removed', slug, source }] }

// web/data/trending.json
{ updatedAt, window: '24h', items: [{ slug, name, stars, delta }] }

// web/data/pages.json
{ version: 1, updatedAt, pages: [webDoc] }

// web/data/search.json
{ v: 1, generatedAt, fields: { name: 3, author: 2, tags: 2, desc: 1 },
  docs: [{ slug, type, cat, src, state, stars }], index: { [term]: [[docIdx, score]] } }
```

---

### Task 1: 共享 HTTP 基础库 `tools/lib/http.js`

**Files:**
- Create: `tools/lib/http.js`
- Test: `tools/tests/http.test.mjs`
- Modify: `tools/crawl.js:52-160`(sleep/makeGate/ALLOWED_HOSTS/assertPublicHttps/ghApi 替换为库引用)

**Interfaces:**
- Produces(后续全部 Task 依赖):
  - `sleep(ms)` / `makeGate(minIntervalMs) => () => Promise`
  - `makeAssertAllowed(hosts: Set<string>) => (url) => void`;`assertAllowed` 为默认实例
  - `DEFAULT_ALLOWED_HOSTS = Set(['api.github.com','cdn.jsdelivr.net','dshfind.com','hub.omdsh.dev'])`
  - `makeGhApi(token) => ghApi(url, gate, retries=4)`
  - `CRAWL_UA = 'DSHRegistryBot/1.0'`
  - `fetchText(url, { gate, headers, retries, assert } = {}) => { text, etag, status }`(404/304 时 `text=null`)

- [ ] **Step 1: 写失败测试**

```js
// tools/tests/http.test.mjs
/** 运行: node --test tools/tests/ */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeAssertAllowed, makeGate, fetchText, CRAWL_UA, DEFAULT_ALLOWED_HOSTS } from '../lib/http.js'
import http from 'node:http'

test('makeAssertAllowed: 拒绝 http / 非白名单 / 内网', () => {
  const assertAllowed = makeAssertAllowed(new Set(['example.com']))
  assert.throws(() => assertAllowed('http://example.com/a'), /白名单/)
  assert.throws(() => assertAllowed('https://evil.com/a'), /白名单/)
  assert.throws(() => assertAllowed('https://127.0.0.1/a'), /白名单/)
  assert.doesNotThrow(() => assertAllowed('https://example.com/a'))
})

test('默认白名单含四个源主机', () => {
  for (const h of ['api.github.com', 'cdn.jsdelivr.net', 'dshfind.com', 'hub.omdsh.dev']) {
    assert.ok(DEFAULT_ALLOWED_HOSTS.has(h), h)
  }
})

test('makeGate: 两次放行间隔 ≥ minIntervalMs', async () => {
  const gate = makeGate(60)
  const t0 = Date.now()
  await gate(); await gate()
  assert.ok(Date.now() - t0 >= 55)
})

test('fetchText: 带 UA,404 返回 text=null,ETag 透传', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/gone') { res.writeHead(404); return res.end() }
    assert.equal(req.headers['user-agent'], CRAWL_UA)
    res.writeHead(200, { etag: '"v1"' }); res.end('hello')
  })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  const allowLocal = makeAssertAllowed(new Set(['127.0.0.1']))
  const ok = await fetchText(`${base}/a`, { assert: allowLocal })
  assert.equal(ok.text, 'hello'); assert.equal(ok.etag, '"v1"')
  const gone = await fetchText(`${base}/gone`, { assert: allowLocal })
  assert.equal(gone.text, null); assert.equal(gone.status, 404)
  server.close()
})
```

注意:测试用 `http://` 本地服务器,因此 `makeAssertAllowed` 工厂必须只校验"协议 https 或显式注入的主机"——实现上当 hosts 含 `127.0.0.1` 时允许 http(仅测试注入路径);生产默认集合纯 https 主机,http URL 永远被拒。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/http.test.mjs`
Expected: FAIL,`Cannot find module '../lib/http.js'`

- [ ] **Step 3: 实现 `tools/lib/http.js`**

```js
/** 共享 HTTP 基础库:限速门 / 出站白名单 / GitHub API / 通用文本抓取。 */
export const CRAWL_UA = 'DSHRegistryBot/1.0'
export const DEFAULT_ALLOWED_HOSTS = new Set([
  'api.github.com', 'cdn.jsdelivr.net', 'dshfind.com', 'hub.omdsh.dev',
])

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 出站请求白名单(SSRF 防护):https + 固定主机;注入 127.0.0.1 时放行 http(仅测试)。 */
export function makeAssertAllowed(hosts = DEFAULT_ALLOWED_HOSTS) {
  return function assertAllowed(url) {
    const u = new URL(url)
    const isLocalTest = u.hostname === '127.0.0.1' && hosts.has('127.0.0.1')
    if (!hosts.has(u.hostname) || (u.protocol !== 'https:' && !isLocalTest)) {
      throw new Error(`[http] 禁止抓取非白名单地址: ${url}`)
    }
  }
}
export const assertAllowed = makeAssertAllowed()

/** 速率门:同一闸口内两次放行至少间隔 minIntervalMs。 */
export function makeGate(minIntervalMs) {
  let last = 0
  let chain = Promise.resolve()
  return () => {
    chain = chain.then(async () => {
      const wait = Math.max(0, last + minIntervalMs - Date.now())
      if (wait > 0) await sleep(wait)
      last = Date.now()
    })
    return chain
  }
}

/** GitHub REST:限速 + 403/429 按 X-RateLimit-Reset 退避 + 网络故障重试;404 返回 null。 */
export function makeGhApi(token) {
  return async function ghApi(url, gate, retries = 4) {
    assertAllowed(url)
    for (let attempt = 0; ; attempt++) {
      await gate()
      let res
      try {
        res = await fetch(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
      } catch (error) {
        if (attempt < retries) { await sleep(3000 * (attempt + 1)); continue }
        throw error
      }
      if (res.ok) return res.json()
      const remaining = res.headers.get('x-ratelimit-remaining')
      if ((res.status === 403 || res.status === 429) && attempt < retries) {
        const resetAt = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000
        const wait = remaining === '0' && resetAt > Date.now() ? resetAt - Date.now() + 1000 : 5000 * (attempt + 1)
        await sleep(wait)
        continue
      }
      if (res.status === 404) return null
      throw new Error(`GitHub API ${res.status}: ${url}`)
    }
  }
}

/** 通用文本抓取(网页源):UA + ETag 透传 + 条件请求;404/304 返回 text=null。 */
export async function fetchText(url, { gate, headers = {}, retries = 3, assert: assertFn = assertAllowed } = {}) {
  assertFn(url)
  for (let attempt = 0; ; attempt++) {
    if (gate) await gate()
    let res
    try {
      res = await fetch(url, { headers: { 'User-Agent': CRAWL_UA, ...headers }, redirect: 'follow' })
    } catch (error) {
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue }
      throw error
    }
    if (res.status === 304) return { text: null, etag: null, status: 304 }
    if (res.ok) return { text: await res.text(), etag: res.headers.get('etag'), status: res.status }
    if (res.status === 404) return { text: null, etag: null, status: 404 }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(3000 * (attempt + 1)); continue }
    throw new Error(`fetchText ${res.status}: ${url}`)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/http.test.mjs`
Expected: PASS(4 tests)

- [ ] **Step 5: `tools/crawl.js` 切换到库**

- 删除 crawl.js 本地的 `sleep`、`makeGate`、`ALLOWED_HOSTS`、`assertPublicHttps`、`ghApi` 定义;
- 顶部 import:`import { sleep, makeGate, assertAllowed, makeGhApi } from './lib/http.js'`;
- `const TOKEN = getToken()` 之后加 `const ghApi = makeGhApi(TOKEN)`;
- `rawFetch` 内的 `assertPublicHttps(url)` 改为 `assertAllowed(url)`(rawFetch 保留在 crawl.js,jsDelivr 取文件是 GitHub 源专属);
- `searchGate` / `coreGate` 定义保留(改引用库里 makeGate)。

- [ ] **Step 6: 回归验证**

Run: `node --check tools/crawl.js && CRAWL_MAX=2 node tools/crawl.js`
Expected: 冒烟通过,索引产物与改动前一致(`git diff web/data/plugins.json` 应无实质差异,仅 updatedAt/统计可能变化)

- [ ] **Step 7: Commit**

```bash
git add tools/lib/http.js tools/tests/http.test.mjs tools/crawl.js
git commit -m "refactor: 抽取共享 HTTP 基础库 tools/lib/http.js(白名单/限速/ghApi/fetchText)"
```

---

### Task 2: Crawlee 底座 + spike 决策记录

**Files:**
- Create: `tools/lib/crawler.js`
- Test: `tools/tests/crawler.test.mjs`
- Create: `docs/spike-dshfind.md`
- Modify: `package.json`(deps + test script)

**Interfaces:**
- Consumes: `makeGate`(`tools/lib/http.js`)
- Produces:
  - `makeDomainGates(minIntervalMs) => (url) => gate`
  - `createCheerioRunner({ storageDir, minIntervalMs, maxConcurrency, requestHandler, failedRequestHandler }) => CheerioCrawler`

- [ ] **Step 1: 安装依赖**

```bash
pnpm add crawlee@^3.18.1 cheerio@^1.2.0
```

`package.json` scripts 同步加:`"test": "node --test plugin/tests/ tools/tests/"`。不安装 Playwright——两个网页源均为 SSR/JSON,未来出现 SPA 源时再以 `pnpm add -D playwright` 接入(决策记录写明)。

- [ ] **Step 2: 写失败测试(本地假站,不打外网)**

```js
// tools/tests/crawler.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCheerioRunner } from '../lib/crawler.js'

async function fakeSite(pages) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, at: Date.now() })
    if (!pages[req.url]) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(pages[req.url])
  })
  await new Promise((r) => server.listen(0, r))
  return { server, hits, base: `http://127.0.0.1:${server.address().port}` }
}

test('断点续跑:同 storageDir 重跑,已成功 URL 不重复抓取', async () => {
  const { server, hits, base } = await fakeSite({ '/a': '<h1>a</h1>', '/b': '<h1>b</h1>' })
  const dir = await mkdtemp(join(tmpdir(), 'crawlee-'))
  const urls = [`${base}/a`, `${base}/b`]
  const seen1 = []
  const c1 = createCheerioRunner({ storageDir: dir, minIntervalMs: 0, requestHandler: async ({ request }) => { seen1.push(request.url) } })
  await c1.run(urls)
  assert.deepEqual(seen1.sort(), urls.sort())
  const seen2 = []
  const c2 = createCheerioRunner({ storageDir: dir, minIntervalMs: 0, requestHandler: async ({ request }) => { seen2.push(request.url) } })
  await c2.run(urls)
  assert.equal(seen2.length, 0, '第二轮不应重复抓取')
  server.close(); await rm(dir, { recursive: true, force: true })
})

test('per-domain 限速:同域两次请求间隔 ≥ minIntervalMs', async () => {
  const { server, hits, base } = await fakeSite({ '/a': '<h1>a</h1>', '/b': '<h1>b</h1>' })
  const dir = await mkdtemp(join(tmpdir(), 'crawlee-'))
  const c = createCheerioRunner({ storageDir: dir, minIntervalMs: 120, maxConcurrency: 4, requestHandler: async () => {} })
  await c.run([`${base}/a`, `${base}/b`])
  assert.ok(hits[1].at - hits[0].at >= 110, `间隔 ${hits[1].at - hits[0].at}ms`)
  server.close(); await rm(dir, { recursive: true, force: true })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test tools/tests/crawler.test.mjs`
Expected: FAIL,`Cannot find module '../lib/crawler.js'`

- [ ] **Step 4: 实现 `tools/lib/crawler.js`**

```js
/** Crawlee 底座:per-domain 限速(Crawlee 无内置,makeGate 包装)+ 断点续跑(独立持久化存储)。 */
import { CheerioCrawler, Configuration } from 'crawlee'
import { makeGate } from './http.js'

/** 每域名一个速率门:同域两次请求处理至少间隔 minIntervalMs。 */
export function makeDomainGates(minIntervalMs) {
  const gates = new Map()
  return (url) => {
    const host = new URL(url).hostname
    if (!gates.has(host)) gates.set(host, makeGate(minIntervalMs))
    return gates.get(host)
  }
}

/** 创建 Cheerio 爬虫。storageDir 必须调用方指定(测试=临时目录,生产=tools/.cache/crawlee-<source>);
 *  purgeOnStart:false + persistStorage:true 保证重跑时已成功 URL 被队列跳过(断点续跑)。 */
export function createCheerioRunner({ storageDir, minIntervalMs = 1500, maxConcurrency = 4, requestHandler, failedRequestHandler }) {
  const gateFor = makeDomainGates(minIntervalMs)
  const config = new Configuration({ storageDir, persistStorage: true, purgeOnStart: false })
  return new CheerioCrawler({
    maxConcurrency,
    maxRequestRetries: 2,
    async requestHandler(context) {
      await gateFor(context.request.url)()
      await requestHandler(context)
    },
    failedRequestHandler,
  }, config)
}
```

注意:Crawlee v3 构造函数第二参为 `Configuration` 实例;不传则多个 crawler 共享全局存储,断点去重测试会互相污染。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tools/tests/crawler.test.mjs`
Expected: PASS(2 tests)

- [ ] **Step 6: 落盘 spike 决策记录 `docs/spike-dshfind.md`**

```markdown
# Spike 决策记录:网页源抓取形态(2026-08-17)

> 结论先行:两个网页源都不需要浏览器渲染。M-A 网页抓取层 = CheerioCrawler;Playwright 不安装,留给未来 SPA 源。

## 侦察事实(均实测)

| 问题 | 结论 | 证据 |
|---|---|---|
| dshfind SSR 还是 SPA | **SSR**(Next.js) | 详情页 HTML 含完整评分/徽章/JSON-LD,101KB 直出 |
| dshfind 全量 URL 枚举 | **sitemap.xml**(16.8MB,22756 URL) | robots.txt 声明 Sitemap;详情页模式 `/zh/plugins/<owner>/<name>` |
| dshfind robots | `Allow: /`,禁 `/api/`、`/*/login`、`/*/unauthorized` | robots.txt 原文 |
| dshfind 评分锚点 | `span[title="综合评分"]` 文本如 `B57` | 详情页实测 |
| dshfind 实体解析 | JSON-LD `SoftwareSourceCode.codeRepository` | 详情页内嵌 JSON-LD |
| dshfind 统计卡 | `近 7 天增长` 卡:主数字=总 stars,绿色 span=7 天增长 | 详情页实测(语义待首轮真站核对) |
| DSH Hub 形态 | 静态站 + **catalog.json**(schema `dsh-hub-index/v0.4`,680 包) | 首页直接链接;`packages[].repository` 给 GitHub URL |
| Hub 每包页面锚点 | 无(projects.html 为 JS 渲染容器) | 静态 HTML 无 per-package 锚点 → listedOn.url 统一用 projects.html |
| Crawlee 断点续跑 | 同 storageDir 重跑,已成功 URL 不重复抓取 | tools/tests/crawler.test.mjs |
| per-domain 限速 | Crawlee 无内置,makeGate 包装生效 | 同上 |
| Actions 配额 | 公开仓免费不限时(2000 分钟/月限制仅私有仓) | api.github.com/repos/lmy414/dshregistry `"private": false` |

## 决策

1. dshfind 适配器 = sitemap 发现 + Cheerio 详情抽取;DSH Hub 适配器 = catalog.json 纯 JSON(不经 Crawlee)。
2. Playwright 不安装;新 SPA 源接入时再议。
3. 爬虫主执行地 = GitHub Actions(workflow 见 Task 11);服务器 sync.sh 保留为回退。
```

- [ ] **Step 7: Commit**

```bash
git add tools/lib/crawler.js tools/tests/crawler.test.mjs docs/spike-dshfind.md package.json pnpm-lock.yaml
git commit -m "feat: Crawlee 底座(per-domain 限速 + 断点续跑)+ spike 决策记录"
```

---

### Task 3: 爬取状态库 `tools/lib/state.js`

**Files:**
- Create: `tools/lib/state.js`
- Test: `tools/tests/state.test.mjs`

**Interfaces:**
- Consumes: 无(纯函数 + fs)
- Produces:
  - `loadState(file) => { version: 1, urls: {} }`(缺文件给空态)
  - `saveState(file, state)`(原子写)
  - `noteChecked(state, url, { now, changed, hash }) => state`(原地改并返回)
  - `planRefresh(state, urls, { now, maxAgeMs, budget }) => string[]`
  - `planGithubRefresh(plugins, { now, budget, activeWindowDays, round }) => string[]`(repo fullName 列表)

- [ ] **Step 1: 写失败测试**

```js
// tools/tests/state.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteChecked, planRefresh, planGithubRefresh } from '../lib/state.js'

const NOW = Date.parse('2026-08-17T00:00:00Z')
const DAY = 86400000

test('noteChecked: 变化复位 unchangedRounds,未变递增', () => {
  const s = { version: 1, urls: {} }
  noteChecked(s, 'u1', { now: NOW, changed: true, hash: 'h1' })
  noteChecked(s, 'u1', { now: NOW + DAY, changed: false, hash: 'h1' })
  noteChecked(s, 'u1', { now: NOW + 2 * DAY, changed: true, hash: 'h2' })
  assert.deepEqual(s.urls.u1, { lastCheckedAt: NOW + 2 * DAY, lastChangedAt: NOW + 2 * DAY, unchangedRounds: 0, hash: 'h2' })
})

test('planRefresh: 未查过优先,其后最旧优先;新鲜跳过;预算截断', () => {
  const s = { version: 1, urls: {
    fresh: { lastCheckedAt: NOW - DAY, lastChangedAt: NOW - DAY, unchangedRounds: 1 },
    old:   { lastCheckedAt: NOW - 30 * DAY, lastChangedAt: NOW - 30 * DAY, unchangedRounds: 3 },
  } }
  const due = planRefresh(s, ['fresh', 'old', 'never'], { now: NOW, maxAgeMs: 7 * DAY, budget: 10 })
  assert.deepEqual(due, ['never', 'old'])
  const capped = planRefresh(s, ['old', 'never'], { now: NOW, maxAgeMs: 7 * DAY, budget: 1 })
  assert.deepEqual(capped, ['never'])
})

test('planGithubRefresh: 活跃窗口全选,长尾确定性轮转,预算上限', () => {
  const plugins = [
    { repo: 'o/active1', pushedAt: '2026-08-10' },
    { repo: 'o/active2', pushedAt: '2026-07-01' },
    ...Array.from({ length: 20 }, (_, i) => ({ repo: `o/tail${String(i).padStart(2, '0')}`, pushedAt: '2025-01-01' })),
  ]
  const args = { now: NOW, budget: 8, activeWindowDays: 90, round: 0 }
  const r0 = planGithubRefresh(plugins, args)
  assert.ok(r0.includes('o/active1') && r0.includes('o/active2'))
  assert.equal(r0.length, 8)
  assert.deepEqual(planGithubRefresh(plugins, args), r0, '同 round 结果必须确定')
  assert.notDeepEqual(planGithubRefresh(plugins, { ...args, round: 1 }), r0, '不同 round 轮转不同切片')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/state.test.mjs`
Expected: FAIL,`Cannot find module '../lib/state.js'`

- [ ] **Step 3: 实现 `tools/lib/state.js`**

```js
/** 爬取状态层:网页源按 URL 记 lastCheckedAt/lastChangedAt/unchangedRounds;refresh planner 算到期任务。 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DAY = 86400000

export async function loadState(file) {
  return JSON.parse(await readFile(file, 'utf8').catch(() => '{"version":1,"urls":{}}'))
}

export async function saveState(file, state) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(state), 'utf8')
  await rename(tmp, file)
}

/** 记录一次抓取结果:changed 复位 unchangedRounds 并更新 lastChangedAt;未变递增。 */
export function noteChecked(state, url, { now, changed, hash }) {
  const prev = state.urls[url]
  state.urls[url] = {
    lastCheckedAt: now,
    lastChangedAt: changed || !prev ? now : prev.lastChangedAt,
    unchangedRounds: changed || !prev ? 0 : prev.unchangedRounds + 1,
    hash,
  }
  return state
}

/** 到期任务:从未查过优先,其后按 lastCheckedAt 升序;maxAgeMs 内新鲜跳过;预算截断。 */
export function planRefresh(state, urls, { now, maxAgeMs, budget }) {
  const never = [], stale = []
  for (const url of urls) {
    const u = state.urls[url]
    if (!u) never.push(url)
    else if (now - u.lastCheckedAt >= maxAgeMs) stale.push(url)
  }
  stale.sort((a, b) => state.urls[a].lastCheckedAt - state.urls[b].lastCheckedAt)
  return [...never, ...stale].slice(0, budget)
}

/** GitHub 存量刷新:活跃窗口(pushedAt ≤ activeWindowDays)全选,长尾按 round 确定性轮转补齐预算。
 *  确定性:排序 + stride 轮转,不依赖随机数,便于测试与复跑。 */
export function planGithubRefresh(plugins, { now, budget = 500, activeWindowDays = 90, round = 0 }) {
  const active = [], tail = []
  for (const p of plugins) {
    (now - new Date(p.pushedAt).getTime() <= activeWindowDays * DAY ? active : tail).push(p.repo)
  }
  active.sort(); tail.sort()
  const picked = active.slice(0, budget)
  const rest = budget - picked.length
  if (rest > 0 && tail.length > 0) {
    const stride = Math.max(1, Math.floor(tail.length / rest))
    for (let i = 0; i < tail.length && picked.length < budget; i++) {
      if ((i + round) % stride === 0) picked.push(tail[i])
    }
  }
  return picked.sort()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/state.test.mjs`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/lib/state.js tools/tests/state.test.mjs
git commit -m "feat: 爬取状态库(noteChecked/planRefresh/planGithubRefresh 确定性轮转)"
```

---

### Task 4: dshfind 适配器 `tools/sources/dshfind.js`

**Files:**
- Create: `tools/sources/dshfind.js`
- Test: `tools/tests/dshfind.test.mjs`
- Create: `tools/tests/fixtures/dshfind-detail.html`

**Interfaces:**
- Consumes: `cheerio`
- Produces(Task 7 依赖):
  - `SOURCE = 'dshfind'`
  - `SITEMAP_URL = 'https://dshfind.com/sitemap.xml'`
  - `parseSitemap(xml) => string[]`(仅 `/zh/plugins/<owner>/<name>`,去重排序)
  - `extractDetail(html, url) => rawDoc`
  - `normalize(raw) => webDoc`(契约见文件地图)

- [ ] **Step 1: 写合成 fixture + 失败测试**

fixture 用合成最小 HTML,锚点与真站一致(不复制真站内容):

```html
<!-- tools/tests/fixtures/dshfind-detail.html -->
<html><body>
<h1 class="font-mono">acme-vision<span title="综合评分">B<span class="opacity-80">57</span></span></h1>
<span>✨ 优质项目</span><span>内测用户</span>
<div><div class="mt-1 text-xl font-bold tabular-nums">128<span class="text-emerald-600">+<!-- -->12</span></div>
<div class="text-[11px] text-muted-foreground">近 7 天增长</div></div>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareSourceCode",
"name":"acme-vision","description":"视觉识别工具包,支持 OCR 与截图理解。",
"codeRepository":"https://github.com/Acme/acme-vision"}</script>
</body></html>
```

```js
// tools/tests/dshfind.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSitemap, extractDetail, normalize } from '../sources/dshfind.js'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dshfind-detail.html')

test('parseSitemap: 只取 /zh/plugins/<owner>/<name>,去重排序', () => {
  const xml = `<urlset>
    <url><loc>https://dshfind.com/zh/plugins/Acme/acme-vision</loc></url>
    <url><loc>https://dshfind.com/en/plugins/Acme/acme-vision</loc></url>
    <url><loc>https://dshfind.com/zh/plugins/Bob/bob-tool</loc></url>
    <url><loc>https://dshfind.com/zh/learn</loc></url>
    <url><loc>https://dshfind.com/zh/login</loc></url>
  </urlset>`
  assert.deepEqual(parseSitemap(xml), [
    'https://dshfind.com/zh/plugins/Acme/acme-vision',
    'https://dshfind.com/zh/plugins/Bob/bob-tool',
  ])
})

test('extractDetail: 评分/徽章/增长/仓库/描述', async () => {
  const html = await readFile(FIX, 'utf8')
  const raw = extractDetail(html, 'https://dshfind.com/zh/plugins/Acme/acme-vision')
  assert.equal(raw.name, 'acme-vision')
  assert.equal(raw.author, 'Acme')
  assert.deepEqual(raw.score, { grade: 'B', score: 57 })
  assert.deepEqual(raw.badges.sort(), ['featured', 'insider'])
  assert.deepEqual(raw.growth, { stars: 128, weeklyGrowth: 12 })
  assert.equal(raw.repoUrl, 'https://github.com/Acme/acme-vision')
  assert.ok(raw.description.includes('视觉识别'))
})

test('normalize: 网页文档契约,描述 ≤200 字', async () => {
  const html = await readFile(FIX, 'utf8')
  const doc = normalize(extractDetail(html, 'https://dshfind.com/zh/plugins/Acme/acme-vision'))
  assert.equal(doc.type, 'page'); assert.equal(doc.source, 'dshfind')
  assert.ok(doc.description.length <= 200)
  assert.deepEqual(doc.external.dshfind, { grade: 'B', score: 57, badges: ['featured', 'insider'], stars: 128, weeklyGrowth: 12 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/dshfind.test.mjs`
Expected: FAIL,`Cannot find module '../sources/dshfind.js'`

- [ ] **Step 3: 实现 `tools/sources/dshfind.js`**

```js
/** dshfind 适配器:sitemap 发现 → Cheerio 详情抽取 → 归一化网页文档。
 *  锚点(2026-08-17 实测):评分 span[title="综合评分"];徽章文本 优质项目/内测用户;
 *  统计卡"近 7 天增长"(主数字=总 stars,绿色 span=7 天增长);JSON-LD codeRepository。 */
import * as cheerio from 'cheerio'

export const SOURCE = 'dshfind'
export const SITEMAP_URL = 'https://dshfind.com/sitemap.xml'
const DETAIL_RE = /^https:\/\/dshfind\.com\/zh\/plugins\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** sitemap → 详情页 URL 集(仅中文主 locale,去重排序)。 */
export function parseSitemap(xml) {
  const urls = new Set()
  for (const m of xml.matchAll(/<loc>(https:\/\/dshfind\.com\/zh\/plugins\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)<\/loc>/g)) {
    if (DETAIL_RE.test(m[1])) urls.add(m[1])
  }
  return [...urls].sort()
}

/** 详情页 HTML → 源站原始文档。字段缺失给 null/空,不抛(单页失败不拖垮整轮)。 */
export function extractDetail(html, url) {
  const $ = cheerio.load(html)
  const seg = url.split('/')
  let ld = null
  $('script[type="application/ld+json"]').each((_, el) => {
    try { const j = JSON.parse($(el).text()); if (j?.codeRepository) ld = j } catch { /* 忽略坏 JSON */ }
  })
  const scoreEl = $(`span[title="综合评分"]`).first()
  const grade = scoreEl.contents().filter((_, n) => n.type === 'text').text().trim() || null
  const scoreNum = Number(scoreEl.find('span').first().text().trim()) || null
  const badges = []
  $('span').each((_, el) => {
    const t = $(el).text()
    if (t.includes('优质项目')) badges.push('featured')
    if (t.includes('内测用户')) badges.push('insider')
  })
  const growthLabel = $('div').filter((_, el) => $(el).text().trim() === '近 7 天增长').first()
  const growthVal = growthLabel.prev('div')
  const stars = Number(growthVal.contents().filter((_, n) => n.type === 'text').text().trim()) || null
  const weeklyGrowth = Number(growthVal.find('span').first().text().replace('+', '').trim()) || null
  return {
    url,
    name: ld?.name ?? seg[seg.length - 1] ?? null,
    author: seg[seg.length - 2] ?? null,
    description: (ld?.description ?? '').slice(0, 200),
    score: grade || scoreNum !== null ? { grade, score: scoreNum } : null,
    badges: [...new Set(badges)],
    growth: { stars, weeklyGrowth },
    repoUrl: ld?.codeRepository ?? null,
  }
}

/** 原始文档 → 归一化网页文档(external.dshfind 只作展示,不进信任判定)。 */
export function normalize(raw) {
  return {
    type: 'page',
    source: SOURCE,
    url: raw.url,
    name: raw.name,
    author: raw.author,
    description: (raw.description ?? '').slice(0, 200),
    category: null,
    repoUrl: raw.repoUrl,
    external: {
      dshfind: {
        grade: raw.score?.grade ?? null,
        score: raw.score?.score ?? null,
        badges: raw.badges,
        stars: raw.growth.stars,
        weeklyGrowth: raw.growth.weeklyGrowth,
      },
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/dshfind.test.mjs`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/sources/dshfind.js tools/tests/dshfind.test.mjs tools/tests/fixtures/dshfind-detail.html
git commit -m "feat: dshfind 适配器(sitemap 发现 + 评分/徽章/增长结构化抽取)"
```

---

### Task 5: DSH Hub 适配器 `tools/sources/dshhub.js`

**Files:**
- Create: `tools/sources/dshhub.js`
- Test: `tools/tests/dshhub.test.mjs`

**Interfaces:**
- Produces(Task 7 依赖):
  - `SOURCE = 'dshhub'`
  - `CATALOG_URL = 'https://hub.omdsh.dev/catalog.json'`
  - `LISTING_URL = 'https://hub.omdsh.dev/projects.html'`(无每包锚点,listedOn.url 统一用此)
  - `parseCatalog(jsonText) => entries[]`
  - `normalizeEntry(entry) => webDoc`

- [ ] **Step 1: 写失败测试**

```js
// tools/tests/dshhub.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCatalog, normalizeEntry } from '../sources/dshhub.js'

const SAMPLE = JSON.stringify({
  schema: 'dsh-hub-index/v0.4',
  packages: [
    { id: 'acme-vision', name: 'ACME 视觉', description: 'OCR 与截图理解', kind: 'ui', category: 'interface',
      tags: ['ocr'], author: { name: 'Acme', url: 'https://github.com/Acme' },
      repository: 'https://github.com/omdsh-dev/acme-vision', ref: 'abc123', updatedAt: '2026-08-13T20:55:45+08:00',
      version: '0.4.0', license: 'MIT', status: 'beta', featured: true, compatibility: '已验证' },
    { id: 'no-repo', name: '无仓库条目', description: '边界样本' },
  ],
})

test('parseCatalog: 取 packages 数组', () => {
  assert.equal(parseCatalog(SAMPLE).length, 2)
})

test('normalizeEntry: 契约 + 缺字段容忍', () => {
  const [a, b] = parseCatalog(SAMPLE).map(normalizeEntry)
  assert.equal(a.type, 'page'); assert.equal(a.source, 'dshhub')
  assert.equal(a.repoUrl, 'https://github.com/omdsh-dev/acme-vision')
  assert.equal(a.author, 'Acme')
  assert.equal(a.external.dshhub.featured, true)
  assert.equal(a.external.dshhub.status, 'beta')
  assert.equal(b.repoUrl, null); assert.equal(b.author, null)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/dshhub.test.mjs`
Expected: FAIL,`Cannot find module '../sources/dshhub.js'`

- [ ] **Step 3: 实现 `tools/sources/dshhub.js`**

```js
/** DSH Hub 适配器:catalog.json(schema dsh-hub-index/v0.4)纯 JSON,不经 Crawlee。
 *  无每包页面锚点(projects.html 为 JS 容器),listedOn.url 统一用 LISTING_URL。 */
export const SOURCE = 'dshhub'
export const CATALOG_URL = 'https://hub.omdsh.dev/catalog.json'
export const LISTING_URL = 'https://hub.omdsh.dev/projects.html'

/** catalog.json 文本 → 包条目数组;schema 不符抛错(上游结构变更要吵不要默)。 */
export function parseCatalog(jsonText) {
  const data = JSON.parse(jsonText)
  if (!Array.isArray(data.packages)) throw new Error(`[dshhub] catalog schema 变更,无 packages 数组: ${data.schema}`)
  return data.packages
}

/** 包条目 → 归一化网页文档。 */
export function normalizeEntry(e) {
  return {
    type: 'page',
    source: SOURCE,
    url: LISTING_URL,
    name: e.name ?? e.id ?? null,
    author: e.author?.name ?? null,
    description: (e.description ?? '').slice(0, 200),
    category: null,
    repoUrl: typeof e.repository === 'string' && e.repository.includes('github.com') ? e.repository : null,
    external: {
      dshhub: {
        id: e.id ?? null, kind: e.kind ?? null, category: e.category ?? null,
        tags: Array.isArray(e.tags) ? e.tags : [],
        status: e.status ?? null, featured: e.featured === true,
        version: e.version ?? null, license: e.license ?? null,
        updatedAt: e.updatedAt ?? null, compatibility: e.compatibility ?? null,
      },
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/dshhub.test.mjs`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/sources/dshhub.js tools/tests/dshhub.test.mjs
git commit -m "feat: DSH Hub 适配器(catalog.json 纯 JSON 消费)"
```

---

### Task 6: 实体解析与合并 `tools/lib/resolve.js`

**Files:**
- Create: `tools/lib/resolve.js`
- Test: `tools/tests/resolve.test.mjs`

**Interfaces:**
- Consumes: webDoc(Task 4/5)
- Produces(Task 7/8 依赖):
  - `parseGithubRepoUrl(url) => { owner, repo, fullName } | null`(fullName 保原始大小写)
  - `keyOf(fullName) => string`(小写比较键)
  - `resolveDocs(webDocs, knownRepoKeys: Set, { backfillCap, now }) => { merges, backfills, pages }`
    - `merges: [{ repoKey, entry: { source, url, firstSeenAt }, external: { [source]: {...} } }]`
    - `backfills: [{ repo, from, firstSeenAt }]`(按 repo 去重,封顶 backfillCap)
  - `mergeListedOn(plugins, merges, { now }) => { plugins, mergedCount }`(返回新数组,幂等)
  - `preserveCrossSource(oldRec, newRec) => newRec`(Task 8 用:fresh 替换 old 时保留 listedOn/external)

- [ ] **Step 1: 写失败测试**

```js
// tools/tests/resolve.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGithubRepoUrl, keyOf, resolveDocs, mergeListedOn, preserveCrossSource } from '../lib/resolve.js'

test('parseGithubRepoUrl: 子路径裁剪 / .git / 保留段 / 非 github', () => {
  assert.deepEqual(parseGithubRepoUrl('https://github.com/Acme/Vision/issues/3'), { owner: 'Acme', repo: 'Vision', fullName: 'Acme/Vision' })
  assert.deepEqual(parseGithubRepoUrl('https://github.com/Acme/vision.git'), { owner: 'Acme', repo: 'vision', fullName: 'Acme/vision' })
  assert.equal(parseGithubRepoUrl('https://github.com/orgs/omdsh-dev/repositories'), null)
  assert.equal(parseGithubRepoUrl('https://github.com/features'), null)
  assert.equal(parseGithubRepoUrl('https://gitlab.com/Acme/vision'), null)
  assert.equal(parseGithubRepoUrl('not-a-url'), null)
})

test('resolveDocs: 命中合并 / 未命中反哺且留存 / 无仓库独立留存', () => {
  const docs = [
    { type: 'page', source: 'dshfind', url: 'https://dshfind.com/zh/plugins/A/x', name: 'x', author: 'A', description: '', repoUrl: 'https://github.com/A/x', external: { dshfind: { score: 88 } } },
    { type: 'page', source: 'dshfind', url: 'https://dshfind.com/zh/plugins/B/y', name: 'y', author: 'B', description: '', repoUrl: 'https://github.com/B/y', external: { dshfind: { score: 70 } } },
    { type: 'page', source: 'dshhub', url: 'https://hub.omdsh.dev/projects.html', name: 'z', author: null, description: '', repoUrl: null, external: { dshhub: {} } },
  ]
  const { merges, backfills, pages } = resolveDocs(docs, new Set(['a/x']), { backfillCap: 10, now: '2026-08-17' })
  assert.equal(merges.length, 1); assert.equal(merges[0].repoKey, 'a/x')
  assert.deepEqual(merges[0].entry, { source: 'dshfind', url: docs[0].url, firstSeenAt: '2026-08-17' })
  assert.equal(backfills.length, 1); assert.equal(backfills[0].repo, 'B/y'); assert.equal(backfills[0].from, 'dshfind')
  assert.equal(pages.length, 2, '未命中与无仓库文档都独立留存')
})

test('mergeListedOn: 幂等 + 跨源 external 保留', () => {
  const plugins = [{ slug: 'x', repo: 'A/x' }]
  const m1 = [{ repoKey: 'a/x', entry: { source: 'dshfind', url: 'u1', firstSeenAt: '2026-08-17' }, external: { dshfind: { score: 88 } } }]
  const r1 = mergeListedOn(plugins, m1, { now: '2026-08-17' })
  assert.equal(r1.mergedCount, 1)
  assert.equal(r1.plugins[0].listedOn.length, 1)
  const r2 = mergeListedOn(r1.plugins, m1, { now: '2026-08-18' })
  assert.equal(r2.mergedCount, 0, '同 source 重复合并应幂等')
  const m2 = [{ repoKey: 'a/x', entry: { source: 'dshhub', url: 'u2', firstSeenAt: '2026-08-18' }, external: { dshhub: { featured: true } } }]
  const r3 = mergeListedOn(r2.plugins, m2, { now: '2026-08-18' })
  assert.equal(r3.plugins[0].listedOn.length, 2)
  assert.equal(r3.plugins[0].external.dshfind.score, 88, '跨源 external 不得被覆盖')
  assert.equal(r3.plugins[0].external.dshhub.featured, true)
})

test('preserveCrossSource: fresh 替换 old 时保留 listedOn/external', () => {
  const oldR = { slug: 'x', repo: 'A/x', stars: 5, listedOn: [{ source: 'dshfind' }], external: { dshfind: { score: 88 } } }
  const fresh = { slug: 'x', repo: 'A/x', stars: 9 }
  const out = preserveCrossSource(oldR, fresh)
  assert.equal(out.stars, 9)
  assert.equal(out.listedOn[0].source, 'dshfind')
  assert.equal(out.external.dshfind.score, 88)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/resolve.test.mjs`
Expected: FAIL,`Cannot find module '../lib/resolve.js'`

- [ ] **Step 3: 实现 `tools/lib/resolve.js`**

```js
/** 实体解析:网页文档 ↔ GitHub 仓库。命中 → listedOn 合并;未命中 → 反哺候选 + 独立留存。 */

const RESERVED_OWNERS = new Set(['features', 'topics', 'marketplace', 'orgs', 'settings', 'notifications', 'login', 'signup', 'explore', 'sponsors', 'about', 'pricing', 'collections'])

/** GitHub 仓库 URL 严格解析;子路径(/issues 等)裁剪,.git 去尾;保留段/非 github 拒收。 */
export function parseGithubRepoUrl(url) {
  if (typeof url !== 'string') return null
  const m = url.match(/^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#]|$)/)
  if (!m) return null
  const [, owner, repo] = m
  if (RESERVED_OWNERS.has(owner.toLowerCase()) || repo === '' ) return null
  return { owner, repo, fullName: `${owner}/${repo}` }
}

export const keyOf = (fullName) => fullName.toLowerCase()

/** 网页文档三分流:命中已收录仓库 → merges;未命中 → 反哺 + 留存;无仓库 → 留存。 */
export function resolveDocs(webDocs, knownRepoKeys, { backfillCap = 100, now } = {}) {
  const merges = [], backfills = [], pages = []
  const seenBackfill = new Set()
  for (const doc of webDocs) {
    const u = parseGithubRepoUrl(doc.repoUrl)
    if (!u) { pages.push(doc); continue }
    const key = keyOf(u.fullName)
    if (knownRepoKeys.has(key)) {
      merges.push({ repoKey: key, entry: { source: doc.source, url: doc.url, firstSeenAt: now }, external: doc.external })
    } else {
      if (!seenBackfill.has(key) && backfills.length < backfillCap) {
        seenBackfill.add(key)
        backfills.push({ repo: u.fullName, from: doc.source, firstSeenAt: now })
      }
      pages.push(doc)   // 未转正先独立留存,日后仓库收录再合并
    }
  }
  return { merges, backfills, pages }
}

/** listedOn/external 合并进插件记录;同 source 幂等,跨源 external 互不覆盖。 */
export function mergeListedOn(plugins, merges, { now } = {}) {
  const byRepoKey = new Map(plugins.map((p) => [keyOf(p.repo), p]))
  let mergedCount = 0
  const out = plugins.map((p) => ({ ...p }))
  const outByKey = new Map(out.map((p) => [keyOf(p.repo), p]))
  for (const { repoKey, entry, external } of merges) {
    const rec = outByKey.get(repoKey) ?? byRepoKey.get(repoKey)
    if (!rec) continue
    const target = outByKey.get(repoKey)
    target.listedOn = [...(Array.isArray(target.listedOn) ? target.listedOn : [])]   // 复制数组,不改写调用方旧引用
    if (!target.listedOn.some((l) => l.source === entry.source)) {
      target.listedOn.push(entry)
      mergedCount++
    }
    if (external && typeof external === 'object') {
      target.external = { ...(target.external ?? {}), ...external }
    }
  }
  return { plugins: out, mergedCount }
}

/** crawl.js fresh 记录替换 old 时调用:跨源字段由 crawl-web 维护,crawl.js 只保留不生成。 */
export function preserveCrossSource(oldRec, newRec) {
  const out = { ...newRec }
  if (oldRec.listedOn !== undefined) out.listedOn = oldRec.listedOn
  if (oldRec.external !== undefined) out.external = oldRec.external
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/resolve.test.mjs`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/lib/resolve.js tools/tests/resolve.test.mjs
git commit -m "feat: 实体解析(GitHub 链接校验 / listedOn 幂等合并 / 反哺分流)"
```

---

### Task 7: 网页源编排 `tools/crawl-web.js`

**Files:**
- Create: `tools/crawl-web.js`
- Test: `tools/tests/crawl-web.test.mjs`

**Interfaces:**
- Consumes: `fetchText/makeGate`（http.js)、`createCheerioRunner`（crawler.js)、`loadState/saveState/noteChecked/planRefresh`（state.js)、`parseSitemap/extractDetail/normalize`（dshfind.js)、`parseCatalog/normalizeEntry/CATALOG_URL`（dshhub.js)、`keyOf/resolveDocs/mergeListedOn`（resolve.js)
- Produces:
  - `runWebCrawl({ dataDir, cacheDir, now, maxPages, minIntervalMs, dshfindBase, dshhubBase }) => { pages, merges, backfills }`
  - CLI:`node tools/crawl-web.js`；环境变量 `DSH_WEB_MAX`（限量冒烟）、`DSH_WEB_MIN_INTERVAL`
  - 产物：`web/data/pages.json`、`web/data/plugins.json`（listedOn/external 合并写回）、`tools/.cache/state-dshfind.json`、`tools/.cache/state-dshhub.json`、`tools/.cache/backfill.json`

- [ ] **Step 1: 写失败集成测试（本地假站全链路）**

```js
// tools/tests/crawl-web.test.mjs
/** 集成测试:本地假站 → 编排全链路 → 产物断言(不打外网)。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWebCrawl } from '../crawl-web.js'

const DETAIL = (name, owner, repo) => `<html><body>
<h1>${name}<span title="综合评分">A<span class="opacity-80">90</span></span></h1>
<div><div class="mt-1 text-xl font-bold tabular-nums">50<span class="text-emerald-600">+3</span></div>
<div class="text-[11px] text-muted-foreground">近 7 天增长</div></div>
<script type="application/ld+json">{"@type":"SoftwareSourceCode","name":"${name}","description":"d","codeRepository":"https://github.com/${owner}/${repo}"}</script>
</body></html>`

test('runWebCrawl: discover → 抽取 → 归一 → 实体解析 → 产物', async () => {
  const detailA = DETAIL('known-plugin', 'Acme', 'known')
  const detailB = DETAIL('new-plugin', 'Bob', 'fresh')
  const server = http.createServer((req, res) => {
    const routes = {
      '/sitemap.xml': `<urlset><url><loc>BASE/zh/plugins/Acme/known</loc></url><url><loc>BASE/zh/plugins/Bob/fresh</loc></url></urlset>`,
      '/zh/plugins/Acme/known': detailA,
      '/zh/plugins/Bob/fresh': detailB,
      '/catalog.json': JSON.stringify({ schema: 'v0.4', packages: [
        { id: 'hub1', name: 'hub-one', description: 'h', repository: 'https://github.com/Acme/known', author: { name: 'Acme' } },
      ] }),
    }
    const body = routes[req.url]?.replaceAll('BASE', `http://127.0.0.1:${server.address().port}`)
    if (body === undefined) { res.writeHead(404); return res.end() }
    res.writeHead(200); res.end(body)
  })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  const dataDir = await mkdtemp(join(tmpdir(), 'data-'))
  const cacheDir = await mkdtemp(join(tmpdir(), 'cache-'))
  // 预置主索引:known 已收录
  await writeFile(join(dataDir, 'plugins.json'), JSON.stringify([{ slug: 'known', repo: 'Acme/known', type: 'plugin', source: 'github-topic' }]))

  const result = await runWebCrawl({
    dataDir, cacheDir, now: '2026-08-17', maxPages: 10, minIntervalMs: 0,
    dshfindBase: base, dshhubBase: base,
  })

  // known 命中两源合并;Bob/fresh 未命中 → 反哺 + 留存
  const plugins = JSON.parse(await readFile(join(dataDir, 'plugins.json'), 'utf8'))
  assert.equal(plugins[0].listedOn.length, 2, 'dshfind + dshhub 两源收录')
  assert.deepEqual(plugins[0].listedOn.map((l) => l.source).sort(), ['dshfind', 'dshhub'])
  assert.equal(plugins[0].external.dshfind.score, 90)
  assert.equal(plugins[0].external.dshhub.id, 'hub1')
  const pages = JSON.parse(await readFile(join(dataDir, 'pages.json'), 'utf8'))
  assert.equal(pages.pages.length, 1); assert.equal(pages.pages[0].name, 'new-plugin')
  const backfill = JSON.parse(await readFile(join(cacheDir, 'backfill.json'), 'utf8'))
  assert.deepEqual(backfill.candidates, [{ repo: 'Bob/fresh', from: 'dshfind', firstSeenAt: '2026-08-17' }])
  assert.equal(result.merges.length, 2)
  // state 文件已落盘,二轮同 URL 不再视为 discover
  const state = JSON.parse(await readFile(join(cacheDir, 'state-dshfind.json'), 'utf8'))
  assert.ok(state.urls[`${base}/zh/plugins/Acme/known`])

  server.close(); await rm(dataDir, { recursive: true, force: true }); await rm(cacheDir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/crawl-web.test.mjs`
Expected: FAIL,`Cannot find module '../crawl-web.js'`

- [ ] **Step 3: 实现 `tools/crawl-web.js`**

```js
/** 网页源编排:dshfind(sitemap + Cheerio 详情)/ DSH Hub(catalog.json)
 *  双流程:discover(state 未知 URL)+ refresh(planRefresh 到期);产物 = pages.json +
 *  plugins.json(listedOn/external 合并)+ backfill.json + state-<source>.json。
 *  用法: node tools/crawl-web.js   (DSH_WEB_MAX 限量冒烟,DSH_WEB_MIN_INTERVAL 调限速) */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchText, makeGate } from './lib/http.js'
import { createCheerioRunner } from './lib/crawler.js'
import { loadState, saveState, noteChecked, planRefresh } from './lib/state.js'
import { keyOf, resolveDocs, mergeListedOn } from './lib/resolve.js'
import * as dshfind from './sources/dshfind.js'
import * as dshhub from './sources/dshhub.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DAY = 86400000
const REFRESH_AGE_MS = 7 * DAY      // 网页源固定窗口重抓(评分随时间变)

async function atomicWriteJson(file, obj) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

const hashOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12)

/** dshfind 流:sitemap 发现 → 双流程任务集 → Cheerio 详情抓取。 */
async function crawlDshfind({ base, cacheDir, now, maxPages, minIntervalMs, webDocs }) {
  const gate = makeGate(minIntervalMs)
  const sitemap = await fetchText(`${base}/sitemap.xml`, { gate })
  if (!sitemap.text) throw new Error('[crawl-web] dshfind sitemap 拉取失败')
  const allUrls = dshfind.parseSitemap(sitemap.text.replaceAll(base, 'https://dshfind.com'))
    .map((u) => u.replace('https://dshfind.com', base))
  const stateFile = join(cacheDir, 'state-dshfind.json')
  const state = await loadState(stateFile)
  const budget = Math.max(0, maxPages)
  const discover = allUrls.filter((u) => !state.urls[u]).slice(0, budget)
  const refresh = planRefresh(state, allUrls, { now: Date.parse(now), maxAgeMs: REFRESH_AGE_MS, budget: Math.max(0, budget - discover.length) })
  const tasks = [...new Set([...discover, ...refresh])]
  console.log(`[crawl-web] dshfind: 目录 ${allUrls.length},discover ${discover.length},refresh ${refresh.length}`)
  if (tasks.length > 0) {
    const crawler = createCheerioRunner({
      storageDir: join(cacheDir, 'crawlee-dshfind'),
      minIntervalMs,
      requestHandler: async ({ request, body }) => {
        const html = body.toString()
        webDocs.push(dshfind.normalize(dshfind.extractDetail(html, request.url)))
        const prev = state.urls[request.url]
        noteChecked(state, request.url, { now: Date.parse(now), changed: !prev || prev.hash !== hashOf(html), hash: hashOf(html) })
        await saveState(stateFile, state)   // 增量落盘:中途崩盘下轮 planner 重新发出未完成 URL
      },
      failedRequestHandler: async ({ request }) => console.warn(`[crawl-web] 失败跳过: ${request.url}`),
    })
    await crawler.run(tasks)
  }
  await saveState(stateFile, state)
}

/** hub 流:catalog.json 条件请求(ETag),全量归一(JSON 便宜)。 */
async function crawlDshhub({ base, cacheDir, now, webDocs }) {
  const stateFile = join(cacheDir, 'state-dshhub.json')
  const state = await loadState(stateFile)
  const etag = state.urls.catalog?.hash
  const res = await fetchText(`${base}/catalog.json`, { headers: etag ? { 'If-None-Match': etag } : {} })
  if (res.status === 304) { console.log('[crawl-web] dshhub: 304 未变化,跳过'); return }
  if (!res.text) throw new Error('[crawl-web] dshhub catalog 拉取失败')
  for (const entry of dshhub.parseCatalog(res.text)) webDocs.push(dshhub.normalizeEntry(entry))
  noteChecked(state, 'catalog', { now: Date.parse(now), changed: true, hash: res.etag ?? hashOf(res.text) })
  await saveState(stateFile, state)
  console.log(`[crawl-web] dshhub: 归一 ${webDocs.length} 文档`)
}

export async function runWebCrawl({ dataDir, cacheDir, now, maxPages = Infinity, minIntervalMs = 1500, dshfindBase = 'https://dshfind.com', dshhubBase = 'https://hub.omdsh.dev' }) {
  const pluginsFile = join(dataDir, 'plugins.json')
  const plugins = JSON.parse(await readFile(pluginsFile, 'utf8'))
  const knownRepoKeys = new Set(plugins.map((p) => keyOf(p.repo)))
  const webDocs = []
  await crawlDshfind({ base: dshfindBase, cacheDir, now, maxPages, minIntervalMs, webDocs })
  await crawlDshhub({ base: dshhubBase, cacheDir, now, webDocs })

  const { merges, backfills, pages } = resolveDocs(webDocs, knownRepoKeys, { backfillCap: 100, now })
  // 主索引:listedOn/external 合并写回(M-A 不做 listedOn 下架,防抖动)
  const { plugins: mergedPlugins, mergedCount } = mergeListedOn(plugins, merges, { now })
  await atomicWriteJson(pluginsFile, mergedPlugins)
  // 独立留存网页文档(未命中仓库的)
  await atomicWriteJson(join(dataDir, 'pages.json'), { version: 1, updatedAt: now, pages })
  // 反哺候选:与历史候选按 repo 去重合并,crawl.js 下轮消费
  const backfillFile = join(cacheDir, 'backfill.json')
  const oldBackfill = JSON.parse(await readFile(backfillFile, 'utf8').catch(() => '{"candidates":[]}'))
  const seen = new Set(oldBackfill.candidates.map((c) => keyOf(c.repo)))
  const candidates = [...oldBackfill.candidates]
  for (const b of backfills) {
    if (!seen.has(keyOf(b.repo))) { seen.add(keyOf(b.repo)); candidates.push(b) }
  }
  await atomicWriteJson(backfillFile, { updatedAt: now, candidates })
  console.log(`[crawl-web] 完成:合并 ${mergedCount} 条 listedOn,留存 ${pages.length} 页,反哺候选 ${candidates.length}`)
  return { pages, merges, backfills: candidates }
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWebCrawl({
    dataDir: join(ROOT, 'web', 'data'),
    cacheDir: join(ROOT, 'tools', '.cache'),
    now: new Date().toISOString().slice(0, 10),
    maxPages: Number(process.env.DSH_WEB_MAX || 0) || Infinity,
    minIntervalMs: Number(process.env.DSH_WEB_MIN_INTERVAL || 1500),
  }).catch((e) => { console.error('[crawl-web] 失败:', e); process.exit(1) })
}
```

注意三个实现要点:① sitemap 与详情页 URL 的 base 替换是为了测试可注入假站;生产环境 `replaceAll` 是恒等操作。② `resolveDocs` 只按当前主索引判定命中;同一轮内 dshfind 与 dshhub 对同一仓库的 merge 会各进一条 listedOn（不同 source，幂等逻辑允许）。③ `mergeListedOn` 的 external 合并以"同 source 覆盖、跨源保留"语义执行——同一轮 dshfind 重抓会刷新旧分数，这正是 refresh 的目的。

robots 遵守方式：Crawlee 不自带 robots 强制；本编排只访问 robots 明确允许的路径（dshfind `/sitemap.xml` + `/zh/plugins/**`,hub `catalog.json` 公开数据文件），不碰 `/api/`、登录页——合规由适配器路径白名单保证，新增源时先核对 robots 再写 discover。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/crawl-web.test.mjs`
Expected: PASS(1 集成测试）

- [ ] **Step 5: 真站小步冒烟**

Run: `DSH_WEB_MAX=3 DSH_WEB_MIN_INTERVAL=2000 node tools/crawl-web.js`
Expected: 抓 3 个 dshfind 详情页 + hub catalog;`plugins.json` 出现 listedOn;**人工核对**：某命中插件的 `external.dshfind.stars`/`weeklyGrowth` 与网页显示一致（语义如不符，调整 extractDetail 映射后重跑）。

- [ ] **Step 6: 核对后还原产物并 Commit**

```bash
git checkout -- web/data/plugins.json   # 冒烟产物不提交(等全链跑通再正式生成)
git add tools/crawl-web.js tools/tests/crawl-web.test.mjs
git commit -m "feat: 网页源编排 crawl-web.js(双流程 + 实体解析 + listedOn/反哺/pages 产物)"
```

---

### Task 8: `tools/crawl.js` — schema 1.1 + GitHub 存量 refresh + 下架 + 反哺消费

**Files:**
- Modify: `tools/crawl.js`(step 1/2/5/6/8 区域)
- Test: `tools/tests/crawl-ext.test.mjs`

**Interfaces:**
- Consumes: `planGithubRefresh`（state.js)、`preserveCrossSource`（resolve.js)、`keyOf`（resolve.js)
- Produces:
  - 新记录字段 `type: 'plugin'`、`source: 'github-topic'|'seeds'|'backfill:<from>'`
  - `mergeOldRecord(old, fresh) => merged`（导出供测试；内部 = preserveCrossSource + source 继承）
  - `consumeBackfill(cacheDir) => [{ repo, from }]`（导出供测试；读取并清空 backfill.json)
  - `meta.json` 增加 `schemaVersion: '1.1'`

- [ ] **Step 1: 写失败测试**

```js
// tools/tests/crawl-ext.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeOldRecord, sourceOf, consumeBackfill } from '../crawl.js'

test('sourceOf: 三种渠道标记', () => {
  assert.equal(sourceOf({}), 'github-topic')
  assert.equal(sourceOf({ _seedCategory: 'tool' }), 'seeds')
  assert.equal(sourceOf({ _backfillFrom: 'dshfind' }), 'backfill:dshfind')
})

test('mergeOldRecord: fresh 替换 old 保留跨源字段,source 依 fresh 渠道', () => {
  const oldR = { slug: 'x', repo: 'A/x', listedOn: [{ source: 'dshfind' }], external: { dshfind: { score: 88 } }, source: 'github-topic', type: 'plugin' }
  const fresh = { slug: 'x', repo: 'A/x', source: 'backfill:dshfind', type: 'plugin' }
  const out = mergeOldRecord(oldR, fresh)
  assert.equal(out.listedOn[0].source, 'dshfind')
  assert.equal(out.external.dshfind.score, 88)
  assert.equal(out.source, 'backfill:dshfind')
  assert.equal(out.type, 'plugin')
})

test('consumeBackfill: 读取候选并清空文件;缺文件给空', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'))
  assert.deepEqual(await consumeBackfill(dir), [])
  await writeFile(join(dir, 'backfill.json'), JSON.stringify({ candidates: [{ repo: 'B/y', from: 'dshfind', firstSeenAt: '2026-08-17' }] }))
  const got = await consumeBackfill(dir)
  assert.equal(got.length, 1); assert.equal(got[0].repo, 'B/y')
  assert.deepEqual((JSON.parse(await readFile(join(dir, 'backfill.json'), 'utf8'))).candidates, [], '消费后清空')
  await rm(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/crawl-ext.test.mjs`
Expected: FAIL,`mergeOldRecord is not a function`（或模块无导出）

- [ ] **Step 3: 实现 crawl.js 改动**

⓪ **先加 CLI 守卫**(否则测试 import crawl.js 会触发真实爬取):文件末尾的 `main().catch(...)` 改为——

```js
// CLI 入口:测试 import 纯函数时不执行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('[crawl] 失败:', e); process.exit(1) })
}
```

① 顶部 import 追加：

```js
import { planGithubRefresh } from './lib/state.js'
import { preserveCrossSource, keyOf } from './lib/resolve.js'
```

② 在 `getToken` 附近新增三个导出函数（纯逻辑，供测试与主流程复用）:

```js
/** 记录渠道标记:seeds 人工收录 > 网页源反哺 > topic 扫描。 */
export function sourceOf(repo) {
  if (repo._seedCategory) return 'seeds'
  if (repo._backfillFrom) return `backfill:${repo._backfillFrom}`
  return 'github-topic'
}

/** fresh 替换 old 的合并:跨源字段保留(listedOn/external 由 crawl-web 维护),source 继承 fresh 渠道。 */
export function mergeOldRecord(old, fresh) {
  const out = preserveCrossSource(old, fresh)
  out.type = 'plugin'
  out.source = fresh.source ?? old.source ?? 'github-topic'
  return out
}

/** 消费反哺候选:读取 backfill.json 并清空(crawl-web 下轮重新产出未转正者)。 */
export async function consumeBackfill(cacheDir) {
  const file = join(cacheDir, 'backfill.json')
  const data = JSON.parse(await readFile(file, 'utf8').catch(() => '{"candidates":[]}'))
  const candidates = data.candidates ?? []
  if (candidates.length > 0) await atomicWrite(file, JSON.stringify({ updatedAt: new Date().toISOString(), candidates: [] }))
  return candidates
}
```

③ 主流程 step 2(seeds 合并）之后追加存量 refresh + 反哺消费：

```js
  // 2.5) 存量 refresh:活跃窗口全量 + 长尾轮转;404/删除标记下架
  const REFRESH_BUDGET = Number(process.env.CRAWL_REFRESH || 500)
  const round = Math.floor(Date.now() / 86400000)   // 以天为轮转单位
  const refreshList = planGithubRefresh(oldIndex, { now: Date.now(), budget: REFRESH_BUDGET, round })
    .filter((fullName) => !byName.has(fullName))
  const removed = []
  let checked = 0
  await pool(refreshList, API_CONCURRENCY, async (fullName) => {
    const repo = await ghApi(`https://api.github.com/repos/${fullName}`, coreGate)
    if (repo === null) {
      removed.push(fullName)
      delete pkgCache[fullName]
      console.warn(`[crawl] 下架(404/删除): ${fullName}`)
      return
    }
    byName.set(fullName, repo)
    if (++checked % 100 === 0) console.log(`[crawl] 存量刷新进度 ${checked}/${refreshList.length}`)
  })
  if (removed.length > 0) console.log(`[crawl] 本轮下架 ${removed.length} 个`)

  // 2.6) 反哺候选:与 seeds 同级补查元数据(仍须过 dsh.bundle.patch + LICENSE + README 门槛)
  const backfills = await consumeBackfill(join(ROOT, 'tools', '.cache'))
  for (const cand of backfills) {
    if (byName.has(cand.repo)) continue
    const repo = await ghApi(`https://api.github.com/repos/${cand.repo}`, coreGate)
    if (repo) { repo._backfillFrom = cand.from; byName.set(cand.repo, repo) }
  }
  if (backfills.length > 0) console.log(`[crawl] 反哺候选 ${backfills.length} 个(成功补查计入管道)`)
```

④ step 5 新记录对象增加两个字段（在 `basicCheck` 行附近）:

```js
      type: 'plugin',
      source: sourceOf(repo),
```

⑤ step 6 合并逻辑：替换 `merged.push(fresh)` 分支为：

```js
    if (fresh !== undefined) {
      freshByRepo.delete(old.repo)
      merged.push(mergeOldRecord(old, fresh))
      continue
    }
```

fresh 记录的 `source` 已在 step 5 由 `sourceOf(repo)` 写入，`mergeOldRecord` 直接继承，无需回挂 repo 对象。

⑥ step 6 末尾：剔除下架仓库——`merged` 过滤掉 `removed` 中的 repo(`removed` 是 main() 内的局部数组,Task 9 的 changelog 代码同在 main() 作用域,直接引用)。

⑦ `meta.json` 写入处增加 `schemaVersion: '1.1'`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/crawl-ext.test.mjs`
Expected: PASS(3 tests)

- [ ] **Step 5: 回归冒烟**

Run: `CRAWL_SKIP_SEARCH=1 CRAWL_MAX=2 CRAWL_REFRESH=5 node tools/crawl.js`
Expected: 跑通；`git diff web/data/plugins.json` 只见新字段（type/source）与 refresh 引起的正常字段更新；旧记录 listedOn/external（若有）未被清掉。

- [ ] **Step 6: Commit**

```bash
git add tools/crawl.js tools/tests/crawl-ext.test.mjs
git commit -m "feat: crawl.js 双流程(存量 refresh + 404 下架)+ 反哺消费 + schema 1.1 增量字段"
```

---

### Task 9: changelog 与 trending

**Files:**
- Create: `tools/lib/changelog.js`、`tools/lib/trending.js`
- Test: `tools/tests/changelog.test.mjs`、`tools/tests/trending.test.mjs`
- Modify: `tools/crawl.js`(step 8 产物区）

**Interfaces:**
- Produces:
  - `makeEntry(type, slug, { source, now }) => { ts, type, slug, source }`
  - `appendEntries(log, entries, { now, maxAgeDays, maxEntries }) => log'`（新条目在前）
  - `diffStars(snapshot, plugins, { top }) => [{ slug, name, stars, delta }]`
  - crawl.js 产物：`web/data/changelog.json`、`web/data/trending.json`、`tools/.cache/star-snap.json`

- [ ] **Step 1: 写失败测试**

```js
// tools/tests/changelog.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEntry, appendEntries } from '../lib/changelog.js'

test('appendEntries: 新条目在前,90 天轮转,5000 条上限', () => {
  const now = Date.parse('2026-08-17T00:00:00Z')
  let log = { version: 1, entries: [{ ts: '2026-05-01T00:00:00.000Z', type: 'added', slug: 'old', source: 'github-topic' }] }
  log = appendEntries(log, [makeEntry('added', 'new', { source: 'github-topic', now: '2026-08-17' })], { now })
  assert.equal(log.entries[0].slug, 'new')
  assert.equal(log.entries.length, 1, '超 90 天条目被轮转')
  const many = Array.from({ length: 6000 }, (_, i) => makeEntry('updated', `p${i}`, { source: 'github-topic', now: '2026-08-17' }))
  const capped = appendEntries({ version: 1, entries: [] }, many, { now })
  assert.equal(capped.entries.length, 5000)
})

// tools/tests/trending.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffStars } from '../lib/trending.js'

test('diffStars: 正增长排序 Top N,零/负增长剔除,冷启动为空', () => {
  const plugins = [
    { slug: 'a', name: 'A', repo: 'o/a', stars: 100 },
    { slug: 'b', name: 'B', repo: 'o/b', stars: 50 },
    { slug: 'c', name: 'C', repo: 'o/c', stars: 10 },
  ]
  assert.deepEqual(diffStars({}, plugins, { top: 20 }), [], '冷启动:无快照不出假数据')
  const snap = { 'o/a': 90, 'o/b': 50, 'o/c': 5 }
  const out = diffStars(snap, plugins, { top: 20 })
  assert.deepEqual(out.map((i) => [i.slug, i.delta]), [['a', 10], ['c', 5]])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/changelog.test.mjs tools/tests/trending.test.mjs`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现两个库**

```js
// tools/lib/changelog.js
/** 增量变更流:新条目在前;轮转 = 90 天窗口 + 5000 条硬上限。 */
export function makeEntry(type, slug, { source, now }) {
  return { ts: new Date(now).toISOString(), type, slug, source }
}

export function appendEntries(log, entries, { now, maxAgeDays = 90, maxEntries = 5000 } = {}) {
  const cutoff = now - maxAgeDays * 86400000
  const kept = (log.entries ?? []).filter((e) => Date.parse(e.ts) >= cutoff)
  return { version: 1, entries: [...entries, ...kept].slice(0, maxEntries) }
}
```

```js
// tools/lib/trending.js
/** 24h 热度榜:与上轮 star 快照 diff,正增长排序取 Top N;冷启动(无快照)返回空。 */
export function diffStars(snapshot, plugins, { top = 20 } = {}) {
  if (!snapshot || Object.keys(snapshot).length === 0) return []
  return plugins
    .map((p) => ({ slug: p.slug, name: p.name, stars: p.stars, delta: p.stars - (snapshot[p.repo] ?? p.stars) }))
    .filter((i) => i.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, top)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/changelog.test.mjs tools/tests/trending.test.mjs`
Expected: PASS(2 tests)

- [ ] **Step 5: crawl.js 接线（step 8 产物区，plugins.json 写入后）**

```js
  // 8.5) changelog:added = firstSeenAt 为今天的记录;updated = fresh 替换且 latestCommit 变化;removed = 下架
  const today = new Date().toISOString().slice(0, 10)
  const changelogFile = join(DATA_DIR, 'changelog.json')
  const changelog = JSON.parse(await readFile(changelogFile, 'utf8').catch(() => '{"version":1,"entries":[]}'))
  const entries = []
  for (const r of newRecords) {
    if (r.firstSeenAt === today) entries.push(makeEntry('added', r.slug, { source: r.source, now: today }))
    else {
      const old = oldIndex.find((o) => o.repo === r.repo)
      if (old && old.latestCommit !== r.latestCommit) entries.push(makeEntry('updated', r.slug, { source: r.source, now: today }))
    }
  }
  for (const fullName of removed) {
    const old = oldIndex.find((o) => o.repo === fullName)
    if (old) entries.push(makeEntry('removed', old.slug, { source: old.source ?? 'github-topic', now: today }))
  }
  if (entries.length > 0) {
    const next = appendEntries(changelog, entries, { now: Date.now() })
    await atomicWrite(changelogFile, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  }

  // 8.6) trending:与上轮快照 diff;随后写本轮快照
  const snapFile = join(ROOT, 'tools', '.cache', 'star-snap.json')
  const snap = JSON.parse(await readFile(snapFile, 'utf8').catch(() => '{}'))
  const items = diffStars(snap, merged, { top: 20 })
  await atomicWrite(join(DATA_DIR, 'trending.json'), JSON.stringify({ updatedAt: new Date().toISOString(), window: '24h', items }, null, 2) + '\n')
  await atomicWrite(snapFile, JSON.stringify(Object.fromEntries(merged.map((r) => [r.repo, r.stars]))))
```

对应 import:`import { makeEntry, appendEntries } from './lib/changelog.js'`、`import { diffStars } from './lib/trending.js'`。`removed` 直接引用 Task 8 在 main() 内定义的局部数组。

- [ ] **Step 6: 回归冒烟**

Run: `CRAWL_SKIP_SEARCH=1 CRAWL_MAX=2 CRAWL_REFRESH=5 node tools/crawl.js`
Expected: `web/data/changelog.json` 与 `web/data/trending.json` 生成；第二轮运行时 trending 出现真实 delta。

- [ ] **Step 7: Commit**

```bash
git add tools/lib/changelog.js tools/lib/trending.js tools/crawl.js tools/tests/changelog.test.mjs tools/tests/trending.test.mjs
git commit -m "feat: changelog 增量变更流 + trending 24h star 榜(提前自 M-D)"
```

---

### Task 10: 倒排索引构建 `tools/lib/search-index.js` + `tools/build-search-index.js`

**Files:**
- Create: `tools/lib/search-index.js`、`tools/build-search-index.js`
- Test: `tools/tests/search-index.test.mjs`

**Interfaces:**
- Consumes: `web/data/plugins.json`、`web/data/pages.json`
- Produces:
  - `tokenize(text) => string[]`
  - `buildIndex(docs, { maxDocsPerTerm }) => index`(`{ [term]: [[docIdx, score]] }`,score = 字段权重 × tf)
  - `assertBudget(indexJson, { maxBytes }) => bytes`（超限 throw，带实际体积）
  - CLI 产物 `web/data/search.json`（契约见文件地图）

- [ ] **Step 1: 写失败测试**

```js
// tools/tests/search-index.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, buildIndex, assertBudget } from '../lib/search-index.js'

test('tokenize: 英文小写轻 stem,中文 bigram,停用词剔除', () => {
  const t = tokenize('Running Vision tools 视觉识别')
  assert.ok(t.includes('run'), 'ing 词干')
  assert.ok(t.includes('vision'))
  assert.ok(t.includes('视觉') || t.includes('别'), '中文 bigram')
  assert.ok(!t.includes('the'))
})

test('buildIndex: 字段权重(name 3 / author 2 / tags 2 / desc 1)与每词文档截断', () => {
  const docs = [
    { slug: 'a', name: 'vision kit', author: 'bob', tags: ['ocr'], desc: 'image tools' },
    { slug: 'b', name: 'other', author: 'ann', tags: [], desc: 'vision desc' },
  ]
  const idx = buildIndex(docs, { maxDocsPerTerm: 200 })
  const hitA = idx['vision'].find(([i]) => i === 0)
  const hitB = idx['vision'].find(([i]) => i === 1)
  assert.ok(hitA[1] > hitB[1], 'name 命中权重应高于 desc 命中')
  const capped = buildIndex(Array.from({ length: 5 }, (_, i) => ({ slug: `s${i}`, name: 'same', author: '', tags: [], desc: '' })), { maxDocsPerTerm: 2 })
  assert.equal(capped['same'].length, 2)
})

test('assertBudget: 超限抛出并报告体积', () => {
  assert.throws(() => assertBudget('{"a":"xxxx"}', { maxBytes: 5 }), /预算/)
  assert.equal(assertBudget('{"a":1}', { maxBytes: 100 }), 7)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tools/tests/search-index.test.mjs`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `tools/lib/search-index.js`**

```js
/** 倒排索引:英文小写 + 轻量词干(复数/ing/ed),中文(及 CJK)bigram;
 *  字段加权 name 3 / author 2 / tags 2 / desc 1;每词最多 maxDocsPerTerm 个文档(按分数截断)。 */
const STOP_EN = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are', 'by', 'at', 'from', 'as', 'it', 'its', 'this', 'that', 'you', 'your', 'we', 'our', 'dsh', 'plugin', 'plugins', 'deepseek', 'harness'])
const STOP_ZH = new Set(['的', '了', '和', '与', '在', '是', '有', '为', '及', '或'])

const stem = (w) => w.replace(/(ing|ed|es|s)$/, (m0) => (w.length - m0.length >= 3 ? '' : m0))

export function tokenize(text) {
  if (!text) return []
  const lower = String(text).toLowerCase()
  const out = []
  for (const m of lower.matchAll(/[a-z0-9]+/g)) {
    const w = stem(m[0])
    if (w.length >= 2 && !STOP_EN.has(w)) out.push(w)
  }
  const cjk = lower.match(/[一-鿿]+/g) ?? []
  for (const run of cjk) {
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2)
      if (!STOP_ZH.has(bg[0]) && !STOP_ZH.has(bg[1])) out.push(bg)
    }
  }
  return out
}

const FIELD_WEIGHTS = { name: 3, author: 2, tags: 2, desc: 1 }

/** docs: [{ slug, name, author, tags[], desc }] → { [term]: [[docIdx, score]] } */
export function buildIndex(docs, { maxDocsPerTerm = 200 } = {}) {
  const index = {}
  docs.forEach((doc, docIdx) => {
    const best = {}
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const text = Array.isArray(doc[field]) ? doc[field].join(' ') : doc[field]
      const tf = {}
      for (const term of tokenize(text)) tf[term] = (tf[term] ?? 0) + 1
      for (const [term, count] of Object.entries(tf)) {
        const score = weight * count
        if (score > (best[term] ?? 0)) best[term] = score
      }
    }
    for (const [term, score] of Object.entries(best)) {
      ;(index[term] ??= []).push([docIdx, score])
    }
  })
  for (const term of Object.keys(index)) {
    index[term].sort((a, b) => b[1] - a[1])
    if (index[term].length > maxDocsPerTerm) index[term] = index[term].slice(0, maxDocsPerTerm)
  }
  return index
}

/** 体积预算:超限即失败(万级规模护栏,防止前端懒加载爆炸)。 */
export function assertBudget(indexJson, { maxBytes = 3 * 1024 * 1024 } = {}) {
  const bytes = Buffer.byteLength(indexJson, 'utf8')
  if (bytes > maxBytes) throw new Error(`[search-index] 体积 ${(bytes / 1048576).toFixed(2)}MB 超预算 ${(maxBytes / 1048576).toFixed(2)}MB`)
  return bytes
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tools/tests/search-index.test.mjs`
Expected: PASS(3 tests)

- [ ] **Step 5: 实现 `tools/build-search-index.js`**

```js
/** CLI:plugins.json(插件)+ pages.json(网页)→ web/data/search.json。 */
import { readFile } from 'node:fs/promises'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, assertBudget } from './lib/search-index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'web', 'data')

const plugins = JSON.parse(await readFile(join(DATA, 'plugins.json'), 'utf8'))
const pages = JSON.parse(await readFile(join(DATA, 'pages.json'), 'utf8').catch(() => '{"pages":[]}'))

const docs = [
  ...plugins.map((p) => ({ slug: p.slug, name: p.name, author: p.repo.split('/')[0], tags: p.tags ?? [], desc: (p.description ?? '').slice(0, 300) })),
  ...pages.pages.map((w) => ({ slug: `page:${w.source}:${w.url}`, name: w.name ?? '', author: w.author ?? '', tags: [], desc: w.description ?? '' })),
]
const index = buildIndex(docs, { maxDocsPerTerm: 200 })
const meta = docs.map((d, i) => {
  const p = plugins[i]
  return p
    ? { slug: p.slug, type: 'plugin', cat: p.category, src: ['github', ...(p.listedOn?.map((l) => l.source) ?? [])], state: p.state, stars: p.stars }
    : { slug: d.slug, type: 'page', cat: null, src: [pages.pages[i - plugins.length].source], state: null, stars: null }
})
const out = JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), fields: { name: 3, author: 2, tags: 2, desc: 1 }, docs: meta, index })
const bytes = assertBudget(out)
const file = join(DATA, 'search.json')
await mkdir(dirname(file), { recursive: true })
await writeFile(`${file}.tmp`, out, 'utf8')
await rename(`${file}.tmp`, file)
console.log(`[search-index] 完成:${docs.length} 文档,${Object.keys(index).length} 词,${(bytes / 1048576).toFixed(2)}MB`)
```

- [ ] **Step 6: 真数据构建 + 预算验证**

Run: `node tools/build-search-index.js`
Expected: 对当前 2327 插件构建成功，输出体积 < 3MB（若接近 2.5MB，在 Task 11 文档中记录并按需下调 `desc` 截取长度）。

- [ ] **Step 7: Commit**

```bash
git add tools/lib/search-index.js tools/build-search-index.js tools/tests/search-index.test.mjs
git commit -m "feat: 倒排索引构建器(中英分词/字段加权/3MB 预算护栏)"
```

---

### Task 11: 链路整合 + Actions workflow + 文档收尾

**Files:**
- Modify: `tools/sync.sh`、`package.json`
- Create: `.github/workflows/crawl.yml`
- Modify: `docs/SEARCH-ENGINE-DESIGN.md`（状态行）、`docs/ROADMAP.md`（勾选 P0-1/P0-2 对应项）

**Interfaces:**
- Consumes: 前 10 个 Task 的全部 CLI
- Produces: 可定时运行的完整数据链

- [ ] **Step 1: sync.sh 链序调整（服务器回退路径保持可用）**

在 `# 2) 运行爬虫` 段成功后、`# 2.5) 重新生成 sitemap` 前，插入：

```bash
# 2.1) 网页源抓取(dshfind / DSH Hub)
if env timeout 1200 node tools/crawl-web.js >> "$LOG_FILE" 2>&1; then
  log "网页源抓取成功"
else
  log "WARN: 网页源抓取失败(继续,主索引不受影响)"
fi
```

在 `# 2.6) 拆分单插件数据` 前，插入：

```bash
# 2.5.1) 构建倒排索引
if node tools/build-search-index.js >> "$LOG_FILE" 2>&1; then
  log "倒排索引构建成功"
else
  log "WARN: 倒排索引构建失败(继续)"
fi
```

最终链序：`crawl.js → crawl-web.js → gen-sitemap.js → build-search-index.js → split-data.js → prerender.js`。顺序约束：crawl-web 改 plugins.json(listedOn)，必须在 split/prerender 之前。

- [ ] **Step 2: package.json scripts**

```json
"crawl": "node tools/crawl.js",
"crawl:web": "node tools/crawl-web.js",
"index:build": "node tools/build-search-index.js",
"test": "node --test plugin/tests/ tools/tests/",
"serve": "python -m http.server 4815 --directory web"
```

- [ ] **Step 3: 创建 `.github/workflows/crawl.yml`**

```yaml
name: crawl
on:
  schedule:
    - cron: '17 */6 * * *'   # 每 6 小时,错开整点
  workflow_dispatch: {}

concurrency:
  group: crawl
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  crawl:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9   # 对应 pnpm-lock.yaml lockfileVersion 9.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: 恢复爬虫状态缓存
        uses: actions/cache@v4
        with:
          path: tools/.cache
          key: crawl-cache-${{ github.run_id }}
          restore-keys:
            - crawl-cache-
      - name: 测试
        run: node --test tools/tests/
      - name: 数据链
        run: |
          node tools/crawl.js
          node tools/crawl-web.js
          node tools/gen-sitemap.js
          node tools/build-search-index.js
          node tools/split-data.js
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: 提交产物
        run: |
          git config user.name "dsh-bot"
          git config user.email "bot@dshregistry.xyz"
          git add web/data web/sitemap.xml
          if ! git diff --cached --quiet; then
            git commit -m "crawl: 定时同步 $(date -u +%Y-%m-%dT%H:%MZ)"
            git push
          fi
```

注意：`secrets.GITHUB_TOKEN` 为 Actions 自动注入（公开仓 5000 req/h，与现有 REST 预算模型兼容）；`git ls-remote` 在 runner 直连 GitHub 可用，免费通道不受影响。prerender 产物不入库，仍由服务器 pull 后执行（sync.sh 保留全链，作为回退执行地）。

- [ ] **Step 4: 文档收尾**

- `docs/SEARCH-ENGINE-DESIGN.md` 顶部状态行改为：`状态:M-A 已实施(2026-08-XX),UI 原型见 docs/ui-prototype/index.html`；并在 §0.9 执行顺序勾选完成项。
- `docs/ROADMAP.md`:P0-1（搜索覆盖）对应交付 = search.json 已建（前端消费在 M-B);P0-2（新鲜度跟踪）对应交付 = refresh planner 已落地——两项标注 `已交付(数据侧,M-A)`。

- [ ] **Step 5: 全链冒烟 + 全量真跑**

```bash
node --test plugin/tests/ tools/tests/                 # 全测试绿
CRAWL_MAX=5 DSH_WEB_MAX=5 node tools/crawl.js && DSH_WEB_MAX=5 node tools/crawl-web.js && node tools/build-search-index.js
```

Expected: 全链跑通；`search.json` 含 dshfind 抓取的新词；`plugins.json` 出现 `listedOn` 与 `type/source` 字段。然后不限量真跑一轮（本地或手动触发 workflow)，核对：dshfind 全量 sitemap 解析数 ≈ 详情页总量、hub 680 包归一成功、listedOn 合并计数合理。

- [ ] **Step 6: Commit + 推 workflow 后手动触发一次验证**

```bash
git add tools/sync.sh package.json .github/workflows/crawl.yml docs/SEARCH-ENGINE-DESIGN.md docs/ROADMAP.md
git commit -m "feat: M-A 链路整合(Actions 定时爬虫 + sync.sh 回退链)+ 文档收尾"
```

---

## M-A 完成判定(验收清单)

- [ ] `node --test plugin/tests/ tools/tests/` 全绿
- [ ] `plugins.json`:记录带 `type`/`source`;命中网页源的记录带 `listedOn`/`external`;顶层仍为数组
- [ ] `pages.json`/`changelog.json`/`trending.json`/`search.json` 四个新产物存在于 `web/data/`
- [ ] `search.json` < 3MB;真站 dshfind 详情抽取人工抽验 3 条（评分/徽章/增长）
- [ ] 404 仓库在下一轮被剔除并出现在 changelog `removed`
- [ ] Actions workflow 手动触发成功，产物自动 commit
- [ ] `meta.json` 带 `schemaVersion: '1.1'`

## 后续里程碑（另立计划）

- **M-B 前端**:UI 原型落地（搜索主页/Facet/联想/精选/零结果/双榜单），消费 `search.json`/`trending.json`；详情页 JSON-LD + external 区块 + "收录于" chips + 分类页分页。
- **M-C API**:`docs/API.md` 契约文档 + Nginx alias 配置交付 + jsDelivr 双通道验证。
- **M-D 数据面**:能力域分类迁移（other 48% → <25%)、自适应重抓（unchangedRounds 指数退避）、万级规模核算（search.json 预算 / by-cat 粒度 / GraphQL 批量刷新）、SQLite 状态层（可选）。

