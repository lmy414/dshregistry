// tools/tests/changelog.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEntry, appendEntries } from '../lib/changelog.js'

test('appendEntries: 新条目在前,90 天轮转,5000 条上限', () => {
  const now = Date.parse('2026-08-17T00:00:00Z')
  let log = { version: 1, entries: [{ ts: '2026-05-01T00:00:00.000Z', type: 'added', slug: 'old', source: 'github-topic' }] }
  log = appendEntries(log, [makeEntry('added', 'new', { source: 'github-topic', now: '2026-08-17' })], { now })
  assert.equal(log.entries[0].slug, 'new')
  assert.equal(log.entries.length, 1, '超 90 天条目被轮转')
  const many = Array.from({ length: 6000 }, (_, i) => makeEntry('updated', `p${i}`, { source: 'github-topic', now: '2026-08-17' }))
  const capped = appendEntries({ version: 1, entries: [] }, many, { now })
  assert.equal(capped.entries.length, 5000)
})
