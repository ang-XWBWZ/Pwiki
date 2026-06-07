// store-cleanup.ts — 统一索引清理
//
// removeEntryFromAllStores(relPath) — 从所有存储层移除一条记录：
//   index, content cache, vectors (含 ###N / ###llm), chunkInfo, manifest, BM25

import { removeEntry } from "./store-index.js";
import { removeContent } from "./content-cache.js";
import { getEmbeddings, setEmbeddings, getChunkInfo, setChunkInfo } from "./store-vectors.js";
import { removeFileState } from "./file-manifest.js";
import { buildBm25Stats } from "./bm25.js";
import { writeBm25Stats } from "./store-index.js";

/**
 * 从所有存储层移除一条文档记录
 * @returns 实际清理的向量 key 数量
 */
export function removeEntryFromAllStores(relPath: string): number {
  // 1. source index
  removeEntry(relPath);

  // 2. content cache
  removeContent(relPath);

  // 3. embeddings — 清理 relPath 及其 ###N / ###llm 变体
  const embeddings = getEmbeddings();
  let vectorCount = 0;
  for (const key of Object.keys(embeddings)) {
    // 匹配: relPath 自身，或 relPath###N 或 relPath###llm
    const prefix = key.replace(/###.*$/, "");
    if (prefix === relPath) {
      delete embeddings[key];
      vectorCount++;
    }
  }
  if (vectorCount > 0) {
    setEmbeddings(embeddings);
  }

  // 4. chunkInfo
  const chunkInfo = getChunkInfo();
  let chunkInfoCleaned = false;
  for (const key of Object.keys(chunkInfo)) {
    const prefix = key.replace(/###.*$/, "");
    if (prefix === relPath) {
      delete chunkInfo[key];
      chunkInfoCleaned = true;
    }
  }
  if (chunkInfoCleaned) {
    setChunkInfo(chunkInfo);
  }

  // 5. manifest
  removeFileState(relPath);

  // 6. BM25 — 重建全局统计
  try {
    const stats = buildBm25Stats();
    writeBm25Stats(stats);
  } catch { /* BM25 重建失败不阻塞 */ }

  return vectorCount;
}
