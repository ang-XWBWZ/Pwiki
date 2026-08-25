# @llangtop/pwiki-api

`pwiki-api` 是 Pwiki 的 HTTP API 平台适配器，目标是提供：

- 面向浏览器的 HTTP API；
- 搜索、目录浏览、条目阅读和 Markdown 管理所需的 JSON 接口；
- 复用 `@llangtop/pwiki-core` 的索引、BM25、语义和 CRUD 语义；
- 与 CLI、MCP 客户端共享稳定的 source ID、源内相对路径和状态边界。

API 服务已经实现为显式启动的 Node HTTP 适配器。导入 `Pwiki/api`、构建项目或创建
`PwikiApiService` 都不会监听端口；只有调用 `startPwikiApi()`，或执行 API 包的
`npm start`，才会启动服务。页面服务可以在自己的显式启动过程中挂载同一个 handler。
页面层放在 `Pwiki/webpage`；`core` 不应引入 HTTP、React、DOM、Cookie 或浏览器状态。

## 适配器边界

```text
Browser UI (`Pwiki/webpage`)
    │ same-origin HTTP/JSON
    ▼
pwiki-api HTTP adapter
    │ typed DTO + validation + error envelope
    ▼
WikiEngine (@llangtop/pwiki-core)
    │
    ├── Markdown source directories
    ├── source shards / BM25 SQLite / vectors / manifest
    └── background vector maintenance
```

API 端不应：

- 直接 import `@llangtop/pwiki-core` 到浏览器 bundle；core 依赖 Node 文件系统、
  SQLite 和本地 ONNX 运行时；
- 通过启动 CLI 或 MCP 子进程实现 HTTP API；HTTP 适配器应直接调用 core；
- 把物理源目录暴露给浏览器作为条目标识；前端使用稳定 `sourceId` 和
  `source-relative relPath`；
- 把后台 embedding 已入队等同于向量已完成。状态和搜索响应需要保留这一边界。

`src/contracts.ts` 使用明确的 DTO 方向：明确的
`{ ok, value | error }` envelope、source scope、分页、内容截断标记和后台向量状态。

## HTTP API 草案

版本前缀固定为 `/api/v1`。读操作和会改变本地文件/索引的操作必须在路由、错误码
和 UI 确认上明确区分。

| 方法 | 路径 | 作用 | 默认性质 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/status` | 读取索引、语义、向量队列状态 | 只读 |
| `GET` | `/api/v1/sources` | 列出 source ID 和文件数 | 只读 |
| `POST` | `/api/v1/sources` | 加载一个已授权的本地目录 | 持久化 |
| `DELETE` | `/api/v1/sources/:sourceId` | 卸载数据源及其分片 | 破坏性 |
| `GET` | `/api/v1/files?source=&pathPrefix=` | 浏览源内目录和 Markdown 条目 | 只读 |
| `GET` | `/api/v1/search?q=&source=&pathPrefix=` | keyword/semantic/hybrid 搜索 | 只读 |
| `GET` | `/api/v1/entry?source=&path=` | 读取全文 | 只读 |
| `POST` | `/api/v1/entries` | 创建 Markdown 条目 | 持久化 |
| `PUT` | `/api/v1/entry` | 覆盖完整 Markdown 内容 | 持久化 |
| `PATCH` | `/api/v1/entry/title` | 更新 frontmatter 标题 | 持久化 |
| `POST` | `/api/v1/entry/move` | 在同一 source 内移动条目 | 持久化 |
| `DELETE` | `/api/v1/entry` | 删除 source 内 Markdown 文件并清理索引 | 破坏性 |
| `POST` | `/api/v1/refresh` | 重扫并维护索引/向量 | 持久化 |
| `GET` | `/api/v1/models` | 列出 embedding 模型 | 只读 |

所有以 `source`/`relPath` 定位的写操作都必须在 API service 层解析 source，不能把
`WikiEngine.renameEntry()` 或 `moveEntry()` 的未限定全局路径查找直接暴露给 HTTP。
同名相对路径必须通过 `sourceId` 消歧；`..`、绝对路径和 source 外路径直接返回
`INVALID_PATH`。

## 页面适配器边界

页面由 `Pwiki/webpage` 负责，先围绕知识库管理主线收敛：

1. 左侧 source/目录树；
2. 顶部全局搜索框和 keyword/semantic/hybrid 模式选择；
3. 中间搜索结果/文件列表；
4. 右侧或主区域 Markdown 阅读器，显示标题、标签、路径、命中 chunk 和行号；
5. 编辑态显式显示未保存、保存成功、BM25 已更新、向量排队/失败状态；
6. 加载、卸载、刷新、覆盖保存等持久化操作必须有明确的确认和结果回读。

优先完成真实 API 回读，再做视觉细节。页面层使用 generation 防竞态、
source-relative 面包屑和内容截断标记管理状态，但不依赖额外的运行时插件。

## 开发与验证顺序

1. 先实现 `WikiEngine` 的 source-aware API service，不改变旧 CLI/MCP 方法名；
2. 再实现 `/api/v1` HTTP 路由和结构化错误；
3. 用临时 source 做创建、读取、修改、重命名、移动、删除、搜索和 refresh 回读；
4. 最后接页面，并用浏览器动作验证搜索、打开、保存、刷新和重启后的持久性；
5. 只有当 API、文件内容、索引状态和重启后读取都通过，才把功能称为完成。

当前 API 包是 private workspace package，暂不加入 Pwiki 的三包 npm 发布脚本。

## 显式启动

```bash
# 只启动 API，默认监听 127.0.0.1:4318
npm run start -w @llangtop/pwiki-api

# 指定 Wiki home；绑定非 loopback 地址时，source 管理默认关闭
npm run start -w @llangtop/pwiki-api -- --base-path /absolute/wiki-home
npm run start -w @llangtop/pwiki-api -- --host 0.0.0.0 --allow-source-management
```

本包没有模块加载即启动、后台 fork、daemon 或隐式 `listen()`。API 的向量队列是
一次明确写操作触发的 core 内部维护任务，不是服务的静默启动机制。
当前 API 没有身份认证和 TLS，默认仅适合作为本机/受控内网服务；不要直接把
`--allow-source-management` 的实例暴露到公网。

## 对 Obsidian 的借鉴边界

Obsidian 本体不是开源软件，因此这里不复制其桌面应用源码或私有 UI 实现。可研究的
公开材料包括官方 [sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)、
[sample theme](https://github.com/obsidianmd/obsidian-sample-theme) 和
[developer docs](https://github.com/obsidianmd/obsidian-developer-docs)。Pwiki 只借鉴：

- Markdown-first 的文件树、搜索、阅读/编辑工作流；
- 主题 CSS 变量、多套配色和局部可组合的视觉 token；
- 通过显式命令和用户动作触发持久化操作；
- 把 source、相对路径和阅读上下文作为稳定页面状态。

不借鉴：Obsidian 私有 API、桌面插件运行时、Electron/Workspace 内部实现、未经许可
复制的 CSS/图标资产，以及任何把本地文件路径直接暴露给浏览器的做法。
