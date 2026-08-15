/**
 * dshregistry 首页逻辑:统计条、搜索/分类/排序、插件卡片渲染、空态。
 * DOM 结构复用原型稿,本文件只做数据驱动的重渲染。
 */
(function () {
  'use strict'

  const state = { plugins: [], meta: {}, query: '', category: 'all', sort: 'updated', shown: 60 }
  const SORTS = ['updated', 'stars', 'firstSeen']   // 与 .sort-select option 顺序一致
  const PAGE_SIZE = 60                              // 大数据量分批渲染,加载更多递增

  function filtered() {
    const q = state.query.trim().toLowerCase()
    let list = state.plugins
    if (state.category !== 'all') list = list.filter((p) => p.category === state.category)
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))
    const by = {
      updated: (a, b) => new Date(b.pushedAt) - new Date(a.pushedAt),
      stars: (a, b) => b.stars - a.stars,
      firstSeen: (a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt),
    }[state.sort]
    return [...list].sort(by)
  }

  function cardHtml(p) {
    return `<a href="plugin.html?slug=${encodeURIComponent(p.slug)}" class="plugin-card" data-dom-id="card-${DSHR.escapeHtml(p.slug)}">
      <div class="card-top">
        <div class="card-title-group">
          <div class="card-title">${DSHR.escapeHtml(p.name)}</div>
          <div class="card-category">${DSHR.escapeHtml(DSHR.categoryLabel(p.category))}</div>
        </div>
        ${DSHR.badgeHtml(p.state, p.stateReasons)}
      </div>
      <div class="card-desc">${DSHR.escapeHtml(p.description || '')}</div>
      <div class="card-meta">
        <span class="card-meta-item card-author">${DSHR.SVG_USER} ${DSHR.escapeHtml(p.repo.split('/')[0])}</span>
        <span class="card-meta-item card-stars">${DSHR.SVG_STAR} ${p.stars}</span>
        <span class="card-updated">${DSHR.escapeHtml(DSHR.t('card.updated').replace('{t}', DSHR.relativeTime(p.pushedAt)))}</span>
      </div>
    </a>`
  }

  function emptyHtml() {
    return `<div class="empty-state">
      <div class="empty-icon">🔍</div>
      <div class="empty-title">${DSHR.t('empty.title')}</div>
      <div class="empty-desc">${DSHR.t('empty.desc')}</div>
      <a class="empty-btn" href="index.html" id="empty-clear">${DSHR.t('empty.clear')}</a>
    </div>`
  }

  function render() {
    const grid = document.querySelector('.plugin-grid')
    const list = filtered()
    const visible = list.slice(0, state.shown)
    grid.innerHTML = list.length > 0 ? visible.map(cardHtml).join('') : emptyHtml()
    // 加载更多(数据量大时分批渲染)
    let more = document.getElementById('loadmore-row')
    if (list.length > state.shown) {
      if (!more) {
        more = document.createElement('div')
        more.id = 'loadmore-row'
        more.style.cssText = 'text-align:center;margin:16px 0 32px;'
        grid.after(more)
      }
      more.innerHTML = `<button class="empty-btn" id="loadmore-btn">${DSHR.t('loadmore').replace('{n}', String(list.length - state.shown))}</button>`
      document.getElementById('loadmore-btn').addEventListener('click', () => {
        state.shown += PAGE_SIZE
        render()
      })
    } else if (more) {
      more.remove()
    }
    const clear = document.getElementById('empty-clear')
    if (clear) clear.addEventListener('click', (e) => {
      e.preventDefault()
      state.query = ''; state.category = 'all'; state.shown = PAGE_SIZE
      const input = document.querySelector('.search-box input')
      if (input) input.value = ''
      syncChips(); render()
    })
    const meta = document.querySelector('.results-meta')
    if (meta) {
      const spans = meta.querySelectorAll('span')
      if (spans[0]) spans[0].textContent = DSHR.t('results.found').replace('{n}', String(list.length))
      if (spans[1]) spans[1].textContent = DSHR.t(`sort.note.${state.sort}`)
    }
  }

  function renderStats() {
    const m = state.meta
    const nums = document.querySelectorAll('.stats-inner .stat-num')
    const values = [m.pluginCount, m.categoryCount, m.communityCount, m.flaggedCount]
    nums.forEach((el, i) => { if (values[i] !== undefined) el.textContent = values[i] })
    const updated = document.querySelector('.stat-updated')
    if (updated && m.updatedAt) {
      updated.textContent = `${DSHR.t('stats.updatedPrefix')}${DSHR.relativeTime(m.updatedAt)}${DSHR.t('stats.updatedSuffix')}`
    }
  }

  function syncChips() {
    document.querySelectorAll('.chip-row .chip').forEach((chip, i) => {
      chip.classList.toggle('active', DSHR.CATEGORIES[i] === state.category)
      chip.textContent = DSHR.categoryLabel(DSHR.CATEGORIES[i])
    })
  }

  function wire() {
    const input = document.querySelector('.search-box input')
    if (input) {
      input.setAttribute('data-i18n-placeholder', '#search.placeholder')
      input.value = ''
      input.addEventListener('input', () => { state.query = input.value; state.shown = PAGE_SIZE; render() })
    }
    document.querySelectorAll('.chip-row .chip').forEach((chip, i) => {
      chip.addEventListener('click', () => { state.category = DSHR.CATEGORIES[i]; state.shown = PAGE_SIZE; syncChips(); render() })
    })
    const select = document.querySelector('.sort-select')
    if (select) {
      select.selectedIndex = 0
      select.addEventListener('change', () => { state.sort = SORTS[select.selectedIndex] || 'updated'; state.shown = PAGE_SIZE; render() })
    }
    syncChips()
  }

  DSHR.onReady(async () => {
    try {
      const [plugins, meta] = await DSHR.loadData()
      state.plugins = plugins
      state.meta = meta
    } catch (e) {
      console.error('[dshregistry] data load failed', e)
    }
    wire()
    syncTitle()
    renderStats()
    render()
  })
  DSHR.onLangChange(() => { syncTitle(); syncChips(); renderStats(); render() })

  function syncTitle() {
    document.title = DSHR.t('title.index')
  }
})()
