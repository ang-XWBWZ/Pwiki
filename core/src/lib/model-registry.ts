// model-registry.ts — 模型中间层 (v1.0)

import { readModelId, writeModelId } from "./store-config.js";

export interface ModelInfo {
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

export const BUILTIN_MODELS: ModelInfo[] = [
  {
    id: "bge-base-zh-v1.5",
    name: "BGE Base Chinese v1.5",
    hfRepo: "Xenova/bge-base-zh-v1.5",
    dim: 768,
    description: "BAAI Chinese-optimized, MTEB Chinese leaderboard top, suitable for Chinese technical docs",
    languages: ["zh", "en"],
    maxTokens: 512,
    int8Size: 130_000_000,
    fp32Size: 390_000_000,
  },
  {
    id: "bge-m3",
    name: "BGE M3",
    hfRepo: "Xenova/bge-m3",
    dim: 1024,
    description: "BAAI multilingual multi-granularity, 100+ languages, 8192 token support, best for mixed CN/EN notes",
    languages: ["zh", "en", "fr", "de", "ja", "ko", "es", "ru", "ar"],
    maxTokens: 8192,
    int8Size: 340_000_000,
    fp32Size: 2_200_000_000,
  },
  {
    id: "paraphrase-multilingual",
    name: "Paraphrase Multilingual MiniLM",
    hfRepo: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    dim: 384,
    description: "Lightweight multilingual model, 50+ languages, suitable for mixed-language knowledge bases",
    languages: ["zh", "en", "fr", "de", "ja", "ko"],
    maxTokens: 128,
    int8Size: 118_000_000,
    fp32Size: 470_000_000,
  },
];

export function getBuiltinModels(): ModelInfo[] { return BUILTIN_MODELS; }
export function findModel(id: string): ModelInfo | undefined { return BUILTIN_MODELS.find(m => m.id === id); }

export function getCurrentModel(): ModelInfo {
  const id = readModelId();
  return findModel(id) ?? BUILTIN_MODELS[0];
}

export function selectModel(id: string): ModelInfo | null {
  const m = findModel(id);
  if (!m) return null;
  writeModelId(m.id);
  return m;
}

export function getDefaultModelId(): string { return BUILTIN_MODELS[0].id; }
