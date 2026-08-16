/**
 * 生成 sitemap.xml（SEO：为 Google 提供全部详情页静态入口）
 * 数据源: web/data/plugins.json → 输出: web/sitemap.xml
 * 由 sync.sh 在爬虫后自动调用；也可手动: node tools/gen-sitemap.js
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_FILE = join(ROOT, 'web', 'data', 'plugins.json')
const OUT_FILE = join(ROOT, 'web', 'sitemap.xml')
const BASE = 'https://dshregistry.xyz'

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const plugins = JSON.parse(await readFile(PLUGINS_FILE, 'utf8'))

const urls = []
// 静态页面
urls.push({ loc: `${BASE}/`, prio: '1.0', freq: 'daily' })
urls.push({ loc: `${BASE}/about.html`, prio: '0.5', freq: 'monthly' })
// 全部插件详情页（核心：让 Google 无需 JS 渲染即可发现）
for (const p of plugins) {
  if (!p.slug) continue
  urls.push({
    loc: `${BASE}/plugin.html?slug=${encodeURIComponent(p.slug)}`,
    prio: p.stars >= 20 ? '0.8' : '0.6',
    freq: 'weekly',
    lastmod: p.pushedAt || undefined,
  })
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${esc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${esc(u.lastmod)}</lastmod>` : ''}${u.freq ? `\n    <changefreq>${u.freq}</changefreq>` : ''}${u.prio ? `\n    <priority>${u.prio}</priority>` : ''}
  </url>`).join('\n')}
</urlset>
`

await writeFile(OUT_FILE, xml, 'utf8')
console.log(`[sitemap] 生成完成: ${urls.length} 个 URL (${plugins.length} 插件) → ${OUT_FILE}`)
