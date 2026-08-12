import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface DomainLexiconEntry {
  term: string;
  normalized: string;
  weight: number;
  type: "domain" | "identifier";
  confidence: number;
}

function resourceFile(...parts: string[]): string {
  const root = new URL("../../../resources/", import.meta.url);
  return fileURLToPath(new URL(parts.join("/"), root));
}

let manualCache: DomainLexiconEntry[] | null = null;

export function loadDomainLexicon(): DomainLexiconEntry[] {
  if (manualCache) return manualCache;
  const path = resourceFile("lexicon", "domain-manual.tsv");
  if (!existsSync(path)) return (manualCache = []);

  const entries: DomainLexiconEntry[] = [];
  for (const rawLine of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("term\t")) continue;
    const [term, rawWeight, rawType] = line.split("\t");
    const weight = Number(rawWeight);
    if (!term || !Number.isFinite(weight)) continue;
    entries.push({
      term,
      normalized: term.toLowerCase(),
      weight: Math.min(2, Math.max(0.05, weight)),
      type: rawType === "identifier" ? "identifier" : "domain",
      confidence: 1,
    });
  }
  manualCache = entries;
  return entries;
}
