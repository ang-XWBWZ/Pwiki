import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WikiEngine } from "../../WikiEngine.js";
import { BM25_INDEX_VERSION, readBm25Index } from "../bm25.js";
import { sourceIndexExists, sourceRefForPath } from "../source-shard.js";

const tempRoots: string[] = [];

function makeTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pwiki-${name}-`));
  tempRoots.push(dir);
  return dir;
}

function writeMarkdown(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("source-scoped search", () => {
  it("does not search another source or a path outside the requested prefix", async () => {
    const wikiHome = makeTempDir("home");
    const sourceA = makeTempDir("source-a");
    const sourceB = makeTempDir("source-b");

    writeMarkdown(sourceA, "docs/shared.md", "# Source A\n\nALPHA_SCOPED_TOKEN");
    writeMarkdown(sourceA, "outside.md", "# Outside\n\nALPHA_SCOPED_TOKEN");
    writeMarkdown(sourceA, "neutral.md", "# Neutral\n\nNo scoped token here.");
    writeMarkdown(sourceB, "docs/shared.md", "# Source B\n\nBETA_SCOPED_TOKEN");
    writeMarkdown(sourceB, "neutral.md", "# Neutral\n\nNo scoped token here.");
    writeMarkdown(sourceB, "another-neutral.md", "# Another Neutral");

    const engine = new WikiEngine({ basePath: wikiHome });
    engine.addSource(sourceA);
    engine.addSource(sourceB);
    await engine.loadSource(sourceA);
    await engine.loadSource(sourceB);

    const sourceAHits = await engine.search("ALPHA_SCOPED_TOKEN", "keyword", {
      source: sourceA,
      pathPrefix: "docs",
    });
    expect(sourceAHits).toHaveLength(1);
    expect(sourceAHits[0].sourceDir).toBe(sourceA);
    expect(sourceAHits[0].relPath).toBe("docs/shared.md");

    const crossSourceHits = await engine.search("BETA_SCOPED_TOKEN", "keyword", {
      source: sourceA,
      pathPrefix: "docs",
    });
    expect(crossSourceHits).toEqual([]);

    const sourceBHits = await engine.search("BETA_SCOPED_TOKEN", "keyword", {
      source: sourceB,
      pathPrefix: "docs/shared.md",
    });
    expect(sourceBHits).toHaveLength(1);
    expect(sourceBHits[0].sourceDir).toBe(sourceB);

    const unscopedSharedHits = await engine.search("shared", "keyword");
    expect(unscopedSharedHits.filter((hit) => hit.relPath === "docs/shared.md"))
      .toHaveLength(2);
    expect(new Set(unscopedSharedHits.map((hit) => hit.sourceId)).size).toBe(2);

    await expect(engine.search("shared", "keyword", { pathPrefix: "docs" }))
      .rejects.toThrow("pathPrefix requires a source");

    const entryA = engine.readEntry("docs/shared.md", sourceA);
    const entryB = engine.readEntry("docs/shared.md", sourceB);
    expect(entryA?.content).toContain("ALPHA_SCOPED_TOKEN");
    expect(entryB?.content).toContain("BETA_SCOPED_TOKEN");

    const sourceAId = sourceRefForPath(sourceA).id;
    expect(readBm25Index(sourceAId)?.version).toBe(BM25_INDEX_VERSION);
    expect(readBm25Index(sourceAId)?.terms.shared?.df).toBe(1);
    expect(engine.removeSource(sourceAId)).toBe(sourceA);
    expect(sourceIndexExists(sourceAId)).toBe(false);
    const afterUnload = await engine.search("shared", "keyword");
    expect(afterUnload.filter((hit) => hit.relPath === "docs/shared.md"))
      .toHaveLength(1);
    expect(afterUnload[0].sourceDir).toBe(sourceB);
  });
});
