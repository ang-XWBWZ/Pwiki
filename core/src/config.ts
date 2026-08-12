// config.ts — 统一路径管理 (v1.0)
//
// 所有 lib 模块的唯一路径来源。替代原来各文件中硬编码的 resolve(__dirname, "..")。
// 通过 initWikiConfig() 初始化，支持 WIKI_HOME 环境变量和构造器传入。

import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

let _home = "";
const homeChangeHandlers = new Set<() => void>();

export interface WikiConfig {
  basePath?: string;
  modelId?: string;
}

/** 初始化 wiki 数据目录（必须在使用任何 lib 函数前调用） */
export function initWikiConfig(config?: WikiConfig): void {
  const nextHome = resolve(
    config?.basePath ??
      process.env.WIKI_HOME ??
      join(process.env.HOME || process.env.USERPROFILE || ".", ".pwiki"),
  );
  notifyBeforeHomeChange(nextHome);
  _home = nextHome;
  ensureDirs();
}

/** 获取 wiki 数据根目录 */
export function wikiHome(): string {
  if (!_home) initWikiConfig();
  return _home;
}

/** 设置 wiki 数据根目录（覆盖默认值） */
export function setWikiHome(path: string): void {
  const nextHome = resolve(path);
  notifyBeforeHomeChange(nextHome);
  _home = nextHome;
  ensureDirs();
}

/** 内部资源（如 SQLite 连接）在切换数据目录前注册清理函数。 */
export function registerWikiHomeChangeHandler(handler: () => void): () => void {
  homeChangeHandlers.add(handler);
  return () => homeChangeHandlers.delete(handler);
}

// ---- 各数据文件路径 ----

export function configFile(): string {
  return join(wikiHome(), "config.json");
}

export function indexFile(): string {
  return join(wikiHome(), "index.json");
}

export function sourcesDir(): string {
  const d = join(wikiHome(), "sources");
  mkdirSync(d, { recursive: true });
  return d;
}

export function sourceDataDir(sourceId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(sourceId)) {
    throw new Error(`Invalid source id: ${sourceId}`);
  }
  const d = join(sourcesDir(), sourceId);
  mkdirSync(d, { recursive: true });
  return d;
}

export function sourceIndexFile(sourceId: string): string {
  return join(sourceDataDir(sourceId), "index.json");
}

export function vectorFile(sourceId?: string): string {
  return sourceId
    ? join(sourceDataDir(sourceId), "vectors.json")
    : join(wikiHome(), "vectors.json");
}

export function manifestFile(sourceId?: string): string {
  return sourceId
    ? join(sourceDataDir(sourceId), "manifest.json")
    : join(wikiHome(), "manifest.json");
}

export function compiledDir(): string {
  const d = join(wikiHome(), "compiled");
  mkdirSync(d, { recursive: true });
  return d;
}

export function modelsDir(): string {
  // Models are shared globally, not per-data-dir
  const home = process.env.WIKI_MODELS_DIR ||
    join(process.env.HOME || process.env.USERPROFILE || ".", ".pwiki", "models");
  const d = resolve(home);
  mkdirSync(d, { recursive: true });
  return d;
}

export function bm25StatsFile(): string {
  return join(wikiHome(), "bm25_stats.json");
}

/** BM25 v4 主存储。标准 SQLite 文件，不使用 SQLCipher/加密扩展。 */
export function bm25DbFile(sourceId?: string): string {
  return join(sourceId ? sourceDataDir(sourceId) : wikiHome(), "bm25.sqlite3");
}

/** v3 JSON 兼容路径，仅用于首次迁移。 */
export function bm25DocsFile(sourceId?: string): string {
  return join(sourceId ? sourceDataDir(sourceId) : wikiHome(), "bm25_docs.json");
}

export function bm25TermsFile(sourceId?: string): string {
  return join(sourceId ? sourceDataDir(sourceId) : wikiHome(), "bm25_terms.json");
}

export function bm25MetaFile(sourceId?: string): string {
  return join(sourceId ? sourceDataDir(sourceId) : wikiHome(), "bm25_meta.json");
}

export function cacheDir(): string {
  const d = join(wikiHome(), "cache");
  mkdirSync(d, { recursive: true });
  return d;
}

// ---- 内部 ----

function notifyBeforeHomeChange(nextHome: string): void {
  if (!_home || _home === nextHome) return;
  for (const handler of homeChangeHandlers) {
    try { handler(); } catch { /* 清理失败不阻止配置切换 */ }
  }
}

function ensureDirs(): void {
  for (const d of [wikiHome(), sourcesDir(), compiledDir(), modelsDir(), cacheDir()]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}
