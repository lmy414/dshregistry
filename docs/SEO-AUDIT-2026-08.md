# dshregistry.xyz SEO 诊断报告(2026-08-16)

> 扫描方式:线上 HTTP 探测(curl)+ 无头 Chrome 渲染验证(Chrome 151)+ 本地源码对照。
> 范围:首页、插件详情页、about、404、静态资源、服务器配置。

## 总体评分

| 维度 | 评分 | 说明 |
|---|---|---|
| 内容质量 | ★★★★☆ | 2207 个插件条目,描述/README/元数据齐全,内容本身是资产 |
| 可抓取性 | ★★☆☆☆ | 无 sitemap/robots;详情页无静态内链,仅靠 JS 渲染被发现 |
| 页面元信息 | ★☆☆☆☆ | 无 description/canonical/OG/JSON-LD;详情页共用静态 title |
| URL 架构 | ★★☆☆☆ | 详情页为 `plugin.html?slug=` 查询参数形态,无独立路径 |
| 服务器/性能 | ★★☆☆☆ | 无压缩、logo 1.5MB、plugins.json 2.3MB 裸传、CDN 依赖 |
| 双语处理 | ★☆☆☆☆ | lang 写死 zh-CN,英文靠 JS 切换,无 hreflang |

## P0 — 严重(不修则收录/排名基本无望)

1. **详情页对爬虫无静态入口**。首页 HTML 源中 0 个 `plugin.html` 链接,2207 个插件卡片全部由 JS 注入;站点无 sitemap.xml。Google 虽会执行 JS,但依赖 JS 渲染 + 无 sitemap 的发现链路极不稳定,详情页收录率会非常低。
   - 修复:① 生成 `sitemap.xml`(列出全部 `plugin.html?slug=` URL,可用 `tools/crawl.js` 的数据产物自动生成,随 data/ 一起版本化);② 首页改为服务端/构建时预渲染插件卡片链接(至少首屏 20~60 条),或新增静态 `plugins/<slug>.html` 重定向页;③ 详情页间已存在 Related 内链(好),可保留。

2. **robots.txt 404**。爬虫无法读取抓取策略。
   - 修复:新增 `robots.txt`(允许抓取、指向 sitemap),随静态站点部署。

3. **www 与裸域重复内容**。`https://www.dshregistry.xyz/` 与裸域返回完全相同内容,无 301。搜索引擎视为重复站点,稀释权重。
   - 修复:nginx server 块对 `www.` 无条件 `return 301 https://dshregistry.xyz$request_uri;`(http→https 的 301 已正确,照搬同法)。

4. **全站无 meta description / canonical / OG / JSON-LD**。
   - 修复(静态页可脚本化生成):
     - 首页/关于:手写 description + OG + canonical。
     - 详情页:JS 已动态设置 `document.title`,同样动态设置 `<meta name="description">`(取插件 description)、`<link rel="canonical" href="https://dshregistry.xyz/plugin.html?slug=xxx">`、`og:title/og:description`;另外把静态 `<title>` 改成"插件市场 · DSH-Registry"类默认值,避免所有详情页共享同一静态 title。
     - 可选:为详情页加 JSON-LD `SoftwareApplication`(name/description/author/license/url),增强富结果机会。

## P1 — 重要(影响排名与体验)

5. **自定义 404.html 未生效**。线上不存在路径返回 nginx 默认 404 页;本地 `404.html` 已存在但未配置。
   - 修复:nginx 加 `error_page 404 /404.html;`(并确认 404 返回 404 状态码,现已返回 404 ✓)。

6. **无 gzip/br 压缩**。HTML 42KB、`plugins.json` 2.26MB、JS 全部裸传;`plugins.json` 是每次访问全量拉取的 6 小时同步数据。
   - 修复:nginx 开 `gzip on;`(HTML/JS/CSS/JSON);`plugins.json` 建议服务端生成 `.gz` 或至少让 nginx 压缩;数据层可加 `?range=` 增量或仅返回前 N 条 + 分页(见 9)。

