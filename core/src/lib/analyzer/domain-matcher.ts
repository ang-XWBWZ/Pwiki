import type { AnalyzedToken } from "./types.js";
import type { DomainLexiconEntry } from "./lexicon-store.js";

function isAsciiWordChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value));
}

export function matchDomainTerms(
  text: string,
  entries: DomainLexiconEntry[],
): AnalyzedToken[] {
  const normalizedText = text.toLowerCase();
  const tokens: AnalyzedToken[] = [];

  for (const entry of entries) {
    let cursor = 0;
    while (cursor <= normalizedText.length - entry.normalized.length) {
      const start = normalizedText.indexOf(entry.normalized, cursor);
      if (start < 0) break;
      const end = start + entry.normalized.length;
      cursor = start + 1;

      if (/^[a-z0-9_]+$/i.test(entry.term)) {
        if (isAsciiWordChar(text[start - 1]) || isAsciiWordChar(text[end])) continue;
      }

      const source = entry.type === "identifier" ? "identifier" : "domain";
      tokens.push({
        term: text.slice(start, end),
        normalized: entry.normalized,
        start,
        end,
        position: 0,
        source,
        sources: [source],
        baseWeight: entry.weight,
        stopwordWeight: 1,
        confidence: entry.confidence,
        protected: false,
      });
    }
  }

  return tokens;
}
