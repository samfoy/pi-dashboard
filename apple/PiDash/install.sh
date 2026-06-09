#!/bin/bash
set -e
DEVICE_ID="BAD79ED2-90E2-574B-9EB5-7C932C76218F"
SCHEME="PiDash"
CONFIG="${1:-Debug}"

echo "📱 Building $SCHEME ($CONFIG)..."
xcodebuild build \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "generic/platform=iOS" \
  2>&1 | grep -E "error:|warning: All|BUILD SUCCEEDED|BUILD FAILED"

APP_PATH=$(ls -td ~/Library/Developer/Xcode/DerivedData/PiDash-*/Build/Products/${CONFIG}-iphoneos/PiDash.app | head -1)
echo "📲 Installing $APP_PATH..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
echo "✅ Done"
