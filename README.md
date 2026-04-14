# Pi Dashboard

A web-based dashboard for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent). Chat with pi, manage multiple sessions, browse files, edit documents with inline comments, and monitor background processes — all from your browser.

![Pi Dashboard](https://img.shields.io/badge/status-alpha-orange)

## Features

- **Multi-slot chat** — run multiple pi sessions side by side, each with its own working directory and model
- **File browser & editor** — browse directories, open files in a side panel, edit with syntax highlighting and markdown preview
- **Doc collaboration** — inline comments on line ranges, version tracking, diff view with word-level highlighting, and a "Review Comments" button that sends feedback to the agent
- **Terminal** — integrated terminal via node-pty
- **Background processes** — monitor subagents and long-running processes with live status cards
- **Slash commands** — `/clear`, `/compact`, `/import`, and custom commands from pi extensions
- **Settings** — configure models, providers, system prompts, and agent instructions per session
- **Logs** — real-time streaming of pi's internal logs
- **Desktop app** — optional Electron wrapper with SSH tunnel management and system tray (see `desktop/`)

## Quick Start

```bash
git clone https://github.com/samfoy/pi-dashboard.git
cd pi-dashboard
npm run setup    # installs deps + builds frontend
node backend/server.js
```

Open http://localhost:7777 in your browser.

### Requirements

- Node.js 18+
- [pi](https://github.com/mariozechner/pi-coding-agent) installed and on PATH

### Optional: Pi Extensions

Some dashboard features require pi extensions to be installed:

- **Background processes** (ProcessCard) — requires the [pi-processes](https://github.com/aliou/pi-processes) extension
- **Subagents** (SubagentCard) — requires the subagent extension from [pi-essentials](https://github.com/samfoy/pi-essentials)
- **Slash commands** — auto-discovered from pi extensions and prompt templates

Without these, the core chat, file browser, terminal, and doc collaboration features work normally.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_DASH_PORT` | `7777` | Server port |
| `WORKSPACE_DIR` | — | Directory to list in workspace picker |

## Architecture

```
pi-dashboard/
├── backend/
│   ├── server.js        # Express + WebSocket server
│   ├── pi-manager.js    # Spawns and manages pi processes via JSON-RPC
│   ├── pty-manager.js   # Terminal sessions via node-pty
│   ├── pi-env.js        # Pi environment detection (extensions, models, sessions)
│   └── session-store.js # Session persistence and history
├── frontend/            # React + TypeScript + Tailwind + Vite
│   └── src/
│       ├── pages/       # ChatPage, TerminalPage, LogsPage, SettingsPage, SystemPage
│       ├── components/  # MarkdownPanel, DiffView, FileBrowser, InlineComments, etc.
│       ├── store/       # Redux slices (chat, dashboard, settings)
│       └── api/         # API client
├── bin/
│   ├── dash-spawn       # CLI: spawn a pi session and send it a prompt
│   └── dash-slot        # CLI: interact with a running session
├── desktop/             # Optional Electron wrapper
└── pi-dash-connect.sh   # SSH tunnel helper for remote access
```

The backend spawns pi as a child process using its JSON-RPC mode (`pi --rpc`), bridging messages between the React frontend (via WebSocket) and pi. Each chat "slot" is an independent pi instance with its own working directory, model, and conversation history.

## Remote Access

If pi-dashboard runs on a remote server, use the connect script to set up an SSH tunnel:

```bash
PI_DASH_HOST=your-server PI_DASH_USER=you ./pi-dash-connect.sh
```

Or manually:

```bash
ssh -f -N -L 7777:localhost:7777 user@your-remote-host
open http://localhost:7777
```

## CLI Tools

**dash-spawn** — create a session and send a prompt:

```bash
bin/dash-spawn --name "my-task" --cwd /path/to/project "Refactor the auth module"
# Returns the slot key
```

**dash-slot** — interact with a running session:

```bash
bin/dash-slot <key> send "Add error handling"
bin/dash-slot <key> status
bin/dash-slot <key> messages 20
bin/dash-slot <key> stop
```

## Auto-Restart

Use `run.sh` for auto-restart on crash, or send `SIGUSR2` for graceful restart:

```bash
./run.sh                    # auto-restarts on crash
kill -USR2 <run.sh-pid>     # graceful restart
./restart.sh                # finds run.sh in tmux and signals it
./restart.sh --build        # rebuild frontend first, then restart
```

## Desktop App (Optional)

The `desktop/` directory contains an Electron wrapper that provides a native window with system tray integration. It handles SSH tunnel management automatically for remote servers, or connects directly when running locally.

```bash
cd desktop
npm install
npm start
```

Configure via the tray menu or edit `~/.config/pi-dashboard-desktop/config.json`:
- `host` — `localhost` for local, or your remote hostname
- `user` — SSH username (for remote)
- `localPort` / `remotePort` — defaults to 7777

## License

MIT
