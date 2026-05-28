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

## 工具（19 个）

### 搜索与读取

| 工具 | 说明 |
|------|------|
| `wiki_search` | 搜索，默认 hybrid |
| `wiki_read_entry` | 读条目全文 |

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
