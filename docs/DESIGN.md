# dsh-marketplace 设计文档(定稿 v8):Git 数据层 + 服务器托管 + DSH 插件端 + 飞书运维

> 状态:设计定稿(2026-08-16)。源码依据:deepseek-harness rc.5 本地 checkout。
> 交付物:① **静态门户站**(中英双语);② **DSH 插件端**(安装 + 安全提示)。
> 架构原则:**公网只暴露静态网页(自建服务器 Caddy);数据层 = Git 仓库(网页 + 数据 + 脚本全版本化,每次变更即 commit/push);服务器定时与 GitHub 双向同步;运维通过飞书指挥服务器上的运维 AI;无 HTTP API、无后端服务、无数据库。**

---

## 1. 最终架构

```
┌─ GitHub 仓库 dshregistry(公开,数据层 + 版本历史 + 备份) ───────┐
│  web/          index.html · app.js · style.css · i18n/zh+en.json │
│  web/data/     plugins.json · blocklist.json · meta.json(产物)   │
│  tools/        crawl.js(爬虫)                                    │
│  config/       seeds.json(收录种子)· flags.json(人工标记)        │
│  README.md                                                       │
└───────────┬───────────────────────────────────────────────────┘
            │ 定时双向同步(git pull / commit / push)
            │
┌───────────▼───────────────────────────────────────────────────┐
│ VPS(阿里云香港,免备案)                                          │
│  ~/dshregistry/   # git 工作区(clone 自 GitHub)                 │
│    web/           # ★ Caddy 直接服务此目录(公网唯一暴露)        │
│      data/*.json  #   爬虫原子写;.git 等敏感路径 Caddy 屏蔽      │
│    tools/ · config/                                            │
│  cron 每 6h: git pull → node tools/crawl.js                    │
│              → 原子写 web/data/* → git commit/push(留痕)       │
│  运维 AI(DSH agent,飞书接入):git 操作 · 改 flags/seeds · 日志   │
└────────────────────────────────────────────────────────────────┘
        │ https://dshregistry.xyz/  (仅静态,Caddy + 自动 HTTPS)
        ├──────────────────┬──────────────────────────┐
        ▼                  ▼                          ▼
  静态门户站(浏览器)      DSH 插件端             GitHub 上游
  中英双语                fetch /data/plugins.json   (安装源,不经注册中心)
  浏览/分类/搜索/详情      + /data/blocklist.json     github:<owner>/<repo>#<commit>
  安装命令/跳转 GitHub    安装(热)/卸载/对账
                         安全提示 + 风险解释
```

**数据怎么存(回答核心问题)**:没有数据库,没有后端服务 —— **数据层就是公开的 Git 仓库**。`web/data/*.json` 由爬虫全量重写(原子写),每次变更 = 一次 commit + push,天然获得:版本历史(可 diff/回滚)、备份(服务器挂掉 clone 即恢复)、透明度(社区可审计)、将来可 PR 协作(提交新插件/修分类)。数据量(几十个插件 < 1MB)和变更频率(6h)完全在 Git 的舒适区。

**定时同步(服务器 ↔ GitHub)**:
- 下行:`git pull`(cron 与运维 AI 手动均可)—— 拉取远端 flags/seeds/他人 PR 合并内容
- 上行:爬虫写完数据后 `commit + push` —— 每次变更留痕
- **服务即工作区**:Caddy 直接服务 `~/dshregistry/web/`,pull 即更新线上,无二次拷贝、无同步延迟;`data/` 由爬虫原子写(临时文件 + rename),线上不会读到半成品

## 2. 数据层:Git 仓库设计

### 2.1 仓库结构

```
dshregistry/                    # 公开仓库
├── web/                        # 网页源码(静态,Caddy 服务根)
│   ├── index.html · plugin.html · about.html
│   ├── app.js · style.css
│   ├── i18n/zh.json · i18n/en.json
│   └── data/                   # ★ 数据产物(爬虫生成,提交进仓库)
│       ├── plugins.json        #   插件索引(全量)
│       ├── blocklist.json      #   黑名单
│       └── meta.json           #   统计条(收录数/分类数/更新时间)
├── tools/
│   └── crawl.js                # 爬虫脚本(服务器执行)
├── config/                     # ★ 人工输入(也版本化,可 PR)
│   ├── seeds.json              #   种子仓库列表(手动收录通道)
│   └── flags.json              #   人工标记覆盖(拉黑/社区认可)
└── README.md                   # 项目说明 + 如何提交插件
```

### 2.2 同步工作流(每次新增内容 → Git)

