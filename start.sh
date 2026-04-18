#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Kill anything holding our port before starting
fuser -k 7777/tcp 2>/dev/null && sleep 0.5 || true

echo "[pi-dashboard] Starting server ($(date))"
exec node backend/server.js
