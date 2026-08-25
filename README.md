# Pwiki

> 本地知识库，BM25 倒排索引 + 语义向量 + RRF 混合搜索，ONNX 本地模型，零云依赖。

https://github.com/ang-XWBWZ/Pwiki

## 安装（npm）

需要 Node.js 22 或更高版本。推荐直接从 npm 安装 CLI：

```bash
npm install -g @llangtop/pwiki-cli
pwiki --version
```

如果需要让 Claude、Cursor 等 MCP 客户端接入，再安装 MCP Server：

```bash
npm install -g @llangtop/pwiki-mcp
```

`@llangtop/pwiki-core` 是供 Node.js 项目使用的底层库，一般不需要单独全局安装。

## 从源码发布（维护者）

Linux 环境可直接使用仓库内的 Bash 脚本发布，不需要 PowerShell：

```bash
cd Pwiki
./publish.sh
```

脚本会先执行 `npm login` 和 `npm whoami`，然后依次编译并公开发布当前版本的
`@llangtop/pwiki-core`、`@llangtop/pwiki-cli` 和 `@llangtop/pwiki-mcp`。脚本不会
自动修改版本号；发布前请先手动更新三个子包的 `package.json` 版本，并确认工作区
中的代码、README 和锁文件已经准备好。

发布不是原子操作：如果某个包已经成功发布、后续包失败，脚本会立即停止；修复问题
后重新运行时，已发布的包会提示该版本已存在。

## 三步上手

```bash
pwiki setup                        # ① 下载模型 + 启用语义（~130MB，一次）
pwiki load <笔记目录>               # ② 加载数据源
pwiki refresh                      # ③ 生成向量 + BM25 索引
```

`load` 后关键词搜索立即可用，`refresh` 后语义/混合搜索生效。

## 搜索模式

| 命令 | 模式 | 适用场景 |
|------|------|------|
| `pwiki search "关键词"` | **hybrid**（默认）| 日常使用，BM25 + 语义 RRF 融合 |
| `pwiki search "关键词" -k` | **keyword** | 精确匹配，专有名词、API、命令 |
| `pwiki search "描述" -s` | **semantic** | 自然语言，同义表达模糊查询 |
| `pwiki search "xxx" -f` | hybrid + 全文 | 需要看正文时 |
| `pwiki search "xxx" --source <ID> --path-prefix docs` | 范围检索 | 只搜索指定数据源及源内路径 |

**检索能力**：BM25 倒排索引 + field-weighted BM25F（title 3x / path 2.5x / tags 1.8x），分词支持中文 2-gram + snake_case / camelCase / kebab-case / 路径拆分。

`pwiki status` 会列出 source ID。限定 `source` 后只打开该物理分片；
`path-prefix` 在 BM25 和向量评分前过滤，且无结果时不会回退全局。

## 常用命令

```bash
pwiki status                       # 状态概览
pwiki load <目录>                   # 加载数据源
pwiki unload [目录]                 # 卸载（省略列出已加载）
pwiki refresh                      # 重扫 + 重建索引/向量
pwiki read <路径> --source <ID>    # 精确读取指定源内条目
pwiki create <源目录> <路径>        # 新建条目
```

### 语义模型

```bash
pwiki setup                        # 下载模型 + 启用语义
pwiki semantic on|off              # 开关语义搜索
pwiki models                       # 列出可用嵌入模型
```

### Cross-Encoder 精排（可选）

Hybrid 搜索默认只使用 BM25 + 双塔 RRF。精排默认关闭；关闭时不会下载或加载额外模型。

```bash
pwiki reranker on                  # 开启；模型仍在第一次 hybrid 搜索时才加载
pwiki reranker off                 # 关闭，恢复原始 Hybrid/RRF 排序
pwiki reranker on --input-top-k 30 --output-top-k 10 --batch-size 8
```

配置保存在既有的 `config.json` 中：

```json
{
  "reranker": {
    "enabled": false,
    "model": "BAAI/bge-reranker-base",
    "dtype": "int8",
    "inputTopK": 20,
    "outputTopK": 10,
    "maxLength": 512,
    "batchSize": 8
  }
}
```

启用后，Pwiki 只将 Hybrid/RRF 的前 `inputTopK` 条候选按批传给 Cross-Encoder，按
`rerankerScore` 重排后保留前 `outputTopK` 条。默认逻辑模型为
`BAAI/bge-reranker-base`；运行时使用兼容的 ONNX 发行版
`onnx-community/bge-reranker-base-ONNX` 的 INT8 文件，并缓存到现有模型目录
`~/.pwiki/models`（或 `WIKI_MODELS_DIR`）。不在搜索请求中量化模型。`fp16` 与
`fp32` 可通过 `--dtype` 显式选择；缺少对应 ONNX 文件时搜索会记录明确错误并退回
原 Hybrid/RRF 排序。

### LLM 编译（可选，提升搜索摘要质量）

```bash
pwiki compile-status               # 查看编译状态
pwiki compile --all -l 10          # 编译 10 篇未编译文件
pwiki llm                          # 查看 LLM 配置
```

编译产出的 topic / concepts / aliases 自动进入 BM25 索引，搜别名即可命中。

## Web 管理端

Pwiki 的 Web 管理端采用与 CLI、MCP 相同的 core 能力，通过 HTTP API 作为平台适配边界：

