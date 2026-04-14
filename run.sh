#!/usr/bin/env bash
# Auto-restart wrapper for pi-dashboard server.
# Send SIGUSR2 to this script to trigger a graceful restart.
# Or just: tmux send-keys -t pi-dash C-c && tmux send-keys -t pi-dash './run.sh' Enter
cd "$(dirname "$0")"

pid=
restart=true
trap 'restart=true; kill $pid 2>/dev/null; wait $pid 2>/dev/null' SIGUSR2
trap 'restart=false; kill $pid 2>/dev/null; exit 0' SIGINT SIGTERM

while $restart; do
  restart=false
  # Kill anything holding our port before starting
  fuser -k 7777/tcp 2>/dev/null && sleep 0.5
  echo "▶ Starting pi-dashboard server ($(date))"
  node backend/server.js &
  pid=$!
  wait $pid
  code=$?
  echo "■ Server exited with code $code ($(date))"
  if ! $restart; then
    # Crashed — auto-restart after brief pause
    if [ $code -ne 0 ]; then
      echo "  Restarting in 2s..."
      restart=true
      sleep 2
    fi
  else
    echo "  Restart requested..."
    sleep 1
  fi
done
