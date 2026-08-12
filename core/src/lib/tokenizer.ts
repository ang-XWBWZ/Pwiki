// Compatibility facade. Query and document indexing must share this analyzer.
import { analyze } from "./analyzer/text-analyzer.js";

export { analyze, analyzerStatus } from "./analyzer/text-analyzer.js";
export type {
  AnalyzeOptions,
  AnalyzedToken,
  AnalyzerConfig,
  Segment,
  Segmenter,
  TextAnalyzer,
  TokenSource,
} from "./analyzer/types.js";

export function tokenize(text: string): string[] {
  return analyze(text).map(token => token.normalized);
}
