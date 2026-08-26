#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 1.3.7"
  exit 2
fi

RELEASE_VERSION="$1"
if [[ ! "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid release version: $RELEASE_VERSION" >&2
  exit 2
fi

PUBLIC_PACKAGES=(
  "@llangtop/pwiki-core"
  "@llangtop/pwiki-api"
  "@llangtop/pwiki-cli"
  "@llangtop/pwiki-mcp"
  "@llangtop/pwiki-webpage"
)

WORKSPACE_DIRS=(core cli mcp api webpage)
EXECUTABLE_ENTRYPOINTS=(
  "cli/dist/index.js"
  "mcp/dist/index.js"
  "api/dist/server.js"
  "webpage/dist/server.js"
)

echo "=== verify package versions: $RELEASE_VERSION ==="
node - "$RELEASE_VERSION" <<'NODE'
const fs = require("node:fs");

const expected = process.argv[2];
const files = [
  "package.json",
  "core/package.json",
  "cli/package.json",
  "mcp/package.json",
  "api/package.json",
  "webpage/package.json",
];

for (const file of files) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (pkg.version !== expected) {
    throw new Error(`${file}: expected ${expected}, found ${pkg.version}`);
  }
}

for (const file of [
  "core/package.json",
  "api/package.json",
  "cli/package.json",
  "mcp/package.json",
  "webpage/package.json",
]) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (pkg.private === true) {
    throw new Error(`${file}: public package must not be private`);
  }
}
NODE

REGISTRY="$(npm config get registry)"
echo "=== verify npm account: $REGISTRY ==="
echo "npm login is intentionally not run by this script."
npm whoami --registry "$REGISTRY"

echo "=== clean generated dist directories ==="
for package_dir in "${WORKSPACE_DIRS[@]}"; do
  node -e 'require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })' \
    "$ROOT_DIR/$package_dir/dist"
done

echo "=== build all workspaces in dependency order ==="
npm run build

echo "=== mark package entrypoints executable ==="
for entrypoint in "${EXECUTABLE_ENTRYPOINTS[@]}"; do
  chmod 0755 "$ROOT_DIR/$entrypoint"
done
for entrypoint in "${EXECUTABLE_ENTRYPOINTS[@]}"; do
  if [[ ! -x "$ROOT_DIR/$entrypoint" ]]; then
    echo "Package entrypoint is not executable: $entrypoint" >&2
    exit 1
  fi
done

echo "=== run core tests ==="
npm test -w @llangtop/pwiki-core

echo "=== inspect publish tarballs ==="
for package_name in "${PUBLIC_PACKAGES[@]}"; do
  pack_json="$(mktemp)"
  npm pack --dry-run --json -w "$package_name" > "$pack_json"
  node - "$pack_json" "$package_name" <<'NODE'
const fs = require("node:fs");

const [file, packageName] = process.argv.slice(2);
const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
const result = Array.isArray(parsed) ? parsed[0] : parsed;
const files = Array.isArray(result.files) ? result.files : [];
const unsafe = files
  .map((entry) => typeof entry === "string" ? entry : entry.path)
  .filter((path) => /(^|\/)(__tests__|tests)(\/|$)|\.(test|spec)\./i.test(path));

if (unsafe.length > 0) {
  throw new Error(`${packageName}: test artifacts would be published: ${unsafe.join(", ")}`);
}

console.log(`${result.id}: ${files.length} files, ${result.size} bytes`);
NODE
  rm -f "$pack_json"
done

for package_name in "${PUBLIC_PACKAGES[@]}"; do
  echo "=== publish $package_name ==="
  npm publish --access public --registry "$REGISTRY" -w "$package_name"
done

echo "=== Pwiki $RELEASE_VERSION publish completed ==="
