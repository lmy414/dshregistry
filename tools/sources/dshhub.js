/** DSH Hub 适配器:hub(社区站,与 DeepSeek 官方无关)自家消费 API /api/v1/plugins.json(omdsh-ai-market/v1,纯 JSON,不经 Crawlee)。
 *  较旧 catalog.json 的优势:categories 数组、review/verification/registry 三态、hub 自家 consumer 契约(usage 字段)。
 *  无每包页面锚点(projects.html 为 JS 容器),listedOn.url 统一用 LISTING_URL。 */
export const SOURCE = 'dshhub'
export const API_URL = 'https://hub.omdsh.dev/api/v1/plugins.json'
export const API_PATH = '/api/v1/plugins.json'
export const TYPES_URL = 'https://hub.omdsh.dev/api/v1/plugin-types.json'
export const LISTING_URL = 'https://hub.omdsh.dev/projects.html'

/** API JSON 文本 → 包条目数组;schema 不符抛错(上游结构变更要吵不要默)。 */
export function parseCatalog(jsonText) {
  const data = JSON.parse(jsonText)
  if (!Array.isArray(data.projects)) throw new Error(`[dshhub] api schema 变更,无 projects 数组: ${data.schema}`)
  return data.projects
}

/** 包条目 → 归一化网页文档。 */
export function normalizeEntry(e) {
  const repo = e.source?.repository ?? e.identity?.repository ?? null
  const fullName = e.identity?.fullName ?? null
  return {
    type: 'page',
    source: SOURCE,
    url: LISTING_URL,
    name: e.name ?? e.id ?? null,
    author: e.author?.name ?? (fullName ? fullName.split('/')[0] : null),
    description: (e.summary ?? e.description ?? '').slice(0, 200),
    category: null,
    repoUrl: typeof repo === 'string' && repo.includes('github.com') ? repo : null,
    external: {
      dshhub: {
        id: e.id ?? null, kind: e.kind ?? null,
        categories: Array.isArray(e.categories) ? e.categories : (e.category ? [e.category] : []),
        tags: Array.isArray(e.tags) ? e.tags : [],
        review: e.review?.state ?? null,
        verification: e.verification?.state ?? null,
        verificationBaseline: e.verification?.baseline ?? null,
        registry: e.registry?.state ?? null,
        updatedAt: e.discovery?.createdAt ?? e.updatedAt ?? null,
      },
    },
  }
}
