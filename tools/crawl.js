/**
 * DSH-Registry 爬虫(服务器 cron 每 6h 执行,也可手动 --now)
 *
 * 数据源:GitHub topic:dsh-plugin 扫描 + config/seeds.json 手动收录。
 * 产物(原子写,提交进仓库):
 *   web/data/plugins.json · meta.json · blocklist.json · readme/<slug>.html
 *
 * 规模设计(2026-08 实测 topic 全量 ~4000 仓库):
 *   - Search API 单次查询最多返回 1000 条 → 按 created 日期分片递归,直到每片 ≤900;
 *   - REST 配额(认证 5000/h)装不下全量逐仓调用,因此:
 *       package.json / README 走 raw.githubusercontent(不占 REST 配额);
 *       HEAD sha 走 git ls-remote(git 协议,不占 REST 配额);
 *       REST 只花在通过初筛的候选上(作者账号年龄、Release 资产探测);
 *   - 限速:search ≤28/min、core ≤1/s,403/429 按 X-RateLimit-Reset 退避重试;
 *   - firstSeenAt(收录时间)从上一版 plugins.json 继承,全量重写不漂移;
 *   - README:marked 渲染 → DOMPurify(jsdom)白名单消毒 → 相对资源改写绝对地址,
 *     超 256KB 截断并附 GitHub 全文链接。
 *
 * 用法:GITHUB_TOKEN=... node tools/crawl.js        # 缺省从 `gh auth token` 取
 */

import { execFile, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { marked } from 'marked'
import { JSDOM } from 'jsdom'
import createDOMPurify from 'dompurify'
import { sleep, makeGate, assertAllowed, makeGhApi } from './lib/http.js'
import { planGithubRefresh } from './lib/state.js'
import { preserveCrossSource, keyOf } from './lib/resolve.js'
import { makeEntry, appendEntries } from './lib/changelog.js'
import { diffStars } from './lib/trending.js'

const execFileAsync = promisify(execFile)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'web', 'data')
const README_DIR = join(DATA_DIR, 'readme')
const SEEDS_FILE = join(ROOT, 'config', 'seeds.json')
const FLAGS_FILE = join(ROOT, 'config', 'flags.json')
const CATEGORY_OVERRIDES_FILE = join(ROOT, 'config', 'categories.json')
const PLUGINS_FILE = join(DATA_DIR, 'plugins.json')
const PKG_CACHE_FILE = join(ROOT, 'tools', '.cache', 'pkg.json')   // 初筛/补全缓存(pushedAt 校验),重跑秒过
const README_CACHE_DIR = join(ROOT, 'tools', '.cache', 'readme')   // README 原文缓存(同名文件按仓库隔离)
const readmeCacheFile = (fullName) => join(README_CACHE_DIR, `${fullName.replace(/[^\w.-]+/g, '__')}.md`)

const README_MAX_BYTES = 256 * 1024
const SHARD_MAX = 900            // 单分片结果上限(留 1000 硬顶余量)
const SEARCH_MIN_INTERVAL_MS = 2200   // ≤27 req/min
const CORE_MIN_INTERVAL_MS = 250      // ≤4/s(5000/h 预算内)
const RAW_CONCURRENCY = 8
const API_CONCURRENCY = 3
const MAX_REPOS = Number(process.env.CRAWL_MAX || 0)   // 冒烟测试限流(0=全量)
const ONLY = process.env.CRAWL_ONLY                     // 只处理 full_name 含此子串的仓库(调试)

// ---------------------------------------------------------------- 基础工具

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}
const TOKEN = getToken()
const ghApi = makeGhApi(TOKEN)   // GitHub REST:白名单 + 限速 + 403/429 退避(见 lib/http.js)
if (!TOKEN) console.warn('[crawl] WARN: 无 GITHUB_TOKEN/gh 登录,速率限制将非常严格')

/** 记录渠道标记:seeds 人工收录 > 网页源反哺 > topic 扫描。 */
export function sourceOf(repo) {
  if (repo._seedCategory) return 'seeds'
  if (repo._backfillFrom) return `backfill:${repo._backfillFrom}`
  return 'github-topic'
}

/** fresh 替换 old 的合并:跨源字段保留(listedOn/external 由 crawl-web 维护),source 继承 fresh 渠道。 */
export function mergeOldRecord(old, fresh) {
  const out = preserveCrossSource(old, fresh)
  out.type = 'plugin'
  out.source = fresh.source ?? old.source ?? 'github-topic'
  out.featured = fresh.featured ?? old.featured ?? false
  return out
}

