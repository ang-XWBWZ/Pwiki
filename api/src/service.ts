import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { normalizeMarkdownRelPath, setRerankerConfig, WikiEngine } from "@llangtop/pwiki-core";
import type { FileEntry, SearchHit, SourceRef, WikiStatus } from "@llangtop/pwiki-core";
import type {
  AddSourceRequest,
  ApiEntry,
  ApiFile,
  ApiFilePage,
  ApiModel,
  ApiSettings,
  ApiSearchHit,
  ApiSearchRequest,
  ApiSearchResult,
  ApiSource,
  ApiStatus,
  CreateEntryRequest,
  DeleteEntryRequest,
  DeleteEntryResult,
  ModifyEntryRequest,
  MoveEntryRequest,
  RefreshRequest,
  RerankerSettingsRequest,
  RenameEntryRequest,
  SourceMutationResult,
  SelectModelRequest,
  SemanticSettingsRequest,
  SettingsMutationResult,
} from "./contracts.js";

export type ApiServiceErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PATH"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_EXISTS"
  | "SOURCE_MANAGEMENT_DISABLED"
  | "MODEL_NOT_FOUND"
  | "MODEL_SERVICE_ERROR"
  | "ENTRY_NOT_FOUND"
  | "ENTRY_EXISTS"
  | "INTERNAL";

export class PwikiApiError extends Error {
  constructor(
    readonly code: ApiServiceErrorCode,
    message: string,
    readonly status = statusForCode(code),
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PwikiApiError";
  }
}

export interface PwikiApiServiceOptions {
  basePath?: string;
  modelId?: string;
  backgroundEmbeddings?: boolean;
  maxResults?: number;
  maxContentChars?: number;
  allowSourceManagement?: boolean;
  engine?: WikiEngine;
}

/**
 * HTTP-facing application service. It is deliberately a thin source-aware
 * adapter over WikiEngine; it does not own an HTTP listener or start itself.
 */
export class PwikiApiService {
  readonly engine: WikiEngine;
  readonly allowSourceManagement: boolean;
  private readonly maxResults: number;
  private readonly maxContentChars: number;

  constructor(options: PwikiApiServiceOptions = {}) {
    this.engine = options.engine ?? new WikiEngine({
      basePath: options.basePath,
      modelId: options.modelId,
      backgroundEmbeddings: options.backgroundEmbeddings ?? true,
    });
    this.allowSourceManagement = options.allowSourceManagement ?? false;
    this.maxResults = clampInteger(options.maxResults ?? 50, 1, 200, "maxResults");
    this.maxContentChars = clampInteger(options.maxContentChars ?? 100_000, 1, 2_000_000, "maxContentChars");
  }

  status(): ApiStatus {
    const status = this.engine.status();
    return toApiStatus(status);
  }

  listSources(): ApiSource[] {
    return this.engine.sourceRefs.map((source) => ({
      id: source.id,
      name: source.name,
      fileCount: this.engine.listFiles(source.id).length,
    }));
  }

