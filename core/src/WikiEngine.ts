// WikiEngine.ts — 协调层 (v1.0)
//
// 唯一对外 API。组装所有 lib 模块，提供 chained + async 的编程接口。
// CLI / MCP / 库用户均通过此类交互。

import { resolve, join, dirname, basename } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, statSync } from "node:fs";
import { initWikiConfig, setWikiHome, wikiHome, configFile } from "./config.js";
import * as cfg from "./lib/store-config.js";
import * as idx from "./lib/store-index.js";
import * as vec from "./lib/store-vectors.js";
import * as emb from "./lib/embedder.js";
import * as cache from "./lib/content-cache.js";
import { keywordSearch } from "./lib/search.js";
import { semanticSearch, hybridSearch } from "./lib/semantic-search.js";
import { scanDir } from "./lib/indexer-scan.js";
import { generateEmbeddings as doGenerateEmbeddings } from "./lib/indexer-embed.js";
import { getRawChunks, storeCompiledChunks, storeFileLLMVector } from "./lib/indexer-compile.js";
import { getManifest, getFileState, getManifestStats, computeMD5 } from "./lib/file-manifest.js";
import { parseFileEntry } from "./lib/parser.js";
import {
  COMPILE_SYSTEM_PROMPT, buildCompilePrompt, parseCompiledResult,
  FILE_LLM_SYSTEM_PROMPT, buildFileLLMPrompt, parseFileLLMResult,
} from "./lib/semantic-compiler.js";
import { findModel, getCurrentModel, selectModel, getBuiltinModels } from "./lib/model-registry.js";
import type { ModelInfo } from "./lib/model-registry.js";
import type { SearchMode, SearchHit, FileEntry, FileLLMData, WikiStatus } from "./lib/types.js";

export interface EngineConfig {
  basePath?: string;
  modelId?: string;
}

export class WikiEngine {
  constructor(config: EngineConfig = {}) {
    initWikiConfig({ basePath: config.basePath });
    if (config.modelId) selectModel(config.modelId);
  }

  // ═══════════════ Sources ═══════════════

  get sources(): string[] { return cfg.getSources(); }

  addSource(absPath: string): boolean {
    return cfg.addSource(absPath);
  }

  removeSource(target: string): string | null {
    const removed = cfg.removeSource(target);
    if (removed) idx.removeEntriesBySource(removed);
    return removed;
  }

