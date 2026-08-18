/**
 * 分类搜索页 DOM 冒烟测试(jsdom):加载 web/category.html?cat=vision + shared.js +
 * search-core.js + page-category.js,stub fetch 读真实 web/data,验证:
 * 12 类 facet 渲染计数、?cat= 直达、精选卡、网页行、零结果、作者 facet、安装命令、i18n。
 * 用法: node tools/dev/dom-smoke-category.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(ROOT, 'web')

const html = await readFile(join(WEB, 'category.html'), 'utf8')
// 真实数据中 vision 分类插件数(URL cat:vision 直达应精确等于该数,网页无分类不进结果)
const visionTotal = JSON.parse(await readFile(join(WEB, 'data', 'plugins.json'), 'utf8'))
  .filter((p) => (p.category || 'other') === 'vision').length

const dom = new JSDOM(html, {
  url: 'http://localhost:4815/category.html?cat=vision',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
})
const { window } = dom

// ---- stub fetch: 站内路径读真实文件 ----
window.fetch = async (url) => {
  const clean = String(url).split('?')[0]
  const file = join(WEB, clean)
  let body
  try {
    body = await readFile(file, 'utf8')
  } catch (e) {
    return { ok: false, status: 404, json: async () => { throw new Error('404') } }
  }
  const type = extname(file) === '.json' ? 'application/json' : 'text/html'
  return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body, headers: { get: () => type } }
}

// ---- 注入并执行脚本(剥离 import/export;core + page 拼接单次 eval 同作用域) ----
const run = (src) => window.eval(src)
const sharedSrc = await readFile(join(WEB, 'assets', 'shared.js'), 'utf8')
const coreSrc = (await readFile(join(WEB, 'assets', 'search-core.js'), 'utf8')).replace(/\bexport\s+/g, '')
const pageSrc = (await readFile(join(WEB, 'assets', 'page-category.js'), 'utf8'))
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/search-core\.js'\s*/, '')
  .replace(/\bexport\s+/g, '')
run(sharedSrc)
run(`${coreSrc}\n${pageSrc}`)
// jsdom 中 DOMContentLoaded 已提前触发,手动派发以启动 shared.js boot;默认强制 zh
window.localStorage.setItem('dsh-lang', 'zh')
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ok -', msg) }

// ---- 等待 boot 完成 ----
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout waiting dsh:ready')), 20000)
  window.document.addEventListener('dsh:ready', () => { clearTimeout(t); resolve() }, { once: true })
})
await sleep(500)

console.log('== ?cat=vision 直达 ==')
const stats = window.document.getElementById('resultsStats').textContent
assert(/找到 \d+ 个结果 · 用时 \d+ ms/.test(stats), `统计行格式 ("${stats}")`)
// URL cat: 维度直达:结果被过滤到 vision 分类(真实数据 vision 插件数)
const visionCount = Number((stats.match(/找到 (\d+) 个结果/) || [])[1])
assert(visionCount === visionTotal, `cat:vision 直达过滤到 ${visionTotal} 个结果(实际 ${visionCount})`)
const rows = window.document.querySelectorAll('#resultsList .result-row')
assert(rows.length === visionTotal, `结果行渲染 ${rows.length} 条`)
const markCount = window.document.querySelectorAll('#resultsList mark').length
assert(markCount === 0, 'cat:vision 无裸词 mark 高亮(维度过滤不产词高亮)')
// 搜索框已回填查询语法
assert(window.document.getElementById('catSearchInput').value === 'cat:vision', '搜索框回填 cat:vision')

console.log('== facet 面板 ==')
const cats = window.document.querySelectorAll('#facetCategory .facet-item').length
const sources = window.document.querySelectorAll('#facetSource .facet-item').length
const trusts = window.document.querySelectorAll('#facetTrust .facet-item').length
const stars = window.document.querySelectorAll('#facetStars .facet-item').length
const authors = window.document.querySelectorAll('#facetAuthorList .facet-item').length
assert(cats === 12, `分类 facet 12 类(实际 ${cats})`)
assert(sources === 3, `来源 facet 3 项(实际 ${sources})`)
assert(trusts === 3, `信任 facet 3 项(实际 ${trusts})`)
assert(stars === 3, `Stars facet 3 项(实际 ${stars})`)
assert(authors > 0 && authors <= 10, `作者 facet Top10(实际 ${authors})`)
const catCounts = [...window.document.querySelectorAll('#facetCategory .facet-count')].map((el) => Number(el.textContent))
assert(catCounts.every((n) => n >= 0) && catCounts.some((n) => n > 0), `分类计数均为非负且有值 (${catCounts.join(',')})`)
// vision 计数与真实数据吻合(与 facet 候选集 = cat:vision 过滤前即全量,故 = 全部 vision 插件数)
const visionFacetCount = window.document.querySelector('#facetCategory .facet-item input[value="vision"]')?.parentElement?.querySelector('.facet-count')?.textContent
assert(visionFacetCount !== undefined && Number(visionFacetCount) === visionTotal, `vision facet 计数=${visionFacetCount} 期望 ${visionTotal}`)

