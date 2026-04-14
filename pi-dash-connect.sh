#!/usr/bin/env bash
# pi-dash-connect — Mac-side launcher for Pi Dashboard
# Handles SSH tunnel setup and opens the dashboard.
#
# Usage:
#   ./pi-dash-connect.sh                  # auto-detect host
#   ./pi-dash-connect.sh my-host.example.com  # explicit host
#   PI_DASH_HOST=my-host PI_DASH_PORT=7777 ./pi-dash-connect.sh
#
# Install as a macOS app:
#   1. Copy this script somewhere permanent (e.g. ~/bin/pi-dash-connect.sh)
#   2. chmod +x ~/bin/pi-dash-connect.sh
#   3. Install the PWA from Chrome (⋮ → Install Pi Dashboard)
#   4. Or create an Automator app that runs this script

set -euo pipefail

# ── Config ──
HOST="${PI_DASH_HOST:-${1:-your-remote-host}}"
REMOTE_PORT="${PI_DASH_REMOTE_PORT:-7777}"
LOCAL_PORT="${PI_DASH_PORT:-7777}"
SSH_USER="${PI_DASH_USER:-${USER:-user}}"
TUNNEL_CHECK_INTERVAL=30

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${BLUE}[pi-dash]${NC} $*"; }
ok()   { echo -e "${GREEN}[pi-dash]${NC} $*"; }
warn() { echo -e "${YELLOW}[pi-dash]${NC} $*"; }
err()  { echo -e "${RED}[pi-dash]${NC} $*"; }

# ── Auth check (optional — runs if auth tool is available) ──
check_local_auth() {
  # Override with PI_DASH_AUTH_CMD if you have a custom auth tool
  local auth_cmd="${PI_DASH_AUTH_CMD:-}"
  if [ -n "$auth_cmd" ]; then
    log "Running local auth: $auth_cmd"
    if eval "$auth_cmd"; then
      ok "Local auth refreshed"
    else
      warn "Local auth failed — SSH may not work"
      return 1
    fi
  fi
  return 0
}

# ── SSH tunnel ──
is_tunnel_alive() {
  # Check if something is listening on the local port
  if lsof -i ":${LOCAL_PORT}" -sTCP:LISTEN &>/dev/null 2>&1; then
    # Verify it's actually our SSH tunnel
    if lsof -i ":${LOCAL_PORT}" -sTCP:LISTEN 2>/dev/null | grep -q ssh; then
      return 0
    fi
    # Something else is on the port
    warn "Port ${LOCAL_PORT} in use by another process"
    return 1
  fi
  return 1
}

kill_stale_tunnel() {
  local pids
  pids=$(lsof -i ":${LOCAL_PORT}" -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$pids" ]; then
    log "Killing stale tunnel (PIDs: $pids)"
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
  fi
}

start_tunnel() {
  log "Opening SSH tunnel ${LOCAL_PORT} → ${HOST}:${REMOTE_PORT}..."
  ssh -f -N -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}" \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=accept-new \
    "${SSH_USER}@${HOST}" 2>/dev/null

  if [ $? -eq 0 ]; then
    ok "SSH tunnel established"
    return 0
  else
    err "SSH tunnel failed"
    return 1
  fi
}

ensure_tunnel() {
  if is_tunnel_alive; then
    ok "SSH tunnel already active on port ${LOCAL_PORT}"
    return 0
  fi
  kill_stale_tunnel
  start_tunnel
}

# ── Remote auth (optional) ──
check_remote_auth() {
  local auth_cmd="${PI_DASH_REMOTE_AUTH_CMD:-}"
  if [ -n "$auth_cmd" ]; then
    log "Running remote auth on ${HOST}..."
    if ssh -o ConnectTimeout=5 "${SSH_USER}@${HOST}" "$auth_cmd" 2>/dev/null; then
      ok "Remote auth refreshed"
    else
      warn "Remote auth failed — some features may not work"
    fi
  fi
}

# ── Dashboard health ──
check_dashboard() {
  if curl -sf "http://localhost:${LOCAL_PORT}/api/status" &>/dev/null; then
    ok "Dashboard reachable at http://localhost:${LOCAL_PORT}"
    return 0
  fi
  err "Dashboard not responding — is it running on ${HOST}?"
  return 1
}

# ── Open browser/PWA ──
open_dashboard() {
  local url="http://localhost:${LOCAL_PORT}"
  if [ "$(uname)" = "Darwin" ]; then
    # Try to open the installed PWA first, fall back to browser
    open "$url" 2>/dev/null || true
  else
    xdg-open "$url" 2>/dev/null || true
  fi
}

# ── Watchdog ──
watchdog() {
  log "Starting tunnel watchdog (checking every ${TUNNEL_CHECK_INTERVAL}s)..."
  while true; do
    sleep "$TUNNEL_CHECK_INTERVAL"
    if ! is_tunnel_alive; then
      warn "Tunnel died — reconnecting..."
      check_local_auth || true
      start_tunnel || true
    fi
  done
}

# ── Main ──
main() {
  echo ""
  echo -e "${BLUE}🥧 Pi Dashboard Connect${NC}"
  echo -e "   Host: ${HOST}"
  echo -e "   Port: ${LOCAL_PORT} → ${REMOTE_PORT}"
  echo ""

  # Step 1: Local auth (if configured)
  check_local_auth || true

  # Step 2: SSH tunnel
  if ! ensure_tunnel; then
    err "Cannot establish SSH tunnel. Check your network and SSH config."
    exit 1
  fi

  # Step 3: Remote auth (if configured, best-effort)
  check_remote_auth || true

  # Step 4: Verify dashboard
  sleep 1
  if check_dashboard; then
    echo ""
    ok "🥧 Pi Dashboard ready at http://localhost:${LOCAL_PORT}"
    echo ""
    open_dashboard
  else
    warn "Dashboard not responding yet — it may need to be started on the host"
    echo ""
    echo "  Start it with:  ssh ${SSH_USER}@${HOST} 'tmux new-session -d -s pi-dash \"cd ~/pi-dashboard && node backend/server.js\"'"
    echo ""
    open_dashboard
  fi

  # Step 5: Watchdog (keeps tunnel alive)
  watchdog
}

# Handle Ctrl+C gracefully
trap 'echo ""; log "Shutting down..."; kill_stale_tunnel; exit 0' INT TERM

main "$@"
