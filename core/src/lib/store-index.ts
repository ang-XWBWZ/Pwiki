// store-index.ts �?index.json 持久化层
//
// 管理: 文件索引 Record<relPath, FileEntry>
// 拆自�?store-settings.ts，索引不再嵌�?config.json

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { indexFile } from "../config.js";
import type { FileEntry } from "./types.js";
import { setLastScan } from "./store-config.js";

// ---- 核心读写 ----

export function readIndex(): Record<string, FileEntry> {
  try {
    const p = indexFile();
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  } catch { /* ignore */ }
  return {};
}

export function writeIndex(idx: Record<string, FileEntry>): void {
  writeFileSync(indexFile(), JSON.stringify(idx, null, 2), "utf-8");
}

// ---- 查询 ----

export function getIndex(): Record<string, FileEntry> {
  return readIndex();
}

export function getEntry(relPath: string): FileEntry | null {
  return readIndex()[relPath] ?? null;
}

// ---- 修改 ----

export function mergeIndex(entries: FileEntry[]): void {
  const idx = readIndex();
  for (const e of entries) {
    idx[e.relPath] = e;
  }
  writeIndex(idx);
  setLastScan(new Date().toISOString());
}

export function removeEntry(relPath: string): boolean {
  const idx = readIndex();
  if (!idx[relPath]) return false;
  delete idx[relPath];
  writeIndex(idx);
  return true;
}

export function updateEntryPath(
  oldRelPath: string,
  newRelPath: string,
  entry: FileEntry,
): boolean {
  const idx = readIndex();
  if (!idx[oldRelPath]) return false;
  delete idx[oldRelPath];
  idx[newRelPath] = entry;
  writeIndex(idx);
  return true;
}

/** �?sourceDir 删除所有索引条�?*/
export function removeEntriesBySource(sourceDir: string): number {
  const idx = readIndex();
  let count = 0;
  for (const [key, entry] of Object.entries(idx)) {
    if (entry.sourceDir === sourceDir) {
      delete idx[key];
      count++;
    }
  }
  if (count) writeIndex(idx);
  return count;
}

// ---- 统计 ----

export function indexStats(): { files: number } {
  return { files: Object.keys(readIndex()).length };
}
