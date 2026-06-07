// store-cleanup.test.ts — 统一清理单元测试

import { describe, it, expect, beforeEach } from "vitest";
import { initWikiConfig } from "../../config.js";
import { getIndex, mergeIndex, readBm25Stats } from "../store-index.js";
import { setContent, getContent } from "../content-cache.js";
import { getEmbeddings, setEmbeddings, getChunkInfo, setChunkInfo } from "../store-vectors.js";
import { getManifest, updateFileState } from "../file-manifest.js";
import { removeEntryFromAllStores } from "../store-cleanup.js";

// 测试前初始化临时数据目录
const TEST_HOME = "D:/demo/pi-agent-extensions/Pwiki/core/src/lib/__tests__/.test-wiki";

describe("removeEntryFromAllStores", () => {
  beforeEach(() => {
    initWikiConfig({ basePath: TEST_HOME });
  });

  it("清理 index 条目", () => {
    mergeIndex([{
      title: "Test", tags: [], sourceDir: "/tmp", relPath: "test.md",
      mtime: new Date().toISOString(),
    }]);
    removeEntryFromAllStores("test.md");
    expect(getIndex()["test.md"]).toBeUndefined();
  });

  it("清理 content cache", () => {
    setContent("test.md", "hello");
    removeEntryFromAllStores("test.md");
    expect(getContent("test.md")).toBeUndefined();
  });

  it("清理 embeddings（含 ###N 变体）", () => {
    setEmbeddings({
      "test.md": [0.1, 0.2],
      "test.md###0": [0.3, 0.4],
      "test.md###1": [0.5, 0.6],
      "test.md###llm": [0.7, 0.8],
      "other.md": [0.9, 1.0], // 不应被清理
    });
    removeEntryFromAllStores("test.md");
    const emb = getEmbeddings();
    expect(emb["test.md"]).toBeUndefined();
    expect(emb["test.md###0"]).toBeUndefined();
    expect(emb["test.md###1"]).toBeUndefined();
    expect(emb["test.md###llm"]).toBeUndefined();
    expect(emb["other.md"]).toBeDefined(); // 未受影响的条目保留
  });

  it("清理 chunkInfo（含 ###N 变体）", () => {
    setChunkInfo({
      "test.md###0": { heading: "# A", level: 1 },
      "test.md###llm": { heading: "", level: 0, topic: "T" },
      "other.md###0": { heading: "# B", level: 1 },
    });
    removeEntryFromAllStores("test.md");
    const ci = getChunkInfo();
    expect(ci["test.md###0"]).toBeUndefined();
    expect(ci["test.md###llm"]).toBeUndefined();
    expect(ci["other.md###0"]).toBeDefined();
  });

  it("清理 manifest", () => {
    updateFileState("test.md", { md5: "abc", fileSize: 10, astChunkCount: 1, astIndexedAt: "", llmCompiled: false, hasSemanticVectors: true });
    removeEntryFromAllStores("test.md");
    const m = getManifest();
    expect(m.files["test.md"]).toBeUndefined();
  });

  it("BM25 统计重建（无 crash）", () => {
    // 确保 BM25 重建不会因为空库而抛异常
    mergeIndex([{
      title: "T", tags: [], sourceDir: "/tmp", relPath: "x.md",
      mtime: new Date().toISOString(),
    }]);
    expect(() => removeEntryFromAllStores("x.md")).not.toThrow();
    // 清理后 BM25 统计应重建
    const stats = readBm25Stats();
    expect(stats).not.toBeNull();
  });
});
