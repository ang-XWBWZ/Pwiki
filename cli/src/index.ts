#!/usr/bin/env node
// cli/src/index.ts — Wiki CLI (v1.0)

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  WikiEngine, MODELS, findModel,
  setRerankerConfig,
} from "@llangtop/pwiki-core";
import type { RerankerConfig, SearchMode } from "@llangtop/pwiki-core";

// Console encoding fix for Windows
if (process.platform === "win32") {
  try { execSync("chcp 65001 > nul", { stdio: "pipe", timeout: 2000 }); } catch {}
}

function readVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")).version || "1.0.0";
  } catch { return "1.0.0"; }
}

function defaultDir(): string {
  return join(process.env.HOME || process.env.USERPROFILE || ".", ".pwiki");
}

const program = new Command();
program
  .name("pwiki")
  .description("Wiki knowledge base — search, manage, and query your local knowledge")
  .version(readVersion())
  .option("-d, --dir <path>", "Wiki data directory", defaultDir());

let _engine: WikiEngine | null = null;

function engine(): WikiEngine {
  if (!_engine) {
    const opts = program.opts();
    _engine = new WikiEngine({ basePath: opts.dir });
  }
  return _engine;
}

// ═══════════════ search ═══════════════

program
  .command("search <query>")
  .description("Search the wiki")
  .option("-k, --keyword", "Keyword only")
  .option("-s, --semantic", "Semantic only")
  .option("--source <source>", "Source ID, unique name, or path")
  .option("--path-prefix <path>", "Source-relative directory or file (requires --source)")
  .option("-p, --page <n>", "Page number", "1")
  .option("-f, --full", "Full content (5 per page)")
  .action(async (query: string, opts: any) => {
    let mode: SearchMode = "hybrid";
    if (opts.keyword) mode = "keyword";
    else if (opts.semantic) mode = "semantic";

    let hits;
    try {
      hits = await engine().search(query, mode, {
        source: opts.source,
        pathPrefix: opts.pathPrefix,
      });
    } catch (error: any) {
      console.error(`Search failed: ${error?.message ?? String(error)}`);
      return;
    }
    if (!hits.length) { console.log(`No results for "${query}" (${mode})`); return; }

    const limit = opts.full ? 5 : 10;
    const page = Math.max(1, parseInt(opts.page) || 1);
    const pageHits = hits.slice((page - 1) * limit, page * limit);

    console.log(`"${query}" — ${hits.length} results (${mode})${hits.length > limit ? ` page ${page}` : ""}`);
    console.log("─".repeat(60));

    for (let i = 0; i < pageHits.length; i++) {
      const h = pageHits[i];
      const tags = h.tags.length ? ` [${h.tags.join(", ")}]` : "";
      console.log(`${i + 1}. ${h.title}${tags}`);
      console.log(`   ${h.relPath}${h.sourceId ? ` [source: ${h.sourceId}]` : ""}`);
      if (h.snippet) {
        for (const line of h.snippet.split("\n").slice(0, 3)) {
          if (line.trim()) console.log(`   ${line}`);
        }
      }
      console.log();
    }
  });

// ═══════════════ load / unload / refresh ═══════════════

program
  .command("load <path>")
  .description("Load a directory as wiki data source")
  .action(async (path: string) => {
    const abs = resolve(path);
    if (!engine().addSource(abs)) { console.log(`Already loaded: ${abs}`); return; }
    const count = await engine().loadSource(abs);
    console.log(`Loaded ${count} .md files from ${abs}`);
  });

program
  .command("unload [path]")
  .description("Remove data source (omit to list)")
  .action((path?: string) => {
    if (!path) {
      const srcs = engine().sources;
      if (!srcs.length) { console.log("No sources loaded."); return; }
      console.log("Loaded sources:");
      srcs.forEach((s: string, i: number) => console.log(`  ${i + 1}. ${s}`));
      return;
    }
    const removed = engine().removeSource(path);
    console.log(removed ? `Removed: ${removed}` : `Not found: ${path}`);
  });

program
  .command("refresh [source]")
  .description("Re-scan and rebuild index")
  .action(async (source?: string) => {
    if (source) {
      const count = await engine().loadSource(resolve(source));
      console.log(`Refreshed: ${count} files`);
    } else {
      const r = await engine().load();
      console.log(`Refreshed all: ${r.files} files from ${r.sources} sources`);
    }
  });

// ═══════════════ read / create ═══════════════