  async loadSource(absPath: string): Promise<number> {
    const entries = await scanDir(absPath);
    idx.mergeIndex(entries);
    if (cfg.getSemanticEnabled() && entries.length > 0) {
      doGenerateEmbeddings(absPath, entries).catch(() => {});
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

  async search(query: string, mode: SearchMode = "keyword"): Promise<SearchHit[]> {
    switch (mode) {
      case "keyword": return keywordSearch(query);
      case "semantic": return semanticSearch(query);
      case "hybrid": return hybridSearch(query);
    }
  }

  // ═══════════════ Entries (CRUD) ═══════════════

  readEntry(pathOrRelPath: string): { entry: FileEntry; content: string } | null {
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

    let content = cache.getContent(entry.relPath);
    if (!content) {
      try { content = readFileSync(resolve(entry.sourceDir, entry.relPath), "utf-8"); }
      catch { return null; }
    }
    return { entry, content };
  }

  createEntry(
    sourceDir: string, relPath: string, title?: string,
    tags: string[] = [], content = "",
  ): string {
    const finalPath = relPath.endsWith(".md") ? relPath : relPath + ".md";
    const finalAbs = resolve(sourceDir, finalPath);
    if (existsSync(finalAbs)) return "exists: " + finalAbs;

    const fm = [
      "---",
      "title: " + (title || basename(finalPath, ".md")),
      "tags: [" + tags.join(", ") + "]",
      "created: " + new Date().toISOString(),
      "---", "",
    ].join("\n");

    mkdirSync(dirname(finalAbs), { recursive: true });
    writeFileSync(finalAbs, fm + content, "utf-8");

    const entry = parseFileEntry(sourceDir, finalAbs);
    if (entry) {
      idx.mergeIndex([entry]);
      cache.setContent(entry.relPath, fm + content);
    }
    return finalPath.replace(/\\/g, "/");
  }

  renameEntry(relPath: string, newTitle: string): boolean {
    const entry = idx.getEntry(relPath);
    if (!entry) return false;

    const fullPath = resolve(entry.sourceDir, entry.relPath);
    if (!existsSync(fullPath)) return false;

    let content: string;
    try { content = readFileSync(fullPath, "utf-8"); } catch { return false; }

    // Update frontmatter title or add one
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
    cache.setContent(entry.relPath, newContent);

    // Update index entry
    entry.title = newTitle;
    idx.mergeIndex([entry]);
    return true;
  }

  moveEntry(relPath: string, newRelPath: string): boolean {
    const entry = idx.getEntry(relPath);
    if (!entry) return false;

    const srcFile = resolve(entry.sourceDir, relPath);
    const dstFile = resolve(entry.sourceDir, newRelPath);
    if (!existsSync(srcFile) || existsSync(dstFile)) return false;

    try {
      mkdirSync(dirname(dstFile), { recursive: true });
      renameSync(srcFile, dstFile);
    } catch { return false; }

    const newEntry = parseFileEntry(entry.sourceDir, dstFile);
    if (newEntry) {
      idx.removeEntry(relPath);
      idx.mergeIndex([newEntry]);
    }
    return true;
  }

  modifyEntry(sourceDir: string, relPath: string, content: string): boolean {
    const fullPath = resolve(sourceDir, relPath);
    try {
      writeFileSync(fullPath, content, "utf-8");
      cache.setContent(relPath, content);
      const entry = parseFileEntry(sourceDir, fullPath);
      if (entry) idx.mergeIndex([entry]);
      return true;
    } catch { return false; }
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
    if (!emb.isAvailable()) await emb.initialize();
    const all = Object.values(idx.getIndex()).filter(
      e => !sourceDir || e.sourceDir === sourceDir,
    );
    const bySource = new Map<string, FileEntry[]>();
    for (const e of all) {
      const list = bySource.get(e.sourceDir) || [];
      list.push(e);
      bySource.set(e.sourceDir, list);
    }
    let total = 0;
    for (const [src, ents] of bySource) {
      total += await doGenerateEmbeddings(src, ents);
    }
    return { embedded: total };
  }

  // ═══════════════ Model ═══════════════

  async downloadModel(modelId?: string): Promise<{ ok: boolean; msg: string }> {
    return emb.downloadModel(modelId);
  }

  listModels(): ModelInfo[] { return getBuiltinModels(); }

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

  getCompilePrompt(relPath: string): { system: string; user: string } | null {
    const cached = cache.getContent(relPath);
    const entry = idx.getEntry(relPath);
    if (!cached && !entry) return null;

    let content = cached;
    if (!content && entry) {
      try { content = readFileSync(resolve(entry.sourceDir, entry.relPath), "utf-8"); }
      catch { return null; }
    }
    if (!content) return null;

    return {
      system: FILE_LLM_SYSTEM_PROMPT,
      user: buildFileLLMPrompt(relPath, content),
    };
  }

  storeCompiled(relPath: string, data: FileLLMData): boolean {
    const entry = idx.getEntry(relPath);
    if (!entry) return false;
    return true; // The actual storage is async — handled by storeFileLLMVector
  }

  async compileFile(relPath: string, opts?: { model?: string; force?: boolean }): Promise<{ ok: boolean; msg: string }> {
    const entry = idx.getEntry(relPath);
    if (!entry) return { ok: false, msg: "Not found: " + relPath };

    // 跳过已编译（除非 force）
    if (!opts?.force) {
      const state = getFileState(relPath);
      if (state?.llmCompiled) return { ok: false, msg: "Already compiled: " + relPath + " (use --force to recompile)" };
    }

    let content = cache.getContent(relPath);
    if (!content) {
      try { content = readFileSync(resolve(entry.sourceDir, entry.relPath), "utf-8"); }
      catch { return { ok: false, msg: "Cannot read: " + relPath }; }
    }

    const prompt = buildFileLLMPrompt(relPath, content);
    const { hasKey, apiBase, model } = this.llmInfo;
    if (!hasKey) return { ok: false, msg: "No API key. Set LLM_API_KEY or DEEPSEEK_API_KEY" };
    const actualKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";

    const useModel = opts?.model || model;

    try {
      const res = await fetch(apiBase + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + actualKey },
        body: JSON.stringify({
          model: useModel,
          messages: [
            { role: "system", content: FILE_LLM_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
      });
      const data = await res.json() as any;
      const raw = data?.choices?.[0]?.message?.content || "";
      const parsed = parseFileLLMResult(raw);
      if (!parsed) return { ok: false, msg: "Invalid JSON from LLM: " + raw.slice(0, 200) };

      await storeFileLLMVector(entry.sourceDir, relPath, parsed, useModel);
      return { ok: true, msg: `Compiled: ${relPath} → "${parsed.topic}"` };
    } catch (e: any) {
      return { ok: false, msg: "LLM error: " + e.message };
    }
  }

  async compileAll(sourceDir?: string, limit = 10, opts?: { model?: string; force?: boolean }): Promise<{ compiled: number; skipped: number; failed: number; msgs: string[] }> {
    let compiled = 0, skipped = 0, failed = 0;
    const msgs: string[] = [];
    const entries = Object.values(idx.getIndex()).filter(
      e => !sourceDir || e.sourceDir === sourceDir,
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

  // ═══════════════ Status ═══════════════

  status(): WikiStatus {
    const c = cfg.readConfig();
    const i = idx.indexStats();
    const v = vec.vectorsStats();
    const m = getManifestStats();
    const model = getCurrentModel();
    return {
      configPath: wikiHome(),
      sources: c.sources,
      files: i.files,
      lastScan: c.lastScan,
      semantic: c.semanticEnabled,
      embeddings: v.embeddings,
      centroid: v.centroid,
      model: model.id,
      modelDim: model.dim,
      compiled: m.compiled,
    };
  }
}
