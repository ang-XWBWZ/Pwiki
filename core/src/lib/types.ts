// types.ts — Wiki 共享类型 (v1.3)

/** 搜索模式 */
export type SearchMode = "keyword" | "semantic" | "hybrid";

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
export interface SearchHit {
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
}

/** 搜索候选（内部使用，未经展示阈值过滤） */
export interface SearchCandidate {
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
