/** 实体解析:网页文档 ↔ GitHub 仓库。命中 → listedOn 合并;未命中 → 反哺候选 + 独立留存。 */

const RESERVED_OWNERS = new Set(['features', 'topics', 'marketplace', 'orgs', 'settings', 'notifications', 'login', 'signup', 'explore', 'sponsors', 'about', 'pricing', 'collections'])

/** GitHub 仓库 URL 严格解析;子路径(/issues 等)裁剪,.git 去尾;保留段/非 github 拒收。 */
export function parseGithubRepoUrl(url) {
  if (typeof url !== 'string') return null
  const m = url.match(/^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#]|$)/)
  if (!m) return null
  const [, owner, repo] = m
  if (RESERVED_OWNERS.has(owner.toLowerCase()) || repo === '' ) return null
  return { owner, repo, fullName: `${owner}/${repo}` }
}

export const keyOf = (fullName) => fullName.toLowerCase()

/** 网页文档三分流:命中已收录仓库 → merges;未命中 → 反哺 + 留存;无仓库 → 留存。 */
export function resolveDocs(webDocs, knownRepoKeys, { backfillCap = 100, now } = {}) {
  const merges = [], backfills = [], pages = []
  const seenBackfill = new Set()
  for (const doc of webDocs) {
    const u = parseGithubRepoUrl(doc.repoUrl)
    if (!u) { pages.push(doc); continue }
    const key = keyOf(u.fullName)
    if (knownRepoKeys.has(key)) {
      merges.push({ repoKey: key, entry: { source: doc.source, url: doc.url, firstSeenAt: now }, external: doc.external })
    } else {
      if (!seenBackfill.has(key) && backfills.length < backfillCap) {
        seenBackfill.add(key)
        backfills.push({ repo: u.fullName, from: doc.source, firstSeenAt: now })
      }
      pages.push(doc)   // 未转正先独立留存,日后仓库收录再合并
    }
  }
  return { merges, backfills, pages }
}

/** listedOn/external 合并进插件记录;同 source 幂等,跨源 external 互不覆盖。 */
export function mergeListedOn(plugins, merges, { now } = {}) {
  const byRepoKey = new Map(plugins.map((p) => [keyOf(p.repo), p]))
  let mergedCount = 0
  const out = plugins.map((p) => ({ ...p }))
  const outByKey = new Map(out.map((p) => [keyOf(p.repo), p]))
  for (const { repoKey, entry, external } of merges) {
    const rec = outByKey.get(repoKey) ?? byRepoKey.get(repoKey)
    if (!rec) continue
    const target = outByKey.get(repoKey)
    target.listedOn = [...(Array.isArray(target.listedOn) ? target.listedOn : [])]   // 复制数组,不改写调用方旧引用
    if (!target.listedOn.some((l) => l.source === entry.source)) {
      target.listedOn.push(entry)
      mergedCount++
    }
    if (external && typeof external === 'object') {
      target.external = { ...(target.external ?? {}), ...external }
    }
  }
  return { plugins: out, mergedCount }
}

/** crawl.js fresh 记录替换 old 时调用:跨源字段由 crawl-web 维护,crawl.js 只保留不生成。 */
export function preserveCrossSource(oldRec, newRec) {
  const out = { ...newRec }
  if (oldRec.listedOn !== undefined) out.listedOn = oldRec.listedOn
  if (oldRec.external !== undefined) out.external = oldRec.external
  return out
}
