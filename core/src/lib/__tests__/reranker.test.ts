import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WikiEngine } from "../../WikiEngine.js";
import { BgeReranker, type Reranker } from "../reranker.js";
import { setRerankerConfig } from "../reranker-config.js";
import type { SearchHit } from "../types.js";

const tempRoots: string[] = [];

function makeTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pwiki-reranker-${name}-`));
  tempRoots.push(dir);
  return dir;
}

function writeMarkdown(root: string, relPath: string, content: string): void {
  const path = join(root, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

async function setupEngine(
  count: number,
  reranker?: Reranker,
): Promise<{ engine: WikiEngine; source: string }> {
  const home = makeTempDir("home");
  const source = makeTempDir("source");
  for (let index = 0; index < count; index++) {
    const relPath = `${String(index).padStart(2, "0")}.md`;
    // 标题命中确保测试候选不受“所有正文完全相同导致 BM25 IDF 为零”的影响。
    writeMarkdown(source, relPath, `# reranker-test-token Document ${index}\n\ncontent ${index}`);
  }
  // 为候选集合增加无关文档，确保所有命中项共享的查询词仍有正 IDF。
  for (let index = 0; index <= count; index++) {
    writeMarkdown(source, `decoy-${String(index).padStart(2, "0")}.md`, `# Unrelated ${index}\n\nnoise ${index}`);
  }
  const engine = new WikiEngine({ basePath: home, reranker });
  engine.addSource(source);
  await engine.loadSource(source);
  return { engine, source };
}

function scoreReranker(scores: Record<string, number>): Reranker {
  return {
    async rerank(_query, candidates) {
      return candidates
        .map((candidate) => ({
          ...candidate,
          rerankerScore: scores[candidate.relPath] ?? 0,
        }))
        .sort((a, b) => b.rerankerScore - a.rerankerScore);
    },
    status: () => ({ loaded: false }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("optional Cross-Encoder reranker", () => {
  it("does not initialize or invoke a reranker while disabled", async () => {
    const tokenizer = vi.fn((queries: string[], _options: Record<string, unknown>) => ({ batchSize: queries.length }));
    const model = vi.fn(async (_inputs: unknown) => ({ logits: { data: new Float32Array() } }));
    const load = vi.fn(async () => ({ tokenizer, model }));
    const reranker = new BgeReranker({
      enabled: true,
      model: "BAAI/bge-reranker-base",
      dtype: "int8",
      inputTopK: 20,
      outputTopK: 10,
      maxLength: 512,
      batchSize: 8,
    }, { load });
    const { engine } = await setupEngine(3, reranker);
    setRerankerConfig({ enabled: false });

    const hits = await engine.search("reranker-test-token", "hybrid");

    expect(hits).toHaveLength(3);
    expect(load).not.toHaveBeenCalled();
    expect(hits.every((hit) => hit.rerankerScore === undefined)).toBe(true);
  });

  it("uses Cross-Encoder score as the final ordering without replacing hybrid score", async () => {
    const { engine } = await setupEngine(3, scoreReranker({
      "00.md": 0.2,
      "01.md": 0.9,
      "02.md": 0.5,
    }));
    setRerankerConfig({ enabled: true, inputTopK: 3, outputTopK: 3 });

    const hits = await engine.search("reranker-test-token", "hybrid");

    expect(hits.map((hit) => hit.relPath)).toEqual(["01.md", "02.md", "00.md"]);
    expect(hits.map((hit) => hit.rerankerScore)).toEqual([0.9, 0.5, 0.2]);
    expect(hits.every((hit) => typeof hit.score === "number")).toBe(true);
    expect(hits.map((hit) => hit.originalRank).sort()).toEqual([1, 2, 3]);
  });

  it("only sends inputTopK candidates to the reranker and returns outputTopK", async () => {
    const rerank = vi.fn(async (_query: string, candidates: SearchHit[]) => candidates.map((candidate) => ({
      ...candidate,
      rerankerScore: candidate.originalRank,
    })));
    const { engine } = await setupEngine(25, { rerank, status: () => ({ loaded: false }) });
    setRerankerConfig({ enabled: true, inputTopK: 20, outputTopK: 10 });

    const hits = await engine.search("reranker-test-token", "hybrid");

    expect(rerank).toHaveBeenCalledTimes(1);
    expect(rerank.mock.calls[0][1]).toHaveLength(20);
    expect(hits).toHaveLength(10);
  });

  it("falls back to the original Hybrid/RRF ranking if reranking fails", async () => {
    const { engine } = await setupEngine(4, {
      rerank: async () => { throw new Error("inference unavailable"); },
      status: () => ({ loaded: false, lastError: "inference unavailable" }),
    });
    setRerankerConfig({ enabled: false });
    const baseline = await engine.search("reranker-test-token", "hybrid");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setRerankerConfig({ enabled: true, inputTopK: 4, outputTopK: 2 });

    const hits = await engine.search("reranker-test-token", "hybrid");

    expect(hits.map((hit) => hit.relPath)).toEqual(baseline.map((hit) => hit.relPath));
    expect(hits.every((hit) => hit.rerankerScore === undefined)).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("returning Hybrid/RRF ranking"));
  });

  it("lazy-loads the BGE runtime once and reuses it for later queries", async () => {
    const tokenizer = vi.fn((queries: string[], _options: Record<string, unknown>) => ({ batchSize: queries.length }));
    const model = vi.fn(async (inputs: unknown) => ({
      logits: { data: Float32Array.from({ length: (inputs as { batchSize: number }).batchSize }, () => 0.4) },
    }));
    const load = vi.fn(async () => ({ tokenizer, model }));
    const reranker = new BgeReranker({
      enabled: true,
      model: "BAAI/bge-reranker-base",
      dtype: "int8",
      inputTopK: 20,
      outputTopK: 10,
      maxLength: 512,
      batchSize: 8,
    }, { load });
    const candidates: SearchHit[] = [
      { relPath: "a.md", sourceDir: "", title: "A", tags: [], snippet: "A", score: 1 },
    ];

    await reranker.rerank("query", candidates);
    await reranker.rerank("query", candidates);

    expect(load).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledTimes(2);
    expect(reranker.status().loaded).toBe(true);
  });
});
