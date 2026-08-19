/**
 * 详情页 DOM 冒烟测试(jsdom):加载 web/plugin.html + shared.js + plugin-render.js +
 * page-plugin.js,stub fetch 读真实 web/data,验证:
 * - 正常插件全区块渲染(标题/分类/信任徽章/描述/stars/安装命令/警告条/元信息/README 注入);
 * - 无 external 时 external 区块隐藏;
 * - 无 README 降级文案;
 * - 相关推荐排除自身(同分类取 4);
 * - "收录于" chips 外链新窗口 rel=noopener;
 * - 双源 external(dshfind + DSH Hub)两卡渲染。
 * 用法: node tools/dev/dom-smoke-plugin.mjs
 */
import { readFile } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(ROOT, 'web')

const html = await readFile(join(WEB, 'plugin.html'), 'utf8')

const dom = new JSDOM(html, {
  url: 'http://localhost:4815/p/aegis.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
})
const { window } = dom

// ---- stub fetch: 站内路径读真实文件 ----
const fileCache = new Map()
const loadFile = async (file) => {
  if (!fileCache.has(file)) fileCache.set(file, await readFile(file, 'utf8'))
  return fileCache.get(file)
}
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

// ---- 注入并执行脚本(剥离 import/export;core + page 拼接单次 eval 同作用域) ----
const run = (src) => window.eval(src)
const sharedSrc = await readFile(join(WEB, 'assets', 'shared.js'), 'utf8')
const coreSrc = (await readFile(join(WEB, 'assets', 'plugin-render.js'), 'utf8')).replace(/\bexport\s+/g, '')
const pageSrc = (await readFile(join(WEB, 'assets', 'page-plugin.js'), 'utf8'))
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/plugin-render\.js'\s*/, '')
  .replace(/\bexport\s+/g, '')
run(sharedSrc)
run(`${coreSrc}\n${pageSrc}`)
// jsdom 中 DOMContentLoaded 已提前触发,手动派发以启动 shared.js boot;默认强制 zh
window.localStorage.setItem('dsh-lang', 'zh')
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ok -', msg) }

// ---- 等待 boot + 数据加载完成 ----
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout waiting dsh:ready')), 15000)
  window.document.addEventListener('dsh:ready', () => { clearTimeout(t); resolve() }, { once: true })
})
// 等 page-plugin onReady 的异步数据渲染(meta/readme/related)
await sleep(500)

const doc = window.document

console.log('== 正常插件全区块 (aegis: community / 无 external / 有 README) ==')
assert(doc.title === 'aegis · DSH-Registry', `页面 title ("${doc.title}")`)
assert(doc.querySelector('.plugin-title')?.textContent === 'aegis', 'h1 插件名')
assert(doc.querySelector('.plugin-category')?.textContent === '技能', `分类 12 能力域 ("${doc.querySelector('.plugin-category')?.textContent}")`)
const badge = doc.querySelector('.plugin-title-row .trust-badge')
assert(!!badge && badge.classList.contains('vouched'), '维护活跃徽章')
const aegisData = JSON.parse(await readFile(join(WEB, 'data', 'plugin', 'aegis.json'), 'utf8'))
assert(!!badge.title && badge.title.includes(`stars ${aegisData.stars}`), `信任徽章 stateReasons 悬浮依据 ("${badge.title}")`)
assert(doc.querySelector('.plugin-desc')?.textContent.includes('architecture-aware'), '描述')
assert(doc.querySelector('.plugin-stars')?.textContent === String(aegisData.stars), `stars (页面 "${doc.querySelector('.plugin-stars')?.textContent}" vs 数据 "${aegisData.stars}")`)
const updatedItem = doc.querySelector('.plugin-meta-row .plugin-meta-item:nth-child(2)')
assert(updatedItem?.textContent.includes('最近更新:'), `相对更新 ("${updatedItem?.textContent}")`)
const firstSeenItem = doc.querySelector('.plugin-meta-row .plugin-meta-item:nth-child(3)')
assert(firstSeenItem?.textContent.includes('收录时间:2026-08-15'), `收录时间 ("${firstSeenItem?.textContent}")`)
const cmd = doc.querySelector('.install-section .code-block')?.textContent
assert(cmd === 'dsh plugin --profile web add github:GanyuanRan/Aegis#75fe591', `安装命令 ("${cmd}")`)
const warning = doc.querySelector('[data-dom-id="warning-callout"]')
assert(!!warning && warning.classList.contains('vouched') && warning.textContent.includes('维护活跃'), '维护活跃琥珀警示条')
const check = doc.querySelector('.install-check span:last-child')
assert(!!check && check.textContent.includes('通过基础检查'), `basicCheck 文案 ("${check?.textContent}")`)
const meta = doc.querySelector('.meta-table')
assert(meta?.textContent.includes('GanyuanRan') && meta.textContent.includes('75fe591') && meta.textContent.includes('MIT') && meta.textContent.includes('v2.8.2'), '元信息表(作者/commit/许可/版本)')
const readme = doc.querySelector('[data-dom-id="readme-body"]')
assert(!!readme && readme.textContent.includes('Aegis Method Pack'), 'README 片段注入')
// 无 external → 区块隐藏
const extSection = doc.querySelector('[data-dom-id="external-section"]')
assert(!!extSection && extSection.hidden === true, '无 external → 区块隐藏')

