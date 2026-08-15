# DSH-Registry

社区驱动的 DSH(DeepSeek Harness)插件索引站 · Community-driven plugin index for DeepSeek Harness.

- 站点:<https://dshregistry.xyz>(纯静态,无后端/无接口/无登录)
- 数据层 = 本 Git 仓库:`web/data/*.json` 由爬虫全量生成,每次变更一次 commit,历史可审计、可回滚、可 PR 协作
- 服务器(cron 每 6h):`git pull → node tools/crawl.js → 原子写 web/data/* → commit/push`

## 目录结构

```
dshregistry/
├── web/                # 静态门户(Caddy 服务根)
│   ├── index.html      #   插件市场(列表/搜索/分类/排序)
│   ├── plugin.html     #   详情页(?slug=,含完整 README 展示)
│   ├── about.html      #   关于与免责声明
│   ├── 404.html
│   ├── assets/         #   shared.js + page-*.js + logo
│   ├── i18n/           #   zh.json / en.json(界面双语,内容原文)
│   └── data/           #   索引产物(爬虫生成,提交进仓库)
│       ├── plugins.json    #   插件索引(全量,含 readmeUrl/firstSeenAt/license)
│       ├── blocklist.json  #   黑名单
│       ├── meta.json       #   统计条
│       └── readme/<slug>.html  # 预渲染+清洗后的 README 片段
├── tools/              # 爬虫与生成脚本(服务器执行)
├── config/             # 人工输入(版本化,可 PR)
│   ├── seeds.json      #   收录种子(社区提交通道)
│   └── flags.json      #   人工标记(拉黑/社区认可)
└── README.md
```

## 提交插件 Submit your plugin

> **收录不等于审计。** 合并 PR 仅表示进入索引,插件默认状态仍为「未审计 / Unreviewed」。

**方式一(推荐):PR 提交**

1. Fork 本仓库,在 `config/seeds.json` 追加一条:

   ```json
   { "repo": "owner/name", "category": "tool" }
   ```

   `category` 可选(`tool/vision/dashboard/bridge/launcher/mcp/skill/other`),缺省由爬虫推断。
2. 提交 PR,按模板填自查清单;站长审查合并后,服务器下次同步(≤6 小时)自动收录上线。
3. 确认你的仓库:`package.json` 声明 `dsh.bundle.patch`(收录必要条件)、有 README、有 LICENSE。

**方式二(被动)**:给仓库添加 `dsh-plugin` topic,并推荐在 `package.json` 声明 `dsh.registry` 元数据;爬虫每 6 小时扫描自动发现。

## 本地预览与爬虫

```bash
pnpm install                     # 安装爬虫依赖(marked / jsdom / dompurify)
pnpm serve                       # 本地预览 http://127.0.0.1:4815/
pnpm crawl                       # 增量收集(默认每轮最多 300 个新仓库)
```

爬虫环境变量:`GITHUB_TOKEN`(缺省读 `gh auth token`)、`CRAWL_MAX_NEW`(每轮上限)、`CRAWL_FULL=1`(全量重扫)、`CRAWL_SKIP_SEARCH=1`(仅跑 seeds,调试用)、`CRAWL_ONLY=<子串>`(定向单仓)。收录规则:声明 `dsh.bundle.patch` + 有 LICENSE + 有 README;缓存与已收录清单位于 `tools/.cache/`(不入库)。

## 信任模型

| 徽章 | 含义 |
|---|---|
| 未审计 Unreviewed | 默认状态,无任何背书 |
| 社区认可 Community-Vouched | stars ≥20 或 forks ≥5;作者账号 ≥90 天(stars ≥200 高牵引豁免);180 天内活跃;未被人工标记 |
| 有风险报告 Flagged | 命中黑名单或人工标记,不建议安装 |

人工标记维护在 `config/flags.json`(版本化),自动判定永不覆盖人工标记。

## 免责声明

本站收录的插件均未经人工安全审计,安装风险自负;本站与 DeepSeek 官方无隶属关系;插件在 DSH 主进程内运行、无沙箱隔离,安装即执行全部代码,请仅安装信任来源。

## License

MIT
