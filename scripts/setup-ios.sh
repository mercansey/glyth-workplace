#!/bin/zsh
# Glyth iOS setup: install -> build web bundle -> generate/sync iOS shell ->
# integrate the Swift bridge. Run from anywhere; it cds to the repo root.
# Requires: npm registry access, Xcode (for cap add/open + signing).
set -e
cd "$(dirname "$0")/.."

echo "==> Checking tools"
command -v node >/dev/null || { echo "Node is required."; exit 1; }
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "Xcode is not available (only Command Line Tools?). Install Xcode from the App Store, run it once, then re-run this script."
  exit 1
fi

echo "==> Installing dependencies (Capacitor 7 as pinned in package.json)"
npm install

echo "==> Building packaged web bundle"
if [ -z "$GLYTH_API_BASE" ]; then
  printf "Backend HTTPS base URL for the packaged app (e.g. https://your-backend.example): "
  read GLYTH_API_BASE
fi
GLYTH_API_BASE="$GLYTH_API_BASE" node scripts/build-web.mjs

echo "==> Generating/syncing iOS project"
[ -d ios ] || npx cap add ios
npx cap sync ios

echo "==> Integrating Swift bridge into the App target sources"
mkdir -p ios/App/App/GlythNative
cp ios-native/GlythNative/*.swift ios/App/App/GlythNative/
cp ios-native/Glyth.entitlements ios/App/App/Glyth.entitlements
echo "Copied Swift sources + entitlements into ios/App/App/."

cat << 'NEXT'

MANUAL XCODE STEPS (one time, ~3 minutes — Xcode project membership cannot be scripted safely):
  1. Open ios/App/App.xcworkspace
  2. Drag the GlythNative folder (already inside ios/App/App/) into the App target,
     ticking "Add to target: App". The GlythNative plugin registers itself with Capacitor.
  3. Signing & Capabilities: set your Team, bundle id app.glyth.snapshot, then add:
     HealthKit (with Background Delivery), Push Notifications, Associated Domains
     (applinks:YOUR-DOMAIN). Point Code Signing Entitlements at Glyth.entitlements if Xcode asks.
  4. Info.plist: merge the keys from ios-native/Info-additions.plist
     (Health/Calendar purpose strings, BGTask id, glyth URL scheme).
  5. Build & run on a PHYSICAL iPhone. HealthKit truth only exists there.

Then validate in-app: Settings -> Integrations -> Connect Apple Health ->
sync -> Today. And Settings -> Account for sign-in cold-restart persistence.
NEXT
echo "==> Opening Xcode workspace"
npx cap open ios || open ios/App/App.xcworkspace
