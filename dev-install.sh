#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

LINKED_PACKAGES=(
  "@llangtop/pwiki-core"
  "@llangtop/pwiki-api"
  "@llangtop/pwiki-cli"
  "@llangtop/pwiki-mcp"
  "@llangtop/pwiki-webpage"
)

SKIP_BUILD=false
if [[ $# -gt 1 || (${1:-} != "" && ${1:-} != "--skip-build") ]]; then
  echo "Usage: $0 [--skip-build]"
  exit 2
fi
if [[ ${1:-} == "--skip-build" ]]; then
  SKIP_BUILD=true
fi

if [[ "$SKIP_BUILD" == false ]]; then
  echo "=== clean generated dist directories ==="
  for package_dir in core cli mcp api webpage; do
    node -e 'require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })' \
      "$ROOT_DIR/$package_dir/dist"
  done

  echo "=== build all workspaces in dependency order ==="
  npm run build

  echo "=== run core tests ==="
  npm test -w @llangtop/pwiki-core
else
  echo "=== skip build and tests; use existing dist output ==="
fi

chmod 0755 \
  "$ROOT_DIR/cli/dist/index.js" \
  "$ROOT_DIR/mcp/dist/index.js" \
  "$ROOT_DIR/api/dist/server.js" \
  "$ROOT_DIR/webpage/dist/server.js"

echo "=== link local packages ==="
for package_name in "${LINKED_PACKAGES[@]}"; do
  npm link --workspace "$package_name"
done

if [[ -n "${NPM_CONFIG_PREFIX:-}" ]]; then
  export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
fi

EXPECTED_VERSION="$(node -p 'require("./cli/package.json").version')"
CLI_PATH="$(command -v pwiki || true)"
MCP_PATH="$(command -v pwiki-mcp || true)"
GLOBAL_NODE_MODULES="$(npm root --global)"

for package_name in "${LINKED_PACKAGES[@]}"; do
  package_path="$GLOBAL_NODE_MODULES/$package_name"
  if [[ ! -e "$package_path" ]]; then
    echo "Local link missing: $package_name ($package_path)" >&2
    exit 1
  fi
done

if [[ -z "$CLI_PATH" || -z "$MCP_PATH" ]]; then
  echo "Local links were created, but one or more bin commands are not on PATH." >&2
  echo "pwiki path: ${CLI_PATH:-<not found>}"
  echo "pwiki-mcp path: ${MCP_PATH:-<not found>}"
  exit 1
fi

ACTUAL_VERSION="$(pwiki --version)"
if [[ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "pwiki version mismatch: expected $EXPECTED_VERSION, found $ACTUAL_VERSION" >&2
  exit 1
fi

echo "pwiki: $CLI_PATH"
echo "pwiki-mcp: $MCP_PATH"
echo "pwiki version: $ACTUAL_VERSION"
echo "=== local install completed ==="
