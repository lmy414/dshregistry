/**
 * 文档页纯函数:站点统计渲染 + 数据 API 端点清单生成。
 * 供 web/assets/page-docs.js(浏览器)与 tools/tests/ 单测共用,零 DOM 依赖。
 */
'use strict'

/** 空态统计占位(meta 缺失/损坏时保留)。 */
const EMPTY_STATS = [
  { id: 'stat-plugins', value: '—' },
  { id: 'stat-cats', value: '—' },
  { id: 'stat-community', value: '—' },
  { id: 'stat-updated', value: '—' },
]

/**
 * meta.json → 统计卡片值数组([{ id, value }])。
 * 缺失字段用占位符;更新时间默认取 ISO 日期部分,可注入自定义格式化。
 */
export function buildSiteStats(meta, fmt) {
  if (!meta || typeof meta !== 'object') return EMPTY_STATS
  const f = typeof fmt === 'function' ? fmt : (v) => (v == null ? '—' : String(v))
  return [
    { id: 'stat-plugins', value: String(meta.pluginCount ?? '—') },
    { id: 'stat-cats', value: String(meta.categoryCount ?? '—') },
    { id: 'stat-community', value: String(meta.communityCount ?? '—') },
    { id: 'stat-updated', value: f(meta.updatedAt) },
  ]
}

/** 更新时间展示:ISO → "YYYY-MM-DD HH:MM" 日期时间,双语通用。 */
export function formatUpdatedAt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 数据 API 端点清单(与 web/data/ 实际产物一一对应;slug/cat 为占位)。 */
export const API_ENDPOINTS = [
  { path: '/data/plugins.json', key: 'plugins' },
  { path: '/data/search.json', key: 'search' },
  { path: '/data/changelog.json', key: 'changelog' },
  { path: '/data/trending.json', key: 'trending' },
  { path: '/data/pages.json', key: 'pages' },
  { path: '/data/plugin/&lt;slug&gt;.json', key: 'plugin' },
  { path: '/data/by-cat/&lt;cat&gt;.json', key: 'byCat' },
  { path: '/data/meta.json', key: 'meta' },
]

/**
 * 端点表 tbody 行 HTML:path 用 <code> 保留(端点名双语一致),
 * 说明文案走 t(`docs.api.<key>`) 查 i18n `#docs.api.<key>` 条目。
 */
export function apiEndpointRows(endpoints, t) {
  return endpoints.map((e) => {
    const desc = typeof t === 'function' ? t(`docs.api.${e.key}`) : e.key
    return `<tr><td><code>${e.path}</code></td><td class="api-desc">${desc}</td></tr>`
  }).join('')
}
