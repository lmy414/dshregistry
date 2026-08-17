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
