/**
 * DSH-Registry 预渲染生成器
 *
 * 从数据产物生成静态详情页与分类页,让爬虫无需执行 JS 即可读到完整内容:
 *   web/p/<slug>.html  — 每个插件一个静态详情页(head 个性化 SEO + body 内容内联)
 *   web/c/<cat>.html   — 8 个分类静态页(预渲染该分类卡片)
 *
 * 产物不入库(见 .gitignore),本地/服务器各跑一次即得完整站点;由 sync.sh 在
 * 爬虫 + sitemap + 数据拆分后调用。用法: node tools/prerender.js
 */
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'web')
const PLUGINS_FILE = join(WEB, 'data', 'plugins.json')
const README_DIR = join(WEB, 'data', 'readme')
const P_DIR = join(WEB, 'p')
const C_DIR = join(WEB, 'c')
const BASE = 'https://dshregistry.xyz'

const CATS = ['tool', 'vision', 'dashboard', 'bridge', 'launcher', 'mcp', 'skill', 'memory', 'security', 'media', 'integration', 'other']
const CAT_LABELS = {
  tool: ['工具', 'Tools'], vision: ['视觉', 'Vision'], dashboard: ['看板', 'Dashboard'],
  bridge: ['桥接', 'Bridge'], launcher: ['启动器', 'Launcher'], mcp: ['MCP', 'MCP'],
  skill: ['技能', 'Skills'], memory: ['记忆', 'Memory'], security: ['安全', 'Security'],
  media: ['媒体', 'Media'], integration: ['集成', 'Integration'], other: ['其他', 'Other'],
}
const BADGE_TEXT = { unreviewed: ['未审计', 'Unreviewed'], vouched: ['社区认可', 'Community-Vouched'], flagged: ['有风险报告', 'Flagged'] }
const BADGE_CLASS = { unreviewed: 'unreviewed', community: 'vouched', flagged: 'flagged' }

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function relativeTime(isoDate) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000))
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

const SVG_STAR = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'
const SVG_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'

function badgeHtml(p) {
  const cls = BADGE_CLASS[p.state] || 'unreviewed'
  const text = (BADGE_TEXT[cls] || BADGE_TEXT.unreviewed)[0]
  const tip = Array.isArray(p.stateReasons) && p.stateReasons.length > 0 ? p.stateReasons.join('; ') : text
  return `<span class="trust-badge ${cls}" title="${esc(tip)}">${text}</span>`
}

function catLabel(cat) {
  return (CAT_LABELS[cat] || CAT_LABELS.other).join(' ')
}

/** 详情页: 模板 + 插件数据 → 静态 HTML(以 web/plugin.html 的 `<!-- @key -->` 锚点注释为替换点) */
function renderPluginPage(tpl, p, readmeHtml) {
  let html = tpl
  const slug = p.slug
  const desc = (p.description || '').slice(0, 150)
  const url = `${BASE}/p/${encodeURIComponent(slug)}.html`
  const installSpec = p.installSpec || `github:${p.repo}`
  // head
  html = anchor(html, 'title', `${esc(p.name)} · DSH-Registry`)
  html = anchor(html, 'meta-desc', esc(desc))
  html = anchor(html, 'og-title', `${esc(p.name)} · DSH-Registry`)
  html = anchor(html, 'og-desc', esc(desc))
  html = anchor(html, 'twitter-title', `${esc(p.name)} · DSH-Registry`)
  html = anchor(html, 'twitter-desc', esc(desc))
  html = html.split('https://dshregistry.xyz/plugin.html').join(url)   // canonical + hreflang×3 + og:url
  // body
  html = anchor(html, 'name', esc(p.name))
  html = anchor(html, 'category', esc(catLabel(p.category)))
  html = anchor(html, 'badge', badgeHtml(p))
  html = anchor(html, 'desc', esc(p.description || ''))
  html = anchor(html, 'stars', String(p.stars ?? 0))
  html = anchor(html, 'updated', esc(p.pushedAt || ''))
  html = anchor(html, 'firstSeen', esc(p.firstSeenAt || ''))
  html = anchor(html, 'indexed', indexedOnHtml(p))
  html = html.split('<!-- @github-url -->').join(esc(p.githubUrl))   // GitHub 查看按钮 + 风险区查看源码
  html = anchor(html, 'install-cmd', `dsh plugin --profile web add ${esc(installSpec)}`)
  html = anchor(html, 'check', p.basicCheck
    ? '<span>通过基础检查（包结构/元数据/README 存在）。<strong>不构成安全保证。</strong></span>'
    : '<span><strong>未通过基础检查</strong>（缺少包结构/元数据/README）。安装风险自负。</span>')
  html = anchor(html, 'warning', warningHtml(p))
  // 元信息表: 整块替换(表外壳保留)
  html = anchor(html, 'meta', metaRowsHtml(p))
  // README 区: 注入清洗后的片段到 .readme-body 内;缺片段/无 readmeUrl 降级
  const readmeBody = readmeHtml !== null
    ? readmeHtml
    : `<p>${p.readmeUrl ? '该插件未提供 README。' : 'README 暂不可用'}</p>`
  html = anchor(html, 'readme', readmeBody)
  return html
}

