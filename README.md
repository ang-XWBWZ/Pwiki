# Pwiki

> Local-first Markdown knowledge engine with BM25F, semantic retrieval, RRF hybrid search, Cross-Encoder reranking, MCP, HTTP API and Web management.

Pwiki 是一个面向本地 Markdown 知识的检索与管理引擎。

它提供完整的关键词检索、向量检索、Hybrid Retrieval、Chunk 级读取、知识条目 CRUD、Source 隔离，以及 CLI、MCP、HTTP API 和 Web 多种访问方式。

核心搜索默认不依赖云服务，Embedding 与可选 Reranker 均可使用本地 ONNX 模型运行。

---

# Architecture

```text
                       ┌──────────────────┐
                       │     Web UI       │
                       └────────┬─────────┘
                                │ HTTP
                       ┌────────▼─────────┐
                       │    Pwiki API     │
                       └────────┬─────────┘
                                │
        ┌───────────────────────┼──────────────────────┐
        │                       │                      │
   ┌────▼─────┐           ┌─────▼────┐          ┌─────▼────┐
   │   CLI    │           │   MCP    │          │ Node API │
   └────┬─────┘           └─────┬────┘          └─────┬────┘
        │                       │                      │
        └───────────────────────┼──────────────────────┘
                                ▼
                    ┌──────────────────────┐
                    │      WikiEngine      │
                    │                      │
                    │ Parser / CRUD        │
                    │ Source Management    │
                    │ Search Pipeline      │
                    │ Index Maintenance    │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼─────────────────┐
              ▼                ▼                 ▼
        BM25 SQLite       Vector Store       Manifest
```

当前仓库由五个 workspace 组成：

```text
Pwiki/
├── core/
├── cli/
├── mcp/
├── api/
└── webpage/
```

| Package                   | Purpose                        |
| ------------------------- | ------------------------------ |
| `@llangtop/pwiki-core`    | 核心索引、检索、Source 与 Markdown CRUD |
| `@llangtop/pwiki-cli`     | 命令行客户端                         |
| `@llangtop/pwiki-mcp`     | MCP Server                     |
| `@llangtop/pwiki-api`     | HTTP API Adapter               |
| `@llangtop/pwiki-webpage` | Web 管理端                        |

---

# Retrieval Pipeline

Pwiki 当前支持三种检索模式：

```text
keyword
semantic
hybrid
```

默认使用 Hybrid Retrieval。

完整链路：

```text
Query
 │
 ├─────────────────────────────┐
 │                             │
 ▼                             ▼
Tokenizer                 Embedding Model
 │                             │
 ▼                             ▼
BM25F Retrieval          Vector Retrieval
 │                             │
 └──────────────┬──────────────┘
                ▼
          Raw Candidates
                │
                ▼
               RRF
                │
                ▼
       Hybrid Candidate Set
                │
        optional│
                ▼
        Cross-Encoder
                │
                ▼
            SearchHit[]
```

一个重要设计是：

**candidate retrieval 与最终展示阈值分离。**

Semantic 或 Keyword 阶段产生的候选不会因为单路展示阈值提前被丢弃，Hybrid 融合直接使用 raw candidates。

这样可以避免某个单独 Retriever 认为“分数不够高”的结果，在 RRF 融合之前就永远消失。

---

# BM25 / BM25F

Keyword Retrieval 使用倒排索引。

当前索引数据存储于：

```text
bm25.sqlite3
```

而不是查询时扫描全部 Markdown。

正常搜索只读取查询 token 对应的 postings。

字段权重：

```text
title     3.0
path      2.5
tags      1.8
body      1.0
```

因此标题、文件路径和标签中的关键词会获得更高权重。

---

## Engineering-aware Tokenizer

普通 whitespace tokenizer 对代码知识效果很差，因此 Pwiki 对工程文本进行了额外拆分。

支持：

```text
snake_case
camelCase
PascalCase
kebab-case
dot.path
slash/path
```

例如：

```text
finish_reason
```

