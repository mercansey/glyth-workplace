#!/bin/zsh
# Local iOS build (run in Terminal, outside any sandbox): sync + workspace build.
cd "$(dirname "$0")/.."
LOG="build-ios.log"
{
  echo "== Glyth iOS build $(date) =="
  echo "-- node/npm --"; node --version; npm --version
  echo "-- build web --"; npm run build:web
  echo "-- cap sync ios --"; npx cap sync ios
  echo "-- xcodebuild (generic iOS, no signing) --"
  xcodebuild -workspace ios/App/App.xcworkspace -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
  echo "-- exit: $? =="
} 2>&1 | tee "$LOG"
echo ""
echo "Log saved to $LOG — you can close this window."
