import type { Segment, Segmenter } from "./types.js";

export class LegacyBigramSegmenter implements Segmenter {
  readonly name = "legacy" as const;
  readonly available = true;

  segment(text: string): Segment[] {
    const chars: { value: string; start: number; end: number }[] = [];
    for (let offset = 0; offset < text.length;) {
      const cp = text.codePointAt(offset)!;
      const width = cp > 0xFFFF ? 2 : 1;
      chars.push({ value: text.slice(offset, offset + width), start: offset, end: offset + width });
      offset += width;
    }

    if (chars.length === 1) {
      return [{ term: chars[0].value, start: chars[0].start, end: chars[0].end, confidence: 1 }];
    }

    const segments: Segment[] = [];
    for (let i = 0; i < chars.length - 1; i++) {
      segments.push({
        term: chars[i].value + chars[i + 1].value,
        start: chars[i].start,
        end: chars[i + 1].end,
        confidence: 1,
      });
    }
    return segments;
  }
}
