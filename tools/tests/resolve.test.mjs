import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGithubRepoUrl, keyOf, resolveDocs, mergeListedOn, preserveCrossSource } from '../lib/resolve.js'

test('parseGithubRepoUrl: 子路径裁剪 / .git / 保留段 / 非 github', () => {
  assert.deepEqual(parseGithubRepoUrl('https://github.com/Acme/Vision/issues/3'), { owner: 'Acme', repo: 'Vision', fullName: 'Acme/Vision' })
  assert.deepEqual(parseGithubRepoUrl('https://github.com/Acme/vision.git'), { owner: 'Acme', repo: 'vision', fullName: 'Acme/vision' })
  assert.equal(parseGithubRepoUrl('https://github.com/orgs/omdsh-dev/repositories'), null)
  assert.equal(parseGithubRepoUrl('https://github.com/features'), null)
  assert.equal(parseGithubRepoUrl('https://gitlab.com/Acme/vision'), null)
  assert.equal(parseGithubRepoUrl('not-a-url'), null)
})

test('resolveDocs: 命中合并 / 未命中反哺且留存 / 无仓库独立留存', () => {
  const docs = [
    { type: 'page', source: 'dshfind', url: 'https://dshfind.com/zh/plugins/A/x', name: 'x', author: 'A', description: '', repoUrl: 'https://github.com/A/x', external: { dshfind: { score: 88 } } },
    { type: 'page', source: 'dshfind', url: 'https://dshfind.com/zh/plugins/B/y', name: 'y', author: 'B', description: '', repoUrl: 'https://github.com/B/y', external: { dshfind: { score: 70 } } },
    { type: 'page', source: 'dshhub', url: 'https://hub.omdsh.dev/projects.html', name: 'z', author: null, description: '', repoUrl: null, external: { dshhub: {} } },
  ]
  const { merges, backfills, pages } = resolveDocs(docs, new Set(['a/x']), { backfillCap: 10, now: '2026-08-17' })
  assert.equal(merges.length, 1); assert.equal(merges[0].repoKey, 'a/x')
  assert.deepEqual(merges[0].entry, { source: 'dshfind', url: docs[0].url, firstSeenAt: '2026-08-17' })
  assert.equal(backfills.length, 1); assert.equal(backfills[0].repo, 'B/y'); assert.equal(backfills[0].from, 'dshfind')
  assert.equal(pages.length, 2, '未命中与无仓库文档都独立留存')
})

test('mergeListedOn: 幂等 + 跨源 external 保留', () => {
  const plugins = [{ slug: 'x', repo: 'A/x' }]
  const m1 = [{ repoKey: 'a/x', entry: { source: 'dshfind', url: 'u1', firstSeenAt: '2026-08-17' }, external: { dshfind: { score: 88 } } }]
  const r1 = mergeListedOn(plugins, m1, { now: '2026-08-17' })
  assert.equal(r1.mergedCount, 1)
  assert.equal(r1.plugins[0].listedOn.length, 1)
  const r2 = mergeListedOn(r1.plugins, m1, { now: '2026-08-18' })
  assert.equal(r2.mergedCount, 0, '同 source 重复合并应幂等')
  const m2 = [{ repoKey: 'a/x', entry: { source: 'dshhub', url: 'u2', firstSeenAt: '2026-08-18' }, external: { dshhub: { featured: true } } }]
  const r3 = mergeListedOn(r2.plugins, m2, { now: '2026-08-18' })
  assert.equal(r3.plugins[0].listedOn.length, 2)
  assert.equal(r3.plugins[0].external.dshfind.score, 88, '跨源 external 不得被覆盖')
  assert.equal(r3.plugins[0].external.dshhub.featured, true)
})

test('preserveCrossSource: fresh 替换 old 时保留 listedOn/external', () => {
  const oldR = { slug: 'x', repo: 'A/x', stars: 5, listedOn: [{ source: 'dshfind' }], external: { dshfind: { score: 88 } } }
  const fresh = { slug: 'x', repo: 'A/x', stars: 9 }
  const out = preserveCrossSource(oldR, fresh)
  assert.equal(out.stars, 9)
  assert.equal(out.listedOn[0].source, 'dshfind')
  assert.equal(out.external.dshfind.score, 88)
})
