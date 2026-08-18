/**
 * 文档页 + 周边页 DOM 冒烟测试(jsdom):加载 web/docs.html / web/stickers.html +
 * shared.js + page-docs.js(page-stickers.js 仅标题 i18n),stub fetch 读真实
 * web/data,验证:
 * - docs:5 个 section + 侧栏 5 锚点、meta 统计数字、API 端点表 8 行、
 *   Issue 提交按钮 rel=noopener + 新窗口、外部链接 rel=noopener、i18n 切换(EN)。
 * - stickers:13 张贴纸卡 + 每卡 <a download>、ZIP 按钮 href 指向 mascot-pack.zip、
 *   license 三要点 + 合规三行 + "下载使用即同意"。
 * 用法: node tools/dev/dom-smoke-docs.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(ROOT, 'web')

// ---- stub fetch: 站内路径读真实文件 ----
const fileCache = new Map()
const loadFile = async (file) => {
  if (!fileCache.has(file)) fileCache.set(file, await readFile(file, 'utf8'))
  return fileCache.get(file)
}
function stubFetch(window) {
  window.fetch = async (url) => {
    const clean = String(url).split('?')[0]
    const file = join(WEB, clean)
    let body
    try {
      body = await loadFile(file)
    } catch (e) {
      return { ok: false, status: 404, json: async () => { throw new Error('404') }, text: async () => { throw new Error('404') } }
    }
    const type = extname(file) === '.json' ? 'application/json' : 'text/html'
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body, headers: { get: () => type } }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ok -', msg) }

/** 注入 shared.js + 目标页面模块(剥离 import/export 后单次 eval 同作用域)。 */
async function bootPage(html, pageFile, coreFiles) {
  const dom = new JSDOM(html, {
    url: 'http://localhost:4815/docs.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom
  stubFetch(window)
  const run = (src) => window.eval(src)
  run(await loadFile(join(WEB, 'assets', 'shared.js')))
  // 纯函数模块 + 页面模块拼接为单次 eval(同脚本作用域,函数引用才成立;
  // strict-mode eval 的顶层声明不跨 eval 泄漏)。
  const parts = []
  for (const f of coreFiles || []) {
    parts.push((await loadFile(join(WEB, 'assets', f))).replace(/\bexport\s+/g, ''))
  }
  const pageSrc = (await loadFile(join(WEB, 'assets', pageFile)))
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*/g, '')
    .replace(/export\s*\{[\s\S]*?\}\s*/, '')   // 剥掉 re-export 块(留在原地变非法块语句)
    .replace(/\bexport\s+/g, '')
  run(`${parts.join('\n')}\n${pageSrc}`)
  // jsdom 中 DOMContentLoaded 已提前触发,手动派发以启动 shared.js boot;默认强制 zh
  window.localStorage.setItem('dsh-lang', 'zh')
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }))
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting dsh:ready')), 15000)
    window.document.addEventListener('dsh:ready', () => { clearTimeout(t); resolve() }, { once: true })
  })
  await sleep(300)
  return window
}

console.log('== 文档页:结构 ==')
const wDocs = await bootPage(await loadFile(join(WEB, 'docs.html')), 'page-docs.js', ['docs-core.js'])
const dd = wDocs.document
assert(dd.title === '文档 · dshregistry', `页面 title ("${dd.title}")`)
const sectionIds = ['about', 'submit', 'api', 'resources', 'friends']
for (const id of sectionIds) {
  assert(!!dd.getElementById(id), `section #${id} 存在`)
}
assert(dd.querySelectorAll('.anchor-nav a[href^="#"]').length === 5, '侧栏 5 个锚点链接')
assert(dd.querySelectorAll('.anchor-nav a[href^="#"]')[0].classList.contains('active'), '首个锚点默认 active')
const heroMascot = dd.querySelector('.docs-hero-mascot')
assert(!!heroMascot && heroMascot.src.includes('Q2_docs'), 'docs-hero Q2 抱书吉祥物')

