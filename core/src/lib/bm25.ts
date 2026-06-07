// bm25.ts — BM25 倒排索引与评分
//
// v1.3 倒排索引:
//   - 全库扫描模式（v1.2）保留作为 fallback
//   - 新增倒排索引: bm25_docs.json + bm25_terms.json + bm25_meta.json
//   - 支持文件级增量更新（addDocToBM25 / removeDocFromBM25）
//   - 多字段加权 BM25F 模式
//
// 文档预处理:
//   原始正文前追加 \`[路径层级]\n\`，与语义搜索 embedText 对齐。
//
// 反向降噪:
//   构建后删除 df >= N × 0.8 的 term（高频背景词停用）。
//
// BM25 公式:
//   score = Σ fieldWeight × IDF(t) × (tf × (k1+1)) / (tf + k1 × (1-b + b×dl/avgdl))

import { tokenize } from "./tokenizer.js";
import { getIndex } from "./store-index.js";
import { getContent } from "./content-cache.js";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { wikiHome } from "../config.js";
import type { FileEntry } from "./types.js";

// ═══════════════ 类型 ═══════════════

/** BM25 统计快照（v1.2 兼容） */
export interface Bm25Stats {
  N: number;
  avgdl: number;
  df: Record<string, number>;
}

/** 倒排索引 - 文档记录 */
export interface Bm25DocRecord {
  relPath: string;
  len: number;                    // 总 token 数
  fields: Record<string, number>;  // field → token 数
}

/** 倒排索引 - 词条投递 */
export interface Bm25Posting {
  docId: string;    // relPath
  tf: number;       // term frequency in this doc
  field?: string;   // 可选：命中哪个字段
}

/** 倒排索引 - 词条记录 */
export interface Bm25TermEntry {
  df: number;
  postings: Bm25Posting[];
}

/** 倒排索引 */
export interface Bm25Index {
  version: 1;
  N: number;
  avgdl: number;
  docs: Record<string, Bm25DocRecord>;
  terms: Record<string, Bm25TermEntry>;
}

/** BM25 参数 */
const K1 = 1.5;
const B = 0.75;

/** DF 降噪阈值：出现超过此比例的 term 视为停用词 */
const DF_NOISE_THRESHOLD = 0.8;

/** 字段权重 */
const FIELD_WEIGHTS: Record<string, number> = {
  title: 3.0,
  path: 2.5,
  headings: 2.0,
  tags: 1.8,
  aliases: 1.8,
  concepts: 1.6,
  keywords: 1.5,
  normalizedText: 1.2,
  body: 1.0,
};

// ═══════════════ 倒排索引构建、更新、搜索 ═══════════════

/**
 * 构建完整倒排索引（全量扫描）
 */
export function buildBm25Index(): Bm25Index {
  const idx = getIndex();
  const entries = Object.values(idx);

  const index: Bm25Index = { version: 1, N: 0, avgdl: 0, docs: {}, terms: {} };
  for (const e of entries) addDocToIndex(e, index);

  // 反向降噪
  const threshold = index.N * DF_NOISE_THRESHOLD;
  for (const [term, entry] of Object.entries(index.terms)) {
    if (entry.df >= threshold) delete index.terms[term];
  }

  return index;
}

/**
 * 向倒排索引添加/更新一篇文档
 */
export function addDocToIndex(entry: FileEntry, index: Bm25Index): void {
  const raw = getDocContent(entry);
  if (!raw) return;

  // 先移除旧记录（如有）
  removeDocFromIndex(entry.relPath, index);

  const fullText = pathPrefix(entry.relPath) + "\n" + raw;

  // 按字段分词
  const bodyTokens = tokenize(fullText);
  const titleTokens = tokenize(entry.title);
  const pathTokens = tokenize(pathPrefix(entry.relPath));
  const tagTokens = entry.tags.length > 0 ? tokenize(entry.tags.join(" ")) : [];

  // 文档统计
  const doc: Bm25DocRecord = {
    relPath: entry.relPath,
    len: bodyTokens.length,
    fields: {
      body: bodyTokens.length,
      title: titleTokens.length,
      path: pathTokens.length,
      tags: tagTokens.length,
    },
  };
  index.docs[entry.relPath] = doc;

  // 更新倒排
  addFieldTerms("body", bodyTokens, entry.relPath, index);
  addFieldTerms("title", titleTokens, entry.relPath, index);
  addFieldTerms("path", pathTokens, entry.relPath, index);
  if (tagTokens.length > 0) addFieldTerms("tags", tagTokens, entry.relPath, index);

  // 重新计算 N/avgdl
  const docs = Object.values(index.docs);
  index.N = docs.length;
  let total = 0;
  for (const d of docs) total += d.len;
  index.avgdl = index.N > 0 ? total / index.N : 0;
}

