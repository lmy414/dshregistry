// tools/lib/changelog.js
/** 增量变更流:新条目在前;轮转 = 90 天窗口 + 5000 条硬上限。 */
export function makeEntry(type, slug, { source, now }) {
  return { ts: new Date(now).toISOString(), type, slug, source }
}

export function appendEntries(log, entries, { now, maxAgeDays = 90, maxEntries = 5000 } = {}) {
  const cutoff = now - maxAgeDays * 86400000
  const kept = (log.entries ?? []).filter((e) => Date.parse(e.ts) >= cutoff)
  return { version: 1, entries: [...entries, ...kept].slice(0, maxEntries) }
}