可以产生：

```text
finish
reason
finish_reason
```

搜索：

```text
finish reason
```

仍然可以命中。

例如：

```text
LLM_API_BASE
```

搜索：

```text
api base
```

也可以匹配。

这对：

* API 参数；
* Java / TypeScript 标识符；
* 环境变量；
* 配置键；
* 文件路径；
* 类名；
* 方法名；

尤其重要。

中文则使用额外的 2-gram 处理以改善短词和连续文本检索。

---

# Semantic Retrieval

Semantic Search 使用 Embedding 对 Chunk 建立向量表示。

默认模型：

```text
bge-base-zh-v1.5
```

模型使用本地 ONNX runtime 执行。

初始化：

```bash
pwiki setup
```

模型缓存目录：

```text
~/.pwiki/models
```

也可以通过：

```text
WIKI_MODELS_DIR
```

覆盖。

Semantic Search 可以单独启停：

```bash
pwiki semantic on
pwiki semantic off
```

---

# Hybrid Search

默认搜索模式：

```bash
pwiki search "query"
```

等价于：

```text
BM25 candidates
       +
Semantic candidates
       ↓
      RRF
```

RRF 用于融合两套评分空间。

这样不需要直接比较：

```text
BM25 score
```

与：

```text
cosine similarity
```

这种本身没有统一数值语义的分数。

---

# Cross-Encoder Reranker

Pwiki 支持在 Hybrid Retrieval 后增加可选 Cross-Encoder。

默认关闭。

```bash
pwiki reranker on
```

搜索链路变为：

```text
BM25
   \
    → RRF → Top-K candidates → Cross-Encoder → Final results
   /
Vector
```

默认逻辑模型：

```text
BAAI/bge-reranker-base
```

运行时使用兼容 ONNX 发行版。

可配置：

```bash
pwiki reranker on \
  --input-top-k 30 \
  --output-top-k 10 \
  --batch-size 8
```

配置示例：

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

Reranker 只处理 Hybrid 已经召回的少量候选。

不会对整个知识库执行 Cross-Encoder 推理。

模型不可用时，搜索明确退回原始 RRF 排序。

---

# Chunk-level Retrieval

Pwiki 的搜索结果不只返回文件。

SearchHit 可以携带：

```text
sourceId
relPath
chunkIndex
headingPath
startLine
endLine
```

例如一个搜索结果可以定位到：

```text
docs/dlms/security.md
  └── Security Setup
      └── Invocation Counter

lines 138-172
chunk 7
```

因此 Agent 不需要：

```text
search
↓
read entire 800-line document
↓
自己再次定位
```

而可以：

```text
search
↓
wiki_read_chunk
```

或者：

```text
search
↓
wiki_read_context
```

直接读取命中块及其前后文。

MCP 提供：

```text
wiki_read_entry
wiki_read_chunk
wiki_read_context
```

这也是 Pwiki 面向 Agent 场景时比较核心的一层。

---

# Source Sharding

Pwiki 支持同时加载多个知识目录。

每个目录注册为一个独立 Source：

```text
Source
├── sourceId
├── rootPath
├── index
├── BM25 database
├── vectors
└── manifest
```

数据结构：

```text
~/.pwiki/
└── sources/
    ├── source-A/
    │   ├── index.json
    │   ├── bm25.sqlite3
    │   ├── vectors.json
    │   └── manifest.json
    │
    └── source-B/
        ├── index.json
        ├── bm25.sqlite3
        ├── vectors.json
        └── manifest.json
```

搜索可以指定：

```text
sourceId
```

以及：

```text
pathPrefix
```

例如：

```bash
pwiki search "authentication" \
  --source a93d... \
  --path-prefix protocol/dlms
```

过滤发生在实际 BM25 / Vector 评分之前。

指定 Source 没有结果时不会回退到其他 Source。

---

# Stable Entry Identity

跨 API / MCP / CLI 操作时，条目使用：

```text
sourceId + source-relative relPath
```