/** 存量旧记录回填(schema 1.1):旧记录无 type/source 时按 seeds 命中与否补渠道标记,已有则保留。 */
export function migrateOldRecord(old, seedRepos, { state, reasons }) {
  return {
    ...old,
    type: old.type ?? 'plugin',
    source: old.source ?? (seedRepos.has(old.repo) ? 'seeds' : 'github-topic'),
    state,
    stateReasons: reasons,
  }
}

/** 消费反哺候选:读取 backfill.json 并清空(crawl-web 下轮重新产出未转正者)。 */
export async function consumeBackfill(cacheDir) {
  const file = join(cacheDir, 'backfill.json')
  const data = JSON.parse(await readFile(file, 'utf8').catch(() => '{"candidates":[]}'))
  const candidates = data.candidates ?? []
  if (candidates.length > 0) await atomicWrite(file, JSON.stringify({ updatedAt: new Date().toISOString(), candidates: [] }))
  return candidates
}

/** 简单并发池 */
async function pool(items, size, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }))
  return results
}

/** 速率门(见 lib/http.js):search ≤28/min、core ≤4/s。 */
const searchGate = makeGate(SEARCH_MIN_INTERVAL_MS)
const coreGate = makeGate(CORE_MIN_INTERVAL_MS)

/** 仓库文件拉取:走 jsDelivr CDN(不占 REST 配额;raw.githubusercontent 在部分网络下被压速)。
 *  不带分支名时 jsDelivr 自动解析默认分支;404 返回 null。 */
async function rawFetch(repoPath, retries = 2) {
  const url = `https://cdn.jsdelivr.net/gh/${repoPath}`
  assertAllowed(url)
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.ok) return await res.text()
      if (res.status === 404) return null
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(3000 * (attempt + 1)); continue }
      return null
    } catch {
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue }
      return null
    }
  }
}

/** git ls-remote 取默认分支 HEAD sha(git 协议,不占 REST 配额)。 */
async function tryLsRemote(fullName) {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', `https://github.com/${fullName}`, 'HEAD'], { timeout: 15000 })
    const sha = stdout.split(/\s+/)[0]
    return /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : null
  } catch {
    return null
  }
}
let lsRemoteUsable = true   // 启动时探测;直连 github.com 不通的网络走 REST 兜底
const headSha = (repo) => {
  if (lsRemoteUsable) return tryLsRemote(repo.full_name)
  return ghApi(`https://api.github.com/repos/${repo.full_name}/git/refs/heads/${repo.default_branch}`, coreGate)
    .then((ref) => ref?.object?.sha?.slice(0, 7) ?? null)
}

// ---------------------------------------------------------------- 搜索(日期分片)

/** 单片查询:返回 { total, items }(items 至多 1000,由调用方分页)。 */
async function searchShard(rangeQualifier, page = 1) {
  const q = encodeURIComponent(`topic:dsh-plugin ${rangeQualifier}`)
  const data = await ghApi(`https://api.github.com/search/repositories?q=${q}&per_page=100&page=${page}&sort=created&order=asc`, searchGate)
  return data ?? { total_count: 0, items: [] }
}

/** 递归分片:把 created 范围(ISO 时间戳精度)切到每片 ≤SHARD_MAX,然后分页收全。 */
async function collectRange(rangeQualifier, depth = 0) {
  const first = await searchShard(rangeQualifier)
  const total = first.total_count
  if (total === 0) return []
  if (total > SHARD_MAX) {
    const [from, to] = rangeQualifier.replace('created:', '').split('..')
    const fromMs = new Date(from).getTime()
    const toMs = new Date(to).getTime()
    if (toMs - fromMs <= 1000) {
      console.warn(`[crawl] 单秒窗口仍有 ${total} 条,只取前 1000: ${rangeQualifier}`)
    } else {
      const mid = new Date(fromMs + Math.floor((toMs - fromMs) / 2)).toISOString()
      const left = await collectRange(`created:${from}..${mid}`, depth + 1)
      const right = await collectRange(`created:${mid}..${to}`, depth + 1)
      return [...left, ...right]
    }
  }
  const pages = Math.min(10, Math.ceil(total / 100))
  const rest = []
  for (let p = 2; p <= pages; p++) rest.push(await searchShard(rangeQualifier, p))
  return [first, ...rest].flatMap((d) => d.items)
}

