/**
 * 存量重分类: 按新 12 能力域规则重推 web/data/plugins.json 的分类字段。
 *
 * 优先级与爬虫一致: 人工覆盖表(config/categories.json) > pkg 声明(dsh.registry.category,
 * 读 tools/.cache/pkg.json, 非法值忽略) > 关键词 > other。
 *
 * 幂等: 重跑不再产生变化。--dry-run 只打印不写盘。
 * 用法:
 *   node tools/reclassify.js            # 重推并原子写回
 *   node tools/reclassify.js --dry-run  # 只打印分布与变化,不写盘
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferCategory } from './crawl.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_FILE = join(ROOT, 'web', 'data', 'plugins.json')
const PKG_CACHE_FILE = join(ROOT, 'tools', '.cache', 'pkg.json')

const DRY_RUN = process.argv.includes('--dry-run')

const plugins = JSON.parse(await readFile(PLUGINS_FILE, 'utf8'))
const pkgCache = JSON.parse(await readFile(PKG_CACHE_FILE, 'utf8').catch(() => '{}'))

/** 插件记录 → 爬虫判定可用的 repo 形态(full_name/description/topics 与 crawl.js 的 hay 一致)。 */
function repoOf(p) {
  return { full_name: p.repo, description: p.description ?? null, topics: p.tags ?? [] }
}

function countBy(list) {
  const out = {}
  for (const x of list) out[x] = (out[x] || 0) + 1
  return out
}

const before = countBy(plugins.map((p) => p.category || 'other'))
let changed = 0
const moves = {}
for (const p of plugins) {
  const pkg = pkgCache[p.repo]?.pkg
  const next = inferCategory(pkg, repoOf(p))
  if (next !== (p.category || 'other')) {
    changed++
    const key = `${p.category || 'other'}→${next}`
    moves[key] = (moves[key] || 0) + 1
    p.category = next
  }
}

const after = countBy(plugins.map((p) => p.category))
const total = plugins.length
const pct = (n) => ((n / total) * 100).toFixed(1)

console.log(`[reclassify] 总记录 ${total},分类变化 ${changed} 条${DRY_RUN ? '(dry-run,未写盘)' : ''}`)
const allCats = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
for (const c of allCats) {
  console.log(`  ${c.padEnd(12)} ${String(before[c] ?? 0).padStart(5)} → ${String(after[c] ?? 0).padStart(5)}  (${pct(after[c] ?? 0)}%)`)
}
console.log(`[reclassify] other 占比: ${pct(before.other ?? 0)}% → ${pct(after.other ?? 0)}%`)
if (changed > 0 && Object.keys(moves).length > 0) {
  console.log('[reclassify] 迁移明细(旧→新 条数):')
  for (const [k, n] of Object.entries(moves).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${n}`)
}

if (!DRY_RUN) {
  await mkdir(dirname(PLUGINS_FILE), { recursive: true })
  const tmp = `${PLUGINS_FILE}.reclassify.tmp`
  await writeFile(tmp, JSON.stringify(plugins, null, 2) + '\n', 'utf8')
  await rename(tmp, PLUGINS_FILE)
  console.log('[reclassify] 已写回 plugins.json')
}
