// config.ts — 统一路径管理 (v1.0)
//
// 所有 lib 模块的唯一路径来源。替代原来各文件中硬编码的 resolve(__dirname, "..")。
// 通过 initWikiConfig() 初始化，支持 WIKI_HOME 环境变量和构造器传入。

import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

let _home = "";

export interface WikiConfig {
  basePath?: string;
  modelId?: string;
}

/** 初始化 wiki 数据目录（必须在使用任何 lib 函数前调用） */
export function initWikiConfig(config?: WikiConfig): void {
  _home = resolve(
    config?.basePath ??
      process.env.WIKI_HOME ??
      join(process.env.HOME || process.env.USERPROFILE || ".", ".pwiki"),
  );
  ensureDirs();
}

/** 获取 wiki 数据根目录 */
export function wikiHome(): string {
  if (!_home) initWikiConfig();
  return _home;
}

/** 设置 wiki 数据根目录（覆盖默认值） */
export function setWikiHome(path: string): void {
  _home = resolve(path);
  ensureDirs();
}

// ---- 各数据文件路径 ----

export function configFile(): string {
  return join(wikiHome(), "config.json");
}

export function indexFile(): string {
  return join(wikiHome(), "index.json");
}

export function vectorFile(): string {
  return join(wikiHome(), "vectors.json");
}

export function manifestFile(): string {
  return join(wikiHome(), "manifest.json");
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

export function cacheDir(): string {
  const d = join(wikiHome(), "cache");
  mkdirSync(d, { recursive: true });
  return d;
}

// ---- 内部 ----

function ensureDirs(): void {
  for (const d of [wikiHome(), compiledDir(), modelsDir(), cacheDir()]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}