async function searchAll() {
  // 从生态起点扫到明天;GitHub search 的 created 限定符支持完整 ISO 时间戳
  const tomorrow = new Date(Date.now() + 86400000).toISOString()
  const items = await collectRange(`created:2024-01-01T00:00:00Z..${tomorrow}`)
  const seen = new Map()
  for (const item of items) seen.set(item.full_name, item)
  return [...seen.values()]
}

/** 增量搜索:created 倒序翻页,整页无新仓库即视为追上进度;每轮最多 maxNew 个。 */
async function searchIncremental(seen, maxNew) {
  const out = []
  for (let page = 1; page <= 10; page++) {
    const data = await ghApi(`https://api.github.com/search/repositories?q=${encodeURIComponent('topic:dsh-plugin')}&per_page=100&page=${page}&sort=created&order=desc`, searchGate)
    const items = data?.items ?? []
    if (items.length === 0) break
    let fresh = 0
    for (const item of items) {
      if (seen.has(item.full_name)) continue
      seen.add(item.full_name)
      out.push(item)
      fresh++
    }
    console.log(`[crawl] 增量扫描第 ${page} 页:新 ${fresh}/${items.length}`)
    if (fresh === 0) break          // 整页都是已收录 → 已追上进度
    if (out.length >= maxNew) break
  }
  return out.slice(0, maxNew)
}

// ---------------------------------------------------------------- 元数据提取

// ---------------------------------------------------------------- 分类体系(12 能力域)

const VALID_CATEGORIES = ['tool', 'vision', 'dashboard', 'bridge', 'launcher', 'mcp', 'skill', 'memory', 'security', 'media', 'integration', 'other']
/**
 * 关键词表(按优先级顺序,先命中先得)。匹配对象:full_name + description + topics,大小写不敏感(includes 语义)。
 * 四类新能力域(memory/security/media/integration)为站长新增;bridge 与 integration 的区分:
 * bridge = 协议/环境桥接(wsl、协议转换),integration = SaaS/IM/通知等第三方对接。
 */
const CATEGORY_KEYWORDS = [
  ['vision', ['vision', 'image', 'ocr', 'screenshot', '视觉', '图片', '截图']],
  ['bridge', ['bridge', 'wsl', '桥接']],
  ['mcp', ['mcp']],
  ['dashboard', ['dashboard', 'stats', 'usage', '统计', '看板', '面板', 'balance', 'billing', 'cost', 'quota', '余额', '配额', 'status', '状态', 'monitor', '监控']],
  ['launcher', ['launcher', '启动器', '启动']],
  ['skill', ['skill', 'agent', 'workflow', '技能', '工作流']],
  ['memory', ['memory', 'memories', '记忆', '会话记忆', '长期记忆', '知识库', 'knowledge', 'knowledgebase', 'knowledge-base', 'recall', 'remember', 'vector', '向量', 'embedding', 'persistent memory']],
  ['security', ['security', 'secure', 'sandbox', 'guard', 'egress', 'audit', 'permission', '权限', '安全', '沙箱', '审计', 'allowlist', 'denylist', '隔离', 'secret', 'vault']],
  ['media', ['media', 'video', 'audio', 'ffmpeg', 'tts', 'asr', 'voice', 'speech', '语音', '视频', '音频', '音视频', '媒体', '音乐', 'music', '图像生成', '文生图']],
  ['integration', ['webhook', 'slack', 'discord', 'notion', 'feishu', 'lark', 'telegram', 'email', 'notify', 'notification', '通知', '飞书', '钉钉', '企业微信', 'wecom', 'gmail', 'outlook', 'whatsapp', 'oauth', 'provider', 'integration', 'integrat', 'bot', '机器人']],
  ['tool', ['tool', 'util', '工具', 'terminal', 'markdown', 'archive', 'prompt', '提示词', 'search', '搜索', 'session', '会话', 'shortcut', '快捷键', 'manager', '管理', 'backup', '备份', 'export', '导出', 'import', '导入', 'sync', '同步', 'cron', 'scheduler', '定时']],
]

/** 人工覆盖表(config/categories.json,`{ "owner/repo": "category" }`):懒加载 + 内存缓存;读不到=空表。 */
let categoryOverrides = null
export function loadCategoryOverrides() {
  if (categoryOverrides !== null) return categoryOverrides
  try {
    const parsed = JSON.parse(readFileSync(CATEGORY_OVERRIDES_FILE, 'utf8'))
    categoryOverrides = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    categoryOverrides = {}
  }
  return categoryOverrides
}

