// 设计包清理:删 TRAE 预览注入(仅 search-zh/en-light 两页) + 移除全页未使用的 CDN 引用
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = process.argv[2]
const files = []
for (const dir of ['desktop-pages', 'mobile-pages']) {
  for (const f of readdirSync(join(SRC, dir))) {
    if (f.endsWith('.html')) files.push(join(SRC, dir, f))
  }
}

const CDN_RES = [
  /\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@[^"]*"><\/script>/,
  /\s*<script src="https:\/\/unpkg\.com\/lucide@[^"]*"><\/script>/,
]

let cleaned = 0
for (const file of files) {
  let html = readFileSync(file, 'utf8')
  const before = html.length

  // 1) TRAE 注入块:<style>.trae-browser-inspect-overlay ... 直到 <body> 前(整体删除)
  const tStart = html.indexOf('<style>.trae-browser-inspect-overlay')
  if (tStart !== -1) {
    const bodyIdx = html.indexOf('<body>', tStart)
    if (bodyIdx === -1) throw new Error(`${file}: 找到注入起点但无 <body> 终点`)
    html = html.slice(0, tStart) + html.slice(bodyIdx)
  }
  // 2) EOF 注入 DOM(<div class="dark">…trae overlay)
  const darkDiv = html.lastIndexOf('<div class="dark">')
  if (darkDiv !== -1 && html.slice(darkDiv).includes('trae-browser-inspect-overlay')) {
    html = html.slice(0, darkDiv) + '</body>\n</html>\n'
  }
  // 3) html 标签脏属性 data-theme="dark"(仅当 class="light" 同时存在时删)
  html = html.replace(/(<html[^>]*class="light"[^>]*)\s+data-theme="dark"/, '$1')
  // 4) 未使用的 CDN 引用(tailwind browser / lucide,全包 0 调用)
  for (const re of CDN_RES) html = html.replace(re, '')

  if (html.length !== before) { writeFileSync(file, html); cleaned++; console.log('cleaned:', file.split(/[\\/]/).pop(), before, '→', html.length) }
}
console.log(`完成:${cleaned}/${files.length} 个文件有清理动作`)
