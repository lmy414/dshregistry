# 插件形态研究:插件市场(多源)与插件中心(全生命周期)

> 状态:研究定稿(2026-08-16)。源码依据:deepseek-harness 本地 checkout(与 DESIGN.md 同一版本)。
> 结论:插件市场 = **可切换的多源浏览/安装入口**;插件中心 = **全生命周期管理**。两者一体化,共用同一数据契约与同一批 host API。

---

## 1. 形态定义(用户需求)

| 形态 | 定义 | 本质 |
|---|---|---|
| **插件市场** | 不绑定指定数据源,用户可**添加/切换插件源**;从当前源浏览、搜索、安装 | 获取入口(多源目录) |
| **插件中心** | 快速安装 + **便捷的全生命周期管理**(安装/卸载/启停/对账/状态) | 管理出口(全量清单) |

两者不是两个插件,是**同一插件的两个功能区**:市场负责"装进来",中心负责"管起来"。安装动作同时作用于两区(装完自动出现在中心清单)。

---

## 2. 形态一:插件市场 —— 多源抽象

### 2.1 为什么源 = 静态 JSON 端点

现状实现把 `registryBaseUrl` 写死为单一配置(即"带指定数据源")。要支持用户切换源,先把"源"抽象成统一契约。沿用 DESIGN.md 的架构原则(无后端/无数据库/Git 数据层),一个**插件源** = 任意提供以下静态文件的 URL 根:

```
<sourceBaseUrl>/
├── data/plugins.json      # 插件索引数组(契约见 §2.2)
├── data/blocklist.json    # 黑名单 { blocked: [slug...], updatedAt }
├── data/meta.json         # 统计 { pluginCount, categoryCount, updatedAt, ... }
└── data/readme/<slug>.html  # 可选:预渲染 README 详情(readmeUrl 指向)
```

- **零门槛**:GitHub Pages / Caddy 静态目录 / 任何静态托管都能成为源 → 用户可自建私有源、第三方可运营独立源
- **可审计**:dshregistry 本身就是 Git 数据层,其他源同样可以是仓库,历史可查
- **无攻击面**:源只有出站 fetch,无入站 API

### 2.2 源数据契约(已从 web/data/plugins.json 实测确认)

```jsonc
{
  "slug": "dsh-vision",                 // 安装用 id(patch insert 行的 id)
  "name": "dsh-vision",                 // npm 包名(patch insert 行的 name)
  "version": "0.1.0",
  "repo": "lmy414/dsh-vision",
  "githubUrl": "https://github.com/lmy414/dsh-vision",
  "description": "...",
  "category": "vision",                 // tool/vision/dashboard/bridge/launcher/mcp/skill/other
  "tags": ["vision", "llm"],
  "stars": 12, "forks": 3,
  "pushedAt": "2026-08-10",             // 排序用
  "firstSeenAt": "2026-08-15",
  "latestCommit": "9f3a...",
  "installSpec": "github:lmy414/dsh-vision#9f3a...",  // 安装目标(白名单校验)
  "releaseAssetUrl": null,
  "readmeUrl": "data/readme/dsh-vision.html",         // 相对源根解析
  "license": "MIT",
  "authorCreatedAt": "...",
  "state": "unreviewed" | "community" | "flagged",     // 三态
  "stateReasons": ["..."],
  "basicCheck": true
}
```

字段缺失容错:host 侧做运行时校验,缺关键字段( slug/name/installSpec )的条目丢弃并计数,其余字段给默认值。

### 2.3 源管理能力

| 能力 | 行为 |
|---|---|
| 内置默认源 | `https://dshregistry.xyz` 预置,标记 `builtin`,不可删除 |
| 添加源 | 输入 URL(仅 http/https)→ host 拉取校验契约(plugins.json 可解析且为数组)→ 存源列表;校验失败给出原因 |
| 删除源 | 非内置源可删;若为当前激活源则回落默认源 |
| 切换源 | 激活源影响:浏览列表、黑名单、安装反查(安装只从**激活源**的收录中反查 slug) |
| 独立缓存 | 每源独立内存缓存 + TTL(沿用现有 cacheTtlMs);切源不清其他源缓存 |
| 独立黑名单 | 每源的 blocklist.json 各自生效;跨源 slug 不互斥 |
| 源健康信息 | 每源:插件数 / 更新时间 / 最近错误(错误源显示重试) |

