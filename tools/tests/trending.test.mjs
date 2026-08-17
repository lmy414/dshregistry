// tools/tests/trending.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffStars } from '../lib/trending.js'

test('diffStars: 正增长排序 Top N,零/负增长剔除,冷启动为空', () => {
  const plugins = [
    { slug: 'a', name: 'A', repo: 'o/a', stars: 100 },
    { slug: 'b', name: 'B', repo: 'o/b', stars: 50 },
    { slug: 'c', name: 'C', repo: 'o/c', stars: 10 },
  ]
  assert.deepEqual(diffStars({}, plugins, { top: 20 }), [], '冷启动:无快照不出假数据')
  const snap = { 'o/a': 90, 'o/b': 50, 'o/c': 5 }
  const out = diffStars(snap, plugins, { top: 20 })
  assert.deepEqual(out.map((i) => [i.slug, i.delta]), [['a', 10], ['c', 5]])
})
