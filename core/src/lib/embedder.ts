// embedder.ts — transformers.js 语义向量封装 (v1.0)

import { existsSync, statSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { modelsDir } from "../config.js";
import { getCurrentModel, findModel } from "./model-registry.js";
import type { ModelInfo } from "./model-registry.js";

export interface LocalModelInfo {
  path: string;
  variant: "fp32" | "int8" | "none";
  onnxSize: number;
  otherSize: number;
}

let pipeline: any = null;
let currentModel: string = getCurrentModel().hfRepo;
let initPromise: Promise<boolean> | null = null;
let initError: string | null = null;
let loadedVariant: string = "unknown";

function localModelDir(): string {
  const name = currentModel.split("/").pop() || currentModel;
  return join(modelsDir(), name);
}

function hasLocalModel(): boolean {
  const dir = localModelDir();
  if (!existsSync(dir)) return false;
  if (!existsSync(resolve(dir, "config.json"))) return false;
  if (!existsSync(resolve(dir, "onnx"))) return false;
  const onnxDir = resolve(dir, "onnx");
  return existsSync(resolve(onnxDir, "model.onnx"))
      || existsSync(resolve(onnxDir, "model_quantized.onnx"));
}

export function getLocalModelInfo(): LocalModelInfo | null {
  if (!hasLocalModel()) return null;
  const dir = localModelDir();
  const onnxDir = resolve(dir, "onnx");
  const quantFile = resolve(onnxDir, "model_quantized.onnx");
  const fullFile = resolve(onnxDir, "model.onnx");
  let variant: "fp32" | "int8" = "fp32";
  let onnxFile = fullFile;
  if (existsSync(quantFile)) { variant = "int8"; onnxFile = quantFile; }
  let onnxSize = 0, otherSize = 0;
  try { onnxSize = statSync(onnxFile).size; } catch {}
  for (const f of ["config.json", "tokenizer.json", "tokenizer_config.json"]) {
    try { otherSize += statSync(resolve(dir, f)).size; } catch {}
  }
  return { path: dir, variant, onnxSize, otherSize };
}

function fmtSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function resolveModelPath(): string {
  if (hasLocalModel()) return localModelDir();
  return currentModel;
}

export async function initialize(): Promise<boolean> {
  const wanted = getCurrentModel().hfRepo;
  if (currentModel !== wanted) {
    pipeline = null; initPromise = null; initError = null; currentModel = wanted;
  }
  if (pipeline) return true;
  if (initPromise) return initPromise;
  initPromise = doInit();
  return initPromise;
}

export function isAvailable(): boolean { return pipeline !== null; }

export function downloadModel(modelId?: string): { ok: boolean; msg: string } {
  const m = modelId ? findModel(modelId) : getCurrentModel();
  if (!m) return { ok: false, msg: `Unknown model: ${modelId}` };
  const dirName = m.hfRepo.split("/").pop()!;
  const targetDir = join(modelsDir(), dirName);
  const onnxDir = join(targetDir, "onnx");

  if (existsSync(resolve(targetDir, "config.json")) && existsSync(resolve(onnxDir, "model_quantized.onnx"))) {
    return { ok: true, msg: `Model already exists: ${dirName}` };
  }

  try {
    mkdirSync(onnxDir, { recursive: true });
    const baseUrl = `https://hf-mirror.com/${m.hfRepo}/resolve/main`;
    const files: [string, string][] = [
      ["config.json", resolve(targetDir, "config.json")],
      ["tokenizer_config.json", resolve(targetDir, "tokenizer_config.json")],
      ["tokenizer.json", resolve(targetDir, "tokenizer.json")],
      ["onnx/model_quantized.onnx", resolve(onnxDir, "model_quantized.onnx")],
    ];
    for (const [rel, out] of files) {
      execSync(`curl -L -f -s -o "${out}" "${baseUrl}/${rel}"`, { timeout: 600_000 });
    }
    return { ok: true, msg: `Downloaded: ${dirName} (${fmtSize(m.int8Size)})` };
  } catch (e: any) {
    return { ok: false, msg: `Download failed: ${e?.message || String(e)}` };
  }
}

export function getInitError(): string | null { return initError; }
export function getModelName(): string { return getCurrentModel().name; }
export function getModelRepo(): string { return currentModel; }

export function getModelSource(): string {
  if (!pipeline) return "not loaded";
  const info = getLocalModelInfo();
  if (info) return `local (${info.variant.toUpperCase()}, ${fmtSize(info.onnxSize)})`;
  return "remote (HuggingFace Hub)";
}

export function getLoadedVariant(): string { return loadedVariant; }

export async function embed(text: string): Promise<number[]> {
  const pipe = await ensurePipeline();
  const result = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(result.data) as number[];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const pipe = await ensurePipeline();
  const results: number[][] = [];
  for (const text of texts) {
    const result = await pipe(text, { pooling: "mean", normalize: true });
    results.push(Array.from(result.data) as number[]);
  }
  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function doInit(): Promise<boolean> {
  try {
    const { pipeline: transformersPipeline, env } = await import("@huggingface/transformers");
    const isLocal = hasLocalModel();
    if (isLocal) { env.allowLocalModels = true; }

    const modelPath = resolveModelPath();
    const pipelineOpts: any = {};
    if (isLocal) {
      const onnxDir = resolve(localModelDir(), "onnx");
      if (!existsSync(resolve(onnxDir, "model.onnx"))
          && existsSync(resolve(onnxDir, "model_quantized.onnx"))) {
        pipelineOpts.model_file_name = "model_quantized";
      }
      pipelineOpts.progress_callback = null;
    }

    pipeline = await transformersPipeline("feature-extraction", modelPath, pipelineOpts);
    const info = getLocalModelInfo();
    loadedVariant = info?.variant ?? "remote";
    initError = null;
    return true;
  } catch (e: any) {
    initError = e?.message || String(e);
    pipeline = null;
    return false;
  } finally {
    initPromise = null;
  }
}

async function ensurePipeline(): Promise<any> {
  if (pipeline) return pipeline;
  const ok = await initialize();
  if (!ok) throw new Error(`Embedder not initialized: ${initError || "unknown"}`);
  return pipeline;
}
