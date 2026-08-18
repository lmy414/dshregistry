/**
 * 拆分详情页数据: 从 plugins.json 生成单插件 JSON + 分类子集
 * 产物:
 *   web/data/plugin/<slug>.json    — 单个插件完整数据 (详情页主数据, ~1KB)
 *   web/data/by-cat/<cat>.json     — 分类子集 (相关推荐用, 小文件)
 * 由 sync.sh 在爬虫后自动调用; 也可手动: node tools/split-data.js
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_FILE = join(ROOT, 'web', 'data', 'plugins.json')
const PLUGIN_DIR = join(ROOT, 'web', 'data', 'plugin')
const BYCAT_DIR = join(ROOT, 'web', 'data', 'by-cat')
const CATS = ['tool', 'vision', 'dashboard', 'bridge', 'launcher', 'mcp', 'skill', 'memory', 'security', 'media', 'integration', 'other']

const plugins = JSON.parse(await readFile(PLUGINS_FILE, 'utf8'))

await mkdir(PLUGIN_DIR, { recursive: true })
await mkdir(BYCAT_DIR, { recursive: true })

// 单插件 JSON
let n = 0
for (const p of plugins) {
  if (!p.slug) continue
  await writeFile(join(PLUGIN_DIR, `${p.slug}.json`), JSON.stringify(p), 'utf8')
  n++
}

// 分类子集 (轻量字段, 只含相关推荐需要的)
const byCat = {}
for (const c of CATS) byCat[c] = []
for (const p of plugins) {
  if (!p.slug) continue
  const cat = p.category || 'other'
  if (!byCat[cat]) byCat[cat] = []
  byCat[cat].push({
    slug: p.slug, name: p.name, state: p.state, category: p.category,
    description: (p.description || '').slice(0, 120),
  })
}
for (const [c, list] of Object.entries(byCat)) {
  await writeFile(join(BYCAT_DIR, `${c}.json`), JSON.stringify(list), 'utf8')
}

console.log(`[split] 完成: 单插件 ${n} 个, 分类子集 ${Object.keys(byCat).length} 个`)
