# Pi Dashboard

A web and iOS dashboard for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent). Chat with pi, manage multiple sessions, browse files, and run terminals — from your browser or iPhone.

![Pi Dashboard](https://img.shields.io/badge/status-alpha-orange)

## Features

### Chat
- **Multi-slot sessions** — run multiple pi conversations, each with its own working directory, model, and history
- **Streaming responses** — real-time token streaming with thinking blocks, tool calls, and inline images
- **Slash commands** — `/clear`, `/compact`, `/import`, and custom commands from pi extensions
- **Fork & resume** — fork a conversation at any point, or resume past sessions
- **Context usage** — live token/context tracking per session

### Files & Editing
- **File browser** — directory tree navigation with workspace picker
- **Document panel** — syntax-highlighted code viewer, markdown preview, PDF/XLSX rendering
- **Inline comments** — comment on line ranges, review and send feedback to the agent
- **Diff view** — word-level diff highlighting with accept/reject

### Terminal & Monitoring
- **Integrated terminal** — full PTY terminal via xterm.js and node-pty
- **Background processes** — live status cards for subagents and long-running tasks
- **System monitor** — CPU, memory, disk, and process stats
- **Streaming logs** — real-time pi internal log viewer

### iOS App
- **Native SwiftUI** — full chat interface with markdown rendering, thinking blocks, and tool call display
- **Session list** — browse, search, and manage all chat slots
- **Push notifications** — get notified when pi needs approval or finishes a task
- **Siri Shortcuts** — "Ask Pi", "Send to Pi", "Check Pi Status", "Get Active Chats"
- **Session history** — browse and resume past sessions
- **Project picker** — switch working directories per session

### Desktop App (Optional)
- **Electron wrapper** — native window with system tray
- **SSH tunnel management** — automatic tunnel setup for remote servers

## Quick Start

```bash
git clone https://github.com/samfoy/pi-dashboard.git
cd pi-dashboard
npm run setup    # installs deps + builds frontend
npm start        # starts server with auto-restart
```

Open http://localhost:7777.

### Requirements

- Node.js 18+
- [pi](https://github.com/mariozechner/pi-coding-agent) installed and on PATH

### Run as a Service (macOS)

```bash
./ctl.sh install   # installs launchd plist, starts on boot
./ctl.sh start     # start the service
./ctl.sh stop      # stop the service
./ctl.sh restart   # restart
./ctl.sh status    # check status
./ctl.sh logs      # tail stdout/stderr
```

Logs: `~/Library/Logs/pi-dashboard/stdout.log` and `stderr.log`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_DASH_PORT` | `7777` | Server port |

## Architecture

```
pi-dashboard/
├── backend/
│   ├── server.js          # Express + WebSocket server, chat routing, file/doc APIs
│   ├── pi-manager.js      # Spawns pi --mode rpc processes, one per chat slot
│   ├── pty-manager.js     # Terminal sessions via node-pty
│   ├── pi-env.js          # Pi environment detection (extensions, models, memory stats)
│   └── session-store.js   # Slot state persistence, session JSONL parsing
├── frontend/              # React + TypeScript + Tailwind + Vite
│   └── src/
│       ├── pages/         # ChatPage, ChatSidebar, TerminalPage, LogsPage, SettingsPage, SystemPage
│       ├── components/    # MarkdownPanel, DiffView, FileBrowser, InlineComments, WelcomeView
│       └── store/         # Redux slices (chat, dashboard, settings, notifications)
├── ios/PiDash/            # Native iOS app (SwiftUI)
│   └── PiDash/
│       ├── Views/         # Chat, SlotList, Settings, Common
│       ├── ViewModels/    # ChatViewModel, SlotListViewModel
│       ├── Intents/       # Siri Shortcuts (AskPi, SendToPi, CheckStatus, GetActiveChats)
│       └── Networking/    # API client
├── desktop/               # Optional Electron wrapper
├── run.sh                 # Auto-restart wrapper
├── start.sh               # Startup script (used by launchd)
├── restart.sh             # Graceful restart via SIGUSR2
├── ctl.sh                 # Service management (install/start/stop/restart/logs)
└── pi-dash-connect.sh     # SSH tunnel helper for remote access
```

The backend spawns pi as a child process using JSON-RPC mode (`pi --mode rpc`), one per chat slot. The React frontend and iOS app connect via WebSocket for real-time streaming. Slot metadata is persisted to `~/.pi/agent/pi-web-sessions.json`; message history lives in pi's session files and is loaded on demand.

Idle pi processes are automatically reaped after 30 minutes and restart transparently on the next message.

## Remote Access

### Tailscale (recommended)

If both machines are on the same Tailscale network, just hit the Tailscale IP directly:

```
http://<tailscale-ip>:7777
```

### SSH Tunnel

```bash
PI_DASH_HOST=your-server PI_DASH_USER=you ./pi-dash-connect.sh
```

Or manually:

```bash
ssh -f -N -L 7777:localhost:7777 user@your-remote-host
open http://localhost:7777
```

## iOS App

The iOS app lives in `ios/PiDash/`. Open `PiDash.xcodeproj` in Xcode and build for your device.

Configure the server URL in the app's settings. Supports both local network and Tailscale connections.

Features: full chat with markdown/code rendering, thinking block expansion, tool call details, session management, push notifications for approval requests, and Siri Shortcuts for hands-free interaction.

## License

MIT
