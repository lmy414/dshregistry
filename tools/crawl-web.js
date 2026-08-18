/** 网页源编排:dshfind(sitemap + Cheerio 详情)/ DSH Hub(catalog.json)
 *  双流程:discover(state 未知 URL)+ refresh(planRefresh 到期);产物 = pages.json +
 *  plugins.json(listedOn/external 合并)+ backfill.json + state-<source>.json。
 *  用法: node tools/crawl-web.js   (DSH_WEB_MAX 限量冒烟,DSH_WEB_MIN_INTERVAL 调限速) */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchText, makeGate, makeAssertAllowed, DEFAULT_ALLOWED_HOSTS } from './lib/http.js'
import { createCheerioRunner } from './lib/crawler.js'
import { loadState, saveState, noteChecked, planRefresh } from './lib/state.js'
import { keyOf, parseGithubRepoUrl, resolveDocs, mergeListedOn } from './lib/resolve.js'
import * as dshfind from './sources/dshfind.js'
import * as dshhub from './sources/dshhub.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DAY = 86400000
const REFRESH_AGE_MS = 7 * DAY      // 网页源固定窗口重抓(评分随时间变)

async function atomicWriteJson(file, obj) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

const hashOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12)

/** fetchText 白名单断言:生产 base 用库默认严格实例;base=127.0.0.1(测试注入假站)时
 *  放行 http 本地回环——与 http.js makeAssertAllowed 的"仅测试"约定一致。 */
function assertForBase(base) {
  const host = new URL(base).hostname
  if (host !== '127.0.0.1') return undefined
  return makeAssertAllowed(new Set([...DEFAULT_ALLOWED_HOSTS, '127.0.0.1']))
}

/** dshfind 流:sitemap 发现 → 双流程任务集 → Cheerio 详情抓取。 */
async function crawlDshfind({ base, cacheDir, now, maxPages, minIntervalMs, webDocs }) {
  const gate = makeGate(minIntervalMs)
  const assert = assertForBase(base)
  const sitemap = await fetchText(`${base}/sitemap.xml`, { gate, ...(assert ? { assert } : {}) })
  if (!sitemap.text) throw new Error('[crawl-web] dshfind sitemap 拉取失败')
  const allUrls = dshfind.parseSitemap(sitemap.text.replaceAll(base, 'https://dshfind.com'))
    .map((u) => u.replace('https://dshfind.com', base))
  const stateFile = join(cacheDir, 'state-dshfind.json')
  const state = await loadState(stateFile)
  const budget = Math.max(0, maxPages)
  const discover = allUrls.filter((u) => !state.urls[u]).slice(0, budget)
  const refresh = planRefresh(state, allUrls, { now: Date.parse(now), maxAgeMs: REFRESH_AGE_MS, budget: Math.max(0, budget - discover.length) })
  const tasks = [...new Set([...discover, ...refresh])]
  console.log(`[crawl-web] dshfind: 目录 ${allUrls.length},discover ${discover.length},refresh ${refresh.length}`)
  if (tasks.length > 0) {
    const crawler = createCheerioRunner({
      storageDir: join(cacheDir, 'crawlee-dshfind'),
      minIntervalMs,
      requestHandler: async ({ request, body }) => {
        const html = body.toString()
        webDocs.push(dshfind.normalize(dshfind.extractDetail(html, request.url)))
        const prev = state.urls[request.url]
        noteChecked(state, request.url, { now: Date.parse(now), changed: !prev || prev.hash !== hashOf(html), hash: hashOf(html) })
        await saveState(stateFile, state)   // 增量落盘:中途崩盘下轮 planner 重新发出未完成 URL
      },
      failedRequestHandler: async ({ request }) => console.warn(`[crawl-web] 失败跳过: ${request.url}`),
    })
    await crawler.run(tasks)
  }
  await saveState(stateFile, state)
}

/** hub 流:官方 api/v1/plugins.json 条件请求(ETag),全量归一(JSON 便宜)。 */
async function crawlDshhub({ base, cacheDir, now, webDocs }) {
  const stateFile = join(cacheDir, 'state-dshhub.json')
  const state = await loadState(stateFile)
  const etag = state.urls.catalog?.hash
  const assert = assertForBase(base)
  const res = await fetchText(`${base}${dshhub.API_PATH}`, { headers: etag ? { 'If-None-Match': etag } : {}, ...(assert ? { assert } : {}) })
  if (res.status === 304) { console.log('[crawl-web] dshhub: 304 未变化,跳过'); return }
  if (!res.text) throw new Error('[crawl-web] dshhub api 拉取失败')
  for (const entry of dshhub.parseCatalog(res.text)) webDocs.push(dshhub.normalizeEntry(entry))
  noteChecked(state, 'catalog', { now: Date.parse(now), changed: true, hash: res.etag ?? hashOf(res.text) })
  await saveState(stateFile, state)
  console.log(`[crawl-web] dshhub: 归一 ${webDocs.length} 文档`)
}

