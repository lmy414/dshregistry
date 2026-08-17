/** 倒排索引:英文小写 + 轻量词干(复数/ing/ed),中文(及 CJK)bigram;
 *  字段加权 name 3 / author 2 / tags 2 / desc 1;每词最多 maxDocsPerTerm 个文档(按分数截断)。 */
const STOP_EN = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are', 'by', 'at', 'from', 'as', 'it', 'its', 'this', 'that', 'you', 'your', 'we', 'our', 'dsh', 'plugin', 'plugins', 'deepseek', 'harness'])
const STOP_ZH = new Set(['的', '了', '和', '与', '在', '是', '有', '为', '及', '或'])

// 最小词干:先剥后缀(词干 ≥3 字符),再对剥后的中间串折叠双写收尾(折叠后 ≥3 字符);
// 分步用中间变量,守卫各按当前串长度判定,避免旧长度二次剥除(passing→pa 之类)。
const stem = (w) => {
  const m = w.match(/(ing|ed|es|s)$/)
  if (!m || w.length - m[0].length < 3) return w
  const s = w.slice(0, -m[0].length)
  return s.length >= 4 ? s.replace(/(.)\1$/, (_, c) => c) : s
}

export function tokenize(text) {
  if (!text) return []
  const lower = String(text).toLowerCase()
  const out = []
  for (const m of lower.matchAll(/[a-z0-9]+/g)) {
    const w = stem(m[0])
    if (w.length >= 2 && !STOP_EN.has(w)) out.push(w)
  }
  const cjk = lower.match(/[一-鿿]+/g) ?? []
  for (const run of cjk) {
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2)
      if (!STOP_ZH.has(bg[0]) && !STOP_ZH.has(bg[1])) out.push(bg)
    }
  }
  return out
}

const FIELD_WEIGHTS = { name: 3, author: 2, tags: 2, desc: 1 }

/** 页面文档 slug:source:url#id——hub 全条目 url 恒为 LISTING_URL,不带外部 id 会全员碰撞;
 *  external id 缺失时 name 兜底,两者皆无时落 index(保证唯一)。build-search-index.js 与测试共用。 */
export function pageSlugOf(w, i) {
  return `page:${w.source}:${w.url}#${w.external?.[w.source]?.id ?? w.name ?? i}`
}

/** docs: [{ slug, name, author, tags[], desc }] → { [term]: [[docIdx, score]] } */
export function buildIndex(docs, { maxDocsPerTerm = 200 } = {}) {
  const index = {}
  docs.forEach((doc, docIdx) => {
    const best = {}
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const text = Array.isArray(doc[field]) ? doc[field].join(' ') : doc[field]
      const tf = {}
      for (const term of tokenize(text)) tf[term] = (tf[term] ?? 0) + 1
      for (const [term, count] of Object.entries(tf)) {
        const score = weight * count
        if (score > (best[term] ?? 0)) best[term] = score
      }
    }
    for (const [term, score] of Object.entries(best)) {
      ;(index[term] ??= []).push([docIdx, score])
    }
  })
  for (const term of Object.keys(index)) {
    index[term].sort((a, b) => b[1] - a[1])
    if (index[term].length > maxDocsPerTerm) index[term] = index[term].slice(0, maxDocsPerTerm)
  }
  return index
}

/** 体积预算:超限即失败(万级规模护栏,防止前端懒加载爆炸)。 */
export function assertBudget(indexJson, { maxBytes = 3 * 1024 * 1024 } = {}) {
  const bytes = Buffer.byteLength(indexJson, 'utf8')
  if (bytes > maxBytes) throw new Error(`[search-index] 体积 ${(bytes / 1048576).toFixed(2)}MB 超预算 ${(maxBytes / 1048576).toFixed(2)}MB`)
  return bytes
}
