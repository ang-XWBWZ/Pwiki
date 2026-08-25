import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WikiEngine } from "../../WikiEngine.js";
import { closeBm25Databases, readBm25Index } from "../bm25.js";
import { clearAll } from "../content-cache.js";
import { computeMD5, getFileState, updateFileState } from "../file-manifest.js";
import { sourceRefForPath } from "../source-shard.js";

const tempRoots: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pwiki-${label}-`));
  tempRoots.push(dir);
  return dir;
}

function writeMarkdown(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

afterEach(() => {
  closeBm25Databases();
  clearAll();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CRUD incremental maintenance", () => {
  it("updates only the changed BM25 document and invalidates stale derived data", async () => {
    const home = tempDir("crud-home");
    const sourceDir = tempDir("crud-source");
    const oldTarget = "# Target\n\nOLD_TARGET_TOKEN";
    const untouched = "# Untouched\n\nUNCHANGED_INDEX_TOKEN";
    writeMarkdown(sourceDir, "target.md", oldTarget);
    writeMarkdown(sourceDir, "untouched.md", untouched);
    writeMarkdown(sourceDir, "neutral.md", "# Neutral\n\nNEUTRAL_TOKEN");

    const engine = new WikiEngine({ basePath: home });
    engine.addSource(sourceDir);
    await engine.loadSource(sourceDir);
    const sourceId = sourceRefForPath(sourceDir).id;

    updateFileState("target.md", {
      md5: computeMD5(oldTarget),
      semanticMd5: computeMD5(oldTarget),
      llmCompiledMd5: computeMD5(oldTarget),
      fileSize: Buffer.byteLength(oldTarget),
      astChunkCount: 1,
      astIndexedAt: new Date(0).toISOString(),
      llmCompiled: true,
      hasSemanticVectors: true,
    }, sourceId);

    // 模拟另一个文件在磁盘上被外部改动但尚未 refresh。
    writeMarkdown(sourceDir, "untouched.md", "# Untouched\n\nEXTERNAL_NOT_REFRESHED_TOKEN");
    clearAll();

    const changed = "# Target\n\nNEW_INCREMENTAL_TOKEN";
    expect(await engine.modifyEntry(sourceDir, "target.md", changed)).toBe(true);

    let index = readBm25Index(sourceId)!;
    expect(index.docs["target.md"]).toBeDefined();
    expect(index.terms.new_incremental_token?.postings.some(p => p.docId === "target.md")).toBe(true);
    expect(index.terms.old_target_token?.postings.some(p => p.docId === "target.md") ?? false).toBe(false);
    expect(index.terms.unchanged_index_token?.postings.some(p => p.docId === "untouched.md")).toBe(true);
    expect(index.terms.external_not_refreshed_token).toBeUndefined();

    const state = getFileState("target.md", sourceId)!;
    expect(state.llmCompiled).toBe(false);
    expect(state.hasSemanticVectors).toBe(false);
    expect(state.semanticMd5).toBe(computeMD5(oldTarget));
    expect(state.md5).toBe(computeMD5(changed));

    expect(await engine.renameEntry("target.md", "RENAMED_TITLE_TOKEN")).toBe(true);
    index = readBm25Index(sourceId)!;
    expect(index.terms.renamed_title_token?.postings.some(
      p => p.docId === "target.md" && p.field === "title",
    )).toBe(true);

    expect(await engine.moveEntry("target.md", "moved/target.md")).toBe(true);
    index = readBm25Index(sourceId)!;
    expect(index.docs["target.md"]).toBeUndefined();
    expect(index.docs["moved/target.md"]).toBeDefined();
    expect(Object.values(index.terms).some(term =>
      term.postings.some(posting => posting.docId === "target.md"),
    )).toBe(false);

    const created = await engine.createEntry(
      sourceDir,
      "created.md",
      "Created",
      [],
      "CREATE_INCREMENTAL_TOKEN",
    );
    expect(created).toBe("created.md");
    index = readBm25Index(sourceId)!;
    expect(index.docs["created.md"]).toBeDefined();
    expect(index.terms.create_incremental_token?.postings.some(p => p.docId === "created.md")).toBe(true);

    expect(await engine.modifyEntry(sourceDir, "created.md", "")).toBe(true);
    index = readBm25Index(sourceId)!;
    expect(index.docs["created.md"]).toBeDefined();
    expect(index.terms.create_incremental_token?.postings.some(p => p.docId === "created.md") ?? false).toBe(false);

    expect(await engine.deleteEntry("created.md")).toBe(true);
    expect(existsSync(join(sourceDir, "created.md"))).toBe(false);
    index = readBm25Index(sourceId)!;
    expect(index.docs["created.md"]).toBeUndefined();
  });
});
