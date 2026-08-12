import type { AnalyzedToken } from "./types.js";

function splitCamelCase(word: string): string[] {
  const withSpaces = word
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return withSpaces.split(" ").filter(Boolean);
}

export function analyzeIdentifier(
  word: string,
  offset: number,
  baseWeight: number,
): AnalyzedToken[] {
  if (word.length < 2) return [];
  const tokens: AnalyzedToken[] = [];

  const add = (term: string, localStart: number, localEnd: number): void => {
    if (term.length < 2 || localStart < 0 || localEnd <= localStart) return;
    tokens.push({
      term,
      normalized: term.toLowerCase(),
      start: offset + localStart,
      end: offset + localEnd,
      position: 0,
      source: "identifier",
      sources: ["identifier"],
      baseWeight,
      stopwordWeight: 1,
      confidence: 1,
      protected: false,
    });
  };

  add(word, 0, word.length);

  // Delimiter-separated engineering identifiers and path components.
  for (const match of word.matchAll(/[A-Za-z0-9]+/g)) {
    const part = match[0];
    const start = match.index ?? 0;
    add(part, start, start + part.length);

    const camelParts = splitCamelCase(part);
    if (camelParts.length > 1) {
      let camelCursor = 0;
      for (const camelPart of camelParts) {
        const camelStart = part.indexOf(camelPart, camelCursor);
        if (camelStart < 0) continue;
        add(camelPart, start + camelStart, start + camelStart + camelPart.length);
        camelCursor = camelStart + camelPart.length;
      }
    }
  }

  // Preserve useful compound bases from the legacy tokenizer.
  const dotIndex = word.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < word.length - 1) {
    add(word.slice(0, dotIndex), 0, dotIndex);
  }
  if (word.includes("/")) {
    let pathCursor = 0;
    for (const part of word.split("/")) {
      const partStart = word.indexOf(part, pathCursor);
      if (partStart >= 0) {
        add(part, partStart, partStart + part.length);
        const partDot = part.lastIndexOf(".");
        if (partDot > 0 && partDot < part.length - 1) {
          add(part.slice(0, partDot), partStart, partStart + partDot);
          add(part.slice(partDot + 1), partStart + partDot + 1, partStart + part.length);
        }
        pathCursor = partStart + part.length + 1;
      }
    }
  }

  return tokens;
}