console.log('== 文档页:统计数字(meta.json 渲染) ==')
// 动态断言:页面渲染值须与 meta.json 一致(数据随每次同步变化,不硬编码)
const metaCount = JSON.parse(await loadFile(join(WEB, 'data', 'meta.json')))
assert(dd.getElementById('stat-plugins').textContent === String(metaCount.pluginCount), `插件数 (页面 "${dd.getElementById('stat-plugins').textContent}" vs meta "${metaCount.pluginCount}")`)
assert(dd.getElementById('stat-cats').textContent === String(metaCount.categoryCount), `分类数 (页面 "${dd.getElementById('stat-cats').textContent}" vs meta "${metaCount.categoryCount}")`)
assert(dd.getElementById('stat-community').textContent === String(metaCount.communityCount), `社区认可数 (页面 "${dd.getElementById('stat-community').textContent}" vs meta "${metaCount.communityCount}")`)
assert(/^\d{4}-\d{2}-\d{2}$/.test(dd.getElementById('stat-updated').textContent), `更新时间 YYYY-MM-DD ("${dd.getElementById('stat-updated').textContent}")`)

console.log('== 文档页:数据 API 端点表 ==')
const apiRows = dd.querySelectorAll('#apiEndpoints tr')
assert(apiRows.length === 8, `端点表 ${apiRows.length} 行`)
assert(dd.querySelector('#apiEndpoints tr:nth-child(1) td code').textContent === '/data/plugins.json', '首行 plugins.json')
assert(dd.querySelector('#apiEndpoints tr:nth-child(8) td code').textContent === '/data/meta.json', '末行 meta.json')
assert(apiRows[5].textContent.includes('slug'), 'plugin/<slug>.json 占位存在')

console.log('== 文档页:外部链接 rel=noopener ==')
const issueBtn = dd.getElementById('submitIssueBtn')
assert(!!issueBtn && issueBtn.getAttribute('href').startsWith('https://github.com/lmy414/dshregistry/issues/new'), '提交按钮 GitHub Issue 链接')
assert(issueBtn.target === '_blank' && issueBtn.rel === 'noopener', '提交按钮新窗口 + rel=noopener')
const externalLinks = [...dd.querySelectorAll('a[href^="http"]')]
assert(externalLinks.length > 0, '存在外部链接')
assert([...externalLinks].every((a) => a.target === '_blank' && a.rel === 'noopener'), '全部外链新窗口 + rel=noopener')
const friendLinks = dd.querySelectorAll('.friend-card')
assert(friendLinks.length === 2, '友情链接 2 张卡')
const friendHrefs = [...friendLinks].map((a) => a.getAttribute('href'))
assert(friendHrefs.includes('https://dshfind.com/zh'), 'dshfind 链接')
assert(friendHrefs.includes('https://hub.omdsh.dev'), 'DSH Hub 链接')
assert(!friendHrefs.includes('https://www.deepseek.com/'), '友链不含 DeepSeek 官方')

console.log('== 文档页:信任三态 + 免责 + 合规 ==')
assert(dd.querySelectorAll('#about .trust-explain-item').length === 3, '信任三态 3 卡')
assert(dd.querySelectorAll('#about .disclaimer-callout li').length === 3, '免责声明 3 条')
assert(dd.querySelectorAll('#about .compliance-callout li').length === 3, '合规说明 3 条')
assert(dd.querySelector('#about .compliance-callout li:nth-child(1)').textContent.includes('无隶属'), '合规:无隶属关系')

