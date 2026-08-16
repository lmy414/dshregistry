/**
 * dsh-marketplace — 插件市场(host 半)
 *
 * 在 DSH 设置页提供"插件市场"栏,浏览 dshregistry 收录的插件并安装/卸载:
 * 1. registry 代理:GET /dsh-marketplace/api/registry 拉取注册中心的
 *    plugins.json + blocklist.json(静态文件),内存缓存,避免每次请求打公网。
 * 2. 已装对账:GET /dsh-marketplace/api/installed 读 profile 的
 *    package.json(dependencies + dsh.profile.bundles)与 cordis.patch.yml
 *    (insert 行),三源合并显示已安装状态。
 * 3. 热安装:POST /dsh-marketplace/api/install { slug } →
 *    spawn `pnpm add <spec>`(profile 目录)→ 原子追加 patch insert 行 →
 *    DSH 配置热更契约自动挂载,无需重启。不走 `dsh plugin` 命令
 *    (避免写 dsh.profile.bundles 造成下次启动双挂)。
 * 4. 热卸载:POST /dsh-marketplace/api/uninstall { name } →
 *    原子删除 patch insert 块(热卸载)→ pnpm remove 清理依赖。
 *
 * 安全边界(硬性):
 * - 安装只接受 slug,host 从 registry 数据反查 name/installSpec,
 *   绝不信任客户端传来的安装目标(防注入)。
 * - installSpec 白名单:仅 github: / git+https://github.com/ /
 *   https://github.com/.../releases/download/*.tgz。
 * - 黑名单:blocklist.json 命中的 slug 拒绝安装。
 * - patch 只插 name,永不携带外部 config(patch 解析支持 !!js,恶意
 *   config 即代码执行)。
 * - install/uninstall 互斥锁,防并发写 profile。
 *
 * 本文件是纯 ESM,只依赖 Node 内置模块 + webServer 服务。
 */

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-marketplace'

/** 依赖的 host 服务。 */
export const inject = ['webServer']

const DEFAULT_REGISTRY_BASE = 'https://dshregistry.xyz'
const DEFAULT_PROFILE = 'web'
const DEFAULT_PNPM_TIMEOUT_MS = 180000
const DEFAULT_CACHE_TTL_MS = 300000

