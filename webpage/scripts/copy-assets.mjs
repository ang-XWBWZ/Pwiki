import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(root, "src");
const outputRoot = resolve(root, "dist");

await mkdir(outputRoot, { recursive: true });
await copyFile(resolve(sourceRoot, "index.html"), resolve(outputRoot, "index.html"));
await copyFile(resolve(sourceRoot, "styles.css"), resolve(outputRoot, "styles.css"));
