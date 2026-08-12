import { createRequire } from "node:module";
import type { Segment, Segmenter } from "./types.js";

interface JiebaInstance {
  cut(sentence: string | Uint8Array, hmm?: boolean | null): string[];
}

interface JiebaConstructor {
  withDict(dict: Uint8Array): JiebaInstance;
}

const localRequire = createRequire(import.meta.url);
let sharedInstance: JiebaInstance | null | undefined;

function loadJieba(): JiebaInstance | null {
  if (sharedInstance !== undefined) return sharedInstance;
  try {
    const { Jieba } = localRequire("@node-rs/jieba") as { Jieba: JiebaConstructor };
    const { dict } = localRequire("@node-rs/jieba/dict.js") as { dict: Uint8Array };
    sharedInstance = Jieba.withDict(dict);
  } catch {
    sharedInstance = null;
  }
  return sharedInstance;
}

export class JiebaSegmenter implements Segmenter {
  readonly name = "jieba" as const;

  get available(): boolean {
    return loadJieba() !== null;
  }

  segment(text: string): Segment[] {
    const jieba = loadJieba();
    if (!jieba || !text) return [];

    const segments: Segment[] = [];
    let cursor = 0;
    for (const term of jieba.cut(text, true)) {
      if (!term) continue;
      const start = text.indexOf(term, cursor);
      if (start < 0) continue;
      const end = start + term.length;
      segments.push({ term, start, end, confidence: 1 });
      cursor = end;
    }
    return segments;
  }
}
