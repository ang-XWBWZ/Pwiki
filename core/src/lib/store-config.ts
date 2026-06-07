// store-config.ts �?config.json 持久化层
//
// 管理: 数据源列�?/ 语义开�?/ 模型选择 / lastScan
// 不包含文件索引（已拆�?store-index.ts�?
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { configFile, wikiHome } from "../config.js";

// ---- 内部类型 ----

interface WikiConfig {
  sources: string[];
  semanticEnabled: boolean;
  currentModelId: string;
  lastScan: string;
}

const DEFAULT: WikiConfig = {
  sources: [],
  semanticEnabled: false,
  currentModelId: "bge-base-zh-v1.5",
  lastScan: "",
};

// ---- 核心读写 ----

export function readConfig(): WikiConfig {
  try {
    const p = configFile();
    if (existsSync(p)) return { ...DEFAULT, ...JSON.parse(readFileSync(p, "utf-8")) };
  } catch { /* ignore */ }
  return { ...DEFAULT };
}

export function writeConfig(c: WikiConfig): void {
  writeFileSync(configFile(), JSON.stringify(c, null, 2), "utf-8");
}

// ---- 数据�?----

export function getSources(): string[] {
  return readConfig().sources;
}

export function addSource(absPath: string): boolean {
  const c = readConfig();
  if (c.sources.includes(absPath)) return false;
  c.sources.push(absPath);
  writeConfig(c);
  return true;
}

/** 移除数据�?�?返回被移除的路径，未找到返回 null */
export function removeSource(target: string): string | null {
  const c = readConfig();
  const idx = c.sources.findIndex(
    (p) => p === target || p.endsWith(target),
  );
  if (idx < 0) return null;
  const removed = c.sources[idx];
  c.sources.splice(idx, 1);
  writeConfig(c);
  return removed;
}

// ---- lastScan ----

export function getLastScan(): string {
  return readConfig().lastScan;
}

export function setLastScan(iso: string): void {
  const c = readConfig();
  c.lastScan = iso;
  writeConfig(c);
}

// ---- 语义开�?----

export function getSemanticEnabled(): boolean {
  return readConfig().semanticEnabled;
}

export function setSemanticEnabled(enabled: boolean): void {
  const c = readConfig();
  c.semanticEnabled = enabled;
  writeConfig(c);
}

// ---- 模型选择 ----

export function readModelId(): string {
  return readConfig().currentModelId;
}

export function writeModelId(id: string): void {
  const c = readConfig();
  c.currentModelId = id;
  writeConfig(c);
}

// ---- wiki 对话模型 ----

export function getWikiModel(): string {
  return "opencode-go/deepseek-v4-flash";
}

// ---- 统计 ----

export function configStats(): {
  sources: number;
  lastScan: string;
} {
  const c = readConfig();
  return { sources: c.sources.length, lastScan: c.lastScan };
}
