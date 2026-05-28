// search.ts — 关键词搜索
// 适配自 extensions/wiki/lib/search.ts — 导入改为 store-index + content-cache

import { getIndex } from "./store-index.js";
import { getContent } from "./content-cache.js";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { FileEntry, SearchHit } from "./types.js";

function lineContext(content: string, query: string, maxLen = 100): string {
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

export function keywordSearch(query: string): SearchHit[] {
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
    // Fallback: read from disk if not in cache (CLI/MCP separate process)
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
        const ctx = lineContext(content, query);
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

export const search = keywordSearch;
