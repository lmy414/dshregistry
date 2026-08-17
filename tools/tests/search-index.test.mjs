import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, buildIndex, assertBudget } from '../lib/search-index.js'

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
    ['wedding', 'we'], ['messing', 'me'], ['adding', 'ad'], ['kiss', 'ki'],
  ]) deny(input, term)
})
