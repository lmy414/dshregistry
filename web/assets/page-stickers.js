/**
 * 周边页逻辑(M-B 增量 4):标题 i18n。
 * 贴纸卡、下载按钮与 license 均为静态 HTML;无额外数据请求,零后端。
 */
(function () {
  'use strict'
  DSHR.onReady(() => { document.title = DSHR.t('title.stickers') })
  DSHR.onLangChange(() => { document.title = DSHR.t('title.stickers') })
})()
