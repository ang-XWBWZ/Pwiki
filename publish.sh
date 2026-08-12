#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== npm login ==="
npm login

echo "=== verify npm account ==="
npm whoami

echo "=== publish @llangtop/pwiki-core ==="
(
  cd core
  npx tsc
  npm publish --access public
)

echo "=== publish @llangtop/pwiki-cli ==="
npx tsc -b cli
npm publish --access public -w @llangtop/pwiki-cli

echo "=== publish @llangtop/pwiki-mcp ==="
npx tsc -b mcp
npm publish --access public -w @llangtop/pwiki-mcp

echo "=== Pwiki publish completed ==="
