/**
 * dshregistry 关于页逻辑:静态页,仅补充统计数据(插件数)。
 * 性能: 只加载 meta.json (136B), 不下载 plugins.json (2.27MB)
 */
(function () {
  'use strict'
  DSHR.onReady(async () => {
    document.title = DSHR.t('title.about')
    try {
      const meta = await DSHR.fetchJson('/data/meta.json')
      const el = document.getElementById('stat-plugins')
      if (el && meta.pluginCount !== undefined) el.textContent = meta.pluginCount
    } catch { /* 统计缺失不影响页面 */ }
  })
  DSHR.onLangChange(() => { document.title = DSHR.t('title.about') })
})()
