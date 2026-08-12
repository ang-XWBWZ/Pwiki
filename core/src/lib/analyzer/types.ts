export type TokenSource =
  | "domain"
  | "dictionary"
  | "identifier"
  | "alias"
  | "phrase"
  | "bigram"
  | "unigram";

export interface Segment {
  term: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface Segmenter {
  readonly name: "jieba" | "legacy";
  readonly available: boolean;
  segment(text: string): Segment[];
}

export interface AnalyzerWeights {
  dictionary: number;
  identifier: number;
  bigram: number;
  unigram: number;
  protected: number;
}

export interface AnalyzerConfig {
  segmenter: "jieba" | "legacy";
  enableDomainLexicon: boolean;
  enableBigramFallback: boolean;
  softStopwordFieldRelief: number;
  minTokenWeight: number;
  maxTokenWeight: number;
  weights: AnalyzerWeights;
}

export interface AnalyzeOptions {
  segmenter?: AnalyzerConfig["segmenter"];
  enableDomainLexicon?: boolean;
  enableBigramFallback?: boolean;
  softStopwordFieldRelief?: number;
  minTokenWeight?: number;
  maxTokenWeight?: number;
  weights?: Partial<AnalyzerWeights>;
  /** Used to reduce soft-stopword penalties in high-value fields. */
  field?: string;
}

export interface AnalyzedToken {
  term: string;
  normalized: string;
  start: number;
  end: number;
  position: number;
  source: TokenSource;
  /** All analyzers that emitted the same term at the same character span. */
  sources: TokenSource[];
  baseWeight: number;
  stopwordWeight: number;
  confidence: number;
  protected: boolean;
}

export interface TextAnalyzer {
  analyze(text: string, options?: AnalyzeOptions): AnalyzedToken[];
}

export const DEFAULT_ANALYZER_CONFIG: Readonly<AnalyzerConfig> = {
  segmenter: "jieba",
  enableDomainLexicon: true,
  enableBigramFallback: true,
  softStopwordFieldRelief: 0.5,
  minTokenWeight: 0.05,
  maxTokenWeight: 2.0,
  weights: {
    dictionary: 1.0,
    identifier: 1.5,
    bigram: 0.2,
    unigram: 0.5,
    protected: 1.3,
  },
};
