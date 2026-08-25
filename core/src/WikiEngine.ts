// WikiEngine.ts — 协调层 (v1.0)
//
// 唯一对外 API。组装所有 lib 模块，提供 chained + async 的编程接口。
// CLI / MCP / 库用户均通过此类交互。

import { resolve, join, dirname, basename } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { initWikiConfig, setWikiHome, wikiHome, configFile } from "./config.js";
import * as cfg from "./lib/store-config.js";
import * as idx from "./lib/store-index.js";
import * as vec from "./lib/store-vectors.js";
import * as emb from "./lib/embedder.js";
import * as cache from "./lib/content-cache.js";
import { BgeReranker, type Reranker } from "./lib/reranker.js";
import { getRerankerConfig, validateRerankerConfig } from "./lib/reranker-config.js";
import { keywordSearch } from "./lib/search.js";
import { semanticSearch, hybridSearch } from "./lib/semantic-search.js";
import {
  bm25StatsFromIndex,
  buildBm25Stats,
  buildBm25Index,
  closeBm25Databases,
  hasBm25Index,
  readBm25Index,
  removeDocFromIndex,
  upsertBm25Document,
  writeBm25Index,
} from "./lib/bm25.js";
import { writeBm25Stats } from "./lib/store-index.js";
import { scanDir } from "./lib/indexer-scan.js";
import { generateEmbeddings as doGenerateEmbeddings } from "./lib/indexer-embed.js";
import { getRawChunks, storeCompiledChunks, storeFileLLMVector } from "./lib/indexer-compile.js";
import {
  getManifest,
  getFileState,
  getManifestStats,
  computeMD5,
  isCompilationStale,
  markFileContentChanged,
  removeFileState,
} from "./lib/file-manifest.js";
import { CoalescingBackgroundQueue } from "./lib/background-queue.js";
import type { BackgroundQueueStatus } from "./lib/background-queue.js";
import { parseFileEntry } from "./lib/parser.js";
import {
  listSourceRefs,
  normalizeRelPath,
  pathMatchesPrefix,
  readSourceIndex,
  removeSourceEntry,
  removeSourceShard,
  resolveSourceRef,
  resolveWithinSource,
  normalizeMarkdownRelPath,
  sourceIndexExists,
  sourceRefForPath,
  upsertSourceEntries,
  writeSourceIndex,
} from "./lib/source-shard.js";
import {
  COMPILE_SYSTEM_PROMPT, buildCompilePrompt, parseCompiledResult,
  FILE_LLM_SYSTEM_PROMPT, buildFileLLMPrompt, parseFileLLMResult,
} from "./lib/semantic-compiler.js";
import { findModel, getCurrentModel, selectModel, getBuiltinModels } from "./lib/model-registry.js";
import type { ModelInfo } from "./lib/model-registry.js";
import type {
  SearchMode,
  SearchHit,
  SearchScope,
  SearchShardScope,
  SourceRef,
  FileEntry,
  FileLLMData,
  WikiStatus,
  ChunkReadResult,
  ChunkContextResult,
} from "./lib/types.js";

export interface EngineConfig {
  basePath?: string;
  modelId?: string;
  /** MCP/daemon 场景启用；一次性 CLI 默认仍等待向量完成。 */
  backgroundEmbeddings?: boolean;
  /** 可选注入，供替换精排实现和测试使用；仍受 reranker.enabled 控制。 */
  reranker?: Reranker;
}

type VectorMaintenanceTask =
  | { kind: "embed"; source: SourceRef; relPath: string }
  | { kind: "remove"; source: SourceRef; relPath: string };

export class WikiEngine {
  private readonly useBackgroundEmbeddings: boolean;
  private readonly vectorQueue: CoalescingBackgroundQueue<VectorMaintenanceTask>;
  private reranker: Reranker | null;
  private readonly injectedReranker: boolean;
  private rerankerConfigKey = "";

  constructor(config: EngineConfig = {}) {
    initWikiConfig({ basePath: config.basePath });
    if (config.modelId) selectModel(config.modelId);
    this.useBackgroundEmbeddings = config.backgroundEmbeddings ?? false;
    this.reranker = config.reranker ?? null;
    this.injectedReranker = config.reranker !== undefined;
    this.vectorQueue = new CoalescingBackgroundQueue(
      async (task) => this.runVectorMaintenance(task),
    );
  }

  // ═══════════════ Sources ═══════════════

  get sources(): string[] { return cfg.getSources(); }
  get sourceRefs(): SourceRef[] { return listSourceRefs(); }