### 2.4 源存储与配置

- 源列表持久化在 `$DSH_HOME/dsh-marketplace/sources.json`(与 install.log 同目录,host 半原子写)
- 安装来源记录持久化在 `$DSH_HOME/dsh-marketplace/installs.json`(`{ slug, name, spec, sourceId, installedAt }[]`,与 sources.json 同目录,原子写;卸载时保留为历史)
- 向后兼容:`config.registryBaseUrl` 存在且 sources.json 不存在 → 视为单源(默认源 = 该 URL),升级不破坏现状
- 激活源 id 存同一文件;`GET /api/sources` 返回源列表 + 激活源 + 各源健康

### 2.5 安全边界(多源引入的新信任面)

> **源 = 信任边界**。源只提供索引,但 installSpec 由源给出,指向任意 GitHub 仓库。添加自定义源 = 信任该源的收录与安装命令。

- UI 硬性提示:添加源时警告"自定义源未经审计,其收录插件的安装命令可能指向恶意仓库,请只添加你信任的源"
- installSpec 白名单**不变**(仅 GitHub 源),源无法绕过
- 激活源黑名单在安装时强制校验(现有逻辑保留)
- 源 URL 仅 http/https;host 侧不跟随重定向到非 http(s) 协议

---

## 3. 形态二:插件中心 —— 全生命周期管理

### 3.1 全量清单:四源分类(机制全部源码核实)

| 来源 | 识别方式 | 数据位置 |
|---|---|---|
| **内置** | `dsh.profile.bundles` ∩ 模板白名单(web = dsh-base + dsh-web-app) | profile `package.json` |
| **外部** | bundles − 模板白名单,且在 dependencies 中 | profile `package.json` |
| **市场** | profile `cordis.patch.yml` insert 行(id = slug,本插件写入) | profile `cordis.patch.yml` |
| **动态** | `ctx.dynamicCordisRunner.snapshot(agent)` → pluginId/currentPackageId/activeRun/packages | host 服务(cordis-host-runner),会话级 |

清单来源(核实):
- 官方 `pluginInventory` 服务(`@deepseek-ai/dsh-host-plugin-inventory`):每次调用读 `ctx.loader.entries()`,返回 `{ id, moduleName, enabled, fiberPhase }`(active/failed/pending…)
- host 半**直接注入 `loader` 服务**(官方 gateway 同款做法):`ctx.loader.entries()` 遍历 `{ id, options.name, options.group, disabled, fiber }`,跳过 group 行;与 profile 文件做四源交叉匹配
- 动态插件:host 半经 `ctx.agents.currentInitiator()` 拿 agent 后调 `dynamicCordisRunner.snapshot(agent)`;拿不到 agent 时降级为只显示存在性提示

### 3.2 来源标注(每个插件标注"从哪个源进来的")

每个已安装条目同时携带**两级来源信息**:

| 层级 | 内容 | 例子 |
|---|---|---|
| 来源分类 | 内置 / 外部 / 市场 / 动态(§3.1) | `市场` |
| **具体源** | 市场类条目:安装时来自哪个插件源(id + 名称 + URL) | `源: dshregistry.xyz` / `源: 公司私有源` |