```text
@llangtop/pwiki-core       索引、搜索、Markdown CRUD 和状态
          ↓
@llangtop/pwiki-api        /api/v1 HTTP API
          ↓
@llangtop/pwiki-webpage    浏览器页面和窗口状态
```

页面服务会在同一个进程中托管静态页面和 `/api/v1` API，不会把 core、Node 文件系统或
MCP 子进程打进浏览器 bundle。详细 API 路由、错误边界和 core 适配规范见
[`api/README.md`](api/README.md)；页面包的实现边界见
[`webpage/README.md`](webpage/README.md)。

### 启动 Web 页面

在 `Pwiki` 目录执行：

```bash
npm install
npm run build -w @llangtop/pwiki-webpage
npm run start -w @llangtop/pwiki-webpage -- --port 4317
```

打开 [http://127.0.0.1:4317/](http://127.0.0.1:4317/)。本机回环地址默认允许知识库管理；
如果服务绑定到其他地址，需要显式使用 `--allow-source-management` 才能启用加载、刷新
和移除本地数据源：

```bash
npm run start -w @llangtop/pwiki-webpage -- \
  --host 127.0.0.1 --port 4317 --base-path /absolute/path/to/wiki-home \
  --allow-source-management
```

只需要 API 时，可以单独启动：

```bash
npm run start -w @llangtop/pwiki-api -- --port 4318
```

当前 API 默认没有身份认证和 TLS，适合本机或受控内网使用；不要直接把服务暴露到公网。

### 页面能力

- 左侧 Markdown 文件管理器：按目录展开、文件筛选、加载和切换知识库；
- `keyword`、`semantic`、`hybrid` 三种搜索模式，搜索结果支持跳转到 Markdown；
- 搜索历史保存在当前浏览器本地，离开搜索页后查询和结果仍可恢复，最多保留 8 条；
- 可选的二次精排开关，控制 Hybrid/RRF 结果是否使用 Cross-Encoder 复核；
- 顶部窗口管理：窗口压缩、堆叠、已打开/未打开页面区分，以及独立的新建工作区；
- 新工作区显示最近关闭的 Markdown 文件，记录保存在浏览器本地，点击即可恢复；
- Markdown 阅读、编辑、保存、重命名、移动和删除，右侧同步展示标题大纲与文件属性；
- 六套 CSS 变量主题：夜幕紫、纸张米白、海湾蓝、松林绿、玫瑰粉和琥珀橙。

搜索历史和最近关闭记录只保存在浏览器 `localStorage`，不会写入 Markdown 文件，也不会
替代 core 的索引状态；重新打开文件后，页面仍以 API 返回的条目和文件内容为准。

## 环境变量

| 变量 | 用途 |
|------|------|
| `WIKI_HOME` | 数据目录（默认 `~/.pwiki`） |
| `WIKI_MODEL_ID` | 嵌入模型（默认 `bge-base-zh-v1.5`） |
| `LLM_API_KEY` | LLM 编译 API Key |
| `LLM_API_BASE` | 自定义 API 地址 |
| `LLM_MODEL` | 自定义 LLM 模型 |
| `LLM_JSON_MODE` | 设为 `off` 禁用 `response_format: json_object` |
| `LLM_THINKING_PARAM` | 设为 `off` 禁用 `thinking` 参数 |

## MCP 工具（AI 客户端接入）

```json
{
  "pwiki": {
    "command": "pwiki-mcp",
    "env": { "WIKI_HOME": "/path/to/.pwiki" }
  }
}
```

| 工具 | 说明 |
|------|------|
| `wiki_search` | 搜索；可限定 `source` + `pathPrefix` |
| `wiki_read_entry` | 读全文；建议传回结果中的 `sourceId` |
| `wiki_read_chunk` | 读指定块 |
| `wiki_read_context` | 读块及前后文 |
| `wiki_status` | 状态检查 |
| `wiki_configure_reranker` | 显式配置 Hybrid 后的可选 Cross-Encoder 精排 |
| `wiki_load / unload / refresh` | 数据源管理 |
| `wiki_create_entry / rename_entry / move_entry / modify_entry` | CRUD |
| `wiki_compile / compile_all / compile_status` | LLM 编译 |

## 索引结构

```
~/.pwiki/
├── sources/
│   └── <sourceId>/
│       ├── index.json
│       ├── bm25.sqlite3      # 标准未加密 SQLite，BM25 文档与 postings
│       ├── vectors.json
│       └── manifest.json
├── index.json          # 旧全局索引兼容层
├── compiled/           # LLM 编译产物
└── models/             # ONNX 嵌入模型
```

1.3.2 首次打开旧索引时会把 v3 的 `bm25_docs.json` / `bm25_terms.json` /
`bm25_meta.json` 导入 `bm25.sqlite3`；旧 JSON 保留为可回退备份。正常查询只读取
查询词对应的 postings，新增、编辑、重命名、移动只更新单文档事务。

## 子包

| 包 | 用途 |
|------|------|
| `@llangtop/pwiki-core` | 搜索引擎库 |
| `@llangtop/pwiki-api` | Node HTTP API 适配器 |
| `@llangtop/pwiki-webpage` | 浏览器 Web 管理端 |
| `@llangtop/pwiki-cli` | 终端命令行 |
| `@llangtop/pwiki-mcp` | MCP Server |
