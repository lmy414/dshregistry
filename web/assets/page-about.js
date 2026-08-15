/**
 * dshregistry 关于页逻辑:静态页,仅补充统计数据(插件数)。
 */
(function () {
  'use strict'
  DSHR.onReady(async () => {
    document.title = DSHR.t('title.about')
    try {
      const [, meta] = await DSHR.loadData()
      const el = document.getElementById('stat-plugins')
      if (el && meta.pluginCount !== undefined) el.textContent = meta.pluginCount
    } catch { /* 统计缺失不影响页面 */ }
  })
  DSHR.onLangChange(() => { document.title = DSHR.t('title.about') })
})()
