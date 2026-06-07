#!/usr/bin/env node
// mcp/src/index.ts — Wiki MCP Server (stdio, v1.0)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WikiEngine, MODELS } from "@llangtop/pwiki-core";
import type { SearchMode } from "@llangtop/pwiki-core";

function defaultDir(): string {
  return (process.env.HOME || process.env.USERPROFILE || ".") + "/.pwiki";
}

const engine = new WikiEngine({
  basePath: process.env.WIKI_HOME || defaultDir(),
  modelId: process.env.WIKI_MODEL_ID || undefined,
});

const server = new McpServer({ name: "pwiki", version: "1.0.0" });

// ═══════════════ Helpers ═══════════════

function text(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

// ═══════════════ Search ═══════════════

server.tool(
  "wiki_search",
  "Search wiki. Default: hybrid (keyword + semantic RRF fusion). Requires loaded source (use wiki_status to check). Use wiki_read_entry on top results.",
  {
    query: z.string().describe("Search query"),
    mode: z.enum(["keyword", "semantic", "hybrid"]).optional()
      .describe("Search mode. Default: hybrid. Use 'keyword' for exact match, 'semantic' for meaning."),
    page: z.number().int().min(1).optional()
      .describe("Page number (1-based, 10 per page)"),
    fullContent: z.boolean().optional()
      .describe("Include full content (5 per page)"),
  },
  async ({ query, mode, page, fullContent }) => {
    const hits = await engine.search(query, (mode as SearchMode) ?? "hybrid");
    if (hits.length === 0) return text(`No results for "${query}" (${mode ?? "hybrid"})`);

    const limit = fullContent ? 5 : 10;
    const p = Math.max(1, page ?? 1);
    const pageHits = hits.slice((p - 1) * limit, p * limit);

    const lines = pageHits.map((h: any, i: number) => {
      const tags = h.tags.length ? ` [${h.tags.join(", ")}]` : "";
      const snippet = h.snippet ? `\n  ${h.snippet.replace(/\n/g, "\n  ")}` : "";
      // chunk 定位信息
      let loc = "";
      if (h.chunkIndex !== undefined) {
        loc += ` | chunk: ${h.chunkIndex}`;
        if (h.startLine !== undefined && h.endLine !== undefined) {
          loc += ` | lines: ${h.startLine}-${h.endLine}`;
        }
        if (h.headingPath?.length) {
          loc += ` | heading: ${h.headingPath.join(" > ")}`;
        } else if (h.chunkHeading) {
          loc += ` | heading: ${h.chunkHeading}`;
        }
      }
      return `${i + 1}. ${h.title}${tags}\n  ${h.relPath}${loc}${snippet}`;
    });

    return text(`"${query}" — ${hits.length} results (${mode ?? "hybrid"})\n\n${lines.join("\n\n")}`);
  },
);

// ═══════════════ Sources ═══════════════

server.tool(
  "wiki_load",
  "Load a directory as wiki data source. After loading, call wiki_refresh to enable semantic/hybrid search.",
  { path: z.string().describe("Absolute directory path") },
  async ({ path }) => {
    if (!engine.addSource(path)) return text(`Already loaded: ${path}`);
    const count = await engine.loadSource(path);
    return text(`Loaded ${count} .md files from ${path}`);
  },
);

server.tool(
  "wiki_unload",
  "Remove a data source. Omit path to list loaded sources.",
  { path: z.string().optional() },
  async ({ path }) => {
    if (!path) {
      const srcs = engine.sources;
      return text(srcs.length ? `Loaded sources:\n${srcs.map((s: string) => `  ${s}`).join("\n")}` : "No sources loaded.");
    }
    const removed = engine.removeSource(path);
    return text(removed ? `Removed: ${removed}` : `Not found: ${path}`);
  },
);

server.tool(
  "wiki_refresh",
  "Re-scan, rebuild index, and generate semantic embeddings. Required after wiki_load for hybrid/semantic search. Also use after external file changes.",
  { source: z.string().optional().describe("Source path. Omit to refresh all.") },
  async ({ source }) => {
    if (source) {
      const count = await engine.loadSource(source);
      return text(`Refreshed ${source}: ${count} files`);
    }
    const result = await engine.load();
    return text(`Refreshed all: ${result.files} files from ${result.sources} sources`);
  },
);

// ═══════════════ Entries ═══════════════

server.tool(
  "wiki_read_entry",
  "Read a wiki entry's full content by its relative path.",
  { path: z.string().describe("Relative path (from search results)") },
  async ({ path }) => {
    const result = engine.readEntry(path);
    if (!result) return text(`Not found: ${path}`);
    return text(`# ${result.entry.title}\n\n${result.content}`);
  },
);

server.tool(
  "wiki_create_entry",
  "Create a new .md entry in a data source. Auto-generates frontmatter.",
  {
    source: z.string().describe("Source directory path"),
    path: z.string().describe("Relative path for the new file"),
    title: z.string().optional().describe("Document title"),
    tags: z.array(z.string()).optional().describe("Tags"),
    content: z.string().optional().describe("Body content (after frontmatter)"),
  },
  async ({ source, path, title, tags, content }) => {
    const result = await engine.createEntry(source, path, title, tags ?? [], content ?? "");
    return text(result.startsWith("exists") ? result : `Created: ${result}`);
  },
);

server.tool(
  "wiki_rename_entry",
  "Rename a wiki entry's title (updates frontmatter).",
  {
    path: z.string().describe("Relative path of the entry"),
    title: z.string().describe("New title"),
  },
  async ({ path, title }) => {
    const ok = await engine.renameEntry(path, title);
    return text(ok ? `Renamed ${path} to "${title}"` : `Not found: ${path}`);
  },
);

server.tool(
  "wiki_move_entry",
  "Move a wiki entry to a new relative path within the same source.",
  {
    path: z.string().describe("Current relative path"),
    newPath: z.string().describe("New relative path"),
  },
  async ({ path, newPath }) => {
    const ok = await engine.moveEntry(path, newPath);
    return text(ok ? `Moved ${path} to ${newPath}` : `Failed: source not found or target exists`);
  },
);

server.tool(
  "wiki_modify_entry",
  "Replace a wiki entry's full content. Requires the complete new content including frontmatter.",
  {
    source: z.string().describe("Source directory path"),
    path: z.string().describe("Relative path of the entry"),
    content: z.string().describe("New full content (including frontmatter)"),
  },
  async ({ source, path, content }) => {
    const ok = await engine.modifyEntry(source, path, content);
    return text(ok ? `Modified: ${path}` : `Failed to modify: ${path}`);
  },
);

// ═══════════════ Semantic ═══════════════

server.tool(
  "wiki_enable_semantic",
  "Enable/disable semantic search. Optionally switch embedding model.",
  {
    enabled: z.boolean(),
    modelId: z.string().optional().describe("Model id (e.g. bge-base-zh-v1.5)"),
  },
  async ({ enabled, modelId }) => {
    if (!enabled) { engine.disableSemantic(); return text("Semantic search OFF."); }
    const result = await engine.enableSemantic(modelId);
    return text(result.msg);
  },
);

server.tool(
  "wiki_generate_embeddings",
  "Generate embeddings for indexed files. Requires semantic search enabled.",
  { source: z.string().optional().describe("Source to embed. Omit for all.") },
  async ({ source }) => {
    try {
      const result = await engine.generateEmbeddings(source);
      return text(`Embedded: ${result.embedded} files`);
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

// ═══════════════ Compile ═══════════════

server.tool(
  "wiki_compile_status",
  "Show which files have been LLM-compiled (improves search quality). Use wiki_compile to compile unprocessed files.",
  {
    source: z.string().optional(),
    uncompiledOnly: z.boolean().optional(),
  },
  async ({ source, uncompiledOnly }) => {
    const stats = engine.compileStatus(source);
    const list = uncompiledOnly ? stats.uncompiled : [];
    const maxShow = 20;
    const shown = list.slice(0, maxShow);
    let out = `Total: ${stats.total}\nCompiled: ${stats.compiled}\nUncompiled: ${stats.uncompiled.length}`;
    if (shown.length > 0) {
      out += `\n\nUncompiled:\n${shown.join("\n")}`;
      if (list.length > maxShow) out += `\n\n... and ${list.length - maxShow} more`;
    }
    return text(out);
  },
);

server.tool(
  "wiki_get_compile_prompt",
  "Get the LLM prompt for compiling a file. Call LLM with this prompt, then use wiki_store_compiled.",
  { path: z.string().describe("Relative path of the file to compile") },
  async ({ path }) => {
    const prompt = engine.getCompilePrompt(path);
    if (!prompt) return text(`Not found or empty: ${path}`);
    return text(`System:\n${prompt.system}\n\nUser:\n${prompt.user}`);
  },
);

server.tool(
  "wiki_store_compiled",
  "Store LLM compilation result for a file. Use after calling LLM with wiki_get_compile_prompt.",
  {
    path: z.string().describe("Relative path"),
    topic: z.string().describe("Core topic (one sentence)"),
    normalizedText: z.string().describe("Normalized text"),
    concepts: z.array(z.string()).describe("Core concepts"),
    aliases: z.array(z.string()).describe("Synonyms / aliases"),
  },
  async ({ path, topic, normalizedText, concepts, aliases }) => {
    // The actual async store is handled internally via compileFile
    // For external LLM results, we need to import storeFileLLMVector directly
    const { storeFileLLMVector } = await import("@llangtop/pwiki-core");
    const { getIndex } = await import("@llangtop/pwiki-core");
    const idx = getIndex();
    const entry = idx[path];
    if (!entry) return text(`Not found in index: ${path}`);
    const ok = await storeFileLLMVector(entry.sourceDir, path, { topic, normalizedText, concepts, aliases });
    return text(ok ? `Stored compilation for ${path}` : `Failed to store compilation for ${path}`);
  },
);

server.tool(
  "wiki_compile",
  "Compile a file using LLM. Extracts topic/normalizedText/concepts/aliases to improve search quality. Skips already-compiled files by default.",
  {
    path: z.string().describe("Relative path of the file to compile"),
    model: z.string().optional().describe("LLM model (default: deepseek-chat). Set LLM_API_KEY + LLM_API_BASE env vars."),
    force: z.boolean().optional().describe("Recompile even if already compiled"),
  },
  async ({ path, model, force }) => {
    const r = await engine.compileFile(path, { model, force });
    return text(r.msg);
  },
);

server.tool(
  "wiki_compile_all",
  "Batch compile uncompiled files using LLM. Skips already-compiled files.",
  {
    source: z.string().optional().describe("Source to compile. Omit for all."),
    limit: z.number().int().min(1).optional().describe("Max files to process (default 10)"),
    model: z.string().optional().describe("LLM model (default: deepseek-chat)"),
    force: z.boolean().optional().describe("Recompile all including already-compiled"),
  },
  async ({ source, limit, model, force }) => {
    const r = await engine.compileAll(source, limit ?? 10, { model, force });
    return text(`Compiled: ${r.compiled}, Skipped: ${r.skipped}, Failed: ${r.failed}\n${r.msgs.join("\n")}`);
  },
);

// ═══════════════ Chunk Read ═══════════════

server.tool(
  "wiki_read_chunk",
  "Read a specific chunk from a wiki entry by chunk index. Use after wiki_search returns chunkIndex.",
  {
    path: z.string().describe("Relative path of the entry"),
    chunkIndex: z.number().int().min(0).describe("Chunk index from search results"),
  },
  async ({ path, chunkIndex }) => {
    const result = engine.readChunk(path, chunkIndex);
    if (!result) return text(`Not found: ${path} chunk ${chunkIndex}`);
    const hpath = result.headingPath?.length ? `\nHeading: ${result.headingPath.join(" > ")}` : "";
    const loc = `\nLines: ${result.startLine}-${result.endLine}`;
    return text(`# ${result.title} [chunk ${chunkIndex}]${hpath}${loc}\n\n${result.content}`);
  },
);

server.tool(
  "wiki_read_context",
  "Read a chunk and its surrounding context (before/after chunks).",
  {
    path: z.string().describe("Relative path of the entry"),
    chunkIndex: z.number().int().min(0).describe("Chunk index from search results"),
    before: z.number().int().min(0).optional().describe("Chunks to include before (default 1)"),
    after: z.number().int().min(0).optional().describe("Chunks to include after (default 1)"),
  },
  async ({ path, chunkIndex, before, after }) => {
    const result = engine.readChunkContext(path, chunkIndex, before ?? 1, after ?? 1);
    if (!result) return text(`Not found: ${path} chunk ${chunkIndex}`);
    const parts: string[] = [];
    for (const prev of result.previous) {
      parts.push(`## Previous (chunk ${prev.chunkIndex})\n${prev.content}\n`);
    }
    parts.push(`## Current (chunk ${result.current.chunkIndex})\n${result.current.content}\n`);
    for (const nxt of result.next) {
      parts.push(`## Next (chunk ${nxt.chunkIndex})\n${nxt.content}\n`);
    }
    return text(`# ${result.current.title}\n\n${parts.join("\n")}`);
  },
);

// ═══════════════ Status & Models ═══════════════

server.tool(
  "wiki_llm_status",
  "Show LLM configuration: API base URL, model name, and whether API key is set. Set LLM_API_BASE + LLM_API_KEY env vars (or DEEPSEEK_API_KEY/OPENAI_API_KEY for compatibility).",
  {},
  async () => {
    const info = engine.llmInfo;
    return text([
      `API Base: ${info.apiBase}`,
      `Model: ${info.model}`,
      `API Key: ${info.hasKey ? "set" : "NOT SET (set DEEPSEEK_API_KEY or OPENAI_API_KEY)"}`,
    ].join("\n"));
  },
);

server.tool(
  "wiki_status",
  "Set WIKI_HOME env var and call this first to check readiness. If sources=0, call wiki_load. If semantic=OFF, call wiki_enable_semantic. If embeddings < files, call wiki_refresh.",
  {},
  async () => {
    const s = engine.status();
    const lines = [
      `Config:     ${s.configPath}`,
      `Sources:    ${s.sources.length}`,
      `Files:      ${s.files}`,
      `Semantic:   ${s.semantic ? "ON" : "OFF"}`,
      `Embeddings: ${s.embeddings}`,
      `Centroid:   ${s.centroid ? "yes" : "no"}`,
      `Compiled:   ${s.compiled}`,
      `Model:      ${s.model} (${s.modelDim}d)`,
      `Last scan:  ${s.lastScan || "never"}`,
    ];
    if (s.sources.length > 0) {
      lines.push("", "Source directories:", ...s.sources.map((s: string) => `  ${s}`));
    }
    return text(lines.join("\n"));
  },
);

server.tool(
  "wiki_list_models",
  "List embedding models with dimensions, languages, and token limits. Returns structured JSON array.",
  {},
  async () => {
    const models = MODELS.map((m: any) => ({
      id: m.id,
      name: m.name,
      dim: m.dim,
      languages: m.languages,
      maxTokens: m.maxTokens,
      int8Size: m.int8Size,
    }));
    return text(JSON.stringify(models, null, 2));
  },
);

// ═══════════════ Start ═══════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
