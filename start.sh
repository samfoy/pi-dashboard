#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Kill anything holding our port before starting
fuser -k 7777/tcp 2>/dev/null && sleep 0.5 || true

# Ensure node-pty spawn-helper is executable (npm install strips +x)
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null || true

echo "[pi-dashboard] Starting server ($(date))"
exec node backend/server.js