/**
 * 分类判定优先级:人工覆盖表 > pkg.dsh.registry.category 声明(非法值忽略) > 关键词 > other。
 * overrides 缺省时读 config/categories.json;测试可显式传入,保持调用方签名兼容。
 */
export function inferCategory(pkg, repo, overrides) {
  const ov = overrides ?? loadCategoryOverrides()
  if (ov && Object.prototype.hasOwnProperty.call(ov, repo.full_name)) {
    const v = ov[repo.full_name]
    if (typeof v === 'string' && VALID_CATEGORIES.includes(v)) return v
  }
  const declared = pkg?.dsh?.registry?.category
  if (typeof declared === 'string' && VALID_CATEGORIES.includes(declared)) return declared
  const hay = `${repo.full_name} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`.toLowerCase()
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => hay.includes(w))) return cat
  }
  return 'other'
}

function slugOf(fullName) {
  return fullName.split('/')[1].toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

/** 读取并校验 package.json;返回 { pkg, ok }。收录必要条件:声明 dsh.bundle.patch。 */
async function fetchPackageJson(fullName) {
  const text = await rawFetch(`${fullName}/package.json`)
  if (text === null) return { pkg: null, ok: false }
  try {
    const pkg = JSON.parse(text)
    return { pkg, ok: typeof pkg?.dsh?.bundle?.patch === 'string' }
  } catch {
    return { pkg: null, ok: false }
  }
}

const README_CANDIDATES = ['README.md', 'readme.md', 'README.zh.md', 'README.markdown', 'README', 'docs/README.md', 'docs/readme.md']
async function fetchReadme(fullName) {
  for (const name of README_CANDIDATES) {
    const text = await rawFetch(`${fullName}/${name}`)
    if (text !== null && text.trim() !== '') return text
  }
  return null
}

/** 仓库未填 GitHub 描述时,从 README 首个正文段落兜底一句话描述。 */
function descriptionFallback(readme) {
  if (!readme) return ''
  for (const block of readme.split(/\n\s*\n/)) {
    const line = block.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('!') || line.startsWith('[') || line.startsWith('<') || line.startsWith('```')) continue
    return line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
  }
  return ''
}

// ---------------------------------------------------------------- README 渲染

const domWindow = new JSDOM('').window
const purify = createDOMPurify(domWindow)

function renderReadme(md, repo) {
  const truncated = Buffer.byteLength(md, 'utf8') > README_MAX_BYTES
  const source = truncated ? md.slice(0, README_MAX_BYTES) : md
  let html = marked.parse(source, { async: false })
  html = purify.sanitize(html, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'pre', 'code', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'strong', 'em', 'del', 'hr', 'br', 'sup', 'sub', 'details', 'summary', 'kbd'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'align'],
  })
  // 相对资源 → GitHub 绝对地址
  const norm = (p) => p.replace(/^(\.\/)+/, '').replace(/^(\.\.\/)+/, '')
  html = html
    .replace(/href="(?!https?:|mailto:|#)([^"]+)"/g, (_, p) => `href="https://github.com/${repo}/blob/HEAD/${norm(p)}"`)
    .replace(/src="(?!https?:|data:)([^"]+)"/g, (_, p) => `src="https://raw.githubusercontent.com/${repo}/HEAD/${norm(p)}"`)
  if (truncated) html += `<p>…(README 过大已截断,<a href="https://github.com/${repo}#readme">在 GitHub 阅读全文</a>)</p>`
  return html
}

// ---------------------------------------------------------------- 信任模型

const DAY = 86400000
/**
 * 维护活跃判定:只看插件自身的生态与活跃度,不看收录时长。
 * 达标 = (stars ≥20 或 forks ≥5) + 作者账号 ≥90 天 + 180 天内有提交 + 未被人工标记。
 * 豁免:stars ≥200(高牵引)时跳过作者账号年龄检查——极强的社区信号本身就是背书。
 */
