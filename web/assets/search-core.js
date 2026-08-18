/**
 * DSH-Registry 搜索核心纯函数(M-B 增量 2)。
 *
 * 自 page-search.js 提炼的共享层:搜索主页与分类搜索页共用的查询解析、维度过滤、
 * 裸词匹配、相关度评分、联想、榜单、数字格式化、mark 高亮,以及分类页专用的
 * 精选卡选择 / 作者 facet 计数 / URL 参数解析等。
 *
 * 约束:本文件为纯函数模块,零 DOM / window / DSHR 依赖,node 环境可直接
 * import 单测;浏览器环境由各 page-*.js import 复用。
 */
'use strict'

// ====================================================================
// 来源 / 星数
// ====================================================================

/** 插件来源集合:github 恒在,叠加 listedOn 各源。 */
export function pluginSources(p) {
  const out = ['github']
  for (const l of (p && p.listedOn) || []) {
    if (l && l.source && !out.includes(l.source)) out.push(l.source)
  }
  return out
}

/** 网页星数:优先 external.<source>.stars,dshfind 兜底。 */
export function pageStars(w) {
  if (w.external && w.external[w.source] && typeof w.external[w.source].stars === 'number') return w.external[w.source].stars
  if (w.external && w.external.dshfind && typeof w.external.dshfind.stars === 'number') return w.external.dshfind.stars
  return null
}

// ====================================================================
// 榜单(搜索主页精选/三榜)
// ====================================================================

/** 精选社区插件:state==='community',按 stars 降序取前 n。 */
export function featuredPlugins(plugins, n = 8) {
  return plugins
    .filter((p) => p.state === 'community')
    .sort((a, b) => b.stars - a.stars)
    .slice(0, n)
}

