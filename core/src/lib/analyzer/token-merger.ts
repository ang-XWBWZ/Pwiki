import type { AnalyzedToken, AnalyzerConfig, TokenSource } from "./types.js";
import { effectiveTokenWeight } from "./token-weights.js";

export function mergeTokens(
  candidates: AnalyzedToken[],
  config: AnalyzerConfig,
): AnalyzedToken[] {
  const merged = new Map<string, AnalyzedToken>();

  for (const token of candidates) {
    if (!token.normalized || token.end <= token.start) continue;
    const key = `${token.normalized}\u0000${token.start}\u0000${token.end}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...token, sources: [...token.sources] });
      continue;
    }

    const sources = new Set<TokenSource>([...current.sources, ...token.sources]);
    const winner = effectiveTokenWeight(token, config) > effectiveTokenWeight(current, config)
      ? token
      : current;
    merged.set(key, { ...winner, sources: [...sources] });
  }

  const ordered = [...merged.values()].sort((a, b) =>
    a.start - b.start
    || effectiveTokenWeight(b, config) - effectiveTokenWeight(a, config)
    || (b.end - b.start) - (a.end - a.start)
    || a.normalized.localeCompare(b.normalized));
  const starts = [...new Set(ordered.map(token => token.start))].sort((a, b) => a - b);
  const positions = new Map(starts.map((start, position) => [start, position]));

  return ordered
    .map(token => ({ ...token, position: positions.get(token.start) ?? 0 }))
    .filter(token => effectiveTokenWeight(token, config) > 0);
}
