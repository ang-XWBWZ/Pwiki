// bm25.ts — BM25 倒排索引与评分
//
// v1.3.1 倒排索引:
//   - 全库扫描模式（v1.2）保留作为 fallback
//   - SQLite 持久化，查询只读取命中 term 的 postings
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

import { analyze, tokenize } from "./tokenizer.js";
import { DEFAULT_ANALYZER_CONFIG, type AnalyzedToken, type TokenSource } from "./analyzer/types.js";
import { effectiveTokenWeight } from "./analyzer/token-weights.js";
import { isProtectedWord } from "./analyzer/stopword-store.js";
import { BM25_INDEX_VERSION } from "./bm25-schema.js";
export { BM25_INDEX_VERSION } from "./bm25-schema.js";
import { getIndex } from "./store-index.js";
import { getContent } from "./content-cache.js";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { wikiHome } from "../config.js";
import { getChunkInfo } from "./store-vectors.js";
import { getFileState } from "./file-manifest.js";
import type { FileEntry, KeywordEvidence, KeywordTermEvidence } from "./types.js";

// ═══════════════ 类型 ═══════════════

/** BM25 统计快照（v1.2 兼容） */
export interface Bm25Stats {
  /** Optional in the public type for source compatibility; persisted snapshots require v2. */
  version?: typeof BM25_INDEX_VERSION;
  N: number;
  avgdl: number;
  df: Record<string, number>;
}

/** 倒排索引 - 文档记录 */
export interface Bm25DocRecord {
  relPath: string;
  len: number;                    // 总 token 数
  fields: Record<string, number>;  // field → token 数
  terms: string[];                // 用于 O(文档词数) 增量删除
}

/** 倒排索引 - 词条投递 */
export interface Bm25Posting {
  docId: string;    // relPath
  tf: number;       // term frequency in this doc
  field: string;    // 命中字段
  tokenWeight: number;
  positions: number[];
  sources: TokenSource[];
}

/** 倒排索引 - 词条记录 */
export interface Bm25TermEntry {
  df: number;
  postings: Bm25Posting[];
}

