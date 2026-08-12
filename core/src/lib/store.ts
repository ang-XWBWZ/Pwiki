// store.ts �?数据�?barrel
// 聚合 store-config + store-index + store-vectors

export {
  getSources, addSource, removeSource,
  getSemanticEnabled, setSemanticEnabled,
  readModelId, writeModelId,
  getWikiModel, configStats,
} from "./store-config.js";

export {
  getIndex, mergeIndex, removeEntry, updateEntryPath, getEntry,
  removeEntriesBySource, indexStats,
  readBm25Stats, writeBm25Stats,
} from "./store-index.js";

export {
  getEmbeddings, setEmbeddings,
  getChunkInfo, setChunkInfo,
  removeEmbedding, getEmbeddingModel, getEmbeddingDim,
  vectorsStats,
} from "./store-vectors.js";

import { configStats } from "./store-config.js";
import { indexStats } from "./store-index.js";
import { vectorsStats } from "./store-vectors.js";
import { getSemanticEnabled } from "./store-config.js";

export function stats() {
  const c = configStats();
  const i = indexStats();
  const v = vectorsStats();
  return {
    sources: c.sources,
    files: i.files,
    lastScan: c.lastScan,
    semanticEnabled: getSemanticEnabled(),
    embeddings: v.embeddings,
  };
}
