/**
 * DSH-Registry 分类搜索页逻辑(M-B 增量 2)。
 * 设计稿 category-zh-light.html 生产版:12 能力域 facet + 作者 facet(组内搜索/Top10+展开)
 * + Stars 单选 + 统计行/精选卡/结果行(插件行 + 网页行)+ mark 高亮 + 安装展开 + 零结果态。
 *
 * 查询与过滤:顶部小号搜索框支持主页同款组合语法(cat:/author:/stars:/src:/score: + 裸词 AND);
 * facet 与查询语法同状态 AND;URL 参数直达(category.html?cat=vision / ?q=xxx / ?author=x),
 * 进入页面即应用并渲染,搜索后写回地址栏(replaceState)。
 *
 * 纯函数全部来自 web/assets/search-core.js(与搜索主页共享);本文件只做 DOM 绑定与页面区块。
 * 依赖 window.DSHR(shared.js)提供 t/escapeHtml/badgeHtml/categoryLabel/relativeTime/loadData/
 * assertLocalUrl/CATEGORIES/SVG_STAR 等。
 */
'use strict'

import {
  pluginSources, pageStars, parseQuery, applyFilters, applyPageFilters,
  pluginMatchesTerms, pageMatchesTerms, relevanceScore, suggestForQuery,
  fmtNum, highlight, growthLeaderboard, authorCounts, topAuthors,
  pickFeatured, displayUrl,
} from './search-core.js'

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
      trending: null,
      maxStars: 1,
      docIdxOf: new Map(),   // slug → search.json docs 下标
      query: '',
      sort: 'relevance',
      facets: { source: [], category: [], trust: [], author: [], stars: '' }, // stars '' = 不限
      authorExpanded: false, // 作者 facet 是否展开全部
      visible: 50,           // 结果区每屏渲染条数(增量渲染,避免大结果集一次渲染卡顿)
    }
    const PAGE_SIZE = 50
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
      const url = DSHR.escapeHtml(displayUrl(w.url))
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
    <span class="meta-item page-url">${url}</span>
    <span class="meta-tags">${srcTagsHtml([src])}</span>
  </div>
</div>`
    }

    // ---------- facet 渲染 ----------
    function facetItem(label, count, checked, value, group) {
      const isRadio = group === 'stars'
      return `<label class="facet-item">
  <input type="${isRadio ? 'radio' : 'checkbox'}" name="facet-${DSHR.escapeHtml(group)}" value="${DSHR.escapeHtml(value)}"${checked ? ' checked' : ''}>
  <span class="${isRadio ? 'facet-radio' : 'facet-checkbox'}"></span>
  <span class="facet-label">${DSHR.escapeHtml(label)}</span>
  <span class="facet-count">${String(count)}</span>
