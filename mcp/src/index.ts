#!/usr/bin/env node
// mcp/src/index.ts — Wiki MCP Server (stdio, v1.0)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WikiEngine, MODELS, setRerankerConfig } from "@llangtop/pwiki-core";
import type { SearchMode } from "@llangtop/pwiki-core";

function defaultDir(): string {
  return (process.env.HOME || process.env.USERPROFILE || ".") + "/.pwiki";
}

const engine = new WikiEngine({
  basePath: process.env.WIKI_HOME || defaultDir(),
  modelId: process.env.WIKI_MODEL_ID || undefined,
  backgroundEmbeddings: true,
});

const SERVER_INSTRUCTIONS = [
  "Pwiki is a local Markdown knowledge-base server.",
  "Call wiki_status first. If sources=0, call wiki_load, then wiki_refresh before semantic or hybrid search.",
  "The optional Cross-Encoder reranker is disabled by default; configure it explicitly with wiki_configure_reranker before hybrid search.",
  "For bounded retrieval, pass source and optional pathPrefix to wiki_search; scoped search never falls back to global data.",
  "Pass the returned sourceId to wiki_read_entry, wiki_read_chunk, or wiki_read_context.",
  "Use the pwiki://guide/operations and pwiki://guide/tool-reference resources for the full workflow and command reference.",
].join(" ");

const OPERATION_GUIDE = `# Pwiki operation guide

## Read and search

1. Call \`wiki_status\` to inspect sources, files, semantic state, embeddings, and compilation state.
2. If no source is loaded, call \`wiki_load\` with an absolute directory, then \`wiki_refresh\`.
3. For bounded retrieval, choose a source ID from \`wiki_status\`, then call \`wiki_search\` with \`source\` and optional source-relative \`pathPrefix\`. A scoped search never falls back to global data.
4. Use \`keyword\` for exact terms, \`semantic\` for meaning, or the default \`hybrid\` mode.
5. Read the best result with \`wiki_read_entry\`, \`wiki_read_chunk\`, or \`wiki_read_context\`, passing its \`sourceId\`.

## Maintain sources and entries

- Use \`wiki_load\` to add a source and \`wiki_unload\` to remove one.
- Use \`wiki_refresh\` after loading a source or when Markdown files change outside Pwiki.
- Use \`wiki_create_entry\`, \`wiki_modify_entry\`, \`wiki_rename_entry\`, and \`wiki_move_entry\` only for deliberate content changes. BM25 is updated before these tools return; semantic vectors are queued in the background.

## Semantic search and LLM compilation

- Use \`wiki_enable_semantic\` and \`wiki_generate_embeddings\` when semantic search is not ready.
- Use \`wiki_configure_reranker\` only when a post-Hybrid Cross-Encoder rerank is wanted. It persists configuration but does not download or load a model; the first enabled Hybrid search does that lazily.
- Use \`wiki_compile_status\` before \`wiki_compile\` or \`wiki_compile_all\`.
- For an external LLM workflow, call \`wiki_get_compile_prompt\`, then store the validated result with \`wiki_store_compiled\`.

## Safety

Status, search, read, and list operations are non-mutating. Loading, refreshing, editing, embedding, compiling, unloading, and reranker configuration change local state and should be confirmed by the host workflow.`;

const TOOL_REFERENCE = `# Pwiki command reference

## Diagnose and retrieve

- \`wiki_status\`: readiness and next-step guidance.
- \`wiki_search\`: search entries; use \`source\` and \`pathPrefix\` to avoid loading or scoring unrelated data.
- \`wiki_read_entry\`, \`wiki_read_chunk\`, \`wiki_read_context\`: retrieve full, focused, or surrounding content.
- \`wiki_list_models\`, \`wiki_llm_status\`, \`wiki_compile_status\`: inspect available models and processing state.

## Sources and entries

- \`wiki_load\`, \`wiki_refresh\`, \`wiki_unload\`: add, update, or remove a source.
- \`wiki_create_entry\`, \`wiki_modify_entry\`, \`wiki_rename_entry\`, \`wiki_move_entry\`: create or change Markdown entries.

## Semantic and compilation lifecycle

- \`wiki_enable_semantic\`, \`wiki_generate_embeddings\`: configure semantic search and vectors.
- \`wiki_configure_reranker\`: explicitly enable or configure post-Hybrid Cross-Encoder reranking.
- \`wiki_get_compile_prompt\`, \`wiki_store_compiled\`, \`wiki_compile\`, \`wiki_compile_all\`: create or store LLM-derived compilation metadata.

Read each tool's \`description\` and \`inputSchema\` before use; they contain the exact preconditions and arguments.`;

