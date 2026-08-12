import { analyzeIdentifier } from "./identifier-analyzer.js";
import { JiebaSegmenter } from "./jieba-segmenter.js";
import { LegacyBigramSegmenter } from "./legacy-bigram-segmenter.js";
import { loadDomainLexicon } from "./lexicon-store.js";
import { matchDomainTerms } from "./domain-matcher.js";
import { splitScripts } from "./script-splitter.js";
import { StopwordStore } from "./stopword-store.js";
import { mergeTokens } from "./token-merger.js";
import { applyStopwordPolicy } from "./token-weights.js";
import {
  DEFAULT_ANALYZER_CONFIG,
  type AnalyzeOptions,
  type AnalyzedToken,
  type AnalyzerConfig,
  type Segment,
  type TextAnalyzer,
  type TokenSource,
} from "./types.js";

function resolvedConfig(options: AnalyzeOptions): AnalyzerConfig {
  return {
    segmenter: options.segmenter ?? DEFAULT_ANALYZER_CONFIG.segmenter,
    enableDomainLexicon: options.enableDomainLexicon ?? DEFAULT_ANALYZER_CONFIG.enableDomainLexicon,
    enableBigramFallback: options.enableBigramFallback ?? DEFAULT_ANALYZER_CONFIG.enableBigramFallback,
    softStopwordFieldRelief: options.softStopwordFieldRelief ?? DEFAULT_ANALYZER_CONFIG.softStopwordFieldRelief,
    minTokenWeight: options.minTokenWeight ?? DEFAULT_ANALYZER_CONFIG.minTokenWeight,
    maxTokenWeight: options.maxTokenWeight ?? DEFAULT_ANALYZER_CONFIG.maxTokenWeight,
    weights: { ...DEFAULT_ANALYZER_CONFIG.weights, ...options.weights },
  };
}

function fromSegment(
  segment: Segment,
  offset: number,
  source: TokenSource,
  baseWeight: number,
): AnalyzedToken {
  return {
    term: segment.term,
    normalized: segment.term.toLowerCase(),
    start: offset + segment.start,
    end: offset + segment.end,
    position: 0,
    source,
    sources: [source],
    baseWeight,
    stopwordWeight: 1,
    confidence: segment.confidence ?? 1,
    protected: false,
  };
}

export class DefaultTextAnalyzer implements TextAnalyzer {
  private readonly jieba = new JiebaSegmenter();
  private readonly legacy = new LegacyBigramSegmenter();
  private readonly stopwords = new StopwordStore();
  private readonly domainLexicon = loadDomainLexicon();

  analyze(text: string, options: AnalyzeOptions = {}): AnalyzedToken[] {
    if (!text) return [];
    const config = resolvedConfig(options);
    const candidates: AnalyzedToken[] = [];

    for (const span of splitScripts(text)) {
      if (span.kind === "ascii") {
        candidates.push(...analyzeIdentifier(span.text, span.start, config.weights.identifier));
        continue;
      }

      let usedLegacy = config.segmenter === "legacy" || !this.jieba.available;
      const primary = usedLegacy ? this.legacy : this.jieba;
      let primarySegments = primary.segment(span.text);
      if (primarySegments.length === 0 && primary !== this.legacy) {
        primarySegments = this.legacy.segment(span.text);
        usedLegacy = true;
      }
      for (const segment of primarySegments) {
        const isSingle = Array.from(segment.term).length === 1;
        const source: TokenSource = usedLegacy
          ? (isSingle ? "unigram" : "bigram")
          : "dictionary";
        const weight = source === "dictionary"
          ? config.weights.dictionary
          : source === "unigram" ? config.weights.unigram : config.weights.bigram;
        candidates.push(fromSegment(segment, span.start, source, weight));
      }

      if (config.enableBigramFallback && !usedLegacy) {
        for (const segment of this.legacy.segment(span.text)) {
          const isSingle = Array.from(segment.term).length === 1;
          const source: TokenSource = isSingle ? "unigram" : "bigram";
          candidates.push(fromSegment(
            segment,
            span.start,
            source,
            isSingle ? config.weights.unigram : config.weights.bigram,
          ));
        }
      }
    }

    if (config.enableDomainLexicon) {
      candidates.push(...matchDomainTerms(text, this.domainLexicon));
    }

    const weighted = candidates.map(token =>
      applyStopwordPolicy(token, this.stopwords, config, options.field));
    return mergeTokens(weighted, config);
  }

  status(): { requested: AnalyzerConfig["segmenter"]; active: AnalyzerConfig["segmenter"] } {
    return {
      requested: DEFAULT_ANALYZER_CONFIG.segmenter,
      active: this.jieba.available ? "jieba" : "legacy",
    };
  }
}

const defaultAnalyzer = new DefaultTextAnalyzer();

export function analyze(text: string, options: AnalyzeOptions = {}): AnalyzedToken[] {
  return defaultAnalyzer.analyze(text, options);
}

export function analyzerStatus(): ReturnType<DefaultTextAnalyzer["status"]> {
  return defaultAnalyzer.status();
}