/** installSpec 白名单:仅 GitHub 源。 */
const SPEC_PATTERNS = [
  /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(#[A-Za-z0-9_.-]+)?$/,
  /^git\+https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?(#[A-Za-z0-9_.-]+)?$/,
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[^\s"']+\.tgz$/,
]

/** 解析配置。 */
function resolveConfig(config) {
  const raw = config ?? {}
  const registryBaseUrl = typeof raw.registryBaseUrl === 'string' && raw.registryBaseUrl !== ''
    ? raw.registryBaseUrl.replace(/\/+$/, '')
    : DEFAULT_REGISTRY_BASE
  const profile = typeof raw.profile === 'string' && raw.profile !== '' ? raw.profile : DEFAULT_PROFILE
  const pnpmTimeoutMs = Number.isInteger(raw.pnpmTimeoutMs) && raw.pnpmTimeoutMs > 0
    ? raw.pnpmTimeoutMs
    : DEFAULT_PNPM_TIMEOUT_MS
  const cacheTtlMs = Number.isInteger(raw.cacheTtlMs) && raw.cacheTtlMs > 0
    ? raw.cacheTtlMs
    : DEFAULT_CACHE_TTL_MS
  return { registryBaseUrl, profile, pnpmTimeoutMs, cacheTtlMs }
}

/** $DSH_HOME(默认 ~/.dsh)。 */
function dshHome() {
  return process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

/** 安装日志路径:$DSH_HOME/dsh-marketplace/install.log。 */
function logPath() {
  return join(dshHome(), 'dsh-marketplace', 'install.log')
}

/** 追加一条 JSONL 安装日志(失败不阻塞主流程)。 */
async function writeLog(entry) {
  try {
    await mkdir(dirname(logPath()), { recursive: true })
    await appendFile(logPath(), JSON.stringify({ ts: Date.now(), ...entry }) + '\n', 'utf8')
  } catch { /* 日志失败不影响功能 */ }
}

/** registry 缓存:内存,TTL 内复用。 */
let registryCache = null
let registryFetchedAt = 0

/** 拉取注册中心数据(plugins.json + blocklist.json),带缓存。 */
async function fetchRegistry(base, cacheTtlMs) {
  if (registryCache !== null && Date.now() - registryFetchedAt < cacheTtlMs) {
    return registryCache
  }
  const [pluginsRes, blocklistRes] = await Promise.all([
    fetch(`${base}/data/plugins.json`),
    fetch(`${base}/data/blocklist.json`),
  ])
  if (!pluginsRes.ok) {
    throw new Error(`registry plugins.json: HTTP ${pluginsRes.status}`)
  }
  const plugins = await pluginsRes.json()
  let blocked = []
  if (blocklistRes.ok) {
    try {
      const bl = await blocklistRes.json()
      blocked = Array.isArray(bl.blocked) ? bl.blocked : []
    } catch { /* 黑名单缺失时按空处理 */ }
  }
  registryCache = { plugins, blocked }
  registryFetchedAt = Date.now()
  return registryCache
}

/** 清空 registry 缓存(数据源变更后强制刷新)。 */
function invalidateRegistry() {
  registryCache = null
  registryFetchedAt = 0
}

/** profile 目录与 patch 文件路径。 */
function profilePaths(profile) {
  const dir = join(dshHome(), 'profiles', profile)
  return { dir, patchPath: join(dir, 'cordis.patch.yml') }
}

/** 读 JSON 文件;缺失返回 null,损坏抛错。 */
async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** 原子写文件。 */
async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

/** 从 patch 文本提取所有 insert 块(顶层 `- insert:` 起,4 空格缩进子行)。 */
export function extractInsertBlocks(text) {
  const blocks = []
  const re = /^- insert:\n(?:    [^\n]*\n?)*/gm
  let m
  while ((m = re.exec(text)) !== null) blocks.push(m[0])
  return blocks
}

/** 在 patch 文本中查找含指定 id 的 insert 块;找到返回 { block, index }。 */
export function findBlockByInsertId(text, id) {
  const blocks = extractInsertBlocks(text)
  for (let i = 0; i < blocks.length; i++) {
    if (new RegExp(`^\\s{4}-\\s+id:\\s*['"]?${escapeRe(id)}['"]?\\s*$`, 'm').test(blocks[i])) {
      return { block: blocks[i], index: i }
    }
  }
  return null
}

/** 转义正则特殊字符。 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 追加一个 insert 块到 patch 文本末尾(保留既有内容与 !!js 行)。 */
export function appendInsertBlock(text, id, pkgName) {
  const block = `- insert:\n    - id: ${id}\n      name: '${pkgName}'\n`
  if (text.trim() === '') return block
  return `${text.replace(/\s*$/, '')}\n\n${block}`
}

/** 从 patch 文本删除含指定 id 的 insert 块。 */
export function removeInsertBlock(text, id) {
  const found = findBlockByInsertId(text, id)
  if (found === null) return { text, removed: false }
  const blocks = extractInsertBlocks(text)
  const start = text.indexOf(blocks[found.index])
  const raw = blocks[found.index]
  const end = start + raw.length
  const before = text.slice(0, start)
  const after = text.slice(end)
  // 清理块之间多余空行:after 开头若有多余空行则压成至多一个。
  return { text: before.replace(/\s*$/, '') + (after.trim() === '' ? '' : `\n\n${after.replace(/^\n+/, '')}`), removed: true }
}

/** 解析 patch 文本中所有 insert 行(安装/卸载对账用)。 */
export function parseInsertRows(text) {
  const rows = []
  const re = /^- insert:\n(?:    [^\n]*\n?)*/gm
  let m
  while ((m = re.exec(text)) !== null) {
    const block = m[0]
    const idMatch = /^    - id:\s*([^\s]+)/m.exec(block)
    const nameMatch = /^      name:\s*['"]?([^'"]+)['"]?\s*$/m.exec(block)
    if (idMatch !== null) {
      rows.push({ id: idMatch[1], name: nameMatch?.[1] ?? null })
    }
  }
  return rows
}

/** spawn pnpm,带超时;成功返回 stdout+stderr,失败抛错。 */
function runPnpm(cwd, args, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('pnpm', args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(new Error(`pnpm 超时(${timeoutMs}ms): pnpm ${args.join(' ')}`))
    }, timeoutMs)
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { err += String(d) })
    child.on('error', (e) => {
      clearTimeout(timer)
      rejectPromise(new Error(`pnpm 启动失败: ${e.message}${e.code === 'ENOENT' ? '(未安装 pnpm,或不在 PATH)' : ''}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise({ out, err })
      else rejectPromise(new Error(`pnpm 退出码 ${code}: ${(err || out).slice(0, 2000)}`))
    })
  })
}

/** 安装/卸载互斥锁。 */
let mutationChain = Promise.resolve()

/** 串行执行写操作(install/uninstall)。 */
function withMutationLock(fn) {
  const next = mutationChain.then(fn, fn)
  mutationChain = next.then(() => undefined, () => undefined)
  return next
}

/** 响应工具。 */
function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** 插件主体。 */
export function apply(ctx) {
  const cfg = resolveConfig(ctx.config)
  const { dir: profileDir, patchPath } = profilePaths(cfg.profile)

  // 所有 API 挂在 prefix 路由上按路径分发;effect 持有 disposer,热重载自动移除。
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-marketplace/api',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
        const route = url.pathname.slice('/dsh-marketplace/api'.length) || '/'
        const method = req.method

        // GET /registry — 注册中心数据(plugins + blocklist)
        if (route === '/registry' && method === 'GET') {
          const data = await fetchRegistry(cfg.registryBaseUrl, cfg.cacheTtlMs)
          writeJson(res, 200, { ok: true, source: cfg.registryBaseUrl, cachedAt: registryFetchedAt, ...data })
          return
        }

        // GET /installed — 已安装对账
        if (route === '/installed' && method === 'GET') {
          const manifest = await readJsonOrNull(join(profileDir, 'package.json'))
          const deps = manifest?.dependencies ?? {}
          const bundles = manifest?.dsh?.profile?.bundles ?? []
          let patchText = ''
          try { patchText = await readFile(patchPath, 'utf8') } catch { /* 无 patch 文件 */ }
          const patchRows = parseInsertRows(patchText)
          writeJson(res, 200, {
            ok: true,
            profile: cfg.profile,
            profileDir,
            patchPath,
            dependencies: Object.keys(deps),
            bundles,
            patchRows,
          })
          return
        }

        // POST /install { slug } — 热安装
        if (route === '/install' && method === 'POST') {
          const body = await readBody(req)
          const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
          if (slug === '') {
            writeJson(res, 400, { ok: false, error: '缺少 slug' })
            return
          }
          const result = await withMutationLock(async () => {
            const data = await fetchRegistry(cfg.registryBaseUrl, cfg.cacheTtlMs)
            if (data.blocked.includes(slug)) {
              return { ok: false, status: 403, error: `插件 ${slug} 已被标记为有风险,拒绝安装(黑名单)` }
            }
            const plugin = data.plugins.find((p) => p.slug === slug)
            if (plugin === undefined) {
              return { ok: false, status: 404, error: `注册中心没有 ${slug}(数据可能未刷新,请稍后重试)` }
            }
            const spec = plugin.installSpec
            const pkgName = plugin.name
            if (typeof spec !== 'string' || !SPEC_PATTERNS.some((re) => re.test(spec))) {
              return { ok: false, status: 400, error: `installSpec 不在白名单内: ${spec}` }
            }
            if (!/^[a-z0-9][a-z0-9-_.]*$/.test(pkgName)) {
              return { ok: false, status: 400, error: `非法包名: ${pkgName}` }
            }
            // 已在 patch 中则提示已安装。
            let patchText = ''
            try { patchText = await readFile(patchPath, 'utf8') } catch { /* 首次安装无文件 */ }
            if (findBlockByInsertId(patchText, slug) !== null) {
              return { ok: false, status: 409, error: `${slug} 已安装(存在于 cordis.patch.yml)` }
            }
            // 1. pnpm add(profile 目录;不走 dsh plugin,避免 bundle 对账双挂)
            await runPnpm(profileDir, ['add', spec], cfg.pnpmTimeoutMs)
            // 2. 原子追加 patch insert 行 → 配置热更契约自动挂载
            const next = appendInsertBlock(patchText, slug, pkgName)
            await atomicWrite(patchPath, next)
            await writeLog({ action: 'install', slug, name: pkgName, spec, ok: true })
            return {
              ok: true,
              slug,
              name: pkgName,
              spec,
              hotReload: true,
              message: `已安装 ${pkgName},配置热更已触发,无需重启。若未生效请重启 DSH。`,
            }
          })
          writeJson(res, result.status ?? (result.ok ? 200 : 500), result)
          return
        }

        // POST /uninstall { id } — 热卸载。按 patch insert 行的 id(安装时写入的 slug)
        // 查找并删除块;包名从块内解析,用于 pnpm remove。兼容旧客户端传 { name }。
        if (route === '/uninstall' && method === 'POST') {
          const body = await readBody(req)
          const id = typeof body?.id === 'string'
            ? body.id.trim()
            : (typeof body?.name === 'string' ? body.name.trim() : '')
          if (id === '' || id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9-_.@/]*$/.test(id)) {
            writeJson(res, 400, { ok: false, error: '缺少合法的 id' })
            return
          }
          const result = await withMutationLock(async () => {
            let patchText = ''
            try { patchText = await readFile(patchPath, 'utf8') } catch { /* 无文件 */ }
            const found = findBlockByInsertId(patchText, id)
            if (found === null) {
              return { ok: false, status: 404, error: `${id} 不在 patch 安装列表中` }
            }
            // 包名从 insert 块解析(pnpm remove 需要包名,而非 slug)。
            const rows = parseInsertRows(found.block)
            const pkgName = rows[0]?.name ?? id
            // 1. 先删 patch 行(热卸载)
            const removed = removeInsertBlock(patchText, id)
            await atomicWrite(patchPath, removed.text)
            // 2. pnpm remove 清理依赖(失败只告警,不阻塞)
            let cleanup = null
            try {
              await runPnpm(profileDir, ['remove', pkgName], cfg.pnpmTimeoutMs)
            } catch (error) {
              cleanup = String(error?.message ?? error)
            }
            await writeLog({ action: 'uninstall', id, name: pkgName, ok: true, cleanup })
            return {
              ok: true,
              id,
              name: pkgName,
              hotReload: true,
              message: `已卸载 ${pkgName}${cleanup ? `(依赖清理失败: ${cleanup},可手动 pnpm remove)` : ''}`,
            }
          })
          writeJson(res, result.status ?? (result.ok ? 200 : 500), result)
          return
        }

        // GET /config — 诊断信息
        if (route === '/config' && method === 'GET') {
          writeJson(res, 200, {
            ok: true,
            registryBaseUrl: cfg.registryBaseUrl,
            profile: cfg.profile,
            profileDir,
            patchPath,
            dshHome: dshHome(),
          })
          return
        }

        writeJson(res, 404, { ok: false, error: `not found: ${route}` })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }))

  // 插件卸载时清缓存。
  ctx.effect(() => () => invalidateRegistry())
}

/** 读取请求体(限制 64KB)。 */
function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        rejectPromise(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolvePromise(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolvePromise({})
      }
    })
    req.on('error', rejectPromise)
  })
}