- **记录机制**:安装时 host 把 `{ slug, name, spec, sourceId, installedAt }` 追加写入 `$DSH_HOME/dsh-marketplace/installs.json`(与 sources.json 同目录,原子写)。**不能**把源信息塞进 patch insert 行(loader 会把行当配置 schema 校验,多余字段可能失败)。
- **对账合并**:中心清单把 patch insert 行 × installs.json 交叉;patch 行存在但无安装记录(升级前装的)→ 源标注 `未知源(升级前安装)`;installs.json 有记录但 patch 行已删(已卸载)→ 保留为历史(不展示或标记"已卸载")。
- **展示位置**:
  - 中心清单每行:来源分类徽章旁追加源名徽章(市场类);内置/外部/动态显示其来源说明(内置 / dsh plugin add / 会话动态)
  - 市场安装确认框:标注"安装自 &lt;源名&gt;"
  - 卸载确认框:回显"将从 &lt;源&gt; 卸载"
- **未知源的处理**:补一个"标记来源"入口(可选):用户在中心把未知源条目手动关联到某个源,host 写 installs.json。
- **多源聚合浏览(未来)**:若市场从"切换模式"演进为"聚合模式"(一次浏览全部源),每张市场卡片同样标注源徽章;切换模式下由源切换器提供上下文。

### 3.3 生命周期操作矩阵(机制全部核实)

| 操作 | 机制(源码依据) | 适用来源 | 热生效 |
|---|---|---|---|
| **安装** | `pnpm add <installSpec>` + 原子追加 patch insert 行 → `watchUserPatches` 热挂载 | 市场 | ✅ 无需重启 |
| **卸载** | 原子删除 patch insert 行(热卸载)→ `pnpm remove` 清理 | 市场(可扩展外部) | ✅ |
| **启用/停用** | 写/删 patch **id-targeted disabled 行**(`- id: <entryId>` + `disabled: true|false`)→ loader 以 `fiber.entry.disabled` 决定加载 → 配置热更契约立即生效 | 内置/外部/市场 | ✅ |
| **更新** | ⚠️ 待实验:loader 模块缓存,版本更新不保证热生效(DESIGN.md §8);候选 = 移除再插入 / 提示重启 | 市场/外部 | ⚠️ 实验项 |
| **对账** | profile package.json(dependencies/bundles)+ patch insert 行 + loader entries 三源交叉 | 全部 | — |
| **动态插件** | 只读展示 + 提示"会话内用 cordis 工具管理"(不抢工具职责) | 动态 | — |

### 3.3 启停的实现要点

- 与卸载解耦:停用只写 disabled 行,保留依赖与 insert 行;恢复 = 删行或改 `disabled: false`
- 与安装共用同一原子写 + 互斥锁路径(现有 withMutationLock 扩展)
- 内置/核心行停用需二次确认 + 提示"可能影响依赖它的功能"(Cordis 注入模型:停 provider 行 → 依赖行进 waiting)
- 市场插件的 insert 行与 disabled 行可共存于 patch 顶层数组(loader 按行合并配置,`- id: hmr / disabled: false` 为既有实证)

---

## 4. 整体形态:一个插件,两区一体

### 4.1 UI 布局(设置页)

```
┌ 设置页「插件」区(settings.plugins.tab,与官方只读清单 tab 并列)┐
│  tab: 官方「已安装」 | ★「插件中心」(本插件)                   │
│                                                                │
│  插件中心 tab:                                                 │
│  ┌ ① 已安装(全生命周期,按来源分组可折叠)─────────────────┐     │
│  │  内置: dsh-base / dsh-web-app            [停用]        │     │
│  │  外部: dsh-vision / dsh-dashboard        [停用]        │     │
│  │  市场: (本插件安装的)                     [停用][卸载]  │     │
│  │  动态: dyn-3(当前会话)                    [只读+提示]   │     │
│  │  每行: 来源徽章 · 运行状态(fiberPhase)· 启停开关        │     │
│  ├ ② 市场(多源)──────────────────────────────────────────┤     │
│  │  源切换器: [默认源 ▾] [+ 添加源]                        │     │
│  │  搜索框 + 分类 chips + 排序(已有实现)                   │     │
│  │  卡片: 三态徽章/描述/stars/更新时间/[安装(热)]           │     │
│  │  安装确认: 未审计红字声明 + 勾选(已有)+ 标注"安装自 <源>"│     │
│  └──────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 数据流闭环

```
市场区:切源 → 浏览 → 安装(slug + 激活源)
              │ pnpm add + patch insert(热)
              ▼