进行定位。

而不是把：

```text
/Users/foo/Documents/wiki/a.md
```

这样的物理路径暴露为公共对象标识。

HTTP API 同样遵循这个原则。

例如：

```text
source = 83af...
path   = protocol/security.md
```

这也解决了多个 Source 中存在：

```text
README.md
```

或：

```text
index.md
```

时的路径冲突问题。

---

# Path Boundary

涉及文件写入时，Pwiki 强制 Source 边界。

以下形式不会被接受：

```text
../outside.md
../../etc/passwd
/absolute/path.md
```

Entry 必须解析到对应 Source 内部。

HTTP API 不直接把底层 `renameEntry()` / `moveEntry()` 的全局路径能力暴露给外部调用者。

所有写操作首先经过 source-aware service 层解析。

---

# Index Lifecycle

Pwiki 的索引不是一次性构建产物。

Markdown 生命周期与索引生命周期保持同步。

支持：

```text
create
modify
rename
move
delete
refresh
```

例如：

```text
modify Markdown
      ↓
update index entry
      ↓
update BM25
      ↓
schedule/update embedding
      ↓
update manifest
```

---

## Change Detection

Refresh 使用内容 Hash：

```text
MD5
```

检测文件变化，而不是单纯依赖：

```text
mtime
```

这样可以避免：

* 文件时间戳被复制工具保留；
* timestamp 精度不足；
* 内容变化但 mtime 行为异常；

导致索引没有刷新。

---

# Delete Cleanup

文件删除时会统一清理相关派生数据。

概念上：

```text
removeEntryFromAllStores()
```

负责清理：

```text
index
cache
vectors
chunkInfo
manifest
BM25
```

避免产生：

```text
Markdown 已删除
但搜索还能搜到
```

这种 stale index。

---

# Embedding Atomicity

Embedding 更新采用文件级 all-or-nothing 语义。

一个文件可能产生多个 Chunk：

```text
document
├── chunk 0
├── chunk 1
├── chunk 2
└── chunk 3
```

如果新一轮向量生成过程中失败，不应该出现：

```text
chunk 0 → new vector
chunk 1 → new vector
chunk 2 → old vector
chunk 3 → old vector
```

Pwiki 会保留原有文件向量状态，直到整份文件的新向量结果可提交。

这样降低 Hybrid Retrieval 中出现部分新索引、部分旧索引的可能性。

---

# CRUD Consistency

CLI、MCP 与 HTTP 最终共享 WikiEngine 的 CRUD 语义。

包括：

```text
create
modify
rename
move
delete
```

MCP 的相关调用为异步完成：

```text
await engine.xxx()
```

返回时需要保证同步索引维护已经完成。

Semantic 后台状态则单独表达：

```text
queued
processing
ready
failed
```

而不会把：

```text
embedding task queued
```

伪装成：

```text
vector index ready
```

---

# LLM Compile

Pwiki 可以选择使用 LLM 对 Markdown 进行结构化知识编译。

基础检索完全不要求启用该功能。

命令：

```bash
pwiki compile-status
pwiki compile --all -l 10
pwiki llm
```

Compile 可以生成：

```text
topic
concepts
aliases
...
```

例如原文只有：

```text
HLS5
```

编译信息可能产生：

```text
High Level Security
GMAC Authentication
DLMS HLS
```

这些 metadata 会重新进入 BM25 索引。

因此：

```text
原始文本
    +
LLM derived metadata
    ↓
BM25 searchable fields
```

LLM 在这里承担的是：

**knowledge enrichment**

而不是替代 Retriever。

---

# CLI

安装：

```bash
npm install -g @llangtop/pwiki-cli
```

要求：

```text
Node.js >= 22
```

初始化：

```bash
pwiki setup
```

加载 Source：

```bash
pwiki load ~/documents/wiki
```

刷新：

```bash
pwiki refresh
```

搜索：

```bash
pwiki search "BM25"
```

Keyword：

```bash
pwiki search "WikiEngine" -k
```

