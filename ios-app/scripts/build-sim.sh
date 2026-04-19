#!/usr/bin/env bash
# build-sim.sh — one-shot build + install + launch in the iOS simulator.
#
# Prereqs:
#   - Xcode installed, simulator available
#   - xcodegen (brew install xcodegen)
#   - bare-kit-pear added as an SPM dependency inside the generated Xcode
#     project (see ios-app/README.md)
#
# Run from project root:
#   ./ios-app/scripts/build-sim.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IOS="$ROOT/ios-app"
SCHEME="P2PBuilders"
BUNDLE_ID="com.p2pbuilders.app"
DERIVED="$IOS/build"

echo "[build] preparing resources"
"$IOS/scripts/prepare-resources.sh"

cd "$IOS"
if [[ ! -d P2PBuilders.xcodeproj ]]; then
  echo "[build] generating Xcode project via xcodegen"
  xcodegen
fi

echo "[build] xcodebuild for iOS Simulator"
xcodebuild \
  -project P2PBuilders.xcodeproj \
  -scheme "$SCHEME" \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" \
  build \
  | xcbeautify 2>/dev/null || true

# Find the built .app
APP_PATH="$(find "$DERIVED/Build/Products/Debug-iphonesimulator" -name "$SCHEME.app" -maxdepth 2 -type d | head -n1)"
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "[build] error: built app not found under $DERIVED/Build/Products/Debug-iphonesimulator"
  exit 1
fi
echo "[build] built: $APP_PATH"

# Boot a simulator (pick the first booted one; otherwise boot the default)
BOOTED="$(xcrun simctl list devices booted | awk -F '[()]' '/\(Booted\)/ { print $2; exit }' || true)"
if [[ -z "$BOOTED" ]]; then
  echo "[build] no simulator booted; opening Simulator.app"
  open -a Simulator
  # wait up to ~20s for a boot
  for i in {1..20}; do
    sleep 1
    BOOTED="$(xcrun simctl list devices booted | awk -F '[()]' '/\(Booted\)/ { print $2; exit }' || true)"
    [[ -n "$BOOTED" ]] && break
  done
  if [[ -z "$BOOTED" ]]; then
    echo "[build] could not detect a booted simulator. Open Simulator, boot any iPhone, and rerun."
    exit 1
  fi
fi
echo "[build] installing on simulator $BOOTED"
xcrun simctl install "$BOOTED" "$APP_PATH"
echo "[build] launching"
xcrun simctl launch "$BOOTED" "$BUNDLE_ID"
echo "[build] done. logs: xcrun simctl spawn $BOOTED log stream --predicate 'process == \"$SCHEME\"'"