function computeState({ stars, forks, authorCreatedAt, pushedAt, flagged }) {
  if (flagged) return { state: 'flagged', reasons: ['✗ 被人工标记'] }
  const now = Date.now()
  const authorAgeDays = authorCreatedAt !== null ? Math.floor((now - new Date(authorCreatedAt).getTime()) / DAY) : null
  const highTraction = stars >= 200
  const authorOk = highTraction || (authorAgeDays !== null && authorAgeDays >= 90)
  const authorNote = highTraction
    ? `stars ${stars} ≥ 200(高牵引,豁免作者账号年龄)`
    : authorAgeDays !== null ? `作者账号 ${authorAgeDays} 天(需 ≥90)` : '作者账号年龄未知'
  const checks = [
    [stars >= 20 || forks >= 5, `stars ${stars} / forks ${forks}(需 stars ≥20 或 forks ≥5)`],
    [authorOk, authorNote],
    [now - new Date(pushedAt).getTime() <= 180 * DAY, `最近活跃 ${Math.floor((now - new Date(pushedAt).getTime()) / DAY)} 天前(需 ≤180)`],
  ]
  const pass = checks.every(([ok]) => ok)
  return { state: pass ? 'community' : 'unreviewed', reasons: checks.map(([ok, label]) => `${ok ? '✓' : '✗'} ${label}`) }
}

// ---------------------------------------------------------------- 主流程

async function atomicWrite(file, content) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

