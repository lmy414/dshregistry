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
