// tools/lib/trending.js
/** 24h 热度榜:与上轮 star 快照 diff,正增长排序取 Top N;冷启动(无快照)返回空。 */
export function diffStars(snapshot, plugins, { top = 20 } = {}) {
  if (!snapshot || Object.keys(snapshot).length === 0) return []
  return plugins
    .map((p) => ({ slug: p.slug, name: p.name, stars: p.stars, delta: p.stars - (snapshot[p.repo] ?? p.stars) }))
    .filter((i) => i.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, top)
}
