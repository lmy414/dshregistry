import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  featuredPlugins, pinFeatured, authorLeaderboard, starsLeaderboard, growthLeaderboard,
  parseQuery, applyFilters, applyPageFilters, pluginMatchesTerms, pageMatchesTerms,
  relevanceScore, suggestForQuery, fmtNum, pluginSources, pageStars,
} from '../../web/assets/page-search.js'

const plugs = [
  { slug: 'a', name: 'alpha-vision', repo: 'omdsh/alpha', category: 'vision', state: 'community', stars: 100, listedOn: [{ source: 'dshfind' }], external: { dshfind: { grade: 'S', score: 85 }, dshhub: { featured: true, kind: 'ui' } } },
  { slug: 'b', name: 'beta-tool', repo: 'foo/beta', category: 'tool', state: 'unreviewed', stars: 500, tags: ['mcp'] },
  { slug: 'c', name: 'gamma', repo: 'omdsh/gamma', category: 'tool', state: 'community', stars: 50 },
]

test('featuredPlugins: 站长指定 slug 列表,按 stars 降序;空列表/未知 slug 处理', () => {
  // slugs 顺序无关,输出按 stars 降序
  assert.deepEqual(featuredPlugins(plugs, ['c', 'a']).map((p) => p.slug), ['a', 'c'])
  assert.deepEqual(featuredPlugins(plugs, ['c']).map((p) => p.slug), ['c'])
  assert.deepEqual(featuredPlugins(plugs, ['unknown-slug']), [], '未知 slug 跳过')
  assert.deepEqual(featuredPlugins(plugs, []), [], '空列表返回空')
  assert.deepEqual(featuredPlugins(plugs, null), [], 'null 返回空')
})

test('pinFeatured: 有精选命中时置顶,未命中原序不变', () => {
  const rows = [
    { kind: 'plugin', item: { slug: 'x' } },
    { kind: 'plugin', item: { slug: 'c' } },
    { kind: 'page', item: { name: 'w' } },
  ]
  const pinned = pinFeatured(rows, ['c'])
  assert.equal(pinned[0].item.slug, 'c', '命中精选置顶')
  assert.equal(pinned.length, 3)
  assert.deepEqual(pinFeatured(rows, ['nope']), rows, '未命中保持原序')
  assert.deepEqual(pinFeatured(rows, []), rows, '空列表保持原序')
})

test('authorLeaderboard / starsLeaderboard / growthLeaderboard', () => {
  assert.deepEqual(authorLeaderboard(plugs), [
    { author: 'omdsh', count: 2 },
    { author: 'foo', count: 1 },
  ])
  assert.deepEqual(starsLeaderboard(plugs).map((p) => p.slug), ['b', 'a', 'c'])
  assert.deepEqual(growthLeaderboard({ items: [
    { slug: 'x', name: 'xx', delta: 3 },
    { slug: 'y', name: 'yy', delta: 9 },
    { slug: 'z', name: 'zz', delta: 1 },
  ] }, 2).map((i) => i.slug), ['y', 'x'])
  assert.deepEqual(growthLeaderboard(null), [])
})

test('parseQuery: 维度过滤器与裸词拆分', () => {
  const q = parseQuery('cat:tool vision author:omdsh stars:>100 src:dshfind score:a')
  assert.deepEqual(q.terms, ['vision'])
  assert.deepEqual(q.filters, {
    cat: ['tool'], author: ['omdsh'], stars: ['>100'], src: ['dshfind'], score: ['A'],
  })
  // 无值维度不产生过滤器
  const empty = parseQuery('cat:  ')
  assert.deepEqual(empty.filters.cat, [])
  assert.deepEqual(empty.terms, [])
})

test('applyFilters: cat/src/score 精确、author 子串、stars:>n 表达式', () => {
  assert.deepEqual(applyFilters(plugs, { cat: ['tool'], author: [], stars: [], src: [], score: [] }).map((p) => p.slug), ['b', 'c'])
  assert.deepEqual(applyFilters(plugs, { cat: [], author: ['omdsh'], stars: [], src: [], score: [] }).map((p) => p.slug), ['a', 'c'])
  assert.deepEqual(applyFilters(plugs, { cat: [], author: [], stars: ['>100'], src: [], score: [] }).map((p) => p.slug), ['b'])
  assert.deepEqual(applyFilters(plugs, { cat: [], author: [], stars: ['>50'], src: [], score: [] }).map((p) => p.slug), ['a', 'b'])
  assert.deepEqual(applyFilters(plugs, { cat: [], author: [], stars: [], src: ['dshfind'], score: [] }).map((p) => p.slug), ['a'])
  assert.deepEqual(applyFilters(plugs, { cat: [], author: [], stars: [], src: [], score: ['S'] }).map((p) => p.slug), ['a'])
  assert.deepEqual(applyFilters(plugs, { cat: [], author: [], stars: [], src: [], score: ['B'] }), [])
})

