import { describe, expect, it } from "vitest";
import { analyze, analyzerStatus } from "../tokenizer.js";

function weight(token: ReturnType<typeof analyze>[number]): number {
  return token.baseWeight * token.stopwordWeight * token.confidence;
}

describe("weighted text analyzer", () => {
  it("uses Jieba words with low-weight bigram recall", () => {
    const tokens = analyze("变压器故障排查");
    const byTerm = new Map(tokens.map(token => [token.normalized, token]));
    expect(byTerm.has("变压器")).toBe(true);
    expect(byTerm.has("故障")).toBe(true);
    expect(byTerm.has("排查")).toBe(true);
    expect(byTerm.has("变压")).toBe(true);
    expect(byTerm.has("压器")).toBe(true);
    expect(weight(byTerm.get("变压器")!)).toBeGreaterThan(weight(byTerm.get("变压")!));
    expect(analyzerStatus().requested).toBe("jieba");
  });

  it("emits manual domain terms independently of Jieba boundaries", () => {
    const tokens = analyze("DCU 数据上送异常导致 HES 无法接收报文");
    const upload = tokens.find(token => token.normalized === "数据上送");
    const failure = tokens.find(token => token.normalized === "上送异常");
    expect(upload).toMatchObject({ source: "domain", baseWeight: 1.5 });
    expect(failure).toMatchObject({ source: "domain", baseWeight: 1.4 });
  });

  it("applies hard, soft and protected stopword policies", () => {
    const tokens = analyze("系统的启动失败");
    expect(tokens.some(token => token.normalized === "的")).toBe(false);
    expect(weight(tokens.find(token => token.normalized === "系统")!)).toBeCloseTo(0.35);
    expect(tokens.find(token => token.normalized === "启动")).toMatchObject({
      protected: true,
      stopwordWeight: 1,
      baseWeight: 1.3,
    });
    expect(tokens.find(token => token.normalized === "失败")?.protected).toBe(true);
  });

  it("weakens soft-stopword penalties in title fields", () => {
    const body = analyze("系统", { field: "body" })[0];
    const title = analyze("系统", { field: "title" })[0];
    expect(weight(title)).toBeGreaterThan(weight(body));
    expect(weight(title)).toBeLessThan(1);
  });

  it("keeps the exact legacy segmenter available", () => {
    const tokens = analyze("变压器", {
      segmenter: "legacy",
      enableBigramFallback: false,
      enableDomainLexicon: false,
    });
    expect(tokens.map(token => token.normalized)).toEqual(["变压", "压器"]);
    expect(tokens.every(token => token.source === "bigram")).toBe(true);
  });

  it("retains a position gap when a hard stopword is omitted", () => {
    const tokens = analyze("系统的启动", { enableBigramFallback: false });
    const system = tokens.find(token => token.normalized === "系统")!;
    const start = tokens.find(token => token.normalized === "启动")!;
    expect(start.position - system.position).toBe(2);
  });
});