/** 作者榜:按收录数(repo owner)降序取前 n。 */
export function authorLeaderboard(plugins, n = 5) {
  const m = new Map()
  for (const p of plugins) {
    const author = String((p.repo || '').split('/')[0] || 'unknown')
    m.set(author, (m.get(author) || 0) + 1)
  }
  return [...m.entries()]
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

/** 星数榜:stars 降序取前 n。 */
export function starsLeaderboard(plugins, n = 5) {
  return [...plugins].sort((a, b) => b.stars - a.stars).slice(0, n)
}

/** 24h 增长榜:trending.json items 按 delta 降序取前 n。 */
export function growthLeaderboard(trending, n = 5) {
  const items = (trending && Array.isArray(trending.items) && trending.items) || []
  return [...items].sort((a, b) => (b.delta || 0) - (a.delta || 0)).slice(0, n)
}

// ====================================================================
// 查询解析 / 过滤 / 匹配 / 相关度
// ====================================================================

/**
 * 查询解析:拆出维度过滤器(cat:/author:/stars:/src:/score:)与裸词。
 * 裸词按 AND 匹配;stars 支持 `stars:>n` / `stars:>=n`;score 为字母等级(S/A/B/C…)。
 */
export function parseQuery(input) {
  const raw = String(input || '').trim()
  const filters = { cat: [], author: [], stars: [], src: [], score: [] }
  const terms = []
  for (const tok of raw.split(/\s+/)) {
    if (!tok) continue
    const m = tok.match(/^(cat|author|stars|src|score):(.*)$/)
    if (m) {
      const key = m[1]
      const val = m[2].trim()
      if (val) filters[key].push(key === 'score' ? val.toUpperCase() : val.toLowerCase())
    } else {
      terms.push(tok.toLowerCase())
    }
  }
  return { raw, terms, filters }
}

/** stars:>n / stars:>=n 表达式逐一判定(网页与插件共用)。 */
function starsExprOk(stars, exprs) {
  return exprs.every((expr) => {
    const m = expr.match(/^(>=|>)(\d+)$/)
    if (!m) return true
    const n = Number(m[2])
    return m[1] === '>=' ? stars >= n : stars > n
  })
}

/** 维度过滤器作用于插件数组(cat/src/stars/score 精确;author 子串)。 */
export function applyFilters(plugins, filters) {
  if (!filters) return plugins
  return plugins.filter((p) => {
    if (filters.cat.length && !filters.cat.includes(String(p.category || '').toLowerCase())) return false
    if (filters.author.length) {
      const author = String((p.repo || '').split('/')[0] || '').toLowerCase()
      if (!filters.author.some((a) => author.includes(a))) return false
    }
    if (filters.src.length) {
      const srcs = pluginSources(p).map((s) => s.toLowerCase())
      if (!filters.src.some((s) => srcs.includes(s))) return false
    }
    if (filters.stars.length && !starsExprOk(p.stars || 0, filters.stars)) return false
    if (filters.score.length) {
      const grade = String(((p.external && p.external.dshfind && p.external.dshfind.grade) || '')).toUpperCase()
      if (!filters.score.includes(grade)) return false
    }
    return true
  })
}

/** 维度过滤器作用于网页条目(shape 与插件不同:source/author/name/external.*.stars)。 */
export function applyPageFilters(pages, filters) {
  if (!filters) return pages
  return pages.filter((w) => {
    if (filters.cat.length) return false // 网页无分类
    if (filters.author.length) {
      const author = String(w.author || '').toLowerCase()
      if (!filters.author.some((a) => author.includes(a))) return false
    }
    if (filters.src.length && !filters.src.includes(String(w.source || '').toLowerCase())) return false
    const stars = pageStars(w)
    if (filters.stars.length && !starsExprOk(stars || 0, filters.stars)) return false
    if (filters.score.length) return false // 网页无 dshfind grade
    return true
  })
}

/** 倒排索引词项命中:search.json index[term] = [[docIdx, score]…]。 */
function indexTermHit(index, term, docIdx) {
  if (!index || docIdx == null) return false
  const posts = index[term]
  return Array.isArray(posts) && posts.some(([di]) => di === docIdx)
}

/** 插件命中:裸词 AND——name/repo/tags/description 任一子串 或 search.json 词项命中。 */
export function pluginMatchesTerms(p, terms, docIdx, index) {
  if (!terms.length) return true
  const hay = [p.name, p.repo, (p.tags || []).join(' '), p.description].filter(Boolean).join(' ').toLowerCase()
  return terms.every((term) => hay.includes(term) || indexTermHit(index, term, docIdx))
}

/** 网页命中:裸词 AND——name/author/description 子串。 */
export function pageMatchesTerms(w, terms) {
  if (!terms.length) return true
  const hay = [w.name, w.author, w.description].filter(Boolean).join(' ').toLowerCase()
  return terms.every((term) => hay.includes(term))
}

/**
 * 相关度:search.json 词项得分和 + stars 归一(0~50)+ dshfind score 加成(有则整体 ×1.05)。
 */
export function relevanceScore({ docIdx, terms, index, stars = 0, maxStars = 1, hasDshfindScore = false }) {
  let termSum = 0
  for (const term of terms) {
    const posts = index && index[term]
    if (!Array.isArray(posts)) continue
    const hit = posts.find(([di]) => di === docIdx)
    if (hit) termSum += hit[1]
  }
  const starsNorm = maxStars > 0 ? (stars || 0) / maxStars * 50 : 0
  const base = termSum * 10 + starsNorm
  return hasDshfindScore ? base * 1.05 : base
}

/**
 * 联想:输入是维度前缀时列出可选值(cat:/author:/stars:/src:/score:);
 * 否则按 name/repo/tags 前缀匹配插件(≤limit 条,按 stars 降序预排序)。
 */
export function suggestForQuery(input, plugins, categories) {
  const raw = String(input || '').trim()
  if (!raw) return []
  const m = raw.match(/^(cat|author|stars|src|score):(.*)$/)
  if (m) {
    const key = m[1]
    const partial = m[2].toLowerCase()
    if (key === 'cat') {
      return categories
        .filter((c) => c.key !== 'all')
        .map((c) => ({ type: 'value', value: `cat:${c.key}`, label: `cat:${c.key}`, sub: c.label }))
        .filter((x) => x.value.includes(partial) || String(x.sub).toLowerCase().includes(partial))
        .slice(0, 8)
    }
    if (key === 'author') {
      const seen = new Set()
      const out = []
      for (const pl of [...plugins].sort((a, b) => b.stars - a.stars)) {
        const a = String((pl.repo || '').split('/')[0] || '')
        if (!a || seen.has(a)) continue
        seen.add(a)
        if (a.toLowerCase().includes(partial)) out.push({ type: 'value', value: `author:${a}`, label: `author:${a}`, sub: '' })
        if (out.length >= 8) break
      }
      return out
    }
    if (key === 'stars') {
      return ['>100', '>500'].filter((v) => v.includes(partial)).map((v) => ({ type: 'value', value: `stars:${v}`, label: `stars:${v}`, sub: '' }))
    }
    if (key === 'src') {
      return ['github', 'dshfind', 'dshhub'].filter((v) => v.includes(partial)).map((v) => ({ type: 'value', value: `src:${v}`, label: `src:${v}`, sub: '' }))
    }
    if (key === 'score') {
      const grades = [...new Set(plugins.map((pl) => (pl.external && pl.external.dshfind && pl.external.dshfind.grade) || '').filter(Boolean).map((g) => g.toUpperCase()))].sort()
      return grades.filter((g) => g.toLowerCase().includes(partial)).map((g) => ({ type: 'value', value: `score:${g}`, label: `score:${g}`, sub: '' }))
    }
    return []
  }
  // 裸词:name/repo/tags 前缀匹配
  const out = []
  const seen = new Set()
  for (const pl of [...plugins].sort((a, b) => b.stars - a.stars)) {
    if (out.length >= 8) break
    if (seen.has(pl.slug)) continue
    const hay = [pl.name, pl.repo, ...(pl.tags || [])].filter(Boolean)
    if (hay.some((h) => h.toLowerCase().startsWith(raw.toLowerCase()))) {
      seen.add(pl.slug)
      out.push({ type: 'plugin', slug: pl.slug, name: pl.name, label: pl.name, cat: pl.category, sub: '' })
    }
  }
  return out
}

// ====================================================================
// 数字 / 文本助手
// ====================================================================

/** 数字缩写:1200 → 1.2k。 */
export function fmtNum(n) {
  const num = Number(n) || 0
  if (num >= 1000) {
    const k = num / 1000
    return `${String(Math.round(k * 10) / 10).replace(/\.0$/, '')}k`
  }
  return String(num)
}

/** 转义正则特殊字符。 */
export function escRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 命中高亮:text 已是转义后的 HTML;对每个裸词包裹 <mark>。 */
export function highlight(escapedText, terms) {
  if (!terms || !terms.length) return escapedText
  let out = escapedText
  for (const t of terms) {
    if (!t) continue
    out = out.replace(new RegExp(escRegex(t), 'gi'), (m) => `<mark>${m}</mark>`)
  }
  return out
}

// ====================================================================
// 分类页专用
// ====================================================================

/** URL 参数解析(category.html?cat=vision&q=xxx&author=xxx),缺省为空串。 */
export function parseCategoryUrlParams(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null) || ''
  return { q: get('q'), cat: get('cat'), author: get('author') }
}