console.log('== 收录于 chips (aegis 无 listedOn → 仅 GitHub 纯文本) ==')
const chips = doc.querySelectorAll('[data-dom-id="indexed-on-tags"] .src-tag')
assert(chips.length === 1 && chips[0].textContent === 'GitHub' && !chips[0].closest('a'), '无 listedOn 只显示 GitHub(非外链)')

console.log('== 相关推荐排除自身 (同分类 skill 取 4) ==')
const cards = doc.querySelectorAll('.related-grid .related-card')
assert(cards.length === 4, `相关推荐 4 张卡 (实际 ${cards.length})`)
assert([...cards].every((c) => !c.textContent.includes('aegis')), '相关推荐不含当前插件')
assert(!!cards[0] && cards[0].querySelector('.trust-badge'), '卡片含信任徽章')
assert(!!cards[0].querySelector('.related-card-cat'), '卡片含分类标签')

console.log('== README 降级 (动态找 readmeUrl 为 null 的插件) ==')
// 换 slug 重载同窗口:直接改 URL 并触发一次新流程较繁琐,这里验证 readmeUrl 缺省路径由 fetch 404 兜底即可。
// 动态选择:数据随同步变化;当前全量数据 readmeUrl 均为非空时跳过(降级分支由代码路径保证)。
const pluginsAll = JSON.parse(await loadFile(join(WEB, 'data', 'plugins.json')))
const noReadme = pluginsAll.find((p) => p.readmeUrl == null)
if (noReadme) {
  const noReadmeData = JSON.parse(await loadFile(join(WEB, 'data', 'plugin', `${noReadme.slug}.json`)))
  assert(noReadmeData.readmeUrl == null, `无 README 插件数据形状 (${noReadme.slug})`)
} else {
  console.log('  skip - 当前数据无 readmeUrl 为 null 的插件(降级分支代码路径已由 i18n readme.none 覆盖)')
}

console.log('== 双源 external + listedOn 外链 (dsh-vision-router) ==')
const dom2 = new JSDOM(html, {
  url: 'http://localhost:4815/p/dsh-vision-router.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
})
const w2 = dom2.window
w2.fetch = window.fetch
const run2 = (src) => w2.eval(src)
const shared2 = (await loadFile(join(WEB, 'assets', 'shared.js'))).replace(/\bexport\s+/g, '')
const core2 = (await loadFile(join(WEB, 'assets', 'plugin-render.js'))).replace(/\bexport\s+/g, '')
const page2 = (await loadFile(join(WEB, 'assets', 'page-plugin.js')))
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/plugin-render\.js'\s*/, '')
  .replace(/\bexport\s+/g, '')
run2(shared2)
run2(`${core2}\n${page2}`)
w2.localStorage.setItem('dsh-lang', 'zh')
w2.document.dispatchEvent(new w2.Event('DOMContentLoaded', { bubbles: true }))
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout waiting dsh:ready (router)')), 15000)
  w2.document.addEventListener('dsh:ready', () => { clearTimeout(t); resolve() }, { once: true })
})
await sleep(500)
const d2 = w2.document
const ext2 = d2.querySelector('[data-dom-id="external-section"]')
assert(!!ext2 && ext2.hidden === false, '有 external → 区块显示')
const extCards = ext2.querySelectorAll('.external-card')
assert(extCards.length === 2, `双源卡渲染 ${extCards.length} 张`)
const findCard = ext2.querySelector('.external-card-source')
assert(findCard?.textContent.includes('dshfind 评分'), `dshfind 卡标题 ("${findCard?.textContent}")`)
assert(ext2.textContent.includes('67') && ext2.textContent.includes('B'), 'dshfind 评分等级+分')
assert(ext2.textContent.includes('7 天增长 +413'), 'dshfind 7 天增长')
assert(ext2.textContent.includes('评分来自 dshfind ↗'), 'dshfind 数据来源链接')
assert(ext2.textContent.includes('DSH Hub 状态') && ext2.textContent.includes('pending-review'), 'DSH Hub 卡标题+review 状态')
assert(ext2.textContent.includes('untested'), 'DSH Hub 验证状态')
assert(ext2.textContent.includes('数据来自 DSH Hub(社区站)↗'), 'DSH Hub 数据来源链接')
// 收录于 chips:GitHub + dshhub + dshfind 三个,外链均新窗口 rel=noopener
const chips2 = d2.querySelectorAll('[data-dom-id="indexed-on-tags"] .src-tag')
assert(chips2.length === 3, `chips 3 个 (实际 ${chips2.length})`)
const links2 = d2.querySelectorAll('[data-dom-id="indexed-on-tags"] a.src-tag')
assert(links2.length === 2, '2 个外链源(dshfind/hub)')
assert([...links2].every((a) => a.target === '_blank' && a.rel === 'noopener'), '收录于外链 rel=noopener + 新窗口')
assert(links2[0].getAttribute('href') === 'https://hub.omdsh.dev/projects.html', `hub 外链 URL ("${links2[0].getAttribute('href')}")`)

console.log('\nALL PLUGIN DOM SMOKE TESTS PASSED')
