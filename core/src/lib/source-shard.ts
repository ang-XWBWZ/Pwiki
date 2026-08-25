import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { sourceIndexFile, sourcesDir } from "../config.js";
import { getSources } from "./store-config.js";
import type { FileEntry, SourceRef } from "./types.js";

interface SourceIndexData {
  version: 1;
  source: SourceRef;
  entries: Record<string, FileEntry>;
}

function canonicalSourcePath(path: string): string {
  const absolute = resolve(path).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function sourceSlug(path: string): string {
  const slug = basename(path)
    .normalize("NFKD")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "source";
}

export function sourceRefForPath(path: string): SourceRef {
  const absolute = resolve(path);
  const hash = createHash("sha256")
    .update(canonicalSourcePath(absolute))
    .digest("hex")
    .slice(0, 10);
  return {
    id: `${sourceSlug(absolute)}-${hash}`,
    name: basename(absolute) || "source",
    path: absolute,
  };
}

export function listSourceRefs(): SourceRef[] {
  return getSources().map(sourceRefForPath);
}

export function resolveSourceRef(selector: string): SourceRef | null {
  const refs = listSourceRefs();
  const direct = refs.find((ref) =>
    ref.id === selector || canonicalSourcePath(ref.path) === canonicalSourcePath(selector)
  );
  if (direct) return direct;

  const byName = refs.filter((ref) => ref.name === selector);
  return byName.length === 1 ? byName[0] : null;
}

export function normalizeRelPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!normalized || normalized === ".") return "";
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error(`Path escapes data source: ${path}`);
  }
  return parts.join("/");
}

/**
 * Normalize a write-target Markdown path.
 *
 * Entry mutations use a single canonical suffix so that files created through
 * CRUD follow the same rule as the scanner. A missing suffix remains a
 * convenient shorthand for `.md`; an existing suffix is normalized to lower
 * case instead of producing names such as `note.MD.md`.
 */
export function normalizeMarkdownRelPath(path: string): string {
  if (path.includes("\0")) throw new Error("Path contains an invalid character");
  const candidate = path.replace(/\\/g, "/");
  if (isAbsolute(candidate) || /^[A-Za-z]:\//.test(candidate)) {
    throw new Error(`Path must be relative to the data source: ${path}`);
  }
  const normalized = normalizeRelPath(path);
  if (!normalized) throw new Error("Markdown path must not be empty");
  return /\.md$/i.test(normalized)
    ? `${normalized.slice(0, -3)}.md`
    : `${normalized}.md`;
}

export function resolveWithinSource(sourcePath: string, relPath: string): string {
  const root = resolve(sourcePath);
  const target = resolve(root, normalizeRelPath(relPath));
  const fromRoot = relative(root, target);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Path escapes data source: ${relPath}`);
  }
  return target;
}

export function pathMatchesPrefix(relPath: string, prefix?: string): boolean {
  if (!prefix) return true;
  const path = normalizeRelPath(relPath);
  const normalizedPrefix = normalizeRelPath(prefix).replace(/\/+$/, "");
  if (!normalizedPrefix) return true;
  if (/\.md$/i.test(normalizedPrefix)) return path === normalizedPrefix;
  return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`);
}

export function writeSourceIndex(source: SourceRef, entries: FileEntry[]): void {
  const data: SourceIndexData = {
    version: 1,
    source,
    entries: Object.fromEntries(
      entries.map((entry) => [normalizeRelPath(entry.relPath), entry]),
    ),
  };
  writeFileSync(sourceIndexFile(source.id), JSON.stringify(data, null, 2), "utf-8");
}

export function upsertSourceEntries(source: SourceRef, entries: FileEntry[]): void {
  const current = readSourceIndex(source.id);
  for (const entry of entries) {
    current[normalizeRelPath(entry.relPath)] = entry;
  }
  writeSourceIndex(source, Object.values(current));
}

export function removeSourceEntry(sourceId: string, relPath: string): boolean {
  const current = readSourceIndex(sourceId);
  const normalized = normalizeRelPath(relPath);
  if (!current[normalized]) return false;
  delete current[normalized];
  const source = listSourceRefs().find((ref) => ref.id === sourceId);
  if (!source) return false;
  writeSourceIndex(source, Object.values(current));
  return true;
}

export function readSourceIndex(sourceId: string): Record<string, FileEntry> {
  try {
    const file = sourceIndexFile(sourceId);
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as SourceIndexData;
    return parsed.entries ?? {};
  } catch {
    return {};
  }
}

export function sourceIndexExists(sourceId: string): boolean {
  return existsSync(join(sourceShardPath(sourceId), "index.json"));
}

export function removeSourceShard(sourceId: string): void {
  const root = resolve(sourcesDir());
  const target = sourceShardPath(sourceId);
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Invalid source shard path: ${sourceId}`);
  }
  rmSync(target, { recursive: true, force: true });
}

function sourceShardPath(sourceId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(sourceId)) {
    throw new Error(`Invalid source id: ${sourceId}`);
  }
  return resolve(sourcesDir(), sourceId);
}
