# DSH-Registry 搜索引擎形态设计(索引优先)

> 状态:设计定稿(2026-08-17),UI 原型见 `docs/ui-prototype/index.html`。
> 定位:**做索引,不做市场**——插件数量随 AI 时代爆炸,发现成本将超过安装成本;
> 本站在生态中的角色是"插件的 Google":抓取、索引、检索;安装只是附带的。

## 1. 定位与心智

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

### 4.1 多源聚合

| 源 | 方式 | 产物 |
|---|---|---|
| GitHub topic + seeds | 增量爬虫(已有) | 插件文档(元数据+README+stars 快照) |
| dshfind | 列表页发现 URL → 抓详情页 | 网页文档 + **结构化抽取** |
| DSH Hub | 目录页发现 URL → 抓项目页 | 网页文档 |
| 自站 /p/ | 数据直接生成(不抓) | 插件文档 |

- 蜘蛛:任务队列持久化(断点续跑)+ 源适配器 + 并发池 + robots/UA/限速礼貌;
- 网页文档只存元数据+摘要(≤200 字),不复制全文;
- **结构化抽取(dshfind)**:综合评分(S 85)/四项明细/优质项目·内测用户徽章/评于日期/stars 7 天增长/贡献者
  → 合并进插件记录 `external.dshfind`,不参与本站信任判定(两套体系)

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

### 5.2 契约

- `plugins.json` 加 `schemaVersion`;不兼容变更开 `/api/v2/...`,旧版保留
- changelog 由每次 crawl 生成(机器可读变更流,下游增量同步)

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

- **M-A 蜘蛛与索引**:crawl 管道化(并发/断点)+ 网页源适配器(dshfind/DSH Hub)+ 结构化抽取 + 倒排索引构建(search.json)
- **M-B 前端**:新 UI(原型落地)— 搜索/联想/组合语法/Facet/精选/零结果/双榜单;详情页 JSON-LD + 分类页分页
- **M-C API**:schemaVersion + changelog + docs/API.md + Nginx 配置交付
- **M-D 数据面**:trending 快照、能力域分类迁移(其他 48% → <25%)、新鲜度跟踪(已收录 commit 更新)

## 7. 边界(不变)

- 无后端/无数据库(静态 + Git 数据层)
- 网页文档只索引不复制,可安装判定只认插件文档
- 抓取白名单固定(dshfind.com / hub.omdsh.dev / 自站),可配置移除
- 信任三态与 dshfind 评分互不干扰
