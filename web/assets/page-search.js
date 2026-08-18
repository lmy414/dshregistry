/**
 * DSH-Registry 搜索主页逻辑(M-B 第一个增量)。
 * 加载 web/data 下的静态 JSON,渲染精选/三榜/统计条,实现联想 + 结果视图(同页切换)。
 *
 * 架构:
 *  - 纯函数区(可 export,node 环境可单测):featuredPlugins / authorLeaderboard /
 *    starsLeaderboard / growthLeaderboard / parseQuery / applyFilters / applyPageFilters /
 *    pluginMatchesTerms / pageMatchesTerms / relevanceScore / suggestForQuery 等。
 *  - DOM 区:仅浏览器执行(module 顶层守卫),负责数据加载、渲染与交互。
 *
 * 依赖 window.DSHR(shared.js)提供:fetchJson/assertLocalUrl/escapeHtml/badgeHtml/
 * categoryLabel/relativeTime/t 等。本文件为 ESM(浏览器 <script type="module">,
 * 天然 defer;node 测试直接 import 纯函数)。
 */
'use strict'

// ====================================================================
// 纯函数区(不触碰 DOM / window,可被 node:test 直接 import)
// ====================================================================

/** 插件来源集合:github 恒在,叠加 listedOn 各源。 */
export function pluginSources(p) {
  const out = ['github']
  for (const l of (p && p.listedOn) || []) {
    if (l && l.source && !out.includes(l.source)) out.push(l.source)
  }
  return out
}

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

function starsExprOk(stars, exprs) {
  return exprs.every((expr) => {
    const m = expr.match(/^(>=|>)(\d+)$/)
    if (!m) return true
    const n = Number(m[2])
    return m[1] === '>=' ? stars >= n : stars > n
  })
}

