/**
 * 详情页纯函数(M-B 增量 3):与 page-plugin.js 共享,便于单测。
 * 数据形状见 web/data/plugin/<slug>.json 与 web/data/by-cat/<cat>.json;
 * 本模块不做 DOM、不碰网络,字符串插值统一交给调用方 DSHR.escapeHtml。
 */
'use strict'

/** 分类白名单:与爬虫 VALID_CATEGORIES / search-core 一致,未知分类回退 other。 */
export const CAT_WHITELIST = [
  'tool', 'vision', 'dashboard', 'bridge', 'launcher',
  'mcp', 'skill', 'memory', 'security', 'media', 'integration', 'other',
]

/** slug 白名单:仅字母数字 . _ -(与爬虫 slug 规则一致),其余一律 404。 */
export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9._-]+$/i.test(slug)
}

/** 分类归一:未知分类回退 other。 */
export function normalizeCategory(cat) {
  return CAT_WHITELIST.includes(cat) ? cat : 'other'
}

/**
 * external 区块显隐与卡片数据:
 * - dshfind 卡:有 external.dshfind 且含 grade/score 才渲染;
 * - dshhub 卡:有 external.dshhub 即渲染;
 * - 两者皆无 → any=false,整块隐藏。
 */
export function externalSectionData(plugin) {
  const ext = (plugin && plugin.external) || {}
  const find = ext.dshfind && (ext.dshfind.grade || ext.dshfind.score != null) ? ext.dshfind : null
  const hub = ext.dshhub || null
  return { hasFind: !!find, hasHub: !!hub, any: !!(find || hub), find, hub }
}

/**
 * 收录于 chips 数据:listedOn 各源 → { source: CSS 类, labelKey: i18n 键, url }。
 * source 类名:github / dshfind / hub(design 令牌);labelKey 保留原始 source 查 #src.*。
 * 无 url 的源渲染为纯文本 tag(不加外链)。
 */
export function listedOnSources(plugin) {
  const out = []
  for (const x of plugin.listedOn || []) {
    if (!x || typeof x.source !== 'string') continue
    const cls = x.source === 'dshhub' ? 'hub' : x.source
    out.push({ source: cls, labelKey: x.source, url: typeof x.url === 'string' ? x.url : null })
  }
  return out
}

/** 相关推荐:同分类候选排除自身,最多取 limit 个。 */
export function relatedCandidates(list, selfSlug, limit = 4) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && p.slug && p.slug !== selfSlug)
    .slice(0, limit)
}

/** 安装命令:installSpec 缺省回退 github:repo。 */
export function installCommand(plugin) {
  const spec = plugin.installSpec || (plugin.repo ? `github:${plugin.repo}` : '')
  return `dsh plugin --profile web add ${spec}`
}
