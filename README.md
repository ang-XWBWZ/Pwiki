# Pwiki

> 本地知识库，关键词 + 语义 + 混合搜索，ONNX 本地模型，零云依赖。

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
pwiki refresh                      # ③ 生成向量（语义搜索必需）
```

## 常用命令

```bash
pwiki search "关键词"              # 混合搜索（默认）
pwiki search "关键词" -k           # 纯关键词
pwiki search "描述" -s             # 纯语义
pwiki search "xxx" -f              # 显示全文

pwiki status                       # 状态概览
pwiki load / unload / refresh      # 数据源管理
pwiki read <路径>                  # 读条目全文
```

## 环境变量

| 变量 | 用途 |
|------|------|
| `WIKI_HOME` | 数据目录（默认 `~/.pwiki`） |
| `WIKI_MODEL_ID` | 嵌入模型（默认 `bge-base-zh-v1.5`） |
| `LLM_API_KEY` | LLM 编译（可选，提升搜索质量） |
| `LLM_API_BASE` | 自定义 API 地址 |
| `LLM_MODEL` | 自定义模型 |

## 子包

| 包 | 用途 |
|------|------|
| `@llangtop/pwiki-core` | 搜索引擎库，可被其他项目引用 |
| `@llangtop/pwiki-cli` | 终端命令行 |
| `@llangtop/pwiki-mcp` | MCP Server，接入 Claude Code / Cursor |
