#!/usr/bin/env bash
# deploy.sh — build and install PiDash over the air (Tailscale or local Wi-Fi)
#
# ONE-TIME SETUP (USB required, once only):
#   1. Connect iPhone via USB
#   2. Open Xcode → Window → Devices and Simulators
#   3. Select "iPhone 15 Pro Max" → check "Connect via network"
#   4. Disconnect USB — all future deploys work wirelessly over Tailscale
#
# Usage:
#   ./deploy.sh            — build frontend + iOS app, install, restart server
#   ./deploy.sh --app-only — skip frontend build
#   ./deploy.sh --no-run   — build + install but don't restart server

set -euo pipefail
cd "$(dirname "$0")"

PROJ=apple/PiDash/PiDash.xcodeproj
DERIVED=apple/PiDash/build/DerivedData
APP="$DERIVED/Build/Products/Debug-iphoneos/PiDash.app"
DEVICE=BAD79ED2-90E2-574B-9EB5-7C932C76218F

APP_ONLY=0
NO_RUN=0
for arg in "$@"; do
  case $arg in
    --app-only) APP_ONLY=1 ;;
    --no-run)   NO_RUN=1 ;;
  esac
done

# ── 1. Frontend ──────────────────────────────────────────────────────────────
if [[ $APP_ONLY -eq 0 ]]; then
  echo "▶ Building frontend…"
  (cd frontend && npm run build)
  echo "  ✓ Frontend built"
fi

# ── 2. iOS app ───────────────────────────────────────────────────────────────
echo "▶ Building iOS app…"
xcodebuild build \
  -project "$PROJ" \
  -scheme PiDash \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  -quiet
echo "  ✓ iOS app built"

# ── 3. Install ───────────────────────────────────────────────────────────────
echo "▶ Installing on device…"
xcrun devicectl device install app \
  --device "$DEVICE" \
  "$APP"
echo "  ✓ Installed"

# ── 4. Restart server ────────────────────────────────────────────────────────
if [[ $NO_RUN -eq 0 ]]; then
  echo "▶ Restarting dashboard…"
  ./restart.sh
  echo "  ✓ Server restarted"
fi

echo ""
echo "✅ Done — reload the app"
