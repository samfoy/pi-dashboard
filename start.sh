#!/usr/bin/env bash
set -euo pipefail

# Source user env vars (DAILY_LOG_DIR, etc.) — launchd doesn't source .zshenv
[[ -f ~/.zshenv ]] && source ~/.zshenv

cd "$(dirname "$0")"

# Kill anything holding our port before starting
fuser -k 7777/tcp 2>/dev/null && sleep 0.5 || true

# Ensure node-pty spawn-helper is executable (npm install strips +x)
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null || true

echo "[pi-dashboard] Starting server ($(date))"
exec npx tsx backend/server.js