async function main() {
  const startedAt = Date.now()
  console.log('[crawl] 开始收集…')

  // 0) 读取人工输入 + 旧索引(firstSeenAt 继承)+ 收集缓存(兼作"已收录清单")
  const seeds = JSON.parse(await readFile(SEEDS_FILE, 'utf8').catch(() => '[]'))
  const flags = JSON.parse(await readFile(FLAGS_FILE, 'utf8').catch(() => '{}'))
  const featuredConfig = JSON.parse(await readFile('config/featured.json', 'utf8').catch(() => '{}'))
  const featuredList = featuredConfig.featured || []
  const oldIndex = JSON.parse(await readFile(PLUGINS_FILE, 'utf8').catch(() => '[]'))
  const firstSeenMap = new Map(oldIndex.map((p) => [p.slug, p.firstSeenAt]))
  const pkgCache = JSON.parse(await readFile(PKG_CACHE_FILE, 'utf8').catch(() => '{}'))
  lsRemoteUsable = (await tryLsRemote('deepseek-ai/deepseek-harness')) !== null
  console.log(`[crawl] git ls-remote ${lsRemoteUsable ? '可用(走免费通道)' : '不可用(HEAD sha 走 REST 兜底)'}`)

  // 1) 增量搜索:pkgCache 的键即"已收集仓库清单",跳过它们,每轮只收新出现的
  //    (CRAWL_FULL=1 强制全量重扫;CRAWL_SKIP_SEARCH=1 仅跑 seeds 用于定向调试)
  const MAX_NEW = Number(process.env.CRAWL_MAX_NEW || 300)
  const seen = new Set(Object.keys(pkgCache))
  const found = process.env.CRAWL_SKIP_SEARCH === '1'
    ? []
    : process.env.CRAWL_FULL === '1'
      ? await searchAll()
      : await searchIncremental(seen, MAX_NEW)
  console.log(`[crawl] 本轮新发现 ${found.length} 个仓库(上限 ${MAX_NEW})`)

  // 2) 合并 seeds(种子可能不在 topic 里,补查元数据;种子始终处理,缓存保证廉价)
  const byName = new Map(found.map((r) => [r.full_name, r]))
  for (const seed of seeds) {
    if (!seed?.repo || byName.has(seed.repo)) continue
    const repo = await ghApi(`https://api.github.com/repos/${seed.repo}`, coreGate)
    if (repo) {
      repo._seedCategory = seed.category
      byName.set(seed.repo, repo)
      console.log(`[crawl] 种子补录: ${seed.repo}`)
    } else {
      console.warn(`[crawl] 种子不可达: ${seed.repo}`)
    }
  }
  // 2.5) 存量 refresh:活跃窗口全量 + 长尾轮转;404/删除标记下架
  const REFRESH_BUDGET = Number(process.env.CRAWL_REFRESH || 500)
  const round = Math.floor(Date.now() / 86400000)   // 以天为轮转单位
  const refreshList = planGithubRefresh(oldIndex, { now: Date.now(), budget: REFRESH_BUDGET, round })
    .filter((fullName) => !byName.has(fullName))
  const removed = []
  let checked = 0
  await pool(refreshList, API_CONCURRENCY, async (fullName) => {
    const repo = await ghApi(`https://api.github.com/repos/${fullName}`, coreGate)
    if (repo === null) {
      removed.push(fullName)
      delete pkgCache[fullName]
      console.warn(`[crawl] 下架(404/删除): ${fullName}`)
      return
    }
    byName.set(fullName, repo)
    if (++checked % 100 === 0) console.log(`[crawl] 存量刷新进度 ${checked}/${refreshList.length}`)
  })
  if (removed.length > 0) console.log(`[crawl] 本轮下架 ${removed.length} 个`)

  // 2.6) 反哺候选:与 seeds 同级补查元数据(仍须过 dsh.bundle.patch + LICENSE + README 门槛)
  const backfills = await consumeBackfill(join(ROOT, 'tools', '.cache'))
  for (const cand of backfills) {
    if (byName.has(cand.repo)) continue
    const repo = await ghApi(`https://api.github.com/repos/${cand.repo}`, coreGate)
    if (repo) { repo._backfillFrom = cand.from; byName.set(cand.repo, repo) }
  }
  if (backfills.length > 0) console.log(`[crawl] 反哺候选 ${backfills.length} 个(成功补查计入管道)`)

  const repos = [...byName.values()].filter((r) => !r.disabled)
  if (MAX_REPOS > 0) {
    console.log(`[crawl] 冒烟模式:仅处理前 ${MAX_REPOS} 个`)
    repos.length = Math.min(repos.length, MAX_REPOS)
  }
  if (ONLY) {
    const filtered = repos.filter((r) => r.full_name.includes(ONLY))
    console.log(`[crawl] CRAWL_ONLY=${ONLY}: ${filtered.length} 个匹配`)
    repos.length = 0
    repos.push(...filtered)
  }

  // 3) 初筛:package.json(收录必要条件 + 元数据);带 pushedAt 校验的磁盘缓存,重跑免重抓
  let done = 0
  let cacheHits = 0
  const withPkg = await pool(repos, RAW_CONCURRENCY, async (repo) => {
    const cached = pkgCache[repo.full_name]
    if (cached !== undefined && cached.pushedAt === repo.pushed_at) { cacheHits++; return { repo, pkg: cached.pkg, ok: cached.ok } }
    const { pkg, ok } = await fetchPackageJson(repo.full_name)
    pkgCache[repo.full_name] = { pushedAt: repo.pushed_at, ok, pkg }
    if (++done % 200 === 0) console.log(`[crawl] package.json 初筛进度 ${done}/${repos.length}(缓存命中 ${cacheHits})`)
    return { repo, pkg, ok }
  })
  await atomicWrite(PKG_CACHE_FILE, JSON.stringify(pkgCache))
  console.log(`[crawl] 初筛完成:新抓 ${done},缓存命中 ${cacheHits}`)
  // 收录硬性条件:声明 dsh.bundle.patch + 有许可文件(GitHub license 检测非空)
  const candidates = withPkg.filter((x) => x.ok && x.repo.license != null)
  console.log(`[crawl] 通过收录必要条件(dsh.bundle.patch + LICENSE): ${candidates.length}(剔除无许可文件 ${withPkg.filter((x) => x.ok && x.repo.license == null).length} 个)`)

  // 4) 补全:HEAD sha + README(命中缓存零网络;单仓故障降级跳过,不拖垮整轮)
  done = 0
  const enrichedAll = await pool(candidates, RAW_CONCURRENCY, async (item) => {
    const key = item.repo.full_name
    const cached = pkgCache[key]
    try {
      if (cached !== undefined && cached.pushedAt === item.repo.pushed_at && typeof cached.hasReadme === 'boolean') {
        const text = cached.hasReadme ? await readFile(readmeCacheFile(key), 'utf8').catch(() => undefined) : null
        if (text !== undefined) return { ...item, sha: cached.sha ?? null, readme: text }
        // 缓存文件丢失 → 回源重抓
      }
      const [sha, readme] = await Promise.all([headSha(item.repo), fetchReadme(key)])
      pkgCache[key] = { pushedAt: item.repo.pushed_at, ok: true, pkg: item.pkg, sha, hasReadme: readme !== null }
      if (readme !== null) {
        await mkdir(README_CACHE_DIR, { recursive: true })
        await writeFile(readmeCacheFile(key), readme, 'utf8')
      }
      return { ...item, sha, readme }
    } catch (error) {
      console.warn(`[crawl] ${key} 补全失败,跳过: ${error.cause?.code ?? error.message}`)
      return { ...item, sha: null, readme: null }
    } finally {
      if (++done % 100 === 0) console.log(`[crawl] sha/README 进度 ${done}/${candidates.length}`)
    }
  })
  await atomicWrite(PKG_CACHE_FILE, JSON.stringify(pkgCache))
  // 收录规则:无 README 的项目直接跳过(详情页以完整 README 为主体内容)
  const enriched = enrichedAll.filter((e) => e.readme !== null)
  console.log(`[crawl] 跳过无 README 项目 ${enrichedAll.length - enriched.length} 个,有效收录候选 ${enriched.length}`)

  // 5) 付费通道(仅少数):社区候选的作者账号年龄 + Release 资产
  const today = new Date().toISOString().slice(0, 10)
  const newRecords = await pool(enriched, API_CONCURRENCY, async ({ repo, pkg, sha, readme }) => {
    const slug = slugOf(repo.full_name)
    const firstSeenAt = firstSeenMap.get(slug) ?? today
    const flagged = flags[slug]?.state === 'flagged'
    const featured = featuredList.includes(slug) || flags[slug]?.featured === true
    const nearCommunity = repo.stargazers_count >= 20 || repo.forks_count >= 5
    let authorCreatedAt = null
    let releaseAssetUrl = null
    if (nearCommunity) {
      try {
        const user = await ghApi(`https://api.github.com/users/${repo.owner.login}`, coreGate)
        authorCreatedAt = user?.created_at ?? null
        const release = await ghApi(`https://api.github.com/repos/${repo.full_name}/releases/latest`, coreGate)
        const asset = release?.assets?.find((a) => /\.t(ar\.gz|gz)$/.test(a.name))
        releaseAssetUrl = asset?.browser_download_url ?? null
      } catch (error) {
        console.warn(`[crawl] ${repo.full_name} 作者/Release 查询失败(降级继续): ${error.cause?.code ?? error.message}`)
      }
    }
    const { state, reasons } = computeState({
      stars: repo.stargazers_count, forks: repo.forks_count,
      authorCreatedAt, pushedAt: repo.pushed_at, flagged,
    })
    return {
      slug,
      name: pkg.dsh?.registry?.name ?? pkg.name ?? slug,
      version: pkg.version ?? null,
      repo: repo.full_name,
      githubUrl: repo.html_url,
      description: pkg.dsh?.registry?.description ?? repo.description ?? descriptionFallback(readme),
      category: repo._seedCategory ?? inferCategory(pkg, repo),
      tags: (repo.topics ?? []).filter((t) => t !== 'dsh-plugin').slice(0, 6),
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      pushedAt: repo.pushed_at.slice(0, 10),
      firstSeenAt,
      latestCommit: sha,
      installSpec: `github:${repo.full_name}${sha ? `#${sha}` : ''}`,
      releaseAssetUrl,
      readmeUrl: null,               // 合并去重后统一赋值
      _readme: readme,               // 原文(渲染用,落盘前删除)
      license: repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null,
      authorCreatedAt,   // 旧记录合并时重算信任状态要用
      state,
      stateReasons: reasons,
      featured,
      basicCheck: true,   // 收录即通过:dsh.bundle.patch 声明 + README 均为硬性收录条件
      type: 'plugin',
      source: sourceOf(repo),
    }
  })

  // 6) 合并旧索引:本轮新记录覆盖同 repo 旧记录;其余旧记录保留,并按最新 flags/日期
  //    阈值重算信任状态(否则"社区认可"永不到达),同时回填 schema 1.1 的 type/source
  const seedRepos = new Set(seeds.map((s) => s.repo))
  const freshByRepo = new Map(newRecords.map((r) => [r.repo, r]))
  let merged = []
  for (const old of oldIndex) {
    const fresh = freshByRepo.get(old.repo)
    if (fresh !== undefined) {
      freshByRepo.delete(old.repo)
      merged.push(mergeOldRecord(old, fresh))
      continue
    }
    const flagged = flags[old.slug]?.state === 'flagged'
    const { state, reasons } = computeState({
      stars: old.stars, forks: old.forks,
      authorCreatedAt: old.authorCreatedAt ?? null, pushedAt: old.pushedAt, flagged,
    })
    merged.push(migrateOldRecord(old, seedRepos, { state, reasons }))
  }
  merged.push(...freshByRepo.values())

  // 剔除下架仓库:removed 中的旧记录不得进入 merged(其 README 片段由 step 7 的
  // keepFragments GC 自然清理——不在 merged 即不列入保留集)
  const removedKeys = new Set(removed.map(keyOf))
  if (removedKeys.size > 0) merged = merged.filter((r) => !removedKeys.has(keyOf(r.repo)))

  // slug 唯一化:同名不同主的仓库,低星者带作者后缀(同名再撞则数字后缀)
  merged.sort((a, b) => b.stars - a.stars)
  const usedSlugs = new Set()
  for (const r of merged) {
    let s = r.slug
    if (usedSlugs.has(s)) {
      const owner = r.repo.split('/')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
      s = `${r.slug}--${owner}`
      let i = 2
      while (usedSlugs.has(s)) s = `${r.slug}--${i++}`
    }
    usedSlugs.add(s)
    r.slug = s
    const hasReadme = r._readme !== undefined ? r._readme !== null : r.readmeUrl !== null
    r.readmeUrl = hasReadme ? `data/readme/${s}.html` : null
  }

  // 7) README 片段:只渲染缺失的(新记录或 slug 变更的旧记录),清理下架片段
  const existingFragments = new Set(await readdir(README_DIR).catch(() => []))
  const keepFragments = new Set()
  let rendered = 0
  await pool(merged.filter((r) => r.readmeUrl !== null), 4, async (r) => {
    const file = `${r.slug}.html`
    keepFragments.add(file)
    if (existingFragments.has(file)) return
    const raw = r._readme ?? await readFile(readmeCacheFile(r.repo), 'utf8').catch(() => null)
    if (raw === null) {
      console.warn(`[crawl] ${r.repo} 原文缓存缺失,片段暂缓`)
      r.readmeUrl = null
      keepFragments.delete(file)
      return
    }
    await atomicWrite(join(README_DIR, file), renderReadme(raw, r.repo))
    if (++rendered % 50 === 0) console.log(`[crawl] README 渲染 ${rendered}`)
  })
  for (const r of merged) delete r._readme
  for (const file of existingFragments) {
    if (!keepFragments.has(file)) await rm(join(README_DIR, file))
  }

  // 8) 产物落盘(原子写)
  await atomicWrite(PLUGINS_FILE, JSON.stringify(merged, null, 2) + '\n')
  const blocked = merged.filter((r) => r.state === 'flagged').map((r) => r.slug)
  await atomicWrite(join(DATA_DIR, 'blocklist.json'), JSON.stringify({ blocked, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  await atomicWrite(join(DATA_DIR, 'meta.json'), JSON.stringify({
    schemaVersion: '1.1',
    pluginCount: merged.length,
    categoryCount: new Set(merged.map((r) => r.category)).size,
    communityCount: merged.filter((r) => r.state === 'community').length,
    flaggedCount: blocked.length,
    updatedAt: new Date().toISOString(),
  }, null, 2) + '\n')

  // 8.5) changelog:added = firstSeenAt 为今天的记录;updated = fresh 替换且 latestCommit 变化;removed = 下架
  const changelogFile = join(DATA_DIR, 'changelog.json')
  const changelog = JSON.parse(await readFile(changelogFile, 'utf8').catch(() => '{"version":1,"entries":[]}'))
  const entries = []
  for (const r of newRecords) {
    if (r.firstSeenAt === today) entries.push(makeEntry('added', r.slug, { source: r.source, now: today }))
    else {
      const old = oldIndex.find((o) => o.repo === r.repo)
      if (old && old.latestCommit !== r.latestCommit) entries.push(makeEntry('updated', r.slug, { source: r.source, now: today }))
    }
  }
  for (const fullName of removed) {
    const old = oldIndex.find((o) => o.repo === fullName)
    if (old) entries.push(makeEntry('removed', old.slug, { source: old.source ?? 'github-topic', now: today }))
  }
  if (entries.length > 0) {
    const next = appendEntries(changelog, entries, { now: Date.now() })
    await atomicWrite(changelogFile, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  }

  // 8.6) trending:与上轮快照 diff;随后写本轮快照
  const snapFile = join(ROOT, 'tools', '.cache', 'star-snap.json')
  const snap = JSON.parse(await readFile(snapFile, 'utf8').catch(() => '{}'))
  const items = diffStars(snap, merged, { top: 20 })
  await atomicWrite(join(DATA_DIR, 'trending.json'), JSON.stringify({ updatedAt: new Date().toISOString(), window: '24h', items }, null, 2) + '\n')
  await atomicWrite(snapFile, JSON.stringify(Object.fromEntries(merged.map((r) => [r.repo, r.stars]))))

  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1)
  console.log(`[crawl] 完成:索引共 ${merged.length}(本轮新增/更新 ${newRecords.length};community ${merged.filter((r) => r.state === 'community').length} / flagged ${blocked.length}),用时 ${minutes} 分钟`)
}

// CLI 入口:测试 import 纯函数时不执行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('[crawl] 失败:', e); process.exit(1) })
}