const server = new McpServer(
  { name: "pwiki", version: "1.3.2" },
  { instructions: SERVER_INSTRUCTIONS },
);

// ═══════════════ Helpers ═══════════════

function text(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

function maintenanceSuffix(): string {
  return engine.semanticEnabled
    ? " BM25 updated; semantic vector update queued."
    : " BM25 updated; semantic search is disabled, so no vector job was queued.";
}

server.registerResource(
  "pwiki-operation-guide",
  "pwiki://guide/operations",
  {
    title: "Pwiki operation guide",
    description: "Safe setup, search, maintenance, semantic-search, and compilation workflow.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: OPERATION_GUIDE }],
  }),
);

server.registerResource(
  "pwiki-tool-reference",
  "pwiki://guide/tool-reference",
  {
    title: "Pwiki command reference",
    description: "Grouped Pwiki MCP command list with the recommended next action.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: TOOL_REFERENCE }],
  }),
);

server.registerPrompt(
  "pwiki-search-workflow",
  {
    title: "Pwiki search workflow",
    description: "Reusable workflow for answering a question from the local wiki.",
    argsSchema: { query: z.string().min(1).describe("Question or search terms") },
  },
  async ({ query }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Use the Pwiki search workflow for: ${query}\n\n1. Call wiki_status.\n2. If no source exists, ask before loading one.\n3. Select the relevant source ID and call wiki_search with source and an optional source-relative pathPrefix.\n4. Read the most relevant result with wiki_read_entry, wiki_read_chunk, or wiki_read_context, passing its sourceId.\n5. Answer from the retrieved content and cite its sourceId plus relative path.`,
      },
    }],
  }),
);

server.registerPrompt(
  "pwiki-maintenance-workflow",
  {
    title: "Pwiki maintenance workflow",
    description: "Review the safe lifecycle before changing a source, index, or entry.",
  },
  async () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: "Use the Pwiki maintenance workflow. Start with wiki_status. Explain the intended change and obtain the host's required confirmation before wiki_load, wiki_refresh, wiki_unload, entry edits, embedding generation, LLM compilation, or reranker configuration. Verify with wiki_status or a targeted search afterwards.",
      },
    }],
  }),
);

// ═══════════════ Search ═══════════════

server.tool(
  "wiki_search",
  "Search wiki. Default: hybrid (keyword + semantic RRF fusion). If reranker.enabled was explicitly configured, Hybrid's Top-N candidates are then Cross-Encoder reranked. Set source to search only that physical source shard; pathPrefix further limits search to a source-relative directory or file. Scoped search never falls back to global data. Use wiki_read_entry with the returned sourceId.",
  {
    query: z.string().describe("Search query"),
    mode: z.enum(["keyword", "semantic", "hybrid"]).optional()
      .describe("Search mode. Default: hybrid. Use 'keyword' for exact match, 'semantic' for meaning."),
    source: z.string().optional()
      .describe("Source ID, unique source name, or source path. Restricts retrieval to that source shard."),
    pathPrefix: z.string().optional()
      .describe("Source-relative directory or .md file. Requires source; filtering happens before scoring."),
    page: z.number().int().min(1).optional()
      .describe("Page number (1-based, 10 per page)"),
    fullContent: z.boolean().optional()
      .describe("Include full content (5 per page)"),
  },
  async ({ query, mode, source, pathPrefix, page, fullContent }) => {
    let hits;
    try {
      hits = await engine.search(
        query,
        (mode as SearchMode) ?? "hybrid",
        { source, pathPrefix },
      );
    } catch (error: any) {
      return text(`Search failed: ${error?.message ?? String(error)}`);
    }
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
      const sourceLabel = h.sourceId ? ` | source: ${h.sourceId}` : "";
      const reranker = h.rerankerScore === undefined
        ? ""
        : ` | reranker: ${h.rerankerScore.toFixed(4)} | original rank: ${h.originalRank ?? "?"}`;
      return `${i + 1}. ${h.title}${tags}\n  ${h.relPath}${sourceLabel}${loc}${reranker}${snippet}`;
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
  "Read a wiki entry's full content by source-relative path. Pass source from wiki_search when available, especially when sources contain the same relative path.",
  {
    path: z.string().describe("Source-relative path from search results"),
    source: z.string().optional().describe("Source ID returned by wiki_search, or a unique source name/path"),
  },
  async ({ path, source }) => {
    const result = engine.readEntry(path, source);
    if (!result) return text(`Not found: ${path}`);
    return text(`# ${result.entry.title}\n\n${result.content}`);
  },
);