test('pluginMatchesTerms / pageMatchesTerms: 裸词 AND(子串 + 倒排索引)', () => {
  const index = { vision: [[0, 3]], mcp: [[1, 2]] }
  // 子串命中
  assert.ok(pluginMatchesTerms(plugs[0], ['alpha'], 0, index))
  // 倒排命中(名称不含但词项命中)
  assert.ok(pluginMatchesTerms(plugs[0], ['vision'], 0, index))
  // AND:两词都需命中
  assert.ok(!pluginMatchesTerms(plugs[0], ['alpha', 'mcp'], 0, index))
  assert.ok(!pluginMatchesTerms(plugs[1], ['vision'], 1, index))
  const w = { name: 'DeepSeek Harness Desktop', author: 'abc', description: 'gui app' }
  assert.ok(pageMatchesTerms(w, ['desktop']))
  assert.ok(!pageMatchesTerms(w, ['desktop', 'missing']))
})

test('relevanceScore: 词项得分和 + stars 归一 + dshfind score 加成', () => {
  const idx = { vision: [[0, 3]], tui: [[0, 2]] }
  const a = relevanceScore({ docIdx: 0, terms: ['vision'], index: idx, stars: 100, maxStars: 500, hasDshfindScore: true })
  const b = relevanceScore({ docIdx: 0, terms: ['vision'], index: idx, stars: 100, maxStars: 500, hasDshfindScore: false })
  assert.equal(b, 3 * 10 + 100 / 500 * 50)   // 40
  assert.equal(a, b * 1.05)                   // 42
  const multi = relevanceScore({ docIdx: 0, terms: ['vision', 'tui'], index: idx, stars: 0, maxStars: 500, hasDshfindScore: false })
  assert.equal(multi, 5 * 10)                 // 词项得分求和
})

test('suggestForQuery: 维度前缀列可选值、裸词前缀匹配、插件项带 label', () => {
  assert.ok(suggestForQuery('cat:', plugs, [{ key: 'tool', label: '工具' }, { key: 'vision', label: '视觉' }])
    .some((x) => x.value === 'cat:tool'))
  assert.deepEqual(suggestForQuery('stars:', plugs).map((x) => x.value), ['stars:>100', 'stars:>500'])
  assert.deepEqual(suggestForQuery('src:', plugs).map((x) => x.value), ['src:github', 'src:dshfind', 'src:dshhub'])
  assert.deepEqual(suggestForQuery('score:', plugs).map((x) => x.value), ['score:S'])
  // 裸词前缀匹配 name/repo/tags
  const items = suggestForQuery('al', plugs, [])
  assert.ok(items.some((x) => x.type === 'plugin' && x.label === 'alpha-vision'))
  const byTag = suggestForQuery('mc', plugs, [])
  assert.ok(byTag.some((x) => x.label === 'beta-tool'))
  assert.equal(suggestForQuery('', plugs, []).length, 0)
})

test('fmtNum / pluginSources / pageStars', () => {
  assert.equal(fmtNum(1200), '1.2k')
  assert.equal(fmtNum(10000), '10k')
  assert.equal(fmtNum(980), '980')
  assert.equal(fmtNum(null), '0')
  assert.deepEqual(pluginSources(plugs[0]), ['github', 'dshfind'])
  assert.deepEqual(pluginSources({ repo: 'x/y' }), ['github'])
  assert.equal(pageStars({ source: 'dshfind', external: { dshfind: { stars: 7 } } }), 7)
  assert.equal(pageStars({ source: 'dshhub', external: { dshhub: { stars: 3 } } }), 3)
  assert.equal(pageStars({}), null)
})

test('回归: 联想项必须能解析出非空查询串(it.value ?? it.label)', async () => {
  const { suggestForQuery } = await import('../../web/assets/page-search.js')
  const plugs = [
    { slug: 'alpha-vision', name: 'alpha-vision', repo: 'Acme/alpha-vision', category: 'vision', tags: ['ocr'], stars: 100 },
  ]
  const items = [...suggestForQuery('al', plugs, []), ...suggestForQuery('cat:', plugs, [{ key: 'vision', label: '视觉' }])]
  assert.ok(items.length > 0)
  for (const it of items) {
    const q = it.value ?? it.label
    assert.ok(typeof q === 'string' && q.length > 0, `联想项缺 value/label: ${JSON.stringify(it)}`)
  }
})
