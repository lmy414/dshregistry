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
    // CheerioCrawler 校验 MIME(只收 html/xml/json),假站必须显式声明(同 crawler.test.mjs fakeSite 惯例)
    const type = req.url === '/catalog.json' ? 'application/json' : req.url === '/sitemap.xml' ? 'text/xml' : 'text/html'
    res.writeHead(200, { 'content-type': type }); res.end(body)
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

// 缺陷1:pages.json 每轮全量覆盖 → 第二轮起页面搜索覆盖崩塌
// 修复语义:与旧留存并集合并——转正页(仓库命中 plugins.json)剔除、本轮新页并入、无关旧页保留
test('runWebCrawl: pages.json 跨轮并集——转正页剔除、新页并入、无关旧页保留', async (t) => {
  const detailFresh = DETAIL('fresh-plugin', 'Bob', 'fresh')
  const detailNewest = DETAIL('newest-plugin', 'Dave', 'newest')
  const routes = {
    '/catalog.json': JSON.stringify({ schema: 'v0.4', packages: [] }),
    '/zh/plugins/Bob/fresh': detailFresh,
    '/zh/plugins/Dave/newest': detailNewest,
  }
  const server = http.createServer((req, res) => {
    const body = routes[req.url]?.replaceAll('BASE', `http://127.0.0.1:${server.address().port}`)
    if (body === undefined) { res.writeHead(404); return res.end() }
    const type = req.url === '/catalog.json' ? 'application/json' : req.url === '/sitemap.xml' ? 'text/xml' : 'text/html'
    res.writeHead(200, { 'content-type': type }); res.end(body)
  })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  const dataDir = await mkdtemp(join(tmpdir(), 'data-'))
  const cacheDir = await mkdtemp(join(tmpdir(), 'cache-'))
  t.after(async () => { server.close(); await rm(dataDir, { recursive: true, force: true }); await rm(cacheDir, { recursive: true, force: true }) })
  await writeFile(join(dataDir, 'plugins.json'), JSON.stringify([]))

  // 第一轮:sitemap 只有 Bob/fresh(未收录)→ 留存 1 页
  routes['/sitemap.xml'] = '<urlset><url><loc>BASE/zh/plugins/Bob/fresh</loc></url></urlset>'
  await runWebCrawl({ dataDir, cacheDir, now: '2026-08-17', maxPages: 10, minIntervalMs: 0, dshfindBase: base, dshhubBase: base })
  let pages = JSON.parse(await readFile(join(dataDir, 'pages.json'), 'utf8'))
  assert.equal(pages.pages.length, 1); assert.equal(pages.pages[0].name, 'fresh-plugin')

  // 第二轮前:Bob/fresh 转正进 plugins.json;手工预置一条与 plugins.json 无关的旧页(留存语义);
  // 假站 sitemap 新增 Dave/newest(另一未命中页)
  await writeFile(join(dataDir, 'plugins.json'), JSON.stringify([{ slug: 'fresh', repo: 'Bob/fresh', type: 'plugin', source: 'github-topic' }]))
  const oldPages = JSON.parse(await readFile(join(dataDir, 'pages.json'), 'utf8'))
  oldPages.pages.push({ type: 'page', source: 'dshfind', url: `${base}/zh/plugins/Old/ghost`, name: 'old-ghost', author: 'Old', description: 'legacy', category: null, repoUrl: 'https://github.com/Old/ghost', external: { dshfind: {} } })
  await writeFile(join(dataDir, 'pages.json'), JSON.stringify(oldPages))
  routes['/sitemap.xml'] = '<urlset><url><loc>BASE/zh/plugins/Bob/fresh</loc></url><url><loc>BASE/zh/plugins/Dave/newest</loc></url></urlset>'

  await runWebCrawl({ dataDir, cacheDir, now: '2026-08-18', maxPages: 10, minIntervalMs: 0, dshfindBase: base, dshhubBase: base })

  pages = JSON.parse(await readFile(join(dataDir, 'pages.json'), 'utf8'))
  const names = pages.pages.map((p) => p.name)
  assert.ok(!names.includes('fresh-plugin'), '转正页(Bob/fresh)应被剔除')
  assert.ok(names.includes('newest-plugin'), '本轮新页(Dave/newest)应并入')
  assert.ok(names.includes('old-ghost'), '与 plugins.json 无关的旧页应保留')
  assert.equal(pages.pages.length, 2)
})

// 缺陷2:hub 单点故障作废整轮——catalog 500(fetchText 重试约 18s)不抛,合并/写盘照常
test('runWebCrawl: hub catalog 500 不抛,dshfind listedOn 合并照常落盘', async (t) => {
  const detailA = DETAIL('known-plugin', 'Acme', 'known')
  const server = http.createServer((req, res) => {
    if (req.url === '/catalog.json') { res.writeHead(500); return res.end('boom') }
    const routes = {
      '/sitemap.xml': '<urlset><url><loc>BASE/zh/plugins/Acme/known</loc></url></urlset>',
      '/zh/plugins/Acme/known': detailA,
    }
    const body = routes[req.url]?.replaceAll('BASE', `http://127.0.0.1:${server.address().port}`)
    if (body === undefined) { res.writeHead(404); return res.end() }
    const type = req.url === '/sitemap.xml' ? 'text/xml' : 'text/html'
    res.writeHead(200, { 'content-type': type }); res.end(body)
  })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  const dataDir = await mkdtemp(join(tmpdir(), 'data-'))
  const cacheDir = await mkdtemp(join(tmpdir(), 'cache-'))
  t.after(async () => { server.close(); await rm(dataDir, { recursive: true, force: true }); await rm(cacheDir, { recursive: true, force: true }) })
  await writeFile(join(dataDir, 'plugins.json'), JSON.stringify([{ slug: 'known', repo: 'Acme/known', type: 'plugin', source: 'github-topic' }]))

  const result = await runWebCrawl({ dataDir, cacheDir, now: '2026-08-17', maxPages: 10, minIntervalMs: 0, dshfindBase: base, dshhubBase: base })

  const plugins = JSON.parse(await readFile(join(dataDir, 'plugins.json'), 'utf8'))
  assert.deepEqual(plugins[0].listedOn.map((l) => l.source), ['dshfind'], 'hub 失败不影响 dshfind 合并')
  assert.equal(result.merges.length, 1)
  const pages = JSON.parse(await readFile(join(dataDir, 'pages.json'), 'utf8'))
  assert.ok(Array.isArray(pages.pages), '合并/写盘阶段照常执行')
})

