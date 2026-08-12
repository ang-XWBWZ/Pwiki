# @llangtop/pwiki-cli

Wiki 知识库终端命令行。

## 安装

```bash
npm i -g @llangtop/pwiki-cli
```

## 命令

```bash
# 初始化
pwiki setup                        # 下载模型 + 启用语义

# 数据源
pwiki load <目录>                  # 加载
pwiki unload                       # 查看 / 卸载
pwiki refresh                      # 重建索引 + 生成向量

# 搜索（默认混合模式）
pwiki search "关键词"              # 混合
pwiki search "xxx" -k              # 关键词
pwiki search "xxx" -s              # 语义
pwiki search "xxx" -f              # 全文
pwiki search "xxx" -p 2            # 第 2 页
pwiki search "xxx" --source <ID> --path-prefix "docs"

# 条目
pwiki read <路径>                  # 读全文
pwiki read <路径> --source <ID>    # 精确读取指定源内的同名路径
pwiki create <源> <文件>.md -t "标题" --tags "a,b"

# 模型
pwiki models                       # 列表
pwiki model-download -m bge-m3     # 下载
pwiki semantic on / off            # 开关

# LLM 编译（提升搜索质量，需 API Key）
pwiki compile-status               # 查看
pwiki compile <路径>               # 编译单个
pwiki compile --all                # 批量
pwiki compile --all -m gpt-4o      # 指定模型
pwiki compile <路径> --force        # 强制重编
pwiki llm                          # LLM 配置

# 状态
pwiki status                       # 数据源 / 向量 / 质心 / 模型
```

## 环境变量

| 变量 | 用途 |
|------|------|
| `WIKI_HOME` | 数据目录（默认 `~/.pwiki`） |
| `LLM_API_KEY` | LLM API Key |
| `LLM_API_BASE` | 自定义 API 地址 |
| `LLM_MODEL` | 自定义模型（默认 `deepseek-chat`） |
