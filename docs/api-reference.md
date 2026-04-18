# Pi Dashboard — API Reference

> **Server:** Express + WebSocket on port `PI_DASH_PORT` (default `7777`)
> **Auth:** None — the server binds to `0.0.0.0` with no authentication or special headers required.

---

## Table of Contents

- [REST API](#rest-api)
  - [Dashboard & System](#dashboard--system)
  - [Chat Slots](#chat-slots)
  - [Chat Messaging](#chat-messaging)
  - [Session History](#session-history)
  - [Notifications](#notifications)
  - [Models](#models)
  - [Skills](#skills)
  - [Pi Agent Files](#pi-agent-files)
  - [Pi Environment](#pi-environment)
  - [Memory](#memory)
  - [File I/O & Document Collaboration](#file-io--document-collaboration)
  - [File Comments](#file-comments)
  - [File Browser & Path Completion](#file-browser--path-completion)
  - [Workspaces](#workspaces)
  - [Package Management & Gallery](#package-management--gallery)
  - [Pi Settings](#pi-settings)
  - [Host Sessions (tmux)](#host-sessions-tmux)
  - [Slash Commands](#slash-commands)
  - [Stubs & Placeholders](#stubs--placeholders)
- [WebSocket API](#websocket-api)
  - [Connection](#connection)
  - [Client → Server Messages](#client--server-messages)
  - [Server → Client Messages](#server--client-messages)
  - [Streaming Lifecycle](#streaming-lifecycle)
- [Slot Lifecycle](#slot-lifecycle)
- [Streaming Protocol](#streaming-protocol)
- [PTY Terminal WebSocket](#pty-terminal-websocket)

---

## REST API

All endpoints accept/return JSON unless noted. Request bodies use `Content-Type: application/json` (limit: 50MB).

---

### Dashboard & System

#### `GET /api/status`

Dashboard status summary.

**Response:**
```json
{
  "version": "1.0.0",
  "uptime": 3600,
  "sessions": 3,
  "messages": 142,
  "tool_calls": 28,
  "provider": "pi"
}
```

#### `GET /api/system`

Host system information (CPU, memory, disk, network, process stats).

**Response:**
```json
{
  "hostname": "macbook.local",
  "os": "Darwin 24.1.0",
  "arch": "arm64",
  "cpu_count": 10,
  "cpu_pct": 12.5,
  "load_1m": "1.23",
  "load_5m": "1.45",
  "load_15m": "1.67",
  "mem_total_gb": "32.0",
  "mem_used_gb": "18.5",
  "mem_free_gb": "13.5",
  "disk_total_gb": 500,
  "disk_free_gb": 200,
  "ip": "192.168.1.100",
  "pid": 12345,
  "python": "—",
  "proc_mem_mb": "120.5",
  "proc_cpu_pct": null,
  "child_processes": "3",
  "thread_count": "12",
  "cwd": "/Users/sam/pi-dashboard",
  "ollama_running": false,
  "net_rx_kbs": null,
  "net_tx_kbs": null
}
```

---

### Chat Slots

Slots are named chat sessions, each backed by a `pi --mode rpc` child process. Processes are **lazily started** on first message (via `ensureRunning`).

#### `GET /api/chat/slots`

List all slots.

**Response:**
```json
[
  {
    "key": "chat-1-1713400000000",
    "title": "My Chat",
    "messages": 12,
    "running": true,
    "stopping": false,
    "pending_approval": false,
    "model": "anthropic/claude-opus-4-6-1m",
    "cwd": "/Users/sam/project"
  }
]
```

#### `POST /api/chat/slots`

Create a new slot. Pi process is **not** started yet — deferred until first message.

**Request body:**
```json
{
  "name": "My Chat",          // optional, display title
  "agent": "default",         // optional, agent name
  "model": "anthropic/claude-opus-4-6-1m",  // optional, "provider/modelId"
  "cwd": "/Users/sam/project"  // optional, working directory
}
```

**Response:**
```json
{
  "key": "chat-1-1713400000000",
  "title": "My Chat",
  "messages": 0,
  "running": false
}
```

#### `GET /api/chat/slots/:key`

Get slot detail with message history.

**Query params:**
- `limit` — max messages to return (default: 200)

**Response:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello", "ts": "2026-04-17T10:00:00.000Z" },
    { "role": "assistant", "content": "Hi there!", "ts": "2026-04-17T10:00:01.000Z" },
    {
      "role": "tool", "content": "🔧 bash",
      "ts": "2026-04-17T10:00:02.000Z",
      "meta": {
        "toolName": "bash",
        "toolCallId": "tc_abc123",
        "args": "{\"command\": \"ls\"}",
        "result": "file1.txt\nfile2.txt",
        "isError": false
      }
    },
    { "role": "thinking", "content": "Let me analyze this...", "ts": "2026-04-17T10:00:03.000Z" }
  ],
  "running": true,
  "stopping": false,
  "pending_approval": false,
  "has_more": false,
  "total": 4,
  "model": "anthropic/claude-opus-4-6-1m",
  "cwd": "/Users/sam/project",
  "contextUsage": { "tokens": 5000, "contextWindow": 200000, "percent": 2.5 }
}
```

**Message roles:** `user`, `assistant`, `tool`, `thinking`, `system`

#### `DELETE /api/chat/slots/:key`

Delete a slot and kill its pi process.

**Response:** `{ "ok": true }`

#### `POST /api/chat/slots/:key/stop`

Abort the currently running agent turn (sends `abort` RPC to pi).

**Response:** `{ "ok": true }`

#### `PATCH /api/chat/slots/:key/title`

Rename a slot.

**Request body:** `{ "title": "New Title" }`

**Response:** `{ "ok": true }`
- Broadcasts `slot_title` and `slots` over WebSocket.

#### `POST /api/chat/slots/:key/generate-title`

Auto-generate a title from the first user message (truncated to 60 chars).

**Response:** `{ "ok": true, "title": "Generated Title..." }`

#### `POST /api/chat/slots/:key/model`

Set the model for a slot. If the pi process is running, switches model via RPC.

**Request body:**
```json
{ "provider": "anthropic", "modelId": "claude-opus-4-6-1m" }
```

**Response:** `{ "ok": true }`

#### `POST /api/chat/slots/:key/thinking`

Set the thinking/reasoning level for a slot.

**Request body:** `{ "level": "high" }`

**Response:** `{ "ok": true }`

#### `POST /api/chat/slots/:key/cwd`

Set the working directory for a slot. If the process is running with no messages, restarts it.

**Request body:** `{ "cwd": "/Users/sam/project" }`

**Response:** `{ "ok": true }`

#### `POST /api/chat/slots/:key/resume`

Resume a historical session into a new slot. Loads messages from the session JSONL file.

**Request body:**
```json
{
  "name": "Session Name",
  "title": "Session Title"
}
```

**Response:**
```json
{
  "ok": true,
  "key": "chat-2-1713400000000",
  "messages": [ ... ],
  "has_more": false,
  "total": 42
}
```

#### `GET /api/chat/slots/:key/tree`

Get the session tree structure (entries with parent/child relationships for fork visualization).

**Response:**
```json
{
  "entries": [
    {
      "id": "entry-abc",
      "parentId": "entry-xyz",
      "type": "message",
      "timestamp": "...",
      "role": "user",
      "text": "First 200 chars...",
      "fullText": "Full user message text",
      "tools": ["bash", "read"]
    }
  ],
  "leafId": "entry-abc"
}
```

Entry types: `message`, `branch_summary`, `compaction`, `model_change`, `custom_message`

#### `POST /api/chat/slots/:key/fork`

Fork from a specific entry in the session tree. Creates a **new slot** with the forked session.

**Request body:** `{ "entryId": "entry-abc" }`

**Response:**
```json
{
  "ok": true,
  "text": "Forked message text",
  "newSlotKey": "chat-3-1713400000000"
}
```

Or if cancelled: `{ "ok": false, "cancelled": true }`

#### `GET /api/chat/slots/:key/fork-messages`

Get the list of messages that can be forked from (user messages).

**Response:** Pi RPC response (passthrough).

---

### Chat Messaging

#### `POST /api/chat`

Send a message to a slot. Lazily starts the pi process if needed.

**Request body:**
```json
{
  "slot": "chat-1-1713400000000",
  "message": "Hello, help me with...",
  "images": [
    { "data": "<base64>", "mimeType": "image/png" }
  ]
}
```

- `images` is optional. Base64 images are saved to temp files and paths are appended to the message.
- The frontend adds the user message optimistically — the server does **not** broadcast it.
- Slash commands (e.g., `/compact`, `/new`, `/model`) are intercepted and mapped to RPC calls.

**Response:** `{ "ok": true }`

**Slash command → RPC mapping:**

| Slash Command | RPC Type | Notes |
|---|---|---|
| `/compact` | `compact` | Compact conversation context |
| `/new`, `/clear` | `new_session` | Start fresh session |
| `/fork` | `fork` | Fork from current point |
| `/export [path]` | `export_html` | Export session to HTML |
| `/name <text>` | `set_session_name` | Rename session |
| `/reload` | `reload` | Reload extensions/skills |
| `/session` | `get_session_stats` | Returns stats as message |
| `/copy` | `get_last_assistant_text` | Returns last text as message |
| `/usage` | `get_session_stats` | Returns usage stats |
| `/tools` | `get_commands` | Returns available commands |

#### `POST /api/chat/mode`

Approval mode control (stub). Always returns `{ "ok": true }`.

---

### Session History

#### `GET /api/sessions`

List recent pi sessions from `~/.pi/agent/sessions/`.

**Query params:**
- `limit` — max sessions (default: 30)

**Response:**
```json
{
  "sessions": [
    {
      "key": "2026-04-17T10-00-00-000Z",
      "title": "Session title or first user message",
      "project": "Users/sam/project",
      "created": "2026-04-17T10:00:00.000Z",
      "modified": "2026-04-17T11:30:00.000Z",
      "size": 45678
    }
  ],
  "has_more": false
}
```

#### `DELETE /api/sessions/:key`

Stub — returns `{ "ok": true }`.

#### `DELETE /api/sessions`

Stub — returns `{ "ok": true }`.

---

### Notifications

In-memory notification store (max 200, not persisted across restarts).

#### `GET /api/notifications`

**Response:**
```json
{
  "notifications": [
    {
      "kind": "input_needed",
      "title": "Done (120s)",
      "body": "My Chat",
      "ts": "2026-04-17T10:00:00.000Z",
      "acked": false,
      "slot": "chat-1-..."
    }
  ]
}
```

**Notification kinds:**
- `input_needed` — agent turn completed after >60 seconds
- `tool_done` — a non-bash tool took >60 seconds to complete

#### `POST /api/notifications/ack`

**Request body:** `{ "ts": "2026-04-17T10:00:00.000Z" }`

#### `POST /api/notifications/unack`

**Request body:** `{ "ts": "2026-04-17T10:00:00.000Z" }`

#### `POST /api/notifications/ack-all`

Mark all notifications as acknowledged.

#### `POST /api/notifications/clear`

Remove all notifications.

#### `DELETE /api/notifications`

Remove all notifications (alias).

All return `{ "ok": true }`.

---

### Models

#### `GET /api/models`

Get available models (cached for 5 minutes). Queries a running pi process via RPC, or starts a temporary one.

**Response:**
```json
{
  "models": [
    {
      "provider": "anthropic",
      "modelId": "claude-opus-4-6-1m",
      "displayName": "Claude Opus"
    }
  ]
}
```

---

### Skills

#### `GET /api/skills`

List installed pi skills from `~/.pi/agent/skills/`.

**Response:**
```json
[
  { "name": "gmail", "description": "Read, search, send Gmail..." }
]
```

#### `GET /api/skills/:name/files`

List all files in a skill directory (recursive).

**Response:**
```json
{ "name": "gmail", "files": ["SKILL.md", "lib/helper.js"] }
```

#### `GET /api/skills/:name/file`

Read a file from a skill directory.

**Query params:** `path` — relative path within the skill dir (no `..` allowed)

**Response:** `{ "content": "file contents..." }`

#### `PUT /api/skills/:name/file`

Write a file in a skill directory.

**Request body:**
```json
{ "path": "SKILL.md", "content": "# My Skill\n..." }
```

**Response:** `{ "ok": true }`

---

### Pi Agent Files

Browse/read/write files under `~/.pi/agent/` (covers skills, extensions, prompts, AGENTS.md, settings.json).

#### `GET /api/pi/files`

List directory contents.

**Query params:** `dir` — subdirectory path (default: root of `~/.pi/agent/`)

**Response:**
```json
{
  "dir": "extensions",
  "entries": [
    { "name": "auto-session-name.ts", "isDir": false },
    { "name": "skills", "isDir": true }
  ]
}
```

Excludes: `.` files, `node_modules`, `sessions`, `sessions-archive`.

#### `GET /api/pi/file`

Read a file.

**Query params:** `path` — relative to `~/.pi/agent/` (no `..` allowed)

**Response:** `{ "content": "..." }`

#### `PUT /api/pi/file`

Write a file.

**Request body:** `{ "path": "extensions/my-ext.ts", "content": "..." }`

**Response:** `{ "ok": true }`

---

### Pi Environment

#### `GET /api/pi/extensions`

List installed extensions from `~/.pi/agent/extensions/`.

**Response:**
```json
[
  { "name": "auto-session-name", "file": "auto-session-name.ts", "description": "..." }
]
```

#### `GET /api/pi/vault`

Obsidian vault statistics.

**Response:**
```json
{
  "dailyNotes": 150,
  "taskNotes": 42,
  "meetingNotes": 8,
  "persons": 5,
  "recentDaily": "2026-04-17"
}
```

#### `GET /api/pi/vault/daily`

List recent daily notes.

**Query params:** `limit` (default: 7)

**Response:**
```json
[
  { "date": "2026-04-17", "size": 1234 }
]
```

#### `GET /api/pi/vault/daily/:date`

Read a specific daily note.

**Response:** `{ "date": "2026-04-17", "content": "# April 17..." }`

#### `GET /api/pi/crontab`

Parse user's crontab.

**Response:**
```json
[
  { "schedule": "0 5 * * *", "command": "pi run ...", "raw": "0 5 * * * pi run ..." }
]
```

#### `GET /api/pi/memory`

Combined memory view (stats, facts, lessons).

**Response:**
```json
{
  "stats": { "facts": 50, "lessons": 20, "events": 100, "episodic": 30 },
  "facts": [{ "key": "pref.editor", "value": "vim", "confidence": 1.0, "source": "user", "updated_at": "..." }],
  "lessons": [{ "id": 1, "rule": "Always use...", "category": "general", "negative": false, "created_at": "..." }]
}
```

#### `GET /api/crons`

Alias for `/api/pi/crontab`.

#### `GET /api/lessons`

List lessons from memory DB.

#### `GET /api/hooks`

Stub — returns `[]`.

---

### Memory

#### `GET /api/memory/preferences`

**Response:** `{ "content": "<JSON string of facts>" }`

#### `GET /api/memory/projects`

Stub — `{ "content": "" }`

#### `GET /api/memory/history`

Stub — `{ "content": "" }`

#### `GET /api/memory/settings`

Stub — `{}`

#### `GET /api/memory/stats`

**Response:** `{ "facts": 50, "lessons": 20, "events": 100, "episodic": 30 }`

#### `GET /api/memory/embedding-status`

Stub — `{ "enabled": false }`

#### `PUT /api/memory/preferences`

Stub — `{ "ok": true }`

#### `PUT /api/memory/projects`

Stub — `{ "ok": true }`

#### `PUT /api/memory/history`

Stub — `{ "ok": true }`

---

### File I/O & Document Collaboration

Server tracks file versions in memory (max 50 per file) and suppresses self-write notifications (500ms window).

#### `GET /api/file-read`

Read any file from disk.

**Query params:** `path` — absolute or `~/` prefixed path

**Response:** `text/plain` body with file content.

#### `POST /api/file-write`

Write a file (creates parent dirs). Tracks version.

**Request body:**
```json
{ "path": "~/project/file.txt", "content": "Hello" }
```

**Response:** `{ "ok": true, "version": 3 }`

#### `POST /api/save-image`

Save a base64-encoded image to disk.

**Request body:**
```json
{
  "data": "<base64>",
  "mimeType": "image/png",
  "path": "~/images/screenshot.png"
}
```

**Response:** `{ "ok": true, "path": "/Users/sam/images/screenshot.png" }`

#### `GET /api/file-versions`

List saved versions for a file.

**Query params:** `path`

**Response:**
```json
{
  "versions": [
    { "version": 1, "timestamp": "2026-04-17T10:00:00.000Z", "size": 1234 }
  ]
}
```

#### `GET /api/file-version`

Read a specific version of a file.

**Query params:** `path`, `version`

**Response:** `text/plain` body with version content.

#### `GET /api/local-file`

Serve any local file (images from tool results, etc.) for rendering in the frontend.

**Query params:** `path` — absolute, `~/`, or relative path

**Response:** The file content with appropriate MIME type (via `res.sendFile`).

---

### File Comments

Sidecar-based commenting system. Comments stored as `.<filename>.comments.json` alongside the original file.

#### `GET /api/file-comments`

**Query params:** `path`

**Response:** `{ "comments": [...] }`

#### `POST /api/file-comments`

**Request body:**
```json
{
  "path": "~/project/file.txt",
  "comments": [
    { "line": 10, "text": "This needs refactoring", "author": "sam", "ts": "..." }
  ]
}
```

**Response:** `{ "ok": true }`

---

### File Browser & Path Completion

#### `GET /api/browse`

Browse directory contents (for CWD picker / file tree).

**Query params:**
- `path` — directory to browse (default: `$HOME`)
- `hidden` — `"true"` to show hidden files
- `files` — `"true"` to include files (default: directories only)

**Response:**
```json
{
  "path": "/Users/sam",
  "parent": "/Users",
  "entries": [
    { "name": "project", "path": "/Users/sam/project", "isDir": true },
    { "name": "file.txt", "path": "/Users/sam/file.txt", "isDir": false }
  ]
}
```

#### `GET /api/path-complete`

Autocomplete a partial file/directory path.

**Query params:** `input` — partial path (supports `~`)

**Response:**
```json
{
  "dir": "/Users/sam",
  "prefix": "pro",
  "entries": [
    { "name": "project", "path": "/Users/sam/project", "isDir": true }
  ]
}
```

Max 30 entries returned.

---

### Workspaces

#### `GET /api/workspaces`

List workspace directories.

**Response:**
```json
{
  "workspaces": [
    { "name": "~", "path": "/Users/sam" },
    { "name": "pi-dashboard", "path": "/Users/sam/pi-dashboard" }
  ]
}
```

Also includes entries from `$WORKSPACE_DIR` if set.

---

### Package Management & Gallery

#### `POST /api/pi/packages/install`

Install a pi package (runs `pi install <source>`).

**Request body:** `{ "source": "npm-package-name" }`

**Response:** `{ "ok": true, "output": "..." }`

#### `POST /api/pi/packages/remove`

Remove a pi package (runs `pi remove <source>`).

**Request body:** `{ "source": "npm-package-name" }`

**Response:** `{ "ok": true, "output": "..." }`

#### `GET /api/pi/gallery`

Search npm registry for pi packages (keyword: `pi-package`).

**Response:**
```json
{
  "packages": [
    {
      "name": "@example/pi-ext",
      "description": "A pi extension",
      "version": "1.0.0",
      "author": "author",
      "date": "2026-04-01",
      "links": {}
    }
  ]
}
```

---

### Pi Settings

#### `GET /api/pi/settings`

Read `~/.pi/agent/settings.json`.

**Response:** The settings JSON object.

#### `PUT /api/pi/settings`

Write `~/.pi/agent/settings.json`.

**Request body:** The full settings object.

**Response:** `{ "ok": true }`

---

### Host Sessions (tmux)

#### `GET /api/host-sessions`

Scan tmux for running pi processes (excludes the `pi-dash` session itself).

**Response:**
```json
{
  "sessions": [
    {
      "tmuxSession": "main",
      "tmuxWindow": 0,
      "tmuxPane": 0,
      "pid": 12345,
      "cwd": "/Users/sam/project",
      "windowName": "pi",
      "size": "120x30",
      "model": "claude-opus-4-6-1m",
      "contextPct": "45%",
      "uptime": "2h30m",
      "lastOutput": "Last line of output...",
      "attachCmd": "tmux attach -t main",
      "sessionFile": "/Users/sam/.pi/agent/sessions/--Users-sam-project--/2026-04-17.jsonl"
    }
  ]
}
```

---

### Slash Commands

#### `GET /api/slash-commands`

Get available slash commands. First attempts RPC to a running pi process, then falls back to file scanning.

**Response:**
```json
[
  { "name": "/compact", "description": "Compact conversation to free context", "source": "builtin" },
  { "name": "/gmail", "description": "Read, search, send Gmail...", "source": "skill" },
  { "name": "/custom-cmd", "description": "From extension", "source": "extension" }
]
```

**Sources:** `builtin`, `extension`, `skill`

**Builtin commands:** `/clear`, `/compact`, `/model`, `/export`, `/copy`, `/name`, `/session`, `/fork`, `/new`, `/reload`, `/tools`, `/mcp`, `/usage`

---

### Stubs & Placeholders

These endpoints exist for frontend compatibility but return minimal/empty data:

| Endpoint | Response |
|---|---|
| `GET /api/agent/config` | `{}` |
| `PUT /api/agent/config` | `{ "ok": true }` |
| `GET /api/config/default-agent` | `{ "agent": "default" }` |
| `PUT /api/config/default-agent` | `{ "ok": true }` |
| `GET /api/agents/installed` | `[]` |
| `GET /api/mcp` | `[]` |
| `GET /api/mcp/active` | `[]` |
| `GET /api/mcp/probe` | `{ "results": {} }` |
| `POST /api/mcp/probe` | `{ "results": {} }` |
| `GET /api/taskrunner` | `{ "tasks": [] }` |
| `GET /api/logs/level` | `{ "level": "info" }` |
| `POST /api/logs/level` | `{ "ok": true }` |
| `GET /api/update/check` | `{ "available": false }` |
| `GET /api/changelog` | `{ "content": "" }` |
| `GET /api/sessions/context` | `{}` |
| `GET /api/sessions/usage` | `{}` |
| `GET /api/spawn` | `[]` |
| `GET /api/approvals` | `[]` |
| `GET /api/aim/mcp` | `[]` |
| `GET /api/aim/skills` | `[]` |
| `GET /api/aim/agents` | `[]` |
| `GET /api/aim/mcp/registry` | `[]` |

#### `POST /api/sessions/restart`

Gracefully restart the server: persists slot state, shuts down all pi processes and PTY shells, then exits (relies on external process manager to restart).

**Response:** `{ "ok": true }` (then server exits after 500ms)

---

## WebSocket API

### Connection

Connect to `ws://<host>:7777/api/ws`.

On connection, the server immediately sends:
1. `dashboard` — current dashboard status
2. `slots` — current slot list

The server also pushes `dashboard` status every **5 seconds** automatically.

### Client → Server Messages

All messages are JSON: `{ "type": "...", ... }`

#### `subscribe_logs`

Start receiving `log` messages from pi stderr.

```json
{ "type": "subscribe_logs" }
```

#### `unsubscribe_logs`

Stop receiving log messages.

```json
{ "type": "unsubscribe_logs" }
```

#### `watch_file`

Subscribe to file change notifications (uses `fs.watch`). Multiple clients can watch the same file.

```json
{ "type": "watch_file", "path": "/absolute/path/to/file.txt" }
```

#### `unwatch_file`

Stop watching a file.

```json
{ "type": "unwatch_file", "path": "/absolute/path/to/file.txt" }
```

---

### Server → Client Messages

All messages are JSON: `{ "type": "...", "data": { ... } }`

#### `dashboard`

Periodic dashboard status (every 5 seconds + on connect).

```json
{
  "type": "dashboard",
  "data": {
    "version": "1.0.0",
    "uptime": 3600,
    "sessions": 3,
    "messages": 142,
    "tool_calls": 28,
    "provider": "pi"
  }
}
```

#### `slots`

Full slot list. Sent on connect and whenever slots change (create, delete, agent start/end).

```json
{
  "type": "slots",
  "data": [
    {
      "key": "chat-1-...",
      "title": "My Chat",
      "messages": 12,
      "running": true,
      "stopping": false,
      "pending_approval": false,
      "model": "anthropic/claude-opus-4-6-1m",
      "cwd": "/Users/sam/project"
    }
  ]
}
```

#### `chat_chunk`

Streaming text delta from the assistant. Sent for each `text_delta` in the RPC stream.

```json
{
  "type": "chat_chunk",
  "data": {
    "slot": "chat-1-...",
    "content": "partial text...",
    "seq": 42
  }
}
```

`seq` is a **global monotonic counter** across all slots — use it to detect ordering/drops.

#### `chat_done`

Agent turn completed (or pi process exited).

```json
{
  "type": "chat_done",
  "data": { "slot": "chat-1-..." }
}
```

#### `chat_message`

Complete message ready to display (used for thinking blocks, slash command results, custom messages).

```json
{
  "type": "chat_message",
  "data": {
    "slot": "chat-1-...",
    "role": "thinking",
    "content": "Let me think about this...",
    "ts": "2026-04-17T10:00:00.000Z",
    "meta": { "customType": "meeting-transcript" }
  }
}
```

Roles: `thinking`, `assistant`, `system`

#### `tool_call`

Tool execution started.

```json
{
  "type": "tool_call",
  "data": {
    "slot": "chat-1-...",
    "tool": "bash",
    "id": "tc_abc123",
    "args": { "command": "ls -la" }
  }
}
```

#### `tool_result`

Tool execution completed.

```json
{
  "type": "tool_result",
  "data": {
    "slot": "chat-1-...",
    "tool": "bash",
    "id": "tc_abc123",
    "result": "file1.txt\nfile2.txt\n...",
    "isError": false
  }
}
```

Result text is capped at **5000 characters** for WebSocket transport.

#### `slot_title`

Slot title changed (manual rename or auto-generated by extension).

```json
{
  "type": "slot_title",
  "data": { "key": "chat-1-...", "title": "New Title" }
}
```

#### `context_usage`

Context window usage update (sent after each agent turn).

```json
{
  "type": "context_usage",
  "data": {
    "slot": "chat-1-...",
    "tokens": 5000,
    "contextWindow": 200000,
    "percent": 2.5
  }
}
```

#### `notification`

New notification (long tool completion, agent done after >60s).

```json
{
  "type": "notification",
  "data": {
    "kind": "input_needed",
    "title": "Done (120s)",
    "body": "My Chat",
    "ts": "2026-04-17T10:00:00.000Z",
    "acked": false,
    "slot": "chat-1-..."
  }
}
```

#### `extension_status`

Extension status bar update (ANSI codes stripped).

```json
{
  "type": "extension_status",
  "data": {
    "slot": "chat-1-...",
    "key": "statusKey",
    "text": "Processing..."
  }
}
```

#### `extension_widget`

Extension widget content update.

```json
{
  "type": "extension_widget",
  "data": {
    "slot": "chat-1-...",
    "key": "widgetKey",
    "lines": ["Line 1", "Line 2"]
  }
}
```

#### `log`

Pi process stderr output (only sent to clients that called `subscribe_logs`).

```json
{
  "type": "log",
  "data": { "level": "warn", "msg": "stderr text..." }
}
```

#### `file_changed`

External file modification detected (for clients watching the file).

```json
{
  "type": "file_changed",
  "data": {
    "path": "/absolute/path/to/file.txt",
    "content": "new file content...",
    "version": 5
  }
}
```

Self-writes (within 500ms of a `POST /api/file-write`) are suppressed.

#### `file_deleted`

Watched file was deleted or renamed.

```json
{
  "type": "file_deleted",
  "data": { "path": "/absolute/path/to/file.txt" }
}
```

---

## Slot Lifecycle

```
1. CREATE     POST /api/chat/slots  → slot created, pi process NOT started
                                      (allows setting CWD/model before first message)

2. CONFIGURE  POST /api/chat/slots/:key/cwd      → set working directory
              POST /api/chat/slots/:key/model    → set model
              POST /api/chat/slots/:key/thinking → set thinking level

3. SEND       POST /api/chat  { slot, message }  → ensureRunning() spawns pi process
              - pi starts with: pi --mode rpc [--session FILE] [--agent NAME] [--model PROVIDER/MODEL]
              - On first start, sends get_state RPC to confirm readiness
              - Wires slot events (streaming, tool calls, etc.) to WebSocket broadcast

4. STREAMING  Server receives RPC events from pi process:
              - agent_start    → marks slot as running
              - message_update → broadcasts chat_chunk (text deltas)
              - thinking_update → accumulates thinking text
              - tool_start     → broadcasts tool_call
              - tool_end       → broadcasts tool_result
              - agent_end      → broadcasts chat_done, replaces partial messages with final,
                                 fetches context_usage and session name

5. STOP       POST /api/chat/slots/:key/stop  → sends abort RPC to pi
              - Sets stopping flag, pi will emit agent_end

6. SWITCH     GET /api/chat/slots/:key  → load messages for a different slot
              - No process lifecycle change, just fetch stored messages

7. RESUME     POST /api/chat/slots/:key/resume
              - Reads historical session JSONL file
              - Creates NEW slot with loaded messages and sessionFile path
              - Pi process started on next message with --session flag

8. FORK       POST /api/chat/slots/:key/fork  { entryId }
              - Sends fork RPC to running pi process
              - Creates new slot with forked session
              - Original slot's pi process is killed (will restart on next message)

9. DELETE     DELETE /api/chat/slots/:key  → kills pi process, removes slot
```

**State persistence:** Slot state (messages, model, CWD, session file) is saved to `~/.pi/agent/pi-web-sessions.json` on every state change. On startup, saved slots are restored (without starting pi processes).

---

## Streaming Protocol

The streaming protocol bridges pi's RPC event stream to WebSocket clients:

### Text Streaming

```
Pi RPC: message_update { type: "text_delta", delta: "..." }
   ↓
Server: Appends to streamBuf, creates/updates partial message in pi.messages
   ↓
WebSocket: { type: "chat_chunk", data: { slot, content: "delta text", seq: N } }
```

- `seq` is a **global monotonically increasing counter** (shared across all slots)
- Partial messages are marked with `_partial: true` in `pi.messages`
- Persistence is throttled to every 2 seconds during streaming

### Thinking Blocks

```
Pi RPC: message_update { type: "thinking_delta", delta: "..." }
   ↓
Server: Accumulates in thinkingBuf, creates partial thinking message
   ↓
(On thinking_end event):
WebSocket: { type: "chat_message", data: { slot, role: "thinking", content: "full text" } }
```

### Tool Calls

```
Pi RPC: tool_execution_start { toolName, toolCallId, args }
   ↓
Server: Adds partial tool message to pi.messages, finalizes any partial text
   ↓
WebSocket: { type: "tool_call", data: { slot, tool, id, args } }

Pi RPC: tool_execution_end { toolName, toolCallId, result, isError }
   ↓
Server: Updates tool message with result, removes _partial flag
   ↓
WebSocket: { type: "tool_result", data: { slot, tool, id, result (≤5000 chars), isError } }
```

### Agent Turn Completion

```
Pi RPC: agent_end { messages: [...] }
   ↓
Server:
  1. Splices out all partial messages (from _streamIdx onward)
  2. Replaces with final messages from agent_end event (preserving interleaved order:
     thinking → toolCall → text → toolResult)
  3. Broadcasts chat_done
  4. Broadcasts updated slots
  5. Persists state
  6. Asynchronously fetches context_usage and session name
  7. If agent ran >60s, creates notification
```

### Custom Messages

```
Pi RPC: message_end { message: { role: "custom", customType: "...", content: "..." } }
   ↓
Server: Adds as system message with [customType] prefix
   ↓
WebSocket: { type: "chat_message", data: { slot, role: "system", content: "[type] text", meta } }
```

### Extension UI Events

Pi extensions can trigger UI interactions via RPC:

- **confirm** → auto-approved (sends `extension_ui_response { confirmed: true }`)
- **select** → auto-selects first option
- **setStatus** → broadcasts `extension_status` (ANSI stripped)
- **setWidget** → broadcasts `extension_widget`

---

## PTY Terminal WebSocket

> **Note:** Currently disabled in production (node-pty crashes under launchd). Connection attempts to `/api/terminal/ws` receive `503 Service Unavailable`.

When enabled:

**Connect:** `ws://<host>:7777/api/terminal/ws?cwd=/path&cols=120&rows=30`

**Client → Server:**
- Raw text: forwarded as keyboard input to the PTY shell
- JSON: `{ "type": "resize", "cols": 120, "rows": 30 }` — resize the terminal

**Server → Client:**
- Raw text: terminal output data

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PI_DASH_PORT` | `7777` | Server listen port |
| `WORKSPACE_DIR` | — | Additional workspace directory to scan |
| `PI_RUNTIME` | `dashboard` | Set in pi subprocess environment |

---

## Notes

- **No authentication** — designed for local/trusted network use only.
- **Slot state persistence** — `~/.pi/agent/pi-web-sessions.json` stores all slot data, auto-saved on changes.
- **Lazy process start** — pi processes only spawn when the first message is sent, allowing pre-configuration.
- **Version tracking** — file versions are in-memory only (max 50 per file), lost on server restart.
- **Self-write suppression** — file change notifications are suppressed for 500ms after a dashboard-initiated write.
- **Tool result cap** — tool results are truncated to 5000 chars for WebSocket/message storage.
- **Image handling** — base64 images from chat are saved to `$TMPDIR/pi-dashboard-images/` and referenced by path. Tool result images are also saved there and served via `/api/local-file`.
- **Notification threshold** — notifications are created when agent turns exceed 60 seconds or non-bash tools exceed 60 seconds.
