// tools/tests/crawler.test.mjs — Crawlee 底座测试(本地假站,不打外网)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCheerioRunner } from '../lib/crawler.js'
import { CRAWL_UA } from '../lib/http.js'

async function fakeSite(pages) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, at: Date.now(), ua: req.headers['user-agent'] })
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

test('UA: 出站请求头 User-Agent === DSHRegistryBot/1.0', async () => {
  const { server, hits, base } = await fakeSite({ '/a': '<h1>a</h1>' })
  const dir = await mkdtemp(join(tmpdir(), 'crawlee-'))
  const c = createCheerioRunner({ storageDir: dir, minIntervalMs: 0, requestHandler: async () => {} })
  await c.run([`${base}/a`])
  assert.equal(hits[0].ua, CRAWL_UA)
  server.close(); await rm(dir, { recursive: true, force: true })
})

test('白名单:非白名单 URL 请求失败且不触达网络', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crawlee-'))
  const failed = []
  const c = createCheerioRunner({
    storageDir: dir, minIntervalMs: 0,
    requestHandler: async () => { throw new Error('不应触达 requestHandler') },
    failedRequestHandler: async ({ request, error }) => {
      failed.push({ url: request.url, msg: error?.message ?? '', cause: error?.cause?.message ?? '' })
    },
  })
  await c.run(['https://evil.com/x'])
  assert.equal(failed.length, 1, '非白名单 URL 应走 failedRequestHandler')
  assert.equal(failed[0].url, 'https://evil.com/x')
  const text = `${failed[0].msg} | ${failed[0].cause}`
  assert.match(text, /禁止抓取非白名单/, `失败原因应为白名单拒绝而非网络错误: ${text}`)
  await rm(dir, { recursive: true, force: true })
})
