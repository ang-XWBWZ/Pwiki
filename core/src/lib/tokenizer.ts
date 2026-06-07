// tokenizer.ts — 中文 2-gram + ASCII 切词分词器
//
// 零外部依赖。状态机按字符 Unicode 属性分类：
//   CJK 字符 → 收集连续序列 → 输出二元组 (2-gram)
//   ASCII 字母/数字 → 按非字母数字切分，保留 ≥2 字符的词
//   其他（标点、空白）→ 丢弃，作分隔符
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
      || (cp >= 0x30 && cp <= 0x39); // 0-9
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
      // 单字符 CJK：保留
      if (cjkBuf.length === 1) tokens.push(cjkBuf[0]);
    } else {
      // 滑动窗口生成所有相邻二元组
      for (let i = 0; i < cjkBuf.length - 1; i++) {
        tokens.push(cjkBuf[i] + cjkBuf[i + 1]);
      }
    }
    cjkBuf.length = 0;
  }

  /**
   * 将 ASCII 缓冲区输出为单词（≥2 字符）
   */
  function flushASCII(): void {
    if (asciiBuf.length >= 2) {
      tokens.push(asciiBuf.join("").toLowerCase());
    }
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
