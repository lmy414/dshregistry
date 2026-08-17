/** CLI:plugins.json(插件)+ pages.json(网页)→ web/data/search.json。 */
import { readFile } from 'node:fs/promises'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, assertBudget } from './lib/search-index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'web', 'data')

const plugins = JSON.parse(await readFile(join(DATA, 'plugins.json'), 'utf8'))
const pages = JSON.parse(await readFile(join(DATA, 'pages.json'), 'utf8').catch(() => '{"pages":[]}'))

const docs = [
  ...plugins.map((p) => ({ slug: p.slug, name: p.name, author: p.repo.split('/')[0], tags: p.tags ?? [], desc: (p.description ?? '').slice(0, 300) })),
  ...pages.pages.map((w) => ({ slug: `page:${w.source}:${w.url}`, name: w.name ?? '', author: w.author ?? '', tags: [], desc: w.description ?? '' })),
]
const index = buildIndex(docs, { maxDocsPerTerm: 200 })
const meta = docs.map((d, i) => {
  const p = plugins[i]
  return p
    ? { slug: p.slug, type: 'plugin', cat: p.category, src: ['github', ...(p.listedOn?.map((l) => l.source) ?? [])], state: p.state, stars: p.stars }
    : { slug: d.slug, type: 'page', cat: null, src: [pages.pages[i - plugins.length].source], state: null, stars: null }
})
const out = JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), fields: { name: 3, author: 2, tags: 2, desc: 1 }, docs: meta, index })
const bytes = assertBudget(out)
const file = join(DATA, 'search.json')
await mkdir(dirname(file), { recursive: true })
await writeFile(`${file}.tmp`, out, 'utf8')
await rename(`${file}.tmp`, file)
console.log(`[search-index] 完成:${docs.length} 文档,${Object.keys(index).length} 词,${(bytes / 1048576).toFixed(2)}MB`)
