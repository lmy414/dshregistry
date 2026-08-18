// tools/tests/dshhub.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCatalog, normalizeEntry, dedupeEntries } from '../sources/dshhub.js'

// 官方 api/v1/plugins.json(omdsh-ai-market/v1)形态
const SAMPLE = JSON.stringify({
  schema: 'omdsh-ai-market/v1',
  projects: [
    { id: 'acme-vision', name: 'ACME 视觉', summary: 'OCR 与截图理解', kind: 'ui',
      categories: ['interface', 'vision'], tags: ['ocr'],
      source: { repository: 'https://github.com/omdsh-dev/acme-vision', ref: 'abc123', path: null },
      identity: { fullName: 'omdsh-dev/acme-vision', repository: 'https://github.com/omdsh-dev/acme-vision' },
      review: { state: 'pending-review' },
      verification: { state: 'current-baseline-passed', baseline: '@deepseek-ai/dsh@0.1.0-rc.6' },
      registry: { state: 'ineligible' },
      discovery: { createdAt: '2026-08-13T13:02:29.000Z' } },
    { id: 'no-repo', name: '无仓库条目', summary: '边界样本' },
  ],
})

test('parseCatalog: 取 projects 数组;schema 不符抛错', () => {
  assert.equal(parseCatalog(SAMPLE).length, 2)
  assert.throws(() => parseCatalog('{"schema":"v0.4","packages":[]}'), /projects/)
})

test('normalizeEntry: 契约 + 缺字段容忍', () => {
  const [a, b] = parseCatalog(SAMPLE).map(normalizeEntry)
  assert.equal(a.type, 'page'); assert.equal(a.source, 'dshhub')
  assert.equal(a.repoUrl, 'https://github.com/omdsh-dev/acme-vision')
  assert.equal(a.author, 'omdsh-dev')
  assert.deepEqual(a.external.dshhub.categories, ['interface', 'vision'])
  assert.equal(a.external.dshhub.review, 'pending-review')
  assert.equal(a.external.dshhub.verification, 'current-baseline-passed')
  assert.equal(a.external.dshhub.registry, 'ineligible')
  assert.equal(b.repoUrl, null); assert.equal(b.author, null)
  assert.ok(b.description.length <= 200)
})

test('dedupeEntries: 同 repo 多条目只留主类型一条;无仓库条目不聚合', () => {
  const docs = [
    { type: 'page', source: 'dshhub', url: 'u', name: '玩具箱本体', repoUrl: 'https://github.com/omdsh-dev/toybox', external: { dshhub: { id: 'toybox', kind: 'toolkit' } } },
    { type: 'page', source: 'dshhub', url: 'u', name: '老黄历 MCP', repoUrl: 'https://github.com/omdsh-dev/toybox', external: { dshhub: { id: 'almanac-mcp', kind: 'mcp' } } },
    { type: 'page', source: 'dshhub', url: 'u', name: 'Bug 驯兽师', repoUrl: 'https://github.com/omdsh-dev/toybox', external: { dshhub: { id: 'bug-tamer', kind: 'skill' } } },
    { type: 'page', source: 'dshhub', url: 'u', name: '独立插件', repoUrl: 'https://github.com/fishquito7/dsh-skill-viewer', external: { dshhub: { id: 'skill-viewer', kind: 'skill' } } },
    { type: 'page', source: 'dshhub', url: 'u', name: '无仓库条目', repoUrl: null, external: { dshhub: { id: 'norepo', kind: 'ui' } } },
  ]
  const out = dedupeEntries(docs)
  assert.equal(out.length, 3, '8→3: 玩具箱合并为 1,独立仓库保留,无仓库保留')
  const toy = out.find((d) => d.external.dshhub.id === 'toybox')
  assert.ok(toy, '保留主类型(toolkit)条目')
  assert.equal(out.filter((d) => d.repoUrl?.includes('toybox')).length, 1)
  assert.ok(out.some((d) => d.external.dshhub.id === 'skill-viewer'))
  assert.ok(out.some((d) => d.external.dshhub.id === 'norepo'))
})
