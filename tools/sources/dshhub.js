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

/** 同仓库多条目聚合去重:hub 会把一个仓库的多个子能力(如 toybox 的多个 MCP/skill 演示件)
 *  拆成多条页面文档,而本站以"仓库"为单位收录。按 repoUrl 分组,每组只保留一条:
 *  优先级 kind 主类型(extension > toolkit > ui > adapter > channel > manager > skill > mcp),
 *  同 kind 保留第一条。无 repoUrl 的条目不参与聚合(原样保留)。 */
export function dedupeEntries(docs) {
  const KIND_RANK = { extension: 0, toolkit: 1, ui: 2, adapter: 3, channel: 4, manager: 5, skill: 6, mcp: 7 }
  const byRepo = new Map()
  for (const d of docs) {
    if (!d.repoUrl) { byRepo.set(`__solo__${d.external?.dshhub?.id ?? d.name}`, d); continue }
    const group = byRepo.get(d.repoUrl)
    if (!group) { byRepo.set(d.repoUrl, [d]); continue }
    group.push(d)
  }
  const out = []
  for (const group of byRepo.values()) {
    if (!Array.isArray(group)) { out.push(group); continue }
    group.sort((a, b) => {
      const ra = KIND_RANK[a.external?.dshhub?.kind] ?? 99
      const rb = KIND_RANK[b.external?.dshhub?.kind] ?? 99
      return ra - rb
    })
    out.push(group[0])
  }
  return out
}
