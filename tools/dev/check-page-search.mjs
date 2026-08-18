/**
 * 轻量验证脚本:用真实 web/data 数据跑 page-search.js 核心纯函数。
 * 用法: node tools/dev/check-page-search.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  featuredPlugins, authorLeaderboard, starsLeaderboard, growthLeaderboard,
  parseQuery, applyFilters, applyPageFilters, pluginMatchesTerms, pageMatchesTerms,
  relevanceScore, suggestForQuery, pluginSources,
} from '../../web/assets/page-search.js'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'data')
const plugins = JSON.parse(await readFile(join(DATA, 'plugins.json'), 'utf8'))
const search = JSON.parse(await readFile(join(DATA, 'search.json'), 'utf8'))
const trending = JSON.parse(await readFile(join(DATA, 'trending.json'), 'utf8'))
const pages = JSON.parse(await readFile(join(DATA, 'pages.json'), 'utf8')).pages
const maxStars = Math.max(1, ...plugins.map((p) => p.stars || 0))

const docIdxOf = new Map()
search.docs.forEach((d, i) => { if (d.type === 'plugin' && !docIdxOf.has(d.slug)) docIdxOf.set(d.slug, i) })

// 1) 精选 Top8
const feat = featuredPlugins(plugins, 8)
console.log(`[featured] ${feat.length} 条`)
for (const p of feat) console.log(`  - ${p.name}  ⭐${p.stars}  类别=${p.category}  grade=${p.external?.dshfind?.grade ?? '-'}  featured=${p.external?.dshhub?.featured ?? false}`)

// 2) 三榜
console.log('[authors]', authorLeaderboard(plugins, 5).map((a) => `${a.author}:${a.count}`).join('  '))
console.log('[stars]  ', starsLeaderboard(plugins, 5).map((p) => `${p.name}(${p.stars})`).join('  '))
console.log('[growth] ', growthLeaderboard(trending, 5).map((i) => `${i.name}+${i.delta}`).join('  '))

// 3) 查询解析 + 结果数
const tests = ['dsh', 'cat:vision', 'cat:tool stars:>500', 'vision mcp', 'author:omdsh', 'src:dshhub', 'score:S']
for (const q of tests) {
  const parsed = parseQuery(q)
  const plugs = applyFilters(plugins, parsed.filters).filter((p) => pluginMatchesTerms(p, parsed.terms, docIdxOf.get(p.slug), search.index))
  const pgs = applyPageFilters(pages, parsed.filters).filter((w) => pageMatchesTerms(w, parsed.terms))
  console.log(`[query] "${q}" → 插件 ${plugs.length} / 网页 ${pgs.length}`)
}

// 4) 相关度 top5(裸词 dsh)
const parsed = parseQuery('dsh')
const scored = applyFilters(plugins, parsed.filters)
  .filter((p) => pluginMatchesTerms(p, parsed.terms, docIdxOf.get(p.slug), search.index))
  .map((p) => ({
    name: p.name,
    score: relevanceScore({ docIdx: docIdxOf.get(p.slug), terms: parsed.terms, index: search.index, stars: p.stars, maxStars, hasDshfindScore: !!(p.external?.dshfind?.score != null) }),
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 5)
console.log('[relevance top5 "dsh"]', scored.map((s) => `${s.name}=${s.score.toFixed(1)}`).join('  '))

// 5) 联想
console.log('[suggest "dsh-v"]', suggestForQuery('dsh-v', plugins, []).slice(0, 4).map((x) => `${x.label}(${x.type})`).join('  '))
console.log('[suggest "cat:"]', suggestForQuery('cat:', plugins, []).slice(0, 4).map((x) => x.value).join('  '))

console.log('\nOK: 真实数据验证通过')
