# pi-dashboard

Web + iOS + desktop dashboard for the pi coding agent. Runs pi as a long-lived RPC server, spawns one pi process per chat, and exposes a browser UI, iOS app, and optional Electron wrapper.

## Language

**Slot**:
The canonical unit of a chat. A Slot has a `key`, `title`, optional session file, model provider/id, cwd, tags, and a message list. Multiple Slots run concurrently, each with its own pi process. Shown as a sidebar entry in the UI.
_Avoid_: chat (ambiguous — see below), tab, panel.

**SlotState** / **SlotProcess**:
The two representations of a Slot:
- **SlotState** — the persisted shape (JSON in `~/.pi/agent/pi-web-sessions.json`). What survives restarts.
- **SlotProcess** — the runtime shape: a live pi child process plus its in-memory message buffer. What the server holds.

**Session**:
The pi-side artifact — the JSONL file at `~/.pi/agent/sessions/<id>.jsonl` that pi writes as the source of truth for a conversation. A **Slot** may reference a Session file; a Session can exist without a Slot (pi used from the CLI).
_Avoid_: using "session" to mean Slot. They're distinct layers.

**Chat**:
Informal / UI-facing synonym for **Slot**. Used in user-facing copy ("New Chat", "Chat list"); internally, code uses **Slot**.

**pi-manager**:
Backend module that spawns `pi --mode rpc` child processes, one per Slot. Owns the Slot → process map. Emits events on stdout/stderr, parses pi's JSONL output, and forwards messages to the server's WebSocket layer.

**pi-env**:
Backend module that inspects the local pi installation — available models, installed extensions, memory stats — without starting a pi process. Cached; refreshed on demand.

**pty-manager**:
Backend module managing node-pty terminal sessions. Parallel to pi-manager but for terminals, not pi processes.

**RPC mode**:
The way pi-dashboard runs pi. `pi --mode rpc` makes pi emit JSONL events on stdout and accept commands on stdin instead of running a TUI. The entire dashboard is a JSONL-over-stdio protocol consumer.

**Fork**:
Branching a conversation at a given message. Creates a new Slot whose messages are a prefix of the original. Preserves the original Slot.

**Document panel**:
The right-hand UI panel that renders a file (code with syntax highlighting, markdown rendered, PDF via PDF.js, XLSX via SheetJS, image inline). Opened via the file browser or by the agent.

**Inline comment**:
An annotation on a line range of an open document. Multiple inline comments get bundled into a review and sent as a single message to the Slot. Used for human → agent feedback flows.

**Thinking block**:
A pi message whose `role` is `thinking` — the agent's internal reasoning. Rendered collapsed by default; expandable.

**Streaming**:
Incremental delivery of a single assistant message (partial content, `_partial: true`). All messages can stream including Thinking blocks and tool call args/results.

**Tool call**:
A pi message with `role: 'tool'` and `meta.toolName` set. Args and results stream separately. UI renders as an inline card.

## Relationships

- A **Slot** has exactly one **SlotState** (persisted) and at most one **SlotProcess** (runtime, active only while pi is running).
- A **Slot** may reference one **Session** (JSONL file); a **Session** exists independently.
- **pi-manager** owns the Map\<slot-key, SlotProcess\>; **session-store** owns the Map\<slot-key, SlotState\>.
- A **Fork** produces a new **Slot** whose `messages` are a prefix of the parent.
- **Inline comments** belong to a **Document panel** open in a **Slot**.
- Every chat runs through **RPC mode** — the dashboard never launches pi in interactive mode.

## Flagged ambiguities

- **"Session"** without qualification is almost always the pi JSONL file, not a **Slot**. Code that says `sessionFile` on a Slot means the file path, not the Slot itself.
- **"Chat" vs "Slot"** — Chat is UI copy, Slot is the implementation term. Don't mix them in code.
- **Native apps** live under `apple/` (iOS + macOS); the older `ios/` name has been renamed. iOS-only code is `apple/PiDash/`; macOS uses the `PiDashMac` scheme.

## Example dialogue

> **Sam:** "When I kill a chat, does its session go away?"
> **Agent:** "Closing a **Slot** kills the **SlotProcess** and removes the **SlotState** entry in `pi-web-sessions.json`. The underlying **Session** JSONL at `~/.pi/agent/sessions/<id>.jsonl` stays — pi wrote it, pi owns it. You can resume it by creating a new Slot that references the same session file."
