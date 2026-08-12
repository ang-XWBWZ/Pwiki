import type { AnalyzedToken, AnalyzerConfig } from "./types.js";
import type { StopwordStore } from "./stopword-store.js";

const HIGH_VALUE_FIELDS = new Set(["title", "path", "headings", "tags"]);

export function applyStopwordPolicy(
  token: AnalyzedToken,
  stopwords: StopwordStore,
  config: AnalyzerConfig,
  field?: string,
): AnalyzedToken {
  if (stopwords.protected.has(token.normalized)) {
    return {
      ...token,
      baseWeight: Math.max(token.baseWeight, config.weights.protected),
      stopwordWeight: 1,
      protected: true,
    };
  }

  if (stopwords.hard.has(token.normalized)) {
    return { ...token, stopwordWeight: 0 };
  }

  const softWeight = stopwords.soft.get(token.normalized);
  if (softWeight === undefined) return token;
  const relief = field && HIGH_VALUE_FIELDS.has(field)
    ? config.softStopwordFieldRelief
    : 0;
  return {
    ...token,
    stopwordWeight: softWeight + (1 - softWeight) * relief,
  };
}

export function effectiveTokenWeight(
  token: Pick<AnalyzedToken, "baseWeight" | "stopwordWeight" | "confidence">,
  config: Pick<AnalyzerConfig, "minTokenWeight" | "maxTokenWeight">,
): number {
  const raw = token.baseWeight * token.stopwordWeight * token.confidence;
  if (raw <= 0) return 0;
  return Math.min(config.maxTokenWeight, Math.max(config.minTokenWeight, raw));
}
