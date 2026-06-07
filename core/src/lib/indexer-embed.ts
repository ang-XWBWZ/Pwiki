// indexer-embed.ts 鈥?鍚戦噺鐢熸垚 (v5.4)
//
// extractChunks (濮旀墭 ast-chunker) + generateEmbeddings + embedSingleFile

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getSemanticEnabled } from "./store-config.js";
import { getEmbeddings, setEmbeddings, getChunkInfo, setChunkInfo, setCentroid } from "./store-vectors.js";
import { getCurrentModel } from "./model-registry.js";
import { initialize, isAvailable, embed } from "./embedder.js";
import { extractChunksAST } from "./ast-chunker.js";
import { updateFileState, computeMD5, getFileState, detectFileChange, getManifest } from "./file-manifest.js";
import type { FileEntry } from "./types.js";

/** 鏍囬琛屾鍒欙紙浠呯敤浜?fallback锛?*/
const HEADING_RE = /^#{1,4} /;

/** 鍘婚櫎 markdown 鏍囪锛屾埅鏂?*/
function plainText(text: string, maxLen: number): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__|\*|_|`|~~/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, maxLen);
}

/**
 * 鎸夋爣棰樺皢鏂囦欢鍒嗗壊涓哄涓潡銆? * v5.3: 浼樺厛 AST 瑙ｆ瀽锛屽け璐ラ檷绾?regex銆? */
export async function extractChunks(
  filePath: string,
  relPath: string,
  defaultTitle: string,
  maxEmbedLen = 800,
): Promise<{ key: string; heading: string; level: number; embedText: string; rawText: string; headingPath: string[]; chunkTypeHint: string; wikilinks: string[]; startLine: number; endLine: number }[]> {
  try {
    const raw = readFileSync(filePath, "utf-8");
    // 浼樺厛 AST
    const astChunks = await extractChunksAST(raw, relPath, defaultTitle, maxEmbedLen);
    if (astChunks.length > 0) {
      return astChunks.map((c) => ({
        key: c.key,
        heading: c.heading,
        level: c.level,
        embedText: c.embedText,
        rawText: c.rawText,
        headingPath: c.headingPath,
        chunkTypeHint: c.chunkTypeHint,
        wikilinks: c.wikilinks,
        startLine: c.startLine,
        endLine: c.endLine,
      }));
    }
  } catch {
    /* fall through to regex */
  }

  // fallback: regex
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n");
    const chunks: { heading: string; level: number; lines: string[] }[] = [];

    for (const line of lines) {
      const m = line.match(HEADING_RE);
      if (m) {
        const heading = line.trim();
        const level = heading.match(/^#+/)![0].length;
        chunks.push({ heading, level, lines: [] });
      } else if (chunks.length > 0) {
        chunks[chunks.length - 1].lines.push(line);
      } else {
        if (!chunks.length || chunks[chunks.length - 1].heading !== "") {
          chunks.push({ heading: "", level: 0, lines: [] });
        }
        chunks[chunks.length - 1].lines.push(line);
      }
    }

    if (chunks.length === 0) {
      chunks.push({ heading: defaultTitle, level: 0, lines });
    }

    let fmTitle = "";
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      for (const fl of fmMatch[1].split("\n")) {
        const ci = fl.indexOf(":");
        if (ci < 0) continue;
        const k = fl.slice(0, ci).trim();
        if (k === "title") fmTitle = fl.slice(ci + 1).trim().replace(/['"]/g, "");
      }
    }

    const result: { key: string; heading: string; level: number; embedText: string; rawText: string; headingPath: string[]; chunkTypeHint: string; wikilinks: string[]; startLine: number; endLine: number }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      let heading: string;
      let level: number;

      if (i === 0 && ch.heading === "" && ch.level === 0) {
        heading = fmTitle || defaultTitle;
        level = 0;
      } else if (i === 0 && ch.level > 0) {
        heading = fmTitle || defaultTitle;
        level = 0;
      } else {
        heading = ch.heading;
        level = ch.level;
      }

      const headingClean = heading.replace(/^#+\s*/, "");
      const rawText = heading ? `${heading}\n${ch.lines.join("\n")}` : ch.lines.join("\n");
      const pathContext = relPath.replace(/\\/g, "/").replace(/\//g, " > ").replace(/\.md$/i, "");
      const embedText = `[${pathContext}]\n${headingClean}\n${plainText(ch.lines.join("\n"), maxEmbedLen)}`;

      result.push({
        key: `${relPath.replace(/\\/g, "/")}###${i}`,
        heading,
        level,
        embedText,
        rawText,
        headingPath: [headingClean],
        chunkTypeHint: "note",
        wikilinks: [],
        startLine: 1,
        endLine: 1,
      });
    }

    return result;
  } catch {
    return [{ key: relPath, heading: defaultTitle, level: 0, embedText: defaultTitle, rawText: defaultTitle, headingPath: [defaultTitle], chunkTypeHint: "note", wikilinks: [], startLine: 1, endLine: 1 }];
  }
}

/**
 * 鎵归噺鐢熸垚 embedding 骞舵寔涔呭寲鍒?vectors.json
 */