/**
 * 锚点替换(web/plugin.html 的 `<!-- @key -->` 注释为替换点):
 * - 单点形态 `<!-- @key -->` → 替换为 value;
 * - 块形态 `<!-- @key-start -->…<!-- @key-end -->` → 整体(含两注释)替换为 value。
 * 找不到锚点即抛错,防止模板与生成器不同步。
 */
function anchor(html, key, value) {
  const single = `<!-- @${key} -->`
  const startAnchor = `<!-- @${key}-start -->`
  const endAnchor = `<!-- @${key}-end -->`
  const s = html.indexOf(single)
  if (s !== -1) return `${html.slice(0, s)}${value}${html.slice(s + single.length)}`
  const s2 = html.indexOf(startAnchor)
  if (s2 !== -1) {
    const e = html.indexOf(endAnchor, s2)
    if (e === -1) throw new Error(`[prerender] 模板缺少锚点 <!-- @${key}-end -->`)
    return `${html.slice(0, s2)}${value}${html.slice(e + endAnchor.length)}`
  }
  throw new Error(`[prerender] 模板缺少锚点 <!-- @${key} -->`)
}

/** 收录于 chips: GitHub 恒有 + listedOn 各源外链(新窗口 rel="noopener");无 url 渲染纯文本。 */
function indexedOnHtml(p) {
  const tags = ['<span class="src-tag github">GitHub</span>']
  for (const x of p.listedOn || []) {
    if (!x || typeof x.source !== 'string') continue
    const cls = x.source === 'dshhub' ? 'hub' : x.source
    const srcName = x.source === 'dshfind' ? 'dshfind' : x.source === 'dshhub' ? 'DSH Hub' : x.source
    if (typeof x.url === 'string' && x.url) {
      tags.push(`<a class="src-tag ${esc(cls)}" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(srcName)}</a>`)
    } else {
      tags.push(`<span class="src-tag ${esc(cls)}">${esc(srcName)}</span>`)
    }
  }
  return tags.join('')
}

/** 信任状态差异化警示条(与 page-plugin.js renderWarningCallout 同文案;data-dom-id 保留供运行时修正)。 */
function warningHtml(p) {
  const state = p.state || 'unreviewed'
  if (state === 'community') {
    return '<div class="warning-callout vouched" data-dom-id="warning-callout"><strong>社区认可:</strong>该插件已通过社区信任门槛(stars/活跃度等),但<strong>仍未经过人工安全审计</strong>。插件将以你运行 DSH 的用户权限执行代码,建议安装前先查看源码自行评估。</div>'
  }
  return '<div class="warning-callout" data-dom-id="warning-callout"><strong>安装前必读:</strong>此插件未经人工安全审计。安装后将以你运行 DSH 的用户权限执行任意代码,可读写你的文件、访问网络。仅安装你信任的来源。</div>'
}

/** 元信息表行: 与 page-plugin.js renderMeta 对齐(作者/仓库/commit/更新/收录/许可/版本)。 */
function metaRowsHtml(p) {
  const author = (p.repo || '').split('/')[0]
  const rows = [
    ['作者', esc(author)],
    ['GitHub 仓库', `<a href="${esc(p.githubUrl)}" target="_blank" rel="noopener">${esc(p.repo)}</a>`],
    ['最新 commit', `<code>${esc(p.latestCommit || '—')}</code>`],
    ['最近更新', `${esc(p.pushedAt || '—')}（${esc(relativeTime(p.pushedAt))}）`],
    ['收录时间', esc(p.firstSeenAt || '—')],
    ['许可证', esc(p.license || '—')],
    ['版本', esc(p.version ? `v${p.version}` : '—')],
  ]
  return rows.map(([k, v]) => `<tr>\n          <th>${k}</th>\n          <td>${v}</td>\n        </tr>`).join('\n        ')
}

