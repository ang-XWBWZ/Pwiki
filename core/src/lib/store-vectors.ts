// store-vectors.ts — vectors.json 持久化层
// 管理: 语义向量 / chunk 元数据 / 模型维度信息
// 适配自 extensions/wiki/lib/store-vectors.ts — wikiHome 改为 config.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { vectorFile } from "../config.js";
import type { EmbeddingData } from "./types.js";

// ---- 向量 ----

export function getEmbeddings(sourceId?: string): Record<string, number[]> {
  try {
    const p = vectorFile(sourceId);
    if (existsSync(p)) {
      const v: EmbeddingData = JSON.parse(readFileSync(p, "utf-8"));
      return v.entries ?? {};
    }
  } catch { /* ignore */ }
  return {};
}

export function setEmbeddings(
  entries: Record<string, number[]>,
  model?: string,
  dim?: number,
  sourceId?: string,
): void {
  const chunkInfo = getChunkInfo(sourceId);
  const prev = readRaw(sourceId);
  const v: EmbeddingData = {
    model: model ?? prev?.model ?? "unknown",
    dim: dim ?? prev?.dim ?? 0,
    entries,
    chunkInfo:
      Object.keys(chunkInfo).length > 0 ? chunkInfo : undefined,
    centroid: prev?.centroid,
  };
  writeRaw(v, sourceId);
}

/** 一次写入完整向量快照，避免 entries/chunkInfo/centroid 分三次持久化。 */
export function setVectorData(data: EmbeddingData, sourceId?: string): void {
  writeRaw({
    ...data,
    chunkInfo: data.chunkInfo && Object.keys(data.chunkInfo).length > 0
      ? data.chunkInfo
      : undefined,
  }, sourceId);
}

// ---- 块元数据 ----

export function getChunkInfo(sourceId?: string): Record<string, import("./types.js").ChunkInfo> {
  try {
    const prev = readRaw(sourceId);
    return prev?.chunkInfo ?? {};
  } catch {
    return {};
  }
}

export function setChunkInfo(
  chunkInfo: Record<string, import("./types.js").ChunkInfo>,
  sourceId?: string,
): void {
  const entries = getEmbeddings(sourceId);
  const prev = readRaw(sourceId);
  const v: EmbeddingData = {
    model: prev?.model ?? "unknown",
    dim: prev?.dim ?? 0,
    entries,
    chunkInfo: Object.keys(chunkInfo).length > 0 ? chunkInfo : undefined,
    centroid: prev?.centroid,
  };
  writeRaw(v, sourceId);
}

// ---- 单条删除 ----

export function removeEmbedding(relPath: string, sourceId?: string): void {
  const emb = getEmbeddings(sourceId);
  const chunkInfo = getChunkInfo(sourceId);
  let removed = false;
  if (emb[relPath]) { delete emb[relPath]; removed = true; }
  for (const key of Object.keys(emb)) {
    if (key.startsWith(`${relPath}###`)) { delete emb[key]; removed = true; }
  }
  for (const key of Object.keys(chunkInfo)) {
    if (key === relPath || key.startsWith(`${relPath}###`)) {
      delete chunkInfo[key];
      removed = true;
    }
  }
  if (removed) {
    const prev = readRaw(sourceId);
    setVectorData({
      model: prev?.model ?? "unknown",
      dim: prev?.dim ?? 0,
      entries: emb,
      chunkInfo,
      centroid: computeCentroid(emb) ?? undefined,
    }, sourceId);
  }
}

// ---- 模型元信�?----

export function getEmbeddingModel(sourceId?: string): string | undefined {
  return readRaw(sourceId)?.model;
}

export function getEmbeddingDim(sourceId?: string): number | undefined {
  return readRaw(sourceId)?.dim;
}

// ---- 质心（噪声基底）----

export function getCentroid(sourceId?: string): number[] | null {
  return readRaw(sourceId)?.centroid ?? null;
}

export function setCentroid(centroid: number[], sourceId?: string): void {
  const prev = readRaw(sourceId);
  if (!prev) return;
  prev.centroid = centroid;
  writeRaw(prev, sourceId);
}

export function clearCentroid(sourceId?: string): void {
  const prev = readRaw(sourceId);
  if (!prev) return;
  delete prev.centroid;
  writeRaw(prev, sourceId);
}

// ---- 统计 ----

export function vectorsStats(sourceId?: string): { embeddings: number; centroid: boolean; model?: string; dim?: number } {
  const prev = readRaw(sourceId);
  const emb = prev?.entries ?? {};
  return { embeddings: Object.keys(emb).length, centroid: !!prev?.centroid, model: prev?.model, dim: prev?.dim };
}

// ---- 内部 ----

function readRaw(sourceId?: string): EmbeddingData | null {
  try {
    const p = vectorFile(sourceId);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")) as EmbeddingData;
  } catch { /* ignore */ }
  return null;
}

function writeRaw(data: EmbeddingData, sourceId?: string): void {
  writeFileSync(vectorFile(sourceId), JSON.stringify(data), "utf-8");
}

export function computeCentroid(entries: Record<string, number[]>): number[] | null {
  const vectors = Object.values(entries);
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const centroid = new Array<number>(dim).fill(0);
  for (const vector of vectors) {
    if (vector.length !== dim) continue;
    for (let i = 0; i < dim; i++) centroid[i] += vector[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
  return centroid;
}
