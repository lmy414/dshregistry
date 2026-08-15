# dsh-marketplace

在 DSH 设置页提供"插件市场":浏览 dshregistry 收录的社区插件,查看三态安全标记与风险说明,热安装/热卸载(无需重启)。

## 功能

- **插件浏览** — 从注册中心(`dshregistry.xyz/data/plugins.json`)拉取收录列表:搜索、分类筛选(工具/视觉/看板/桥接/启动器/MCP/技能/其他)、排序(最近更新/Stars)。
- **三态安全标记** — 未审计(灰)/ 社区认可(蓝)/ 有风险报告(红),卡片与详情均展示,悬浮可见依据。
- **风险提示(硬性)** — 安装前必须勾选"我了解风险":明示插件未经人工安全审计、以 DSH 进程权限执行任意代码、无沙箱隔离、安装即执行全部代码。
- **热安装** — spawn `pnpm add <spec>` 后原子追加 `cordis.patch.yml` insert 行,触发 DSH 配置热更契约,**无需重启**。
- **热卸载** — 原子删除 patch insert 行(热卸载),再 `pnpm remove` 清理依赖。
- **黑名单** — 拉取 `blocklist.json`,命中的插件拒绝安装。
- **已装对账** — 读 profile `package.json`(dependencies/bundles)与 `cordis.patch.yml`(insert 行),标记已安装项。
- **本地安装日志** — 每次安装/卸载记录到 `$DSH_HOME/dsh-marketplace/install.log`。

## 安装

### 前提

- DeepSeek Harness 已安装并正常运行
- 注册中心 `dshregistry.xyz` 已上线(插件数据源;未上线时可先用本地 mock 的 plugins.json)

### 方式一:正式安装(发布后,官方推荐)

```bash
dsh plugin --profile web add <github 仓库>
```

安装后重启 web 应用,设置页出现"插件市场"栏。

### 方式二:本地打包安装(发布前自测)

```bash
pnpm pack                                # 生成 dsh-marketplace-<version>.tgz
dsh plugin --profile web add dsh-marketplace-<version>.tgz
```

### 方式三:开发模式(本地源码挂载)

在 profile 的 `package.json` 中声明 link 依赖,node_modules 中为 junction 指向源码,改代码即生效:

```json
"dependencies": {
  "dsh-marketplace": "link:<本插件目录绝对路径>"
}
```

> 正式安装后请移除该 link 依赖,避免双挂载冲突(见工作区规则 4)。

### 配置

编辑 profile 的 `cordis.patch.yml`(位于 `~/.dsh/profiles/web/cordis.patch.yml`),添加或修改插件配置(示例):

```yaml
- insert:
    - id: dsh-marketplace
      name: 'dsh-marketplace'
      config:
        registryBaseUrl: 'https://dshregistry.xyz'  # 注册中心地址(默认同左)
        profile: 'web'                              # 操作的 DSH profile(双环境:WSL 侧填 web-wsl)
```

### 发布前检查清单

- [ ] `package.json`:`dsh.bundle.patch` 指向 `cordis.patch.yml`;`files` 含 `marketplace.mjs`、`client.js`、`cordis.patch.yml`、`docs/`
- [ ] 版本号已更新;`LICENSE` 与 README 齐全
- [ ] 用方式二对 tarball 做一次完整安装自测

## 工作原理

```
设置页「插件市场」栏(client.js)
  │ GET /dsh-marketplace/api/*
  ▼
host 半(marketplace.mjs)
  ├─ /registry    → fetch 注册中心 plugins.json + blocklist.json(内存缓存 5 分钟)
  ├─ /installed   → 读 profile package.json + cordis.patch.yml 对账
  ├─ /install     → 校验(黑名单/spec 白名单/包名)→ pnpm add → 原子追加 insert 行
  │                  → DSH 配置热更契约(watchUserPatches)自动热挂载,无需重启
  └─ /uninstall   → 原子删除 insert 行(热卸载)→ pnpm remove
```

安全边界:安装只接受 slug,安装目标由 host 从注册中心数据反查(不信任客户端);installSpec 白名单仅 GitHub 源;patch 只插 `name` 不携带外部 `config`(防 `!!js` 注入);install/uninstall 互斥锁防并发写。

## 配置项

| 字段 | 必填 | 说明 |
|---|---|---|
| `registryBaseUrl` | 否 | 注册中心地址,默认 `https://dshregistry.xyz` |
| `profile` | 否 | 要操作的 DSH profile,默认 `web`;双环境部署(WSL 侧)填 `web-wsl` |
| `pnpmTimeoutMs` | 否 | pnpm 安装超时(毫秒),默认 `180000` |
| `cacheTtlMs` | 否 | 注册中心数据缓存时长(毫秒),默认 `300000` |

## 许可

[MIT](../LICENSE)