```
cron(每 6h,服务器):
  git pull                                        # 拿最新 flags/seeds
  → node tools/crawl.js                           # 扫 topic + seeds,全量生成
  → 原子写 web/data/{plugins,blocklist,meta}.json
  → git add + commit "crawl: +2/-1, 收录 12 个"    # 留痕
  → git push                                       # 线上即工作区,push 后无需部署

人工(经飞书运维 AI):
  "把 dsh-xxx 拉黑" → 改 config/flags.json → commit → push
  → 下次爬虫读取 flags,重生成 → 插件端拒绝安装
  "加个种子 dsh-xxx" → 改 config/seeds.json → 同上
```

- **提交规范**:每次爬取一条 commit,message 带统计(`crawl: +2/-1`),历史可审计。
- **原子性**:先写临时文件再 rename;commit 失败不影响线上(上一次产物仍在)。
- **GitHub 即备份**:服务器挂掉,数据在仓库;重装服务器 = clone 仓库 + 装 Node + 配 Caddy。
- **定时同步节奏**:cron 每 6h 一个脚本完成 pull → crawl → push;push 后无需额外部署(服务的就是这个工作区);远端他人 PR 内容由下一次 pull 拉入。

### 2.3 托管:自建服务器 Caddy(定案)

- Caddy 直接服务 git 工作区的 `web/` 目录(`root ~/dshregistry/web`),自动 HTTPS;域名 `dshregistry.xyz` 的 A 记录指向 VPS IP。
- **Caddy 安全配置(必须)**:屏蔽 `.git`、`tools/`、`config/` 等非公开路径(返回 404);`data/` 正常公开,加 `Access-Control-Allow-Origin: *`(插件端 fetch 依赖)。
- 收益:push 即线上(服务即工作区,无二次拷贝);数据仍全量在 GitHub(历史/备份/协作);服务器公网只开 80/443 给 Caddy,无 API、无攻击面。

## 3. 运维闭环(飞书 → 运维 AI)

用户不碰服务器;所有运维动作通过飞书消息指挥运维 AI,由它在本机执行:

| 用户飞书指令(示例) | 运维 AI 执行 | 依据 |
|---|---|---|
| "跑一次爬虫" | `node tools/crawl.js --now`(含 commit/push) | 日志回报结果 |
| "看下爬虫日志" | `tail -100 logs/crawl.log` | 排障 |
| "把 dsh-xxx 拉黑" | 改 config/flags.json → commit → push → 重跑 | 重生成产物 |
| "标记 dsh-xxx 为社区认可" | 改 config/flags.json → commit → push | 覆盖自动判定 |
| "看下仓库状态" | `git log --oneline -5` / `git status` | 数据留痕 |
| "服务器状态" | `systemctl` / 磁盘 / 内存 | 常规运维 |

- **身份与边界**:能执行这些的只有服务器本机(运维 AI 进程),不存在任何远程入口。
- **黑名单维护**:v1 无在线举报(不做);恶意插件由站长/运维 AI 主动发现 → 飞书确认 → flags.json → 重跑 → 插件端拒绝安装。后续 Discord 社区开放后,反馈经飞书人工记录进同一流程。
- cron 定时爬取独立于飞书,异常时运维 AI 可从日志发现并主动汇报。

## 4. 数据契约(web/data/*,两端共享)

`plugins.json`(爬虫全量生成,原子写;无运行期写接口):

```json
{
  "slug": "dsh-vision",
  "name": "dsh-vision",
  "version": "0.1.0",
  "repo": "lmy414/dsh-vision",
  "githubUrl": "https://github.com/lmy414/dsh-vision",
  "description": "视觉辅助:为无原生视觉模型补齐看图能力",
  "category": "vision",
  "tags": ["vision", "llm", "tool"],
  "stars": 12,
  "forks": 3,
  "pushedAt": "2026-08-10",
  "latestCommit": "9f3a...",
  "installSpec": "github:lmy414/dsh-vision#9f3a...",
  "releaseAssetUrl": null,
  "state": "unreviewed" | "community" | "flagged",
  "stateReasons": ["收录 45 天", "stars 12", "作者账号 1 年", "未被人工标记"],
  "basicCheck": true
}
```

- 分类:优先 `dsh.registry.category`,缺失则关键词推断(tool/vision/dashboard/bridge/launcher/mcp/skill/…)
- 收录条件:`package.json` 声明 `dsh.bundle.patch`(或提供安装 spec);来源 = topic:dsh-plugin 扫描 + config/seeds.json 手动收录
- 安装 spec 直连 GitHub:`github:<owner>/<repo>#<commit>`(可复现);检测到 Release tgz 资产则优先展示 URL 形式
- `blocklist.json`:`{ "blocked": ["dsh-xxx"], "updatedAt": "..." }`
- `meta.json`:收录数 / 分类数 / 数据更新时间