console.log('== 精选卡 ==')
const featuredCard = window.document.getElementById('featuredCard')
assert(!!featuredCard && featuredCard.hidden === false, '精选卡可见(cat:vision 存在 community+grade 候选)')
const featMascot = featuredCard.querySelector('.featured-mascot')
assert(!!featMascot && featMascot.src.includes('Q8_point'), 'Q8_point 贴纸')
const featLabel = featuredCard.querySelector('.featured-label')
assert(featLabel.textContent.includes('精选'), `精选标签 ("${featLabel.textContent}")`)
const featRow = featuredCard.querySelector('.featured-row')
assert(!!featRow, '精选卡含结果行')
const featBadge = featuredCard.querySelector('.score-badge')
assert(!!featBadge, `精选卡含 score-badge ("${featBadge?.textContent}")`)

console.log('== 网页行(清除维度后) ==')
const catInput = window.document.getElementById('catSearchInput')
catInput.value = 'desktop'
catInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
await sleep(300)
const pageRows = window.document.querySelectorAll('#resultsList .result-row.result-page')
assert(pageRows.length > 0, `网页行渲染 ${pageRows.length} 条`)
const firstPageRow = pageRows[0]
assert(firstPageRow.querySelector('.result-cat-tag')?.textContent.includes('网页'), '网页行分类标签为"网页"')
assert(!firstPageRow.querySelector('.install-btn'), '网页行无安装按钮')
const pageUrl = firstPageRow.querySelector('.meta-item.page-url')
assert(!!pageUrl && /^[a-z0-9.-]+\./.test(pageUrl.textContent), `网页行显示源站 URL ("${pageUrl?.textContent}")`)

console.log('== 安装命令展开 ==')
const installBtn = window.document.querySelector('#resultsList .install-btn')
assert(!!installBtn, '插件行有安装按钮')
installBtn.click()
await sleep(100)
const cmdEl = window.document.querySelector('#resultsList .install-cmd:not(.hidden) code')
assert(!!cmdEl && cmdEl.textContent.startsWith('dsh plugin --profile web add '), `安装命令 ("${cmdEl?.textContent}")`)

console.log('== 零结果态 ==')
catInput.value = 'zzzz-no-such-plugin-xyz'
catInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
await sleep(300)
const zero = window.document.querySelector('#resultsList .zero-state')
assert(!!zero, '零结果态出现')
assert(zero.textContent.includes('你是不是想找'), '零结果提示文案')
assert(zero.querySelector('img')?.src.includes('Q7_think'), 'Q7 思考吉祥物')
assert(zero.querySelectorAll('.chip[data-zero]').length > 0, '零结果建议词 chips')

console.log('== 作者 facet 组内搜索 ==')
catInput.value = ''
catInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
await sleep(300)
const authorSearch = window.document.getElementById('facetAuthorSearch')
authorSearch.value = 'omdsh'
authorSearch.dispatchEvent(new window.Event('input', { bubbles: true }))
await sleep(300)
const filteredAuthors = [...window.document.querySelectorAll('#facetAuthorList .facet-label')].map((el) => el.textContent)
assert(filteredAuthors.length > 0, `作者过滤后有列表 (${filteredAuthors.join(',')})`)
assert(filteredAuthors.every((a) => a.toLowerCase().includes('omdsh')), '过滤结果均含 omdsh')
authorSearch.value = ''
authorSearch.dispatchEvent(new window.Event('input', { bubbles: true }))
await sleep(300)

console.log('== 语言切换(EN) ==')
window.document.querySelectorAll('.lang-toggle button')[1].click()
await sleep(400)
const statsEn = window.document.getElementById('resultsStats').textContent
assert(/results · \d+ ms/.test(statsEn), `EN 统计行 ("${statsEn}")`)
const navCategory = window.document.querySelector('.nav-links a[data-dom-id="nav-category"]')
assert(navCategory.textContent === 'Categories', `EN 导航分类 ("${navCategory.textContent}")`)

console.log('\nALL CATEGORY DOM SMOKE TESTS PASSED')