</label>`
    }

    /** 各 facet 选项计数:基于"查询+维度过滤后、facet 应用前"的候选集(与搜索主页一致)。 */
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
        const opts = ['community', 'unreviewed', 'flagged']
        trustEl.innerHTML = opts.map((t) => facetItem(DSHR.t(`badge.${t === 'community' ? 'vouched' : t}`), counts.trust[t] || 0, f.trust.includes(t), t, 'trust')).join('')
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
      renderAuthorFacet(plugs, pgs)
    }

    /** 作者 facet:组内搜索框过滤 + Top10(未展开)/全部(展开)。 */
    function renderAuthorFacet(plugs, pgs) {
      const listEl = document.getElementById('facetAuthorList')
      if (!listEl) return
      const searchInput = document.getElementById('facetAuthorSearch')
      const filter = searchInput ? searchInput.value : ''
      const counts = authorCounts(plugs, pgs)
      const limit = state.authorExpanded ? Infinity : 10
      const list = topAuthors(counts, filter, limit)
      listEl.innerHTML = list.length
        ? list.map(({ author, count }) => facetItem(author, count, state.facets.author.some((a) => String(author).toLowerCase().includes(a)), author, 'author')).join('')
        : unavailableHtml(DSHR.t('unavailable'))
      const moreEl = document.getElementById('facetAuthorMore')
      if (moreEl) {
        moreEl.hidden = !filter && counts.size <= 10
        moreEl.textContent = state.authorExpanded ? DSHR.t('facet.author.less') : DSHR.t('facet.author.more')
      }
    }

    // ---------- facet 应用 ----------
    function applyFacetsToPlugins(plugs) {
      const f = state.facets
      return plugs.filter((p) => {
        if (f.source.length && !f.source.some((s) => pluginSources(p).includes(s))) return false
        if (f.category.length && !f.category.includes(p.category || 'other')) return false
        if (f.trust.length && !f.trust.includes(p.state || 'unreviewed')) return false
        if (f.author.length) {
          const author = String((p.repo || '').split('/')[0] || '').toLowerCase()
          if (!f.author.some((a) => author.includes(a))) return false
        }
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
        if (f.author.length) {
          const author = String(w.author || '').toLowerCase()
          if (!f.author.some((a) => author.includes(a))) return false
        }
        if (f.stars && (pageStars(w) || 0) < Number(f.stars)) return false
        return true
      })
    }

    /** 查询+维度过滤后的候选集(facet 计数与结果计算共用)。 */
    function queryCandidateSets() {
      const parsed = parseQuery(state.query)
      const plugs = applyFilters(state.plugins, parsed.filters)
        .filter((p) => pluginMatchesTerms(p, parsed.terms, state.docIdxOf.get(p.slug), state.search && state.search.index))
      const pgs = applyPageFilters(state.pages, parsed.filters)
        .filter((w) => pageMatchesTerms(w, parsed.terms))
      return { plugs, pgs, parsed }
    }

    // ---------- 结果计算 ----------
    function starsOf(r) {
      return r.kind === 'plugin' ? r.item.stars || 0 : pageStars(r.item) || 0
    }

    function updatedTs(r) {
      if (r.kind === 'plugin') return new Date(r.item.pushedAt || 0).getTime()
      return 0
    }

    function sortRows(rows) {
      const by = {
        relevance: (a, b) => b.score - a.score || starsOf(b) - starsOf(a),
        stars: (a, b) => starsOf(b) - starsOf(a),
        updated: (a, b) => updatedTs(b) - updatedTs(a),
      }[state.sort] || ((a, b) => b.score - a.score)
      return rows.sort(by)
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

    // ---------- 渲染结果区 ----------
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
          const input = document.getElementById('catSearchInput')
          if (input) input.value = chip.dataset.zero
          runSearch()
        })
      })
    }

    /** 精选卡:从当前过滤结果中选 community && dshfind.grade 的相关度最高 1 个,无则不显示。 */
    function renderFeatured(pluginRows) {
      const card = document.getElementById('featuredCard')
      const rowsEl = document.getElementById('featuredRows')
      if (!card || !rowsEl) return
      const pick = pickFeatured(pluginRows)
      if (!pick) {
        card.hidden = true
        rowsEl.innerHTML = ''
        return
      }
      rowsEl.innerHTML = pluginRowHtml(pick.item, parseQuery(state.query).terms)
      card.hidden = false
    }

    /** 按当前 state.query + facets 计算并渲染结果区 + 精选卡 + facet 计数。 */
    function applyAndRender() {
      const parsed = parseQuery(state.query)
      const { plugs, pgs } = queryCandidateSets()
      const plugRows = applyFacetsToPlugins(plugs)
      const pageRows = applyFacetsToPages(pgs)
      const rows = buildRows(plugRows, pageRows, parsed)
      const t0 = performance.now()
      const statsEl = document.getElementById('resultsStats')
      if (statsEl) {
        statsEl.innerHTML = DSHR.t('search.found')
          .replace('{n}', `<strong>${String(rows.length)}</strong>`)
          .replace('{ms}', String(Math.round(performance.now() - t0)))
      }
      renderFeatured(plugRows.map((p) => ({
        kind: 'plugin',
        item: p,
        score: relevanceScore({
          docIdx: state.docIdxOf.get(p.slug),
          terms: parsed.terms,
          index: state.search && state.search.index,
          stars: p.stars,
          maxStars: state.maxStars,
          hasDshfindScore: !!((p.external && p.external.dshfind && p.external.dshfind.score != null)),
        }),
      })))
      const listEl = document.getElementById('resultsList')
      if (listEl) {
        if (!rows.length) {
          listEl.innerHTML = zeroStateHtml()
          wireZeroChips()
        } else {
          const shown = rows.slice(0, state.visible)
          listEl.innerHTML = shown.map((r) => r.kind === 'plugin' ? pluginRowHtml(r.item, parsed.terms) : pageRowHtml(r.item, parsed.terms)).join('')
          // 增量渲染:结果超出当前可见数 → 底部"加载更多"
          if (rows.length > state.visible) {
            const more = document.createElement('button')
            more.type = 'button'
            more.className = 'load-more-btn'
            more.textContent = `${DSHR.t('loadMore') || '加载更多'} (${rows.length - state.visible})`
            more.addEventListener('click', () => {
              state.visible += PAGE_SIZE
              applyAndRender()   // 不走 runSearch:不重置 visible,不重新触发 pages 懒加载
            })
            listEl.appendChild(more)
          }
        }
      }
      renderFacets()
    }

    // ---------- 查询 / URL ----------
    /** 从 URL 参数合成查询串(?q= / ?cat= / ?author=)。 */
    function paramsToQuery() {
      const params = new URLSearchParams(location.search)
      const q = (params.get('q') || '').trim()
      // cat/author 参数 = Facet 预勾选(计数保留全站、可切换),不进查询词
      const cat = (params.get('cat') || '').trim().toLowerCase()
      const author = (params.get('author') || '').trim().toLowerCase()
      if (cat && DSHR.CATEGORIES.includes(cat) && !state.facets.category.includes(cat)) {
        state.facets.category = [...state.facets.category, cat]
      }
      if (author && !state.facets.author.includes(author)) {
        state.facets.author = [...state.facets.author, author]
      }
      return q
    }

    /** 写回地址栏:cat/author 独立参数,其余维度与裸词并入 q;replaceState 不产生历史项。 */
    function syncUrl() {
      if (!history || !history.replaceState || typeof history.replaceState !== 'function') return
      const url = new URL(location.href)
      url.search = ''
      // cat/author 来自 Facet 预勾选
      const cat = state.facets.category[0]
      const author = state.facets.author[0]
      if (cat) url.searchParams.set('cat', cat)
      if (author) url.searchParams.set('author', author)
      const rest = []
      for (const tok of state.query.trim().split(/\s+/)) {
        if (!tok) continue
        const m = tok.match(/^(cat|author):(.*)$/)
        if (m && m[2]) continue // 已抽取为独立参数
        rest.push(tok)
      }
      if (rest.length) url.searchParams.set('q', rest.join(' '))
      try {
        history.replaceState(null, '', url.toString())
      } catch (e) { /* 某些环境禁止修改地址,忽略 */ }
    }

    function runSearch() {
      const input = document.getElementById('catSearchInput')
      state.query = input ? input.value : ''
      state.visible = PAGE_SIZE   // 查询/过滤变化重置增量渲染
      // pages 懒加载:网页行只在有查询词时展示;下载期间先渲染插件结果(不阻塞首屏),到位后补一次带网页行的渲染
      if (state.query && !state.pagesLoaded && !state.pagesLoading) {
        state.pagesLoading = true
        DSHR.fetchJson('pages').then((d) => {
          state.pages = (d && d.pages) || []
          state.pagesLoaded = true
          state.pagesLoading = false
          runSearch()
        }).catch(() => {
          state.pages = []
          state.pagesLoaded = true
          state.pagesLoading = false
        })
      }
      applyAndRender()
      hideSuggest()
      syncUrl()
    }

    // ---------- 联想下拉 ----------
    let suggestTimer = null
    let suggestIndex = -1

    function renderSuggestions(value) {
      const box = document.getElementById('catSuggestBox')
      const input = document.getElementById('catSearchInput')
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
      box.querySelectorAll('.suggest-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const it = items[Number(btn.dataset.index)]
          if (!it) return
          input.value = it.value ?? it.label ?? ''
          box.hidden = true
          input.setAttribute('aria-expanded', 'false')
          runSearch()
        })
      })
    }

    function hideSuggest() {
      const box = document.getElementById('catSuggestBox')
      const input = document.getElementById('catSearchInput')
      if (box) box.hidden = true
      if (input) input.setAttribute('aria-expanded', 'false')
    }

    // ---------- 事件绑定 ----------
    function wireSearch() {
      const input = document.getElementById('catSearchInput')
      if (!input) return
      input.addEventListener('input', () => {
        clearTimeout(suggestTimer)
        suggestTimer = setTimeout(() => renderSuggestions(input.value), 150)
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const box = document.getElementById('catSuggestBox')
          const items = [...(box ? box.querySelectorAll('.suggest-item') : [])]
          const active = items.find((b) => b.classList.contains('active'))
          if (active) active.click()
          else runSearch()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const box = document.getElementById('catSuggestBox')
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

    function readFacetsFromDom() {
      state.facets = {
        source: [...document.querySelectorAll('#facetSource input:checked')].map((el) => el.value),
        category: [...document.querySelectorAll('#facetCategory input:checked')].map((el) => el.value),
        trust: [...document.querySelectorAll('#facetTrust input:checked')].map((el) => el.value),
        author: [...document.querySelectorAll('#facetAuthorList input:checked')].map((el) => el.value),
        stars: (document.querySelector('#facetStars input:checked') || { value: '' }).value,
      }
    }

    function wireFacets() {
      // 防抖 120ms:连续勾选/取消只合并为一次渲染(全量重建 DOM 开销大,连点会卡)
      let facetTimer = null
      ;['facetSource', 'facetCategory', 'facetTrust', 'facetAuthorList', 'facetStars'].forEach((id) => {
        const el = document.getElementById(id)
        if (!el) return
        el.addEventListener('change', () => {
          clearTimeout(facetTimer)
          facetTimer = setTimeout(() => {
            readFacetsFromDom()
            runSearch()
          }, 120)
        })
      })
      const authorSearch = document.getElementById('facetAuthorSearch')
      if (authorSearch) {
        let timer = null
        authorSearch.addEventListener('input', () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            state.authorExpanded = false // 输入过滤时重置为 Top 列表
            renderAuthorFacet(...candidatePlugsPages())
          }, 150)
        })
      }
      const more = document.getElementById('facetAuthorMore')
      if (more) {
        more.addEventListener('click', (e) => {
          e.preventDefault()
          state.authorExpanded = !state.authorExpanded
          renderAuthorFacet(...candidatePlugsPages())
        })
      }
    }

    /** 供作者 facet 局部刷新用的候选集(不触碰结果区)。 */
    function candidatePlugsPages() {
      const { plugs, pgs } = queryCandidateSets()
      return [applyFacetsToPlugins(plugs), applyFacetsToPages(pgs)]
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

    function rerenderAll() {
      const input = document.getElementById('catSearchInput')
      if (input) input.setAttribute('data-i18n-placeholder', '#cat.search.placeholder')
      const select = document.getElementById('sortSelect')
      if (select) populateSortOptions(select)
      applyAndRender()
    }

    // ---------- 启动 ----------
    // 加载策略(优化 2026-08-18):plugins.json 先到先渲染(Facet 计数/分类浏览/榜单都不依赖其余文件);
    // search.json 后台并行补全(仅相关度排序/查询词需要);pages.json 懒加载(网页行只在有查询词时展示)。
    async function boot() {
      try {
        const [plugins] = await DSHR.loadData()
        state.plugins = plugins
      } catch (e) {
        console.error('[page-category] plugins load failed', e)
      }
      state.maxStars = Math.max(1, ...state.plugins.map((p) => p.stars || 0))
      wireSearch()
      wireFacets()
      wireSort()
      wireInstallToggle()
      // URL 参数直达:进入页面即应用过滤并渲染,写回地址栏
      const q = paramsToQuery()
      const input = document.getElementById('catSearchInput')
      if (input) input.value = q
      runSearch()
      loadSearchIndex()   // 后台补全相关度数据,不阻塞首屏
      loadTrending()      // 零结果态的热门推荐
    }

    async function loadSearchIndex() {
      try {
        state.search = await DSHR.fetchJson('search')
        for (let i = 0; i < (state.search.docs || []).length; i++) {
          const d = state.search.docs[i]
          if (d.type === 'plugin' && !state.docIdxOf.has(d.slug)) state.docIdxOf.set(d.slug, i)
        }
        if (state.query) runSearch()   // 有查询词时重算相关度排序
      } catch (e) {
        console.error('[page-category] search.json load failed', e)
      }
    }

    async function loadTrending() {
      try {
        state.trending = await DSHR.fetchJson('trending')
      } catch (e) {
        console.error('[page-category] trending.json load failed', e)
      }
    }

    DSHR.onReady(() => boot().catch((e) => console.error('[page-category] boot failed', e)))
    DSHR.onLangChange(() => rerenderAll())
  })()
}
