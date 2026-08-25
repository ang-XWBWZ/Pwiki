/**
 * Transport-neutral DTOs for the Pwiki HTTP adapter.
 *
 * The browser must only see source IDs and source-relative paths. Physical
 * source paths stay on the server side and are resolved by the adapter.
 */

export type SearchMode = "keyword" | "semantic" | "hybrid";

export interface ApiError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

/** Keep an explicit success/error shape at the HTTP boundary. */
export type ApiEnvelope<T> =
  | { ok: true; value: T; requestId?: string }
  | { ok: false; error: ApiError; requestId?: string };

export interface ApiSource {
  id: string;
  name: string;
  fileCount: number;
}

export interface ApiFile {
  sourceId: string;
  relPath: string;
  name: string;
  kind: "file" | "directory";
  title?: string;
  tags?: string[];
  mtime?: string;
}

export interface ApiFilePage {
  sourceId: string;
  pathPrefix: string;
  items: ApiFile[];
  total: number;
  truncated: boolean;
}

export interface ApiEntry {
  sourceId: string;
  relPath: string;
  title: string;
  tags: string[];
  content: string;
  truncated: boolean;
}

export interface ApiSearchRequest {
  query: string;
  mode?: SearchMode;
  source?: string;
  pathPrefix?: string;
  page?: number;
  limit?: number;
}

export interface ApiSearchResult {
  query: string;
  mode: SearchMode;
  results: ApiSearchHit[];
  total: number;
  source?: string;
  pathPrefix?: string;
  status: {
    semantic: boolean;
    embeddings: number;
    files: number;
  };
}

export interface ApiSearchHit {
  sourceId: string;
  relPath: string;
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
  rerankerScore?: number;
  originalRank?: number;
  keywordEvidence?: Record<string, unknown>;
}

export interface AddSourceRequest {
  path: string;
}

export interface SourceMutationResult {
  source: ApiSource;
  files: number;
}

export interface RefreshRequest {
  source?: string;
}

export interface CreateEntryRequest {
  source: string;
  relPath: string;
  title?: string;
  tags?: string[];
  content?: string;
}

export interface ModifyEntryRequest {
  source: string;
  relPath: string;
  content: string;
}

export interface RenameEntryRequest {
  source: string;
  relPath: string;
  title: string;
}

export interface MoveEntryRequest {
  source: string;
  relPath: string;
  newRelPath: string;
}

export interface DeleteEntryRequest {
  source: string;
  relPath: string;
}

export interface DeleteEntryResult {
  sourceId: string;
  relPath: string;
}

export interface ApiStatus {
  sources: number;
  files: number;
  lastScan: string;
  semantic: boolean;
  embeddings: number;
  centroid: boolean;
  model: string;
  modelDim: number;
  compiled: number;
  backgroundVectors: ApiBackgroundVectors;
  reranker: ApiReranker;
}

export interface ApiBackgroundVectors {
  running: boolean;
  queued: number;
  completed: number;
  failed: number;
  lastError?: string;
}

export interface ApiReranker {
  enabled: boolean;
  model: string;
  dtype: "int8" | "fp16" | "fp32";
  inputTopK: number;
  outputTopK: number;
  maxLength: number;
  batchSize: number;
  loaded: boolean;
  runtimeModel?: string;
  lastError?: string;
}

export interface ApiModel {
  id: string;
  name: string;
  hfRepo: string;
  dim: number;
  description: string;
  languages: string[];
  maxTokens: number;
  int8Size: number;
  fp32Size: number;
}

export interface ApiLlmService {
  apiBase: string;
  model: string;
  hasKey: boolean;
}

/** Server-side repository facts safe for the browser to display. */
export interface ApiRepositoryInfo {
  storage: "local";
  sourceCount: number;
  fileCount: number;
  lastScan: string;
  semantic: boolean;
  embeddings: number;
  centroid: boolean;
  compiled: number;
  model: string;
  modelDim: number;
  backgroundVectors: ApiBackgroundVectors;
  reranker: ApiReranker;
}

export interface ApiSettings {
  repository: ApiRepositoryInfo;
  sources: ApiSource[];
  models: ApiModel[];
  currentModelId: string;
  llm: ApiLlmService;
  sourceManagement: boolean;
}

export interface SelectModelRequest {
  modelId: string;
}

export interface SemanticSettingsRequest {
  enabled: boolean;
  modelId?: string;
}

export interface RerankerSettingsRequest {
  enabled: boolean;
}

export interface SettingsMutationResult {
  settings: ApiSettings;
  message: string;
}
