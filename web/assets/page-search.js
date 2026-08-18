/**
 * DSH-Registry 搜索主页逻辑(M-B 第一个增量,增量 2 共享化后)。
 *
 * 纯函数已提炼至 web/assets/search-core.js(搜索主页与分类页共用),本文件
 * re-export 保持 `import … from '../../web/assets/page-search.js'` 测试路径有效;
 * DOM 区保持不变:数据加载、联想、发现页渲染、结果视图、facet、安装命令、零结果态。
 *
 * 依赖 window.DSH.R(shared.js)提供:fetchJson/assertLocalUrl/escapeHtml/badgeHtml/
 * categoryLabel/relativeTime/t 等。本文件为 ESM(浏览器 <script type="module">,
 * 天然 defer;node 测试直接 import 纯函数)。
 */
'use strict'

// ====================================================================
// 纯函数 import + re-export(实现见 search-core.js;node 测试路径保持
// page-search.js 不变,同时模块内 DOM 区可直接引用这些绑定)
// ====================================================================
import {
  pluginSources, pageStars, featuredPlugins, authorLeaderboard, starsLeaderboard,
  growthLeaderboard, parseQuery, applyFilters, applyPageFilters, pluginMatchesTerms,
  pageMatchesTerms, relevanceScore, suggestForQuery, fmtNum, highlight,
} from './search-core.js'

export {
  pluginSources, pageStars, featuredPlugins, authorLeaderboard, starsLeaderboard,
  growthLeaderboard, parseQuery, applyFilters, applyPageFilters, pluginMatchesTerms,
  pageMatchesTerms, relevanceScore, suggestForQuery, fmtNum, highlight,
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

    /** 站内数据一律走 shared.js 白名单路由(DSHR.fetchJson),本文件不做任何 URL 构造。 */

    function unavailableHtml(text) {
      return `<div class="unavailable-row">${DSHR.escapeHtml(text || DSHR.t('unavailable'))}</div>`
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
      el.innerHTML = cats.map((c) => `<a class="chip" href="/category.html?cat=${encodeURIComponent(c)}" data-cat="${DSHR.escapeHtml(c)}">${DSHR.escapeHtml(DSHR.categoryLabel(c))}</a>`).join('')
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
        state.search = await DSHR.fetchJson('search')
        for (let i = 0; i < (state.search.docs || []).length; i++) {
          const d = state.search.docs[i]
          if (d.type === 'plugin' && !state.docIdxOf.has(d.slug)) state.docIdxOf.set(d.slug, i)
        }
      } catch (e) {
        console.error('[page-search] search.json load failed', e)
      }
      try {
        state.pages = (await DSHR.fetchJson('pages')).pages || []
      } catch (e) {
        console.error('[page-search] pages.json load failed', e)
      }
      try {
        state.trending = await DSHR.fetchJson('trending')
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
