/** DSH Hub 适配器:catalog.json(schema dsh-hub-index/v0.4)纯 JSON,不经 Crawlee。
 *  无每包页面锚点(projects.html 为 JS 容器),listedOn.url 统一用 LISTING_URL。 */
export const SOURCE = 'dshhub'
export const CATALOG_URL = 'https://hub.omdsh.dev/catalog.json'
export const LISTING_URL = 'https://hub.omdsh.dev/projects.html'

/** catalog.json 文本 → 包条目数组;schema 不符抛错(上游结构变更要吵不要默)。 */
export function parseCatalog(jsonText) {
  const data = JSON.parse(jsonText)
  if (!Array.isArray(data.packages)) throw new Error(`[dshhub] catalog schema 变更,无 packages 数组: ${data.schema}`)
  return data.packages
}

/** 包条目 → 归一化网页文档。 */
export function normalizeEntry(e) {
  return {
    type: 'page',
    source: SOURCE,
    url: LISTING_URL,
    name: e.name ?? e.id ?? null,
    author: e.author?.name ?? null,
    description: (e.description ?? '').slice(0, 200),
    category: null,
    repoUrl: typeof e.repository === 'string' && e.repository.includes('github.com') ? e.repository : null,
    external: {
      dshhub: {
        id: e.id ?? null, kind: e.kind ?? null, category: e.category ?? null,
        tags: Array.isArray(e.tags) ? e.tags : [],
        status: e.status ?? null, featured: e.featured === true,
        version: e.version ?? null, license: e.license ?? null,
        updatedAt: e.updatedAt ?? null, compatibility: e.compatibility ?? null,
      },
    },
  }
}
