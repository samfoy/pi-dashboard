#!/usr/bin/env bash
# Restart the pi-dashboard service.
# Detects macOS (launchd) vs Linux (systemd) and dispatches accordingly.
# Rebuilds frontend first if --build flag is passed.
#
# NOTE (SDK-migration slice 8): this script does NOT launch node directly — it
# delegates to launchctl kickstart / systemctl restart, which re-invoke the
# plist (→ start.sh) / systemd unit (→ node). The WASM blast-radius V8 flags
# (--no-wasm-tier-up --liftoff-only --wasm-lazy-compilation) live in those launch
# targets (start.sh / pi-dashboard.service / run.sh), so a restart re-applies
# them. The server logs the effective V8 flags on boot for verification.
set -e
cd "$(dirname "$0")"

if [[ "$1" == "--build" ]]; then
  echo "Building frontend..."
  cd frontend && npx vite build && cd ..
fi

# Kill any stale tmux pi-dash session that might conflict
tmux kill-session -t pi-dash 2>/dev/null && echo "Killed stale tmux pi-dash session"

case "$(uname -s)" in
  Darwin)
    LABEL="com.sam.pi-dashboard"
    DOMAIN="gui/$(id -u)"
    echo "Restarting pi-dashboard launchd service ($LABEL)..."
    # kickstart -k stops then restarts; works even if the job was idle
    launchctl kickstart -k "$DOMAIN/$LABEL"
    sleep 2
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E 'state|pid|last exit' | head -5 || true
    ;;
  Linux)
    echo "Restarting pi-dashboard systemd service..."
    sudo systemctl restart pi-dashboard
    sleep 2
    sudo systemctl status pi-dashboard --no-pager | head -10
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac
