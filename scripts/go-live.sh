#!/usr/bin/env bash
# go-live.sh — one-shot release: test, publish the web drive, restage the
# Pear terminal app, and seed everything to the hiverelay fleet.
#
# Run from any checkout on a machine with normal internet access (the DHT
# needs UDP) and your Pear writer keys (the machine that first ran
# `pear touch` for the link below, or one sharing its Pear state).
#
#   ./scripts/go-live.sh                 # full release
#   SKIP_TESTS=1 ./scripts/go-live.sh    # skip the test suite (~5 min faster)
#   SKIP_PEAR=1  ./scripts/go-live.sh    # web drive + seeding only, no pear stage
set -euo pipefail

PEAR_LINK="pear://dqz1e6fwyrz1mxj7eqsmcar3hnegrj491t5hnqjm9mda9tz8dzfy"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== p2pbuilders go-live =="

echo "-- install deps"
npm install

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "-- test suite (SKIP_TESTS=1 to skip)"
  npm test
fi

echo "-- publish web drive to hiverelay"
(cd web && node publish.mjs)
NEW_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('web/manifest.json','utf8')).driveKey || '')")
echo "   web build live at: hyper://${NEW_KEY}/"

if [ "${SKIP_PEAR:-0}" != "1" ]; then
  echo "-- stage + release the terminal app (${PEAR_LINK})"
  command -v pear >/dev/null 2>&1 || {
    echo "   pear is not on PATH. install once:  npm i -g pear && pear  (then open a new terminal)"
    exit 1
  }
  # pear-electron/pre chokes on paths with spaces — stage via a space-free symlink.
  ln -sfn "$ROOT" /tmp/p2pbuilders-stage
  (cd /tmp/p2pbuilders-stage && pear stage --no-ask "$PEAR_LINK" . && pear release "$PEAR_LINK" .)
fi

echo ""
echo "== done. two follow-ups =="
echo "1. commit the updated web/manifest.json (new drive key) and refresh the"
echo "   hyper:// link at the bottom of README.md if the key changed."
echo "2. seeding: the next command asks the fleet to pin the pear app key and"
echo "   stays alive while relays catch up — Ctrl-C once it prints seeded."
echo ""
exec node scripts/seed-pear.js "$PEAR_LINK"