export async function runWebCrawl({ dataDir, cacheDir, now, maxPages = Infinity, minIntervalMs = 1500, dshfindBase = 'https://dshfind.com', dshhubBase = 'https://hub.omdsh.dev' }) {
  const pluginsFile = join(dataDir, 'plugins.json')
  const plugins = JSON.parse(await readFile(pluginsFile, 'utf8'))
  const knownRepoKeys = new Set(plugins.map((p) => keyOf(p.repo)))
  const webDocs = []
  // 单源故障隔离:任一流失败降级继续(另一源已收集的 webDocs 照常进入 resolve/合并;dshfind 的 state 已逐页落盘)
  try {
    await crawlDshfind({ base: dshfindBase, cacheDir, now, maxPages, minIntervalMs, webDocs })
  } catch (e) {
    console.warn(`[crawl-web] dshfind 抓取失败,降级继续: ${e.message}`)
  }
  try {
    await crawlDshhub({ base: dshhubBase, cacheDir, now, webDocs })
  } catch (e) {
    console.warn(`[crawl-web] dshhub 抓取失败,降级继续: ${e.message}`)
  }

  const { merges, backfills, pages } = resolveDocs(webDocs, knownRepoKeys, { backfillCap: 100, now })
  // 主索引:listedOn/external 合并写回(M-A 不做 listedOn 下架,防抖动)
  const { plugins: mergedPlugins, mergedCount } = mergeListedOn(plugins, merges, { now })
  await atomicWriteJson(pluginsFile, mergedPlugins)
  // 独立留存网页文档:与旧留存并集合并(每轮全量覆盖会让第二轮起页面搜索覆盖崩塌)。
  // 旧条目三选:① url 命中本轮新页 → 弃旧用新;② repoUrl 解析后命中 knownRepoKeys(仓库已转正)→ 剔除;
  // ③ 其余保留。合并结果 = 保留旧条目 + 本轮新页,按条目身份去重。
  const pagesFile = join(dataDir, 'pages.json')
  const oldPages = JSON.parse(await readFile(pagesFile, 'utf8').catch(() => '{"pages":[]}'))
  const newByUrl = new Set(pages.map((p) => p.url))
  const kept = oldPages.pages.filter((p) => {
    if (newByUrl.has(p.url)) return false
    const u = parseGithubRepoUrl(p.repoUrl)
    return !(u && knownRepoKeys.has(keyOf(u.fullName)))
  })
  // 去重键必须含条目身份:url 仅对 dshfind 页天然唯一,hub 全部条目 url 恒为 LISTING_URL,
  // 纯按 url 去重会把整目录 hub 折叠成 1 条 → external id 参与键(name 兜底)。
  const pageKey = (p) => `${p.url}#${p.external?.[p.source]?.id ?? p.name ?? ''}`
  const mergedPages = []
  const seenKey = new Set()
  for (const p of [...kept, ...pages]) {
    const k = pageKey(p)
    if (seenKey.has(k)) continue
    seenKey.add(k)
    mergedPages.push(p)
  }
  await atomicWriteJson(pagesFile, { version: 1, updatedAt: now, pages: mergedPages })
  // 反哺候选:与历史候选按 repo 去重合并,crawl.js 下轮消费
  const backfillFile = join(cacheDir, 'backfill.json')
  const oldBackfill = JSON.parse(await readFile(backfillFile, 'utf8').catch(() => '{"candidates":[]}'))
  const seen = new Set(oldBackfill.candidates.map((c) => keyOf(c.repo)))
  const candidates = [...oldBackfill.candidates]
  for (const b of backfills) {
    if (!seen.has(keyOf(b.repo))) { seen.add(keyOf(b.repo)); candidates.push(b) }
  }
  await atomicWriteJson(backfillFile, { updatedAt: now, candidates })
  console.log(`[crawl-web] 完成:合并 ${mergedCount} 条 listedOn,留存 ${mergedPages.length} 页,反哺候选 ${candidates.length}`)
  return { pages: mergedPages, merges, backfills: candidates }
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWebCrawl({
    dataDir: join(ROOT, 'web', 'data'),
    cacheDir: join(ROOT, 'tools', '.cache'),
    now: new Date().toISOString().slice(0, 10),
    maxPages: Number(process.env.DSH_WEB_MAX || 0) || Infinity,
    minIntervalMs: Number(process.env.DSH_WEB_MIN_INTERVAL || 1500),
  }).catch((e) => { console.error('[crawl-web] 失败:', e); process.exit(1) })
}
