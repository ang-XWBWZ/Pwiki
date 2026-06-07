// indexer-compile.ts 鈥?璇箟缂栬瘧瀛樺偍 (v5.4)
//
// getRawChunks / storeCompiledChunks (v5.1 鍧楃骇)
// storeFileSegments (v5.2 鏂囦欢绾?segments 鈫?寰?v5.4 鏇挎崲涓?storeFileLLMVector)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getIndex } from "./store-index.js";
import { getEmbeddings, setEmbeddings, getChunkInfo, setChunkInfo } from "./store-vectors.js";
import { getCurrentModel } from "./model-registry.js";
import { initialize, isAvailable, embed } from "./embedder.js";
import { extractChunks } from "./indexer-embed.js";
import { buildEmbeddingText, buildFileLLMEmbeddingText } from "./semantic-compiler.js";
import type { CompiledChunk, RawChunk, FileSegment, ChunkInfo, FileLLMData, CompiledFileRecord } from "./types.js";
import type { PreprocessedChunk } from "./preprocessor.js";
import { updateFileState, computeMD5, getCompiledFilePath, ensureCompiledDir } from "./file-manifest.js";

/**
 * 鑾峰彇鎵€鏈夊凡绱㈠紩鏂囦欢鐨勫師濮嬪潡锛堜緵 AI 缂栬瘧锛? */
export async function getRawChunks(
  sourceDir?: string,
  uncompiledOnly = true,
): Promise<RawChunk[]> {
  const idx = getIndex();
  const chunkInfo = getChunkInfo();
  const entries = Object.values(idx).filter(
    (e) => !sourceDir || e.sourceDir === sourceDir,
  );

  const result: RawChunk[] = [];

  for (const entry of entries) {
    const fullPath = resolve(entry.sourceDir, entry.relPath);
    if (!existsSync(fullPath)) continue;

    const chunks = await extractChunks(fullPath, entry.relPath, entry.title);

    for (const ch of chunks) {
      const ci = chunkInfo[ch.key];
      const compiled = !!(ci?.normalizedText);
      if (uncompiledOnly && compiled) continue;

      result.push({
        key: ch.key,
        relPath: entry.relPath,
        heading: ch.heading,
        rawText: ch.rawText,
        compiled,
      });
    }
  }

  return result;
}

/**
 * 瀛樺偍鍧楃骇缂栬瘧缁撴灉骞堕噸寤?embedding (v5.1 閬楃暀)
 */
export async function storeCompiledChunks(
  compiled: CompiledChunk[],
): Promise<number> {
  if (!isAvailable()) {
    const ok = await initialize();
    if (!ok) return 0;
  }

  const chunkInfo = getChunkInfo();
  const existing = getEmbeddings();
  const rawChunks = await getRawChunks(undefined, false);
  const rawMap = new Map(rawChunks.map((r) => [r.key, r]));

  let updated = 0;

  for (const cc of compiled) {
    const ci = chunkInfo[cc.key];
    if (!ci) continue;

    Object.assign(ci, {
      topic: cc.topic,
      normalizedText: cc.normalizedText,
      concepts: cc.concepts,
      aliases: cc.aliases,
    });

    const raw = rawMap.get(cc.key);
    const rawText = raw?.rawText ?? "";
    const embeddingText = buildEmbeddingText(
      cc.topic,
      cc.normalizedText,
      cc.concepts,
      cc.aliases,
      ci.keywords ?? [],
      ci.contentClass ?? "reference",
      ci.temporalAnchor,
      rawText,
    );

    try {
      const vec = await embed(embeddingText);
      existing[cc.key] = vec;
      updated++;
    } catch {
      /* skip */
    }
  }

  if (updated > 0) {
    const model = getCurrentModel();
    setEmbeddings(existing, model.hfRepo, model.dim);
    setChunkInfo(chunkInfo);
  }

  return updated;
}

/**
 * 瀛樺偍鏂囦欢绾х紪璇戠粨鏋滃苟閲嶅缓 embedding (v5.2 鈫?v5.4 杩囨浮)
 * v5.4 TODO: 鏇挎崲涓?storeFileLLMVector 鈥?鍙寕 1 涓?###llm 鍚戦噺锛屼笉鍒?AST chunks
 */
