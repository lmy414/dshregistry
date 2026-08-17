# DSH-Registry 搜索引擎形态设计(索引优先)

> 状态:M-A 已实施(2026-08-17),UI 原型见 `docs/ui-prototype/index.html`。
> 定位:**做索引,不做市场**——本站在生态中的角色是"DSH 生态的谷歌":抓取、索引、检索;安装只是附带的。

## 0. 方案总览(2026-08-17,站长审查版)

> 本节是全文方案的独立汇总,按"抓什么 → 怎么处理 → 怎么评信任 → 网页什么样 → 数据什么样 → 怎么分发 → 蜘蛛怎么跑 → 服务器怎么扛"八问定案,供单独审查;细节见各对应章节。

### 0.1 抓什么数据

- 白名单三源:**GitHub**(topic 扫描 + seeds,增量 ≤300 新/轮)、**dshfind**、**DSH Hub**,加自站数据直接生成(不抓)。
- 统一筛选:只收 `package.json` 声明 `dsh.bundle.patch` 的 DSH 插件;网页源只抽元数据 + 摘要(≤200 字),不复制全文。
- 新市场 = 新适配器 + 配置一行,不碰核心管道。

### 0.2 数据怎么处理

统一管道:抓取 → 结构化抽取(网页源;dshfind 额外抽评分/徽章/7 天 star 增长 → `external.dshfind`)→ 实体解析(网页源提取 GitHub 链接:命中已收录 → 合并加 `listedOn`;未命中 → 反哺回 GitHub 管道当候选)→ 归一化 → 信任判定 → 原子写 → git commit。README 走 marked + DOMPurify 消毒渲染。

### 0.3 信任度评级

- 三态:灰 未审计(默认)/ 蓝 社区认可(收录 ≥30 天、stars ≥20 或 forks ≥5、作者账号 ≥90 天、180 天内活跃,200★ 高牵引豁免作者年龄)/ 红 有风险报告(blocklist 或人工标记)。
- 自动计算 + `flags.json` 人工覆盖,**自动永不覆盖人工**。
- dshfind 评分是独立体系,只进 `external` 展示,**不参与本站信任判定**,两套互不干扰。

### 0.4 网页样式

搜索引擎心智:首屏大搜索框;结果紧凑列表行(名称高亮/作者/分类/评分徽章/信任徽章);左侧 Facet 面板(来源/分类/信任/作者/Stars);右栏常驻(24h 热度榜 + 作者榜);精选答案位、零结果引导、查询联想、组合查询语法(`cat:`/`author:`/`stars:`/`src:`)。保留中英双语/明暗主题/响应式;详情页预渲染静态(无 JS 可读)+ JSON-LD。

### 0.5 数据结构

- `schemaVersion` 升 **1.1**,向后兼容。
- 单条文档:现有基础字段全保留(slug/name/repo/stars/pushedAt/installSpec/state…)+ `type`(plugin/page,未来 bundle)+ `source`(主渠道)+ `listedOn`(被哪些市场收录)+ `external.<source>`(富数据)。
- 不兼容变更开 `/api/v2/`,旧版保留至少一个大版本周期。

### 0.6 怎么分发给下游

- **静态 JSON = API,零后端**。小文件走自站 Nginx alias(`/api/*` + CORS 全开);大文件(全量索引、倒排索引)走 jsDelivr CDN。
- 配套:`changelog.json` 增量变更流(下游增量同步,不拉全量)、`search.json` 倒排索引(<3MB)、`docs/API.md` 契约文档(M-C 交付)。

### 0.7 蜘蛛怎么跑

- 混合三层:GitHub 源 = 自研 API 编排(保留现有 crawl.js 资产);网页源 = **Crawlee**(持久化队列断点续跑、robots.txt、CheerioCrawler/PlaywrightCrawler 两档渲染);抓取后管道(归一化/实体解析/信任/合并)全自研。
- 每个源跑**双流程**:增量 discover + 存量 refresh;refresh planner 按爬取状态(lastCheckedAt/lastChangedAt/unchangedRounds)调度,404/删除标记下架;未来加指数退避(2d→30d)与 GraphQL 批量刷新通道。
- 礼貌:UA `DSHRegistryBot/1.0`、per-domain 限速(makeGate 包装)、HTTPS-only 白名单。

