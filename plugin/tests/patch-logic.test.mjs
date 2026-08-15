/**
 * patch 文件操作逻辑单测:追加/提取/删除 insert 块、解析 insert 行。
 * 运行:node --test tests/patch-logic.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendInsertBlock,
  extractInsertBlocks,
  findBlockByInsertId,
  removeInsertBlock,
  parseInsertRows,
} from '../marketplace.mjs'

const BASE = `# 用户 patch 层
- insert:
    - id: dsh-dashboard
      name: 'dsh-dashboard'
      config:
        cacheTtlMs: 5000
`

test('extractInsertBlocks:识别块且不吞并注释', () => {
  const blocks = extractInsertBlocks(BASE)
  assert.equal(blocks.length, 1)
  assert.ok(blocks[0].includes('dsh-dashboard'))
  assert.ok(!blocks[0].includes('用户 patch 层'))
})

test('appendInsertBlock:空文件直接生成', () => {
  const out = appendInsertBlock('', 'dsh-marketplace', 'dsh-marketplace')
  assert.ok(out.startsWith('- insert:'))
  assert.ok(out.includes('id: dsh-marketplace'))
  assert.ok(out.includes("name: 'dsh-marketplace'"))
})

test('appendInsertBlock:保留既有内容,追加新块', () => {
  const out = appendInsertBlock(BASE, 'dsh-marketplace', 'dsh-marketplace')
  assert.ok(out.includes('dsh-dashboard'))
  assert.ok(out.includes('cacheTtlMs'))
  assert.ok(out.includes('id: dsh-marketplace'))
  // 仍是合法 YAML 顶层数组:两个 - insert:
  assert.equal(extractInsertBlocks(out).length, 2)
})

test('removeInsertBlock:删除目标块,保留其他块与注释', () => {
  const two = appendInsertBlock(BASE, 'dsh-marketplace', 'dsh-marketplace')
  const { text, removed } = removeInsertBlock(two, 'dsh-dashboard')
  assert.equal(removed, true)
  assert.ok(!text.includes('dsh-dashboard'))
  assert.ok(text.includes('dsh-marketplace'))
  assert.ok(text.includes('用户 patch 层'))
  // 再删剩下的,文件只剩注释
  const { text: final, removed: removed2 } = removeInsertBlock(text, 'dsh-marketplace')
  assert.equal(removed2, true)
  assert.ok(!final.includes('- insert:'))
  assert.ok(final.includes('用户 patch 层'))
})

test('removeInsertBlock:目标不存在时不动', () => {
  const { text, removed } = removeInsertBlock(BASE, 'ghost')
  assert.equal(removed, false)
  assert.equal(text, BASE)
})

test('parseInsertRows:解析 id/name,忽略 config 行', () => {
  const rows = parseInsertRows(BASE)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'dsh-dashboard')
  assert.equal(rows[0].name, 'dsh-dashboard')
})

test('findBlockByInsertId:命中与未命中', () => {
  assert.ok(findBlockByInsertId(BASE, 'dsh-dashboard') !== null)
  assert.equal(findBlockByInsertId(BASE, 'nope'), null)
})

test('引号包住的 name 也能识别', () => {
  const quoted = `- insert:\n    - id: x\n      name: "dsh-x"\n`
  assert.equal(parseInsertRows(quoted)[0].name, 'dsh-x')
})

test('真实场景:追加 -> 提取 -> 删除 全链路幂等', () => {
  let text = BASE
  for (let i = 0; i < 3; i++) {
    text = appendInsertBlock(text, `p${i}`, `dsh-p${i}`)
  }
  assert.equal(extractInsertBlocks(text).length, 4)
  const rows = parseInsertRows(text)
  assert.equal(rows.length, 4)
  const { text: t1 } = removeInsertBlock(text, 'p1')
  assert.ok(!t1.includes('dsh-p1'))
  assert.equal(extractInsertBlocks(t1).length, 3)
  const rows2 = parseInsertRows(t1)
  assert.deepEqual(rows2.map((r) => r.id), ['dsh-dashboard', 'p0', 'p2'])
})
