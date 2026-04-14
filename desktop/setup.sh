#!/usr/bin/env bash
# Pi Dashboard Desktop — Mac setup
# Run this on your Mac to install the desktop app.
#
# Prerequisites: Node.js 18+ (brew install node)
#
# Usage:
#   # Copy the desktop/ folder to your Mac, then:
#   cd desktop
#   ./setup.sh
#
#   # Or one-liner from the dev desktop:
#   scp -r user@your-remote-host:~/pi-dashboard/desktop /tmp/pi-dash-desktop
#   cd /tmp/pi-dash-desktop && ./setup.sh

set -euo pipefail

BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${BLUE}[setup]${NC} $*"; }
ok()  { echo -e "${GREEN}[setup]${NC} $*"; }

echo ""
echo "🥧 Pi Dashboard Desktop Setup"
echo ""

# Check Node
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install with: brew install node"
  exit 1
fi
log "Node $(node -v)"

# Check npm
if ! command -v npm &>/dev/null; then
  echo "❌ npm not found"
  exit 1
fi

# Install deps
log "Installing dependencies…"
npm install --no-audit --no-fund 2>&1 | tail -3

# Generate icns from png (macOS only)
if [ "$(uname)" = "Darwin" ] && [ -f icon.png ]; then
  log "Generating macOS icon…"
  mkdir -p icon.iconset
  sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png      2>/dev/null
  sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png   2>/dev/null
  sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png      2>/dev/null
  sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png   2>/dev/null
  sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png    2>/dev/null
  sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png 2>/dev/null
  sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png    2>/dev/null
  sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png 2>/dev/null
  sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png    2>/dev/null
  cp icon.png icon.iconset/icon_512x512@2x.png
  iconutil -c icns icon.iconset 2>/dev/null && ok "icon.icns created"
  rm -rf icon.iconset
fi

echo ""
ok "Setup complete!"
echo ""
echo "  Run:    npm start"
echo "  Build:  npm run build    (creates .app bundle in dist/)"
echo ""

# Offer to run
read -p "Start Pi Dashboard now? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  npm start
fi
