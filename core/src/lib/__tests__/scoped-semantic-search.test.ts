import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../embedder.js", () => ({
  embed: vi.fn(async () => [1, 0]),
  initialize: vi.fn(async () => true),
  isAvailable: vi.fn(() => true),
  cosineSimilarity: vi.fn((a: number[], b: number[]) => {
    if (b[0] === 999) throw new Error("out-of-scope vector was scored");
    const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
    return dot;
  }),
}));

import { WikiEngine } from "../../WikiEngine.js";
import { setSemanticEnabled } from "../store-config.js";
import { setChunkInfo, setEmbeddings } from "../store-vectors.js";
import { sourceRefForPath } from "../source-shard.js";

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

describe("source-scoped semantic search", () => {
  it("filters source and path before vector scoring", async () => {
    const wikiHome = makeTempDir("semantic-home");
    const sourceA = makeTempDir("semantic-a");
    const sourceB = makeTempDir("semantic-b");
    writeMarkdown(sourceA, "docs/inside.md", "# Inside");
    writeMarkdown(sourceA, "outside.md", "# Outside");
    writeMarkdown(sourceB, "docs/other.md", "# Other source");

    const engine = new WikiEngine({ basePath: wikiHome });
    engine.addSource(sourceA);
    engine.addSource(sourceB);
    await engine.loadSource(sourceA);
    await engine.loadSource(sourceB);

    const sourceAId = sourceRefForPath(sourceA).id;
    const sourceBId = sourceRefForPath(sourceB).id;
    setEmbeddings({
      "docs/inside.md###0": [1, 0],
      "outside.md###0": [999, 0],
    }, "test", 2, sourceAId);
    setChunkInfo({
      "docs/inside.md###0": { heading: "Inside", level: 1 },
      "outside.md###0": { heading: "Outside", level: 1 },
    }, sourceAId);
    setEmbeddings({
      "docs/other.md###0": [999, 0],
    }, "test", 2, sourceBId);
    setChunkInfo({
      "docs/other.md###0": { heading: "Other", level: 1 },
    }, sourceBId);
    setSemanticEnabled(true);

    const hits = await engine.search("inside", "semantic", {
      source: sourceAId,
      pathPrefix: "docs",
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].sourceId).toBe(sourceAId);
    expect(hits[0].relPath).toBe("docs/inside.md");

    const hybridHits = await engine.search("inside", "hybrid", {
      source: sourceAId,
      pathPrefix: "docs",
    });
    expect(hybridHits).toHaveLength(1);
    expect(hybridHits[0].sourceId).toBe(sourceAId);
    expect(hybridHits[0].relPath).toBe("docs/inside.md");
  });
});