7. **logo.png 1.56MB**。首页唯一图片,1.5MB PNG 是首屏 LCP 的主要威胁。
   - 修复:压缩/降色/转 WebP(目标 <50KB),或按尺寸提供多档;`<img>` 加 `width/height` 防 CLS。

8. **中英双语无 hreflang 且 lang 写死**。`<html lang="zh-CN">` 写死,语言切换仅 JS + localStorage;英文内容对搜索引擎不可见,且 JS 切换后 title 变英文与初始 HTML 不一致(爬虫与用户看到不同)。
   - 修复:① 至少为初始 HTML 提供 `lang` 与内容一致的默认(当前默认中文,`<title>` 初始也是中文 ✓,保持一致即可);② 若英文是目标市场,提供 `/en/` 静态变体或 `<link rel="alternate" hreflang="en">` + `x-default`;③ 确认爬虫抓取的是中文初始态,不要依赖 JS 国际化。

9. **详情页 URL 为查询参数形态 + 单页 2207 卡片**。
   - 修复(按成本递增):a. 保持 `?slug=` 但确保 canonical 统一 + sitemap 全量覆盖;b. 改为 `plugin/<slug>.html` 静态文件(构建期生成,最利于收录与分享);c. 首页"Load more"改为分页/分类 URL(`?category=vision&page=2`),为长尾关键词创造独立可索引页面(当前 8 个分类可各成一页)。

## P2 — 建议(锦上添花)

10. **脚本加载阻塞渲染**:4 个 `<script>` 均无 defer/async,其中 2 个是 CDN(运行时 Tailwind 4.3.1 + lucide)。建议 `defer`;lucide 可内联或按需;Tailwind 运行时版建议构建期预编译(体积与稳定性双赢)。
11. **详情页双 h1**:页面主标题 + README 注入的 `h1` 共存(README 的 h2 与页面 h2 也混排)。建议 README 渲染降级为 `h2` 起(或包一层容器并 CSS 重置),保持每页唯一 h1、层级有序。
12. **内联 CSS 每次请求重复传输**(约 40KB+),可外链 + 缓存;HTML 无 Cache-Control(HTML 应 `no-cache` 或短 max-age,静态资源可更长)。
13. **HSTS / CSP 缺失**:建议 `Strict-Transport-Security`(站点已全 https)、基础 CSP。
14. **"Load more (2147 remaining)" 一次挂载大量 DOM**:懒加载已做,可评估 virtualization,减少内存与渲染抖动。
15. **logo alt 已有 ✓;导航/语言切换按钮建议补 aria-label**(目前语言组有 group 名,可接受)。
16. **favicon 用 PNG 单档**:可补 SVG + apple-touch-icon + theme-color。

## 亮点(保持)

- http→https 301 正确且带路径;404 状态码正确。
- 语义化骨架(header/nav/main/section/footer/h1/h2/table)完整,单页单 h1(除详情页 README 注入)。
- 详情页动态 title、Related 内链、README 全文、安全警示文案齐全——内容质量是最大的存量资产。
- 数据层(data/plugins.json)结构化、6 小时同步,适合直接驱动 sitemap 生成与静态化。

## 建议执行顺序(约 1~2 天工作量)

1. nginx:www→裸域 301、gzip、`error_page 404`、静态资源缓存调优(半小时,收益最大)。
2. 生成 `robots.txt` + `sitemap.xml`(复用 data/ 产物,脚本化,随部署更新)。
3. 首页预渲染首屏插件卡片链接 + 详情页补 canonical/description/OG(静态页 + 现有 JS 的 document.title 同机制)。
4. logo 压缩转 WebP;`plugins.json` 开压缩(后续再考虑增量/分页)。
5. 双语 hreflang、JSON-LD、脚本 defer、README h1 降级等 P1/P2 项按节奏消化。
