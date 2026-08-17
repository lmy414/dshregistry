# Spike 决策记录:网页源抓取形态(2026-08-17)

> 结论先行:两个网页源都不需要浏览器渲染。M-A 网页抓取层 = CheerioCrawler;Playwright 不安装,留给未来 SPA 源。

## 侦察事实(均实测)

| 问题 | 结论 | 证据 |
|---|---|---|
| dshfind SSR 还是 SPA | **SSR**(Next.js) | 详情页 HTML 含完整评分/徽章/JSON-LD,101KB 直出 |
| dshfind 全量 URL 枚举 | **sitemap.xml**(16.8MB,22756 URL) | robots.txt 声明 Sitemap;详情页模式 `/zh/plugins/<owner>/<name>` |
| dshfind robots | `Allow: /`,禁 `/api/`、`/*/login`、`/*/unauthorized` | robots.txt 原文 |
| dshfind 评分锚点 | `span[title="综合评分"]` 文本如 `B57` | 详情页实测 |
| dshfind 实体解析 | JSON-LD `SoftwareSourceCode.codeRepository` | 详情页内嵌 JSON-LD |
| dshfind 统计卡 | `近 7 天增长` 卡:主数字=总 stars,绿色 span=7 天增长 | 详情页实测(语义待首轮真站核对) |
| DSH Hub 形态 | 静态站 + **catalog.json**(schema `dsh-hub-index/v0.4`,680 包) | 首页直接链接;`packages[].repository` 给 GitHub URL |
| Hub 每包页面锚点 | 无(projects.html 为 JS 渲染容器) | 静态 HTML 无 per-package 锚点 → listedOn.url 统一用 projects.html |
| Crawlee 断点续跑 | 同 storageDir 重跑,已成功 URL 不重复抓取 | tools/tests/crawler.test.mjs |
| per-domain 限速 | Crawlee 无内置,makeGate 包装生效 | 同上 |
| Actions 配额 | 公开仓免费不限时(2000 分钟/月限制仅私有仓) | api.github.com/repos/lmy414/dshregistry `"private": false` |

## 决策

1. dshfind 适配器 = sitemap 发现 + Cheerio 详情抽取;DSH Hub 适配器 = catalog.json 纯 JSON(不经 Crawlee)。
2. Playwright 不安装;新 SPA 源接入时再议。
3. 爬虫主执行地 = GitHub Actions(workflow 见 Task 11);服务器 sync.sh 保留为回退。