## 5. 信任模型与三态标记(生成时计算,可被 flags.json 覆盖)

| 状态 | 徽章 | 含义 |
|---|---|---|
| `unreviewed` 未审计 | 灰 | 默认,无任何背书 |
| `community` 社区认可 | 蓝 | 全部达标:收录 ≥ 30 天;stars ≥ 20 或 forks ≥ 5;未被人工标记;作者账号 ≥ 90 天;180 天内活跃 |
| `flagged` 有风险报告 | 红 | 命中 blocklist,或 config/flags.json 人工标记 |

- `flags.json` 人工覆盖(运维 AI 经飞书确认后写入,进仓库版本化):`{ "dsh-xxx": { "state": "flagged", "note": "..." } }`
- 自动判定永远不覆盖人工标记;社区信号只用 GitHub 数据(stars/forks/账号年龄/活跃度)。

## 6. 插件端:插件中心(研究结论 v9)

> 用户需求:区分插件来源(内置/外部安装/市场安装/动态)、按来源分类的插件列表、启停控制、市场搜索浏览、快捷安装。
> 以下机制全部经源码核实(2026-08-16)。

### 6.0 来源分类(本地数据,四类,可精确识别)

| 来源 | 识别方式 | 数据位置 |
|---|---|---|
| **内置**(官方 bundle) | `dsh.profile.bundles` ∩ 模板白名单 `PROFILE_TEMPLATES[profile]`(web = `dsh-base` + `dsh-web-app`;headless = `dsh-base` + `dsh-headless`) | profile `package.json`(`packages/boot/app-boot/src/profile.ts:114`) |
| **外部安装**(`dsh plugin add` 装的) | `bundles` − 模板白名单,且在 `dependencies` 中(dsh-vision/dsh-dashboard/… 以 link/git/registry 形式) | profile `package.json` |
| **市场安装**(本插件装的) | profile `cordis.patch.yml` 的 insert 行(本插件写入,id = slug) | profile `cordis.patch.yml` |
| **动态插件**(dyn-*) | `ctx.dynamicCordisRunner.snapshot(agent)` → pluginId/currentPackageId/activeRun/packages | host 服务(`packages/extensions/cordis-host-runner`),会话级,不跨重启 |

### 6.1 全量运行清单(官方已提供,直接复用)

- Host 侧 `plugin-inventory` Remote(`packages/host/plugin-inventory`):`PluginInventorySnapshot { entries: [{ entryId, moduleName, enabled, fiberPhase }] }` —— **所有 loader 条目 + 有效启用状态 + 生命周期阶段**(active/failed/pending…)。
- 客户端经 `@deepseek-ai/dsh-api-remotes` 的 `pluginInventoryRemote` 读取;官方设置页已有只读清单 tab(`settings.plugins.tab`, `dsh-client-ui-settings-plugin-inventory`)。
- **插件中心 = 在同一设置区注册新 tab**,与官方只读清单并列;来源标注 = inventory 的 `moduleName` × §6.0 的本地四源交叉匹配。

### 6.2 启停控制(热,无需卸载,任何来源适用)

- 机制:patch 顶层写 **id-targeted 配置行** `- id: <entryId>\n  disabled: true|false` → loader 以 `fiber.entry.disabled` 决定是否加载(`vendor/loader/src/index.ts:153`)→ 配置热更契约立即生效。
- 适用:**内置/外部/市场**插件的行 id 都能被该行覆盖(web-wsl 的 `- id: hmr / disabled: false` 即此语法实证);**市场安装**的 insert 行同样可被 id-targeted disabled 覆盖。
- 恢复启用:删除该行或改 `disabled: false`。
- 动态插件启停:走 runner 的 run/stop(会话级),UI 只读展示 + 提示(不抢 cordis 工具职责)。
- 启停操作 = host 半写 patch(与安装同一原子写/互斥锁路径),**与卸载解耦**。

### 6.3 市场浏览/搜索/快捷安装

- 数据:`registry` API(plugins.json + blocklist,已有实现,内存缓存)。
- 搜索/分类/排序:前端本地(已有实现)。
- 快捷安装:`install` API(已有实现,slug → 校验 → pnpm add → patch insert → 热挂载)。
- 安装后自动出现在"市场安装"来源分组。

