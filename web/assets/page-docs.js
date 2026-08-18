/**
 * 文档页逻辑(M-B 增量 4):标题 i18n + meta 统计渲染 + 数据 API 端点表 + 侧栏锚点滚动高亮。
 * 纯函数在 docs-core.js(与 node 单测共用);本文件只做 DOM 绑定。
 * 依赖 window.DSHR(shared.js):fetchJson(白名单路由)/t/lang 等。
 */
'use strict'

import { buildSiteStats, API_ENDPOINTS, apiEndpointRows, formatUpdatedAt } from './docs-core.js'

export { buildSiteStats, API_ENDPOINTS, apiEndpointRows, formatUpdatedAt }

// ====================================================================
// DOM 区(仅浏览器)
// ====================================================================
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  ;(() => {
    /** 渲染 meta 统计到 4 张统计卡(元素 id 由 docs-core buildSiteStats 给出)。 */
    function renderStats(meta) {
      buildSiteStats(meta, formatUpdatedAt).forEach(({ id, value }) => {
        const el = document.getElementById(id)
        if (el) el.textContent = value
      })
    }

    /** 渲染数据 API 端点表 tbody(说明走 i18n `#docs.api.<key>`)。 */
    function renderApiEndpoints() {
      const tbody = document.getElementById('apiEndpoints')
      if (!tbody) return
      tbody.innerHTML = apiEndpointRows(API_ENDPOINTS, (key) => DSHR.t(key))
    }

    /** 侧栏锚点滚动高亮:当前可见 section 对应链接加 .active(降级为点击高亮)。 */
    function wireAnchorSpy() {
      const links = [...document.querySelectorAll('.anchor-nav a[href^="#"]')]
      if (!links.length) return
      const setActive = (href) => {
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === href))
      }
      if (typeof IntersectionObserver !== 'undefined') {
        const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean)
        const io = new IntersectionObserver((entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) setActive(`#${en.target.id}`)
          })
        }, { rootMargin: '-20% 0px -70% 0px' })
        sections.forEach((s) => io.observe(s))
      } else {
        links.forEach((a) => a.addEventListener('click', () => setActive(a.getAttribute('href'))))
      }
    }

    DSHR.onReady(async () => {
      document.title = DSHR.t('title.docs')
      renderApiEndpoints()
      wireAnchorSpy()
      try {
        const meta = await DSHR.fetchJson('meta')
        renderStats(meta)
      } catch { /* 统计缺失保留占位符,不影响页面 */ }
    })
    DSHR.onLangChange(() => {
      document.title = DSHR.t('title.docs')
      renderApiEndpoints()
    })
  })()
}
