// semantic-search.ts — 语义搜索 & 混合搜索
// 适配自 extensions/wiki/lib/semantic-search.ts — 导入拆分

import { getEmbeddings, getChunkInfo, getCentroid } from "./store-vectors.js";
import { getSemanticEnabled } from "./store-config.js";
import { getIndex } from "./store-index.js";
import { embed, initialize, isAvailable, cosineSimilarity } from "./embedder.js";
import { keywordSearch, keywordCandidates } from "./search.js";
import type { SearchHit, SearchCandidate, ChunkInfo } from "./types.js";

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
    headingPath: chunkInfo?.[f.bestChunk.key]?.headingPath,
    startLine: chunkInfo?.[f.bestChunk.key]?.startLine,
    endLine: chunkInfo?.[f.bestChunk.key]?.endLine,
  };
}

export async function hybridSearch(query: string): Promise<SearchHit[]> {
  const candidates = await hybridCandidates(query, { kwTopK: RRF_TOPN, semTopK: RRF_TOPN });
  return candidatesToHits(candidates);
}

// ═══════════════ 候选层（供 hybrid 融合，不经展示阈值过滤） ═══════════════

interface SemanticCandidateOptions {
  topK?: number;
  minScore?: number;   // 默认 -1（不过滤），用户语义搜索时可设为 0.20
  includeWeak?: boolean;
}

interface HybridCandidateOptions {
  kwTopK?: number;
  semTopK?: number;
}

/**
 * 语义候选（原始余弦相似度结果，不经过 strong/weak 阈值过滤）
 * 供 hybridCandidates 使用
 */
export async function semanticCandidates(
  query: string,
  opts: SemanticCandidateOptions = {},
): Promise<SearchCandidate[]> {
  if (!getSemanticEnabled()) return [];
  if (!isAvailable()) { const ok = await initialize(); if (!ok) return []; }

  const embeddings = getEmbeddings();
  if (Object.keys(embeddings).length === 0) return [];

  const idx = getIndex();
  const chunkInfo = getChunkInfo();

  let queryVec: number[];
  try { queryVec = await embed(query); } catch { return []; }

  // 质心降噪
  const centroid = getCentroid();
  if (centroid && centroid.length === queryVec.length) {
    const alpha = 0.3;
    for (let i = 0; i < queryVec.length; i++) queryVec[i] -= alpha * centroid[i];
    let norm = 0;
    for (let i = 0; i < queryVec.length; i++) norm += queryVec[i] * queryVec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < queryVec.length; i++) queryVec[i] /= norm;
  }

  const minSim = opts.minScore ?? -1;
  const fileMap = new Map<string, { bestScore: number; bestChunk: number | undefined; chunkCount: number; bestHeading?: string }>();
  const bestMeta = new Map<string, { key?: string; headingPath?: string[]; startLine?: number; endLine?: number }>();

  for (const [key, vec] of Object.entries(embeddings)) {
    const chunkMatch = key.match(/^(.*)###(\d+|llm)$/);
    const relPath = chunkMatch ? chunkMatch[1] : key;
    const rawIdx = chunkMatch ? parseInt(chunkMatch[2], 10) : NaN;
    const chunkIdx = isNaN(rawIdx) ? undefined : rawIdx;
    if (!idx[relPath]) continue;

    const similarity = cosineSimilarity(queryVec, vec);
    if (similarity < minSim) continue;

    const ci = chunkIdx !== undefined ? chunkInfo[key] : undefined;
    const heading = ci ? ci.heading.replace(/^#+\s*/, "") : undefined;
    const headingPath = ci?.headingPath;
    const startLine = ci?.startLine;
    const endLine = ci?.endLine;

    const existing = fileMap.get(relPath);
    if (!existing || similarity > existing.bestScore) {
      fileMap.set(relPath, { bestScore: similarity, bestChunk: chunkIdx, chunkCount: (existing?.chunkCount ?? 0) + 1, bestHeading: heading });
      // 保存 chunkKey 和行号
      bestMeta.set(relPath, { key, headingPath, startLine, endLine });
    } else {
      existing.chunkCount++;
    }
  }

  const candidates: SearchCandidate[] = [];
  for (const [relPath, fm] of fileMap) {
    const bonus = Math.min((fm.chunkCount - 1) * MULTI_CHUNK_BONUS, MAX_MULTI_CHUNK_BONUS);
    const score = Math.round((fm.bestScore + bonus) * 100);
    candidates.push({
      relPath, title: idx[relPath]?.title ?? "",
      score, source: "semantic",
      chunkIndex: fm.bestChunk, chunkHeading: fm.bestHeading,
      semanticScore: fm.bestScore + bonus,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return opts.topK ? candidates.slice(0, opts.topK) : candidates;
}

/**
 * 混合候选（RRF 融合 keyword + semantic 原始候选）
 */
export async function hybridCandidates(
  query: string,
  opts: HybridCandidateOptions = {},
): Promise<SearchCandidate[]> {
  const kwTopK = opts.kwTopK ?? RRF_TOPN;
  const semTopK = opts.semTopK ?? RRF_TOPN;

  const kwHits = keywordCandidates(query, { topK: kwTopK });
  const semHits = await semanticCandidates(query, { topK: semTopK, minScore: -1, includeWeak: true });

  const kwRank = new Map<string, number>();
  kwHits.forEach((h, i) => kwRank.set(h.relPath, i + 1));
  const semRank = new Map<string, number>();
  semHits.forEach((h, i) => semRank.set(h.relPath, i + 1));

  const allPaths = new Set([...kwHits.map(h => h.relPath), ...semHits.map(h => h.relPath)]);
  const kwMap = new Map(kwHits.map(h => [h.relPath, h]));
  const semMap = new Map(semHits.map(h => [h.relPath, h]));
  const missingRank = RRF_K * 2;

  const merged: SearchCandidate[] = [];
  for (const relPath of allPaths) {
    const kw = kwMap.get(relPath);
    const sem = semMap.get(relPath);
    const kwR = kwRank.get(relPath) ?? missingRank;
    const semR = semRank.get(relPath) ?? missingRank;
    const rrf = 1 / (RRF_K + kwR) + 1 / (RRF_K + semR);
    const base: SearchCandidate = sem || kw!;
    merged.push({
      relPath: base.relPath, title: base.title,
      score: Math.round(rrf * 10000), source: "hybrid",
      chunkIndex: sem?.chunkIndex, chunkHeading: sem?.chunkHeading,
      semanticScore: sem?.semanticScore,
      snippet: sem?.chunkHeading || kw?.snippet,
    });
  }
  return merged.sort((a, b) => b.score - a.score);
}

/** 候选转展示用 SearchHit */
function candidatesToHits(candidates: SearchCandidate[]): SearchHit[] {
  const idx = getIndex();
  return candidates.map(c => {
    const entry = idx[c.relPath];
    return {
      relPath: c.relPath,
      sourceDir: entry?.sourceDir ?? "",
      title: c.title || (entry?.title ?? ""),
      tags: entry?.tags ?? [],
      snippet: c.snippet ?? "",
      score: c.score,
      semanticScore: c.semanticScore,
      chunkIndex: c.chunkIndex,
      chunkHeading: c.chunkHeading,
    };
  });
}