### 0.8 1G 服务器怎么扛

- **重活挪走**:爬虫跑 GitHub Actions(定时 workflow + 断点续跑,产物 commit 回来)或本地开发机;服务器只做 `git pull` + Caddy 静态托管,常驻进程仅 ~50MB,Chromium 峰值内存与抓取出站流量不占服务器。
- **中间态收敛 SQLite 单文件**(爬虫状态层:队列/去重/爬取状态/star 快照),对外零后端原则不动摇;"轻量动态服务"不开放为对外 API,仅万级规模(M-D)时再议服务端只读检索。
- 回退预案:Actions 配额不够则低峰 cron + Cheerio 并发 ≤10 + Playwright 单实例,跑完即退不常驻。

### 0.9 执行顺序

1. **Spike**(半天):dshfind 适配器原型(~50 行),验证三件事——目标站 SSR 还是 SPA(决定 Cheerio/Playwright)、队列断点续跑、per-domain 限速包装 → **已完成**(2026-08-17,结论:SSR 用 Cheerio、Crawlee 持久队列断点续跑、makeGate 包装限速,落地于 §4.0);
2. **M-A 实施计划**:spike 结论出来后按 writing-plans 出详细计划(M-A = 混合架构 + 双流程 + 网页源适配器 + 多源标记 + 倒排索引) → **已完成**(2026-08-17,计划与任务台账见 `.superpowers/sdd/2026-08-17-search-engine-m-a/`);
3. 按计划实施 M-A → **已完成**(2026-08-17,数据侧全链交付:`pages.json`/`changelog.json`/`trending.json`/`search.json` 四个新产物 + GitHub Actions 定时爬虫 workflow + `tools/sync.sh` 回退链;前端消费在 M-B)。

## 1. 定位与心智

### 1.0 愿景与边界(站长定调 2026-08-17)

- **生态判断**:插件数量随 AI 时代指数级爆炸(生态全网已达万级),仍在野蛮生长期;插件市场会不断涌现,未来还会出现"整合包"等新形态。发现成本将超过安装成本。
- **使命三条**:
  1. **门户网站** — 让开发者/用户便捷检索到需要的插件;搜索引擎是用户心智,首屏是搜索不是卡片墙;
  2. **数据源头** — 把全网抓取的插件数据整理成清晰、可供任意下游(生态插件/工具)直接消费的数据源;
  3. **作者可见性** — 让作者的插件能被其他用户看到。
- **内容边界**:**只做 DSH 插件,插件无关内容(skills/MCP/教程等)一律不收**。"全生态"指插件的全网覆盖——任何市场、任何源冒出来的都收;整合包属于插件生态的延伸,未来纳入索引(文档模型预留 `type` 扩展点,见 §5.2)。

| 维度 | 市场心智(应用商店) | 索引心智(搜索引擎) |
|---|---|---|
| 页面主角 | 卡片墙 | 搜索框 |
| 结果形态 | 大卡片 | 紧凑列表行(名称/摘要/元数据) |
| 浏览方式 | 分类点选 | Faceted 筛选 + 查询语法 |
| 排序 | Stars/更新 | 相关度默认(BM25) |
| 反馈 | "找到 N 个插件" | "找到 N 个结果 · 用时 X ms" + 命中高亮 |
| 来源 | 单一(GitHub) | 多源聚合(GitHub/dshfind/DSH Hub) |

核心差异化:多源聚合(其他市场站也是被索引对象)+ 全量收录 + Git 数据层透明。

## 2. UI 设计(见原型)

- **搜索主场**:大搜索框 + 快捷分类,首屏是搜索不是卡片墙
- **结果列表行**:名称(高亮)+ by 作者 + 分类 + 评分徽章 + 徽章标签 + 信任徽章(置尾);
  meta 行:作者/stars/更新时间/来源;安装命令默认收起("安装 ›" 展开)
