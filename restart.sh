#!/usr/bin/env bash
# Restart the pi-dashboard server running in tmux.
# Rebuilds frontend first if --build flag is passed.
set -e
cd "$(dirname "$0")"

if [[ "$1" == "--build" ]]; then
  echo "Building frontend..."
  cd frontend && npx vite build && cd ..
fi

# Find the run.sh wrapper PID in tmux (look for bash pane, not python3 pane-tree)
pid=$(tmux list-panes -t pi-dash -F '#{pane_pid} #{pane_current_command}' 2>/dev/null | grep bash | head -1 | awk '{print $1}')
if [ -n "$pid" ]; then
  kill -USR2 "$pid" 2>/dev/null && echo "Restart signal sent." && exit 0
fi

# Fallback: kill and relaunch in tmux
echo "No run.sh wrapper found, relaunching tmux session..."
tmux kill-session -t pi-dash 2>/dev/null || true
tmux new-session -d -s pi-dash -x 200 -y 50 "cd ~/pi-dashboard && ./run.sh"
echo "Server started in tmux session 'pi-dash'."
