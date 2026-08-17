// tools/tests/state.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteChecked, planRefresh, planGithubRefresh } from '../lib/state.js'

const NOW = Date.parse('2026-08-17T00:00:00Z')
const DAY = 86400000

test('noteChecked: 变化复位 unchangedRounds,未变递增', () => {
  const s = { version: 1, urls: {} }
  noteChecked(s, 'u1', { now: NOW, changed: true, hash: 'h1' })
  noteChecked(s, 'u1', { now: NOW + DAY, changed: false, hash: 'h1' })
  noteChecked(s, 'u1', { now: NOW + 2 * DAY, changed: true, hash: 'h2' })
  assert.deepEqual(s.urls.u1, { lastCheckedAt: NOW + 2 * DAY, lastChangedAt: NOW + 2 * DAY, unchangedRounds: 0, hash: 'h2' })
})

test('planRefresh: 未查过优先,其后最旧优先;新鲜跳过;预算截断', () => {
  const s = { version: 1, urls: {
    fresh: { lastCheckedAt: NOW - DAY, lastChangedAt: NOW - DAY, unchangedRounds: 1 },
    old:   { lastCheckedAt: NOW - 30 * DAY, lastChangedAt: NOW - 30 * DAY, unchangedRounds: 3 },
  } }
  const due = planRefresh(s, ['fresh', 'old', 'never'], { now: NOW, maxAgeMs: 7 * DAY, budget: 10 })
  assert.deepEqual(due, ['never', 'old'])
  const capped = planRefresh(s, ['old', 'never'], { now: NOW, maxAgeMs: 7 * DAY, budget: 1 })
  assert.deepEqual(capped, ['never'])
})

test('planGithubRefresh: 活跃窗口全选,长尾确定性轮转,预算上限', () => {
  const plugins = [
    { repo: 'o/active1', pushedAt: '2026-08-10' },
    { repo: 'o/active2', pushedAt: '2026-07-01' },
    ...Array.from({ length: 20 }, (_, i) => ({ repo: `o/tail${String(i).padStart(2, '0')}`, pushedAt: '2025-01-01' })),
  ]
  const args = { now: NOW, budget: 8, activeWindowDays: 90, round: 0 }
  const r0 = planGithubRefresh(plugins, args)
  assert.ok(r0.includes('o/active1') && r0.includes('o/active2'))
  assert.equal(r0.length, 8)
  assert.deepEqual(planGithubRefresh(plugins, args), r0, '同 round 结果必须确定')
  assert.notDeepEqual(planGithubRefresh(plugins, { ...args, round: 1 }), r0, '不同 round 轮转不同切片')
})

test('planGithubRefresh: wrap-around 轮转,T mod R ≠ 0 时不饥饿', () => {
  const plugins = [
    { repo: 'o/active1', pushedAt: '2026-08-10' },
    { repo: 'o/active2', pushedAt: '2026-07-01' },
    ...Array.from({ length: 20 }, (_, i) => ({ repo: `o/tail${String(i).padStart(2, '0')}`, pushedAt: '2025-01-01' })),
  ]
  const args = { now: NOW, budget: 8, activeWindowDays: 90 }
  const union = new Set()
  for (let round = 0; round < 4; round++) {
    const r = planGithubRefresh(plugins, { ...args, round })
    assert.deepEqual(planGithubRefresh(plugins, { ...args, round }), r, `round ${round} 同输入必须确定`)
    assert.ok(r.length <= args.budget, `round ${round} 长度不超过预算`)
    for (const repo of r) if (repo.startsWith('o/tail')) union.add(repo)
  }
  assert.equal(union.size, 20, '4 轮(T=20, rest=6, ceil=4)tail 入选并集应覆盖全部 20 个')
})