- **Facet 面板**(左):来源/分类(能力域 12 类)/信任状态/作者(组内搜索,Top-N+展开)/Stars
- **右侧栏**(常驻 sticky):🔥 24 小时热度(star 增长,默认 5 名可展开)+ 👤 作者榜(插件数,点击即搜 @作者)
- **搜索反馈**:结果统计 + 用时;排序(相关度/Stars/最近更新)
- **精选答案位**:相关度最高 + 社区认可 + 有评分 → 顶部蓝框"★ 精选"
- **零结果引导**:"你是不是想找"相关词 + 热门插件
- **查询联想**:输入即联想(名称/作者/标签/同义词);维度前缀(cat:/author:/stars:)列出可选值
- 移动端(<900px):右栏隐藏,Facet 收拢

## 3. 搜索架构

### 3.1 查询语法(组合搜索)

```
关键词  维度:值  维度:值 ...
示例: 视觉 cat:vision / 终端 stars:>500 / 记忆 author:mnemon-dev
      @liustack 视觉 / 记忆 src:dshfind / 视觉 score:S
```

维度:cat(分类)/author(@作者)/stars(下限)/state(信任)/src(来源)/score(dshfind 评分等级)。
语义:**原始词之间 AND,同义词集合内部 OR**;Facet 勾选与查询语法作用于同一过滤状态(AND)。

### 3.2 检索

- **同义词双向扩展**(中英):"看图"→vision,"memory"→记忆;扁平映射 FLAT 支持键/值互相触发
- **相关度**:字段命中权重(名称3/作者2/标签2/描述1,每查询组取最高)+ stars 归一 + dshfind 评分加成
- **倒排索引**(构建期):`search-index.json`,词→[docId, tf],中文 bigram + 英文词干;
  目标 <3MB(停用词、每词 ≤200 文档);前端懒加载 + 本地缓存
- 命中高亮:mark 标签包裹命中词

## 4. 蜘蛛与数据

### 4.0 蜘蛛形态(2026-08-17 定:混合架构 + 双流程模型)

**三层拆分**:① GitHub 源 = API 编排(配额/分片/jsDelivr/ls-remote/pkgCache),自研保留,不经框架;② 网页源 = 经典网页抓取,抓取层用 **Crawlee**(Apache-2.0,Node):持久化请求队列(断点续跑)、robots.txt、CheerioCrawler(SSR 站)/ PlaywrightCrawler(SPA 渲染站)——适配器 = router handler + 归一化函数;③ 抓取后管道(归一化/实体解析/信任/合并/原子写/commit)全自研。per-domain 限速 Crawlee 无内置,沿用 makeGate 模式包装。先行 spike:dshfind 适配器原型验证 SSR 形态 / 队列重启续跑 / 限速包装。

**双流程模型**:每个源跑两条流,统一为带标签的任务 `{ type: discover | refresh }`,进同一队列、同一管道:
- **增量流(discover)**:GitHub 按现有 created 倒序增量(≤300 新/轮);网页源列表页 URL 集 diff,只抓新增。
- **存量流(refresh)**:每轮由 refresh planner 读爬取状态(`tools/.cache/state-<source>.json`:lastCheckedAt / lastChangedAt / unchangedRounds)算出到期任务——GitHub 按 pushedAt 活跃窗口 + 长尾轮转,变化者走与新增相同的补全管道,**404/删除者标记下架**(changelog removed 流);网页源按固定窗口重抓(dshfind 评分随时间变),优先 ETag/条件请求,否则内容哈希比对。
- 预算:增量优先,存量吃剩余配额(GitHub 暂定 300 新 + 500 刷/轮;网页按周期切存量 1/N)。
- 状态字段 M-A 即埋;M-D 升级**自适应重抓**(未变指数退避 2d→30d,变化复位);GitHub 万级全量刷新切 **GraphQL 批量**(别名查 100 仓/次,独立 5000 点/时预算池,不占 REST 配额)。