/** 网页星数:优先 external.<source>.stars,dshfind 兜底。 */
export function pageStars(w) {
  if (w.external && w.external[w.source] && typeof w.external[w.source].stars === 'number') return w.external[w.source].stars
  if (w.external && w.external.dshfind && typeof w.external.dshfind.stars === 'number') return w.external.dshfind.stars
  return null
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

function indexTermHit(index, term, docIdx) {
  if (!index || docIdx == null) return false
  const posts = index[term]
  return Array.isArray(posts) && posts.some(([di]) => di === docIdx)
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

/** 数字缩写:1200 → 1.2k。 */
export function fmtNum(n) {
  const num = Number(n) || 0
  if (num >= 1000) {
    const k = num / 1000
    return `${String(Math.round(k * 10) / 10).replace(/\.0$/, '')}k`
  }
  return String(num)
}

// ====================================================================
// DOM 区(仅浏览器)
// ====================================================================
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  ;(() => {
    const $ = (sel) => document.querySelector(sel)

    const state = {
      plugins: [],
      pages: [],
      search: null,          // search.json
      meta: null,
      trending: null,
      maxStars: 1,
      docIdxOf: new Map(),   // slug → search.json docs 下标
      query: '',
      sort: 'relevance',
      facets: { source: [], category: [], trust: [], stars: '' }, // '' = 不限
    }
    const SORTS = ['relevance', 'stars', 'updated']

    /** 站内 fetch + assertLocalUrl 校验(search.json/pages.json/trending.json 不在 shared.js 白名单)。 */
    function fetchLocal(path) {
      const url = DSHR.assertLocalUrl(path)
      return fetch(url).then((res) => {
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
        return res.json()
      })
    }

    function unavailableHtml(text) {
      return `<div class="unavailable-row">${DSHR.escapeHtml(text || DSHR.t('unavailable'))}</div>`
    }

    function escRegex(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    /** 命中高亮:text 已是转义后的 HTML;对每个裸词包裹 <mark>。 */
    function highlight(escapedText, terms) {
      if (!terms || !terms.length) return escapedText
      let out = escapedText
      for (const t of terms) {
        if (!t) continue
        out = out.replace(new RegExp(escRegex(t), 'gi'), (m) => `<mark>${m}</mark>`)
      }
      return out
    }

    // ---------- 行渲染 ----------
    function scoreBadgeHtml(p) {
      const g = p.external && p.external.dshfind
      if (!g || !g.grade || g.score == null) return ''
      const cls = `grade-${DSHR.escapeHtml(String(g.grade).toLowerCase())}`
      return `<span class="score-badge ${cls}">${DSHR.escapeHtml(`${g.grade} ${g.score}`)}</span>`
    }

    function chipHtml(p) {
      const out = []
      const hub = p.external && p.external.dshhub
      if (hub && hub.featured) out.push(`<span class="badge-chip premium">${DSHR.escapeHtml(DSHR.t('chip.premium'))}</span>`)
      if (hub && (hub.kind === 'insider' || hub.status === 'beta')) out.push(`<span class="badge-chip beta">${DSHR.escapeHtml(DSHR.t('chip.beta'))}</span>`)
      return out.join('')
    }

    function srcTagsHtml(srcs) {
      return srcs.map((s) => `<span class="src-tag">${DSHR.escapeHtml(DSHR.t(`src.${s}`))}</span>`).join('')
    }

    function pluginRowHtml(p, terms) {
      const author = String((p.repo || '').split('/')[0] || '')
      const installSpec = p.installSpec || `github:${p.repo}`
      const cmd = `dsh plugin --profile web add ${installSpec}`
      const url = `/p/${encodeURIComponent(p.slug)}.html`
      return `<div class="result-row" data-kind="plugin">
  <div class="result-main">
    <div class="result-title-row">
      <a class="result-title" href="${url}">${highlight(DSHR.escapeHtml(p.name || ''), terms)}</a>
      <span class="result-cat-tag">${DSHR.escapeHtml(DSHR.categoryLabel(p.category))}</span>
      <span class="result-by">${DSHR.escapeHtml(DSHR.t('result.by').replace('{a}', author))}</span>
      ${scoreBadgeHtml(p)}${chipHtml(p)}${DSHR.badgeHtml(p.state, p.stateReasons)}
    </div>
    <div class="result-desc">${highlight(DSHR.escapeHtml(p.description || ''), terms)}</div>
  </div>
  <div class="result-meta-row">
    <span class="meta-item star-gold">${DSHR.SVG_STAR} ${fmtNum(p.stars)}</span>
    <span class="meta-item">${DSHR.escapeHtml(DSHR.t('card.updated').replace('{t}', DSHR.relativeTime(p.pushedAt)))}</span>
    <span class="meta-tags">${srcTagsHtml(pluginSources(p))}</span>
  </div>
  <div class="install-row">
    <button type="button" class="install-btn" data-install="${DSHR.escapeHtml(cmd)}"><span class="install-icon">+</span>${DSHR.escapeHtml(DSHR.t('install'))}</button>
    <div class="install-cmd hidden"><code></code></div>
  </div>
</div>`
    }

    function pageRowHtml(w, terms) {
      const stars = pageStars(w)
      const src = String(w.source || '')
      return `<div class="result-row result-page" data-kind="page">
  <div class="result-main">
    <div class="result-title-row">
      <span class="result-title page-title">${highlight(DSHR.escapeHtml(w.name || ''), terms)}</span>
      <span class="result-cat-tag">${DSHR.escapeHtml(DSHR.t('result.page'))}</span>
      <span class="result-by">${DSHR.escapeHtml(DSHR.t('result.by').replace('{a}', w.author || ''))}</span>
    </div>
    <div class="result-desc">${highlight(DSHR.escapeHtml(w.description || ''), terms)}</div>
  </div>
  <div class="result-meta-row">
    ${stars != null ? `<span class="meta-item star-gold">${DSHR.SVG_STAR} ${fmtNum(stars)}</span>` : ''}
    <span class="meta-item page-url">${DSHR.escapeHtml(w.url || '')}</span>
    <span class="meta-tags">${srcTagsHtml([src])}</span>
  </div>
</div>`
    }

    // ---------- 发现页渲染 ----------
    function renderStats() {
      const m = state.meta
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v }
      if (m) {
        set('stat-plugins', String(m.pluginCount ?? '—'))
        set('stat-cats', String(m.categoryCount ?? '—'))
        set('stat-updated', DSHR.relativeTime(m.updatedAt))
      } else {
        set('stat-plugins', '—'); set('stat-cats', '—'); set('stat-updated', '—')
      }
    }

    function renderFeatured() {
      const el = document.getElementById('featuredList')
      if (!el) return
      try {
        const list = featuredPlugins(state.plugins, 8)
        el.innerHTML = list.length ? list.map((p) => pluginRowHtml(p, [])).join('') : unavailableHtml()
      } catch (e) {
        console.error('[page-search] featured render failed', e)
        el.innerHTML = unavailableHtml()
      }
    }

    function lbItemHtml(rank, name, href, valueHtml, cls) {
      return `<li class="lb-item${cls ? ` ${cls}` : ''}">
  <span class="lb-rank">${rank}</span>
  ${href ? `<a class="lb-name" href="${href}">${DSHR.escapeHtml(name)}</a>` : `<span class="lb-name">${DSHR.escapeHtml(name)}</span>`}
  ${valueHtml}
</li>`
    }

    function renderLeaderboards() {
      // 作者榜
      const authors = document.getElementById('lbAuthors')
      if (authors) {
        try {
          const list = authorLeaderboard(state.plugins, 5)
          authors.innerHTML = list.length
            ? list.map(({ author, count }, i) => lbItemHtml(i + 1, author, '#', `<span class="lb-value">${DSHR.escapeHtml(DSHR.t('lb.plugin.count').replace('{n}', String(count)))}</span>`, `rank-${i + 1}`)).join('')
            : unavailableHtml()
        } catch (e) {
          authors.innerHTML = unavailableHtml()
        }
      }
      // 星数榜
      const stars = document.getElementById('lbStars')
      if (stars) {
        try {
          const list = starsLeaderboard(state.plugins, 5)
          stars.innerHTML = list.length
            ? list.map((p, i) => lbItemHtml(i + 1, p.name, `/p/${encodeURIComponent(p.slug)}.html`, `<span class="lb-value tabular">${fmtNum(p.stars)}</span>`, `rank-${i + 1}`)).join('')
            : unavailableHtml()
        } catch (e) {
          stars.innerHTML = unavailableHtml()
        }
      }
      // 24h 增长榜
      const growth = document.getElementById('lbGrowth')
      if (growth) {
        try {
          const list = growthLeaderboard(state.trending, 5)
          growth.innerHTML = list.length
            ? list.map((it, i) => lbItemHtml(i + 1, it.name || it.slug, it.slug ? `/p/${encodeURIComponent(it.slug)}.html` : '#', `<span class="lb-growth">+${Number(it.delta) || 0}</span>`, `rank-${i + 1}`)).join('')
            : unavailableHtml()
        } catch (e) {
          growth.innerHTML = unavailableHtml()
        }
      }
    }

    // ---------- 快速 chips ----------
    function renderQuickChips() {
      const el = document.getElementById('quickChips')
      if (!el) return
      const cats = DSHR.CATEGORIES.filter((c) => c !== 'all')
      el.innerHTML = cats.map((c) => `<button type="button" class="chip" data-cat="${DSHR.escapeHtml(c)}">${DSHR.escapeHtml(DSHR.categoryLabel(c))}</button>`).join('')
      el.querySelectorAll('.chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const input = document.getElementById('searchInput')
          if (input) input.value = `cat:${chip.dataset.cat}`
          runSearch()
        })
      })
    }

    // ---------- 联想下拉 ----------
    let suggestTimer = null
    let suggestIndex = -1

    function renderSuggestions(value) {
      const box = document.getElementById('suggestBox')
      const input = document.getElementById('searchInput')
      if (!box || !input) return
      const items = suggestForQuery(value, state.plugins, DSHR.CATEGORIES.map((k) => ({ key: k, label: DSHR.categoryLabel(k) })))
      if (!value.trim() || !items.length) {
        box.hidden = true
        input.setAttribute('aria-expanded', 'false')
        return
      }
      suggestIndex = -1
      box.innerHTML = items.map((it, i) => {
        const catLabel = it.type === 'plugin' ? DSHR.categoryLabel(it.cat) : it.sub
        const catHtml = catLabel ? `<span class="suggest-cat">${DSHR.escapeHtml(catLabel)}</span>` : ''
        return `<button type="button" class="suggest-item" data-index="${i}">${DSHR.escapeHtml(it.label)}${catHtml}</button>`
      }).join('')
      box.hidden = false
      input.setAttribute('aria-expanded', 'true')
      // 点击联想项
      box.querySelectorAll('.suggest-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const it = items[Number(btn.dataset.index)]
          if (!it) return
          // 裸词联想项无 value(只有 label),维度项两者都有
          input.value = it.value ?? it.label ?? ''
          box.hidden = true
          input.setAttribute('aria-expanded', 'false')
          runSearch()
        })
      })
    }

    function hideSuggest() {
      const box = document.getElementById('suggestBox')
      const input = document.getElementById('searchInput')
      if (box) box.hidden = true
      if (input) input.setAttribute('aria-expanded', 'false')
    }

    // ---------- 结果视图 ----------
    function facetItem(label, count, checked, value, group) {
      const isRadio = group === 'stars'
      return `<label class="facet-item">
  <input type="${isRadio ? 'radio' : 'checkbox'}" name="facet-${DSHR.escapeHtml(group)}" value="${DSHR.escapeHtml(value)}"${checked ? ' checked' : ''}>
  <span class="${isRadio ? 'facet-radio' : 'facet-checkbox'}"></span>
  <span class="facet-label">${DSHR.escapeHtml(label)}</span>
  <span class="facet-count">${String(count)}</span>
</label>`
    }

    /** 计算各 facet 选项的计数:基于"查询+维度过滤后、facet 应用前"的候选集。 */
    function facetCounts(plugs, pgs) {
      const counts = { source: {}, category: {}, trust: {}, stars: {} }
      const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1 }
      for (const p of plugs) {
        for (const s of pluginSources(p)) bump(counts.source, s)
        bump(counts.category, p.category || 'other')
        bump(counts.trust, p.state || 'unreviewed')
        if (p.stars >= 500) bump(counts.stars, '500')
        if (p.stars >= 100) bump(counts.stars, '100')
      }
      for (const w of pgs) {
        bump(counts.source, w.source || '?')
        const s = pageStars(w)
        if (s >= 500) bump(counts.stars, '500')
        if (s >= 100) bump(counts.stars, '100')
      }
      return counts
    }

    function renderFacets() {
      const { plugs, pgs } = queryCandidateSets()
      const counts = facetCounts(plugs, pgs)
      const total = plugs.length + pgs.length
      const f = state.facets

      const sourceEl = document.getElementById('facetSource')
      if (sourceEl) {
        const opts = ['github', 'dshfind', 'dshhub']
        sourceEl.innerHTML = opts.map((s) => facetItem(DSHR.t(`src.${s}`), counts.source[s] || 0, f.source.includes(s), s, 'source')).join('')
      }
      const catEl = document.getElementById('facetCategory')
      if (catEl) {
        const cats = DSHR.CATEGORIES.filter((c) => c !== 'all')
        catEl.innerHTML = cats.map((c) => facetItem(DSHR.categoryLabel(c), counts.category[c] || 0, f.category.includes(c), c, 'category')).join('')
      }
      const trustEl = document.getElementById('facetTrust')
      if (trustEl) {
        const opts = ['community', 'unreviewed']
        trustEl.innerHTML = opts.map((t) => facetItem(DSHR.t(`badge.${t === 'community' ? 'vouched' : 'unreviewed'}`), counts.trust[t] || 0, f.trust.includes(t), t, 'trust')).join('')
      }
      const starsEl = document.getElementById('facetStars')
      if (starsEl) {
        const items = [
          facetItem(DSHR.t('facet.stars.all'), total, !f.stars, '', 'stars'),
          facetItem(DSHR.t('facet.stars.100'), counts.stars['100'] || 0, f.stars === '100', '100', 'stars'),
          facetItem(DSHR.t('facet.stars.500'), counts.stars['500'] || 0, f.stars === '500', '500', 'stars'),
        ]
        starsEl.innerHTML = items.join('')
      }
    }

    function applyFacetsToPlugins(plugs) {
      const f = state.facets
      return plugs.filter((p) => {
        if (f.source.length && !f.source.some((s) => pluginSources(p).includes(s))) return false
        if (f.category.length && !f.category.includes(p.category || 'other')) return false
        if (f.trust.length && !f.trust.includes(p.state || 'unreviewed')) return false
        if (f.stars && (p.stars || 0) < Number(f.stars)) return false
        return true
      })
    }

    function applyFacetsToPages(pgs) {
      const f = state.facets
      return pgs.filter((w) => {
        if (f.source.length && !f.source.includes(w.source || '')) return false
        if (f.category.length) return false
        if (f.trust.length) return false
        if (f.stars && (pageStars(w) || 0) < Number(f.stars)) return false
        return true
      })
    }

    /** 查询+维度过滤后的候选集(供 facet 计数与结果计算共用)。 */
    function queryCandidateSets() {
      const parsed = parseQuery(state.query)
      const plugs = applyFilters(state.plugins, parsed.filters)
        .filter((p) => pluginMatchesTerms(p, parsed.terms, state.docIdxOf.get(p.slug), state.search && state.search.index))
      const pgs = applyPageFilters(state.pages, parsed.filters)
        .filter((w) => pageMatchesTerms(w, parsed.terms))
      return { plugs, pgs, parsed }
    }

    function sortRows(rows) {
      const by = {
        relevance: (a, b) => b.score - a.score || starsOf(b) - starsOf(a),
        stars: (a, b) => starsOf(b) - starsOf(a),
        updated: (a, b) => updatedTs(b) - updatedTs(a),
      }[state.sort] || ((a, b) => b.score - a.score)
      return rows.sort(by)
    }

    function starsOf(r) {
      return r.kind === 'plugin' ? r.item.stars || 0 : pageStars(r.item) || 0
    }

    function updatedTs(r) {
      if (r.kind === 'plugin') return new Date(r.item.pushedAt || 0).getTime()
      return 0
    }

    function buildRows(plugs, pgs, parsed) {
      const index = state.search && state.search.index
      const plugRows = plugs.map((p) => ({
        kind: 'plugin',
        item: p,
        score: relevanceScore({
          docIdx: state.docIdxOf.get(p.slug),
          terms: parsed.terms,
          index,
          stars: p.stars,
          maxStars: state.maxStars,
          hasDshfindScore: !!((p.external && p.external.dshfind && p.external.dshfind.score != null)),
        }),
      }))
      const pageRows = pgs.map((w) => ({
        kind: 'page',
        item: w,
        score: relevanceScore({
          docIdx: null,
          terms: parsed.terms,
          index: null,
          stars: pageStars(w) || 0,
          maxStars: state.maxStars,
          hasDshfindScore: false,
        }),
      }))
      return sortRows(plugRows.concat(pageRows))
    }

    function zeroStateHtml() {
      const popular = growthLeaderboard(state.trending, 5).map((it) => it.name || it.slug).filter(Boolean)
      return `<div class="zero-state">
  <img src="/assets/mascot/Q7_think_思考.png" alt="思考">
  <div class="zero-title">${DSHR.escapeHtml(DSHR.t('zero.title'))}</div>
  <div class="zero-desc">${DSHR.escapeHtml(DSHR.t('zero.desc'))}</div>
  ${popular.length ? `<div class="zero-chips">${popular.map((n) => `<button type="button" class="chip" data-zero="${DSHR.escapeHtml(n)}">${DSHR.escapeHtml(n)}</button>`).join('')}</div>` : ''}
</div>`
    }

    function wireZeroChips() {
      document.querySelectorAll('#resultsList .chip[data-zero]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const input = document.getElementById('searchInput')
          if (input) input.value = chip.dataset.zero
          runSearch()
        })
      })
    }

    /** 按当前 state.query + facets 计算并渲染结果区(不滚动、不切视图)。 */
    function applyAndRender() {
      const parsed = parseQuery(state.query)
      const { plugs, pgs } = queryCandidateSets()
      const rows = buildRows(applyFacetsToPlugins(plugs), applyFacetsToPages(pgs), parsed)
      const t0 = performance.now()
      const statsEl = document.getElementById('resultsStats')
      if (statsEl) {
        statsEl.innerHTML = DSHR.t('search.found')
          .replace('{n}', `<strong>${String(rows.length)}</strong>`)
          .replace('{ms}', String(Math.round(performance.now() - t0)))
      }
      const listEl = document.getElementById('resultsList')
      if (listEl) {
        listEl.innerHTML = rows.length
          ? rows.map((r) => r.kind === 'plugin' ? pluginRowHtml(r.item, parsed.terms) : pageRowHtml(r.item, parsed.terms)).join('')
          : zeroStateHtml()
        wireZeroChips()
      }
      renderFacets()
    }

    function runSearch() {
      const input = document.getElementById('searchInput')
      state.query = input ? input.value : ''
      const discovery = document.getElementById('discoverySection')
      const view = document.getElementById('resultsView')
      if (discovery) discovery.hidden = true
      if (view) view.hidden = false
      applyAndRender()
      hideSuggest()
      if (view && typeof view.scrollIntoView === 'function') view.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    function backToDiscovery() {
      state.query = ''
      const input = document.getElementById('searchInput')
      if (input) input.value = ''
      const discovery = document.getElementById('discoverySection')
      const view = document.getElementById('resultsView')
      if (discovery) discovery.hidden = false
      if (view) view.hidden = true
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    function readFacetsFromDom() {
      state.facets = {
        source: [...document.querySelectorAll('#facetSource input:checked')].map((el) => el.value),
        category: [...document.querySelectorAll('#facetCategory input:checked')].map((el) => el.value),
        trust: [...document.querySelectorAll('#facetTrust input:checked')].map((el) => el.value),
        stars: (document.querySelector('#facetStars input:checked') || { value: '' }).value,
      }
    }

    function wireFacets() {
      ;['facetSource', 'facetCategory', 'facetTrust', 'facetStars'].forEach((id) => {
        const el = document.getElementById(id)
        if (!el) return
        el.addEventListener('change', () => {
          readFacetsFromDom()
          runSearch()
        })
      })
    }

    function wireInstallToggle() {
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.install-btn')
        if (!btn) return
        e.preventDefault()
        const row = btn.closest('.result-row')
        const cmd = row && row.querySelector('.install-cmd')
        if (!cmd) return
        const code = cmd.querySelector('code')
        if (code) code.textContent = btn.dataset.install || ''
        cmd.classList.toggle('hidden')
      })
    }

    function wireSearch() {
      const input = document.getElementById('searchInput')
      if (!input) return
      input.addEventListener('input', () => {
        clearTimeout(suggestTimer)
        suggestTimer = setTimeout(() => renderSuggestions(input.value), 150)
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const box = document.getElementById('suggestBox')
          const items = [...(box ? box.querySelectorAll('.suggest-item') : [])]
          const active = items.find((b) => b.classList.contains('active'))
          if (active) active.click()
          else runSearch()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const box = document.getElementById('suggestBox')
          if (!box || box.hidden) return
          e.preventDefault()
          const items = [...box.querySelectorAll('.suggest-item')]
          if (!items.length) return
          suggestIndex = e.key === 'ArrowDown'
            ? (suggestIndex + 1) % items.length
            : (suggestIndex - 1 + items.length) % items.length
          items.forEach((b, i) => b.classList.toggle('active', i === suggestIndex))
          items[suggestIndex].scrollIntoView({ block: 'nearest' })
        } else if (e.key === 'Escape') {
          hideSuggest()
        }
      })
      input.addEventListener('blur', () => setTimeout(hideSuggest, 150))
    }

    function wireSort() {
      const select = document.getElementById('sortSelect')
      if (!select) return
      populateSortOptions(select)
      select.value = state.sort
      select.addEventListener('change', () => {
        state.sort = select.value || 'relevance'
        runSearch()
      })
    }

    function populateSortOptions(select) {
      select.innerHTML = ''
      SORTS.forEach((s) => {
        const opt = document.createElement('option')
        opt.value = s
        opt.textContent = DSHR.t(`sort.${s}`)
        select.appendChild(opt)
      })
      select.value = state.sort
    }

    const backBtn = document.getElementById('backDiscovery')
    if (backBtn) backBtn.addEventListener('click', (e) => { e.preventDefault(); backToDiscovery() })

    function rerenderAll() {
      renderStats()
      renderFeatured()
      renderLeaderboards()
      renderQuickChips()
      const input = document.getElementById('searchInput')
      if (input) input.setAttribute('data-i18n-placeholder', '#search.heroPlaceholder')
      const select = document.getElementById('sortSelect')
      if (select) populateSortOptions(select)
      const view = document.getElementById('resultsView')
      if (view && !view.hidden) {
        state.query = input ? input.value : ''
        applyAndRender()
      }
    }

    // ---------- 启动 ----------
    async function boot() {
      try {
        const [plugins, meta] = await DSHR.loadData()
        state.plugins = plugins
        state.meta = meta
      } catch (e) {
        console.error('[page-search] plugins/meta load failed', e)
      }
      try {
        state.search = await fetchLocal('/data/search.json')
        for (let i = 0; i < (state.search.docs || []).length; i++) {
          const d = state.search.docs[i]
          if (d.type === 'plugin' && !state.docIdxOf.has(d.slug)) state.docIdxOf.set(d.slug, i)
        }
      } catch (e) {
        console.error('[page-search] search.json load failed', e)
      }
      try {
        state.pages = (await fetchLocal('/data/pages.json')).pages || []
      } catch (e) {
        console.error('[page-search] pages.json load failed', e)
      }
      try {
        state.trending = await fetchLocal('/data/trending.json')
      } catch (e) {
        console.error('[page-search] trending.json load failed', e)
      }
      state.maxStars = Math.max(1, ...state.plugins.map((p) => p.stars || 0))
      wireSearch()
      wireFacets()
      wireSort()
      wireInstallToggle()
      renderStats()
      renderFeatured()
      renderLeaderboards()
      renderQuickChips()
      // URL ?q= 直接进入结果视图(SearchAction 兼容)
      const q = new URLSearchParams(location.search).get('q')
      if (q) {
        const input = document.getElementById('searchInput')
        if (input) input.value = q
        runSearch()
      }
    }

    DSHR.onReady(() => boot().catch((e) => console.error('[page-search] boot failed', e)))
    DSHR.onLangChange(() => rerenderAll())
  })()
}
