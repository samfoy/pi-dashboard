#!/usr/bin/env bash
set -euo pipefail

# Source user env vars (DAILY_LOG_DIR, etc.) — launchd doesn't source .zshenv
[[ -f ~/.zshenv ]] && source ~/.zshenv

cd "$(dirname "$0")"

# bedrock-mantle proxy capture: durable log + empty-completion variant dumps.
# Spawned pi slots inherit these via pi-manager's `...process.env`. The
# no_terminal / non_sse dumps fire at default log level (no debug needed).
export BEDROCK_MANTLE_LOG_FILE="${BEDROCK_MANTLE_LOG_FILE:-$HOME/.pi/logs/bedrock-mantle.log}"
export BEDROCK_MANTLE_EMPTY_DUMP_DIR="${BEDROCK_MANTLE_EMPTY_DUMP_DIR:-$HOME/Library/Logs/pi-dashboard/empty-dumps}"

# Kill anything holding our port before starting
fuser -k 7777/tcp 2>/dev/null && sleep 0.5 || true

# Ensure node-pty spawn-helper is executable (npm install strips +x)
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null || true

echo "[pi-dashboard] Starting server ($(date))"
# WASM blast-radius flags (SDK-migration slice 8): launch-time V8 isolate flags
# applied to the SERVER process (can't be applied to a live in-process agent).
# Server logs the effective V8 flags on boot for verification.
exec npx tsx --no-wasm-tier-up --liftoff-only --wasm-lazy-compilation backend/server.js
