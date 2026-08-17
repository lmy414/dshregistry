// tools/tests/dshhub.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCatalog, normalizeEntry } from '../sources/dshhub.js'

const SAMPLE = JSON.stringify({
  schema: 'dsh-hub-index/v0.4',
  packages: [
    { id: 'acme-vision', name: 'ACME 视觉', description: 'OCR 与截图理解', kind: 'ui', category: 'interface',
      tags: ['ocr'], author: { name: 'Acme', url: 'https://github.com/Acme' },
      repository: 'https://github.com/omdsh-dev/acme-vision', ref: 'abc123', updatedAt: '2026-08-13T20:55:45+08:00',
      version: '0.4.0', license: 'MIT', status: 'beta', featured: true, compatibility: '已验证' },
    { id: 'no-repo', name: '无仓库条目', description: '边界样本' },
  ],
})

test('parseCatalog: 取 packages 数组', () => {
  assert.equal(parseCatalog(SAMPLE).length, 2)
})

test('normalizeEntry: 契约 + 缺字段容忍', () => {
  const [a, b] = parseCatalog(SAMPLE).map(normalizeEntry)
  assert.equal(a.type, 'page'); assert.equal(a.source, 'dshhub')
  assert.equal(a.repoUrl, 'https://github.com/omdsh-dev/acme-vision')
  assert.equal(a.author, 'Acme')
  assert.equal(a.external.dshhub.featured, true)
  assert.equal(a.external.dshhub.status, 'beta')
  assert.equal(b.repoUrl, null); assert.equal(b.author, null)
})
