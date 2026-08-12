import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const embeddingMock = vi.hoisted(() => ({
  calls: 0,
  release: undefined as (() => void) | undefined,
}));

vi.mock("../indexer-embed.js", async () => {
  const actual = await vi.importActual<typeof import("../indexer-embed.js")>("../indexer-embed.js");
  return {
    ...actual,
    generateEmbeddings: vi.fn(async (sourceDir: string, entries: Array<{ relPath: string }>, sourceId?: string) => {
      embeddingMock.calls++;
      await new Promise<void>((resolve) => { embeddingMock.release = resolve; });
      const [{ readFileSync }, { resolve }, manifest] = await Promise.all([
        import("node:fs"),
        import("node:path"),
        import("../file-manifest.js"),
      ]);
      for (const entry of entries) {
        const content = readFileSync(resolve(sourceDir, entry.relPath), "utf-8");
        const md5 = manifest.computeMD5(content);
        manifest.updateFileState(entry.relPath, {
          md5,
          semanticMd5: md5,
          hasSemanticVectors: true,
        }, sourceId);
      }
      return 1;
    }),
  };
});

import { WikiEngine } from "../../WikiEngine.js";
import { closeBm25Databases } from "../bm25.js";
import { setSemanticEnabled } from "../store-config.js";

const tempRoots: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pwiki-${label}-`));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  closeBm25Databases();
  embeddingMock.release?.();
  embeddingMock.release = undefined;
  embeddingMock.calls = 0;
  setSemanticEnabled(false);
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("background vector maintenance", () => {
  it("returns from CRUD before embedding finishes and exposes queue status", async () => {
    const home = tempDir("background-home");
    const sourceDir = tempDir("background-source");
    const engine = new WikiEngine({ basePath: home, backgroundEmbeddings: true });
    engine.addSource(sourceDir);
    await engine.loadSource(sourceDir);
    setSemanticEnabled(true);

    const create = engine.createEntry(
      sourceDir,
      "async.md",
      "Async",
      [],
      "BACKGROUND_VECTOR_TOKEN",
    );
    const result = await Promise.race([
      create,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 500)),
    ]);
    expect(result).toBe("async.md");

    await vi.waitFor(() => expect(embeddingMock.calls).toBe(1));
    expect(engine.backgroundVectorStatus().running).toBe(true);

    embeddingMock.release?.();
    await engine.waitForBackgroundTasks();
    expect(engine.backgroundVectorStatus()).toMatchObject({
      running: false,
      queued: 0,
      completed: 1,
      failed: 0,
    });
  });

  it("coalesces repeated edits for the same file while one vector job is active", async () => {
    const home = tempDir("coalesce-home");
    const sourceDir = tempDir("coalesce-source");
    const engine = new WikiEngine({ basePath: home, backgroundEmbeddings: true });
    engine.addSource(sourceDir);
    await engine.loadSource(sourceDir);
    setSemanticEnabled(true);

    expect(await engine.createEntry(sourceDir, "rapid.md", "Rapid", [], "version one"))
      .toBe("rapid.md");
    await vi.waitFor(() => expect(embeddingMock.calls).toBe(1));

    await engine.modifyEntry(sourceDir, "rapid.md", "# Rapid\n\nversion two");
    await engine.modifyEntry(sourceDir, "rapid.md", "# Rapid\n\nversion three");
    expect(engine.backgroundVectorStatus().queued).toBe(1);

    embeddingMock.release?.();
    await vi.waitFor(() => expect(embeddingMock.calls).toBe(2));
    embeddingMock.release?.();
    await engine.waitForBackgroundTasks();

    expect(embeddingMock.calls).toBe(2);
    expect(engine.backgroundVectorStatus()).toMatchObject({
      running: false,
      queued: 0,
      completed: 2,
      failed: 0,
    });
  });
});
