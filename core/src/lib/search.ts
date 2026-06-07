// search.ts — 关键词搜索 (BM25)
//
// BM25 模式下:
//   正文 = BM25 评分 × 10 缩放
//   title/path/tags = token 命中额外加分（不参与 BM25 公式）
//   降级: bm25_stats.json 不存在时，fallback 到旧算法

import { getIndex, readBm25Stats } from "./store-index.js";
import { getContent } from "./content-cache.js";
import { tokenize } from "./tokenizer.js";
import { bm25Score, getDocTokens, readBm25Index, searchBm25Index } from "./bm25.js";
import type { Bm25Stats } from "./bm25.js";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { FileEntry, SearchHit, SearchCandidate } from "./types.js";

/** BM25 得分缩放因子（使分值落在和旧算法相近的范围） */
const BM25_SCALE = 10;

/** 字段 boost 权重 */
const TITLE_WEIGHT = 10;
const PATH_WEIGHT = 5;
const TAG_WEIGHT = 3;

/** 上下文摘取最大行长度 */
const MAX_LINE_LEN = 100;

/**
 * 从文档内容中摘取包含查询 token 的上下文行
 */
function bm25Snippet(content: string, queryTokens: string[], maxLen = MAX_LINE_LEN): string {
  const lower = content.toLowerCase();
  const lines = content.split("\n");
  const parts: string[] = [];

  // 找到第一个命中任意 query token 的行
  for (let li = 0; li < lines.length; li++) {
    const lineLower = lines[li].toLowerCase();
    const matched = queryTokens.some(tok => lineLower.includes(tok));
    if (!matched) continue;

    const prev = li > 0 ? `L${li}: ${lines[li - 1].trim().slice(0, maxLen)}` : null;
    const curr = `L${li + 1}: ${lines[li].trim().slice(0, maxLen)}`;
    const next = li < lines.length - 1 ? `L${li + 2}: ${lines[li + 1].trim().slice(0, maxLen)}` : null;

    if (prev && !parts.includes(prev)) parts.push(prev);
    if (!parts.includes(curr)) parts.push(curr);
    if (next && !parts.includes(next)) parts.push(next);
    if (parts.length >= 5) break; // 最多 5 行上下文
    li++; // 跳过 next 行，避免重复命中
  }

  return parts.join("\n");
}

/** 获取文档内容（缓存优先，磁盘 fallback） */
function getDocContent(entry: FileEntry): string | null {
  let content = getContent(entry.relPath);
  if (content) return content;
  const fullPath = resolve(entry.sourceDir, entry.relPath);
  if (!existsSync(fullPath)) return null;
  try { return readFileSync(fullPath, "utf-8"); } catch { return null; }
}

/**
 * BM25 关键词搜索
 */
export function keywordSearch(query: string): SearchHit[] {
  const index = readBm25Index();
  if (index) return keywordSearchIndex(query, index);
  const stats = readBm25Stats();
  return stats ? keywordSearchBm25(query, stats) : keywordSearchLegacy(query);
}

/** 倒排索引模式搜索 */
function keywordSearchIndex(query: string, index: import("./bm25.js").Bm25Index): SearchHit[] {
  const idx = getIndex();
  const raw = searchBm25Index(query, index, 200);
  const queryTokens = tokenize(query);
  return raw.map(r => {
    const entry = idx[r.relPath];
    if (!entry) return null;
    let snippet = "";
    const rawContent = getDocContent(entry);
    if (rawContent) snippet = bm25Snippet(rawContent, queryTokens);
    return {
      relPath: r.relPath, sourceDir: entry.sourceDir,
      title: entry.title, tags: entry.tags, snippet, score: r.score,
    };
  }).filter(Boolean) as SearchHit[];
}

/**
 * BM25 模式搜索
 */
function keywordSearchBm25(query: string, stats: Bm25Stats): SearchHit[] {
  const idx = getIndex();
  const queryTokens = tokenize(query);
  const hits: SearchHit[] = [];

  for (const [relPath, entry] of Object.entries(idx)) {
    let score = 0;

    // 字段 boost：改用 token 匹配
    const titleLower = entry.title.toLowerCase();
    const tagsLower = entry.tags.map(t => t.toLowerCase());
    for (const tok of queryTokens) {
      if (titleLower.includes(tok)) score += TITLE_WEIGHT;
      if (relPath.toLowerCase().includes(tok)) score += PATH_WEIGHT / queryTokens.length; // 拆分权重
      if (tagsLower.some(t => t.includes(tok))) score += TAG_WEIGHT;
    }

    // 正文 BM25 评分
    const docTokens = getDocTokens(entry);  // 含路径前缀，与 stats 构建对齐
    if (docTokens) {
      const bm = bm25Score(queryTokens, docTokens, stats);
      score += bm * BM25_SCALE;
    }

    if (score <= 0) continue;

    // 摘取上下文
    let snippet = "";
    const rawContent = getDocContent(entry);
    if (rawContent) {
      snippet = bm25Snippet(rawContent, queryTokens);
    }

    hits.push({
      relPath: entry.relPath, sourceDir: entry.sourceDir,
      title: entry.title, tags: entry.tags,
      snippet, score: Math.round(score),
    });
  }

  return hits.sort((a, b) => b.score - a.score);
}