### 4.1 多源聚合

| 源 | 方式 | 产物 |
|---|---|---|
| GitHub topic + seeds | 增量爬虫(已有) | 插件文档(元数据+README+stars 快照) |
| dshfind | 列表页发现 URL → 抓详情页 | 网页文档 + **结构化抽取** |
| DSH Hub | 目录页发现 URL → 抓项目页 | 网页文档 |
| 自站 /p/ | 数据直接生成(不抓) | 插件文档 |

- **源适配器 = 一等公民**:新市场会不断出现,"加一个新源" = 新写一个适配器 + 配置加一行,不碰核心管道;适配器契约三段:发现 URL → 抽取文档 → 归一化字段(名称/描述/URL/作者/分类/stars/更新时间)。
- 蜘蛛:任务队列持久化(断点续跑)+ 源适配器 + 并发池 + robots/UA/限速礼貌;
- 网页文档只存元数据+摘要(≤200 字),不复制全文;
- **结构化抽取(dshfind)**:综合评分(S 85)/四项明细/优质项目·内测用户徽章/评于日期/stars 7 天增长/贡献者
  → 合并进插件记录 `external.dshfind`,不参与本站信任判定(两套体系)
- **多源收录标记(listedOn)**:插件文档新增 `listedOn: [{ source, url, firstSeenAt }]`——被哪些市场/索引站收录(在场证明 + 外链,轻);`external.<source>` 仍是富数据(重,仅做了结构化抽取的源)。网页适配器从收录页提取 GitHub 仓库链接做实体解析:命中已有记录 → 追加 listedOn;未命中 → **反哺发现**(repo 候选进 GitHub 管道,与 seeds 同级;通过收录条件转正且 `source` 标记来源;不通过则网页文档独立留 pages.json,日后仓库被收录再合并转正)。搜索面:`src:` 维度与来源 facet 多值化(一插件可同属多源,计数可超总数);详情页展示"收录于"chips。多市场交叉收录暂不进信任模型(留作未来弱信号)。

### 4.2 热度榜(24h star 增长)

- crawl 时读上轮快照(`tools/.cache/star-snap.json`)对比 → `web/data/trending.json`(Top 20)
- 第一轮冷启动为空,两轮后出真实数据;前端右侧栏渲染

### 4.3 页面索引规范(自站页面 = 可索引文档)

- 详情页 JSON-LD(SoftwareApplication):name/desc/url/author/version/license/datePublished/dateModified
- 分类页分页:`/c/<cat>/<page>.html`(每页 60)+ 页码链接——全部详情页可链接到达
- 首页 JSON-LD(WebSite + SearchAction,已有);正文容器 `.readme-body` 固定
- 产物:预渲染 /p/(真预渲染,无 JS 可读)+ /c/,不入库(本地/服务器生成)

## 5. 数据 API(静态 JSON = API,零后端)

### 5.1 端点(双通道)

| 端点 | 内容 | 首选通道 |
|---|---|---|
| `/api/plugins.json` | 全量索引 | jsDelivr(CDN) |
| `/api/plugin/<slug>.json` | 单插件(含 external) | 自站 |
| `/api/by-cat/<cat>.json` | 分类子集 | 自站 |
| `/api/meta.json` | 统计 | 自站 |
| `/api/blocklist.json` | 黑名单 | 自站 |
| `/api/search.json` | 倒排索引 | jsDelivr |
| `/api/changelog.json` | 增量变更流(added/updated/removed) | 自站 |
| `/api/` | 目录文档(端点+版本+更新时间) | 自站 |

- 自站:`/api/*` → `web/data/*`(Nginx alias),实时
- jsDelivr:`cdn.jsdelivr.net/gh/lmy414/dshregistry@main/web/data/...`,免费 CDN 扛大文件
- 大文件走 CDN、小文件走自站 = 1GB 机器无压力(静态服务 + gzip + ETag/304 + changelog 增量)

### 5.2 契约(API 按正式产品交付,下游是真客户)

