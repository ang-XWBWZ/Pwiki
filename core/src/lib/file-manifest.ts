// file-manifest.ts �?文件级追踪清�?(v1.0)
// 适配�?extensions/wiki/lib/file-manifest.ts �?wikiHome 改为 config.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { manifestFile, compiledDir } from "../config.js";

// ---- 类型 ----

export interface FileManifestEntry {
  md5: string;
  fileSize: number;
  astChunkCount: number;
  astIndexedAt: string;
  llmCompiled: boolean;
  llmCompiledAt?: string;
  compilingSince?: string;
  hasSemanticVectors: boolean;
  contentClass?: string;
  deleted?: boolean;
}

export interface FileManifest {
  version: 1;
  files: Record<string, FileManifestEntry>;
}

// ---- 统计 ----

export function getManifestStats(): { total: number; compiled: number; withVectors: number } {
  const m = getManifest();
  const entries = Object.values(m.files).filter(e => !e.deleted);
  return {
    total: entries.length,
    compiled: entries.filter(e => e.llmCompiled).length,
    withVectors: entries.filter(e => e.hasSemanticVectors).length,
  };
}

// ---- CRUD ----

export function getManifest(): FileManifest {
  try {
    const p = manifestFile();
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  } catch { /* ignore */ }
  return { version: 1, files: {} };
}

function setManifest(m: FileManifest): void {
  writeFileSync(manifestFile(), JSON.stringify(m, null, 2), "utf-8");
}

export function getFileState(relPath: string): FileManifestEntry | undefined {
  return getManifest().files[relPath];
}

export function updateFileState(relPath: string, patch: Partial<FileManifestEntry>): void {
  const m = getManifest();
  const existing = m.files[relPath] || {
    md5: "", astChunkCount: 0, astIndexedAt: "", llmCompiled: false,
  };
  m.files[relPath] = { ...existing, ...patch };
  setManifest(m);
}

export function removeFileState(relPath: string): void {
  const m = getManifest();
  delete m.files[relPath];
  setManifest(m);
}

// ---- MD5 ----

export function computeMD5(content: string): string {
  return createHash("md5").update(content, "utf-8").digest("hex");
}

export function isFileChanged(relPath: string, currentMD5: string): boolean {
  const state = getFileState(relPath);
  if (!state) return true;
  return state.md5 !== currentMD5;
}

export function isCompilationStale(relPath: string, currentMD5: string): boolean {
  const state = getFileState(relPath);
  if (!state || !state.llmCompiled) return true;
  return state.md5 !== currentMD5;
}

// ---- compiled/ 目录 ----

export function ensureCompiledDir(): void {
  const dir = compiledDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function getCompiledFilePath(relPath: string): string {
  ensureCompiledDir();
  const safeName = relPath
    .replace(/\\/g, "_").replace(/\//g, "_")
    .replace(/\.md$/i, "") + ".json";
  return resolve(compiledDir(), safeName);
}

export function manifestStats(): { total: number; compiled: number; stale: number } {
  const m = getManifest();
  const entries = Object.values(m.files);
  return { total: entries.length, compiled: entries.filter(e => e.llmCompiled).length, stale: 0 };
}
