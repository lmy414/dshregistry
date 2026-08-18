import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSitemap, extractDetail, normalize } from '../sources/dshfind.js'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dshfind-detail.html')

test('parseSitemap: 只取 /zh/plugins/<owner>/<name>,去重排序', () => {
  const xml = `<urlset>
    <url><loc>https://dshfind.com/zh/plugins/Acme/acme-vision</loc></url>
    <url><loc>https://dshfind.com/en/plugins/Acme/acme-vision</loc></url>
    <url><loc>https://dshfind.com/zh/plugins/Bob/bob-tool</loc></url>
    <url><loc>https://dshfind.com/zh/learn</loc></url>
    <url><loc>https://dshfind.com/zh/login</loc></url>
  </urlset>`
  assert.deepEqual(parseSitemap(xml), [
    'https://dshfind.com/zh/plugins/Acme/acme-vision',
    'https://dshfind.com/zh/plugins/Bob/bob-tool',
  ])
})

test('extractDetail: 评分/徽章/增长/仓库/描述', async () => {
  const html = await readFile(FIX, 'utf8')
  const raw = extractDetail(html, 'https://dshfind.com/zh/plugins/Acme/acme-vision')
  assert.equal(raw.name, 'acme-vision')
  assert.equal(raw.author, 'Acme')
  assert.deepEqual(raw.score, { grade: 'B', score: 57 })
  assert.deepEqual(raw.badges.sort(), ['featured', 'insider'])
  assert.deepEqual(raw.growth, { stars: 128, weeklyGrowth: 12 })
  assert.equal(raw.repoUrl, 'https://github.com/Acme/acme-vision')
  assert.ok(raw.description.includes('视觉识别'))
})

test('extractDetail: 千分位大数字(真站 ≥1000 格式 "2,438"/"+1,186")', () => {
  const html = `<html><body>
<h1>modlens<span title="综合评分">S<span class="opacity-80">85</span></span></h1>
<div><div class="mt-1 text-xl font-bold tabular-nums">2,438<span class="ml-1.5 text-sm font-medium text-emerald-600">+<!-- -->1,186</span></div>
<div class="text-[11px] text-muted-foreground">近 7 天增长</div></div>
<script type="application/ld+json">{"@type":"SoftwareSourceCode","name":"modlens","codeRepository":"https://github.com/liustack/modlens"}</script>
</body></html>`
  const raw = extractDetail(html, 'https://dshfind.com/zh/plugins/liustack/modlens')
  assert.deepEqual(raw.growth, { stars: 2438, weeklyGrowth: 1186 })
})

test('normalize: 网页文档契约,描述 ≤200 字', async () => {
  const html = await readFile(FIX, 'utf8')
  const doc = normalize(extractDetail(html, 'https://dshfind.com/zh/plugins/Acme/acme-vision'))
  assert.equal(doc.type, 'page'); assert.equal(doc.source, 'dshfind')
  assert.ok(doc.description.length <= 200)
  assert.deepEqual(doc.external.dshfind, { grade: 'B', score: 57, badges: ['featured', 'insider'], stars: 128, weeklyGrowth: 12 })
})