- 文档模型显式携带 `type` 字段(`plugin` / `page`;未来 `bundle` 收整合包)——v1 即带,新形态接入对下游零 breaking change
- 插件文档新增 `source`(主渠道:github-topic/seeds/issue/网页源反哺)与 `listedOn`(多源收录标记,见 §4.1)——增量字段,向后兼容,`schemaVersion` 升 1.1
- `plugins.json` 加 `schemaVersion`;不兼容变更开 `/api/v2/...`,旧版保留至少一个大版本周期并公布弃用时间表
- changelog 由每次 crawl 生成(机器可读变更流,下游增量同步)
- `docs/API.md`:端点清单、字段语义、示例、版本政策,随 M-C 交付

### 5.3 Nginx 配置

```nginx
location /api/ {
    alias /root/dshregistry/web/data/;
    default_type application/json;
    add_header Access-Control-Allow-Origin *;
    add_header Cache-Control "public, max-age=300";
    gzip on;
    gzip_types application/json;
    index off;
}
```

## 6. 实现路线

- **M-A 蜘蛛与索引**:混合架构落地(GitHub 自研保留 + 网页源接 Crawlee)+ 双流程(增量/存量 refresh planner)+ 网页源适配器(dshfind/DSH Hub)+ 多源标记与反哺 + 结构化抽取 + 倒排索引构建(search.json)
- **M-B 前端**:新 UI(原型落地)— 搜索/联想/组合语法/Facet/精选/零结果/双榜单;详情页 JSON-LD + external 区块 + "收录于"chips + 分类页分页
- **M-C API**:schemaVersion + changelog + docs/API.md + Nginx 配置交付
- **M-D 数据面**:trending 快照、能力域分类迁移(其他 48% → <25%)、新鲜度跟踪(已收录 commit 更新);**万级规模核算**(search.json 3MB 预算、by-cat 拆分粒度、plugins.json 体积与 CDN 策略随收录量重估;GitHub 存量刷新切 GraphQL 批量通道);自适应重抓(unchangedRounds 退避)

## 7. 边界(不变)

- 无后端/无数据库(静态 + Git 数据层)
- 网页文档只索引不复制,可安装判定只认插件文档
- 抓取源白名单制(当前:dshfind.com / hub.omdsh.dev / 自站;新市场以"适配器 + 配置"接入,见 §4.1);只收 DSH 插件及其生态页面,插件无关内容不收
- 信任三态与 dshfind 评分互不干扰

## 8. 服务器形态与轻量预算(站长构想 2026-08-17)

- **GitHub 同步存储(确认既有定案)**:数据层 = 公开 Git 仓库,服务器 pull 即线上;每次爬取 = 一次 commit + push,历史/备份/协作全在 GitHub。站点对外只有静态文件,无后端进程。
- **重活从服务器挪走(新定调,覆盖 DESIGN.md 的"服务器 cron 爬虫")**:爬虫执行地不在 VPS —— 定时跑在 **GitHub Actions**(workflow 定时触发 + 断点续跑,产物 commit 回来)或本地开发机,服务器只做 `git pull` + 静态托管。收益:1G 机器常驻进程仅 Caddy(~50MB);Chromium 渲染峰值内存与抓取出站流量不占服务器;服务器 IP 不暴露给目标站(反爬视角也干净)。
- **轻量动态服务存储(收敛为爬虫状态层)**:爬虫中间态(请求队列/去重/爬取状态/star 快照)从散落 JSON(`tools/.cache/`)收敛为 **SQLite 单文件**,随 CI 缓存或仓库版本化,可选迁移。写产物路径不变 —— 对外仍是静态 JSON = API,**零后端原则不动摇**;"轻量动态服务"不开放为对外 API;仅在数据量突破前端加载上限(万级评估,M-D)时再议服务端只读检索。
- **回退预案**:若 Actions 配额不够(2000 分钟/月)需回服务器跑,则低峰 cron + Cheerio 并发 ≤10 + Playwright 单实例低并发,跑完即退不常驻。
