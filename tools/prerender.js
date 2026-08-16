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

const CATS = ['tool', 'vision', 'dashboard', 'bridge', 'launcher', 'mcp', 'skill', 'other']
const CAT_LABELS = {
  tool: ['工具', 'Tools'], vision: ['视觉', 'Vision'], dashboard: ['看板', 'Dashboard'],
  bridge: ['桥接', 'Bridge'], launcher: ['启动器', 'Launcher'], mcp: ['MCP', 'MCP'],
  skill: ['技能', 'Skills'], other: ['其他', 'Other'],
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

/** 详情页: 模板 + 插件数据 → 静态 HTML */
function renderPluginPage(tpl, p, readmeHtml) {
  let html = tpl
  const slug = p.slug
  const desc = (p.description || '').slice(0, 150)
  const url = `${BASE}/p/${encodeURIComponent(slug)}.html`
  // head
  html = html.replace('<title>DSH-Registry · 插件详情</title>', `<title>${esc(p.name)} · DSH-Registry</title>`)
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
  html = html.split('https://dshregistry.xyz/plugin.html').join(url)   // canonical + hreflang×3 + og:url
  html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(p.name)} · DSH-Registry">`)
  html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
  // body
  html = html.replace(/<h1 class="plugin-title">[^<]*<\/h1>/, `<h1 class="plugin-title">${esc(p.name)}</h1>`)
  html = html.replace(/<span class="plugin-category">[^<]*<\/span>/, `<span class="plugin-category">${esc(catLabel(p.category))}</span>`)
  html = html.replace(/<span class="trust-badge[^>]*>[\s\S]*?<\/span>/, badgeHtml(p))
  html = html.replace(/<p class="plugin-desc">[^<]*<\/p>/, `<p class="plugin-desc">${esc(p.description || '')}</p>`)
  html = html.replace(/<span class="plugin-stars">[^<]*<\/span>/, `<span class="plugin-stars">${p.stars}</span>`)
  html = html.replace(/最近更新：[^<]*/, `最近更新：${esc(p.pushedAt || '')}`)
  html = html.replace(/收录时间：[^<]*/, `收录时间：${esc(p.firstSeenAt || '')}`)
  html = html.replace(/(<a href=")[^"]*(" target="_blank" rel="noopener" class="btn-primary")/, `$1${esc(p.githubUrl)}$2`)
  html = html.replace(/(<a href=")[^"]*(" target="_blank" rel="noopener" class="btn-outline")/, `$1${esc(p.githubUrl)}$2`)
  html = html.replace(/<div class="code-block">[^<]*<\/div>/, `<div class="code-block">dsh plugin --profile web add ${esc(p.installSpec || `github:${p.repo}`)}</div>`)
  html = html.replace(/<span>通过基础检查[\s\S]*?<\/span>/, p.basicCheck
    ? '<span>通过基础检查（包结构/元数据/README 存在）。<strong>不构成安全保证。</strong></span>'
    : '<span><strong>未通过基础检查</strong>（缺少包结构/元数据/README）。安装风险自负。</span>')
  // 元信息表
  html = html.replace(/<td>deepseek-dev<\/td>/, `<td>${esc(p.repo.split('/')[0])}</td>`)
  html = html.replace(/<a href="https:\/\/github\.com\/deepseek-dev\/dsh-vision"[^>]*>deepseek-dev\/dsh-vision<\/a>/, `<a href="${esc(p.githubUrl)}" target="_blank" rel="noopener">${esc(p.repo)}</a>`)
  html = html.replace(/<td><code>abc1234<\/code><\/td>/, `<td><code>${esc(p.latestCommit || '—')}</code></td>`)
  html = html.replace(/<td>2026-08-13（3 天前）<\/td>/, `<td>${esc(p.pushedAt || '—')}（${esc(relativeTime(p.pushedAt))}）</td>`)
  html = html.replace(/<td>2026-03-15<\/td>/, `<td>${esc(p.firstSeenAt || '—')}</td>`)
  // README 区: 替换整个 desc-section 内容
  const readmeBody = readmeHtml !== null
    ? `<div class="readme-body">${readmeHtml}</div>`
    : `<div class="readme-body"><p>该插件未提供 README。</p></div>`
  html = html.replace(/<section class="page-section desc-section">[\s\S]*?<\/section>/,
    `<section class="page-section desc-section">\n      <h2 class="section-title">介绍</h2>\n      ${readmeBody}\n    </section>`)
  return html
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
const indexTpl = await readFile(join(WEB, 'index.html'), 'utf8')

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