server.tool(
  "wiki_create_entry",
  "Create a new .md entry in a data source. Auto-generates frontmatter. BM25 updates synchronously; semantic vectors update in the background.",
  {
    source: z.string().describe("Source directory path"),
    path: z.string().describe("Relative path for the new file"),
    title: z.string().optional().describe("Document title"),
    tags: z.array(z.string()).optional().describe("Tags"),
    content: z.string().optional().describe("Body content (after frontmatter)"),
  },
  async ({ source, path, title, tags, content }) => {
    const result = await engine.createEntry(source, path, title, tags ?? [], content ?? "");
    return text(result.startsWith("exists") ? result : `Created: ${result}.${maintenanceSuffix()}`);
  },
);

server.tool(
  "wiki_rename_entry",
  "Rename a wiki entry's title (updates frontmatter). BM25 updates synchronously; semantic vectors update in the background.",
  {
    path: z.string().describe("Relative path of the entry"),
    title: z.string().describe("New title"),
  },
  async ({ path, title }) => {
    const ok = await engine.renameEntry(path, title);
    return text(ok ? `Renamed ${path} to "${title}".${maintenanceSuffix()}` : `Not found: ${path}`);
  },
);

server.tool(
  "wiki_move_entry",
  "Move a wiki entry to a new relative path within the same source. BM25 updates synchronously; semantic vectors update in the background.",
  {
    path: z.string().describe("Current relative path"),
    newPath: z.string().describe("New relative path"),
  },
  async ({ path, newPath }) => {
    const ok = await engine.moveEntry(path, newPath);
    return text(ok ? `Moved ${path} to ${newPath}.${maintenanceSuffix()}` : `Failed: source not found or target exists`);
  },
);

