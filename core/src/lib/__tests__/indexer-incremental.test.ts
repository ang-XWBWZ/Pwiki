import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const embeddingMock = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock("../embedder.js", () => ({
  embed: vi.fn(async (text: string) => {
    embeddingMock.calls.push(text);
    return [embeddingMock.calls.length, 0];
  }),
  initialize: vi.fn(async () => true),
  isAvailable: vi.fn(() => true),
}));

import { initWikiConfig } from "../../config.js";
import { generateEmbeddings } from "../indexer-embed.js";
import { setSemanticEnabled } from "../store-config.js";
import { getChunkInfo, getEmbeddings } from "../store-vectors.js";

const tempRoots: string[] = [];

function tempDir(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `pwiki-${label}-`));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  setSemanticEnabled(false);
  embeddingMock.calls = [];
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("incremental AST embedding maintenance", () => {
  it("reuses unchanged chunks when one chunk in a Markdown file changes", async () => {
    const home = tempDir("incremental-home");
    const sourceDir = tempDir("incremental-source");
    const relPath = "guide.md";
    const sourceId = "incremental-source";
    const entry = {
      title: "Guide",
      tags: [],
      sourceDir,
      relPath,
      mtime: "",
    };

    initWikiConfig({ basePath: home });
    setSemanticEnabled(true);
    writeFileSync(join(sourceDir, relPath), "# Guide\n\nunchanged context\n\n## Target\n\nold detail", "utf-8");

    await expect(generateEmbeddings(sourceDir, [entry], sourceId)).resolves.toBeGreaterThan(1);
    const firstVectors = getEmbeddings(sourceId);
    const firstInfo = getChunkInfo(sourceId);
    const firstCallCount = embeddingMock.calls.length;
    const unchangedKey = Object.keys(firstInfo).find((key) => firstInfo[key]?.heading === "# Guide");
    expect(unchangedKey).toBeDefined();

    writeFileSync(join(sourceDir, relPath), "# Guide\n\nunchanged context\n\n## Target\n\nnew detail", "utf-8");
    await expect(generateEmbeddings(sourceDir, [entry], sourceId)).resolves.toBe(1);

    const secondVectors = getEmbeddings(sourceId);
    const secondInfo = getChunkInfo(sourceId);
    expect(embeddingMock.calls).toHaveLength(firstCallCount + 1);
    expect(secondVectors[unchangedKey!]).toEqual(firstVectors[unchangedKey!]);
    expect(secondInfo[unchangedKey!].contentMd5).toBe(firstInfo[unchangedKey!].contentMd5);
  });
});