/**
 * 旧版降级搜索（bm25_stats.json 不存在时使用）
 */
function keywordSearchLegacy(query: string): SearchHit[] {
  const idx = getIndex();
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];

  for (const [relPath, entry] of Object.entries(idx)) {
    let score = 0;
    const parts: string[] = [];

    if (entry.title.toLowerCase().includes(q)) score += 10;
    if (relPath.toLowerCase().includes(q)) score += 5;
    if (entry.tags.some(t => t.toLowerCase().includes(q))) score += 3;

    let content = getContent(relPath);
    if (!content) {
      const fullPath = resolve(entry.sourceDir, relPath);
      if (existsSync(fullPath)) {
        try { content = readFileSync(fullPath, "utf-8"); } catch { /* skip */ }
      }
    }
    if (content) {
      const lower = content.toLowerCase();
      let count = 0, p = lower.indexOf(q);
      while (p >= 0 && count < 5) {
        count++;
        if (count === 1) score += 1;
        const ctx = legacyContext(content, query);
        if (ctx && !parts.some(pp => pp.includes(ctx.slice(0, 30)))) {
          parts.push(ctx);
        }
        p = lower.indexOf(q, p + 1);
      }
      score += Math.min(count - 1, 9);
    }

    if (score > 0) {
      hits.push({
        relPath: entry.relPath, sourceDir: entry.sourceDir,
        title: entry.title, tags: entry.tags,
        snippet: parts.join("\n"), score,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score);
}

function legacyContext(content: string, query: string, maxLen = 100): string {
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  const pos = lower.indexOf(q);
  if (pos < 0) return "";
  const before = content.slice(0, pos);
  const lineNum = before.split("\n").length;
  const lines = content.split("\n");
  const prev = lineNum > 1 ? lines[lineNum - 2].trim() : "";
  const curr = lines[lineNum - 1].trim();
  const next = lineNum < lines.length ? lines[lineNum].trim() : "";
  const parts: string[] = [];
  if (prev) parts.push(`L${lineNum - 1}: ${prev.slice(0, maxLen)}`);
  parts.push(`L${lineNum}: ${curr.slice(0, maxLen)}`);
  if (next) parts.push(`L${lineNum + 1}: ${next.slice(0, maxLen)}`);
  return parts.join("\n");
}

export const search = keywordSearch;

// ═══════════════ 候选层（供 hybrid 融合，不经展示阈值过滤） ═══════════════

interface CandidateOptions {
  topK?: number;
}

/**
 * 关键词候选（原始 BM25 结果，无阈值裁剪）
 * 供 hybridCandidates 使用
 */
export function keywordCandidates(query: string, opts: CandidateOptions = {}): SearchCandidate[] {
  const index = readBm25Index();
  if (index) {
    const raw = searchBm25Index(query, index, opts.topK ?? 200);
    const idx = getIndex();
    return raw
      .filter(r => idx[r.relPath] !== undefined) // 过滤 stale BM25 候选
      .map(r => ({
        relPath: r.relPath, title: "", score: r.score, source: "keyword" as const,
      }));
  }
  const stats = readBm25Stats();
  if (!stats) return [];

  // fallback: 旧版 BM25 扫描
  const idx = getIndex();
  const queryTokens = tokenize(query);
  const candidates: SearchCandidate[] = [];

  for (const [relPath, entry] of Object.entries(idx)) {
    let score = 0;
    const titleLower = entry.title.toLowerCase();
    const tagsLower = entry.tags.map(t => t.toLowerCase());

    for (const tok of queryTokens) {
      if (titleLower.includes(tok)) score += TITLE_WEIGHT;
      if (relPath.toLowerCase().includes(tok)) score += PATH_WEIGHT / queryTokens.length;
      if (tagsLower.some(t => t.includes(tok))) score += TAG_WEIGHT;
    }

    const docTokens = getDocTokens(entry);
    if (docTokens) {
      score += bm25Score(queryTokens, docTokens, stats) * BM25_SCALE;
    }

    if (score <= 0) continue;

    candidates.push({ relPath, title: entry.title, score: Math.round(score), source: "keyword" });
  }

  candidates.sort((a, b) => b.score - a.score);
  return opts.topK ? candidates.slice(0, opts.topK) : candidates;
}