/** 精确替换 <div class="plugin-grid"> 整块(数 div 嵌套深度定位闭合,避免截断卡片)。 */
function replaceGridBlock(html, newInner) {
  const start = html.indexOf('<div class="plugin-grid">')
  if (start === -1) return html
  let depth = 0
  let end = -1
  const matches = html.matchAll(/<div\b|<\/div>/g)
  for (const m of matches) {
    if (m.index < start) continue
    depth += m[0] === '<div' ? 1 : -1
    if (depth === 0) { end = m.index; break }
  }
  if (end === -1) return html
  return `${html.slice(0, start)}<div class="plugin-grid">\n${newInner}\n    </div>${html.slice(end + 6)}`
}

/** 分类页: 首页模板 + 该分类卡片 → 静态 HTML */
function renderCategoryPage(tpl, cat, list) {
  let html = tpl
  const label = catLabel(cat)
  const url = `${BASE}/c/${cat}.html`
  html = html.replace('<title>DSH-Registry · DSH 插件索引</title>', `<title>${esc(label)} · DSH-Registry</title>`)
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(label)}类 DSH 插件 — ${list.length} 个。${esc(label)} plugins on DSH-Registry.">`)
  html = html.split('https://dshregistry.xyz/').join(url)   // canonical + hreflang + og:url(首页级)
  html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(label)} · DSH-Registry">`)
  html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(label)}类 DSH 插件 — ${list.length} 个。">`)
  const cards = list.map((p) => `<a href="/p/${encodeURIComponent(p.slug)}.html" class="plugin-card">
      <div class="card-top">
        <div class="card-title-group">
          <div class="card-title">${esc(p.name)}</div>
          <div class="card-category">${esc(catLabel(p.category))}</div>
        </div>
        ${badgeHtml(p)}
      </div>
      <div class="card-desc">${esc(p.description || '')}</div>
      <div class="card-meta">
        <span class="card-meta-item card-author">${SVG_USER} ${esc(p.repo.split('/')[0])}</span>
        <span class="card-meta-item card-stars">${SVG_STAR} ${p.stars}</span>
        <span class="card-updated">${esc(relativeTime(p.pushedAt))}更新</span>
      </div>
    </a>`).join('')
  return replaceGridBlock(html, cards)
}

async function atomicWrite(file, content) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rm(file, { force: true })
  await writeFile(file, content, 'utf8')
  await rm(tmp, { force: true })
}

const plugins = JSON.parse(await readFile(PLUGINS_FILE, 'utf8'))
const pluginTpl = await readFile(join(WEB, 'plugin.html'), 'utf8')
// 分类页模板从 tools/templates/index-legacy.html 读取(旧首页模板);
// web/index.html 已被搜索主页设计稿替换,不再含分类页所需的 plugin-grid 结构。
const indexTpl = await readFile(join(ROOT, 'tools', 'templates', 'index-legacy.html'), 'utf8')

// 1) 详情页
let n = 0
for (const p of plugins) {
  if (!p.slug) continue
  let readmeHtml = null
  try { readmeHtml = await readFile(join(README_DIR, `${p.slug}.html`), 'utf8') } catch { /* 无片段 */ }
  await atomicWrite(join(P_DIR, `${p.slug}.html`), renderPluginPage(pluginTpl, p, readmeHtml))
  n++
}
// 清理下架插件的旧详情页
const oldPages = await readdir(P_DIR).catch(() => [])
const keepPages = new Set(plugins.filter((p) => p.slug).map((p) => `${p.slug}.html`))
for (const f of oldPages) if (!keepPages.has(f)) await rm(join(P_DIR, f), { force: true })
console.log(`[prerender] 详情页 ${n} 个 → web/p/`)

// 2) 分类页
for (const cat of CATS) {
  const list = plugins.filter((p) => p.slug && (p.category || 'other') === cat).slice(0, 60)
  await atomicWrite(join(C_DIR, `${cat}.html`), renderCategoryPage(indexTpl, cat, list))
}
console.log(`[prerender] 分类页 ${CATS.length} 个 → web/c/`)