### 6.4 UI 形态(设置页「插件」区新 tab「插件中心」)

```
┌ 插件中心 tab ──────────────────────────────────────┐
│ ① 已安装(按来源分组,可折叠)                         │
│    内置: dsh-base / dsh-web-app        [停用]      │
│    外部: dsh-vision / dsh-dashboard    [停用]      │
│    市场: (来自插件的 install)          [停用][卸载] │
│    动态: dyn-3 (当前会话)              [只读+提示]  │
│    每行: 来源徽章 · 运行状态(fiberPhase)· 启停开关  │
│ ② 市场(搜索框 + 分类 chips + 排序)                 │
│    卡片: 徽章/描述/stars/更新时间/[安装(热)]        │
│    安装确认: 未审计红字声明 + 勾选(已有)            │
└────────────────────────────────────────────────────┘
```

### 6.5 安装链路(保持 v8 结论)

### 链路 A:门户站展示安装命令(静态站自带)

详情页显示可复制命令 + 「在 GitHub 查看」:
```
dsh plugin --profile web add github:<owner>/<repo>#<commit>
```
机制(源码事实 `apps/cli/src/plugin.ts`):pnpm 转发 + bundles 对账,重启生效。附 pnpm ≥10 构建脚本 allowBuilds 提醒。

### 链路 C:插件端安装(热,无需重启)

源码事实:profile `cordis.patch.yml` 编辑 → HMR watcher → 配置层热重放(`apps/cli/src/profile-boot.ts:240-294`,官方契约,生产生效)。

1. host 半 spawn `pnpm add <installSpec>`(profile 目录,**不走 `dsh plugin`,避免 bundle 双挂**)
2. 原子合并 `- insert: [{ id: <slug>, name: <真实包名> }]` 到 `cordis.patch.yml`(只插 name,**永不携带外部 config**,防 `!!js` 注入)
3. watcher 触发 → **热挂载,无需重启**;下次启动 patch 行仍在,常驻
4. 卸载:移除行 → 热卸载;`pnpm remove <pkg>` 清理
5. 更新:待实验(loader 模块缓存),候选:移除再插入 / 提示重启
6. 已装对账:读 profile `package.json` + `dsh.profile.bundles` + patch insert 行

### 6.6 插件中心的新 API(host 半扩展)

| 接口 | 用途 |
|---|---|
| `GET /api/sources` | 四源分类清单:内置/外部/市场/动态(§6.0 合并结果,含启停状态) |
| `POST /api/enable` / `POST /api/disable` | `{ id }` → 写/删 patch disabled 行(热生效;内置/外部/市场通用) |
| `GET /api/registry` | 市场数据(已有) |
| `POST /api/install` | 快捷安装(已有) |
| `POST /api/uninstall` | 卸载(已有,仅市场来源) |
| `GET /api/inventory` | 官方 inventory 快照透传(entryId/moduleName/enabled/fiberPhase) |

### 6.7 调研结论(源码核实,2026-08-16 第二轮)

**① 官方清单 tab 的注册契约(我们的 tab 照抄此模式)** — `packages/client/ui-settings-plugin-inventory/src/client/index.ts:39-46`:
```js
ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
  name: 'settings.plugins.tab',
  id: 'center',            // 我们的 tab id
  order: 20,               // 官方 'all' 是 10,我们排后面
  label: () => '插件中心',  // 或 t() 走 locale
  inject: injected,        // 向组件注入数据函数
}, CenterTabComponent))
```
客户端读官方清单:`ctx.remote.pluginInventory.list()`(inject `'remote.pluginInventory'`),返回 `{ ok, value: PluginInventorySnapshot }`。

**② host 半读全量清单:直接注入 `loader` 服务** — `packages/host/plugin-inventory/src/index.ts`:官方自己的 gateway 就是 `inject ['loader']` + `ctx.loader.entries()`,遍历得 `{ id, options.name, options.group, disabled, fiber }`(跳过 group 行)。我们的 host 半同样注入 `loader`,**不需要走 remote**,与 profile 文件四源交叉匹配即可。

**③ 动态插件完整调用面** — `dynamicCordisRunner` Remote 方法:只读 `inventory()` / `snapshot(agent)` / `listPlugins(agent)`;操作 `runHostHalf` / `stopFromPanel` / `undefineFromPanel`。注意 `snapshot(agent)` 需要 **Agent 对象**(host 侧概念)→ 插件端 UI 展示动态插件需 host 半桥接当前会话 agent;若拿不到,降级为"动态插件请在会话内用 cordis 工具管理",UI 只显示存在性提示。