// 缺陷2 对称:dshfind sitemap 拉取失败(404 快速失败)不抛,hub 归一文档照常合并
test('runWebCrawl: dshfind sitemap 失败不抛,hub 合并照常落盘', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/sitemap.xml') { res.writeHead(404); return res.end() }
    if (req.url === '/catalog.json') {
      const body = JSON.stringify({ schema: 'v0.4', packages: [{ id: 'hub1', name: 'hub-one', description: 'h', repository: 'https://github.com/Acme/known', author: { name: 'Acme' } }] })
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(body)
    }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  const dataDir = await mkdtemp(join(tmpdir(), 'data-'))
  const cacheDir = await mkdtemp(join(tmpdir(), 'cache-'))
  t.after(async () => { server.close(); await rm(dataDir, { recursive: true, force: true }); await rm(cacheDir, { recursive: true, force: true }) })
  await writeFile(join(dataDir, 'plugins.json'), JSON.stringify([{ slug: 'known', repo: 'Acme/known', type: 'plugin', source: 'github-topic' }]))

  const result = await runWebCrawl({ dataDir, cacheDir, now: '2026-08-17', maxPages: 10, minIntervalMs: 0, dshfindBase: base, dshhubBase: base })

  const plugins = JSON.parse(await readFile(join(dataDir, 'plugins.json'), 'utf8'))
  assert.deepEqual(plugins[0].listedOn.map((l) => l.source), ['dshhub'], 'dshfind 失败不影响 hub 合并')
  assert.equal(result.merges.length, 1)
})

// 复审 round 2(修复波次):合并去重键若按 url,hub 全部条目(LISTING_URL 恒同)会被折叠成 1 条
// 修复:去重键 = url#external.id(name 兜底)——hub 重复 url 但 id 不同必须全部保留
test('runWebCrawl: pages.json 去重按条目身份——3 个 hub 条目同 url 不同 id 全部保留', async (t) => {
  const LISTING = 'https://hub.omdsh.dev/projects.html'
  const server = http.createServer((req, res) => {
    if (req.url === '/catalog.json') {
      const body = JSON.stringify({ schema: 'v0.4', packages: [
        { id: 'hub1', name: 'hub-one', description: 'a', repository: 'https://github.com/None/hub-a', author: { name: 'A' } },
        { id: 'hub2', name: 'hub-two', description: 'b', repository: 'https://github.com/None/hub-b', author: { name: 'B' } },
        { id: 'hub3', name: 'hub-three', description: 'c', repository: 'https://github.com/None/hub-c', author: { name: 'C' } },
      ] })
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(body)
    }
    if (req.url === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'text/xml' }); return res.end('<urlset/>') }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  const dataDir = await mkdtemp(join(tmpdir(), 'data-'))
  const cacheDir = await mkdtemp(join(tmpdir(), 'cache-'))
  t.after(async () => { server.close(); await rm(dataDir, { recursive: true, force: true }); await rm(cacheDir, { recursive: true, force: true }) })
  await writeFile(join(dataDir, 'plugins.json'), JSON.stringify([]))
  // 预置旧留存:3 个 hub 条目(同 LISTING_URL,不同 external.dshhub.id)+ 1 个 dshfind 页
  const hubDoc = (id) => ({ type: 'page', source: 'dshhub', url: LISTING, name: `hub-${id}`, author: 'A', description: 'd', category: null, repoUrl: null, external: { dshhub: { id } } })
  await writeFile(join(dataDir, 'pages.json'), JSON.stringify({ version: 1, updatedAt: '2026-08-16', pages: [
    hubDoc('hub1'), hubDoc('hub2'), hubDoc('hub3'),
    { type: 'page', source: 'dshfind', url: `${base}/zh/plugins/Old/ghost`, name: 'old-ghost', author: 'Old', description: 'legacy', category: null, repoUrl: 'https://github.com/Old/ghost', external: { dshfind: {} } },
  ] }))

  await runWebCrawl({ dataDir, cacheDir, now: '2026-08-17', maxPages: 10, minIntervalMs: 0, dshfindBase: base, dshhubBase: base })

  const pages = JSON.parse(await readFile(join(dataDir, 'pages.json'), 'utf8'))
  const hubIds = pages.pages.filter((p) => p.source === 'dshhub').map((p) => p.external.dshhub.id).sort()
  assert.deepEqual(hubIds, ['hub1', 'hub2', 'hub3'], 'hub 重复 url 但 id 不同,3 条必须全部保留')
  assert.ok(pages.pages.some((p) => p.source === 'dshfind' && p.name === 'old-ghost'), '无关 dshfind 旧页保留')
  assert.equal(pages.pages.length, 4, '4 = 3 hub + 1 dshfind')
})