  /** List indexed Markdown entries inside one source-relative prefix. */
  listFiles(sourceSelector: string, pathPrefix = ""): FileEntry[] {
    const source = resolveSourceRef(sourceSelector);
    if (!source) return [];
    const normalizedPrefix = pathPrefix ? normalizeRelPath(pathPrefix).replace(/\/$/, "") : "";
    return Object.values(readSourceIndex(source.id))
      .filter((entry) => !normalizedPrefix || pathMatchesPrefix(entry.relPath, normalizedPrefix))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  addSource(absPath: string): boolean {
    const absolute = resolve(absPath);
    try {
      if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return false;
    } catch {
      return false;
    }
    return cfg.addSource(absolute);
  }

  removeSource(target: string): string | null {
    const source = resolveSourceRef(target);
    if (source) this.vectorQueue.cancelPrefix(`${source.id}\0`);
    const oldEntries = source ? Object.values(readSourceIndex(source.id)) : [];
    const removed = cfg.removeSource(source?.path ?? target);
    if (removed) {
      // source shard 自带 BM25/vector/manifest；批量删除，避免逐文件重复全库重建。
      idx.removeEntriesBySource(removed);
      for (const entry of oldEntries) cache.removeContent(entry.relPath, removed);
      cache.clearSource(removed);
      closeBm25Databases((source ?? sourceRefForPath(removed)).id);
      removeSourceShard((source ?? sourceRefForPath(removed)).id);
    }
    return removed;
  }

  async loadSource(absPath: string): Promise<number> {
    await this.vectorQueue.drain();
    absPath = resolve(absPath);
    const source = resolveSourceRef(absPath);
    if (!source) return 0;

    // 保存旧索引，用于检测删除
    const oldIndex = idx.getIndex();
    const oldKeys = new Set(Object.keys(oldIndex).filter(k => oldIndex[k].sourceDir === absPath));
    const oldSourceIndex = readSourceIndex(source.id);

    const entries = await scanDir(absPath);
    idx.mergeIndex(entries);
    writeSourceIndex(source, entries);

    // refresh 也要先令外部改动对应的旧向量/LLM 字段失效，再构建 BM25。
    for (const entry of entries) {
      const state = getFileState(entry.relPath, source.id);
      if (!state) continue;
      const content = cache.getContent(entry.relPath, entry.sourceDir);
      if (content !== undefined && computeMD5(content) !== state.md5) {
        markFileContentChanged(entry.relPath, content, source.id);
      }
    }

    // 检测已删除的文件
    const newKeys = new Set(entries.map(e => e.relPath));
    for (const oldKey of Object.keys(oldSourceIndex)) {
      if (!newKeys.has(oldKey)) {
        vec.removeEmbedding(oldKey, source.id);
        removeFileState(oldKey, source.id);
        cache.removeContent(oldKey, absPath);
      }
    }
    for (const oldKey of oldKeys) {
      if (!newKeys.has(oldKey)) {
        idx.removeEntry(oldKey);
      }
    }

    // 重建当前 source shard。已注册 source 的搜索直接聚合分片，不再重复构建全局副本。
    try {
      const sourceIndex = buildBm25Index(entries, source.id);
      writeBm25Index(sourceIndex, source.id);
      if (!resolveSourceRef(source.id)) {
        const index = buildBm25Index();
        writeBm25Index(index);
        writeBm25Stats(buildBm25Stats());
      }
    } catch { /* 统计失败不影响主流程 */ }

    if (cfg.getSemanticEnabled() && entries.length > 0) {
      await doGenerateEmbeddings(absPath, entries, source.id);
    } else if (entries.length === 0) {
      vec.clearCentroid(source.id);
    }
    return entries.length;
  }

  async load(): Promise<{ files: number; sources: number }> {
    const sources = cfg.getSources();
    let total = 0;
    for (const src of sources) total += await this.loadSource(src);
    return { files: total, sources: sources.length };
  }

  // ═══════════════ Search ═══════════════

  async search(
    query: string,
    mode: SearchMode = "keyword",
    scope?: SearchScope,
  ): Promise<SearchHit[]> {
    if (scope?.pathPrefix && !scope.source) {
      throw new Error("pathPrefix requires a source");
    }
    if (scope?.source) {
      const source = resolveSourceRef(scope.source);
      if (!source) throw new Error(`Unknown or ambiguous source: ${scope.source}`);
      if (!sourceIndexExists(source.id)) return [];
      const hits = await this.searchShard(query, mode, {
        sourceId: source.id,
        pathPrefix: scope.pathPrefix,
      });
      return this.maybeRerank(query, mode, hits);
    }

    const shards = listSourceRefs().filter((source) => sourceIndexExists(source.id));
    if (shards.length === 0) {
      return this.maybeRerank(query, mode, await this.searchShard(query, mode));
    }

    const hits: SearchHit[] = [];
    for (const source of shards) {
      hits.push(...await this.searchShard(query, mode, { sourceId: source.id }));
    }
    return this.maybeRerank(query, mode, hits.sort((a, b) => b.score - a.score));
  }

  private async searchShard(
    query: string,
    mode: SearchMode,
    scope?: SearchShardScope,
  ): Promise<SearchHit[]> {
    switch (mode) {
      case "keyword": return keywordSearch(query, scope);
      case "semantic": return semanticSearch(query, scope);
      case "hybrid": return hybridSearch(query, scope);
    }
  }

  /**
   * 精排严格位于全局 Hybrid/RRF 之后。任意精排失败都保留原结果与原顺序，
   * 因此它不会影响基础检索可用性。
   */
  private async maybeRerank(
    query: string,
    mode: SearchMode,
    hybridResults: SearchHit[],
  ): Promise<SearchHit[]> {
    if (mode !== "hybrid" || hybridResults.length === 0) return hybridResults;

    const config = getRerankerConfig();
    if (config.enabled !== true) {
      await this.disposeOwnedReranker();
      return hybridResults;
    }

    try {
      validateRerankerConfig(config);
      const configKey = JSON.stringify(config);
      if (!this.reranker) {
        this.reranker = new BgeReranker(config);
        this.rerankerConfigKey = configKey;
      } else if (!this.injectedReranker && this.rerankerConfigKey !== configKey) {
        await this.disposeOwnedReranker();
        this.reranker = new BgeReranker(config);
        this.rerankerConfigKey = configKey;
      }

      const candidates = hybridResults.slice(0, config.inputTopK)
        .map((hit, index) => ({ ...hit, originalRank: index + 1 }));
      const reranked = await this.reranker.rerank(query, candidates, {
        maxLength: config.maxLength,
        batchSize: config.batchSize,
      });
      if (reranked.length !== candidates.length) {
        throw new Error(`reranker returned ${reranked.length} hits for ${candidates.length} candidates`);
      }
      return reranked.slice(0, config.outputTopK);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[pwiki] reranker failed; returning Hybrid/RRF ranking: ${message}`);
      return hybridResults;
    }
  }

  private async disposeOwnedReranker(): Promise<void> {
    if (this.injectedReranker || !this.reranker) return;
    try { await this.reranker.dispose?.(); }
    catch (error) {
      console.error(`[pwiki] reranker cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
      this.reranker = null;
      this.rerankerConfigKey = "";
    }
  }

  // ═══════════════ Entries (CRUD) ═══════════════

  readEntry(
    pathOrRelPath: string,
    sourceSelector?: string,
  ): { entry: FileEntry; content: string } | null {
    if (sourceSelector) {
      const source = resolveSourceRef(sourceSelector);
      if (!source) return null;
      const relPath = normalizeRelPath(pathOrRelPath);
      const entry = readSourceIndex(source.id)[relPath];
      if (!entry || !pathMatchesPrefix(entry.relPath, relPath)) return null;

      let content = cache.getContent(entry.relPath, entry.sourceDir);
      if (!content) {
        try { content = readFileSync(resolveWithinSource(source.path, entry.relPath), "utf-8"); }
        catch { return null; }
      }
      return { entry, content };
    }

    // Try as relPath first, then as absolute path
    let entry = idx.getEntry(pathOrRelPath);
    if (!entry) {
      // Try matching by basename across all sources
      const all = idx.getIndex();
      for (const [key, e] of Object.entries(all)) {
        if (e.relPath === pathOrRelPath || key.endsWith(pathOrRelPath) || basename(key) === basename(pathOrRelPath)) {
          entry = e;
          break;
        }
      }
    }
    if (!entry) return null;

    let content = cache.getContent(entry.relPath, entry.sourceDir);
    if (!content) {
      try { content = readFileSync(resolve(entry.sourceDir, entry.relPath), "utf-8"); }
      catch { return null; }
    }
    return { entry, content };
  }

  /**
   * Resolve a mutation target without falling back to the global relPath map.
   *
   * Existing single-source callers may continue omitting sourceSelector. Once
   * more than one loaded source contains the same relative path, the target is
   * intentionally considered ambiguous and the mutation is rejected.
   */
  private resolveMutationEntry(
    relPath: string,
    sourceSelector?: string,
  ): { entry: FileEntry; source: SourceRef } | null {
    let normalizedPath: string;
    try {
      normalizedPath = normalizeMarkdownRelPath(relPath);
    } catch {
      return null;
    }

    if (sourceSelector !== undefined) {
      const source = resolveSourceRef(sourceSelector);
      if (!source) return null;
      const result = this.readEntry(normalizedPath, source.id);
      return result ? { entry: result.entry, source } : null;
    }

    const matches = listSourceRefs()
      .map((source) => {
        const result = this.readEntry(normalizedPath, source.id);
        return result ? { entry: result.entry, source } : null;
      })
      .filter((match): match is { entry: FileEntry; source: SourceRef } => !!match);
    return matches.length === 1 ? matches[0] : null;
  }

  async createEntry(
    sourceDir: string, relPath: string, title?: string,
    tags: string[] = [], content = "",
  ): Promise<string> {
    sourceDir = resolve(sourceDir);
    const source = resolveSourceRef(sourceDir);
    if (!source) return "source-not-found: " + sourceDir;
    sourceDir = source.path;

    let normalizedPath: string;
    try {
      normalizedPath = normalizeMarkdownRelPath(relPath);
    } catch (error) {
      return `invalid-path: ${error instanceof Error ? error.message : String(error)}`;
    }
    const finalPath = normalizedPath;
    const finalAbs = resolveWithinSource(sourceDir, normalizedPath);
    if (existsSync(finalAbs)) return "exists: " + finalAbs;

    const fm = [
      "---",
      "title: " + (title || basename(finalPath, ".md")),
      "tags: [" + tags.join(", ") + "]",
      "created: " + new Date().toISOString(),
      "---", "",
    ].join("\n");
    const fullContent = fm + content;

    try {
      mkdirSync(dirname(finalAbs), { recursive: true });
      writeFileSync(finalAbs, fullContent, "utf-8");
    } catch (error) {
      return `write-failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    const entry = parseFileEntry(sourceDir, finalAbs);
    if (entry) {
      idx.mergeIndex([entry]);
      cache.setContent(entry.relPath, fullContent, entry.sourceDir);
      upsertSourceEntries(source, [entry]);
      markFileContentChanged(entry.relPath, fullContent, source.id);
      this.updateBm25AfterChange(source, entry);
      await this.updateVectorsAfterChange(source, entry);
    }
    return normalizedPath;
  }

  async renameEntry(relPath: string, newTitle: string, sourceSelector?: string): Promise<boolean> {
    const resolved = this.resolveMutationEntry(relPath, sourceSelector);
    if (!resolved) return false;
    const { entry, source } = resolved;

    const fullPath = resolveWithinSource(source.path, entry.relPath);
    if (!existsSync(fullPath)) return false;

    let content: string;
    try { content = readFileSync(fullPath, "utf-8"); } catch { return false; }

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let newContent: string;
    if (fmMatch) {
      const fm = fmMatch[1];
      if (/^title:/m.test(fm)) {
        newContent = content.replace(/^title:.*$/m, `title: ${newTitle}`);
      } else {
        newContent = content.replace("---\n", `---\ntitle: ${newTitle}\n`);
      }
    } else {
      newContent = `---\ntitle: ${newTitle}\n---\n\n${content}`;
    }

    writeFileSync(fullPath, newContent, "utf-8");
    cache.setContent(entry.relPath, newContent, entry.sourceDir);

    entry.title = newTitle;
    idx.mergeIndex([entry]);
    upsertSourceEntries(source, [entry]);
    markFileContentChanged(entry.relPath, newContent, source.id);
    this.updateBm25AfterChange(source, entry);
    await this.updateVectorsAfterChange(source, entry);
    return true;
  }

  async moveEntry(relPath: string, newRelPath: string, sourceSelector?: string): Promise<boolean> {
    const resolved = this.resolveMutationEntry(relPath, sourceSelector);
    if (!resolved) return false;
    const { entry, source } = resolved;

    const normalizedOldPath = entry.relPath;
    let normalizedNewPath: string;
    try {
      normalizedNewPath = normalizeMarkdownRelPath(newRelPath);
    } catch {
      return false;
    }
    const srcFile = resolveWithinSource(source.path, normalizedOldPath);
    const dstFile = resolveWithinSource(source.path, normalizedNewPath);
    if (!existsSync(srcFile) || existsSync(dstFile)) return false;

    try {
      mkdirSync(dirname(dstFile), { recursive: true });
      renameSync(srcFile, dstFile);
    } catch { return false; }

    const newEntry = parseFileEntry(entry.sourceDir, dstFile);
    if (newEntry) {
      idx.updateEntryPath(normalizedOldPath, newEntry.relPath, newEntry);
      removeSourceEntry(source.id, normalizedOldPath);
      removeFileState(normalizedOldPath, source.id);
      cache.removeContent(normalizedOldPath, entry.sourceDir);
      upsertSourceEntries(source, [newEntry]);
      let newContent = "";
      try {
        newContent = readFileSync(dstFile, "utf-8");
        cache.setContent(newEntry.relPath, newContent, newEntry.sourceDir);
      } catch {}
      markFileContentChanged(newEntry.relPath, newContent, source.id);
      this.updateBm25AfterChange(source, newEntry, normalizedOldPath);
      await this.updateVectorsAfterChange(source, newEntry, normalizedOldPath);
    }
    return true;
  }

  async deleteEntry(relPath: string, sourceSelector?: string): Promise<boolean> {
    const resolved = this.resolveMutationEntry(relPath, sourceSelector);
    if (!resolved) return false;
    const { entry, source } = resolved;

    const normalizedPath = entry.relPath;
    const fullPath = resolveWithinSource(source.path, normalizedPath);
    if (!existsSync(fullPath)) return false;

    try { unlinkSync(fullPath); } catch { return false; }

    this.vectorQueue.cancelPrefix(`${source.id}\0embed\0${normalizedPath}`);
    idx.removeEntry(normalizedPath);
    removeSourceEntry(source.id, normalizedPath);
    removeFileState(normalizedPath, source.id);
    cache.removeContent(normalizedPath, entry.sourceDir);
    vec.removeEmbedding(normalizedPath, source.id);

    const sourceIndex = readBm25Index(source.id);
    if (sourceIndex) {
      removeDocFromIndex(normalizedPath, sourceIndex);
      writeBm25Index(sourceIndex, source.id);
    }

    // 兼容未注册 source 的旧全局索引模式。
    if (!resolveSourceRef(source.id)) {
      const globalIndex = readBm25Index();
      if (globalIndex) {
        removeDocFromIndex(normalizedPath, globalIndex);
        writeBm25Index(globalIndex);
        writeBm25Stats(bm25StatsFromIndex(globalIndex));
      }
    }
    return true;
  }

  async modifyEntry(sourceDir: string, relPath: string, content: string): Promise<boolean> {
    sourceDir = resolve(sourceDir);
    const source = resolveSourceRef(sourceDir);
    if (!source) return false;

    let normalizedPath: string;
    try {
      normalizedPath = normalizeMarkdownRelPath(relPath);
    } catch {
      return false;
    }
    const fullPath = resolveWithinSource(source.path, normalizedPath);
    if (!this.readEntry(normalizedPath, source.id)) return false;
    try {
      writeFileSync(fullPath, content, "utf-8");
      cache.setContent(normalizedPath, content, source.path);
      const entry = parseFileEntry(source.path, fullPath);
      if (entry) {
        idx.mergeIndex([entry]);
        upsertSourceEntries(source, [entry]);
        markFileContentChanged(entry.relPath, content, source.id);
        this.updateBm25AfterChange(source, entry);
        await this.updateVectorsAfterChange(source, entry);
      }
      return true;
    } catch { return false; }
  }

  /** 单文件 BM25 SQLite 事务更新；缺失索引时才全量构建一次。 */
  private updateBm25AfterChange(
    source: SourceRef,
    entry: FileEntry,
    previousRelPath?: string,
  ): void {
    if (!hasBm25Index(source.id)) {
      writeBm25Index(
        buildBm25Index(Object.values(readSourceIndex(source.id)), source.id),
        source.id,
      );
    } else {
      const documentIndex = buildBm25Index([entry], source.id);
      upsertBm25Document(
        documentIndex,
        entry.relPath,
        source.id,
        previousRelPath,
      );
    }

    // 未注册 source 的兼容模式才维护全局副本；正常搜索直接聚合 source shard。
    if (!resolveSourceRef(source.id)) {
      if (!hasBm25Index()) {
        const globalIndex = buildBm25Index();
        writeBm25Index(globalIndex);
        writeBm25Stats(bm25StatsFromIndex(globalIndex));
      } else {
        const documentIndex = buildBm25Index([entry], source.id);
        upsertBm25Document(documentIndex, entry.relPath, undefined, previousRelPath);
      }
    }
  }

  private async updateVectorsAfterChange(
    source: SourceRef,
    entry: FileEntry,
    previousRelPath?: string,
  ): Promise<void> {
    if (previousRelPath && previousRelPath !== entry.relPath) {
      const task: VectorMaintenanceTask = { kind: "remove", source, relPath: previousRelPath };
      if (this.useBackgroundEmbeddings) {
        this.vectorQueue.enqueue(`${source.id}\0remove\0${previousRelPath}`, task);
      } else {
        await this.runVectorMaintenance(task);
      }
    }
    if (!cfg.getSemanticEnabled()) return;

    const task: VectorMaintenanceTask = { kind: "embed", source, relPath: entry.relPath };
    if (this.useBackgroundEmbeddings) {
      this.vectorQueue.enqueue(`${source.id}\0embed\0${entry.relPath}`, task);
      return;
    }
    await this.runVectorMaintenance(task);
  }

  private async runVectorMaintenance(task: VectorMaintenanceTask): Promise<void> {
    if (task.kind === "remove") {
      vec.removeEmbedding(task.relPath, task.source.id);
      return;
    }
    if (!cfg.getSemanticEnabled() || !sourceIndexExists(task.source.id)) return;
    const entry = readSourceIndex(task.source.id)[task.relPath];
    if (!entry) return;
    let expectedMd5 = "";
    try {
      expectedMd5 = computeMD5(readFileSync(resolveWithinSource(task.source.path, task.relPath), "utf-8"));
    } catch { return; }
    await doGenerateEmbeddings(
      task.source.path,
      [entry],
      task.source.id,
      (relPath) => sourceIndexExists(task.source.id)
        && readSourceIndex(task.source.id)[relPath] !== undefined,
    );
    if (!cfg.getSemanticEnabled() || !sourceIndexExists(task.source.id)) return;
    const state = getFileState(task.relPath, task.source.id);
    let currentMd5 = "";
    try {
      currentMd5 = computeMD5(readFileSync(resolveWithinSource(task.source.path, task.relPath), "utf-8"));
    } catch { return; }
    if (currentMd5 !== expectedMd5) return; // 已被后续编辑取代，等待合并后的下一任务。
    if (!state?.hasSemanticVectors || state.semanticMd5 !== currentMd5) {
      throw new Error(`Vector update did not complete: ${task.relPath}`);
    }
  }

  backgroundVectorStatus(): BackgroundQueueStatus {
    return this.vectorQueue.status();
  }

  async waitForBackgroundTasks(): Promise<void> {
    await this.vectorQueue.drain();
  }

  /** Drain owned work and release this engine's BM25/reranker resources. */
  async dispose(): Promise<void> {
    await this.waitForBackgroundTasks();
    await this.disposeOwnedReranker();
    closeBm25Databases();
  }

  // ═══════════════ Chunk Read ═══════════════

  /**
   * 读取指定 chunk 的内容
   */
  readChunk(
    relPath: string,
    chunkIndex: number,
    sourceSelector?: string,
  ): ChunkReadResult | null {
    const result = this.readEntry(relPath, sourceSelector);
    if (!result) return null;
    const { entry, content } = result;
    const sourceId = sourceSelector
      ? resolveSourceRef(sourceSelector)?.id
      : sourceRefForPath(entry.sourceDir).id;

    const chunkKey = `${entry.relPath.replace(/\\/g, "/")}###${chunkIndex}`;
    const scopedChunkInfo = vec.getChunkInfo(sourceId);
    const ci = scopedChunkInfo[chunkKey] ?? vec.getChunkInfo()[chunkKey];
    if (!ci) return null;

    const lines = content.split("\n");
    const chunkContent = lines.slice((ci.startLine ?? 1) - 1, ci.endLine).join("\n");

    return {
      relPath,
      title: entry.title,
      chunkIndex,
      heading: ci.heading,
      headingPath: ci.headingPath,
      startLine: ci.startLine ?? 1,
      endLine: ci.endLine ?? lines.length,
      content: chunkContent,
    };
  }

  /**
   * 读取 chunk 及其前后相邻 chunk
   */
  readChunkContext(
    relPath: string,
    chunkIndex: number,
    before = 1,
    after = 1,
    sourceSelector?: string,
  ): ChunkContextResult | null {
    const current = this.readChunk(relPath, chunkIndex, sourceSelector);
    if (!current) return null;

    const previous: ChunkReadResult[] = [];
    const next: ChunkReadResult[] = [];

    for (let i = 1; i <= before; i++) {
      const prev = this.readChunk(relPath, chunkIndex - i, sourceSelector);
      if (prev) previous.unshift(prev);
    }
    for (let i = 1; i <= after; i++) {
      const nxt = this.readChunk(relPath, chunkIndex + i, sourceSelector);
      if (nxt) next.push(nxt);
    }

    return { current, previous, next };
  }

  // ═══════════════ Semantic ═══════════════

  get semanticEnabled(): boolean { return cfg.getSemanticEnabled(); }

  async enableSemantic(modelId?: string): Promise<{ ok: boolean; msg: string }> {
    if (modelId) {
      const m = findModel(modelId);
      if (!m) return { ok: false, msg: "Unknown model: " + modelId };
      selectModel(modelId);
    }
    const ok = await emb.initialize();
    if (!ok) return { ok: false, msg: "Init failed: " + (emb.getInitError() || "unknown") };
    cfg.setSemanticEnabled(true);
    return {
      ok: true,
      msg: `Semantic search ON. Model: ${emb.getModelName()}. Source: ${emb.getModelSource()}`,
    };
  }

  disableSemantic(): void { cfg.setSemanticEnabled(false); }

  async generateEmbeddings(sourceDir?: string): Promise<{ embedded: number }> {
    await this.vectorQueue.drain();
    if (!emb.isAvailable()) await emb.initialize();
    const sources = sourceDir
      ? [resolveSourceRef(sourceDir)].filter((source): source is SourceRef => !!source)
      : listSourceRefs();
    let total = 0;
    for (const source of sources) {
      const entries = Object.values(readSourceIndex(source.id));
      total += await doGenerateEmbeddings(source.path, entries, source.id);
    }
    return { embedded: total };
  }

  // ═══════════════ Model ═══════════════

  async downloadModel(modelId?: string): Promise<{ ok: boolean; msg: string }> {
    return emb.downloadModel(modelId);
  }

  listModels(): ModelInfo[] { return getBuiltinModels(); }

  /** Persist the active embedding model selection without starting a model load. */
  selectModel(modelId: string): ModelInfo | null { return selectModel(modelId); }

  // ═══════════════ LLM Compile ═══════════════

  get llmInfo() {
    // 通用环境变量优先，兼容旧变量名
    const apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
    const apiBase = process.env.LLM_API_BASE || (process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY
      ? "https://api.deepseek.com/v1"
      : process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : "");
    const model = process.env.LLM_MODEL || "deepseek-chat";
    return { apiBase, model, hasKey: !!apiKey };
  }

  compileStatus(sourceDir?: string) {
    const sources = sourceDir
      ? [resolveSourceRef(sourceDir)].filter((source): source is SourceRef => !!source)
      : listSourceRefs().filter((source) => sourceIndexExists(source.id));
    if (sources.length === 0) {
      const all = Object.keys(idx.getIndex())
        .filter(p => !sourceDir || idx.getIndex()[p]?.sourceDir === sourceDir);
      const compiled: string[] = [];
      const uncompiled: string[] = [];
      for (const relPath of all) {
        const state = getFileState(relPath);
        if (state?.llmCompiled) compiled.push(relPath);
        else uncompiled.push(relPath);
      }
      return { total: all.length, compiled: compiled.length, uncompiled };
    }

    const compiled: string[] = [];
    const uncompiled: string[] = [];
    for (const source of sources) {
      for (const relPath of Object.keys(readSourceIndex(source.id))) {
        const state = getFileState(relPath, source.id);
        if (state?.llmCompiled) compiled.push(relPath);
        else uncompiled.push(relPath);
      }
    }
    return { total: compiled.length + uncompiled.length, compiled: compiled.length, uncompiled };
  }

  getCompilePrompt(
    relPath: string,
    sourceSelector?: string,
  ): { system: string; user: string; sourceMD5: string } | null {
    const result = this.readEntry(relPath, sourceSelector);
    if (!result) return null;

    return {
      system: FILE_LLM_SYSTEM_PROMPT,
      user: buildFileLLMPrompt(relPath, result.content),
      sourceMD5: computeMD5(result.content),
    };
  }

  async storeCompiled(
    relPath: string,
    data: FileLLMData,
    opts?: { source?: string; sourceMD5?: string; model?: string },
  ): Promise<boolean> {
    await this.vectorQueue.drain();
    const result = this.readEntry(relPath, opts?.source);
    if (!result) return false;
    const expectedMD5 = opts?.sourceMD5 ?? computeMD5(result.content);
    return storeFileLLMVector(
      result.entry.sourceDir,
      result.entry.relPath,
      data,
      opts?.model,
      expectedMD5,
    );
  }

  async compileFile(
    relPath: string,
    opts?: { model?: string; force?: boolean; source?: string },
  ): Promise<{ ok: boolean; msg: string }> {
    await this.vectorQueue.drain();
    const result = this.readEntry(relPath, opts?.source);
    if (!result) return { ok: false, msg: "Not found: " + relPath };
    const { entry } = result;
    const source = sourceRefForPath(entry.sourceDir);
    const sourceId = sourceIndexExists(source.id) ? source.id : undefined;

    // 跳过已编译（除非 force）
    if (!opts?.force) {
      const currentMd5 = computeMD5(result.content);
      if (!isCompilationStale(entry.relPath, currentMd5, sourceId)) {
        return { ok: false, msg: "Already compiled: " + entry.relPath + " (use --force to recompile)" };
      }
    }

    const prompt = buildFileLLMPrompt(entry.relPath, result.content);
    const { hasKey, apiBase, model } = this.llmInfo;
    if (!hasKey) return { ok: false, msg: "No API key. Set LLM_API_KEY or DEEPSEEK_API_KEY" };
    const actualKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";

    const useModel = opts?.model || model;

    try {
      // P2.12: 按 provider 能力组装参数
      const supportsJsonMode = process.env.LLM_JSON_MODE !== "off";
      const supportsThinking = process.env.LLM_THINKING_PARAM !== "off";

      const body: Record<string, any> = {
        model: useModel,
        messages: [
          { role: "system", content: FILE_LLM_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      };
      if (supportsJsonMode) {
        body.response_format = { type: "json_object" };
      }
      if (supportsThinking) {
        body.thinking = { type: "disabled" };
      }

      const res = await fetch(apiBase + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + actualKey },
        body: JSON.stringify(body),
      });
      const data = await res.json() as any;
      if (!res.ok) {
        return { ok: false, msg: `API ${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
      }
      const raw = data?.choices?.[0]?.message?.content || "";
      const parsed = parseFileLLMResult(raw);
      if (!parsed) return { ok: false, msg: "Invalid JSON from LLM: " + raw.slice(0, 200) };

      const stored = await storeFileLLMVector(
        entry.sourceDir,
        entry.relPath,
        parsed,
        useModel,
        computeMD5(result.content),
      );
      if (!stored) {
        return { ok: false, msg: `Compilation became stale or vector storage failed: ${entry.relPath}` };
      }
      return { ok: true, msg: `Compiled: ${entry.relPath} → "${parsed.topic}"` };
    } catch (e: any) {
      return { ok: false, msg: "LLM error: " + e.message };
    }
  }

  async compileAll(sourceDir?: string, limit = 10, opts?: { model?: string; force?: boolean }): Promise<{ compiled: number; skipped: number; failed: number; msgs: string[] }> {
    let compiled = 0, skipped = 0, failed = 0;
    const msgs: string[] = [];
    const sources = sourceDir
      ? [resolveSourceRef(sourceDir)].filter((source): source is SourceRef => !!source)
      : listSourceRefs().filter((source) => sourceIndexExists(source.id));
    if (sources.length === 0) {
      const entries = Object.values(idx.getIndex()).filter(
        (entry) => !sourceDir || entry.sourceDir === sourceDir,
      );
      for (const entry of entries) {
        if (compiled >= limit) break;
        const r = await this.compileFile(entry.relPath, opts);
        if (r.ok) { compiled++; msgs.push("  " + r.msg); }
        else if (r.msg.startsWith("Already compiled")) { skipped++; }
        else { failed++; msgs.push("  FAIL: " + r.msg); }
      }
      return { compiled, skipped, failed, msgs };
    }
    for (const source of sources) {
      for (const entry of Object.values(readSourceIndex(source.id))) {
        if (compiled >= limit) break;
        const r = await this.compileFile(entry.relPath, { ...opts, source: source.id });
        if (r.ok) { compiled++; msgs.push("  " + r.msg); }
        else if (r.msg.startsWith("Already compiled")) { skipped++; }
        else { failed++; msgs.push("  FAIL: " + r.msg); }
      }
      if (compiled >= limit) break;
    }
    return { compiled, skipped, failed, msgs };
  }

  // ═══════════════ Status ═══════════════

  status(): WikiStatus {
    const c = cfg.readConfig();
    const sources = listSourceRefs();
    const indexedSources = sources.filter((source) => sourceIndexExists(source.id));
    const files = indexedSources.length > 0
      ? indexedSources.reduce(
        (total, source) => total + Object.keys(readSourceIndex(source.id)).length,
        0,
      )
      : idx.indexStats().files;
    const vectorStats = indexedSources.length > 0
      ? indexedSources.map((source) => vec.vectorsStats(source.id))
      : [vec.vectorsStats()];
    const manifestStats = indexedSources.length > 0
      ? indexedSources.map((source) => getManifestStats(source.id))
      : [getManifestStats()];
    const model = getCurrentModel();
    const rerankerConfig = getRerankerConfig();
    const rerankerStatus = this.reranker?.status?.();
    return {
      configPath: wikiHome(),
      sources: c.sources,
      files,
      lastScan: c.lastScan,
      semantic: c.semanticEnabled,
      embeddings: vectorStats.reduce((total, item) => total + item.embeddings, 0),
      centroid: vectorStats.some((item) => item.centroid),
      model: model.id,
      modelDim: model.dim,
      compiled: manifestStats.reduce((total, item) => total + item.compiled, 0),
      backgroundVectors: this.vectorQueue.status(),
      reranker: {
        ...rerankerConfig,
        loaded: rerankerStatus?.loaded ?? (this.reranker !== null),
        runtimeModel: rerankerStatus?.runtimeModel,
        lastError: rerankerStatus?.lastError,
      },
    };
  }
}