program
  .command("read <path>")
  .description("Read a wiki entry's full content")
  .option("--source <source>", "Source ID, unique name, or path")
  .action((path: string, opts: any) => {
    const result = engine().readEntry(path, opts.source);
    if (!result) { console.log(`Not found: ${path}`); return; }
    console.log(`# ${result.entry.title}\n`);
    console.log(result.content);
  });

program
  .command("create <source> <path>")
  .description("Create a new wiki entry")
  .option("-t, --title <title>", "Document title")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--content <text>", "Body content")
  .action(async (source: string, path: string, opts: any) => {
    const tags = opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [];
    const result = await engine().createEntry(resolve(source), path, opts.title, tags, opts.content ?? "");
    console.log(result.startsWith("exists") ? result : `Created: ${result}`);
  });

// ═══════════════ status ═══════════════

program
  .command("status")
  .description("Show wiki status")
  .action(() => {
    const s = engine().status();
    console.log(`Config:     ${s.configPath}`);
    console.log(`Sources:    ${s.sources.length}`);
    console.log(`Files:      ${s.files}`);
    console.log(`Semantic:   ${s.semantic ? "ON" : "OFF"}`);
    console.log(`Reranker:   ${s.reranker.enabled ? `ON (${s.reranker.model}, ${s.reranker.dtype}${s.reranker.loaded ? ", loaded" : ""})` : "OFF"}`);
    console.log(`Embeddings: ${s.embeddings}`);
    console.log(`Centroid:   ${s.centroid ? "yes" : "no"}`);
    console.log(`Compiled:   ${s.compiled}`);
    console.log(`Model:      ${s.model} (${s.modelDim}d)`);
    console.log(`Last scan:  ${s.lastScan || "never"}`);
    if (s.sources.length) {
      console.log("\nSource shards:");
      engine().sourceRefs.forEach((source, i) => {
        console.log(`  ${i + 1}. ${source.id}  ${source.path}`);
      });
    }
  });

// ═══════════════ semantic ═══════════════

program
  .command("semantic <state>")
  .description("Enable/disable semantic search")
  .option("--use-model <id>", "Switch embedding model")
  .action(async (state: string, opts: any) => {
    if (state === "off") {
      engine().disableSemantic();
      console.log("Semantic search OFF.");
      return;
    }
    const result = await engine().enableSemantic(opts.useModel);
    if (!result.ok) {
      console.log("FAIL " + result.msg);
      console.log("\nModel needs to be downloaded:");
      console.log(`  pwiki model-download -m ${opts.useModel || "bge-base-zh-v1.5"}`);
      return;
    }
    console.log("OK " + result.msg);
  });