server.tool(
  "wiki_modify_entry",
  "Replace a wiki entry's full content. Requires the complete new content including frontmatter. BM25 updates synchronously; semantic vectors update in the background.",
  {
    source: z.string().describe("Source directory path"),
    path: z.string().describe("Relative path of the entry"),
    content: z.string().describe("New full content (including frontmatter)"),
  },
  async ({ source, path, content }) => {
    const ok = await engine.modifyEntry(source, path, content);
    return text(ok ? `Modified: ${path}.${maintenanceSuffix()}` : `Failed to modify: ${path}`);
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
  "wiki_configure_reranker",
  "Persist optional Cross-Encoder reranker settings for Hybrid search. The default is disabled. This does not download or load a model; loading starts lazily on the first enabled Hybrid search. Changing settings only affects later searches.",
  {
    enabled: z.boolean().optional().describe("Enable or disable reranking. Omit to change only other settings."),
    model: z.string().min(1).optional().describe("Logical model id. Default: BAAI/bge-reranker-base."),
    dtype: z.enum(["int8", "fp16", "fp32"]).optional().describe("ONNX model precision. Default: int8."),
    inputTopK: z.number().int().positive().optional().describe("Hybrid candidates sent to the reranker. Default: 20."),
    outputTopK: z.number().int().positive().optional().describe("Results retained after reranking. Default: 10."),
    maxLength: z.number().int().positive().optional().describe("Maximum tokenized query-document length. Default: 512."),
    batchSize: z.number().int().positive().optional().describe("Query-document pairs per inference batch. Default: 8."),
  },
  async (patch) => {
    try {
      const config = setRerankerConfig(patch);
      const lines = [
        `Reranker: ${config.enabled ? "ON" : "OFF"}`,
        `Model: ${config.model}`,
        `Dtype: ${config.dtype}`,
        `Candidates: ${config.inputTopK} -> ${config.outputTopK}`,
        `Max length: ${config.maxLength}`,
        `Batch size: ${config.batchSize}`,
      ];
      if (config.enabled) lines.push("The model will be lazy-loaded on the next Hybrid search.");
      return text(lines.join("\n"));
    } catch (error) {
      return text(`Reranker configuration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  {
    path: z.string().describe("Relative path of the file to compile"),
    source: z.string().optional().describe("Source ID when the relative path is not globally unique"),
  },
  async ({ path, source }) => {
    const prompt = engine.getCompilePrompt(path, source);
    if (!prompt) return text(`Not found or empty: ${path}`);
    return text(`Source-MD5: ${prompt.sourceMD5}\n\nSystem:\n${prompt.system}\n\nUser:\n${prompt.user}`);
  },
);

server.tool(
  "wiki_store_compiled",
  "Store LLM compilation result for a file. Use after wiki_get_compile_prompt and pass its Source-MD5 so stale output is rejected.",
  {
    path: z.string().describe("Relative path"),
    source: z.string().optional().describe("Source ID when the relative path is not globally unique"),
    topic: z.string().describe("Core topic (one sentence)"),
    normalizedText: z.string().describe("Normalized text"),
    concepts: z.array(z.string()).describe("Core concepts"),
    aliases: z.array(z.string()).describe("Synonyms / aliases"),
    sourceMD5: z.string().optional()
      .describe("Source-MD5 returned by wiki_get_compile_prompt. Rejects stale LLM output if the file changed."),
  },
  async ({ path, source, topic, normalizedText, concepts, aliases, sourceMD5 }) => {
    const ok = await engine.storeCompiled(
      path,
      { topic, normalizedText, concepts, aliases },
      { source, sourceMD5 },
    );
    return text(ok
      ? `Stored compilation for ${path}`
      : `Failed to store compilation for ${path}; the source may have changed.`);
  },
);

server.tool(
  "wiki_compile",
  "Compile a file using LLM. Extracts topic/normalizedText/concepts/aliases to improve search quality. Skips already-compiled files by default.",
  {
    path: z.string().describe("Relative path of the file to compile"),
    source: z.string().optional().describe("Source ID when the relative path is not globally unique"),
    model: z.string().optional().describe("LLM model (default: deepseek-chat). Set LLM_API_KEY + LLM_API_BASE env vars."),
    force: z.boolean().optional().describe("Recompile even if already compiled"),
  },
  async ({ path, source, model, force }) => {
    const r = await engine.compileFile(path, { model, force, source });
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
    source: z.string().optional().describe("Source ID returned by wiki_search"),
    chunkIndex: z.number().int().min(0).describe("Chunk index from search results"),
  },
  async ({ path, source, chunkIndex }) => {
    const result = engine.readChunk(path, chunkIndex, source);
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
    source: z.string().optional().describe("Source ID returned by wiki_search"),
    chunkIndex: z.number().int().min(0).describe("Chunk index from search results"),
    before: z.number().int().min(0).optional().describe("Chunks to include before (default 1)"),
    after: z.number().int().min(0).optional().describe("Chunks to include after (default 1)"),
  },
  async ({ path, source, chunkIndex, before, after }) => {
    const result = engine.readChunkContext(
      path,
      chunkIndex,
      before ?? 1,
      after ?? 1,
      source,
    );
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
      `Reranker:   ${s.reranker.enabled ? `ON (${s.reranker.model}, ${s.reranker.dtype}; ${s.reranker.inputTopK} -> ${s.reranker.outputTopK}${s.reranker.loaded ? ", loaded" : ""})` : "OFF"}`,
      `Embeddings: ${s.embeddings}`,
      `Centroid:   ${s.centroid ? "yes" : "no"}`,
      `Compiled:   ${s.compiled}`,
      `Vector jobs: ${s.backgroundVectors.running ? "running" : "idle"} (${s.backgroundVectors.queued} queued, ${s.backgroundVectors.failed} failed)`,
      `Model:      ${s.model} (${s.modelDim}d)`,
      `Last scan:  ${s.lastScan || "never"}`,
    ];
    if (s.sources.length > 0) {
      lines.push(
        "",
        "Source shards:",
        ...engine.sourceRefs.map((source) => `  ${source.id}  ${source.path}`),
      );
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

void main().catch((error: unknown) => {
  // 不调用立即终止 API：让 stdio/日志完成清理后自然退出，同时保留失败状态。
  console.error(
    "Fatal:",
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
  process.exitCode = 1;
});
