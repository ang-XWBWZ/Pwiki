// semantic-search.ts — 语义搜索 & 混合搜索
// 适配自 extensions/wiki/lib/semantic-search.ts — 导入拆分

import { getEmbeddings, getChunkInfo, getCentroid } from "./store-vectors.js";
import { getSemanticEnabled } from "./store-config.js";
import { getIndex } from "./store-index.js";
import { embed, initialize, isAvailable, cosineSimilarity } from "./embedder.js";
import { keywordSearch } from "./search.js";
import type { SearchHit, ChunkInfo } from "./types.js";

const HIGH_SIMILARITY_THRESHOLD = 0.50;
const MIN_SIMILARITY_THRESHOLD = 0.20;
const FALLBACK_COUNT = 3;
const MULTI_CHUNK_BONUS = 0.05;
const MAX_MULTI_CHUNK_BONUS = 0.25;
const RRF_K = 60;
const RRF_TOPN = 50;

interface ChunkMatch {
  key: string; relPath: string; similarity: number;
  chunkHeading?: string; chunkIndex?: number;
}

interface FileMatch {
  relPath: string; semanticScore: number;
  bestChunk: ChunkMatch; chunkCount: number; chunkHeadings: string[];
}

export async function semanticSearch(query: string): Promise<SearchHit[]> {
  if (!getSemanticEnabled()) return [];
  if (!isAvailable()) { const ok = await initialize(); if (!ok) return []; }

  const embeddings = getEmbeddings();
  if (Object.keys(embeddings).length === 0) return [];

  const idx = getIndex();
  const chunkInfo = getChunkInfo();

  let queryVec: number[];
  try { queryVec = await embed(query); } catch { return []; }

  // 减去全局质心（降噪），α=0.3，然后归一化
  const centroid = getCentroid();
  if (centroid && centroid.length === queryVec.length) {
    const alpha = 0.3;
    for (let i = 0; i < queryVec.length; i++) {
      queryVec[i] -= alpha * centroid[i];
    }
    let norm = 0;
    for (let i = 0; i < queryVec.length; i++) norm += queryVec[i] * queryVec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < queryVec.length; i++) queryVec[i] /= norm;
    }
  }

  const allChunks: ChunkMatch[] = [];
  for (const [key, vec] of Object.entries(embeddings)) {
    const chunkMatch = key.match(/^(.*)###(\d+|llm)$/);
    const relPath = chunkMatch ? chunkMatch[1] : key;
    const rawIdx = chunkMatch ? parseInt(chunkMatch[2], 10) : NaN;
    const chunkIdx = isNaN(rawIdx) ? undefined : rawIdx;
    if (!idx[relPath]) continue;
    const similarity = cosineSimilarity(queryVec, vec);
    if (similarity < MIN_SIMILARITY_THRESHOLD) continue;
    const ci = chunkIdx !== undefined ? chunkInfo[key] : undefined;
    allChunks.push({
      key, relPath, similarity, chunkIndex: chunkIdx,
      chunkHeading: ci ? ci.heading.replace(/^#+\s*/, "") : undefined,
    });
  }

  const fileMap = new Map<string, FileMatch>();
  for (const ch of allChunks) {
    const existing = fileMap.get(ch.relPath);
    if (!existing) {
      fileMap.set(ch.relPath, {
        relPath: ch.relPath, semanticScore: ch.similarity,
        bestChunk: ch, chunkCount: 1,
        chunkHeadings: ch.chunkHeading ? [ch.chunkHeading] : [],
      });
    } else {
      if (ch.similarity > existing.bestChunk.similarity) existing.bestChunk = ch;
      existing.chunkCount++;
      if (ch.chunkHeading && !existing.chunkHeadings.includes(ch.chunkHeading)) {
        existing.chunkHeadings.push(ch.chunkHeading);
      }
    }
  }

  for (const fm of fileMap.values()) {
    const bonus = Math.min((fm.chunkCount - 1) * MULTI_CHUNK_BONUS, MAX_MULTI_CHUNK_BONUS);
    fm.semanticScore = fm.bestChunk.similarity + bonus;
  }

  const files = [...fileMap.values()].sort((a, b) => b.semanticScore - a.semanticScore);
  const strong = files.filter(f => f.semanticScore >= HIGH_SIMILARITY_THRESHOLD);
  const ci = getChunkInfo();
  const strongHits = strong.map(f => makeFileHit(f, idx, ci));

  if (strongHits.length < FALLBACK_COUNT) {
    const weak = files
      .filter(f => f.semanticScore < HIGH_SIMILARITY_THRESHOLD)
      .slice(0, FALLBACK_COUNT);
    const weakHits = weak.map(f => {
      const hit = makeFileHit(f, idx, ci);
      hit.snippet = `⚠️ 弱匹配 (${Math.round(f.semanticScore * 100)}%)`;
      return hit;
    });
    return [...strongHits, ...weakHits];
  }
  return strongHits;
}

function makeFileHit(
  f: FileMatch,
  idx: Record<string, import("./types.js").FileEntry>,
  chunkInfo?: Record<string, ChunkInfo>,
): SearchHit {
  const entry = idx[f.relPath]!;
  let snippet = "";
  const llmKey = `${f.relPath}###llm`;
  const llm = chunkInfo?.[llmKey];
  if (llm?.summary) {
    snippet = `💡 ${llm.summary}`;
    if (llm.topic) snippet += ` [${llm.topic}]`;
  } else if (llm?.topic) {
    snippet = `💡 ${llm.topic}`;
  } else if (f.bestChunk.chunkHeading) {
    snippet = `▸ ${f.bestChunk.chunkHeading}`;
  }
  if (f.chunkCount > 1) {
    const others = f.chunkHeadings.filter(h => h !== f.bestChunk.chunkHeading).slice(0, 5);
    snippet += others.length > 0
      ? ` | +${f.chunkCount - 1}块: ${others.join(", ")}`
      : ` | +${f.chunkCount - 1}块命中`;
  }
  return {
    relPath: entry.relPath, sourceDir: entry.sourceDir,
    title: entry.title, tags: entry.tags, snippet,
    score: Math.round(f.semanticScore * 100),
    semanticScore: f.semanticScore,
    chunkIndex: f.bestChunk.chunkIndex,
    chunkHeading: f.bestChunk.chunkHeading,
  };
}

export async function hybridSearch(query: string): Promise<SearchHit[]> {
  const keywordHits = keywordSearch(query);
  const semanticHits = await semanticSearch(query);

  const kwSorted = [...keywordHits].sort((a, b) => b.score - a.score).slice(0, RRF_TOPN);
  const semSorted = [...semanticHits].sort((a, b) => b.score - a.score).slice(0, RRF_TOPN);

  const kwRank = new Map<string, number>();
  kwSorted.forEach((h, i) => kwRank.set(h.relPath, i + 1));
  const semRank = new Map<string, number>();
  semSorted.forEach((h, i) => semRank.set(h.relPath, i + 1));

  const allPaths = new Set([...kwSorted.map(h => h.relPath), ...semSorted.map(h => h.relPath)]);
  const kwMap = new Map(kwSorted.map(h => [h.relPath, h]));
  const semMap = new Map(semSorted.map(h => [h.relPath, h]));
  const missingRank = RRF_K * 2;

  const merged: SearchHit[] = [];
  for (const relPath of allPaths) {
    const kw = kwMap.get(relPath);
    const sem = semMap.get(relPath);
    const kwR = kwRank.get(relPath) ?? missingRank;
    const semR = semRank.get(relPath) ?? missingRank;
    const rrf = 1 / (RRF_K + kwR) + 1 / (RRF_K + semR);
    const base = sem || kw!;
    let snippet = sem?.snippet || "";
    if (!snippet && kw?.snippet) snippet = kw.snippet.replace(/\n/g, " | ");
    merged.push({
      relPath: base.relPath, sourceDir: base.sourceDir,
      title: base.title, tags: base.tags, snippet,
      score: Math.round(rrf * 10000),
      semanticScore: sem?.semanticScore,
      chunkIndex: sem?.chunkIndex, chunkHeading: sem?.chunkHeading,
    });
  }
  return merged.sort((a, b) => b.score - a.score);
}
