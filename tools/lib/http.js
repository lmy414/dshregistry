/** 共享 HTTP 基础库:限速门 / 出站白名单 / GitHub API / 通用文本抓取。 */
export const CRAWL_UA = 'DSHRegistryBot/1.0'
export const DEFAULT_ALLOWED_HOSTS = new Set([
  'api.github.com', 'cdn.jsdelivr.net', 'dshfind.com', 'hub.omdsh.dev',
])

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 出站请求白名单(SSRF 防护):https + 固定主机;注入 127.0.0.1 时放行 http(仅测试)。 */
export function makeAssertAllowed(hosts = DEFAULT_ALLOWED_HOSTS) {
  return function assertAllowed(url) {
    const u = new URL(url)
    const isLocalTest = u.hostname === '127.0.0.1' && hosts.has('127.0.0.1')
    if (!hosts.has(u.hostname) || (u.protocol !== 'https:' && !isLocalTest)) {
      throw new Error(`[http] 禁止抓取非白名单地址: ${url}`)
    }
  }
}
export const assertAllowed = makeAssertAllowed()

/** 速率门:同一闸口内两次放行至少间隔 minIntervalMs。 */
export function makeGate(minIntervalMs) {
  let last = 0
  let chain = Promise.resolve()
  return () => {
    chain = chain.then(async () => {
      const wait = Math.max(0, last + minIntervalMs - Date.now())
      if (wait > 0) await sleep(wait)
      last = Date.now()
    })
    return chain
  }
}

/** GitHub REST:限速 + 403/429 按 X-RateLimit-Reset 退避 + 网络故障重试;404 返回 null。 */
export function makeGhApi(token) {
  return async function ghApi(url, gate, retries = 4) {
    assertAllowed(url)
    for (let attempt = 0; ; attempt++) {
      await gate()
      let res
      try {
        res = await fetch(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
      } catch (error) {
        if (attempt < retries) { await sleep(3000 * (attempt + 1)); continue }
        throw error
      }
      if (res.ok) return res.json()
      const remaining = res.headers.get('x-ratelimit-remaining')
      if ((res.status === 403 || res.status === 429) && attempt < retries) {
        const resetAt = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000
        const wait = remaining === '0' && resetAt > Date.now() ? resetAt - Date.now() + 1000 : 5000 * (attempt + 1)
        await sleep(wait)
        continue
      }
      if (res.status === 404) return null
      throw new Error(`GitHub API ${res.status}: ${url}`)
    }
  }
}

/** 通用文本抓取(网页源):UA + ETag 透传 + 条件请求;404/304 返回 text=null。 */
export async function fetchText(url, { gate, headers = {}, retries = 3, assert: assertFn = assertAllowed } = {}) {
  assertFn(url)
  for (let attempt = 0; ; attempt++) {
    if (gate) await gate()
    let res
    try {
      res = await fetch(url, { headers: { 'User-Agent': CRAWL_UA, ...headers }, redirect: 'follow' })
    } catch (error) {
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue }
      throw error
    }
    if (res.status === 304) return { text: null, etag: null, status: 304 }
    if (res.ok) return { text: await res.text(), etag: res.headers.get('etag'), status: res.status }
    if (res.status === 404) return { text: null, etag: null, status: 404 }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(3000 * (attempt + 1)); continue }
    throw new Error(`fetchText ${res.status}: ${url}`)
  }
}
