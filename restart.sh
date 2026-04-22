#!/usr/bin/env bash
# Restart the pi-dashboard systemd service.
# Rebuilds frontend first if --build flag is passed.
set -e
cd "$(dirname "$0")"

if [[ "$1" == "--build" ]]; then
  echo "Building frontend..."
  cd frontend && npx vite build && cd ..
fi

# Kill any stale tmux pi-dash session that might conflict
tmux kill-session -t pi-dash 2>/dev/null && echo "Killed stale tmux pi-dash session"

echo "Restarting pi-dashboard systemd service..."
sudo systemctl restart pi-dashboard
sleep 2
sudo systemctl status pi-dashboard --no-pager | head -10