  listFiles(sourceSelector: string, pathPrefix = "", limit = this.maxResults, filter?: string): ApiFilePage {
    const source = this.requireSource(sourceSelector);
    const normalizedPrefix = normalizeRelativePath(pathPrefix, "pathPrefix");
    const pageLimit = positiveInteger(limit, "limit");
    const normalizedFilter = filter?.trim().toLocaleLowerCase();
    const entries = normalizedFilter
      ? this.engine.listFiles(source.id).filter((entry) =>
        `${entry.relPath} ${entry.title} ${entry.tags.join(" ")}`.toLocaleLowerCase().includes(normalizedFilter),
      )
      : this.engine.listFiles(source.id, normalizedPrefix);
    if (normalizedFilter) {
      const allItems = entries.map((entry) => toApiFile(source.id, entry));
      const items = allItems.slice(0, Math.min(pageLimit, this.maxResults));
      return {
        sourceId: source.id,
        pathPrefix: "",
        items,
        total: allItems.length,
        truncated: allItems.length > items.length,
      };
    }
    const directories = new Map<string, ApiFile>();
    for (const entry of entries) {
      const relative = normalizedPrefix && entry.relPath.startsWith(`${normalizedPrefix}/`)
        ? entry.relPath.slice(normalizedPrefix.length + 1)
        : entry.relPath;
      const first = relative.split("/")[0];
      if (!relative.includes("/")) continue;
      const relPath = normalizedPrefix ? `${normalizedPrefix}/${first}` : first;
      directories.set(relPath, {
        sourceId: source.id,
        relPath,
        name: first,
        kind: "directory",
      });
    }

    const files = entries.filter((entry) => {
      const relative = normalizedPrefix && entry.relPath.startsWith(`${normalizedPrefix}/`)
        ? entry.relPath.slice(normalizedPrefix.length + 1)
        : entry.relPath;
      return !relative.includes("/");
    }).map((entry) => toApiFile(source.id, entry));

    const allItems = [...directories.values(), ...files].sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
    );
    const items = allItems.slice(0, Math.min(pageLimit, this.maxResults));
    return {
      sourceId: source.id,
      pathPrefix: normalizedPrefix,
      items,
      total: allItems.length,
      truncated: allItems.length > items.length,
    };
  }

  async search(request: ApiSearchRequest): Promise<ApiSearchResult> {
    const query = requiredText(request?.query, "query");
    const mode = request?.mode ?? "hybrid";
    if (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid") {
      throw new PwikiApiError("INVALID_REQUEST", "mode must be keyword, semantic, or hybrid");
    }
    const source = request?.source ? this.requireSource(request.source) : undefined;
    const pathPrefix = request?.pathPrefix === undefined
      ? undefined
      : normalizeRelativePath(request.pathPrefix, "pathPrefix");
    if (pathPrefix && !source) {
      throw new PwikiApiError("INVALID_REQUEST", "pathPrefix requires source");
    }
    const page = positiveInteger(request?.page ?? 1, "page");
    const limit = Math.min(positiveInteger(request?.limit ?? this.maxResults, "limit"), this.maxResults);
    const hits = await this.engine.search(query, mode, {
      source: source?.id,
      pathPrefix,
    });
    const results = hits
      .slice((page - 1) * limit, page * limit)
      .map((hit) => toApiSearchHit(hit, source?.id ?? this.sourceIdForHit(hit)));
    const status = this.engine.status();
    return {
      query,
      mode,
      results,
      total: hits.length,
      source: source?.id,
      pathPrefix,
      status: {
        semantic: status.semantic,
        embeddings: status.embeddings,
        files: status.files,
      },
    };
  }

  readEntry(sourceSelector: string, relPath: string): ApiEntry | null {
    const source = this.requireSource(sourceSelector);
    const path = requiredRelativePath(relPath, "relPath");
    const result = this.engine.readEntry(path, source.id);
    if (!result) return null;
    const content = result.content.slice(0, this.maxContentChars);
    return {
      sourceId: source.id,
      relPath: result.entry.relPath,
      title: result.entry.title,
      tags: [...result.entry.tags],
      content,
      truncated: result.content.length > content.length,
    };
  }

  async addSource(request: AddSourceRequest): Promise<SourceMutationResult> {
    this.assertSourceManagement();
    const sourcePath = requiredText(request?.path, "path");
    if (!isAbsolute(sourcePath)) {
      throw new PwikiApiError("INVALID_PATH", "source path must be absolute");
    }
    const absolutePath = resolve(sourcePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
      throw new PwikiApiError("INVALID_PATH", "source path must be an existing directory");
    }
    if (!this.engine.addSource(absolutePath)) {
      throw new PwikiApiError("SOURCE_EXISTS", "source is already loaded");
    }
    const files = await this.engine.loadSource(absolutePath);
    const source = this.engine.sourceRefs.find((candidate) => candidate.path === absolutePath);
    if (!source) throw new PwikiApiError("INTERNAL", "source was loaded but could not be resolved", 500, true);
    return { source: toApiSource(source, files), files };
  }

  async removeSource(sourceSelector: string): Promise<ApiSource> {
    this.assertSourceManagement();
    const source = this.requireSource(sourceSelector);
    const fileCount = this.engine.listFiles(source.id).length;
    const removed = this.engine.removeSource(source.id);
    if (!removed) throw new PwikiApiError("SOURCE_NOT_FOUND", "source was not found");
    return toApiSource(source, fileCount);
  }

  async refresh(request: RefreshRequest = {}): Promise<{ files: number; sources: number }> {
    this.assertSourceManagement();
    if (request.source) {
      const source = this.requireSource(request.source);
      const files = await this.engine.loadSource(source.path);
      return { files, sources: 1 };
    }
    return this.engine.load();
  }

  async createEntry(request: CreateEntryRequest): Promise<ApiEntry> {
    this.assertSourceManagement();
    const source = this.requireSource(request?.source);
    const relPath = requiredMarkdownPath(request?.relPath, "relPath");
    const title = request?.title === undefined ? undefined : boundedText(request.title, "title", 300);
    const tags = normalizeTags(request?.tags);
    const content = boundedText(request?.content ?? "", "content", 2_000_000);
    const result = await this.engine.createEntry(source.path, relPath, title, tags, content);
    if (result.startsWith("exists:")) {
      throw new PwikiApiError("ENTRY_EXISTS", "entry already exists");
    }
    if (result.startsWith("source-not-found:")) {
      throw new PwikiApiError("SOURCE_NOT_FOUND", "source was not found");
    }
    if (result.startsWith("invalid-path:") || result.startsWith("write-failed:")) {
      throw new PwikiApiError("INVALID_PATH", "entry path could not be written");
    }
    const entry = this.readEntry(source.id, result);
    if (!entry) throw new PwikiApiError("INTERNAL", "entry was created but could not be read", 500, true);
    return entry;
  }

  async modifyEntry(request: ModifyEntryRequest): Promise<ApiEntry> {
    this.assertSourceManagement();
    const source = this.requireSource(request?.source);
    const relPath = requiredMarkdownPath(request?.relPath, "relPath");
    const content = boundedText(request?.content, "content", 2_000_000);
    if (!this.engine.readEntry(relPath, source.id)) {
      throw new PwikiApiError("ENTRY_NOT_FOUND", "entry could not be modified");
    }
    if (!(await this.engine.modifyEntry(source.path, relPath, content))) {
      throw new PwikiApiError("ENTRY_NOT_FOUND", "entry could not be modified");
    }
    const entry = this.readEntry(source.id, relPath);
    if (!entry) throw new PwikiApiError("INTERNAL", "entry was modified but could not be read", 500, true);
    return entry;
  }

  async renameEntry(request: RenameEntryRequest): Promise<ApiEntry> {
    this.assertSourceManagement();
    const source = this.requireSource(request?.source);
    const relPath = requiredMarkdownPath(request?.relPath, "relPath");
    const title = boundedText(request?.title, "title", 300);
    if (!(await this.engine.renameEntry(relPath, title, source.id))) {
      throw new PwikiApiError("ENTRY_NOT_FOUND", "entry could not be renamed");
    }
    const entry = this.readEntry(source.id, relPath);
    if (!entry) throw new PwikiApiError("INTERNAL", "entry was renamed but could not be read", 500, true);
    return entry;
  }

  async moveEntry(request: MoveEntryRequest): Promise<ApiEntry> {
    this.assertSourceManagement();
    const source = this.requireSource(request?.source);
    const relPath = requiredMarkdownPath(request?.relPath, "relPath");
    const newRelPath = requiredMarkdownPath(request?.newRelPath, "newRelPath");
    if (!(await this.engine.moveEntry(relPath, newRelPath, source.id))) {
      throw new PwikiApiError("ENTRY_NOT_FOUND", "entry could not be moved; destination may already exist");
    }
    const entry = this.readEntry(source.id, newRelPath);
    if (!entry) throw new PwikiApiError("INTERNAL", "entry was moved but could not be read", 500, true);
    return entry;
  }

  async deleteEntry(request: DeleteEntryRequest): Promise<DeleteEntryResult> {
    this.assertSourceManagement();
    const source = this.requireSource(request?.source);
    const relPath = requiredMarkdownPath(request?.relPath, "relPath");
    if (!(await this.engine.deleteEntry(relPath, source.id))) {
      throw new PwikiApiError("ENTRY_NOT_FOUND", "entry could not be deleted");
    }
    return { sourceId: source.id, relPath };
  }

  listModels(): Array<Record<string, unknown>> {
    return this.engine.listModels().map((model) => ({ ...model }));
  }

  settings(): ApiSettings {
    const status = this.engine.status();
    return {
      repository: {
        storage: "local",
        sourceCount: status.sources.length,
        fileCount: status.files,
        lastScan: status.lastScan,
        semantic: status.semantic,
        embeddings: status.embeddings,
        centroid: status.centroid,
        compiled: status.compiled,
        model: status.model,
        modelDim: status.modelDim,
        backgroundVectors: status.backgroundVectors,
        reranker: status.reranker,
      },
      sources: this.listSources(),
      models: this.engine.listModels().map(toApiModel),
      currentModelId: status.model,
      llm: this.engine.llmInfo,
      sourceManagement: this.allowSourceManagement,
    };
  }

  selectModel(request: SelectModelRequest): SettingsMutationResult {
    this.assertSourceManagement();
    const modelId = requiredText(request?.modelId, "modelId");
    const model = this.engine.selectModel(modelId);
    if (!model) throw new PwikiApiError("MODEL_NOT_FOUND", `model was not found: ${modelId}`);
    return { settings: this.settings(), message: `当前嵌入模型已切换为 ${model.name}。刷新索引后，新文件会使用该模型。` };
  }

  async setSemantic(request: SemanticSettingsRequest): Promise<SettingsMutationResult> {
    this.assertSourceManagement();
    if (typeof request?.enabled !== "boolean") {
      throw new PwikiApiError("INVALID_REQUEST", "enabled must be a boolean");
    }
    if (request.modelId) {
      const model = this.engine.selectModel(request.modelId);
      if (!model) throw new PwikiApiError("MODEL_NOT_FOUND", `model was not found: ${request.modelId}`);
    }
    if (request.enabled) {
      const result = await this.engine.enableSemantic();
      if (!result.ok) throw new PwikiApiError("MODEL_SERVICE_ERROR", result.msg, 503, true);
      return { settings: this.settings(), message: result.msg };
    }
    this.engine.disableSemantic();
    return { settings: this.settings(), message: "语义服务已关闭，关键词检索仍可用。" };
  }

  setReranker(request: RerankerSettingsRequest): SettingsMutationResult {
    this.assertSourceManagement();
    if (typeof request?.enabled !== "boolean") {
      throw new PwikiApiError("INVALID_REQUEST", "enabled must be a boolean");
    }
    const config = setRerankerConfig({ enabled: request.enabled });
    return {
      settings: this.settings(),
      message: config.enabled ? "二次精排已开启，混合搜索将使用 Cross-Encoder 复核结果。" : "二次精排已关闭，混合搜索恢复原始排序。",
    };
  }

  async dispose(): Promise<void> {
    await this.engine.dispose();
  }

  private assertSourceManagement(): void {
    if (!this.allowSourceManagement) {
      throw new PwikiApiError(
        "SOURCE_MANAGEMENT_DISABLED",
        "source management is disabled for this API instance",
      );
    }
  }

  private requireSource(selector: string): SourceRef {
    const value = requiredText(selector, "source");
    const source = this.engine.sourceRefs.find((candidate) =>
      candidate.id === value || candidate.name === value,
    );
    if (!source) throw new PwikiApiError("SOURCE_NOT_FOUND", "source was not found");
    return source;
  }

  private sourceIdForHit(hit: SearchHit): string {
    if (hit.sourceId) return hit.sourceId;
    const source = this.engine.sourceRefs.find((candidate) => candidate.path === hit.sourceDir);
    if (!source) throw new PwikiApiError("INTERNAL", "search result has no source reference", 500, true);
    return source.id;
  }
}

