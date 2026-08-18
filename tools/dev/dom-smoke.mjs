/**
 * DOM 冒烟测试(jsdom):加载 web/index.html + shared.js + page-search.js,
 * stub fetch 读真实 web/data,验证精选/三榜/统计条/联想/搜索/结果视图/facet/安装命令/零结果态。
 * 用法: node tools/dev/dom-smoke.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(ROOT, 'web')

const html = await readFile(join(WEB, 'index.html'), 'utf8')

const dom = new JSDOM(html, {
  url: 'http://localhost:4815/',
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

// ---- 注入并执行脚本 ----
const run = (src) => window.eval(src)
const sharedSrc = await readFile(join(WEB, 'assets', 'shared.js'), 'utf8')
// page-search.js 已共享化:纯函数在 search-core.js,本文件 import + re-export。
// jsdom outside-only 下剥离 import/export 后,将 core + page 拼接为单次 eval
// (同脚本作用域,函数引用才成立;strict-mode eval 的函数声明不跨 eval 泄漏)。
const coreSrc = (await readFile(join(WEB, 'assets', 'search-core.js'), 'utf8')).replace(/\bexport\s+/g, '')
const pageSrc = (await readFile(join(WEB, 'assets', 'page-search.js'), 'utf8'))
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/search-core\.js'\s*/, '')
  .replace(/export\s*\{[\s\S]*?\}\s*/, '')   // 剥掉 re-export 块(留在原地会变非法块语句)
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
  const t = setTimeout(() => reject(new Error('timeout waiting dsh:ready')), 15000)
  window.document.addEventListener('dsh:ready', () => { clearTimeout(t); resolve() }, { once: true })
})
await sleep(300)

console.log('== 发现页 ==')
assert(window.document.querySelectorAll('#featuredList .result-row').length === 8, '精选 8 行')
assert(window.document.querySelector('#featuredList .result-title')?.textContent === '@liustack/modlens', '精选第一名 modlens')
assert(window.document.querySelectorAll('#lbAuthors .lb-item').length === 5, '作者榜 5 项')
assert(window.document.querySelectorAll('#lbStars .lb-item').length === 5, '星数榜 5 项')
assert(window.document.querySelectorAll('#lbGrowth .lb-item').length === 5, '增长榜 5 项')
const metaCount = JSON.parse(await readFile(join(WEB, 'data', 'meta.json'), 'utf8'))
assert(window.document.getElementById('stat-plugins').textContent === String(metaCount.pluginCount), `统计条插件数 (页面 "${window.document.getElementById('stat-plugins').textContent}" vs meta "${metaCount.pluginCount}")`)
assert(window.document.getElementById('stat-cats').textContent === String(metaCount.categoryCount), `统计条分类数 (页面 "${window.document.getElementById('stat-cats').textContent}" vs meta "${metaCount.categoryCount}")`)
assert(window.document.querySelectorAll('#quickChips .chip').length === 12, '快速 chips 12 个')
const scoreBadge = window.document.querySelector('#featuredList .score-badge')
assert(!!scoreBadge && /^S 85$/.test(scoreBadge.textContent), `精选行 score-badge 格式 ("${scoreBadge?.textContent}")`)

console.log('== 联想 ==')
const input = window.document.getElementById('searchInput')
input.value = 'dsh-v'
input.dispatchEvent(new window.Event('input'))
await sleep(300)
let items = window.document.querySelectorAll('#suggestBox .suggest-item')
assert(items.length > 0 && items.length <= 8, `联想下拉 ${items.length} 条`)
input.value = 'cat:'
input.dispatchEvent(new window.Event('input'))
await sleep(300)
items = window.document.querySelectorAll('#suggestBox .suggest-item')
assert(items.length > 0, 'cat: 前缀列可选值')

console.log('== 搜索 + 结果视图 ==')
input.value = 'vision'
input.dispatchEvent(new window.Event('input'))
await sleep(300)
window.document.querySelector('#searchInput').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
await sleep(200)
assert(window.document.getElementById('discoverySection').hidden === true, 'discovery 隐藏')
assert(window.document.getElementById('resultsView').hidden === false, '结果视图显示')
const stats = window.document.getElementById('resultsStats').textContent
assert(/找到 \d+ 个结果 · 用时 \d+ ms/.test(stats), `统计行格式 ("${stats}")`)
const resRows = window.document.querySelectorAll('#resultsList .result-row')
assert(resRows.length > 0, '结果行渲染')
const facets = {
  source: window.document.querySelectorAll('#facetSource .facet-item').length,
  category: window.document.querySelectorAll('#facetCategory .facet-item').length,
  trust: window.document.querySelectorAll('#facetTrust .facet-item').length,
  stars: window.document.querySelectorAll('#facetStars .facet-item').length,
}
assert(facets.source === 3 && facets.category === 12 && facets.trust === 2 && facets.stars === 3, `facet 组(来源${facets.source}/分类${facets.category}/信任${facets.trust}/stars${facets.stars})`)

console.log('== facet 过滤 + 排序 ==')
const markCount = window.document.querySelectorAll('#resultsList mark').length
assert(markCount > 0, `命中高亮 mark ${markCount} 个`)
// 勾选 Stars≥500
const star500 = window.document.querySelector('#facetStars input[value="500"]')
star500.checked = true
star500.dispatchEvent(new window.Event('change', { bubbles: true }))
await sleep(200)
const starRows = window.document.querySelectorAll('#resultsList .result-row')
assert(starRows.length > 0, 'Stars≥500 过滤后仍有结果')
const starText = window.document.getElementById('resultsList').textContent
assert(!/⭐\s*[0-4]\d{1,2}\s/.test(starText.replace(/\d{4,}/g, '')), 'Stars≥500 无低星(粗查)')

console.log('== 安装命令 ==')
const installBtn = window.document.querySelector('#resultsList .install-btn')
installBtn.click()
await sleep(100)
const cmdEl = window.document.querySelector('#resultsList .install-cmd:not(.hidden) code')
assert(!!cmdEl && cmdEl.textContent.startsWith('dsh plugin --profile web add '), `安装命令 ("${cmdEl?.textContent}")`)

console.log('== 零结果态 ==')
input.value = 'zzzz-no-such-plugin-xyz'
input.dispatchEvent(new window.Event('input'))
await sleep(300)
input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
await sleep(200)
const zero = window.document.querySelector('#resultsList .zero-state')
assert(!!zero, '零结果态出现')
assert(zero.textContent.includes('你是不是想找'), '零结果提示文案')
assert(zero.querySelector('img')?.src.includes('Q7_think'), 'Q7 思考吉祥物')

console.log('== 语言切换(EN) ==')
window.document.querySelectorAll('.lang-toggle button')[1].click()
await sleep(400)
const statsEn = window.document.getElementById('resultsStats').textContent
assert(/results · \d+ ms/.test(statsEn), `EN 统计行 ("${statsEn}")`)
assert(window.document.getElementById('backDiscovery').textContent.includes('Back'), 'EN 返回精选文案')
assert(window.document.querySelector('.hero-subtitle').textContent.includes('Search DSH plugins'), 'EN hero 副标题')

console.log('\nALL DOM SMOKE TESTS PASSED')
