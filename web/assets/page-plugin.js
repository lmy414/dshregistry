/**
 * DSH-Registry 详情页逻辑(M-B 增量 3):真实数据版。
 * 设计稿 plugin-zh-light.html 生产化:按 ?slug= 或 /p/<slug>.html 渲染
 * 插件详情(标题/分类 12 能力域/信任徽章 stateReasons 悬浮/描述/stars/相对更新/
 * 收录时间)、"收录于" chips(listedOn 各源外链)、external 双源卡(dshfind 评分 +
 * DSH Hub 状态)、安装命令 + 复制按钮、warning-callout、README 片段注入、元信息表、
 * 风险区折叠、相关推荐(by-cat 同分类取 4 排除自身)。
 *
 * 数据一律走 shared.js 白名单路由(DSHR.fetchJson);页面文本插值全部经
 * DSHR.escapeHtml;readme 片段为爬虫 DOMPurify 消毒过的可信 HTML 直接 innerHTML;
 * assertLocalUrl 仅用于 readme 片段路径。纯函数见 ./plugin-render.js(与单测共享)。
 */
'use strict'

import {
  isValidSlug, normalizeCategory, externalSectionData,
  listedOnSources, relatedCandidates, installCommand,
} from './plugin-render.js'

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  ;(() => {
    // 从 URL 提取 slug: 优先路径式 /p/<slug>.html, 兼容旧 ?slug= 参数
    const pathMatch = location.pathname.match(/^\/p\/([^/]+)\.html$/)
    const slug = pathMatch ? decodeURIComponent(pathMatch[1]) : new URLSearchParams(location.search).get('slug')
    let plugin = null
    let meta = {}

    const $ = (sel) => document.querySelector(sel)
    const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text }
    /** 安全插值:纯文本一律 escape;`html` 开头为已消毒的可信 HTML 片段时跳过。 */
    const esc = (s) => DSHR.escapeHtml(s)

    // ------------------------------------------------------------------ 静态文案 + SEO
    function renderStatics() {
      document.title = `${plugin.name} · ${DSHR.t('site.suffix')}`
      DSHR.setTrailingText('.back-link', DSHR.t('detail.back'))
      DSHR.setTrailingText('[data-dom-id="github-view-btn"]', DSHR.t('detail.viewGithub'))
      DSHR.setTrailingText('[data-dom-id="view-source-btn"]', DSHR.t('detail.viewSource'))
      DSHR.setTrailingText('[data-dom-id="install-copy-btn"]', DSHR.t('install.copy'))
      DSHR.setTrailingText('.risk-title', DSHR.t('risk.title'))
      const titles = document.querySelectorAll('main .section-title')
      const keys = ['section.install', 'section.intro', 'section.meta', 'section.related']
      titles.forEach((el, i) => { if (keys[i]) el.textContent = DSHR.t(keys[i]) })
      renderWarningCallout()
      updateSeo()
    }

    /** 信任状态差异化警示条: unreviewed=红色强警示, community=琥珀温和提醒, flagged=红色 */
    function renderWarningCallout() {
      const el = $('[data-dom-id="warning-callout"]')
      if (!el || !plugin) return
      const state = plugin.state || 'unreviewed'
      if (state === 'community') {
        el.className = 'warning-callout vouched'
        el.innerHTML = DSHR.t('risk.warning.vouched')
      } else {
        el.className = 'warning-callout'
        el.innerHTML = DSHR.t('risk.warning.unreviewed')
      }
    }

    /** SEO: 按插件动态覆盖 meta / canonical / OG / twitter / JSON-LD */
    function updateSeo() {
      if (!plugin) return
      const url = `https://dshregistry.xyz/p/${encodeURIComponent(slug)}.html`
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
      const canonical = document.querySelector('link[rel="canonical"]')
      if (canonical) canonical.href = url
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
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      })
    }

    // ------------------------------------------------------------------ 统计条(meta.json)
    function renderStats() {
      const nums = document.querySelectorAll('.stats-inner .stat-num')
      const values = [meta.pluginCount, meta.categoryCount, meta.communityCount, meta.flaggedCount]
      nums.forEach((el, i) => { if (values[i] !== undefined) el.textContent = values[i] })
      const updated = $('.stat-updated')
      if (updated && meta.updatedAt) {
        updated.textContent = `${DSHR.t('stats.updatedPrefix')}${DSHR.relativeTime(meta.updatedAt)}${DSHR.t('stats.updatedSuffix')}`
      }
    }

    // ------------------------------------------------------------------ 插件头部
    function renderHeader() {
      setText('.plugin-title', plugin.name)
      setText('.plugin-category', DSHR.categoryLabel(normalizeCategory(plugin.category)))
      const row = $('.plugin-title-row')
      if (row) {
        row.querySelectorAll('.trust-badge').forEach((b) => b.remove())
        row.insertAdjacentHTML('beforeend', DSHR.badgeHtml(plugin.state, plugin.stateReasons))
      }
      setText('.plugin-desc', plugin.description || '')
      setText('.plugin-stars', String(plugin.stars ?? 0))
      DSHR.setTrailingText('.plugin-meta-row .plugin-meta-item:nth-child(2)', `${DSHR.t('detail.updated')}${DSHR.relativeTime(plugin.pushedAt)}`)
      DSHR.setTrailingText('.plugin-meta-row .plugin-meta-item:nth-child(3)', `${DSHR.t('detail.firstSeen')}${plugin.firstSeenAt || ''}`)
      const gh = $('[data-dom-id="github-view-btn"]')
      if (gh) gh.href = plugin.githubUrl
      renderIndexedOn()
    }

    /** 收录于 chips:GitHub 恒有(本数据源自身);listedOn 各源做外链(新窗口 rel=noopener)。 */
    function renderIndexedOn() {
      const tags = $('[data-dom-id="indexed-on-tags"]')
      if (!tags) return
      const chips = [`<span class="src-tag github">${esc(DSHR.t('src.github'))}</span>`]
      for (const s of listedOnSources(plugin)) {
        const label = esc(DSHR.t(`src.${s.labelKey}`))
        if (s.url) {
          chips.push(`<a class="src-tag ${esc(s.source)}" href="${esc(s.url)}" target="_blank" rel="noopener">${label}</a>`)
        } else {
          chips.push(`<span class="src-tag ${esc(s.source)}">${label}</span>`)
        }
      }
      tags.innerHTML = chips.join('')
    }

    // ------------------------------------------------------------------ external 双源卡
    /** dshfind 卡:评分等级 + 分 + 徽章 + 7 天增长;链接取自 listedOn dshfind 条目。 */
    function findCardHtml(find) {
      const listed = (plugin.listedOn || []).find((x) => x && x.source === 'dshfind')
      const url = listed && listed.url
      const score = find.score != null
        ? `<span class="external-card-score">${esc(String(find.score))}${find.grade ? `<span class="grade">${esc(find.grade)}</span>` : ''}</span>`
        : ''
      const badges = Array.isArray(find.badges) && find.badges.length
        ? find.badges.map((b) => `<span class="badge-chip">${esc(b)}</span>`).join('')
        : ''
      const lines = []
      if (find.weeklyGrowth != null) {
        lines.push(`<div class="external-card-line">${esc(DSHR.t('external.find.growth').replace('{n}', String(find.weeklyGrowth)))}</div>`)
      }
      if (find.stars != null) {
        lines.push(`<div class="external-card-line">${esc(DSHR.t('external.find.stars').replace('{n}', String(find.stars)))}</div>`)
      }
      lines.push(`<div class="external-card-line">${esc(DSHR.t('external.find.body'))}</div>`)
      return `<div class="external-card">
        <div class="external-card-header">
          <span class="external-card-source">${esc(DSHR.t('external.find.title'))}</span>
          ${score}
        </div>
        ${badges ? `<div class="external-card-line">${badges}</div>` : ''}
        ${lines.join('')}
        <div class="external-card-footer">${url
          ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(DSHR.t('external.find.from'))}</a>`
          : esc(DSHR.t('external.find.from'))}</div>
      </div>`
    }

    /** DSH Hub 卡:状态/featured/版本/许可/更新/兼容性;数据缺 review/verification/registry 时跳过对应行。 */
    function hubStatusLabel(status) {
      const key = `external.hub.status.${status}`
      const label = DSHR.t(key)
      return label === key ? status : label // 字典缺键时回退原始值
    }

    function hubRow(labelKey, value, raw = true) {
      const v = raw ? esc(value) : esc(DSHR.t(value))
      return `<div class="hub-status"><span class="hub-status-label">${esc(DSHR.t(labelKey))}</span><span class="hub-status-value">${v}</span></div>`
    }

    function hubCardHtml(hub) {
      const listed = (plugin.listedOn || []).find((x) => x && x.source === 'dshhub')
      const url = listed && listed.url
      const rows = []
      for (const k of ['review', 'verification', 'registry']) {
        if (hub[k] != null && hub[k] !== '') rows.push(hubRow(`external.hub.${k}`, hub[k]))
      }
      if (hub.status) rows.push(hubRow('external.hub.status', hubStatusLabel(hub.status)))
      if (hub.featured) rows.push(hubRow('external.hub.featured', 'external.hub.featuredYes', false))
      if (hub.version) rows.push(hubRow('external.hub.version', hub.version))
      if (hub.license) rows.push(hubRow('external.hub.license', hub.license))
      if (hub.updatedAt) rows.push(hubRow('external.hub.updated', String(hub.updatedAt).slice(0, 10)))
      const compatibility = hub.compatibility
        ? `<div class="external-card-line">${esc(hub.compatibility)}</div>`
        : ''
      return `<div class="external-card">
        <div class="external-card-header">
          <span class="external-card-source">${esc(DSHR.t('external.hub.title'))}</span>
          ${hub.status ? `<span class="badge-chip">${esc(hubStatusLabel(hub.status))}</span>` : ''}
        </div>
        ${rows.join('')}
        ${compatibility}
        <div class="external-card-footer">${url
          ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(DSHR.t('external.hub.from'))}</a>`
          : esc(DSHR.t('external.hub.from'))}</div>
      </div>`
    }

    function renderExternal() {
      const section = $('[data-dom-id="external-section"]')
      const inner = $('.external-cards')
      if (!section || !inner) return
      const { any, find, hub } = externalSectionData(plugin)
      if (!any) { section.hidden = true; inner.innerHTML = ''; return }
      const cards = []
      if (find) cards.push(findCardHtml(find))
      if (hub) cards.push(hubCardHtml(hub))
      inner.innerHTML = cards.join('')
      section.hidden = false
    }

    // ------------------------------------------------------------------ 安装
    function renderInstall() {
      const cmd = installCommand(plugin)
      const code = $('.install-section .code-block')
      if (code) code.textContent = cmd
      const btn = $('[data-dom-id="install-copy-btn"]')
      if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1'
        btn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(cmd)
            const textNode = [...btn.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
            if (textNode) {
              const prev = textNode.textContent
              textNode.textContent = ` ${DSHR.t('install.copied')} `
              setTimeout(() => { textNode.textContent = prev }, 1500)
            }
          } catch { /* 剪贴板不可用时静默 */ }
        })
      }
      const check = $('.install-check span:last-child')
      if (check) check.innerHTML = plugin.basicCheck ? DSHR.t('check.pass') : DSHR.t('check.fail')
    }

    // ------------------------------------------------------------------ README
    async function renderReadme() {
      const body = $('[data-dom-id="readme-body"]')
      if (!body) return
      if (!plugin.readmeUrl) {
        body.innerHTML = `<p>${esc(DSHR.t('readme.none'))}</p>`
        return
      }
      try {
        // 片段由爬虫在构建期渲染并 DOMPurify 白名单清洗,见 tools/crawl.js
        // readmeUrl 是相对路径 (data/readme/xxx.html),在 /p/ 或 ?slug= 页转绝对路径
        const readmeUrl = DSHR.assertLocalUrl(plugin.readmeUrl.startsWith('/') ? plugin.readmeUrl : `/${plugin.readmeUrl}`)
        const res = await fetch(readmeUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        body.innerHTML = await res.text()
        // README 标题降级 (h1→h2, h2→h3), 避免与页面主标题 h1 / 章节 h2 冲突
        body.querySelectorAll('h1, h2').forEach((h) => {
          const tag = h.tagName === 'H1' ? 'h2' : 'h3'
          const nh = document.createElement(tag)
          nh.innerHTML = h.innerHTML
          h.replaceWith(nh)
        })
        body.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener' })
      } catch {
        body.innerHTML = `<p>${esc(DSHR.t('readme.unavailable'))}</p>`
      }
    }

    // ------------------------------------------------------------------ 元信息表
    function renderMeta() {
      const table = $('.meta-table')
      if (!table) return
      const author = (plugin.repo || '').split('/')[0]
      const rows = [
        ['meta.author', esc(author)],
        ['meta.repo', `<a href="${esc(plugin.githubUrl)}" target="_blank" rel="noopener">${esc(plugin.repo)}</a>`],
        ['meta.commit', `<code>${esc(plugin.latestCommit || '—')}</code>`],
        ['meta.updated', `${esc(plugin.pushedAt || '—')}（${esc(DSHR.relativeTime(plugin.pushedAt))}）`],
        ['meta.firstSeen', esc(plugin.firstSeenAt || '—')],
        ['meta.license', esc(plugin.license || '—')],
        ['meta.version', esc(plugin.version ? `v${plugin.version}` : '—')],
      ]
      table.innerHTML = rows.map(([k, v]) => `<tr><th>${esc(DSHR.t(k))}</th><td>${v}</td></tr>`).join('')
    }

    // ------------------------------------------------------------------ 风险区(可折叠)
    function renderRisk() {
      const p = $('.risk-content p')
      if (p) p.textContent = DSHR.t('risk.body')
      const btn = $('[data-dom-id="view-source-btn"]')
      if (btn) btn.href = plugin.githubUrl
      const header = $('.risk-header')
      const content = $('.risk-content')
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

    // ------------------------------------------------------------------ 相关推荐
    async function loadRelated() {
      try {
        const cat = normalizeCategory(plugin.category)
        const list = await DSHR.fetchJson('by-cat', cat)
        const related = relatedCandidates(list, plugin.slug, 4)
        const grid = $('.related-grid')
        if (grid) {
          grid.innerHTML = related.map((p) => `<a href="/p/${encodeURIComponent(p.slug)}.html" class="related-card">
          <div class="related-card-top">
            <span class="related-card-name">${esc(p.name)}</span>
            ${DSHR.badgeHtml(p.state)}
          </div>
          <div class="related-card-cat">${esc(DSHR.categoryLabel(normalizeCategory(p.category)))}</div>
          <div class="related-card-desc">${esc(p.description || '')}</div>
        </a>`).join('')
        }
      } catch (e) {
        console.warn('[dshregistry] related load failed', e)
      }
    }

    function renderAll() {
      renderStatics(); renderStats(); renderHeader(); renderExternal(); renderInstall(); renderMeta(); renderRisk()
    }

    DSHR.onReady(async () => {
      if (!isValidSlug(slug)) { location.replace('404.html'); return }
      try {
        // 只加载当前插件数据 (~1KB), 不全量下载 plugins.json (2.27MB)
        plugin = await DSHR.fetchJson('plugin', slug)
      } catch (e) {
        console.error('[dshregistry] plugin data load failed', e)
        plugin = null
      }
      if (!plugin) { location.replace('404.html'); return }
      // 统计条数据 (meta.json 仅 ~200B, 并行加载不阻塞)
      DSHR.fetchJson('meta').then((m) => { meta = m || {}; renderStats() }).catch(() => {})
      renderAll()
      await renderReadme()
      loadRelated()
    })
    DSHR.onLangChange(() => { if (plugin) renderAll() })
  })()
}
