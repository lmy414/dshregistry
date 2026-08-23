/**
 * 轻量插件索引(index.json)回归测试:
 *  1) lib/search-index.js 的 toLitePlugin/compactExternal 字段白名单行为;
 *  2) 前端 search-core.js 对轻量形态(srcs 预计算)的兼容 —— 爬虫链每次重建 index.json,
 *     若字段形状与前端消费不一致,在这里第一时间发现。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toLitePlugin, compactExternal } from '../lib/search-index.js'
import { pluginSources, applyFilters, featuredPlugins } from '../../web/assets/search-core.js'

const FULL = {
  slug: 'demo',
  name: 'Demo Plugin',
  version: '1.2.3',
  repo: 'omdsh/demo',
  githubUrl: 'https://github.com/omdsh/demo',
  description: 'A demo',
  tags: ['a', 'b'],
  stars: 42,
  forks: 3,
  pushedAt: '2026-01-02',
  firstSeenAt: '2026-01-01',
  latestCommit: 'abc1234',
  installSpec: 'github:omdsh/demo#abc1234',
  readmeUrl: 'data/readme/demo.html',
  license: 'MIT',
  state: 'community',
  stateReasons: ['✓ 很棒'],
  featured: true,
  basicCheck: true,
  listedOn: [
    { source: 'dshfind', url: 'https://x' },
    { source: 'dshfind', url: 'https://dup' }, // 去重
    { source: 'dshhub', url: 'https://y' },
  ],
  external: {
    dshfind: { grade: 'S', score: 88, badges: [], stars: null, weeklyGrowth: null },
    dshhub: { featured: true, kind: 'insider', status: 'beta', id: 'keep-out' },
  },
}

test('toLitePlugin: 白名单字段,重字段全部剔除', () => {
  const p = toLitePlugin(FULL)
  // 保留
  for (const k of ['slug', 'name', 'repo', 'description', 'tags', 'stars', 'pushedAt', 'firstSeenAt', 'category', 'state', 'installSpec']) {
    assert.ok(k in p, `缺字段 ${k}`)
  }
  assert.equal(p.featured, true)
  assert.deepEqual(p.srcs, ['dshfind', 'dshhub'])
  // 剔除(详情页走 plugin/<slug>.json)
  for (const k of ['version', 'githubUrl', 'forks', 'latestCommit', 'readmeUrl', 'license', 'authorCreatedAt', 'stateReasons', 'basicCheck', 'listedOn']) {
    assert.ok(!(k in p), `应剔除 ${k}`)
  }
})

test('compactExternal: 仅保留前端消费点,badges/null 全丢', () => {
  const ext = compactExternal(FULL.external)
  assert.deepEqual(ext.dshfind, { grade: 'S', score: 88 })
  assert.deepEqual(ext.dshhub, { featured: true, kind: 'insider', status: 'beta' })
  assert.equal(compactExternal(undefined), undefined)
  assert.equal(compactExternal({ dshfind: { stars: null } }), undefined)
})

test('非 featured / 无 installSpec 时字段整体缺席(省字节)', () => {
  const p = toLitePlugin({ ...FULL, featured: false, installSpec: '' })
  assert.ok(!('featured' in p))
  assert.ok(!('installSpec' in p))
})

test('pluginSources:轻量 srcs 形态与全量 listedOn 形态结果一致', () => {
  const lite = toLitePlugin(FULL)
  assert.deepEqual(pluginSources(lite), pluginSources(FULL))
  assert.deepEqual(pluginSources({}), ['github'])
  assert.deepEqual(pluginSources(null), ['github'])
})

test('轻量行可直接走 applyFilters(score:/src:/stars:) 与精选榜', () => {
  const rows = [toLitePlugin(FULL), toLitePlugin({ ...FULL, slug: 'weak', stars: 1, featured: false })]
  const hit = applyFilters(rows, { cat: [], author: [], stars: ['>10'], src: ['dshhub'], score: ['S'] })
  assert.equal(hit.length, 1)
  assert.equal(hit[0].slug, 'demo')
  const fp = featuredPlugins(rows, ['demo'])
  assert.equal(fp.length, 1)
})
