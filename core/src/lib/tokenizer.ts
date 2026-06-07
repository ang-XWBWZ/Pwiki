// tokenizer.ts — 中文 2-gram + ASCII 切词分词器
//
// 零外部依赖。状态机按字符 Unicode 属性分类：
//   CJK 字符 → 收集连续序列 → 输出二元组 (2-gram)
//   ASCII 字母/数字 → 按非字母数字切分，保留 ≥2 字符的词
//   其他（标点、空白）→ 丢弃，作分隔符
//
// 增强拆分（v1.2）：对每个 ASCII token 追加子 token：
//   snake_case → finish_reason, finish, reason
//   SCREAMING_SNAKE → llm_api_base, llm, api, base
//   kebab-case → sub2api-recover, sub2api, recover
//   camelCase/PascalCase → openaicompatible, open, ai, compatible
//   dot/slash path → model_quantized.onnx → + onnx, model_quantized, ...
//
// 查询和文档使用同一个 tokenize()，确保 BM25 token 对齐。

/**
 * 检查字符是否属于 CJK 统一表意文字范围
 */
function isCJK(cp: number): boolean {
  return (cp >= 0x4E00 && cp <= 0x9FFF)   // CJK Unified Ideographs
      || (cp >= 0x3400 && cp <= 0x4DBF)   // CJK Extension A
      || (cp >= 0x20000 && cp <= 0x2A6DF) // CJK Extension B
      || (cp >= 0xF900 && cp <= 0xFAFF)   // CJK Compatibility Ideographs
      || (cp >= 0x2F800 && cp <= 0x2FA1F);// CJK Compatibility Supplement
}

/**
 * 检查字符是否为 ASCII 字母或数字（参与分词）
 */
function isASCII(cp: number): boolean {
  return (cp >= 0x61 && cp <= 0x7A)  // a-z
      || (cp >= 0x41 && cp <= 0x5A)  // A-Z
      || (cp >= 0x30 && cp <= 0x39)  // 0-9
      || cp === 0x5F                  // _ (snake_case)
      || cp === 0x2D                  // - (kebab-case)
      || cp === 0x2E                  // . (file extension)
      || cp === 0x2F;                 // / (path separator)
}

/**
 * 对一段文本进行分词
 * @returns 小写化的 token 列表，不包含单字符 ASCII
 *
 * @example
 *   tokenize("变压器故障排查，check transformer oil 温度")
 *   // → ["变压","压器","器故","故障","障排","排查","check","transformer","oil","温度"]
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const cjkBuf: string[] = [];   // 连续 CJK 字符缓冲区
  const asciiBuf: string[] = []; // 连续 ASCII 字符缓冲区

  /**
   * 将 CJK 缓冲区输出为 2-gram tokens
   */
  function flushCJK(): void {
    if (cjkBuf.length < 2) {
      if (cjkBuf.length === 1) tokens.push(cjkBuf[0]);
    } else {
      for (let i = 0; i < cjkBuf.length - 1; i++) {
        tokens.push(cjkBuf[i] + cjkBuf[i + 1]);
      }
    }
    cjkBuf.length = 0;
  }

  /**
   * 将 ASCII 缓冲区输出为单词（≥2 字符），并追加工程拆分 token
   */
  function flushASCII(): void {
    if (asciiBuf.length < 2) { asciiBuf.length = 0; return; }
    const word = asciiBuf.join("");
    tokens.push(word.toLowerCase());
    // 工程拆分：需要原始大小写信息
    expandToken(word, tokens);
    asciiBuf.length = 0;
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const cp = ch.codePointAt(0)!;

    if (isCJK(cp)) {
      flushASCII();         // 脚本切换：先输出之前的 ASCII 词
      cjkBuf.push(ch);
    } else if (isASCII(cp)) {
      flushCJK();           // 脚本切换：先输出之前的 CJK 词
      asciiBuf.push(ch);
    } else {
      // 标点/空白/Emoji → 分隔符，同时清空两个缓冲区
      flushCJK();
      flushASCII();
    }
  }

  // 文本结束，输出残留
  flushCJK();
  flushASCII();

  return tokens;
}

// ═══════════════ 工程 token 拆分 ═══════════════

/**
 * 对 ASCII token 追加子 token（工程场景拆分）
 * 保留原始 token，同时追加拆分后的子 token
 */
/**
 * camelCase / PascalCase 拆分
 * 例: "OpenAICompatible" → ["Open", "AI", "Compatible"]
 */
function splitCamelCase(word: string): string[] {
  const withSpaces = word
    .replace(/([a-z])([A-Z])/g, "$1 $2")           // lowerUpper → lower Upper
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");     // UPPERLower → UPPER Lower
  return withSpaces.split(" ").filter(p => p.length > 0);
}

function expandToken(word: string, out: string[]): void {
  const lower = word.toLowerCase();

  // snake_case / SCREAMING_SNAKE_CASE
  if (word.includes("_")) {
    const parts = lower.split("_").filter(p => p.length >= 2);
    for (const p of parts) out.push(p);
  }

  // kebab-case
  if (word.includes("-")) {
    const parts = lower.split("-").filter(p => p.length >= 2);
    for (const p of parts) out.push(p);
  }

  // camelCase / PascalCase 拆分
  // 例: OpenAICompatible → open, ai, compatible
  const camelParts = splitCamelCase(word);
  if (camelParts.length > 1) {
    for (const p of camelParts) {
      const lp = p.toLowerCase();
      if (lp.length >= 2) out.push(lp);
    }
  }

  // dot 路径拆分: model_quantized.onnx → onnx
  const dotIdx = word.lastIndexOf(".");
  if (dotIdx > 0 && dotIdx < word.length - 1) {
    const ext = lower.slice(dotIdx + 1);
    if (ext.length >= 2) out.push(ext);
    const base = lower.slice(0, dotIdx);
    if (base.length >= 2) out.push(base);
  }

  // slash 路径拆分: packages/core/src/search → packages, core, src, search
  if (word.includes("/")) {
    const parts = lower.split("/").filter(p => p.length >= 2);
    for (const p of parts) {
      out.push(p);
      // 对路径段再做 dot 拆分: search.ts → search, ts
      const pDot = p.lastIndexOf(".");
      if (pDot > 0 && pDot < p.length - 1) {
        const pExt = p.slice(pDot + 1);
        if (pExt.length >= 2) out.push(pExt);
        const pBase = p.slice(0, pDot);
        if (pBase.length >= 2) out.push(pBase);
      }
    }
  }
}