export async function generateEmbeddings(
  sourceDir: string,
  entries: FileEntry[],
): Promise<number> {
  if (!getSemanticEnabled()) return 0;

  if (!isAvailable()) {
    const ok = await initialize();
    if (!ok) return 0;
  }

  const model = getCurrentModel();
  const maxEmbedLen = Math.floor(model.maxTokens * 2); // 浼扮畻瀛楃涓婇檺锛堜腑瑗挎贩鍚堜繚瀹堝€硷級

  const existing = getEmbeddings();
  const chunkInfo = getChunkInfo();

  let generated = 0;
  const toEmbed: { key: string; heading: string; level: number; text: string; headingPath?: string[]; chunkTypeHint?: string; wikilinks?: string[]; startLine?: number; endLine?: number; relPath: string; md5: string; chunkCount: number }[] = [];

  for (const entry of entries) {
    const fullPath = resolve(sourceDir, entry.relPath);

    let currentContent: string;
    try {
      currentContent = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    // 用 manifest md5 检测变更（而非 mtime 比较）
    const manifest = getManifest();
    const detection = detectFileChange(entry.relPath, currentContent, manifest);
    if (!detection.changed) continue;

    // P0.3: 重建前清理该文件所有旧 vector/chunkInfo
    for (const key of Object.keys(existing)) {
      if (key === entry.relPath || key.startsWith(`${entry.relPath}###`)) {
        delete existing[key];
        delete chunkInfo[key];
      }
    }

    const chunks = await extractChunks(fullPath, entry.relPath, entry.title, maxEmbedLen);

    // 暂存 embedding 任务，manifest 延后到生成成功后再更新
    const pendingChunks = chunks.map(ch => ({
      key: ch.key, heading: ch.heading, level: ch.level, text: ch.embedText,
      headingPath: ch.headingPath, chunkTypeHint: ch.chunkTypeHint,
      wikilinks: ch.wikilinks, startLine: ch.startLine, endLine: ch.endLine,
      relPath: entry.relPath, md5: detection.currentMd5, chunkCount: chunks.length,
    }));
    toEmbed.push(...pendingChunks);
  }

  const generatedFiles = new Set<string>();
  for (const { key, heading, level, text, headingPath, chunkTypeHint, wikilinks, startLine, endLine, relPath, md5, chunkCount } of toEmbed) {
    try {
      const vec = await embed(text);
      existing[key] = vec;
      chunkInfo[key] = {
        heading, level,
        headingPath, chunkTypeHint, wikilinks, startLine, endLine,
      };
      generated++;
      generatedFiles.add(relPath);
    } catch {
      /* skip */
    }
  }

  // P0.2: embedding 生成成功后，再原子更新 manifest md5
  for (const item of toEmbed) {
    if (generatedFiles.has(item.relPath)) {
      updateFileState(item.relPath, {
        md5: item.md5,
        astChunkCount: item.chunkCount,
        astIndexedAt: new Date().toISOString(),
      });
    }
  }

  // 娓呯悊鏃ф枃浠剁骇 key
  for (const entry of entries) {
    if (existing[entry.relPath] && existing[`${entry.relPath}###0`]) {
      delete existing[entry.relPath];
      delete chunkInfo[entry.relPath];
    }
  }

  if (generated > 0) {
    const model = getCurrentModel();
    setEmbeddings(existing, model.hfRepo, model.dim);
    setChunkInfo(chunkInfo);
  }

  recomputeCentroid();

  // v5.4: 补 manifest
  for (const entry of entries) {
    if (!getFileState(entry.relPath)) {
      try {
        const fullPath = resolve(sourceDir, entry.relPath);
        const raw = readFileSync(fullPath, "utf-8");
        const md5 = computeMD5(raw);
        const chunks = await extractChunks(fullPath, entry.relPath, entry.title, maxEmbedLen);
        updateFileState(entry.relPath, {
          md5,
          astChunkCount: chunks.length,
          astIndexedAt: new Date().toISOString(),
        });
      } catch { /* skip */ }
    }
  }

  return generated;
}

/**
 * 涓哄崟涓枃浠剁敓鎴?鏇存柊 embedding
 */
export async function embedSingleFile(
  sourceDir: string,
  relPath: string,
  title: string,
): Promise<boolean> {
  if (!getSemanticEnabled()) return false;

  if (!isAvailable()) {
    const ok = await initialize();
    if (!ok) return false;
  }

  const model = getCurrentModel();
  const maxEmbedLen = Math.floor(model.maxTokens * 2);

  const fullPath = resolve(sourceDir, relPath);
  if (!existsSync(fullPath)) return false;

  try {
    const chunks = await extractChunks(fullPath, relPath, title, maxEmbedLen);
    const existing = getEmbeddings();
    const chunkInfo = getChunkInfo();

    let ok = false;
    for (const ch of chunks) {
      const vec = await embed(ch.embedText);
      existing[ch.key] = vec;
      chunkInfo[ch.key] = { heading: ch.heading, level: ch.level };
      ok = true;
    }

    if (ok) {
      const model = getCurrentModel();
      setEmbeddings(existing, model.hfRepo, model.dim);
      setChunkInfo(chunkInfo);
      recomputeCentroid();
    }
    return ok;
  } catch {
    return false;
  }
}

/** 计算全部向量的均值（噪声基底），供语义搜索降噪 */
export function recomputeCentroid(): void {
  const embeddings = getEmbeddings();
  const vectors = Object.values(embeddings);
  if (vectors.length === 0) return;
  const dim = vectors[0].length;
  const centroid = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) centroid[i] += vec[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
  setCentroid(centroid);
}
