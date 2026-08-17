/** 爬取状态层:网页源按 URL 记 lastCheckedAt/lastChangedAt/unchangedRounds;refresh planner 算到期任务。 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DAY = 86400000

export async function loadState(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    // 文件缺失 / 崩溃窗口残留非法 JSON:回退空态(全量重抓是安全降级)
    return { version: 1, urls: {} }
  }
}

let tmpCounter = 0
let saveChain = Promise.resolve()
export async function saveState(file, state) {
  await mkdir(dirname(file), { recursive: true })
  // per-call 唯一 tmp 名:并发 writeFile 互不覆写,快照均为完整 JSON;
  // 写入+rename 挂模块级串行链:Windows 上并发 rename 到同一目标文件会互斥
  // (实测 EPERM operation not permitted),排队后 last-writer-wins 按调用序确定。
  const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`
  const run = saveChain.then(async () => {
    await writeFile(tmp, JSON.stringify(state), 'utf8')
    await rename(tmp, file)
  })
  saveChain = run.catch(() => {})   // 单次失败不打断后续排队
  await run
}

/** 记录一次抓取结果:changed 复位 unchangedRounds 并更新 lastChangedAt;未变递增。 */
export function noteChecked(state, url, { now, changed, hash }) {
  const prev = state.urls[url]
  state.urls[url] = {
    lastCheckedAt: now,
    lastChangedAt: changed || !prev ? now : prev.lastChangedAt,
    unchangedRounds: changed || !prev ? 0 : prev.unchangedRounds + 1,
    hash,
  }
  return state
}

/** 到期任务:从未查过优先,其后按 lastCheckedAt 升序;maxAgeMs 内新鲜跳过;预算截断。 */
export function planRefresh(state, urls, { now, maxAgeMs, budget }) {
  const never = [], stale = []
  for (const url of urls) {
    const u = state.urls[url]
    if (!u) never.push(url)
    else if (now - u.lastCheckedAt >= maxAgeMs) stale.push(url)
  }
  stale.sort((a, b) => state.urls[a].lastCheckedAt - state.urls[b].lastCheckedAt)
  return [...never, ...stale].slice(0, budget)
}

/** GitHub 存量刷新:活跃窗口(pushedAt ≤ activeWindowDays)全选,长尾按 round 确定性轮转补齐预算。
 *  确定性:排序 + wrap-around 分块轮转,不依赖随机数,便于测试与复跑。
 *  wrap-around:round r 从 (r*rest) % T 起连续取 rest 个,块在环上首尾相接,ceil(T/rest) 轮并集覆盖全部长尾;
 *  修复 stride 切片在 T mod rest ≠ 0 时类内末尾项永久饥饿的问题。 */
export function planGithubRefresh(plugins, { now, budget = 500, activeWindowDays = 90, round = 0 }) {
  const active = [], tail = []
  for (const p of plugins) {
    (now - new Date(p.pushedAt).getTime() <= activeWindowDays * DAY ? active : tail).push(p.repo)
  }
  active.sort(); tail.sort()
  const picked = active.slice(0, budget)
  const rest = budget - picked.length
  if (rest > 0 && tail.length > 0) {
    const start = (round * rest) % tail.length
    for (let i = 0; i < rest && i < tail.length; i++) {
      picked.push(tail[(start + i) % tail.length])
    }
  }
  return picked.sort()
}
