# Pwiki

> 本地知识库 CLI — 关键词 + 语义 + 混合搜索，ONNX 本地模型，零云依赖。

## 快速开始

```bash
# ① 安装
npm i -g @llangtop/pwiki-cli
```

```bash
# ② 下载模型 + 启用语义（~130MB，只需一次）
pwiki setup
```

```bash
# ③ 加载目录
pwiki load D:\my-notes
```

```bash
# ④ 生成 embedding（首次加载后需要，之后新增文件自动索引）
pwiki refresh
```

```bash
# ⑤ 搜索
pwiki search "关键词"              # 关键词，立即可用
pwiki search "描述" --hybrid       # 混合（推荐），refresh 后才有效
pwiki search "描述" -s             # 纯语义，同上
```

> **注意**：关键词搜索 `load` 后立即可用。语义和混合搜索需要 `refresh` 生成 embedding 向量。

## 常用命令

```bash
# ---- 搜索 ----
pwiki search "关键词"              # 关键词（最快）
pwiki search "xxx" --hybrid        # 混合（推荐）
pwiki search "xxx" -s              # 语义
pwiki search "xxx" -f              # 显示全文

# ---- 管理 ----
pwiki load <目录>                  # 加载数据源
pwiki unload                       # 查看已加载
pwiki refresh                      # 重建索引 + embedding
pwiki status                       # 状态概览

# ---- 条目 ----
pwiki read <相对路径>               # 读全文
pwiki create <源> <文件>.md -t "标题" --tags "a,b" --content "正文"

# ---- 语义 ----
pwiki models                       # 可用模型列表
pwiki model-download -m bge-m3     # 换模型
pwiki semantic on / off            # 开关
pwiki embed                        # 单独重建 embedding

# ---- 编译（需 API Key）----
$env:DEEPSEEK_API_KEY="sk-xxx"
pwiki compile-status               # 查看未编译
pwiki compile --all                # 批量编译
```

## 环境变量

| 变量 | 用途 | 默认 |
|------|------|------|
| `WIKI_HOME` | 数据目录 | `~/.pwiki` |
| `WIKI_MODEL_ID` | 嵌入模型 | `bge-base-zh-v1.5` |
| `DEEPSEEK_API_KEY` | LLM 编译 API | — |
| `OPENAI_API_KEY` | LLM 编译 API（备选） | — |

## MCP 接入

### 配置

```json
{
  "mcpServers": {
    "pwiki": {
      "command": "node",
      "args": ["%APPDATA%\\npm\\node_modules\\@llangtop\\pwiki-mcp\\dist\\index.js"],
      "env": {
        "WIKI_HOME": "C:\\Users\\xxx\\.pwiki",
        "DEEPSEEK_API_KEY": "sk-xxx"
      }
    }
  }
}
```

### 前置条件

MCP 连接前，先确保数据已就绪：

```bash
pwiki setup          # 下载模型 + 启用语义
pwiki load <目录>     # 加载数据源
pwiki refresh        # 生成 embedding（语义搜索必需）
```

### 工具清单（19 个）

| 工具 | 用途 | 典型用法 |
|------|------|------|
| `wiki_search` | 搜索（默认 hybrid） | "部署流程怎么走" |
| `wiki_read_entry` | 读条目全文 | 从搜索结果中取 `relPath` 读取 |
| `wiki_status` | 查看 wiki 状态 | 确认数据源、向量数、质心 |
| `wiki_load` | 加载数据源 | 新目录加入知识库 |
| `wiki_unload` | 卸载 / 列出数据源 | 无参列出所有已加载 |
| `wiki_refresh` | 重建索引+embedding | 源文件变更后同步 |
| `wiki_create_entry` | 创建 .md 条目 | 记笔记 |
| `wiki_modify_entry` | 覆盖修改条目 | 改内容 |
| `wiki_rename_entry` | 重命名标题 | 改 frontmatter title |
| `wiki_move_entry` | 移动文件 | 整理目录结构 |
| `wiki_enable_semantic` | 开关语义搜索 | 切换模型 |
| `wiki_generate_embeddings` | 重建向量 | 批量生成 embedding |
| `wiki_list_models` | 列出嵌入模型 | 返回 JSON：id/dim/languages |
| `wiki_compile_status` | 编译状态 | 看哪些文件未编译 |
| `wiki_compile` | 编译单个文件 | 提升搜索质量 |
| `wiki_compile_all` | 批量编译 | `limit` 控制篇数 |
| `wiki_get_compile_prompt` | 获取编译 prompt | 自定义 LLM 编译流程 |
| `wiki_store_compiled` | 存入编译结果 | 配合 `wiki_get_compile_prompt` |
| `wiki_llm_status` | LLM 配置状态 | 检查 API Key |

### 典型工作流

```
用户: "西部管网有哪些费用类型"
  → wiki_search(query="西部管网 费用类型")
  → 返回 5 条，选出最相关的 relPath
  → wiki_read_entry(path="工作/西部网管/示数分析.md")
  → 返回完整内容，回答问题
```