**④ 内置插件停用的连锁影响** — loader 的 entries 是**扁平行列表**(无 bundle 分组概念);停用某行只影响该行。但 Cordis 是**注入模型**:停用 provider 行(如 `llm`)→ 依赖它的行进入 waiting(服务缺失),功能停摆但不崩溃。→ UI 对内置/核心行的停用需二次确认 + 提示"可能影响依赖它的功能"。

**⑤ 启停热生效代码路径** — `vendor/loader/src/index.ts:153`:fiber 卸载判定含 `fiber.entry.disabled`;patch 重放(`entry.update` → `internal/update`)更新 entry 配置,loader 据此停/启 fiber。配置热更契约(profile-boot 注释明言)覆盖 disabled 变化,无需重启。

## 7. 安全提示与风险解释(插件端 UI,硬性要求)

**安装前确认框**(默认不勾"我了解风险"不能装):
- 顶部醒目红字:"**此插件未经人工安全审计。安装后将以你运行 DSH 的用户权限执行任意代码,可读写你的文件、访问网络。仅安装你信任的来源。**"(中英)
- 标记徽章 + 解释:灰=无背书 / 蓝=社区认可(给出达标依据)/ 红=有风险报告(建议不装)
- 插件信息:仓库链接(点击可审查源码)、commit、作者、stars、收录时间、最近提交
- 风险解释折叠区:插件在 DSH 主进程内运行,无沙箱隔离(动态插件的 vm 沙箱"不是安全边界",DSH 官方声明);安装 = 运行该插件的发布脚本与全部代码;建议先看源码;异常时一键卸载并检查本地安装日志
- 安装后:本地日志(`$DSH_HOME/dsh-marketplace/install.log`);「一键卸载」常驻

**门户站同步提示**:详情页安装按钮旁显示"未审计"声明 + 三态徽章。v1 无举报/反馈入口(社区 Discord 视客流后续开放)。

## 8. 源码事实(插件端地基,证据链)

| 事实 | 位置 |
|---|---|
| `dsh plugin add` = pnpm 转发器 + bundles 对账;git 安装构建脚本需 `allowBuilds` | `apps/cli/src/plugin.ts` |
| patch 热更契约:`composeLive` 重放全量 patch 到 `entry.update()`;web 生产自动挂 watch-only HMR | `apps/cli/src/profile-boot.ts:240-294`、`packages/boot/app-boot/src/index.ts:232-265` |
| 热更只覆盖"新增行",已挂载插件版本更新不保证热生效(loader 模块缓存) | 同上 + `vendor/hmr` |

## 9. 部署与域名(免备案组合)

- 域名:`dshregistry.xyz`(已购,Porkbun);服务器:阿里云香港轻量(已购,免备案)
- **托管:Caddy(定案)**:`root ~/dshregistry/web`,自动 HTTPS;Porkbun DNS 加 A 记录:`dshregistry.xyz → VPS IP`
- **Caddy 必须配置**:屏蔽 `.git`/`tools/`/`config/`(404);`data/` 加 CORS 头
- 服务器:Ubuntu 24.04 + Node 22 + git + Caddy;cron `0 */6 * * *` 跑同步脚本(见 §2.2);爬虫需要 GitHub PAT(写仓库权限,规避 Search API 限流)
- 运维 AI 接入:服务器上 DSH agent + 飞书开放平台机器人(长连接/webhook),Agent 工具集含 bash/fs/git,即"运维 AI"

## 10. 里程碑

| 阶段 | 内容 | 验证点 |
|---|---|---|
| M1 | 建 GitHub 仓库(web/ + tools/ + config/)+ 爬虫脚本 + 静态门户站(中英双语)+ 服务器 Caddy + 域名 A 记录 | 本地生成数据、commit/push 后线上可访问、页面展示 dsh-vision/dsh-dashboard、安装命令可复制 |
| M2 | 插件端:设置页「插件市场」(列表/标记/详情)+ 热安装/热卸载/对账 + 安全确认框 | 热挂载实验、双 profile、pnpm 并发锁 |
| M3 | 服务器 cron + 飞书运维闭环(拉黑/重跑/部署全对话完成)、更新提示 | 端到端 |

## 11. 明确不做(v1)

- 不存镜像/不托管 tgz;不建 HTTP API;无注册/登录/数据库(数据层 = Git 仓库)
- **无举报/反馈入口(v1)**;社区(Discord)视客流后续开放
- 无自动审核(标记由社区信号 + 人工覆盖)
- 插件内容不翻译(界面双语,内容保持原文)
- 无深色模式;无安装点击统计
