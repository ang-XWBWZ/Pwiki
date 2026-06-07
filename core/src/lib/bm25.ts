// bm25.ts — BM25 统计构建与评分
//
// 统计数据:
//   N      — 文档总数
//   avgdl  — 平均文档 token 数
//   df     — 每个 term 出现在多少篇文档中 (Document Frequency)
//
// 文档预处理（与语义搜索对齐）:
//   原始正文前追加 \`[路径层级]\n\`，使得文件名和目录名参与分词。
//   Markdown 标题（# ...）本已是正文一部分，无需额外处理。
//
// 反向降噪:
//   构建统计后删除 df >= N × 0.8 的 term（高频背景词停用）。
//
// BM25 公式 (k1=1.5, b=0.75):
//   score(D, Q) = Σ IDF(t) × (tf × (k1+1)) / (tf + k1 × (1-b + b×dl/avgdl))
//   IDF(t) = ln((N - df + 0.5) / (df + 0.5) + 1)

import { tokenize } from "./tokenizer.js";
import { getIndex } from "./store-index.js";
import { getContent } from "./content-cache.js";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { FileEntry } from "./types.js";

/** BM25 统计快照 */
export interface Bm25Stats {
  N: number;
  avgdl: number;
  df: Record<string, number>;
}

/** BM25 参数 */
const K1 = 1.5;
const B = 0.75;

/** DF 降噪阈值：出现超过此比例的 term 视为停用词 */
const DF_NOISE_THRESHOLD = 0.8;

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
 * 遍历所有已索引文件，构建 BM25 统计
 */
export function buildBm25Stats(): Bm25Stats {
  const idx = getIndex();
  const entries = Object.values(idx);

  if (entries.length === 0) {
    return { N: 0, avgdl: 0, df: {} };
  }

  const df = new Map<string, number>();  // term → 出现该 term 的 doc 数
  let totalLength = 0;                    // 所有文档的 token 总数
  let docCount = 0;                       // 成功分词的文档数

  for (const entry of entries) {
    const tokens = getDocTokens(entry);   // 含路径前缀
    if (!tokens) continue;

    totalLength += tokens.length;
    docCount++;

    // 每篇文档的 term 只记一次（DF 计数）
    const seen = new Set<string>();
    for (const tok of tokens) {
      if (!seen.has(tok)) {
        seen.add(tok);
        df.set(tok, (df.get(tok) ?? 0) + 1);
      }
    }
  }

  // 反向降噪：删除出现在 ≥80% 文档中的 term（停用词过滤）
  if (docCount > 0) {
    const threshold = docCount * DF_NOISE_THRESHOLD;
    for (const [term, count] of df) {
      if (count >= threshold) df.delete(term);
    }
  }

  const dfObj: Record<string, number> = {};
  for (const [term, count] of df) {
    dfObj[term] = count;
  }

  return {
    N: docCount,
    avgdl: docCount > 0 ? totalLength / docCount : 0,
    df: dfObj,
  };
}

/**
 * IDF 计算 (BM25 标准公式)
 */
export function idf(term: string, stats: Bm25Stats): number {
  const df = stats.df[term] ?? 0;
  if (df === 0) return 0;
  // BM25 standard IDF: ln((N - df + 0.5) / (df + 0.5) + 1)
  return Math.log((stats.N - df + 0.5) / (df + 0.5) + 1);
}

/**
 * 计算一篇文档对查询的 BM25 分数
 *
 * @param queryTokens 查询分词结果
 * @param docTokens   文档分词结果
 * @param stats       全局 BM25 统计
 * @returns BM25 score（未缩放）
 */
export function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  stats: Bm25Stats,
): number {
  if (stats.N === 0 || stats.avgdl === 0) return 0;

  const dl = docTokens.length; // 文档长度 (token 数)

  // 统计文档中每个 term 的频率
  const termFreq = new Map<string, number>();
  for (const tok of docTokens) {
    termFreq.set(tok, (termFreq.get(tok) ?? 0) + 1);
  }

  let score = 0;
  for (const qt of queryTokens) {
    const tf = termFreq.get(qt) ?? 0;
    if (tf === 0) continue;

    const idfVal = idf(qt, stats);
    if (idfVal === 0) continue;

    // BM25 term score
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (dl / stats.avgdl));
    score += idfVal * (numerator / denominator);
  }

  return score;
}

/**
 * 获取文档文本内容
 */
function getDocContent(entry: FileEntry): string | null {
  let content = getContent(entry.relPath);
  if (content) return content;

  // Fallback: 从磁盘读取
  const fullPath = resolve(entry.sourceDir, entry.relPath);
  if (!existsSync(fullPath)) return null;
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}