function toApiStatus(status: WikiStatus): ApiStatus {
  return {
    sources: status.sources.length,
    files: status.files,
    lastScan: status.lastScan,
    semantic: status.semantic,
    embeddings: status.embeddings,
    centroid: status.centroid,
    model: status.model,
    modelDim: status.modelDim,
    compiled: status.compiled,
    backgroundVectors: status.backgroundVectors,
    reranker: status.reranker,
  };
}

function toApiSource(source: SourceRef, fileCount: number): ApiSource {
  return { id: source.id, name: source.name, fileCount };
}

function toApiModel(model: import("@llangtop/pwiki-core").ModelInfo): ApiModel {
  return { ...model, languages: [...model.languages] };
}

function toApiFile(sourceId: string, entry: FileEntry): ApiFile {
  const name = entry.relPath.split("/").at(-1) ?? entry.relPath;
  return {
    sourceId,
    relPath: entry.relPath,
    name,
    kind: "file",
    title: entry.title,
    tags: [...entry.tags],
    mtime: entry.mtime,
  };
}

function toApiSearchHit(hit: SearchHit, sourceId: string): ApiSearchHit {
  return {
    sourceId,
    relPath: hit.relPath,
    title: hit.title,
    tags: [...hit.tags],
    snippet: hit.snippet,
    score: hit.score,
    summary: hit.summary,
    semanticScore: hit.semanticScore,
    chunkIndex: hit.chunkIndex,
    chunkHeading: hit.chunkHeading,
    headingPath: hit.headingPath,
    startLine: hit.startLine,
    endLine: hit.endLine,
    rerankerScore: hit.rerankerScore,
    originalRank: hit.originalRank,
    keywordEvidence: hit.keywordEvidence as unknown as Record<string, unknown> | undefined,
  };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PwikiApiError("INVALID_REQUEST", `${field} is required`);
  }
  return value.trim();
}

function boundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new PwikiApiError("INVALID_REQUEST", `${field} must be a string`);
  if (value.length > maxLength) throw new PwikiApiError("INVALID_REQUEST", `${field} is too long`);
  return value;
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new PwikiApiError("INVALID_REQUEST", "tags must be an array of strings");
  }
  return value.map((tag) => tag.trim()).filter(Boolean).slice(0, 50);
}

function requiredRelativePath(value: unknown, field: string): string {
  const path = normalizeRelativePath(requiredText(value, field), field);
  if (!path) throw new PwikiApiError("INVALID_PATH", `${field} must not be empty`);
  return path;
}

function requiredMarkdownPath(value: unknown, field: string): string {
  const path = requiredRelativePath(value, field);
  try {
    return normalizeMarkdownRelPath(path);
  } catch {
    throw new PwikiApiError("INVALID_PATH", `${field} must be a source-relative Markdown path`);
  }
}

function normalizeRelativePath(value: string, field: string): string {
  if (value.includes("\0")) throw new PwikiApiError("INVALID_PATH", `${field} contains an invalid character`);
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) {
    throw new PwikiApiError("INVALID_PATH", `${field} must stay inside the source`);
  }
  return normalized.split("/").filter((part) => part && part !== ".").join("/");
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new PwikiApiError("INVALID_REQUEST", `${field} must be a positive integer`);
  }
  return value;
}

function clampInteger(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value)) throw new PwikiApiError("INVALID_REQUEST", `${field} must be an integer`);
  return Math.min(max, Math.max(min, value));
}

function statusForCode(code: ApiServiceErrorCode): number {
  switch (code) {
    case "SOURCE_MANAGEMENT_DISABLED": return 403;
    case "MODEL_NOT_FOUND": return 404;
    case "MODEL_SERVICE_ERROR": return 503;
    case "SOURCE_NOT_FOUND":
    case "ENTRY_NOT_FOUND": return 404;
    case "SOURCE_EXISTS":
    case "ENTRY_EXISTS": return 409;
    case "INTERNAL": return 500;
    default: return 400;
  }
}
