// file-manifest.ts �?文件级追踪清�?(v1.0)
// 适配�?extensions/wiki/lib/file-manifest.ts �?wikiHome 改为 config.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { manifestFile, compiledDir } from "../config.js";

// ---- 类型 ----

export interface FileManifestEntry {
  /** 最近一次观察到的正文 hash。 */
  md5: string;
  /** 当前 AST 向量对应的正文 hash；旧 manifest 缺失时回退到 md5。 */
  semanticMd5?: string;
  /** 当前 LLM 编译结果对应的正文 hash；旧 manifest 缺失时回退到 md5。 */
  llmCompiledMd5?: string;
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

export function getManifestStats(sourceId?: string): { total: number; compiled: number; withVectors: number } {
  const m = getManifest(sourceId);
  const entries = Object.values(m.files).filter(e => !e.deleted);
  return {
    total: entries.length,
    compiled: entries.filter(e => e.llmCompiled).length,
    withVectors: entries.filter(e => e.hasSemanticVectors).length,
  };
}

// ---- CRUD ----

export function getManifest(sourceId?: string): FileManifest {
  try {
    const p = manifestFile(sourceId);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  } catch { /* ignore */ }
  return { version: 1, files: {} };
}

function setManifest(m: FileManifest, sourceId?: string): void {
  writeFileSync(manifestFile(sourceId), JSON.stringify(m, null, 2), "utf-8");
}

export function getFileState(relPath: string, sourceId?: string): FileManifestEntry | undefined {
  return getManifest(sourceId).files[relPath];
}

export function updateFileState(
  relPath: string,
  patch: Partial<FileManifestEntry>,
  sourceId?: string,
): void {
  updateFileStates([{ relPath, patch }], sourceId);
}

export function updateFileStates(
  updates: Array<{ relPath: string; patch: Partial<FileManifestEntry> }>,
  sourceId?: string,
): void {
  const m = getManifest(sourceId);
  for (const { relPath, patch } of updates) {
    const existing = m.files[relPath] || {
      md5: "",
      fileSize: 0,
      astChunkCount: 0,
      astIndexedAt: "",
      llmCompiled: false,
      hasSemanticVectors: false,
    };
    m.files[relPath] = { ...existing, ...patch };
  }
  setManifest(m, sourceId);
}

export function removeFileState(relPath: string, sourceId?: string): void {
  const m = getManifest(sourceId);
  delete m.files[relPath];
  setManifest(m, sourceId);
}

// ---- 变更检测 ----

/** 变更检测结果 */
export interface ChangeDetection {
  changed: boolean;
  currentMd5: string;
  previousMd5: string | null;
}

function semanticMd5(entry?: FileManifestEntry): string | null {
  if (!entry) return null;
  return entry.semanticMd5 ?? entry.md5;
}

function compiledMd5(entry?: FileManifestEntry): string | null {
  if (!entry?.llmCompiled) return null;
  return entry.llmCompiledMd5 ?? entry.md5;
}

/**
 * 检测文件是否变更（以内容 MD5 为最终依据）
 * 供 refresh / modify / rename / move 等操作复用
 */
export function detectFileChange(
  relPath: string,
  currentContent: string,
  manifest: FileManifest,
): ChangeDetection {
  const currentMd5 = computeMD5(currentContent);
  const previous = manifest.files[relPath];
  const previousSemanticMd5 = semanticMd5(previous);
  return {
    changed: previousSemanticMd5 !== currentMd5,
    currentMd5,
    previousMd5: previousSemanticMd5,
  };
}

/**
 * 正文写入成功后立即令向量和 LLM 编译结果失效。
 * 保留 semanticMd5/llmCompiledMd5，后台任务据此判断是否需要重算。
 */
export function markFileContentChanged(
  relPath: string,
  currentContent: string,
  sourceId?: string,
): string {
  const currentMd5 = computeMD5(currentContent);
  const previousSemanticMd5 = semanticMd5(getFileState(relPath, sourceId)) ?? "";
  updateFileState(relPath, {
    md5: currentMd5,
    semanticMd5: previousSemanticMd5,
    fileSize: Buffer.byteLength(currentContent, "utf-8"),
    llmCompiled: false,
    llmCompiledAt: undefined,
    compilingSince: undefined,
    hasSemanticVectors: false,
  }, sourceId);
  return currentMd5;
}

// ---- MD5 ----

export function computeMD5(content: string): string {
  return createHash("md5").update(content, "utf-8").digest("hex");
}

export function isFileChanged(relPath: string, currentMD5: string, sourceId?: string): boolean {
  const state = getFileState(relPath, sourceId);
  return semanticMd5(state) !== currentMD5;
}

export function isCompilationStale(relPath: string, currentMD5: string, sourceId?: string): boolean {
  const state = getFileState(relPath, sourceId);
  return compiledMd5(state) !== currentMD5;
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

export function manifestStats(sourceId?: string): { total: number; compiled: number; stale: number } {
  const m = getManifest(sourceId);
  const entries = Object.values(m.files);
  return { total: entries.length, compiled: entries.filter(e => e.llmCompiled).length, stale: 0 };
}
