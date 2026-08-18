// tools/tests/page-plugin.test.mjs — 详情页纯函数单测(M-B 增量 3)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidSlug, normalizeCategory, externalSectionData,
  listedOnSources, relatedCandidates, installCommand, CAT_WHITELIST,
} from '../../web/assets/plugin-render.js'

const mk = (over) => ({
  slug: 'demo', repo: 'omdsh/demo', installSpec: 'github:omdsh/demo#abc1234', ...over,
})

test('isValidSlug: 白名单字母数字 . _ -,非法 slug 一律 404 路径', () => {
  assert.equal(isValidSlug('aegis'), true)
  assert.equal(isValidSlug('dsh-vision-router'), true)
  assert.equal(isValidSlug('adb_dsh_plugin'), true)
  assert.equal(isValidSlug('7d7d'), true)
  assert.equal(isValidSlug('a.b_c-1'), true)
  assert.equal(isValidSlug(''), false)
  assert.equal(isValidSlug(null), false)
  assert.equal(isValidSlug('../../etc/passwd'), false)
  assert.equal(isValidSlug('a b'), false)
  assert.equal(isValidSlug('a/b'), false)
  assert.equal(isValidSlug('中文'), false)
})

test('normalizeCategory: 12 能力域白名单,未知回退 other', () => {
  assert.equal(CAT_WHITELIST.length, 12)
  assert.equal(normalizeCategory('vision'), 'vision')
  assert.equal(normalizeCategory('integration'), 'integration')
  assert.equal(normalizeCategory('unknown-new-cat'), 'other')
  assert.equal(normalizeCategory(null), 'other')
})

test('externalSectionData: 显隐三元组(有 dshfind/有 dshhub/皆无)', () => {
  assert.deepEqual(externalSectionData(mk()), { hasFind: false, hasHub: false, any: false, find: null, hub: null })
  assert.deepEqual(
    externalSectionData(mk({ external: { dshfind: { grade: 'S', score: 92 } } })),
    { hasFind: true, hasHub: false, any: true, find: { grade: 'S', score: 92 }, hub: null },
  )
  assert.deepEqual(
    externalSectionData(mk({ external: { dshhub: { status: 'beta' } } })),
    { hasFind: false, hasHub: true, any: true, find: null, hub: { status: 'beta' } },
  )
  assert.equal(
    externalSectionData(mk({ external: { dshfind: { grade: 'S', score: 92 }, dshhub: { status: 'discovery' } } })).any,
    true,
  )
  // dshfind 无 grade 且无 score → 不渲染该卡
  assert.equal(externalSectionData(mk({ external: { dshfind: { stars: null } } })).hasFind, false)
  // external 字段缺失 → 不渲染
  assert.equal(externalSectionData(mk({ external: null })).any, false)
})

test('listedOnSources: 源类名归一 + url 透传;无 url 置 null', () => {
  const p = mk({
    listedOn: [
      { source: 'dshfind', url: 'https://dshfind.com/zh/plugins/omdsh/demo' },
      { source: 'dshhub', url: 'https://hub.omdsh.dev/projects.html' },
      { source: 'custom', url: null },
    ],
  })
  assert.deepEqual(listedOnSources(p), [
    { source: 'dshfind', labelKey: 'dshfind', url: 'https://dshfind.com/zh/plugins/omdsh/demo' },
    { source: 'hub', labelKey: 'dshhub', url: 'https://hub.omdsh.dev/projects.html' },
    { source: 'custom', labelKey: 'custom', url: null },
  ])
  assert.deepEqual(listedOnSources(mk({ listedOn: null })), [])
  // 畸形条目忽略
  assert.deepEqual(listedOnSources(mk({ listedOn: [null, { source: 1 }] })), [])
})

test('relatedCandidates: 同分类候选排除自身 + 截断 4 条', () => {
  const list = [
    { slug: 'a' }, { slug: 'demo' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }, { slug: 'e' },
  ]
  assert.deepEqual(relatedCandidates(list, 'demo', 4).map((p) => p.slug), ['a', 'b', 'c', 'd'])
  assert.deepEqual(relatedCandidates(list, 'nope', 4).map((p) => p.slug), ['a', 'demo', 'b', 'c'])
  assert.deepEqual(relatedCandidates(list, 'demo', 2).map((p) => p.slug), ['a', 'b'])
  assert.deepEqual(relatedCandidates(null, 'demo'), [])
  // 无 slug 条目剔除
  assert.deepEqual(relatedCandidates([{ slug: null }, { slug: 'x' }], 'demo'), [{ slug: 'x' }])
})

test('installCommand: installSpec 优先,缺省回退 github:repo', () => {
  assert.equal(installCommand(mk()), 'dsh plugin --profile web add github:omdsh/demo#abc1234')
  assert.equal(installCommand(mk({ installSpec: null })), 'dsh plugin --profile web add github:omdsh/demo')
  assert.equal(installCommand(mk({ installSpec: null, repo: null })), 'dsh plugin --profile web add ')
})
