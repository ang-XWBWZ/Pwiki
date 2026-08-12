// tokenizer.test.ts — tokenizer 单元测试
// vitest 在 core/package.json 中通过 "type": "module" 自动识别 ESM

import { describe, it, expect } from "vitest";
import { analyze, tokenize } from "../tokenizer.js";

describe("tokenizer", () => {
  describe("中文多粒度分词", () => {
    it("双字词", () => {
      const tokens = tokenize("变压器");
      expect(tokens).toContain("变压器");
      expect(tokens).toContain("变压");
      expect(tokens).toContain("压器");
    });

    it("多字词", () => {
      const tokens = tokenize("变压器故障");
      expect(tokens).toEqual(expect.arrayContaining(["变压器", "变压", "压器", "器故", "故障"]));
      const analyzed = analyze("变压器故障");
      const weight = (term: string) => {
        const token = analyzed.find(candidate => candidate.normalized === term)!;
        return token.baseWeight * token.stopwordWeight * token.confidence;
      };
      expect(weight("变压器")).toBeGreaterThan(weight("变压"));
      expect(weight("故障")).toBeGreaterThan(weight("器故"));
    });

    it("单字", () => {
      expect(tokenize("电")).toEqual(["电"]);
    });

    it("含标点", () => {
      expect(tokenize("故障，排查")).toEqual(["故障", "排查"]);
    });
  });

  describe("ASCII 切词", () => {
    it("简单英文", () => {
      expect(tokenize("hello world")).toEqual(["hello", "world"]);
    });

    it("过滤单字符", () => {
      expect(tokenize("a the check")).toEqual(["the", "check"]);
    });

    it("大小写统一", () => {
      expect(tokenize("Check Transformer")).toEqual(["check", "transformer"]);
    });

    it("混合数字", () => {
      expect(tokenize("nginx2 config v1")).toEqual(["nginx2", "config", "v1"]);
    });
  });

  describe("中英混合", () => {
    it("nginx 反向代理", () => {
      expect(tokenize("nginx 反向代理")).toEqual(["nginx", "反向", "向代", "代理"]);
    });

    it("使用 nginx 部署", () => {
      expect(tokenize("使用nginx部署")).toEqual(["使用", "nginx", "部署"]);
    });
  });

  describe("标点与空白处理", () => {
    it("逗号分隔", () => {
      expect(tokenize("a,b,c")).toEqual([]); // 都是单字符
    });

    it("括号", () => {
      expect(tokenize("[工作]")).toEqual(["工作"]);
    });
  });

  describe("工程 token 拆分", () => {
    it("snake_case", () => {
      const result = tokenize("finish_reason");
      expect(result).toContain("finish_reason");
      expect(result).toContain("finish");
      expect(result).toContain("reason");
    });

    it("SCREAMING_SNAKE_CASE", () => {
      const result = tokenize("LLM_API_BASE");
      expect(result).toContain("llm_api_base");
      expect(result).toContain("llm");
      expect(result).toContain("api");
      expect(result).toContain("base");
    });

    it("kebab-case", () => {
      const result = tokenize("sub2api-recover");
      expect(result).toContain("sub2api-recover");
      expect(result).toContain("sub2api");
      expect(result).toContain("recover");
    });

    it("camelCase", () => {
      const result = tokenize("OpenAICompatible");
      expect(result).toContain("openaicompatible");
      expect(result).toContain("open");
      expect(result).toContain("ai");
      expect(result).toContain("compatible");
    });

    it("dot extension", () => {
      const result = tokenize("model_quantized.onnx");
      expect(result).toContain("model_quantized.onnx");
      expect(result).toContain("onnx");
      expect(result).toContain("model_quantized");
    });

    it("slash path", () => {
      const result = tokenize("packages/core/src/search.ts");
      expect(result).toContain("packages/core/src/search.ts");
      expect(result).toContain("packages");
      expect(result).toContain("core");
      expect(result).toContain("src");
      expect(result).toContain("search");
      expect(result).toContain("ts");
    });

    it("partial match: finish reason finds finish_reason", () => {
      // 搜索 "finish reason" 应能命中 "finish_reason" 文档
      const doc = tokenize("finish_reason");
      const query = tokenize("finish reason");
      // 交集：query 的 "finish" 和 "reason" 都在 doc 中
      const intersection = query.filter(t => doc.includes(t));
      expect(intersection.sort()).toEqual(["finish", "reason"]);
    });

    it("partial match: api base finds LLM_API_BASE", () => {
      const doc = tokenize("LLM_API_BASE");
      const query = tokenize("api base");
      const intersection = query.filter(t => doc.includes(t));
      expect(intersection.sort()).toEqual(["api", "base"]);
    });

    it("partial match: openai compatible finds OpenAICompatible", () => {
      const doc = tokenize("OpenAICompatible");
      const query = tokenize("openai compatible");
      const intersection = query.filter(t => doc.includes(t));
      expect(intersection.length).toBeGreaterThanOrEqual(1);
    });

    it("partial match: search ts finds search.ts", () => {
      const doc = tokenize("packages/core/src/search.ts");
      const query = tokenize("search ts");
      const intersection = query.filter(t => doc.includes(t));
      expect(intersection).toContain("search");
      expect(intersection).toContain("ts");
    });
  });
});
