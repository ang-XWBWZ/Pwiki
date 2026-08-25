import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WikiEngine } from "../../WikiEngine.js";
import { closeBm25Databases } from "../bm25.js";
import { clearAll } from "../content-cache.js";
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

describe("write path and source boundaries", () => {
  it("canonicalizes Markdown suffixes and keeps legacy shorthand targets", async () => {
    const home = tempDir("path-home");
    const sourceDir = tempDir("path-source");
    writeMarkdown(sourceDir, "existing.md", "# Existing\n\nEXISTING_TOKEN");

    const engine = new WikiEngine({ basePath: home });
    expect(engine.addSource(sourceDir)).toBe(true);
    await engine.loadSource(sourceDir);

    expect(await engine.createEntry(sourceDir, "upper.MD", "Upper", [], "UPPER_TOKEN")).toBe("upper.md");
    expect(existsSync(join(sourceDir, "upper.md"))).toBe(true);
    expect(existsSync(join(sourceDir, "upper.MD"))).toBe(false);

    expect(await engine.modifyEntry(sourceDir, "missing", "# Missing")).toBe(false);
    expect(existsSync(join(sourceDir, "missing.md"))).toBe(false);

    expect(await engine.moveEntry("existing.md", "moved")).toBe(true);
    expect(existsSync(join(sourceDir, "moved.md"))).toBe(true);
    expect(existsSync(join(sourceDir, "moved"))).toBe(false);

    await engine.dispose();
  });

  it("rejects directory targets and parent-file collisions without throwing", async () => {
    const home = tempDir("collision-home");
    const sourceDir = tempDir("collision-source");
    mkdirSync(join(sourceDir, "same.md"));
    writeFileSync(join(sourceDir, "blocked"), "not-a-directory", "utf-8");

    const engine = new WikiEngine({ basePath: home });
    engine.addSource(sourceDir);
    await engine.loadSource(sourceDir);

    expect(await engine.createEntry(sourceDir, "same.md")).toMatch(/^exists:/);
    expect(await engine.createEntry(sourceDir, "blocked/child.md")).toMatch(/^write-failed:/);

    await engine.dispose();
  });

  it("rejects writes to an unregistered source and ambiguous mutations", async () => {
    const home = tempDir("source-home");
    const unregistered = tempDir("unregistered-source");
    const sourceA = tempDir("source-a");
    const sourceB = tempDir("source-b");
    writeMarkdown(sourceA, "same.md", "# Source A\n\nA_TOKEN");
    writeMarkdown(sourceB, "same.md", "# Source B\n\nB_TOKEN");

    const engine = new WikiEngine({ basePath: home });
    expect(await engine.createEntry(unregistered, "orphan.md")).toMatch(/^source-not-found:/);
    expect(await engine.modifyEntry(unregistered, "orphan.md", "# Orphan")).toBe(false);
    expect(existsSync(join(unregistered, "orphan.md"))).toBe(false);

    engine.addSource(sourceA);
    engine.addSource(sourceB);
    await engine.loadSource(sourceA);
    await engine.loadSource(sourceB);

    expect(await engine.renameEntry("same.md", "Ambiguous")).toBe(false);
    expect(readFileSync(join(sourceA, "same.md"), "utf-8")).toContain("Source A");
    expect(readFileSync(join(sourceB, "same.md"), "utf-8")).toContain("Source B");
    expect(await engine.renameEntry("same.md", "Source A Renamed", sourceRefForPath(sourceA).id)).toBe(true);

    await engine.dispose();
  });
});