console.log('== 文档页:语言切换(EN) ==')
wDocs.document.querySelectorAll('.lang-toggle button')[1].click()
await sleep(400)
assert(wDocs.document.title === 'Docs · dshregistry', `EN title ("${wDocs.document.title}")`)
assert(wDocs.document.querySelector('.docs-hero-title').textContent === 'Docs', 'EN hero 标题')
assert(wDocs.document.querySelector('.nav-links a[data-dom-id="nav-docs"]').textContent === 'Docs', 'EN 导航文档')
assert(wDocs.document.querySelector('.nav-links a[data-dom-id="nav-stickers"]').textContent === 'Merch', 'EN 导航周边')
assert(wDocs.document.querySelector('#apiEndpoints tr:nth-child(1) .api-desc').textContent.includes('Full index'), 'EN 端点表说明')

console.log('== 周边页:结构 ==')
const wStickers = await bootPage(await loadFile(join(WEB, 'stickers.html')), 'page-stickers.js')
const ds = wStickers.document
assert(ds.title === '周边 · 鲸鱼娘素材 · dshregistry', `页面 title ("${ds.title}")`)
const cards = ds.querySelectorAll('.sticker-card')
assert(cards.length === 13, `贴纸卡 ${cards.length} 张`)
assert(cards.length === new Set([...cards].map((c) => c.querySelector('img')?.src)).size, '13 张预览图 src 各不相同')
assert(ds.querySelector('.stickers-hero-mascot img').src.includes('Q6_wave'), 'hero Q6 挥手吉祥物')

console.log('== 周边页:单张下载 + ZIP ==')
const downloads = [...cards].map((c) => c.querySelector('.sticker-download'))
assert(downloads.length === 13 && downloads.every((a) => a && a.hasAttribute('download') && a.getAttribute('href').includes('/assets/mascot/Q')), '每卡 <a download> 下载 PNG')
const zipBtn = ds.getElementById('zipDownloadBtn')
assert(!!zipBtn && zipBtn.hasAttribute('download'), 'ZIP 按钮带 download 属性')
assert(zipBtn.getAttribute('href') === '/assets/mascot/mascot-pack.zip', `ZIP href ("${zipBtn.getAttribute('href')}")`)
assert(ds.querySelector('.stickers-hero-note').textContent.includes('13 张'), 'hero note 13 张')

console.log('== 周边页:license 三要点 + 合规 + 同意 ==')
assert(ds.querySelectorAll('.license-point').length === 3, 'license 三要素')
const licenseTitles = [...ds.querySelectorAll('.license-point-title')].map((el) => el.textContent)
assert(licenseTitles.includes('署名') && licenseTitles.includes('非商业') && licenseTitles.includes('相同方式共享'), `三要素标题 ("${licenseTitles.join(' / ')}")`)
assert(ds.querySelectorAll('.license-compliance-line').length === 3, '合规三行')
assert(ds.querySelector('.license-compliance-line:nth-child(1)').textContent.includes('无隶属'), '合规:无隶属关系')
assert(ds.querySelector('.license-compliance-line:nth-child(2)').textContent.includes('CC BY-NC-SA 4.0'), '合规:许可协议')
assert(ds.querySelector('.license-compliance-line:nth-child(3)').textContent.includes('AI 生成'), '合规:AI 生成标注')
assert(ds.querySelector('.license-footer').textContent.includes('下载使用即同意'), '下载使用即同意')

console.log('== 周边页:语言切换(EN) ==')
wStickers.document.querySelectorAll('.lang-toggle button')[1].click()
await sleep(400)
assert(wStickers.document.title === 'Merch · Whale Girl Stickers · dshregistry', `EN title ("${wStickers.document.title}")`)
assert(wStickers.document.querySelector('#zipDownloadBtn').textContent.includes('Download All'), 'EN ZIP 按钮文案')
assert(wStickers.document.querySelector('.license-point:nth-child(1) .license-point-title').textContent === 'Attribution', 'EN license 署名')
assert(wStickers.document.querySelector('.license-footer').textContent.includes('agree to the license'), 'EN 同意文案')

console.log('\nALL DOCS/STICKERS DOM SMOKE TESTS PASSED')