export async function storeFileSegments(
  relPath: string,
  segments: FileSegment[],
  preprocessed: PreprocessedChunk[],
): Promise<number> {
  if (!isAvailable()) {
    const ok = await initialize();
    if (!ok) return 0;
  }

  const chunkInfo = getChunkInfo();
  const existing = getEmbeddings();

  // 娓呴櫎璇ユ枃浠剁殑鏃?chunk keys
  const oldKeys = Object.keys(chunkInfo).filter((k) => k.startsWith(relPath));
  for (const key of oldKeys) {
    delete chunkInfo[key];
    delete existing[key];
  }

  let updated = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const key = `${relPath}###${i}`;
    const pp = preprocessed[i] ?? preprocessed[0];

    const ci: ChunkInfo = {
      heading: pp?.heading ?? "",
      level: pp?.level ?? 0,
      topic: seg.topic,
      normalizedText: seg.normalizedText,
      concepts: seg.concepts,
      aliases: seg.aliases,
      chunkType: pp?.chunkType ?? "note",
      contentClass: pp?.contentClass ?? "reference",
      importance: pp?.importance ?? 0.5,
      temporalAnchor: pp?.temporalAnchor,
      confidence: pp?.confidence ?? 0.85,
      summary: pp?.summary,
      keywords: pp?.keywords,
    };

    chunkInfo[key] = ci;

    const embeddingText = buildEmbeddingText(
      seg.topic,
      seg.normalizedText,
      seg.concepts,
      seg.aliases,
      pp?.keywords ?? [],
      pp?.contentClass ?? "reference",
      pp?.temporalAnchor,
      seg.text,
    );

    try {
      const vec = await embed(embeddingText);
      existing[key] = vec;
      updated++;
    } catch {
      /* skip */
    }
  }

  if (updated > 0) {
    const model = getCurrentModel();
    setEmbeddings(existing, model.hfRepo, model.dim);
    setChunkInfo(chunkInfo);
  }

  return updated;
}

// ---- v5.4 鏂囦欢绾?LLM 鍚戦噺瀛樺偍 ----

/**
 * 瀛樺偍鏂囦欢绾?LLM 缂栬瘧缁撴灉锛氭寕杞?1 涓?###llm 鍚戦噺锛屼笉鍒犻櫎 AST chunks銆? */
export async function storeFileLLMVector(
  sourceDir: string,
  relPath: string,
  llmData: FileLLMData,
  llmModel?: string,
): Promise<boolean> {
  if (!isAvailable()) {
    const ok = await initialize();
    if (!ok) return false;
  }

  const fullPath = resolve(sourceDir, relPath);
  let currentMD5 = "";
  try { currentMD5 = computeMD5(readFileSync(fullPath, "utf-8")); } catch { return false; }

  const model = getCurrentModel();
  const maxEmbedLen = Math.floor(model.maxTokens * 2);
  const embeddingText = buildFileLLMEmbeddingText(llmData, relPath, maxEmbedLen);
  let vec: number[];
  try { vec = await embed(embeddingText); } catch { return false; }

  // 清除该文件所有旧 LLM 向量（支持多段: ###llm, ###llm0...），不删除 AST chunks (###0, ###1...)
  const existing = getEmbeddings();
  const chunkInfo = getChunkInfo();
  for (const key of Object.keys(existing)) {
    if (key.startsWith(relPath + "###llm")) {
      delete existing[key];
      delete chunkInfo[key];
    }
  }

  const vectorKey = `${relPath}###llm`;
  existing[vectorKey] = vec;
  chunkInfo[vectorKey] = {
    heading: llmData.topic, level: 0,
    topic: llmData.topic, normalizedText: llmData.normalizedText,
    concepts: llmData.concepts, aliases: llmData.aliases,
    chunkType: "llm_summary", contentClass: "knowledge",
    importance: 0.8, confidence: 0.85,
  };

  ensureCompiledDir();
  const compiledFile = getCompiledFilePath(relPath);
  const record: CompiledFileRecord = {
    relPath, compiledAt: new Date().toISOString(), sourceMD5: currentMD5,
    model: llmModel || "unknown", result: llmData, embeddingText, vectorKey,
  };
  writeFileSync(compiledFile, JSON.stringify(record, null, 2), "utf-8");

  const astChunks = await extractChunks(fullPath, relPath, "", maxEmbedLen);
  updateFileState(relPath, {
    md5: currentMD5, astChunkCount: astChunks.length,
    astIndexedAt: new Date().toISOString(),
    llmCompiled: true, llmCompiledAt: new Date().toISOString(),
  });

  // model already obtained above
  setEmbeddings(existing, model.hfRepo, model.dim);
  setChunkInfo(chunkInfo);
  return true;
}
