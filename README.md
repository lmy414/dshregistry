# DSH-Registry

DSH 生态的聚合检索平台 · Aggregated search platform for the DSH ecosystem.

自动扫描门户导航网站(dshfind、DSH Hub 等)以及 GitHub 上的 DSH 插件收录,提取元数据并建立倒排索引,方便快速检索与发现。本站定位是「检索优先」——只存元数据(名称、描述、作者、Stars 等),不镜像任何插件代码。

- 站点:<https://dshregistry.xyz>(纯静态,无后端/无接口/无登录)
- 数据层 = 本 Git 仓库:`web/data/*.json` 由爬虫全量生成,每次变更一次 commit,历史可审计、可回滚、可 PR 协作
- 服务器(cron 每 6h):`git pull → 爬虫链 → 原子写 web/data/* → commit/push`

## 目录结构

```
dshregistry/
├── web/                # 静态门户(Caddy 服务根)
│   ├── index.html      #   聚合检索主页(大搜索框 + 精选 + 三榜)
│   ├── category.html   #   分类搜索页(12 能力域 Facet + 查询语法)
│   ├── plugin.html     #   详情页模板(收录于/外部数据/风险说明)
│   ├── docs.html       #   文档页(关于/透明度声明/提交/API/资源/友链)
│   ├── stickers.html   #   周边页(鲸鱼娘素材下载)
│   ├── about.html      #   关于与免责声明(旧版)
│   ├── 404.html
│   ├── assets/         #   shared.js + page-*.js + mascot/(鲸鱼娘贴纸)
│   ├── i18n/           #   zh.json / en.json(界面双语,内容原文)
│   └── data/           #   索引产物(爬虫生成,提交进仓库)
│       ├── plugins.json    #   插件索引(全量,type/source/listedOn/external)
│       ├── search.json     #   倒排索引(前端检索)
│       ├── changelog.json  #   增量变更流(added/updated/removed)
│       ├── trending.json   #   24h star 增长榜
│       ├── pages.json      #   网页文档(未转正的收录页,只索引不安装)
│       ├── blocklist.json  #   黑名单
│       ├── meta.json       #   统计(schemaVersion 1.1)
│       ├── plugin/<slug>.json  # 单插件数据
│       ├── by-cat/<cat>.json   # 分类子集(12 能力域)
│       └── readme/<slug>.html  # 预渲染+清洗后的 README 片段
├── tools/              # 爬虫与生成脚本(服务器执行)
│   ├── crawl.js        #   GitHub 源(增量 discover + 存量 refresh + 404 下架)
│   ├── crawl-web.js    #   网页源(dshfind sitemap + hub api/v1,跨源去重)
│   ├── reclassify.js   #   12 能力域重分类
│   ├── build-search-index.js  # 倒排索引构建
│   └── prerender.js    #   /p/ 详情页 + /c/ 分类页静态预渲染
├── config/             # 人工输入(版本化,可 PR)
│   ├── seeds.json      #   收录种子(社区提交通道)
│   ├── flags.json      #   人工标记(拉黑/维护活跃)
│   └── categories.json #   12 类人工覆盖表(owner/repo → 分类)
└── README.md
```

## 提交插件 Submit your plugin

> **收录不等于审计。** 收录仅表示进入索引,插件默认状态为「未审计 / Unreviewed」。

**方式一(推荐):提 Issue,无需 fork**