Semantic：

```bash
pwiki search "如何定位搜索结果所在段落" -s
```

状态：

```bash
pwiki status
```

读取：

```bash
pwiki read docs/search.md --source <SOURCE_ID>
```

创建：

```bash
pwiki create <source> docs/new-entry.md
```

---

# MCP Server

安装：

```bash
npm install -g @llangtop/pwiki-mcp
```

客户端配置：

```json
{
  "pwiki": {
    "command": "pwiki-mcp",
    "env": {
      "WIKI_HOME": "/path/to/.pwiki"
    }
  }
}
```

主要 MCP Tools：

```text
wiki_search
wiki_read_entry
wiki_read_chunk
wiki_read_context
wiki_status

wiki_load
wiki_unload
wiki_refresh

wiki_create_entry
wiki_modify_entry
wiki_rename_entry
wiki_move_entry

wiki_compile
wiki_compile_all
wiki_compile_status

wiki_configure_reranker
```

典型 Agent 工作流：

```text
User Question
      ↓
wiki_search
      ↓
SearchHit
      ↓
wiki_read_chunk
      ↓
wiki_read_context
      ↓
Reasoning
      ↓
Answer
```

而不是一次把整个知识库塞进上下文。

---

# HTTP API

Pwiki 1.3.x 增加 HTTP Adapter。

API prefix：

```text
/api/v1
```

主要路由：

| Method | Path                  | Purpose       |
| ------ | --------------------- | ------------- |
| GET    | `/api/v1/status`      | Engine 状态     |
| GET    | `/api/v1/sources`     | Source 列表     |
| POST   | `/api/v1/sources`     | Load Source   |
| DELETE | `/api/v1/sources/:id` | Unload Source |
| GET    | `/api/v1/files`       | 文件树           |
| GET    | `/api/v1/search`      | 搜索            |
| GET    | `/api/v1/entry`       | 读取            |
| POST   | `/api/v1/entries`     | 创建            |
| PUT    | `/api/v1/entry`       | 修改正文          |
| PATCH  | `/api/v1/entry/title` | 修改标题          |
| POST   | `/api/v1/entry/move`  | 移动            |
| DELETE | `/api/v1/entry`       | 删除            |
| POST   | `/api/v1/refresh`     | Refresh       |
| GET    | `/api/v1/models`      | 模型            |

API 直接调用 Core：

```text
HTTP
 ↓
PwikiApiService
 ↓
WikiEngine
```

不会：

```text
HTTP
 ↓
spawn CLI
```

也不会：

```text
HTTP
 ↓
spawn MCP server
```

---

# HTTP Contracts

API 层使用显式 DTO 和统一 envelope。

概念形式：

```json
{
  "ok": true,
  "value": {}
}
```

错误：

```json
{
  "ok": false,
  "error": {}
}
```

同时显式描述：

```text
source scope
pagination
content truncation
background vector status
```

应用程序因此无需解析 CLI 文本输出。

---

# Web Management

Webpage 是 HTTP API 的浏览器客户端。

启动：

```bash
npm install

npm run build -w @llangtop/pwiki-webpage

npm run start \
  -w @llangtop/pwiki-webpage \
  -- --port 4317
```

访问：

```text
http://127.0.0.1:4317/
```

Web 当前提供：

* Source / Markdown 文件树；
* 文件筛选；
* Markdown 阅读；
* Markdown 编辑；
* 保存；
* 重命名；
* 移动；
* 删除；
* Keyword Search；
* Semantic Search；
* Hybrid Search；
* Cross-Encoder 开关；
* 搜索历史；
* Heading Outline；
* 文件属性；
* 工作区与窗口状态；
* 多套 CSS Variable Theme。

搜索历史与最近关闭文件保存在：

```text
localStorage
```

不会写入知识源本身。

---

# API / Web Security

当前 API 没有内置：

```text
authentication
TLS
public Internet access control
```

默认监听：

```text
127.0.0.1
```

