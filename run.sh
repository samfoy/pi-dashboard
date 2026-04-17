#!/usr/bin/env bash
# Auto-restart wrapper for pi-dashboard server.
# Send SIGUSR2 to this script to trigger a graceful restart.
# Or just: tmux send-keys -t pi-dash C-c && tmux send-keys -t pi-dash './run.sh' Enter
cd "$(dirname "$0")"

pid=
restart=true
trap 'restart=true; kill $pid 2>/dev/null; wait $pid 2>/dev/null' SIGUSR2
trap 'restart=false; kill $pid 2>/dev/null; exit 0' SIGINT SIGTERM

while true; do
  # Kill anything holding our port before starting
  fuser -k 7777/tcp 2>/dev/null && sleep 0.5
  echo "▶ Starting pi-dashboard server ($(date))"
  node backend/server.js
  code=$?
  echo "■ Server exited with code $code ($(date))"
  echo "  Restarting in 2s..."
  sleep 2
done
