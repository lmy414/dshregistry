/** Crawlee 底座:per-domain 限速(Crawlee 无内置,makeGate 包装)+ 断点续跑(独立持久化存储)。 */
import { CheerioCrawler, Configuration, MemoryStorage } from 'crawlee'
import { makeGate } from './http.js'

/** 每域名一个速率门:同域两次请求处理至少间隔 minIntervalMs。 */
export function makeDomainGates(minIntervalMs) {
  const gates = new Map()
  return (url) => {
    const host = new URL(url).hostname
    if (!gates.has(host)) gates.set(host, makeGate(minIntervalMs))
    return gates.get(host)
  }
}

/** 创建 Cheerio 爬虫。storageDir 必须调用方指定(测试=临时目录,生产=tools/.cache/crawlee-<source>);
 *  purgeOnStart:false + persistStorage:true 保证重跑时已成功 URL 被队列跳过(断点续跑)。
 *  注意:Crawlee v3.18 的 Configuration({ storageDir }) 不会把目录传给 MemoryStorage
 *  (它只认 storageClientOptions/环境变量,且持久化实例按配置缓存共享),因此必须
 *  useStorageClient 显式挂载独立 MemoryStorage,否则多爬虫互相污染、断点续跑失效。 */
export function createCheerioRunner({ storageDir, minIntervalMs = 1500, maxConcurrency = 4, requestHandler, failedRequestHandler }) {
  const gateFor = makeDomainGates(minIntervalMs)
  const config = new Configuration({ persistStorage: true, purgeOnStart: false })
  config.useStorageClient(new MemoryStorage({ localDataDirectory: storageDir, persistStorage: true }))
  return new CheerioCrawler({
    maxConcurrency,
    maxRequestRetries: 2,
    // 限速必须挂在 preNavigationHooks(请求发出前):requestHandler 在响应已下载后才执行,
    // 在那里 gate 只能限制"处理"间隔,拦不住并发请求的实际发出,per-domain 限速会失效。
    preNavigationHooks: [async ({ request }) => { await gateFor(request.url)() }],
    async requestHandler(context) {
      await requestHandler(context)
    },
    failedRequestHandler,
  }, config)
}