非 loopback 地址下，Source Management 默认不开放。

需要显式：

```bash
--allow-source-management
```

才允许远程加载、刷新或卸载本地 Source。

因此当前设计目标是：

```text
localhost
```

或者：

```text
trusted internal network
```

公网部署应自行增加：

```text
Reverse Proxy
TLS
Authentication
Authorization
Network ACL
```

---

# Storage Layout

默认数据目录：

```text
~/.pwiki
```

结构：

```text
~/.pwiki/
├── sources/
│   └── <sourceId>/
│       ├── index.json
│       ├── bm25.sqlite3
│       ├── vectors.json
│       └── manifest.json
│
├── index.json
├── compiled/
└── models/
```

其中：

```text
index.json
```

保存知识条目 metadata。

```text
bm25.sqlite3
```

保存 BM25 文档与 postings。

```text
vectors.json
```

保存 Semantic Retrieval 所需向量。

```text
manifest.json
```

记录文件 hash 与索引生命周期状态。

```text
compiled/
```

保存 LLM Compile 结果。

```text
models/
```

保存本地 ONNX 模型。

---

# BM25 SQLite Migration

1.3.2 开始使用：

```text
bm25.sqlite3
```

替换早期：

```text
bm25_docs.json
bm25_terms.json
bm25_meta.json
```

首次打开旧索引时会执行迁移。

旧 JSON 文件暂时保留作为回退数据。

正常查询不再加载完整 terms 文件，而是根据查询词读取对应 postings。

文档新增、修改、重命名和移动也只更新对应文档事务。

---

# Environment Variables

| Variable             | Purpose                          |
| -------------------- | -------------------------------- |
| `WIKI_HOME`          | Pwiki 数据目录                       |
| `WIKI_MODELS_DIR`    | 模型缓存目录                           |
| `WIKI_MODEL_ID`      | Embedding model                  |
| `LLM_API_KEY`        | LLM API key                      |
| `LLM_API_BASE`       | Compatible API endpoint          |
| `LLM_MODEL`          | Compile model                    |
| `LLM_JSON_MODE`      | JSON mode compatibility          |
| `LLM_THINKING_PARAM` | Thinking parameter compatibility |

---

# Development

Clone：

```bash
git clone https://github.com/ang-XWBWZ/Pwiki
cd Pwiki
```

Install：

```bash
npm install
```

Build all workspaces：

```bash
npm run build --workspaces
```

或者：

```bash
npm run build
```

运行 CLI：

```bash
npm run start -w @llangtop/pwiki-cli
```

运行 MCP：

```bash
npm run start -w @llangtop/pwiki-mcp
```

运行 API：

```bash
npm run start -w @llangtop/pwiki-api -- --port 4318
```

运行 Web：

```bash
npm run start -w @llangtop/pwiki-webpage -- --port 4317
```

---

# Publishing

当前公开 npm 发布主要包括：

```text
@llangtop/pwiki-core
@llangtop/pwiki-cli
@llangtop/pwiki-mcp
```

Linux：

```bash
./publish.sh
```

发布脚本不会自动修改版本号。

发布前需要同步更新对应：

```text
package.json
```

版本。

---

# What Pwiki Is

从 UI 看，Pwiki 的 Web 页面当然很容易让人联想到一个简化版 Markdown / Obsidian 工具。

但 Web 只是整个项目的一种入口。

真正的主体仍然是：

```text
Markdown Sources
       ↓
WikiEngine
       ↓
Index / Retrieval / CRUD
       ↓
CLI / MCP / HTTP / Web
```

因此 Pwiki 更接近一个：

> **local knowledge engine shared by humans, agents and applications**

它不会花主要精力追赶成熟笔记软件的插件生态、Canvas、移动端和完整编辑器体验。

Web 的职责是让人类可以直接检查、搜索和维护同一套知识。

MCP 让 Agent 使用它。

HTTP API 让其他软件使用它。

而这些入口最终共享同一个知识核心。
ps:领域上下文管理正在开发
