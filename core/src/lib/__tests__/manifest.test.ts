// manifest.test.ts — 文件状态变更检测单元测试

import { describe, it, expect } from "vitest";
import { computeMD5, isFileChanged, detectFileChange } from "../file-manifest.js";
import type { FileManifest } from "../file-manifest.js";

describe("manifest 变更检测", () => {
  describe("computeMD5", () => {
    it("相同内容产生相同 hash", () => {
      const a = computeMD5("hello world");
      const b = computeMD5("hello world");
      expect(a).toBe(b);
    });

    it("不同内容产生不同 hash", () => {
      const a = computeMD5("hello world");
      const b = computeMD5("hello mars");
      expect(a).not.toBe(b);
    });

    it("空字符串有合法 hash", () => {
      const hash = computeMD5("");
      expect(hash).toBe("d41d8cd98f00b204e9800998ecf8427e");
    });

    it("中文内容正常", () => {
      const hash = computeMD5("变压器故障");
      expect(hash).toBeTypeOf("string");
      expect(hash.length).toBe(32);
    });
  });

  describe("isFileChanged (无 manifest 记录时)", () => {
    it("不存在记录 → 视为变更", () => {
      // isFileChanged 内部调用 getFileState，找不到返回 true
      const changed = isFileChanged("nonexistent/file.md", "abc123");
      expect(changed).toBe(true);
    });
  });

  describe("detectFileChange", () => {
    const emptyManifest: FileManifest = { version: 1, files: {} };

    it("manifest 无记录 → changed=true", () => {
      const result = detectFileChange("new.md", "hello", emptyManifest);
      expect(result.changed).toBe(true);
      expect(result.currentMd5).toBe(computeMD5("hello"));
      expect(result.previousMd5).toBeNull();
    });

    it("内容相同 → changed=false", () => {
      const content = "hello world";
      const md5 = computeMD5(content);
      const m: FileManifest = {
        version: 1,
        files: { "same.md": { md5, fileSize: 11, astChunkCount: 1, astIndexedAt: "", llmCompiled: false, hasSemanticVectors: false } },
      };
      const result = detectFileChange("same.md", content, m);
      expect(result.changed).toBe(false);
      expect(result.currentMd5).toBe(md5);
      expect(result.previousMd5).toBe(md5);
    });

    it("内容不同 → changed=true", () => {
      const m: FileManifest = {
        version: 1,
        files: { "changed.md": { md5: "abc", fileSize: 5, astChunkCount: 1, astIndexedAt: "", llmCompiled: false, hasSemanticVectors: false } },
      };
      const result = detectFileChange("changed.md", "new content", m);
      expect(result.changed).toBe(true);
      expect(result.previousMd5).toBe("abc");
    });

    it("中文内容变更检测", () => {
      const content = "变压器故障";
      const md5 = computeMD5(content);
      const m: FileManifest = {
        version: 1,
        files: { "test.md": { md5, fileSize: 15, astChunkCount: 1, astIndexedAt: "", llmCompiled: false, hasSemanticVectors: false } },
      };
      expect(detectFileChange("test.md", content, m).changed).toBe(false);
      expect(detectFileChange("test.md", "变压器修复", m).changed).toBe(true);
    });
  });
});
