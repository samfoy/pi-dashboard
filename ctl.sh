#!/usr/bin/env bash
set -euo pipefail

LABEL="com.sam.pi-dashboard"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/com.sam.pi-dashboard.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/pi-dashboard"

install() {
  mkdir -p "$LOG_DIR"
  mkdir -p "$HOME/Library/LaunchAgents"
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  cp "$PLIST_SRC" "$PLIST_DST"
  launchctl load "$PLIST_DST"
  echo "Installed and started."
}

uninstall() {
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  rm -f "$PLIST_DST"
  echo "Uninstalled."
}

start() {
  mkdir -p "$LOG_DIR"
  if [[ ! -f "$PLIST_DST" ]]; then
    cp "$PLIST_SRC" "$PLIST_DST"
  fi
  launchctl load "$PLIST_DST" 2>/dev/null || true
  echo "Started."
}

stop() {
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  echo "Stopped."
}

restart() {
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  sleep 1
  cp "$PLIST_SRC" "$PLIST_DST"
  launchctl load "$PLIST_DST"
  echo "Restarted."
}

status() {
  local info
  if ! info=$(launchctl list "$LABEL" 2>/dev/null); then
    echo "Not loaded"
    return 1
  fi
  local pid
  pid=$(echo "$info" | grep '"PID"' | awk '{print $3}' | tr -d ';')
  if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]]; then
    echo "Running (PID $pid)"
  else
    local exit_code
    exit_code=$(echo "$info" | grep 'LastExitStatus' | awk '{print $3}' | tr -d ';')
    echo "Loaded but not running (last exit: ${exit_code:-unknown})"
  fi
}

logs() {
  tail -f "$LOG_DIR/stdout.log" "$LOG_DIR/stderr.log"
}

case "${1:-help}" in
  install)   install ;;
  uninstall) uninstall ;;
  start)     start ;;
  stop)      stop ;;
  restart)   restart ;;
  status)    status ;;
  logs)      logs ;;
  *)
    echo "Usage: $0 {install|uninstall|start|stop|restart|status|logs}"
    exit 1
    ;;
esac
