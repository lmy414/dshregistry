// tools/tests/crawl-ext.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeOldRecord, sourceOf, consumeBackfill } from '../crawl.js'

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

test('consumeBackfill: 读取候选并清空文件;缺文件给空', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'))
  assert.deepEqual(await consumeBackfill(dir), [])
  await writeFile(join(dir, 'backfill.json'), JSON.stringify({ candidates: [{ repo: 'B/y', from: 'dshfind', firstSeenAt: '2026-08-17' }] }))
  const got = await consumeBackfill(dir)
  assert.equal(got.length, 1); assert.equal(got[0].repo, 'B/y')
  assert.deepEqual((JSON.parse(await readFile(join(dir, 'backfill.json'), 'utf8'))).candidates, [], '消费后清空')
  await rm(dir, { recursive: true, force: true })
})
