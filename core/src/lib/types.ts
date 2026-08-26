// types.ts — Wiki 共享类型 (v1.3)

import type { TokenSource } from "./analyzer/types.js";

/** 搜索模式 */
export type SearchMode = "keyword" | "semantic" | "hybrid";

/** Cross-Encoder 精排使用的模型精度。 */
export type RerankerDType = "int8" | "fp16" | "fp32";

/** Cross-Encoder 精排配置。默认关闭，避免影响现有搜索路径。 */
export interface RerankerConfig {
  enabled: boolean;
  /** 逻辑模型名；运行时可映射到兼容的 ONNX 发行仓库。 */
  model: string;
  dtype: RerankerDType;
  inputTopK: number;
  outputTopK: number;
  maxLength: number;
  batchSize: number;
}

export const DEFAULT_RERANKER_CONFIG: RerankerConfig = {
  enabled: false,
  model: "BAAI/bge-reranker-base",
  dtype: "int8",
  inputTopK: 20,
  outputTopK: 10,
  maxLength: 512,
  batchSize: 8,
};

/** 已注册的数据源 */
export interface SourceRef {
  id: string;
  name: string;
  path: string;
}

/** 搜索边界。pathPrefix 只能与 source 一起使用。 */
export interface SearchScope {
  source?: string;
  pathPrefix?: string;
}

/** 内部检索边界；source 已解析为稳定分片 ID。 */
export interface SearchShardScope {
  sourceId: string;
  pathPrefix?: string;
}

/** 索引中的单个文件条目 */
export interface FileEntry {
  title: string;
  tags: string[];
  sourceDir: string;
  relPath: string;
  mtime: string;
}

/** 文档块信息（标题分块 + 语义编译元数据） */
export interface ChunkInfo {
  heading: string;
  level: number;
  /** 生成 embedding 时使用的文本 hash；旧向量没有该字段时会安全地重算一次。 */
  contentMd5?: string;
  topic?: string;
  summary?: string;
  concepts?: string[];
  entities?: string[];
  aliases?: string[];
  keywords?: string[];
  normalizedText?: string;
  chunkType?: string;
  importance?: number;
  confidence?: number;
  contentClass?: string;
  temporalAnchor?: string;
  // AST chunker 元数据
  headingPath?: string[];
  chunkTypeHint?: string;
  wikilinks?: string[];
  startLine?: number;
  endLine?: number;
}

/** 待编译的原始�?*/
export interface RawChunk {
  key: string;
  relPath: string;
  heading: string;
  rawText: string;
  compiled: boolean;
  fileTags?: string[];
  headingPath?: string[];
  siblingHeadings?: string[];
  totalChunks?: number;
  chunkIndex?: number;
}

/** AI 编译产出（块级） */
export interface CompiledChunk {
  key: string;
  topic: string;
  normalizedText: string;
  concepts: string[];
  aliases: string[];
}

/** v5.2 文件级编�? LLM 自行分割的语义片�?*/
export interface FileSegment {
  text: string;
  topic: string;
  normalizedText: string;
  concepts: string[];
  aliases: string[];
}

/** LLM 文件级编译输�?*/
export interface FileLLMData {
  topic: string;
  normalizedText: string;
  concepts: string[];
  aliases: string[];
}

/** compiled/*.json 文件格式 */
export interface CompiledFileRecord {
  relPath: string;
  compiledAt: string;
  sourceMD5: string;
  model: string;
  result: FileLLMData;
  embeddingText: string;
  vectorKey: string;
}

/** 搜索结果 */
export interface KeywordTermEvidence {
  term: string;
  queryWeight: number;
  documentWeight: number;
  lexicalWeight: number;
  fields: string[];
  querySources: TokenSource[];
  documentSources: TokenSource[];
  contribution: number;
}

export interface KeywordEvidence {
  score: number;
  matchedTerms: KeywordTermEvidence[];
}

export interface SearchHit {
  sourceId?: string;
  relPath: string;
  sourceDir: string;
  title: string;
  tags: string[];
  snippet: string;
  score: number;
  summary?: string;
  semanticScore?: number;
  chunkIndex?: number;
  chunkHeading?: string;
  headingPath?: string[];
  startLine?: number;
  endLine?: number;
  keywordEvidence?: KeywordEvidence;
  /** 精排后的相关性分数；不覆盖原始 hybrid score。 */
  rerankerScore?: number;
  /** 候选在精排前的 1-based 排名。 */
  originalRank?: number;
}

/** 搜索候选（内部使用，未经展示阈值过滤） */
export interface SearchCandidate {
  sourceId?: string;
  relPath: string;
  title: string;
  score: number;
  source: "keyword" | "semantic" | "hybrid";
  chunkKey?: string;
  chunkIndex?: number;
  chunkHeading?: string;
  snippet?: string;
  semanticScore?: number;
  headingPath?: string[];
  startLine?: number;
  endLine?: number;
  keywordEvidence?: KeywordEvidence;
}

/** 向量存储结构 */
export interface EmbeddingData {
  model: string;
  dim: number;
  entries: Record<string, number[]>;
  chunkInfo?: Record<string, ChunkInfo>;
  centroid?: number[];
}

/** Wiki 状态快�?*/
export interface WikiStatus {
  configPath: string;
  sources: string[];
  files: number;
  lastScan: string;
  semantic: boolean;
  embeddings: number;
  centroid: boolean;
  model: string;
  modelDim: number;
  compiled: number;
  backgroundVectors: {
    running: boolean;
    queued: number;
    completed: number;
    failed: number;
    lastError?: string;
  };
  reranker: RerankerConfig & {
    loaded: boolean;
    runtimeModel?: string;
    lastError?: string;
  };
}

/** chunk 读取结果 */
export interface ChunkReadResult {
  relPath: string;
  title: string;
  chunkIndex: number;
  heading: string;
  headingPath?: string[];
  startLine: number;
  endLine: number;
  content: string;
}

/** chunk 上下文结果 */
export interface ChunkContextResult {
  current: ChunkReadResult;
  previous: ChunkReadResult[];
  next: ChunkReadResult[];
}