/** 倒排索引 */
export interface Bm25Index {
  version: typeof BM25_INDEX_VERSION;
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

/** 读取 LLM 编译字段 */
function readCompiledFields(relPath: string, sourceId?: string): Record<string, string> | null {
  const result: Record<string, string> = {};

  // 正文变更后，旧编译字段不能继续参与关键词排序。
  const state = getFileState(relPath, sourceId);
  if (state && (
    !state.llmCompiled
    || (state.llmCompiledMd5 ?? state.md5) !== state.md5
  )) return null;

  // 1. 尝试从 chunkInfo[relPath###llm] 读取
  const ci = getChunkInfo(sourceId);
  const llmKey = `${relPath}###llm`;
  const llm = ci[llmKey];
  if (llm?.topic) result.topic = llm.topic;
  if (llm?.normalizedText) result.normalizedText = llm.normalizedText;
  if (llm?.concepts?.length) result.concepts = llm.concepts.join(" ");
  if (llm?.aliases?.length) result.aliases = llm.aliases.join(" ");
  if (llm?.keywords?.length) result.keywords = llm.keywords.join(" ");

  // 2. 尝试从 compiled/ 文件读取
  try {
    if (sourceId) return Object.keys(result).length > 0 ? result : null;
    const safeName = relPath.replace(/\\/g, "_").replace(/\//g, "_").replace(/\.md$/i, "") + ".json";
    const compiledPath = join(wikiHome(), "compiled", safeName);
    if (existsSync(compiledPath)) {
      const record = JSON.parse(readFileSync(compiledPath, "utf-8"));
      const r = record?.result;
      if (r?.topic && !result.topic) result.topic = r.topic;
      if (r?.normalizedText && !result.normalizedText) result.normalizedText = r.normalizedText;
      if (r?.concepts?.length && !result.concepts) result.concepts = r.concepts.join(" ");
      if (r?.aliases?.length && !result.aliases) result.aliases = r.aliases.join(" ");
    }
  } catch { /* ignore */ }

  return Object.keys(result).length > 0 ? result : null;
}

// ═══════════════ 倒排索引构建、更新、搜索 ═══════════════

/**
 * 构建完整倒排索引（全量扫描）
 */
export function buildBm25Index(
  sourceEntries?: FileEntry[],
  sourceId?: string,
): Bm25Index {
  const entries = sourceEntries ?? Object.values(getIndex());

  const index: Bm25Index = { version: BM25_INDEX_VERSION, N: 0, avgdl: 0, docs: {}, terms: {} };
  for (const e of entries) addDocToIndex(e, index, sourceId);

  return index;
}

/**
 * 向倒排索引添加/更新一篇文档
 */
export function addDocToIndex(
  entry: FileEntry,
  index: Bm25Index,
  sourceId?: string,
): void {
  const raw = getDocContent(entry);
  // 先移除旧记录（如有）
  removeDocFromIndex(entry.relPath, index);
  if (raw === null) return;

  const fullText = pathPrefix(entry.relPath) + "\n" + raw;

  // 按字段分词
  const bodyTokens = analyze(fullText, { field: "body" });
  const titleTokens = analyze(entry.title, { field: "title" });
  const pathTokens = analyze(pathPrefix(entry.relPath), { field: "path" });
  const tagTokens = entry.tags.length > 0 ? analyze(entry.tags.join(" "), { field: "tags" }) : [];

  // 文档统计
  const doc: Bm25DocRecord = {
    relPath: entry.relPath,
    len: bodyTokens.length,
    terms: [],
    fields: {
      body: bodyTokens.length,
      title: titleTokens.length,
      path: pathTokens.length,
      tags: tagTokens.length,
    },
  };
  index.docs[entry.relPath] = doc;
  const docTerms = new Set<string>();

  // 更新倒排
  addFieldTerms("body", bodyTokens, entry.relPath, index, docTerms);
  addFieldTerms("title", titleTokens, entry.relPath, index, docTerms);
  addFieldTerms("path", pathTokens, entry.relPath, index, docTerms);
  if (tagTokens.length > 0) addFieldTerms("tags", tagTokens, entry.relPath, index, docTerms);

  // LLM compiled 字段: topic, concepts, aliases, normalizedText, keywords
  const compiledFields = readCompiledFields(entry.relPath, sourceId);
  if (compiledFields) {
    for (const [field, text] of Object.entries(compiledFields)) {
      if (!text) continue;
      const tokens = analyze(text, { field });
      if (tokens.length > 0) {
        doc.fields[field] = tokens.length;
        addFieldTerms(field, tokens, entry.relPath, index, docTerms);
      }
    }
  }
  doc.terms = [...docTerms];

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

  // v3 直接访问该文档出现过的 term；旧快照才回退扫描词表。
  const allTokens = new Set(
    doc.terms?.length ? doc.terms : Object.keys(index.terms),
  );
  for (const term of allTokens) {
    const entry = index.terms[term];
    if (!entry) continue;
    const before = entry.postings.length;
    entry.postings = entry.postings.filter(p => p.docId !== relPath);
    if (entry.postings.length < before) {
      entry.df = new Set(entry.postings.map((posting) => posting.docId)).size;
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
export function searchBm25Index(
  query: string,
  index: Bm25Index,
  topK = 200,
  includeDocument?: (relPath: string) => boolean,
): { relPath: string; score: number; keywordEvidence: KeywordEvidence }[] {
  const queryTokens = analyze(query);
  if (index.N === 0 || index.avgdl === 0) return [];

  const scores = new Map<string, number>();
  const evidence = new Map<string, Map<string, KeywordTermEvidence>>();
  const queryTerms = new Map<string, { weight: number; sources: Set<TokenSource> }>();

  for (const token of queryTokens) {
    const weight = effectiveTokenWeight(token, DEFAULT_ANALYZER_CONFIG);
    const current = queryTerms.get(token.normalized);
    if (!current) {
      queryTerms.set(token.normalized, { weight, sources: new Set(token.sources) });
    } else {
      current.weight = Math.max(current.weight, weight);
      for (const source of token.sources) current.sources.add(source);
    }
  }

  for (const [term, queryTerm] of queryTerms) {
    const termEntry = index.terms[term];
    if (!termEntry) continue;
    if (index.N > 1 && termEntry.df >= index.N * DF_NOISE_THRESHOLD && !isProtectedWord(term)) continue;

    const idfVal = Math.log((index.N - termEntry.df + 0.5) / (termEntry.df + 0.5) + 1);
    if (idfVal <= 0) continue;

    for (const posting of termEntry.postings) {
      if (includeDocument && !includeDocument(posting.docId)) continue;
      const doc = index.docs[posting.docId];
      if (!doc) continue;

      const dl = doc.len;
      const tf = posting.tf;
      const fieldWeight = FIELD_WEIGHTS[posting.field] ?? 1.0;

      const numerator = tf * (K1 + 1);
      const denominator = tf + K1 * (1 - B + B * (dl / index.avgdl));
      const baseScore = fieldWeight * idfVal * (numerator / denominator);
      const lexicalWeight = Math.min(
        1.8,
        Math.max(0.15, Math.sqrt(queryTerm.weight * posting.tokenWeight)),
      );
      const termScore = baseScore * lexicalWeight;

      scores.set(posting.docId, (scores.get(posting.docId) ?? 0) + termScore);

      let docEvidence = evidence.get(posting.docId);
      if (!docEvidence) evidence.set(posting.docId, (docEvidence = new Map()));
      const current = docEvidence.get(term);
      if (current) {
        current.documentWeight = Math.max(current.documentWeight, posting.tokenWeight);
        current.lexicalWeight = Math.max(current.lexicalWeight, lexicalWeight);
        current.contribution += termScore * 10;
        if (!current.fields.includes(posting.field)) current.fields.push(posting.field);
        for (const source of posting.sources) {
          if (!current.documentSources.includes(source)) current.documentSources.push(source);
        }
      } else {
        docEvidence.set(term, {
          term,
          queryWeight: queryTerm.weight,
          documentWeight: posting.tokenWeight,
          lexicalWeight,
          fields: [posting.field],
          querySources: [...queryTerm.sources],
          documentSources: [...posting.sources],
          contribution: termScore * 10,
        });
      }
    }
  }

  const results = [...scores.entries()]
    .map(([relPath, score]) => {
      const scaledScore = score * 10;
      const matchedTerms = [...(evidence.get(relPath)?.values() ?? [])]
        .map(item => ({
          ...item,
          queryWeight: Number(item.queryWeight.toFixed(4)),
          documentWeight: Number(item.documentWeight.toFixed(4)),
          lexicalWeight: Number(item.lexicalWeight.toFixed(4)),
          contribution: Number(item.contribution.toFixed(4)),
        }))
        .sort((a, b) => b.contribution - a.contribution);
      return {
        relPath,
        score: Math.round(scaledScore),
        keywordEvidence: {
          score: Number(scaledScore.toFixed(4)),
          matchedTerms,
        },
      };
    })
    .sort((a, b) => b.score - a.score);

  return topK ? results.slice(0, topK) : results;
}

/** 向索引添加一个字段的 term */
function addFieldTerms(
  field: string,
  tokens: AnalyzedToken[],
  docId: string,
  index: Bm25Index,
  docTerms: Set<string>,
): void {
  const terms = new Map<string, {
    occurrences: Set<string>;
    positions: Set<number>;
    tokenWeight: number;
    sources: Set<TokenSource>;
  }>();

  for (const token of tokens) {
    let aggregate = terms.get(token.normalized);
    if (!aggregate) {
      aggregate = {
        occurrences: new Set(),
        positions: new Set(),
        tokenWeight: 0,
        sources: new Set(),
      };
      terms.set(token.normalized, aggregate);
    }
    aggregate.occurrences.add(`${token.start}:${token.end}`);
    aggregate.positions.add(token.position);
    aggregate.tokenWeight = Math.max(
      aggregate.tokenWeight,
      effectiveTokenWeight(token, DEFAULT_ANALYZER_CONFIG),
    );
    for (const source of token.sources) aggregate.sources.add(source);
  }

  for (const [term, aggregate] of terms) {
    docTerms.add(term);
    if (!index.terms[term]) index.terms[term] = { df: 0, postings: [] };
    const termEntry = index.terms[term];
    termEntry.postings.push({
      docId,
      tf: aggregate.occurrences.size,
      field,
      tokenWeight: aggregate.tokenWeight,
      positions: [...aggregate.positions].sort((a, b) => a - b),
      sources: [...aggregate.sources],
    });
    termEntry.df = new Set(termEntry.postings.map(posting => posting.docId)).size;
  }
}

// SQLite 持久化位于独立模块；仅 type-import 本文件，避免运行时循环依赖。
export {
  closeBm25Databases,
  hasBm25Index,
  readBm25Index,
  readBm25QueryIndex,
  upsertBm25Document,
  writeBm25Index,
} from "./bm25-sqlite.js";

/** 从 v3 倒排索引生成旧接口需要的统计快照，不再重新扫描全部正文。 */
export function bm25StatsFromIndex(index: Bm25Index): Bm25Stats {
  return {
    version: BM25_INDEX_VERSION,
    N: index.N,
    avgdl: index.avgdl,
    df: Object.fromEntries(
      Object.entries(index.terms).map(([term, entry]) => [term, entry.df]),
    ),
  };
}

// ═══════════════ 旧版统计（v1.2 兼容，保持向后兼容） ═══════════════

/** BM25 构建（旧版，v1.2 兼容） */
export function buildBm25Stats(sourceEntries?: FileEntry[]): Bm25Stats {
  const entries = sourceEntries ?? Object.values(getIndex());

  if (entries.length === 0) {
    return { version: BM25_INDEX_VERSION, N: 0, avgdl: 0, df: {} };
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

  if (docCount > 1) {
    const threshold = docCount * DF_NOISE_THRESHOLD;
    for (const [term, count] of df) {
      if (count >= threshold && !isProtectedWord(term)) df.delete(term);
    }
  }

  const dfObj: Record<string, number> = {};
  for (const [term, count] of df) dfObj[term] = count;

  return {
    version: BM25_INDEX_VERSION,
    N: docCount,
    avgdl: docCount > 0 ? totalLength / docCount : 0,
    df: dfObj,
  };
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
  if (raw === null) return null;
  const fullText = pathPrefix(entry.relPath) + "\n" + raw;
  return tokenize(fullText);
}

/**
 * 获取文档文本内容
 */
function getDocContent(entry: FileEntry): string | null {
  let content = getContent(entry.relPath, entry.sourceDir);
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
