#!/usr/bin/env bash
# Direct server launch — used by systemd ExecStart.
# For restarts, use: ./restart.sh or sudo systemctl restart pi-dashboard
cd "$(dirname "$0")"
exec tsx backend/server.ts