/** 由 URL 参数合成查询串:裸词 q 与 cat:/author: 维度 AND。 */
export function buildCategoryQuery({ q = '', cat = '', author = '' } = {}) {
  const parts = []
  if (String(q || '').trim()) parts.push(String(q).trim())
  if (cat) parts.push(`cat:${String(cat).toLowerCase()}`)
  if (author) parts.push(`author:${String(author).toLowerCase()}`)
  return parts.join(' ')
}

/** 作者 facet 计数:Map<小写作者,{ author: 原始写法, count }>。 */
export function authorCounts(plugs, pgs) {
  const m = new Map()
  const bump = (a) => {
    const s = String(a || '').trim()
    if (!s) return
    const k = s.toLowerCase()
    const e = m.get(k)
    if (e) e.count++
    else m.set(k, { author: s, count: 1 })
  }
  for (const p of plugs) bump((p.repo || '').split('/')[0] || '')
  for (const w of pgs) bump(w.author || '')
  return m
}

/** 作者列表:按 count 降序(同数按字典序),支持子串过滤,取前 limit。 */
export function topAuthors(counts, filter = '', limit = 10) {
  const q = String(filter || '').trim().toLowerCase()
  const list = [...counts.values()]
    .filter((e) => !q || e.author.toLowerCase().includes(q))
    .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author))
  return list.slice(0, limit)
}

/**
 * 精选卡选择:从已评分插件行(按相关度排序候选)中挑选
 * state==='community' && external.dshfind.grade 存在 的最高相关度 1 个;
 * 无候选返回 null。
 */
export function pickFeatured(pluginRows) {
  const cands = pluginRows.filter((r) => {
    const p = r && r.item
    const g = p && p.external && p.external.dshfind
    return !!(p && p.state === 'community' && g && g.grade)
  })
  if (!cands.length) return null
  return cands.reduce((best, r) => (r.score > best.score ? r : best))
}

/** 网页行源站 URL 展示:去协议、去尾部斜杠。 */
export function displayUrl(url) {
  return String(url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}
