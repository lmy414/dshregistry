import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, buildIndex, assertBudget, pageSlugOf } from '../lib/search-index.js'

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

test('stem 回归:双写折叠仅作用于剥后缀中间串,无二次剥除', () => {
  const expect = (input, term) => assert.ok(tokenize(input).includes(term), `${input} 应产出 ${term}`)
  const deny = (input, term) => assert.ok(!tokenize(input).includes(term), `${input} 不应产出 ${term}`)
  for (const [input, term] of [
    ['running', 'run'], ['hopping', 'hop'], ['banned', 'ban'], ['kissing', 'kis'],
    ['passing', 'pas'], ['missing', 'mis'], ['wedding', 'wed'], ['messing', 'mes'],
    ['adding', 'add'], ['kiss', 'kis'], ['class', 'clas'],
  ]) expect(input, term)
  for (const [input, term] of [
    ['kissing', 'ki'], ['passing', 'pa'], ['missing', 'mi'],
    ['wedding', 'we'], ['adding', 'ad'], ['kissing', 'ki'],
  ]) deny(input, term)
})

// 缺陷3:search.json 全部 hub 页面 slug 碰撞(hub 条目 url 恒为 LISTING_URL)
// 修复:slug 带 external id(name/index 兜底)区分,pageSlugOf 由 build-search-index.js 复用
test('pageSlugOf: hub 同 LISTING_URL 多条目以 id 区分,无 id 落 name/index 兜底', () => {
  const LISTING = 'https://hub.omdsh.dev/projects.html'
  const hubA = { source: 'dshhub', url: LISTING, name: 'hub-one', external: { dshhub: { id: 'hub1' } } }
  const hubB = { source: 'dshhub', url: LISTING, name: 'hub-two', external: { dshhub: { id: 'hub2' } } }
  assert.equal(pageSlugOf(hubA, 0), `page:dshhub:${LISTING}#hub1`)
  assert.equal(pageSlugOf(hubB, 1), `page:dshhub:${LISTING}#hub2`)
  assert.notEqual(pageSlugOf(hubA, 0), pageSlugOf(hubB, 1), '两 slug 必须不同且含各自 id')
  // dshfind 无 external id → name 兜底;两者皆无 → index 兜底
  const find = { source: 'dshfind', url: 'https://dshfind.com/zh/plugins/A/B', name: 'bee', external: { dshfind: {} } }
  assert.equal(pageSlugOf(find, 3), 'page:dshfind:https://dshfind.com/zh/plugins/A/B#bee')
  assert.equal(pageSlugOf({ source: 'dshfind', url: 'u', name: null }, 7), 'page:dshfind:u#7')
})