program
  .command("reranker <state>")
  .description("Enable/disable optional Cross-Encoder reranking for hybrid search")
  .option("-m, --model <id>", "Cross-Encoder model identifier")
  .option("--dtype <dtype>", "Model dtype: int8, fp16, or fp32")
  .option("--input-top-k <n>", "Candidates sent to the reranker")
  .option("--output-top-k <n>", "Final results retained after reranking")
  .option("--max-length <n>", "Maximum paired token length")
  .option("--batch-size <n>", "Paired inputs per inference batch")
  .action((state: string, opts: any) => {
    if (state !== "on" && state !== "off") {
      console.error("State must be 'on' or 'off'.");
      process.exitCode = 1;
      return;
    }

    const parsePositiveInt = (name: string, value: unknown): number | undefined => {
      if (value === undefined) return undefined;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
      }
      return parsed;
    };

    try {
      // 先初始化 Engine，确保 --dir 与其它 CLI 子命令使用同一 config.json。
      engine();
      const patch: Partial<RerankerConfig> = { enabled: state === "on" };
      if (opts.model !== undefined) patch.model = opts.model;
      if (opts.dtype !== undefined) patch.dtype = opts.dtype;
      const inputTopK = parsePositiveInt("--input-top-k", opts.inputTopK);
      const outputTopK = parsePositiveInt("--output-top-k", opts.outputTopK);
      const maxLength = parsePositiveInt("--max-length", opts.maxLength);
      const batchSize = parsePositiveInt("--batch-size", opts.batchSize);
      if (inputTopK !== undefined) patch.inputTopK = inputTopK;
      if (outputTopK !== undefined) patch.outputTopK = outputTopK;
      if (maxLength !== undefined) patch.maxLength = maxLength;
      if (batchSize !== undefined) patch.batchSize = batchSize;
      const config = setRerankerConfig(patch);
      console.log(`Reranker ${config.enabled ? "ON" : "OFF"}: ${config.model} (${config.dtype})`);
      if (config.enabled) {
        console.log("The model is lazy-loaded on the first hybrid search.");
      }
    } catch (error) {
      console.error(`Reranker configuration failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

program
  .command("embed [source]")
  .description("Generate embeddings for indexed files")
  .action(async (source?: string) => {
    try {
      const r = await engine().generateEmbeddings(source);
      console.log(`Embedded: ${r.embedded} files`);
    } catch (e: any) {
      console.log(`Error: ${e.message}`);
    }
  });

// ═══════════════ compile ═══════════════

program
  .command("compile-status")
  .description("Show LLM compilation status")
  .action(() => {
    const s = engine().compileStatus();
    console.log(`Total:     ${s.total}`);
    console.log(`Compiled:  ${s.compiled}`);
    console.log(`Remaining: ${s.uncompiled.length}`);
    if (s.uncompiled.length > 0) {
      console.log("\nUncompiled:");
      s.uncompiled.slice(0, 20).forEach((p: string) => console.log(`  ${p}`));
      if (s.uncompiled.length > 20) console.log(`  ... and ${s.uncompiled.length - 20} more`);
    }
  });

program
  .command("compile [path]")
  .description("Compile a file (or all uncompiled) using LLM. Extracts topic/normalizedText/concepts/aliases for better search.")
  .option("-a, --all", "Compile all uncompiled files")
  .option("-l, --limit <n>", "Max files for --all", "10")
  .option("-s, --source <path>", "Source to compile (with --all)")
  .option("-m, --model <id>", "LLM model (default: deepseek-chat)")
  .option("-f, --force", "Recompile even if already compiled")
  .action(async (path?: string, opts?: any) => {
    const compileOpts = { model: opts?.model, force: opts?.force };
    if (opts?.all) {
      const r = await engine().compileAll(opts?.source, parseInt(opts?.limit) || 10, compileOpts);
      console.log(`Compiled: ${r.compiled}, Skipped: ${r.skipped}, Failed: ${r.failed}`);
      r.msgs.forEach((m: string) => console.log(m));
      return;
    }
    if (!path) { console.log("Usage: pwiki compile <path> | pwiki compile --all"); return; }
    const r = await engine().compileFile(path, { ...compileOpts, source: opts?.source });
    console.log(r.msg);
  });

program
  .command("llm")
  .description("Show LLM configuration")
  .action(() => {
    const info = engine().llmInfo;
    console.log(`API Base: ${info.apiBase}`);
    console.log(`Model:    ${info.model}`);
    console.log(`API Key:  ${info.hasKey ? "set" : "NOT SET"}`);
  });

// ═══════════════ model ═══════════════

program
  .command("model-download")
  .description("Download embedding model (~130MB)")
  .option("-m, --model <id>", "Model id", "bge-base-zh-v1.5")
  .action(async (opts: any) => {
    const model = findModel(opts.model) || MODELS[0];
    console.log("Downloading model: " + model.name);
    console.log("   Size: ~" + Math.round(model.int8Size / 1e6) + "MB");

    const result = await engine().downloadModel(opts.model);
    if (result.ok) {
      console.log("OK " + result.msg);
      console.log("\nNow enable semantic search: pwiki semantic on");
    } else {
      console.log("FAIL " + result.msg);
    }
  });

program
  .command("models")
  .description("List available embedding models")
  .action(() => {
    console.log("Available embedding models:\n");
    for (const m of MODELS) {
      console.log("  " + m.id);
      console.log("    " + m.name + " — " + m.description);
      console.log("    dim=" + m.dim + ", lang=" + m.languages.join("/") + ", max=" + m.maxTokens + " tok\n");
    }
  });

// ═══════════════ setup ═══════════════

program
  .command("setup")
  .description("Initialize: download model + enable semantic search")
  .option("-m, --model <id>", "Model id", "bge-base-zh-v1.5")
  .action(async (opts: any) => {
    const modelId = opts.model;
    const model = findModel(modelId) || MODELS[0];

    console.log("=== Pwiki Setup ===");
    console.log("Model: " + model.name + " (" + modelId + ")\n");

    console.log("[1/2] Downloading model...");
    const dlResult = await engine().downloadModel(modelId);
    if (!dlResult.ok) { console.log("FAIL " + dlResult.msg); return; }
    console.log("OK " + dlResult.msg);

    console.log("[2/2] Enabling semantic search...");
    const semResult = await engine().enableSemantic(modelId);
    if (!semResult.ok) { console.log("FAIL " + semResult.msg); return; }
    console.log("OK " + semResult.msg);

    console.log("\nSetup complete! Now load your notes:");
    console.log("  pwiki load <directory>");
    console.log("(load automatically generates embeddings)");
  });

program.parse();
