// index.ts — @pwiki/core barrel exports

export { WikiEngine } from "./WikiEngine.js";
export type { EngineConfig } from "./WikiEngine.js";
export type { BackgroundQueueStatus } from "./lib/background-queue.js";

export { initWikiConfig, setWikiHome, wikiHome } from "./config.js";

// Model registry
export {
  BUILTIN_MODELS as MODELS,
  getBuiltinModels, findModel, getCurrentModel, selectModel, getDefaultModelId,
} from "./lib/model-registry.js";
export type { ModelInfo } from "./lib/model-registry.js";

// Types
export type {
  SearchMode, SearchHit, SearchScope, SourceRef, FileEntry, ChunkInfo,
  RawChunk, CompiledChunk, FileSegment, FileLLMData,
  CompiledFileRecord, EmbeddingData, WikiStatus,
  KeywordEvidence, KeywordTermEvidence,
  RerankerConfig, RerankerDType,
} from "./lib/types.js";

// Store
export {
  getSources, addSource, removeSource,
  getSemanticEnabled, setSemanticEnabled,
  readModelId, writeModelId, getWikiModel,
  getIndex, mergeIndex, removeEntry, updateEntryPath, getEntry, stats,
  readBm25Stats, writeBm25Stats,
} from "./lib/store.js";
export {
  getEmbeddings, setEmbeddings,
  getChunkInfo, setChunkInfo,
  getCentroid, setCentroid, clearCentroid,
} from "./lib/store-vectors.js";

// Content cache
export { setContent, getContent, hasContent, clearAll, cacheSize } from "./lib/content-cache.js";

// Embedder
export {
  initialize as initEmbedder,
  isAvailable as embedderAvailable,
  downloadModel, embed, embedBatch,
  cosineSimilarity,
  getModelName, getModelRepo, getModelSource,
} from "./lib/embedder.js";

// Search
export { keywordSearch } from "./lib/search.js";
export { semanticSearch, hybridSearch } from "./lib/semantic-search.js";

// Optional Cross-Encoder reranking
export { BgeReranker, rerankerDocumentText } from "./lib/reranker.js";
export type { Reranker, RerankOptions, RerankerStatus, BgeRerankerDependencies } from "./lib/reranker.js";
export { getRerankerConfig, setRerankerConfig, validateRerankerConfig } from "./lib/reranker-config.js";

// BM25 & Tokenizer
export { tokenize, analyze, analyzerStatus } from "./lib/tokenizer.js";
export type {
  AnalyzeOptions, AnalyzedToken, AnalyzerConfig, Segment, Segmenter,
  TextAnalyzer, TokenSource,
} from "./lib/tokenizer.js";
export {
  BM25_INDEX_VERSION, buildBm25Stats, bm25Score, idf, getDocTokens,
} from "./lib/bm25.js";
export type { Bm25Stats, Bm25Index, Bm25Posting, Bm25TermEntry } from "./lib/bm25.js";

// Indexer
export { scanDir } from "./lib/indexer-scan.js";
export { extractChunks, generateEmbeddings, embedSingleFile, recomputeCentroid } from "./lib/indexer-embed.js";
export { getRawChunks, storeCompiledChunks, storeFileSegments, storeFileLLMVector } from "./lib/indexer-compile.js";

// AST chunker
export { extractChunksAST } from "./lib/ast-chunker.js";
export type { ChunkResult } from "./lib/ast-chunker.js";

// Semantic compiler
export {
  COMPILE_SYSTEM_PROMPT, buildCompilePrompt,
  buildEmbeddingText, parseCompiledResult,
  FILE_COMPILE_SYSTEM_PROMPT, buildFileCompilePrompt, parseFileSegments,
  FILE_LLM_SYSTEM_PROMPT, buildFileLLMPrompt, parseFileLLMResult,
  buildFileLLMEmbeddingText,
} from "./lib/semantic-compiler.js";
