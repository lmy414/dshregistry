import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSiteStats, formatUpdatedAt, API_ENDPOINTS, apiEndpointRows,
} from '../../web/assets/docs-core.js'

test('buildSiteStats: meta → 4 张统计卡值(id 顺序与 docs.html 一致)', () => {
  const meta = { pluginCount: 2439, categoryCount: 12, communityCount: 70, updatedAt: '2026-08-18T01:54:48.191Z' }
  const stats = buildSiteStats(meta, formatUpdatedAt)
  assert.equal(stats[0].value, '2439')
  assert.equal(stats[1].value, '12')
  assert.equal(stats[2].value, '70')
  // 更新时间 = YYYY-MM-DD HH:MM(完整日期时间,服务器 b262904;本地时区渲染,断言格式不锁具体值)
  assert.match(stats[3].value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, `更新时间格式 ("${stats[3].value}")`)
})

test('buildSiteStats: 缺失字段回退占位符;meta 为空/非对象同样占位', () => {
  const stats = buildSiteStats({})
  assert.equal(stats[0].value, '—')
  assert.equal(stats[1].value, '—')
  assert.equal(stats[2].value, '—')
  assert.equal(stats[3].value, '—')
  for (const bad of [null, undefined, 42, 'x']) {
    assert.deepEqual(buildSiteStats(bad).map((s) => s.value), ['—', '—', '—', '—'])
  }
})

test('buildSiteStats: 自定义格式化钩子(更新时间渲染可注入)', () => {
  const stats = buildSiteStats({ updatedAt: '2026-08-18T01:54:48.191Z' }, (v) => `FMT:${v}`)
  assert.equal(stats[3].value, 'FMT:2026-08-18T01:54:48.191Z')
})

test('formatUpdatedAt: ISO → YYYY-MM-DD HH:MM;空值占位', () => {
  assert.match(formatUpdatedAt('2026-08-18T01:54:48.191Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, `格式 ("${formatUpdatedAt('2026-08-18T01:54:48.191Z')}")`)
  assert.equal(formatUpdatedAt(''), '—')
  assert.equal(formatUpdatedAt(null), '—')
  assert.equal(formatUpdatedAt(undefined), '—')
})

test('API_ENDPOINTS: 端点清单与 web/data 实际产物一一对应(8 个)', () => {
  assert.equal(API_ENDPOINTS.length, 8)
  const paths = API_ENDPOINTS.map((e) => e.path)
  assert.ok(paths.includes('/data/plugins.json'))
  assert.ok(paths.includes('/data/search.json'))
  assert.ok(paths.includes('/data/changelog.json'))
  assert.ok(paths.includes('/data/trending.json'))
  assert.ok(paths.includes('/data/pages.json'))
  assert.ok(paths.includes('/data/plugin/&lt;slug&gt;.json'))
  assert.ok(paths.includes('/data/by-cat/&lt;cat&gt;.json'))
  assert.ok(paths.includes('/data/meta.json'))
})

test('apiEndpointRows: 每行含 <code> 端点路径与 i18n 说明;t 缺省回退 key', () => {
  const rows = apiEndpointRows(API_ENDPOINTS.slice(0, 2), (k) => `##${k}##`)
  assert.equal(rows.length > 0, true)
  assert.ok(rows.includes('<code>/data/plugins.json</code>'))
  assert.ok(rows.includes('##docs.api.plugins##'))
  // 无 t 时说明回退为端点 key
  const noT = apiEndpointRows(API_ENDPOINTS.slice(0, 1))
  assert.ok(noT.includes('class="api-desc">plugins</td>'))
})

test('回归: page-docs re-export 与 docs-core 同源', async () => {
  const pageDocs = await import('../../web/assets/page-docs.js')
  assert.equal(typeof pageDocs.buildSiteStats, 'function')
  assert.equal(typeof pageDocs.apiEndpointRows, 'function')
  assert.deepEqual(pageDocs.API_ENDPOINTS, API_ENDPOINTS)
})
