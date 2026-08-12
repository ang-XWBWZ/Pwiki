export type ScriptKind = "cjk" | "ascii";

export interface ScriptSpan {
  kind: ScriptKind;
  text: string;
  start: number;
  end: number;
}

export function isCjkCodePoint(cp: number): boolean {
  return (cp >= 0x4E00 && cp <= 0x9FFF)
    || (cp >= 0x3400 && cp <= 0x4DBF)
    || (cp >= 0x20000 && cp <= 0x2A6DF)
    || (cp >= 0xF900 && cp <= 0xFAFF)
    || (cp >= 0x2F800 && cp <= 0x2FA1F);
}

function isAsciiTokenCodePoint(cp: number): boolean {
  return (cp >= 0x61 && cp <= 0x7A)
    || (cp >= 0x41 && cp <= 0x5A)
    || (cp >= 0x30 && cp <= 0x39)
    || cp === 0x5F // _
    || cp === 0x2D // -
    || cp === 0x2E // .
    || cp === 0x2F; // /
}

export function splitScripts(text: string): ScriptSpan[] {
  const spans: ScriptSpan[] = [];
  let activeKind: ScriptKind | null = null;
  let activeStart = 0;

  const flush = (end: number): void => {
    if (activeKind && end > activeStart) {
      spans.push({
        kind: activeKind,
        text: text.slice(activeStart, end),
        start: activeStart,
        end,
      });
    }
    activeKind = null;
  };

  for (let offset = 0; offset < text.length;) {
    const cp = text.codePointAt(offset)!;
    const width = cp > 0xFFFF ? 2 : 1;
    const kind: ScriptKind | null = isCjkCodePoint(cp)
      ? "cjk"
      : isAsciiTokenCodePoint(cp) ? "ascii" : null;

    if (!kind) {
      flush(offset);
    } else if (activeKind !== kind) {
      flush(offset);
      activeKind = kind;
      activeStart = offset;
    }
    offset += width;
    if (!kind) activeStart = offset;
  }

  flush(text.length);
  return spans;
}
