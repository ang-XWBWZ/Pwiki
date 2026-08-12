# @llangtop/pwiki-core

Wiki 知识库搜索引擎。供 `pwiki-cli` 和 `pwiki-mcp` 调用，也可作为库直接引用。

## 安装

需要 Node.js 22 或更高版本。

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

// 限定到物理数据源分片和源内路径。无结果时不会回退全局。
const [source] = engine.sourceRefs;
const scopedHits = await engine.search("部署流程", "hybrid", {
  source: source.id,
  pathPrefix: "技术",
});

// 搜索结果携带 sourceId；读取时继续传入，避免同名相对路径歧义。
const { entry, content } = engine.readEntry(
  scopedHits[0].relPath,
  scopedHits[0].sourceId,
);
```

### Optional Cross-Encoder reranking

`engine.search(query, "hybrid")` can optionally rerank the final global RRF candidates. It is
disabled by default and has no model-loading path until `config.json` contains
`reranker.enabled: true`. Configure it through `setRerankerConfig()` or the CLI:

```ts
import { setRerankerConfig } from "@llangtop/pwiki-core";

setRerankerConfig({ enabled: true, dtype: "int8", inputTopK: 20, outputTopK: 10 });
```

`SearchHit.score` and `semanticScore` remain untouched; reranked hits add `rerankerScore` and
`originalRank`. Errors in this optional layer return the original Hybrid/RRF ranking.

CRUD 默认在返回前完成单文件 BM25 增量更新，并等待该文件的向量更新，保持一次性
CLI/脚本的原有完成语义。常驻服务可启用后台向量队列：

```typescript
const engine = new WikiEngine({
  basePath: "~/.pwiki",
  backgroundEmbeddings: true,
});

await engine.modifyEntry(sourcePath, "docs/api.md", newContent);
// 此时 BM25 已可检索；向量任务在后台按文件合并执行。
console.log(engine.backgroundVectorStatus());
await engine.waitForBackgroundTasks(); // 关闭常驻进程前可显式排空
```

每个数据源的文件索引、BM25、向量和 manifest 分别存放在
`<WIKI_HOME>/sources/<sourceId>/`。指定 `source` 后只打开对应分片；
`pathPrefix` 会在 BM25 评分和向量相似度计算之前过滤候选。
BM25 使用标准未加密的 `bm25.sqlite3`；v3 JSON 快照会在首次访问时自动导入并保留。

## 主要导出

| 导出 | 类型 | 说明 |
|------|------|------|
| `WikiEngine` | class | 唯一对外 API |
| `SearchScope` | type | 数据源和源内路径检索边界 |
| `SourceRef` | type | 稳定数据源 ID、名称和路径 |
| `keywordSearch` | function | 关键词搜索 |
| `semanticSearch` | function | 语义搜索 |
| `hybridSearch` | function | RRF 混合搜索 |
| `embed` | function | 文本 → 向量 |
| `cosineSimilarity` | function | 余弦相似度 |
| `MODELS` | array | 内置嵌入模型列表 |
