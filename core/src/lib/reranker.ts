// reranker.ts — 可选的 Cross-Encoder 精排层

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { modelsDir } from "../config.js";
import { getContent } from "./content-cache.js";
import { resolveWithinSource } from "./source-shard.js";
import { validateRerankerConfig } from "./reranker-config.js";
import type { RerankerConfig, SearchHit } from "./types.js";

export interface RerankOptions {
  maxLength?: number;
  batchSize?: number;
}

export interface RerankerStatus {
  loaded: boolean;
  runtimeModel?: string;
  lastError?: string;
}

/** 可替换的搜索后精排器接口。 */
export interface Reranker {
  rerank(
    query: string,
    candidates: SearchHit[],
    options?: RerankOptions,
  ): Promise<SearchHit[]>;
  status?(): RerankerStatus;
  dispose?(): Promise<void> | void;
}

interface RerankerRuntime {
  tokenizer: (query: string[], options: Record<string, unknown>) => unknown;
  model: (inputs: unknown) => Promise<unknown>;
}

/** 仅用于测试替换实际 Transformers.js 模型加载器。 */
export interface BgeRerankerDependencies {
  load?: (runtimeModel: string, dtype: RerankerConfig["dtype"]) => Promise<RerankerRuntime>;
}

const DEFAULT_BGE_MODEL = "BAAI/bge-reranker-base";
const DEFAULT_BGE_ONNX_MODEL = "onnx-community/bge-reranker-base-ONNX";

function runtimeModelFor(model: string): string {
  // BAAI 的原始仓库发布 PyTorch 权重；此 ONNX 社区发行版保留相同模型并提供 INT8 文件。
  return model === DEFAULT_BGE_MODEL ? DEFAULT_BGE_ONNX_MODEL : model;
}

function debug(message: string): void {
  if (process.env.PWIKI_DEBUG === "1") console.debug(`[pwiki:reranker] ${message}`);
}

function asScores(output: any, expected: number): number[] {
  const tensor = output?.logits ?? output?.[0] ?? output;
  const values = tensor?.data;
  if (!values || typeof values.length !== "number") {
    throw new Error("model did not return sequence-classification logits");
  }
  if (values.length !== expected) {
    throw new Error(`expected ${expected} reranker logits, received ${values.length}`);
  }
  return Array.from(values as ArrayLike<number>);
}

function sliceChunkContent(hit: SearchHit, content: string): string {
  if (hit.startLine === undefined || hit.endLine === undefined) return "";
  const lines = content.split("\n");
  return lines.slice(Math.max(0, hit.startLine - 1), Math.max(hit.startLine, hit.endLine)).join("\n");
}

/**
 * 构造真正的检索文本：优先语义候选所指的块，再退回关键词命中的 snippet。
 * 不把未分块的原始文件全文直接交给 Cross-Encoder。
 */
export function rerankerDocumentText(hit: SearchHit): string {
  let content = getContent(hit.relPath, hit.sourceDir);
  if (content === undefined && hit.sourceDir) {
    try {
      const path = resolveWithinSource(hit.sourceDir, hit.relPath);
      if (existsSync(path)) content = readFileSync(path, "utf-8");
    } catch {
      // 源文件移动/删除时，仍可以用搜索结果附带的 snippet 精排。
    }
  }

  const chunk = content ? sliceChunkContent(hit, content) : "";
  const heading = hit.headingPath?.join(" > ") || hit.chunkHeading || "";
  return [hit.title, heading, chunk || hit.snippet]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** BGE Cross-Encoder 的 Transformers.js/ONNX 实现；仅在首次 rerank 时加载。 */
export class BgeReranker implements Reranker {
  private runtime: RerankerRuntime | null = null;
  private loadPromise: Promise<void> | null = null;
  private lastError: string | undefined;
  private readonly runtimeModel: string;

  constructor(
    private readonly config: RerankerConfig,
    private readonly dependencies: BgeRerankerDependencies = {},
  ) {
    validateRerankerConfig(config);
    this.runtimeModel = runtimeModelFor(config.model);
  }

  status(): RerankerStatus {
    return {
      loaded: this.runtime !== null,
      runtimeModel: this.runtimeModel,
      lastError: this.lastError,
    };
  }

  async rerank(
    query: string,
    candidates: SearchHit[],
    options: RerankOptions = {},
  ): Promise<SearchHit[]> {
    if (candidates.length === 0) return [];
    await this.ensureLoaded();

    const maxLength = options.maxLength ?? this.config.maxLength;
    const batchSize = options.batchSize ?? this.config.batchSize;
    if (!Number.isSafeInteger(maxLength) || maxLength <= 0) throw new Error("reranker maxLength must be a positive integer");
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new Error("reranker batchSize must be a positive integer");

    const runtime = this.runtime!;
    const scores: number[] = [];
    const startedAt = performance.now();
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      const documents = batch.map(rerankerDocumentText);
      const inputs = runtime.tokenizer(new Array(batch.length).fill(query), {
        text_pair: documents,
        padding: true,
        truncation: true,
        max_length: maxLength,
      });
      const output = await runtime.model(inputs);
      scores.push(...asScores(output, batch.length));
    }

    const ranked = candidates.map((candidate, index) => ({
      ...candidate,
      originalRank: candidate.originalRank ?? index + 1,
      rerankerScore: scores[index],
    })).sort((a, b) => (
      b.rerankerScore - a.rerankerScore || a.originalRank - b.originalRank
    ));
    debug(`model=${this.config.model} dtype=${this.config.dtype} candidates=${candidates.length} durationMs=${(performance.now() - startedAt).toFixed(1)} before=${candidates.map((hit) => hit.relPath).join(",")} after=${ranked.map((hit) => `${hit.relPath}:${hit.rerankerScore?.toFixed(4)}`).join(",")}`);
    return ranked;
  }

  async dispose(): Promise<void> {
    const model = this.runtime?.model as any;
    if (typeof model?.dispose === "function") await model.dispose();
    this.runtime = null;
    this.loadPromise = null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.runtime) return;
    if (!this.loadPromise) {
      this.loadPromise = this.load().catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.loadPromise = null;
        throw error;
      });
    }
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    try {
      const runtime = this.dependencies.load
        ? await this.dependencies.load(this.runtimeModel, this.config.dtype)
        : await this.loadTransformersRuntime();
      this.runtime = runtime;
      this.lastError = undefined;
      debug(`enabled model=${this.config.model} runtimeModel=${this.runtimeModel} dtype=${this.config.dtype}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to load reranker model "${this.config.model}" (runtime "${this.runtimeModel}", dtype=${this.config.dtype}): ${message}`);
    }
  }

  private async loadTransformersRuntime(): Promise<RerankerRuntime> {
    const { AutoModelForSequenceClassification, AutoTokenizer } = await import("@huggingface/transformers");
    const options = {
      cache_dir: modelsDir(),
    };
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(this.runtimeModel, options),
      AutoModelForSequenceClassification.from_pretrained(this.runtimeModel, {
        ...options,
        dtype: this.config.dtype,
      }),
    ]);
    return { tokenizer: tokenizer as any, model: model as any };
  }
}
