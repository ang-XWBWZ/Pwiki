# @llangtop/pwiki-core

Wiki 知识库搜索引擎。供 `pwiki-cli` 和 `pwiki-mcp` 调用，也可作为库直接引用。

## 安装

```bash
npm i @llangtop/pwiki-core
```

## 用法

```typescript
import { WikiEngine } from "@llangtop/pwiki-core";

const engine = new WikiEngine({ basePath: "~/.pwiki" });

// 加载数据源
engine.addSource("/path/to/notes");
await engine.loadSource("/path/to/notes");

// 搜索（keyword | semantic | hybrid）
const hits = await engine.search("部署流程", "hybrid");

// 读条目
const { entry, content } = engine.readEntry("notes/技术/deploy.md");
```

## 主要导出

| 导出 | 类型 | 说明 |
|------|------|------|
| `WikiEngine` | class | 唯一对外 API |
| `keywordSearch` | function | 关键词搜索 |
| `semanticSearch` | function | 语义搜索 |
| `hybridSearch` | function | RRF 混合搜索 |
| `embed` | function | 文本 → 向量 |
| `cosineSimilarity` | function | 余弦相似度 |
| `MODELS` | array | 内置嵌入模型列表 |
