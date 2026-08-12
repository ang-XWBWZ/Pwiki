import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BM25_INDEX_VERSION,
  buildBm25Index,
  buildBm25Stats,
  closeBm25Databases,
  readBm25Index,
  readBm25QueryIndex,
  searchBm25Index,
  upsertBm25Document,
  writeBm25Index,
} from "../bm25.js";
import {
  initWikiConfig,
  bm25DbFile,
  bm25DocsFile,
  bm25MetaFile,
  bm25TermsFile,
  bm25StatsFile,
} from "../../config.js";
import { readBm25Stats } from "../store-index.js";
import { setChunkInfo } from "../store-vectors.js";
import type { FileEntry } from "../types.js";

const tempRoots: string[] = [];

function tempDir(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `pwiki-${label}-`));
  tempRoots.push(path);
  return path;
}

function fixture(content: string): { home: string; sourceDir: string; entries: FileEntry[] } {
  const home = tempDir("bm25-home");
  const sourceDir = tempDir("bm25-source");
  initWikiConfig({ basePath: home });
  const specs = [
    { relPath: "shared.md", title: "shared", tags: ["shared"], content },
    { relPath: "neutral-a.md", title: "neutral alpha", tags: [], content: "plain alpha" },
    { relPath: "neutral-b.md", title: "neutral beta", tags: [], content: "plain beta" },
  ];
  const entries = specs.map(spec => {
    writeFileSync(join(sourceDir, spec.relPath), spec.content, "utf-8");
    return {
      title: spec.title,
      tags: spec.tags,
      sourceDir,
      relPath: spec.relPath,
      mtime: new Date(0).toISOString(),
    };
  });
  return { home, sourceDir, entries };
}

afterEach(() => {
  closeBm25Databases();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BM25 index v4 SQLite", () => {
  it("stores weighted positions and counts DF by unique document", () => {
    const { entries } = fixture("shared body");
    setChunkInfo({
      "shared.md###llm": { heading: "", level: 0, aliases: ["shared"] },
    }, "source-test");

    const index = buildBm25Index(entries, "source-test");
    const term = index.terms.shared;
    expect(index.version).toBe(BM25_INDEX_VERSION);
    expect(term.df).toBe(1);
    expect(new Set(term.postings.map(posting => posting.field)))
      .toEqual(new Set(["body", "title", "path", "tags", "aliases"]));
    expect(term.postings.every(posting => posting.tokenWeight > 0)).toBe(true);
    expect(term.postings.every(posting => posting.positions.length > 0)).toBe(true);
    expect(term.postings.every(posting => posting.sources.includes("identifier"))).toBe(true);
  });

  it("keeps protected high-DF terms and returns score explanations", () => {
    const { entries, sourceDir } = fixture("失败 shared");
    for (const entry of entries.slice(1)) {
      writeFileSync(join(sourceDir, entry.relPath), "失败", "utf-8");
    }
    const index = buildBm25Index(entries, "source-test");
    expect(index.terms["失败"]?.df).toBe(3);

    const result = searchBm25Index("shared", index, 10)[0];
    expect(result.relPath).toBe("shared.md");
    expect(result.keywordEvidence.matchedTerms[0]).toMatchObject({
      term: "shared",
      queryWeight: 1.5,
    });
    expect(result.keywordEvidence.matchedTerms[0].fields.length).toBeGreaterThan(0);
  });

  it("rejects v1 index and legacy unversioned stats", () => {
    fixture("shared");
    writeFileSync(bm25DocsFile(), "{}", "utf-8");
    writeFileSync(bm25TermsFile(), "{}", "utf-8");
    writeFileSync(bm25MetaFile(), JSON.stringify({ version: 1, N: 1, avgdl: 1 }), "utf-8");
    writeFileSync(bm25StatsFile(), JSON.stringify({ N: 1, avgdl: 1, df: {} }), "utf-8");
    expect(readBm25Index()).toBeNull();
    expect(readBm25Stats()).toBeNull();
  });

  it("round-trips a rebuilt index as a plain unencrypted SQLite file", () => {
    const { entries } = fixture("shared");
    const index = buildBm25Index(entries, "source-test");
    writeBm25Index(index, "source-test");
    const header = readFileSync(bm25DbFile("source-test")).subarray(0, 16).toString("ascii");
    expect(header).toBe("SQLite format 3\0");
    expect(readBm25Index("source-test")?.version).toBe(BM25_INDEX_VERSION);
    expect(buildBm25Stats(entries).version).toBe(BM25_INDEX_VERSION);
  });

  it("migrates a v3 JSON snapshot once and keeps the legacy files", () => {
    const { entries } = fixture("legacy migration marker");
    const index = buildBm25Index(entries, "source-test");
    writeFileSync(bm25DocsFile("source-test"), JSON.stringify(index.docs), "utf-8");
    writeFileSync(bm25TermsFile("source-test"), JSON.stringify(index.terms), "utf-8");
    writeFileSync(
      bm25MetaFile("source-test"),
      JSON.stringify({ version: 3, N: index.N, avgdl: index.avgdl }),
      "utf-8",
    );

    expect(existsSync(bm25DbFile("source-test"))).toBe(false);
    expect(readBm25Index("source-test")?.N).toBe(index.N);
    expect(existsSync(bm25DbFile("source-test"))).toBe(true);
    expect(existsSync(bm25DocsFile("source-test"))).toBe(true);
    expect(existsSync(bm25TermsFile("source-test"))).toBe(true);
    expect(existsSync(bm25MetaFile("source-test"))).toBe(true);
  });

  it("updates one document transactionally and reads only query-term postings", () => {
    const { entries, sourceDir } = fixture("olduniqueneedle");
    writeBm25Index(buildBm25Index(entries, "source-test"), "source-test");

    writeFileSync(join(sourceDir, entries[0].relPath), "newuniqueneedle", "utf-8");
    upsertBm25Document(
      buildBm25Index([entries[0]], "source-test"),
      entries[0].relPath,
      "source-test",
    );

    const stored = readBm25Index("source-test")!;
    expect(stored.docs["neutral-a.md"]).toBeDefined();
    expect(searchBm25Index("olduniqueneedle", stored, 10)).toHaveLength(0);
    expect(searchBm25Index("newuniqueneedle", stored, 10)[0]?.relPath).toBe("shared.md");

    const queryIndex = readBm25QueryIndex("newuniqueneedle", "source-test")!;
    expect(queryIndex.docs["shared.md"]).toBeDefined();
    expect(queryIndex.docs["neutral-a.md"]).toBeUndefined();
    expect(queryIndex.terms.alpha).toBeUndefined();
  });
});
