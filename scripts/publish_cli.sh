#!/usr/bin/env bash
# Publish the blitzwing CLI to npm under your personal account (unscoped).
#   export NPM_TOKEN=...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../packages/cli" && pwd)"
cd "$ROOT"
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN:?Set NPM_TOKEN}" > .npmrc
npm publish --access public
rm -f .npmrc
echo "Published blitzwing — rotate NPM_TOKEN if it was ever committed or pasted in chat."