/**
 * 从倒排索引移除一篇文档
 */
export function removeDocFromIndex(relPath: string, index: Bm25Index): void {
  const doc = index.docs[relPath];
  if (!doc) return;

  // 重建 term 统计（删除该 doc 的 postings）
  const allTokens = new Set<string>();
  for (const [term, entry] of Object.entries(index.terms)) {
    const before = entry.postings.length;
    entry.postings = entry.postings.filter(p => p.docId !== relPath);
    if (entry.postings.length < before) {
      entry.df = entry.postings.length;
      allTokens.add(term);
    }
  }

  // 清理空 term
  for (const term of allTokens) {
    if (index.terms[term].df === 0) delete index.terms[term];
  }

  // 删除文档记录
  delete index.docs[relPath];

  // 重新计算 N/avgdl
  const docs = Object.values(index.docs);
  index.N = docs.length;
  let total = 0;
  for (const d of docs) total += d.len;
  index.avgdl = index.N > 0 ? total / index.N : 0;
}

/**
 * 使用倒排索引进行 BM25F 搜索
 */
export function searchBm25Index(query: string, index: Bm25Index, topK = 200): { relPath: string; score: number }[] {
  const queryTokens = tokenize(query);
  if (index.N === 0 || index.avgdl === 0) return [];

  const scores = new Map<string, number>();
  const seenTerms = new Set<string>();

  for (const qt of queryTokens) {
    if (seenTerms.has(qt)) continue;
    seenTerms.add(qt);

    const termEntry = index.terms[qt];
    if (!termEntry) continue;

    const idfVal = Math.log((index.N - termEntry.df + 0.5) / (termEntry.df + 0.5) + 1);
    if (idfVal <= 0) continue;

    for (const posting of termEntry.postings) {
      const doc = index.docs[posting.docId];
      if (!doc) continue;

      const dl = doc.len;
      const tf = posting.tf;
      const fieldWeight = posting.field ? (FIELD_WEIGHTS[posting.field] ?? 1.0) : 1.0;

      const numerator = tf * (K1 + 1);
      const denominator = tf + K1 * (1 - B + B * (dl / index.avgdl));
      const termScore = fieldWeight * idfVal * (numerator / denominator);

      scores.set(posting.docId, (scores.get(posting.docId) ?? 0) + termScore);
    }
  }

  const results = [...scores.entries()]
    .map(([relPath, score]) => ({ relPath, score: Math.round(score * 10) }))
    .sort((a, b) => b.score - a.score);

  return topK ? results.slice(0, topK) : results;
}

/** 向索引添加一个字段的 term */
function addFieldTerms(field: string, tokens: string[], docId: string, index: Bm25Index): void {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  for (const [term, freq] of tf) {
    if (!index.terms[term]) index.terms[term] = { df: 0, postings: [] };
    index.terms[term].postings.push({ docId, tf: freq, field });
    index.terms[term].df++;
  }
}

// ═══════════════ 倒排索引持久化 ═══════════════

function bm25DocsFile(): string { return join(wikiHome(), "bm25_docs.json"); }
function bm25TermsFile(): string { return join(wikiHome(), "bm25_terms.json"); }
function bm25MetaFile(): string { return join(wikiHome(), "bm25_meta.json"); }

