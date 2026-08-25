# @llangtop/pwiki-mcp

Wiki 知识库 MCP Server，接入 Claude Code / Cursor 等 AI 客户端。

## 安装

```bash
npm i -g @llangtop/pwiki-mcp
```

## 配置

```json
{
  "mcpServers": {
    "pwiki": {
      "command": "node",
      "args": ["%APPDATA%\\npm\\node_modules\\@llangtop\\pwiki-mcp\\dist\\index.js"],
      "env": {
        "WIKI_HOME": "C:\\Users\\xxx\\.pwiki",
        "LLM_API_KEY": "sk-xxx"
      }
    }
  }
}
```

## 工具（22 个）

## MCP 发现与操作说明

支持 MCP discovery 的客户端连接后可直接读取服务初始化说明；Pwiki 还公开以下只读内容：

| 类型 | 名称 | 用途 |
|------|------|------|
| Resource | `pwiki://guide/operations` | 安全配置、检索、维护、语义搜索、精排与编译流程 |
| Resource | `pwiki://guide/tool-reference` | 按用途分组的 22 个 MCP 工具清单 |
| Prompt | `pwiki-search-workflow` | 带 `query` 参数的检索工作流模板 |
| Prompt | `pwiki-maintenance-workflow` | 变更数据源、索引或条目前的维护流程模板 |

在 Pi MCP Bridge 中，依次调用 `mcp_discover(action="catalog", server="pwiki")`、`mcp_discover(action="resource", server="pwiki", uri="pwiki://guide/operations")` 或 `mcp_discover(action="prompt", server="pwiki", name="pwiki-search-workflow", arguments={ query: "..." })` 即可按需读取。说明内容是服务端参考资料，宿主的授权与确认策略仍然有效。

### 搜索与读取

| 工具 | 说明 |
|------|------|
| `wiki_search` | 搜索，默认 hybrid；可指定 `source` + `pathPrefix` |
| `wiki_read_entry` | 按相对路径读全文；建议传入搜索结果的 `sourceId` |
| `wiki_read_chunk` | 按搜索结果中的 chunk 索引读取片段 |
| `wiki_read_context` | 读取片段及其前后上下文 |

`wiki_status` 会列出稳定的 source ID。设置 `source` 后，Pwiki 只读取该
物理分片；设置 `pathPrefix` 后，在关键词评分和向量相似度计算前排除路径外
内容。限定检索没有结果时不会回退到全局数据。读取搜索结果时应把返回的
`sourceId` 继续传给 `wiki_read_entry`、`wiki_read_chunk` 或
`wiki_read_context`。

写入工具也只作用于已加载的数据源。`wiki_create_entry`、`wiki_modify_entry`
接受 source ID、唯一 source 名称或 source 路径；`wiki_rename_entry` 和
`wiki_move_entry` 在多个 source 含有同名相对路径时必须传入 source。写入路径
会统一为小写 `.md`，省略后缀时自动补全；`wiki_refresh` 可直接使用
`wiki_status` 返回的 source ID。

### 数据源

| 工具 | 说明 |
|------|------|
| `wiki_load` | 加载目录 |
| `wiki_unload` | 卸载 / 列出 |
| `wiki_refresh` | 重建索引 + embedding |

### 条目管理

| 工具 | 说明 |
|------|------|
| `wiki_create_entry` | 创建 .md 条目 |
| `wiki_modify_entry` | 覆盖修改 |
| `wiki_rename_entry` | 重命名 |
| `wiki_move_entry` | 移动 |

### 语义

| 工具 | 说明 |
|------|------|
| `wiki_enable_semantic` | 开关语义搜索 |
| `wiki_generate_embeddings` | 生成向量 |
| `wiki_list_models` | 模型列表（JSON） |

### Cross-Encoder 精排（默认关闭）

| 工具 | 说明 |
|------|------|
| `wiki_configure_reranker` | 显式开关及配置模型、dtype、候选数、长度与 batch 大小 |

`wiki_configure_reranker` 只写入现有 `config.json`，不会立即下载或加载模型。开启后，
下一次 `wiki_search(mode="hybrid")` 才会对 Hybrid/RRF 的前 `inputTopK` 条候选做
Cross-Encoder 精排。搜索结果会显示 `reranker` 分数和 `original rank`。

### 编译（需 API Key）

| 工具 | 说明 |
|------|------|
| `wiki_compile_status` | 编译状态 |
| `wiki_compile` | 编译单个 |
| `wiki_compile_all` | 批量编译 |
| `wiki_get_compile_prompt` | 获取编译 prompt |
| `wiki_store_compiled` | 存入编译结果 |

### 状态

| 工具 | 说明 |
|------|------|
| `wiki_status` | 总览（建议 first call） |
| `wiki_llm_status` | LLM 配置 |

## 前置条件

AI 连接 MCP 后，`wiki_status` 会引导完成：加载 → 语义 → embedding。

## 环境变量

| 变量 | 用途 |
|------|------|
| `WIKI_HOME` | 数据目录 |
| `LLM_API_KEY` | LLM API Key |
| `LLM_API_BASE` | 自定义 API 地址 |
| `LLM_MODEL` | 自定义模型 |