1. 打开 [收录提交表单](https://github.com/lmy414/dshregistry/issues/new?template=plugin-submission.yml),填入你的仓库地址(`owner/name`)。
2. 确认仓库:`package.json` 声明 `dsh.bundle.patch`(收录必要条件)、有 README、有 LICENSE。
3. 站长审核合入 `config/seeds.json` 后,服务器下次同步(≤6 小时)自动收录上线。

**方式二(被动)**:给仓库添加 `dsh-plugin` topic,并推荐在 `package.json` 声明 `dsh.registry` 元数据;爬虫每 6 小时扫描自动发现。

## Git 协作约定

> **主干 `main` 只接受功能性改动**;服务器端(运维 AI)的一切改动只提交分支,数据同步同样走分支。

| 通道 | 内容 | 分支 |
|---|---|---|
| **功能性改动** | 新功能、修复、文档、配置调整 | 直接提交 `main`(或经 PR review 合并) |
| **服务器端改动** | 运维 AI 的脚本调整、部署配置 | 只在分支提交,经确认后合并主干 |
| **数据同步** | 爬虫产物 `web/data/*.json`、`web/sitemap.xml` | 跟随服务器工作区当前分支,不直接推主干 |

**服务器端纪律**:
- 服务器工作区(git)所在分支即线上站点数据源;`sync.sh` 自动跟随当前分支执行 `pull → crawl → 生成 sitemap → commit → push`
- 服务器端**禁止**直接向 `main` push 数据/运维改动;如需上线分支内容,由人工 review 后合并
- 运维提交使用独立身份 `hermes-ops <hermes-ops@dshregistry.xyz>`,与开发者提交区分
- 禁止 `force-push`、改写已推送历史;本地与远端分叉时使用 `pull --rebase` 保持线性历史

## 本地预览与爬虫

```bash
pnpm install                     # 安装爬虫依赖(crawlee / cheerio / marked 等)
pnpm serve                       # 本地预览 http://127.0.0.1:4815/
pnpm crawl                       # GitHub 源增量收集(每轮 ≤300 新仓库)
pnpm crawl:web                   # 网页源(dshfind / DSH Hub)
```

生成静态产物(爬虫后执行):

```bash
node tools/gen-sitemap.js          # sitemap.xml(入库)
node tools/build-search-index.js   # web/data/search.json 倒排索引(入库)
node tools/split-data.js           # web/data/plugin/<slug>.json + by-cat/(入库)
node tools/prerender.js            # web/p/<slug>.html 详情页 + web/c/<cat>.html 分类页(不入库)
```

爬虫环境变量:`GITHUB_TOKEN`(缺省读 `gh auth token`)、`CRAWL_MAX_NEW`(每轮上限)、`CRAWL_FULL=1`(全量重扫)、`CRAWL_SKIP_SEARCH=1`(仅跑 seeds,调试用)、`CRAWL_ONLY=<子串>`(定向单仓)、`DSH_WEB_MAX`(网页源单轮上限)。收录规则:声明 `dsh.bundle.patch` + 有 LICENSE + 有 README;缓存与已收录清单位于 `tools/.cache/`(不入库)。服务器定时同步见 `tools/sync.sh`(爬虫 → 网页源 → sitemap → 索引 → 拆分 → 预渲染 → 提交推送,分支跟随 + 飞书告警)。

## 信任模型

| 徽章 | 含义 |
|---|---|
| 未审计 Unreviewed | 默认状态,无任何背书 |
| 维护活跃 Actively Maintained | 近期项目维护活跃:stars ≥20 或 forks ≥5;作者账号 ≥90 天(stars ≥200 高牵引豁免);180 天内活跃;未被人工标记 |
| 有风险报告 Flagged | 命中黑名单或人工标记,不建议安装 |

人工标记维护在 `config/flags.json`(版本化),自动判定永不覆盖人工标记。信任三态仅表达活跃/风险信号,**不构成任何认证**。

## 透明度声明

本站遵循服务透明度声明(详见 [docs.html](https://dshregistry.xyz/docs.html)「服务透明度声明」):运营者 Mirror 个人项目;仅收录公开元数据;接入百度统计仅用于维护优化参考;爬虫带 UA `DSHRegistryBot/1.0` 并限速,只访问 robots 允许路径;排序无赞助无推广;数据以 JSON 公开可导出。本声明只定义透明度,不构成安全认证。

## 免责声明

本站收录的插件均未经人工安全审计,安装风险自负;本站与 DeepSeek 官方无隶属关系;插件在 DSH 主进程内运行、无沙箱隔离,安装即执行全部代码,请仅安装信任来源。

## License

MIT
