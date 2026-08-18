import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCategoryUrlParams, buildCategoryQuery, authorCounts, topAuthors,
  pickFeatured, displayUrl, parseQuery, applyFilters, pluginSources, pageStars,
} from '../../web/assets/search-core.js'

// ---- 精选卡:候选行 fixture ----
const mkRow = (slug, opts = {}) => ({
  kind: 'plugin',
  item: {
    slug,
    name: slug,
    repo: `omdsh/${slug}`,
    category: 'vision',
    state: opts.state ?? 'unreviewed',
    stars: opts.stars ?? 0,
    external: opts.grade ? { dshfind: { grade: opts.grade, score: opts.score ?? 70 } } : undefined,
  },
  score: opts.score ?? 0,
})

test('parseCategoryUrlParams: 提取 q/cat/author 缺省空串', () => {
  const params = new URLSearchParams('cat=vision&q=ocr&author=omdsh')
  assert.deepEqual(parseCategoryUrlParams(params), { q: 'ocr', cat: 'vision', author: 'omdsh' })
  assert.deepEqual(parseCategoryUrlParams(new URLSearchParams('')), { q: '', cat: '', author: '' })
  assert.deepEqual(parseCategoryUrlParams(null), { q: '', cat: '', author: '' })
})

test('buildCategoryQuery: 裸词与 cat:/author: 维度 AND 合成', () => {
  assert.equal(buildCategoryQuery({ q: 'ocr', cat: 'vision', author: 'omdsh' }), 'ocr cat:vision author:omdsh')
  assert.equal(buildCategoryQuery({ cat: 'vision' }), 'cat:vision')
  assert.equal(buildCategoryQuery({ q: '  dsh ' }), 'dsh')
  assert.equal(buildCategoryQuery({}), '')
})

test('parseQuery + applyFilters: cat:/author: 维度与裸词 AND 语义', () => {
  const plugs = [
    { slug: 'a', name: 'alpha-vision', repo: 'omdsh/alpha', category: 'vision', stars: 10 },
    { slug: 'b', name: 'beta-tool', repo: 'foo/beta', category: 'tool', stars: 20 },
  ]
  const parsed = parseQuery('cat:vision')
  assert.deepEqual(applyFilters(plugs, parsed.filters).map((p) => p.slug), ['a'])
  const parsed2 = parseQuery('author:omdsh')
  assert.deepEqual(applyFilters(plugs, parsed2.filters).map((p) => p.slug), ['a'])
})

test('authorCounts / topAuthors: 计数降序 + 子串过滤 + limit', () => {
  const plugs = [
    { repo: 'omdsh/a' }, { repo: 'omdsh/b' }, { repo: 'foo/c' }, { repo: 'x' },
  ]
  const pgs = [{ author: 'omdsh' }, { author: 'bar' }]
  const counts = authorCounts(plugs, pgs)
  const list = topAuthors(counts, '', 10)
  assert.deepEqual(list, [
    { author: 'omdsh', count: 3 },
    { author: 'bar', count: 1 },
    { author: 'foo', count: 1 },
    { author: 'x', count: 1 },
  ])
  assert.deepEqual(topAuthors(counts, 'OMD', 10).map((e) => e.author), ['omdsh'])
  assert.equal(topAuthors(counts, '', 1).length, 1)
  assert.equal(authorCounts([], []).size, 0)
})

test('pickFeatured: community + dshfind.grade 中按相关度最高取 1,无候选返回 null', () => {
  const rows = [
    mkRow('x', { state: 'community', grade: 'B', score: 40 }),
    mkRow('y', { state: 'unreviewed', grade: 'A', score: 99 }), // 非 community → 排除
    mkRow('z', { state: 'community', score: 200 }),             // 无 grade → 排除
    mkRow('w', { state: 'community', grade: 'S', score: 60 }),
  ]
  const pick = pickFeatured(rows)
  assert.ok(pick)
  assert.equal(pick.item.slug, 'w') // community+grade 中相关度最高(60 > 40)
  assert.equal(pickFeatured([]), null)
  assert.equal(pickFeatured([mkRow('n', { state: 'unreviewed', grade: 'S' })]), null)
})

test('displayUrl: 去协议去尾斜杠', () => {
  assert.equal(displayUrl('https://dshfind.com/zh/plugins/x/'), 'dshfind.com/zh/plugins/x')
  assert.equal(displayUrl('http://example.com'), 'example.com')
  assert.equal(displayUrl(''), '')
})

test('回归: search-core 与 page-search re-export 共享实现(精选卡逻辑经 page-search 路径可用)', async () => {
  const pageSearch = await import('../../web/assets/page-search.js')
  assert.equal(typeof pageSearch.parseQuery, 'function')
  assert.equal(typeof pageSearch.applyFilters, 'function')
  // page-search 的 parseQuery 与 search-core 同源
  const p = pageSearch.parseQuery('cat:tool stars:>100')
  assert.deepEqual(p.filters.cat, ['tool'])
  assert.deepEqual(p.filters.stars, ['>100'])
})
