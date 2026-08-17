/** dshfind 适配器:sitemap 发现 → Cheerio 详情抽取 → 归一化网页文档。
 *  锚点(2026-08-17 实测):评分 span[title="综合评分"];徽章文本 优质项目/内测用户;
 *  统计卡"近 7 天增长"(主数字=总 stars,绿色 span=7 天增长);JSON-LD codeRepository。 */
import * as cheerio from 'cheerio'

export const SOURCE = 'dshfind'
export const SITEMAP_URL = 'https://dshfind.com/sitemap.xml'
const DETAIL_RE = /^https:\/\/dshfind\.com\/zh\/plugins\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** sitemap → 详情页 URL 集(仅中文主 locale,去重排序)。 */
export function parseSitemap(xml) {
  const urls = new Set()
  for (const m of xml.matchAll(/<loc>(https:\/\/dshfind\.com\/zh\/plugins\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)<\/loc>/g)) {
    if (DETAIL_RE.test(m[1])) urls.add(m[1])
  }
  return [...urls].sort()
}

/** 详情页 HTML → 源站原始文档。字段缺失给 null/空,不抛(单页失败不拖垮整轮)。 */
export function extractDetail(html, url) {
  const $ = cheerio.load(html)
  const seg = url.split('/')
  let ld = null
  $('script[type="application/ld+json"]').each((_, el) => {
    try { const j = JSON.parse($(el).text()); if (j?.codeRepository) ld = j } catch { /* 忽略坏 JSON */ }
  })
  const scoreEl = $(`span[title="综合评分"]`).first()
  const grade = scoreEl.contents().filter((_, n) => n.type === 'text').text().trim() || null
  const scoreNum = Number(scoreEl.find('span').first().text().trim()) || null
  const badges = []
  $('span').each((_, el) => {
    const t = $(el).text()
    if (t.includes('优质项目')) badges.push('featured')
    if (t.includes('内测用户')) badges.push('insider')
  })
  const growthLabel = $('div').filter((_, el) => $(el).text().trim() === '近 7 天增长').first()
  const growthVal = growthLabel.prev('div')
  const stars = Number(growthVal.contents().filter((_, n) => n.type === 'text').text().trim()) || null
  const weeklyGrowth = Number(growthVal.find('span').first().text().replace('+', '').trim()) || null
  return {
    url,
    name: ld?.name ?? seg[seg.length - 1] ?? null,
    author: seg[seg.length - 2] ?? null,
    description: (ld?.description ?? '').slice(0, 200),
    score: grade || scoreNum !== null ? { grade, score: scoreNum } : null,
    badges: [...new Set(badges)],
    growth: { stars, weeklyGrowth },
    repoUrl: ld?.codeRepository ?? null,
  }
}

/** 原始文档 → 归一化网页文档(external.dshfind 只作展示,不进信任判定)。 */
export function normalize(raw) {
  return {
    type: 'page',
    source: SOURCE,
    url: raw.url,
    name: raw.name,
    author: raw.author,
    description: (raw.description ?? '').slice(0, 200),
    category: null,
    repoUrl: raw.repoUrl,
    external: {
      dshfind: {
        grade: raw.score?.grade ?? null,
        score: raw.score?.score ?? null,
        badges: raw.badges,
        stars: raw.growth.stars,
        weeklyGrowth: raw.growth.weeklyGrowth,
      },
    },
  }
}