中心区:市场分组出现该行(对账)/ 可停用 / 可卸载
              │ patch 操作(热)
              ▼
任何来源的启停/卸载 → loader/依赖即时变化 → 中心区刷新
```

### 4.3 API 面(host 半扩展,基于现有 /dsh-marketplace/api)

| 接口 | 方法 | 说明 |
|---|---|---|
| `/sources` | GET | 源列表 + 激活源 + 各源健康(插件数/更新时间/错误) |
| `/sources` | POST | `{ url, name? }` 添加源(校验契约) |
| `/sources/active` | POST | `{ id }` 切换激活源 |
| `/sources/:id` | DELETE | 删除非内置源 |
| `/registry` | GET | 激活源数据(现有,扩展为按激活源取) |
| `/installed` | GET | 现有对账(扩展四源分类 + disabled 状态 + **source 标注**) |
| `/install` | POST | 现有(扩展:仅激活源反查;标注源;写 installs.json) |
| `/uninstall` | POST | 现有(修复 id/name bug;回显源名) |
| `/enable` `/disable` | POST | `{ id }` 写/删 disabled 行(热生效) |
| `/inventory` | GET | 四源清单 + loader 状态(fiberPhase)+ **每行 source 标注** |

---

## 5. 与现有实现(v0.1.0)的差距清单

| # | 改造点 | 现状 | 目标 |
|---|---|---|---|
| 1 | **多源抽象** | 单 `registryBaseUrl` 配置 | 源列表 + 切换 + 添加/删除 + 独立缓存/黑名单 |
| 2 | **四源清单** | 只对账 patch 行 | 内置/外部/市场/动态四源分类 |
| 3 | **启停** | 无 | patch disabled 行,热生效 |
| 4 | **loader/inventory 集成** | 无 | host 注入 `loader` 读 entries;动态插件 snapshot 只读展示 |
| 5 | **挂载点** | `settings.section` 独立页 | `settings.plugins.tab`(与官方清单并列)或保留独立页含两区 |
| 6 | **P0 修复** | 卸载 id/name bug;CSS 用不存在的 token | 统一 id;迁移 `--dsw-alias-*` token |
| 7 | **源信任提示** | 无 | 添加源警告 + 安装标注源名 |
| 8 | **来源标注** | 无 | installs.json 记录来源;中心清单每行显示来源分类 + 具体源;未知源兼容 |

## 6. 待实验/风险项(实施前验证)

1. **disabled 行与 insert 行共存**的 loader 合并语义(写一个临时 patch 行实测)
2. **更新机制**:loader 模块缓存是否允许"同 id 换版本热生效"(大概率否 → 移除再插入/提示重启)
3. **动态插件 agent 桥接**:host 半拿 agent 的可靠途径(`agents.currentInitiator()`)与降级路径
4. **多源 URL 校验**:SSRF 面(仅 http/https + 校验失败原因透出)
5. **双挂载风险**:bundle 层 + 用户层同 id 行的语义(README 配置示例需澄清)

## 7. 建议里程碑

| 阶段 | 内容 | 验证点 |
|---|---|---|
| A | P0 修复(卸载 id、CSS token)+ 现有单测回归 | 9/9+ 通过 |
| B | 多源:host 源管理 API + 独立缓存/黑名单 + client 源切换 UI | 两个 mock 源可切换、安装反查按激活源 |
| C | 中心:四源清单 + **来源标注(installs.json)** + loader 集成 + 启停 + 动态只读 + `/inventory` | 内置/外部/市场/动态分组正确,每行显示来源分类+具体源,启停热生效 |
| D | 挂载点迁移 `settings.plugins.tab` + 文档修订 + 发布自测 | 与官方清单 tab 并列;README 更新 |
