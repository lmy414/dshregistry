// tools/tests/crawl-ext.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeOldRecord, migrateOldRecord, sourceOf, consumeBackfill } from '../crawl.js'

test('sourceOf: 三种渠道标记', () => {
  assert.equal(sourceOf({}), 'github-topic')
  assert.equal(sourceOf({ _seedCategory: 'tool' }), 'seeds')
  assert.equal(sourceOf({ _backfillFrom: 'dshfind' }), 'backfill:dshfind')
})

test('mergeOldRecord: fresh 替换 old 保留跨源字段,source 依 fresh 渠道', () => {
  const oldR = { slug: 'x', repo: 'A/x', listedOn: [{ source: 'dshfind' }], external: { dshfind: { score: 88 } }, source: 'github-topic', type: 'plugin' }
  const fresh = { slug: 'x', repo: 'A/x', source: 'backfill:dshfind', type: 'plugin' }
  const out = mergeOldRecord(oldR, fresh)
  assert.equal(out.listedOn[0].source, 'dshfind')
  assert.equal(out.external.dshfind.score, 88)
  assert.equal(out.source, 'backfill:dshfind')
  assert.equal(out.type, 'plugin')
})

test('migrateOldRecord: 旧记录无 type/source → 补 plugin/github-topic', () => {
  const out = migrateOldRecord({ slug: 'x', repo: 'A/x' }, new Set(), { state: 'unreviewed', reasons: ['r1'] })
  assert.equal(out.type, 'plugin')
  assert.equal(out.source, 'github-topic')
  assert.equal(out.state, 'unreviewed')
  assert.deepEqual(out.stateReasons, ['r1'])
  assert.equal(out.slug, 'x')
})

test('migrateOldRecord: repo 命中 seeds → source=seeds', () => {
  const out = migrateOldRecord({ slug: 'y', repo: 'B/y' }, new Set(['B/y']), { state: 'community', reasons: [] })
  assert.equal(out.source, 'seeds')
  assert.equal(out.type, 'plugin')
  assert.equal(out.state, 'community')
})

test('migrateOldRecord: 已有 type/source → 保留不覆盖', () => {
  const out = migrateOldRecord(
    { slug: 'z', repo: 'C/z', type: 'tool', source: 'backfill:dshfind' },
    new Set(['C/z']),
    { state: 'community', reasons: [] },
  )
  assert.equal(out.type, 'tool')
  assert.equal(out.source, 'backfill:dshfind')
})

test('consumeBackfill: 读取候选并清空文件;缺文件给空', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'))
  assert.deepEqual(await consumeBackfill(dir), [])
  await writeFile(join(dir, 'backfill.json'), JSON.stringify({ candidates: [{ repo: 'B/y', from: 'dshfind', firstSeenAt: '2026-08-17' }] }))
  const got = await consumeBackfill(dir)
  assert.equal(got.length, 1); assert.equal(got[0].repo, 'B/y')
  assert.deepEqual((JSON.parse(await readFile(join(dir, 'backfill.json'), 'utf8'))).candidates, [], '消费后清空')
  await rm(dir, { recursive: true, force: true })
})
