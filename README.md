# Pwiki

> 本地知识库，BM25 倒排索引 + 语义向量 + RRF 混合搜索，ONNX 本地模型，零云依赖。

https://github.com/ang-XWBWZ/Pwiki

## 安装

```bash
npm i -g @llangtop/pwiki-cli      # CLI
npm i -g @llangtop/pwiki-mcp      # MCP Server（可选）
```

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

**检索能力**：BM25 倒排索引 + field-weighted BM25F（title 3x / path 2.5x / tags 1.8x），分词支持中文 2-gram + snake_case / camelCase / kebab-case / 路径拆分。

## 常用命令

```bash
pwiki status                       # 状态概览
pwiki load <目录>                   # 加载数据源
pwiki unload [目录]                 # 卸载（省略列出已加载）
pwiki refresh                      # 重扫 + 重建索引/向量
pwiki read <路径>                  # 读条目全文
pwiki create <源目录> <路径>        # 新建条目
```

### 语义模型

```bash
pwiki setup                        # 下载模型 + 启用语义
pwiki semantic on|off              # 开关语义搜索
pwiki models                       # 列出可用嵌入模型
```

### LLM 编译（可选，提升搜索摘要质量）

```bash
pwiki compile-status               # 查看编译状态
pwiki compile --all -l 10          # 编译 10 篇未编译文件
pwiki llm                          # 查看 LLM 配置
```

编译产出的 topic / concepts / aliases 自动进入 BM25 索引，搜别名即可命中。

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
| `wiki_search` | 搜索（结果含 chunkIndex/startLine/endLine） |
| `wiki_read_entry` | 读全文 |
| `wiki_read_chunk` | 读指定块 |
| `wiki_read_context` | 读块及前后文 |
| `wiki_status` | 状态检查 |
| `wiki_load / unload / refresh` | 数据源管理 |
| `wiki_create_entry / rename_entry / move_entry / modify_entry` | CRUD |
| `wiki_compile / compile_all / compile_status` | LLM 编译 |

## 索引结构

```
~/.pwiki/
├── index.json          # 文件索引
├── bm25_docs.json      # BM25 倒排文档
├── bm25_terms.json     # BM25 倒排词条
├── bm25_meta.json      # BM25 元信息
├── vectors.json        # 语义向量 + chunk 元数据
├── manifest.json       # 文件状态（MD5）
├── compiled/           # LLM 编译产物
└── models/             # ONNX 嵌入模型
```

## 子包

| 包 | 用途 |
|------|------|
| `@llangtop/pwiki-core` | 搜索引擎库 |
| `@llangtop/pwiki-cli` | 终端命令行 |
| `@llangtop/pwiki-mcp` | MCP Server |
