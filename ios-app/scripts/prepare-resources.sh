#!/usr/bin/env bash
# prepare-resources.sh — copy the frontend files and produce the Bare backend
# bundle so they're bundled into the iOS app at build time.
#
# Run from project root:
#   ./ios-app/scripts/prepare-resources.sh
#
# What it does:
#   1. Copies public/*.{html,js,css} into ios-app/P2PBuilders/Resources/
#   2. Runs bare-pack to produce Resources/backend.bundle.mjs (the JS blob
#      the worklet loads).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESOURCES="$ROOT/ios-app/P2PBuilders/Resources"

echo "[prepare] using project root: $ROOT"
echo "[prepare] destination:        $RESOURCES"

mkdir -p "$RESOURCES"

# 1. Copy frontend files
cp "$ROOT/public/index.html" "$RESOURCES/"
cp "$ROOT/public/app.js"     "$RESOURCES/"
cp "$ROOT/public/styles.css" "$RESOURCES/"
cp "$ROOT/public/transport.js" "$RESOURCES/"

echo "[prepare] copied public/* to Resources/"

# 2. Bundle the Bare backend
cd "$ROOT"
BUNDLE_OUT="$RESOURCES/backend.bundle.mjs"
echo "[prepare] bundling backend → $BUNDLE_OUT"
npx --no-install bare-pack --linked --host ios-arm64 src/bare/ios-entry.js -o "$BUNDLE_OUT"

echo "[prepare] done."
ls -lh "$RESOURCES/"
