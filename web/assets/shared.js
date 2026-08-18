/**
 * dshregistry 共享逻辑:主题切换、语言切换(i18n)、数据加载、渲染助手。
 * 纯原生 JS,无框架无构建;配合原型页面的 DOM 结构工作。
 */
(function () {
  'use strict'

  const htmlEl = document.documentElement

  // ------------------------------------------------------------------ 主题
  const THEME_KEY = 'dsh-theme'
  function preferredTheme() {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  function applyTheme(theme) {
    htmlEl.classList.toggle('dark', theme === 'dark')
    htmlEl.classList.toggle('light', theme !== 'dark')
  }
  applyTheme(preferredTheme())
  function initThemeToggle() {
    const btn = document.querySelector('.theme-toggle')
    if (!btn) return
    btn.addEventListener('click', () => {
      const next = htmlEl.classList.contains('dark') ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, next)
      applyTheme(next)
    })
  }

  // ------------------------------------------------------------------ i18n
  const LANG_KEY = 'dsh-lang'
  const dictCache = {}
  function currentLang() {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'zh' || saved === 'en') return saved
    return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
  async function loadDict(lang) {
    if (dictCache[lang]) return dictCache[lang]
    const res = await fetch(`/i18n/${lang}.json`)
    if (!res.ok) throw new Error(`i18n/${lang}.json: HTTP ${res.status}`)
    dictCache[lang] = await res.json()
    return dictCache[lang]
  }
  let dict = {}
  /** 静态文本:字典里 `@选择器` 条目替换 textContent;`@!选择器` 替换 innerHTML(含标签的文案)。 */
  function applyStaticTexts() {
    for (const [rawSelector, text] of Object.entries(dict)) {
      if (!rawSelector.startsWith('@')) continue
      if (rawSelector.startsWith('@!')) {
        document.querySelectorAll(rawSelector.slice(2)).forEach((el) => { el.innerHTML = text })
      } else {
        document.querySelectorAll(rawSelector.slice(1)).forEach((el) => { el.textContent = text })
      }
    }
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const v = dict[el.getAttribute('data-i18n-placeholder')]
      if (typeof v === 'string') el.setAttribute('placeholder', v)
    })
    htmlEl.lang = currentLang() === 'zh' ? 'zh-CN' : 'en'
  }
  function syncLangToggle() {
    const lang = currentLang()
    document.querySelectorAll('.lang-toggle button').forEach((btn) => {
      const isZh = btn.textContent.trim() === '中'
      btn.classList.toggle('active', (lang === 'zh') === isZh)
    })
  }
  async function setLang(lang) {
    localStorage.setItem(LANG_KEY, lang)
    dict = await loadDict(lang)
    applyStaticTexts()
    syncLangToggle()
    document.dispatchEvent(new CustomEvent('dsh:lang', { detail: { lang } }))
  }
  function initLangToggle() {
    document.querySelectorAll('.lang-toggle button').forEach((btn) => {
      btn.addEventListener('click', () => setLang(btn.textContent.trim() === '中' ? 'zh' : 'en'))
    })
  }
  /** 查 JS 文案:`#key` 条目。 */
  function t(key) {
    const v = dict[`#${key}`]
    return typeof v === 'string' ? v : key
  }

  // ------------------------------------------------------------------ 数据
  /** 只允许站内相对路径:纯静态站不 fetch 任何外部资源;带协议/协议相对的 URL 一律拒绝。 */
  function assertLocalUrl(url) {
    if (typeof url !== 'string') throw new Error(`[dshregistry] 非法数据源: ${String(url)}`)
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.startsWith('//')) {
      throw new Error(`[dshregistry] 拒绝外部数据源: ${url}`)
    }
    return url
  }
  /** 数据路由白名单: 只允许 4 个固定数据模式;参数仅作文件名片段并经 encodeURIComponent 消毒。 */
  const DATA_ROUTES = {
    plugins: () => '/data/plugins.json',
    meta: () => '/data/meta.json',
    plugin: (slug) => `/data/plugin/${encodeURIComponent(slug)}.json`,
    'by-cat': (cat) => `/data/by-cat/${encodeURIComponent(cat)}.json`,
  }
  function fetchJson(key, arg) {
    const build = DATA_ROUTES[key]
    if (typeof build !== 'function') throw new Error(`[dshregistry] 未知数据源: ${String(key)}`)
    const url = assertLocalUrl(build(arg))
    return fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
      return res.json()
    })
  }
  /** 带 sessionStorage 缓存的加载: 切换页面不重复下载 (首页数据 2.27MB 关键优化) */
  const DATA_CACHE_KEY = 'dsh-data-v1'
  function loadData() {
    const cached = sessionStorage.getItem(DATA_CACHE_KEY)
    if (cached) {
      try {
        const { t, plugins, meta } = JSON.parse(cached)
        if (t && Date.now() - t < 10 * 60 * 1000) return Promise.resolve([plugins, meta])
      } catch { /* 缓存损坏则重取 */ }
    }
    return Promise.all([fetchJson('plugins'), fetchJson('meta')]).then(([plugins, meta]) => {
      try {
        sessionStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ t: Date.now(), plugins, meta }))
      } catch { /* 存储满则忽略 */ }
      return [plugins, meta]
    })
  }

  // ------------------------------------------------------------------ 渲染助手
  const SVG_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
  const SVG_STAR = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  /** 分类键 → 当前语言标签。 */
  const CATEGORIES = ['all', 'tool', 'vision', 'dashboard', 'bridge', 'launcher', 'mcp', 'skill', 'memory', 'security', 'media', 'integration', 'other']
  function categoryLabel(cat) {
    return t(`cat.${cat}`)
  }

  /** 信任状态:data 用 community,原型徽章类名是 vouched。 */
  function badgeClass(state) {
    return state === 'community' ? 'vouched' : state === 'flagged' ? 'flagged' : 'unreviewed'
  }
  function badgeHtml(state, reasons) {
    const cls = badgeClass(state)
    const tip = Array.isArray(reasons) && reasons.length > 0 ? reasons.join('; ') : t(`badge.tip.${cls}`)
    return `<span class="trust-badge ${cls}" title="${escapeHtml(tip)}">${escapeHtml(t(`badge.${cls}`))}</span>`
  }

  /** 相对时间(双语):today/yesterday/N 天前 → 周 → 月 → 年。 */
  function relativeTime(isoDate) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000))
    const zh = currentLang() === 'zh'
    if (days === 0) return zh ? '今天' : 'today'
    if (days === 1) return zh ? '昨天' : 'yesterday'
    if (days < 7) return zh ? `${days} 天前` : `${days} days ago`
    if (days < 30) return zh ? `${Math.floor(days / 7)} 周前` : `${Math.floor(days / 7)} weeks ago`
    if (days < 365) return zh ? `${Math.floor(days / 30)} 个月前` : `${Math.floor(days / 30)} months ago`
    return zh ? `${Math.floor(days / 365)} 年前` : `${Math.floor(days / 365)} years ago`
  }

  /** 替换"图标+文本"元素的尾部文本节点(保留内部 SVG)。 */
  function setTrailingText(selector, text) {
    const el = document.querySelector(selector)
    if (!el) return
    const node = [...el.childNodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
    if (node) node.textContent = ` ${text} `
  }

  // ------------------------------------------------------------------ 启动
  async function boot() {
    initThemeToggle()
    initLangToggle()
    dict = await loadDict(currentLang())
    applyStaticTexts()
    syncLangToggle()
    prefetchNav()
    document.dispatchEvent(new CustomEvent('dsh:ready', { detail: { lang: currentLang() } }))
  }

  /** 预取导航目标页 (关于/首页), 切换时命中缓存不重新下载 */
  function prefetchNav() {
    if (!('requestIdleCallback' in window)) return
    const targets = [...new Set([...document.querySelectorAll('a[data-dom-id^="nav-"], a.brand, a[data-dom-id="nav-about-footer"]')].map((a) => a.getAttribute('href')).filter(Boolean))]
    requestIdleCallback(() => {
      targets.forEach((href) => {
        if (href === location.pathname || !href.startsWith('/')) return
        const link = document.createElement('link')
        link.rel = 'prefetch'
        link.href = href
        document.head.appendChild(link)
      })
    }, { timeout: 2000 })
  }

  window.DSHR = {
    t, loadData, fetchJson, assertLocalUrl, escapeHtml, badgeHtml, categoryLabel, relativeTime, setTrailingText,
    CATEGORIES, SVG_USER, SVG_STAR,
    onReady: (fn) => document.addEventListener('dsh:ready', fn),
    onLangChange: (fn) => document.addEventListener('dsh:lang', fn),
    lang: currentLang,
  }
  document.addEventListener('DOMContentLoaded', () => { boot().catch((e) => console.error('[dshregistry] boot failed', e)) })
})()
