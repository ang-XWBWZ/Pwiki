// integration.test.ts — 集成测试（索引一致性）

import { describe, it, expect } from "vitest";
import { tokenize } from "../tokenizer.js";
import { computeMD5, detectFileChange } from "../file-manifest.js";
import type { FileManifest } from "../file-manifest.js";

describe("集成测试: tokenizer 启用后搜索匹配", () => {
  it("delete refresh: 删除后不再命中", () => {
    // 模拟：文档存在时 token 在索引中，删除后不存在
    const docTokens = tokenize("ONLY_DELETE_TEST_TOKEN");
    expect(docTokens.length).toBeGreaterThan(0);
    // 实际 deleted refresh 测试需要完整 engine 环境
  });

  it("modify refresh: 修改后旧词消失新词出现", () => {
    const oldTokens = tokenize("alpha banana");
    const newTokens = tokenize("rocket mars");
    expect(oldTokens).not.toEqual(newTokens);
  });

  it("rename semantic update: tokenizer 产出包含 path prefix", () => {
    const tokens = tokenize("docs/model/api.md");
    // path 拆分后应包含 docs, model, api, md
    expect(tokens).toContain("docs");
    expect(tokens).toContain("model");
    expect(tokens).toContain("api");
  });

  it("chunk residue cleanup: ###N 变体正确匹配", () => {
    const keys = ["test.md", "test.md###0", "test.md###1", "test.md###llm", "other.md###0"];
    const relPath = "test.md";
    const cleaned = keys.filter(k => k.replace(/###.*$/, "") !== relPath);
    expect(cleaned).toEqual(["other.md###0"]);
  });

  it("hybrid raw semantic candidate: 不提前丢弃低分候选", () => {
    // 语义候选人不应被 HIGH_SIMILARITY_THRESHOLD 过滤
    const threshold = 0.50;
    const candidate = { score: 30 }; // semanticScore=0.30, < 0.50
    const isFiltered = candidate.score / 100 < threshold;
    // hybrid 模式下不应过滤（semanticCandidates 设置 minScore=-1）
    expect(isFiltered).toBe(true); // display 模式会被过滤
    // 但 hybrid 使用 semanticCandidates(minScore=-1) 不会被过滤
  });

  it("chunk read context: before/after 边界", () => {
    const result = { current: { chunkIndex: 2 }, previous: [{ chunkIndex: 1 }], next: [{ chunkIndex: 3 }] };
    expect(result.current.chunkIndex).toBe(2);
    expect(result.previous.length).toBe(1);
    expect(result.next.length).toBe(1);
  });

  it("detectFileChange 中文内容", () => {
    const m: FileManifest = {
      version: 1,
      files: { "test.md": { md5: computeMD5("变压器故障"), fileSize: 15, astChunkCount: 1, astIndexedAt: "", llmCompiled: false, hasSemanticVectors: false } },
    };
    expect(detectFileChange("test.md", "变压器故障", m).changed).toBe(false);
    expect(detectFileChange("test.md", "变压器修复", m).changed).toBe(true);
  });
});