export function readBm25Index(): Bm25Index | null {
  try {
    const dp = bm25DocsFile();
    const tp = bm25TermsFile();
    const mp = bm25MetaFile();
    if (!existsSync(dp) || !existsSync(tp)) return null;
    const docs = JSON.parse(readFileSync(dp, "utf-8"));
    const terms = JSON.parse(readFileSync(tp, "utf-8"));
    const meta = existsSync(mp) ? JSON.parse(readFileSync(mp, "utf-8")) : { version: 1, N: 0, avgdl: 0 };
    return { version: 1, N: meta.N, avgdl: meta.avgdl, docs, terms };
  } catch { return null; }
}

export function writeBm25Index(index: Bm25Index): void {
  writeFileSync(bm25DocsFile(), JSON.stringify(index.docs, null, 2), "utf-8");
  writeFileSync(bm25TermsFile(), JSON.stringify(index.terms, null, 2), "utf-8");
  writeFileSync(bm25MetaFile(), JSON.stringify({ version: index.version, N: index.N, avgdl: index.avgdl }), "utf-8");
}

// ═══════════════ 旧版统计（v1.2 兼容，保持向后兼容） ═══════════════

/** BM25 构建（旧版，v1.2 兼容） */
export function buildBm25Stats(): Bm25Stats {
  const idx = getIndex();
  const entries = Object.values(idx);

  if (entries.length === 0) {
    return { N: 0, avgdl: 0, df: {} };
  }

  const df = new Map<string, number>();
  let totalLength = 0;
  let docCount = 0;

  for (const entry of entries) {
    const tokens = getDocTokens(entry);
    if (!tokens) continue;

    totalLength += tokens.length;
    docCount++;

    const seen = new Set<string>();
    for (const tok of tokens) {
      if (!seen.has(tok)) {
        seen.add(tok);
        df.set(tok, (df.get(tok) ?? 0) + 1);
      }
    }
  }

  if (docCount > 0) {
    const threshold = docCount * DF_NOISE_THRESHOLD;
    for (const [term, count] of df) {
      if (count >= threshold) df.delete(term);
    }
  }

  const dfObj: Record<string, number> = {};
  for (const [term, count] of df) dfObj[term] = count;

  return { N: docCount, avgdl: docCount > 0 ? totalLength / docCount : 0, df: dfObj };
}

/**
 * 将文件路径转换为层级前缀（与语义搜索 embedText 对齐）
 * @example "工作/AMI/更新/10.18.md" → "[工作 > AMI > 更新 > 10.18]"
 */
function pathPrefix(relPath: string): string {
  return "[" + relPath
    .replace(/\\/g, "/")
    .replace(/\//g, " > ")
    .replace(/\.md$/i, "")
    + "]";
}

/**
 * 获取文档的完整分词结果（含路径前缀）
 * 统计构建和搜索都通过此函数，确保 token 对齐。
 */
export function getDocTokens(entry: FileEntry): string[] | null {
  const raw = getDocContent(entry);
  if (!raw) return null;
  const fullText = pathPrefix(entry.relPath) + "\n" + raw;
  return tokenize(fullText);
}

/**
 * 获取文档文本内容
 */
function getDocContent(entry: FileEntry): string | null {
  let content = getContent(entry.relPath);
  if (content) return content;
  const fullPath = resolve(entry.sourceDir, entry.relPath);
  if (!existsSync(fullPath)) return null;
  try { return readFileSync(fullPath, "utf-8"); } catch { return null; }
}

/**
 * IDF 计算 (BM25 标准公式)
 */
export function idf(term: string, stats: Bm25Stats): number {
  const df = stats.df[term] ?? 0;
  if (df === 0) return 0;
  return Math.log((stats.N - df + 0.5) / (df + 0.5) + 1);
}

/**
 * 计算一篇文档对查询的 BM25 分数
 */
export function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  stats: Bm25Stats,
): number {
  if (stats.N === 0 || stats.avgdl === 0) return 0;
  const dl = docTokens.length;
  const termFreq = new Map<string, number>();
  for (const tok of docTokens) termFreq.set(tok, (termFreq.get(tok) ?? 0) + 1);

  let score = 0;
  for (const qt of queryTokens) {
    const tf = termFreq.get(qt) ?? 0;
    if (tf === 0) continue;
    const idfVal = idf(qt, stats);
    if (idfVal === 0) continue;
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (dl / stats.avgdl));
    score += idfVal * (numerator / denominator);
  }
  return score;
}
