import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function resourceFile(...parts: string[]): string {
  const root = new URL("../../../resources/", import.meta.url);
  return fileURLToPath(new URL(parts.join("/"), root));
}

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => Boolean(line) && !line.startsWith("#"));
}

export class StopwordStore {
  readonly hard = new Set<string>();
  readonly soft = new Map<string, number>();
  readonly protected = new Set<string>();

  constructor() {
    for (const word of readLines(resourceFile("stopwords", "hard.txt"))) {
      this.hard.add(word.toLowerCase());
    }
    for (const line of readLines(resourceFile("stopwords", "soft.tsv"))) {
      if (line.startsWith("term\t")) continue;
      const [term, rawWeight] = line.split("\t");
      const weight = Number(rawWeight);
      if (term && Number.isFinite(weight)) {
        this.soft.set(term.toLowerCase(), Math.min(1, Math.max(0, weight)));
      }
    }
    for (const word of readLines(resourceFile("stopwords", "protected.txt"))) {
      this.protected.add(word.toLowerCase());
    }
  }
}

let defaultStore: StopwordStore | null = null;

export function isProtectedWord(term: string): boolean {
  defaultStore ??= new StopwordStore();
  return defaultStore.protected.has(term.toLowerCase());
}
