/**
 * dshregistry 详情页逻辑:按 ?slug= 渲染插件详情、安装命令、完整 README、
 * 元信息表、风险区与相关推荐。DOM 复用原型稿。
 */
(function () {
  'use strict'

  const slug = new URLSearchParams(location.search).get('slug')
  let plugin = null
  let all = []
  let meta = {}

  function setText(selector, text) {
    const el = document.querySelector(selector)
    if (el) el.textContent = text
  }

  function renderStatics() {
    document.title = `${plugin.name} · ${DSHR.t('site.suffix')}`
    DSHR.setTrailingText('.back-link', DSHR.t('detail.back'))
    DSHR.setTrailingText('[data-dom-id="github-view-btn"]', DSHR.t('detail.viewGithub'))
    DSHR.setTrailingText('[data-dom-id="view-source-btn"]', DSHR.t('detail.viewSource'))
    DSHR.setTrailingText('.risk-title', DSHR.t('risk.title'))
    const titles = document.querySelectorAll('main .section-title')
    const keys = ['section.install', 'section.intro', 'section.meta', 'section.related']
    titles.forEach((el, i) => { if (keys[i]) el.textContent = DSHR.t(keys[i]) })
    updateSeo()
  }

  /** SEO: 按插件动态覆盖 meta / canonical / OG / JSON-LD */
  function updateSeo() {
    if (!plugin) return
    const url = `https://dshregistry.xyz/plugin.html?slug=${encodeURIComponent(slug)}`
    const desc = (plugin.description || plugin.name || '').slice(0, 160)
    const setMeta = (attr, key, value) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`)
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute(attr, key)
        document.head.appendChild(el)
      }
      el.setAttribute('content', value)
    }
    document.title = `${plugin.name} · DSH-Registry`
    setMeta('name', 'description', desc)
    let canonical = document.querySelector('link[rel="canonical"]')
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical) }
    canonical.href = url
    setMeta('property', 'og:title', `${plugin.name} · DSH-Registry`)
    setMeta('property', 'og:description', desc)
    setMeta('property', 'og:url', url)
    setMeta('name', 'twitter:title', `${plugin.name} · DSH-Registry`)
    setMeta('name', 'twitter:description', desc)
    // JSON-LD: SoftwareApplication 结构化数据
    let ld = document.getElementById('ld-plugin')
    if (!ld) {
      ld = document.createElement('script')
      ld.id = 'ld-plugin'
      ld.type = 'application/ld+json'
      document.head.appendChild(ld)
    }
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: plugin.name,
      description: desc,
      url,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'DeepSeek Harness (DSH)',
      author: { '@type': 'Organization', name: plugin.repo ? plugin.repo.split('/')[0] : undefined, url: plugin.githubUrl || undefined },
      codeRepository: plugin.githubUrl || undefined,
      dateModified: plugin.pushedAt || undefined,
      datePublished: plugin.firstSeenAt || undefined,
      aggregateRating: plugin.stars ? undefined : undefined,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    })
  }

  function renderStats() {
    const nums = document.querySelectorAll('.stats-inner .stat-num')
    const values = [meta.pluginCount, meta.categoryCount, meta.communityCount, meta.flaggedCount]
    nums.forEach((el, i) => { if (values[i] !== undefined) el.textContent = values[i] })
    const updated = document.querySelector('.stat-updated')
    if (updated && meta.updatedAt) {
      updated.textContent = `${DSHR.t('stats.updatedPrefix')}${DSHR.relativeTime(meta.updatedAt)}${DSHR.t('stats.updatedSuffix')}`
    }
  }

  function renderHeader() {
    setText('.plugin-title', plugin.name)
    setText('.plugin-category', DSHR.categoryLabel(plugin.category))
    const row = document.querySelector('.plugin-title-row')
    if (row) {
      row.querySelectorAll('.trust-badge').forEach((b) => b.remove())
      row.insertAdjacentHTML('beforeend', DSHR.badgeHtml(plugin.state, plugin.stateReasons))
    }
    setText('.plugin-desc', plugin.description || '')
    setText('.plugin-stars', String(plugin.stars))
    const metaItems = document.querySelectorAll('.plugin-meta-row .plugin-meta-item')
    if (metaItems[1]) metaItems[1].innerHTML = metaItems[1].innerHTML.replace(/(<svg[\s\S]*?<\/svg>)[\s\S]*/, `$1 ${DSHR.t('detail.updated')}${DSHR.relativeTime(plugin.pushedAt)}`)
    if (metaItems[2]) metaItems[2].innerHTML = metaItems[2].innerHTML.replace(/(<svg[\s\S]*?<\/svg>)[\s\S]*/, `$1 ${DSHR.t('detail.firstSeen')}${plugin.firstSeenAt}`)
    const gh = document.querySelector('[data-dom-id="github-view-btn"]')
    if (gh) gh.href = plugin.githubUrl
  }

  function renderInstall() {
    setText('.install-section .code-block', `dsh plugin --profile web add ${plugin.installSpec}`)
    const btn = document.querySelector('[data-dom-id="install-copy-btn"]')
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1'
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(`dsh plugin --profile web add ${plugin.installSpec}`)
          const textNode = [...btn.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
          if (textNode) {
            const prev = textNode.textContent
            textNode.textContent = ` ${DSHR.t('install.copied')} `
            setTimeout(() => { textNode.textContent = prev }, 1500)
          }
        } catch { /* 剪贴板不可用时静默 */ }
      })
    }
    const check = document.querySelector('.install-check span:last-child')
    if (check) check.innerHTML = plugin.basicCheck ? DSHR.t('check.pass') : DSHR.t('check.fail')
  }

  async function renderReadme() {
    const section = document.querySelector('.desc-section')
    if (!section) return
    const title = section.querySelector('.section-title')
    section.innerHTML = ''
    if (title) section.appendChild(title)
    const body = document.createElement('div')
    body.className = 'readme-body'
    if (!plugin.readmeUrl) {
      body.innerHTML = `<p>${DSHR.escapeHtml(DSHR.t('readme.none'))}</p>`
    } else {
      try {
        // 片段由爬虫在构建期渲染并白名单清洗,见 tools/crawl.js
        const res = await fetch(plugin.readmeUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        body.innerHTML = await res.text()
        body.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener' })
      } catch {
        body.innerHTML = `<p>${DSHR.escapeHtml(DSHR.t('readme.error'))}</p>`
      }
    }
    section.appendChild(body)
  }

  function renderMeta() {
    const table = document.querySelector('.meta-table')
    if (!table) return
    const rows = [
      ['meta.author', plugin.repo.split('/')[0]],
      ['meta.repo', `<a href="${DSHR.escapeHtml(plugin.githubUrl)}" target="_blank" rel="noopener">${DSHR.escapeHtml(plugin.repo)}</a>`],
      ['meta.commit', `<code>${DSHR.escapeHtml(plugin.latestCommit)}</code>`],
      ['meta.updated', `${DSHR.escapeHtml(plugin.pushedAt)}(${DSHR.escapeHtml(DSHR.relativeTime(plugin.pushedAt))})`],
      ['meta.firstSeen', DSHR.escapeHtml(plugin.firstSeenAt)],
      ['meta.license', DSHR.escapeHtml(plugin.license || '—')],
      ['meta.version', DSHR.escapeHtml(plugin.version ? `v${plugin.version}` : '—')],
    ]
    table.innerHTML = rows.map(([k, v]) => `<tr><th>${DSHR.t(k)}</th><td>${v.startsWith('<') ? v : DSHR.escapeHtml(v)}</td></tr>`).join('')
  }

  function renderRisk() {
    const p = document.querySelector('.risk-content p')
    if (p) p.textContent = DSHR.t('risk.body')
    const btn = document.querySelector('[data-dom-id="view-source-btn"]')
    if (btn) btn.href = plugin.githubUrl
    const header = document.querySelector('.risk-header')
    const content = document.querySelector('.risk-content')
    if (header && content && !header.dataset.wired) {
      header.dataset.wired = '1'
      header.style.cursor = 'pointer'
      header.addEventListener('click', () => {
        const hidden = content.style.display === 'none'
        content.style.display = hidden ? '' : 'none'
        header.querySelector('.risk-chevron')?.style.setProperty('transform', hidden ? '' : 'rotate(-90deg)')
      })
    }
  }

  function renderRelated() {
    const grid = document.querySelector('.related-grid')
    if (!grid) return
    const related = all.filter((p) => p.slug !== plugin.slug && p.category === plugin.category).slice(0, 4)
    const pool = related.length > 0 ? related : all.filter((p) => p.slug !== plugin.slug).slice(0, 3)
    grid.innerHTML = pool.map((p) => `<a href="plugin.html?slug=${encodeURIComponent(p.slug)}" class="related-card">
      <div class="related-card-top">
        <span class="related-card-name">${DSHR.escapeHtml(p.name)}</span>
        ${DSHR.badgeHtml(p.state)}
      </div>
      <div class="related-card-desc">${DSHR.escapeHtml(p.description || '')}</div>
    </a>`).join('')
  }

  function renderAll() {
    renderStatics(); renderStats(); renderHeader(); renderInstall(); renderMeta(); renderRisk(); renderRelated()
  }

  DSHR.onReady(async () => {
    try {
      ;[all, meta] = await DSHR.loadData()
    } catch (e) {
      console.error('[dshregistry] data load failed', e)
      all = []
    }
    plugin = all.find((p) => p.slug === slug)
    if (!plugin) {
      location.replace('404.html')
      return
    }
    renderAll()
    await renderReadme()
  })
  DSHR.onLangChange(() => { if (plugin) renderAll() })
})()
