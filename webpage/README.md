# @llangtop/pwiki-webpage

`pwiki-webpage` 是浏览器页面适配器，和 `Pwiki/api` 分离：

```text
Pwiki/core       领域能力和索引
Pwiki/api        Node HTTP API 服务
Pwiki/webpage    浏览器页面、页面状态和 HTTP client
```

页面层只能通过 `/api/v1` 访问知识库。它不应把 `@llangtop/pwiki-core` 打进浏览器
bundle，也不应启动 CLI 或 MCP 子进程。

当前页面服务由两个显式边界组成：

- `PwikiApiClient`：浏览器安全的 HTTP client；
- `createPwikiWebpageServer()` / `startPwikiWebpage()`：静态页面服务，可在显式启动
  时把 API handler 挂载到同一进程。

执行 `npm start -w @llangtop/pwiki-webpage` 时才会监听端口，默认是
`127.0.0.1:4317`；它不会因为导入页面 client、构建或打开包而静默启动 API。

浏览器 client 统一封装：

- status / sources；
- source-relative 文件浏览；
- keyword / semantic / hybrid 搜索；
- 二次精排状态读取和开关；
- 条目读取；
- 创建、修改、重命名、移动和删除请求。

页面当前已提供：

- source 列表和 source 内可展开的 Markdown 文件树；
- keyword / semantic / hybrid 搜索结果；
- 搜索历史：离开搜索页后保留当前查询和结果，刷新后恢复最近 8 条历史；
- 安全转义的 Markdown 阅读器和源码编辑器；
- 创建、覆盖保存、重命名、移动、删除、刷新、加载和卸载 source；
- 右侧 Markdown 大纲和文件属性操作区；
- 顶部窗口管理：已打开/未打开页面、窗口压缩/堆叠和独立的新建工作区；
- 新工作区中的最近关闭 Markdown 列表，点击即可恢复，最多保留 8 条浏览器本地记录；
- 夜幕紫、纸张米白、海湾蓝、松林绿、玫瑰粉、琥珀橙六套配色、响应式布局和快捷键。

页面保存、移动、重命名和删除后会重新读取条目、文件树和状态；API 响应保留
BM25/向量维护的状态边界。Markdown 渲染只允许受限的安全链接，不把原始 HTML
直接插入页面。

搜索历史和最近关闭文件只写入浏览器 `localStorage`，不写入知识库文件；重新打开条目
时仍通过 `/api/v1/entry` 读取最新内容。关闭窗口记录的是 Markdown 窗口，删除文件不会
被错误地加入最近关闭列表。

页面的视觉方向参考 Obsidian 的公开插件/主题生态，而不是其未公开的桌面核心：
文件树 + 搜索 + 阅读/编辑的三栏工作区、CSS 变量主题和显式用户操作。详情见
[`Pwiki/api/README.md`](../api/README.md) 的借鉴边界。

```bash
npm run build -w @llangtop/pwiki-webpage
npm run start -w @llangtop/pwiki-webpage
```

默认监听 `127.0.0.1:4317`。页面服务同时挂载 `/api/v1`，也可以显式指定知识库目录
和数据源管理权限：

```bash
npm run start -w @llangtop/pwiki-webpage -- \
  --host 127.0.0.1 --port 4317 --base-path /absolute/path/to/wiki-home \
  --allow-source-management
```

独立 API 服务的路由表和启动边界见 [`../api/README.md`](../api/README.md)。
