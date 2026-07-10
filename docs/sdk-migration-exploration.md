# pi-dashboard: RPC → SDK migration exploration

_Status: exploration / not a decision. Sources: two inspector recon passes over `backend/` and the pi-coding-agent SDK docs+examples (v0.80.3)._

## Bottom line

The dashboard today runs **one `pi --mode rpc` subprocess per chat slot** and talks to it over line-delimited JSON on stdin/stdout (`backend/pi-manager.ts` → `PiProcess`). The pi SDK (`@earendil-works/pi-coding-agent`, `createAgentSession`) exposes **the exact same event union in-process** via a `subscribe(listener)` callback — RPC is literally that event stream serialized to stdout.

So this is not a rewrite of the interaction model. It's swapping the *transport* (subprocess + JSONL parse + request/response correlation) for direct JS calls. ~1:1 event mapping. The real decision is **process isolation vs in-process control**, and the honest answer is probably a **hybrid**, not a wholesale migration.

---

## What the migration actually is

| Concern | Today (RPC) | With SDK |
|---|---|---|
| Launch | `spawn(node, [v8flags, pi, '--mode','rpc', ...])` per slot | `createAgentSession({cwd, model, sessionManager})` per slot, in-process |
| Send prompt | `stdin.write(JSON.stringify({type:'prompt',...})+'\n')` | `session.prompt(text)` / `session.steer()` / `session.followUp()` |
| Receive events | buffer stdout, split `\n`, `JSON.parse`, `_handleEvent` | `session.subscribe(ev => ...)` — same event objects, no parse |
| Request/response (get_state, set_model, stats) | inject `id`, `_pendingRequests` map, 30s timeout | direct method calls returning values / state getters |
| Session file | adopted from `get_state` | `session.sessionFile`, same `~/.pi/agent/sessions/` JSONL format |
| Fork / import / new | RPC commands | `AgentSessionRuntime.fork/importFromJsonl/newSession/switchSession` |

**Event parity is the whole story.** The dashboard already consumes `agent_start`, `agent_end` (authoritative turn end), `message_update.assistantMessageEvent.{text_delta,thinking_delta}`, `tool_execution_start/update/end`, `turn_start/end` (correctly *not* treated as terminal). The SDK delivers the identical union. The `_handleEvent` switch in `pi-manager.ts` becomes a `subscribe` listener nearly line-for-line.

**What gets deleted** if we go in-process:
- Stdout line-buffering + JSONL framing (and the RPC `\r`-strip / readline-avoidance gotcha).
- The `_pendingRequests` id-correlation + 30s RPC-timeout machinery — replaced by awaited method calls.
- The V8 flag / `NODE_BIN` / `PI_SCRIPT` resolution dance (`pi-manager.ts:14–34`) that exists only to spawn the subprocess safely under launchd.
- Stats **polling every 4s** — in-process, usage is readable from agent state on demand / on `agent_end`.

---

## What each current pain point becomes

From inspector-0raz's pain-point list:

1. **Provider truncation canary** (amazon-claude-code empty stream, `stopReason=stop`, 0 tokens) — *provider-side, survives migration.* Still needed. But in-process you can inspect the raw provider response via `pi.on("after_provider_response")` and detect/repair it at the source instead of heuristically at `agent_end` in `server.ts`.
2. **Phantom `agent_start` on resume / `_outstandingPrompts` counter** — largely dissolves. `session.isStreaming` is a live in-process getter, not a stale mirror; steering/followUp queue state is exposed via `queue_update` events. The counter hack was compensating for RPC latency/ambiguity.
3. **`/reload` unsupported in RPC → kill+respawn** — in-process you control the `ResourceLoader`; reloading skills/extensions/prompts becomes a re-bind, not a process restart.
4. **Extension UI dialogs auto-cancelled** (`confirm/select/input/editor`) — *this is the big unlock.* Today the dashboard replies `cancelled:true` to every extension UI request because it can't render pi's TUI dialogs. In-process, these are just callbacks/events you can route to real web UI (modal → WebSocket → response). Extensions that elicit input finally work in the dashboard.
5. **ANSI stripping / stall heartbeat** — heartbeat still useful; ANSI stripping on status text goes away (no terminal formatting in-process).

---

## What NEW becomes possible (the interesting part)

Going in-process unlocks the SDK's control surface, which is fundamentally inaccessible over a subprocess boundary:

1. **Real permission gating / tool approval UI.** `pi.on("tool_call", ...)` can `{block:true, reason}` *and mutate `event.input`* before execution. The dashboard could show "Agent wants to run `bash: rm -rf ...` — approve/deny/edit" with the actual args, patch them, or block — per-slot policy. Impossible cleanly over RPC.
2. **Custom tools injected from the dashboard.** `defineTool({name, parameters, execute})` → the dashboard can expose host-side capabilities as agent tools: "read this open file", "post to this WS channel", "query the dashboard's own DB", browser-side tools that resolve via the frontend. The dashboard becomes a tool provider, not just a viewer.
3. **Tool-result middleware.** `pi.on("tool_result")` can rewrite/redact/annotate results before they hit the model — e.g. truncate large outputs intelligently, inject citations, scrub secrets.
4. **Custom providers / request interception in-process.** `pi.registerProvider(...)`, `before_provider_request` / `after_provider_response` — route through a proxy, add SSO, do per-slot model routing, capture raw token streams for the truncation fix, or A/B providers without touching pi's binary.
5. **First-class branching / tree UI.** `SessionManager` tree APIs (`getTree`, `branch`, `branchWithSummary`, clone-at-position) are directly callable. The dashboard could render the session tree and let users branch/rewind visually instead of the current fork-file dance.
6. **Live skill/extension/context reload** without respawn (kills the `/reload` workaround).
7. **Programmatic compaction control** — `session.compact(instructions)` + `session_before_compact` hook lets the dashboard drive smart, user-directed compaction and show what got dropped.
8. **Zero serialization latency + type safety.** Every event is a live typed JS object; no JSONL round-trip, no shape-drift fallbacks (`partialResult ?? result`).

Framed differently: RPC gives you an *observable* agent. The SDK gives you a *programmable* one — you can sit inside the tool-call and provider-request loops.

---

## The big risk: N agents in one process

This is the crux and the reason a full migration is not obviously correct.

- Today each slot is a **fully isolated OS process**. A crash, an OOM, a runaway WASM compile, a memory leak in one slot cannot touch another. The V8 flags exist precisely because pi can OOM the WASM tier-up compiler — in-process, one slot's WASM blowup takes down **every** slot and the server.
- In-process, all slots share one Node heap + event loop. The docs are explicit: **no thread/worker isolation; RPC subprocesses are the documented isolation boundary.**
- Shared singletons (`AuthStorage`, `ModelRegistry`, `SettingsManager`) aren't guaranteed safe across many concurrent `AgentSession`s — you'd need per-agent `inMemory`/distinct-path services and per-agent cwd-bound `createAgentSessionServices`. Multi-agent-in-one-process is "works if you keep services separate," not an official guarantee.
- Every session swap (fork/switch/import) requires **re-subscribing + re-`bindExtensions()`** — the current long-lived-process model doesn't have this footgun.
- `InteractiveMode`/`runRpcMode` can't coexist with a headless SDK session in the same process (both want stdio), which bounds hybrid designs.

For a dashboard that runs many long-lived slots (some for conductor background sub-agents, idle-reaped at 30h), losing process isolation is a real reliability regression.

---

## Recommended shape: hybrid, not wholesale

Three viable paths:

**A. Full in-process SDK.** Max control, min isolation. Best if slot count is small and reliability of one-crash-kills-all is acceptable. Given the WASM-OOM history, this is risky for the current usage pattern.

**B. Keep RPC subprocess isolation, but run each subprocess via `runRpcMode(runtime)` from our own thin entry** instead of stock `pi --mode rpc`. This keeps the process boundary (and the transport code) but lets us inject custom tools/extensions/providers/permission-gating *into each subprocess* through the `ResourceLoader` + extension factories at spawn time. We get most of the "new possibilities" (tools, gating, providers, reload) **without** giving up isolation. The extension UI protocol over RPC (`select/confirm/input/editor` on stdout) already exists — we'd implement the client side we currently stub with `cancelled:true`, unlocking pain-point #4 over RPC too.

**C. Hybrid tiers.** Foreground/interactive slots in-process (SDK) for lowest latency + richest UI (permission dialogs, custom tools); background/conductor sub-agent slots stay as isolated RPC subprocesses. Most complex; only worth it if latency on foreground slots is a felt problem.

**Leaning B.** It reframes the question: most of what the user wants ("what else becomes possible") comes from the **SDK control surface (custom tools, permission gating, providers, extension-UI, live reload)** — and almost all of that is reachable by owning the `ResourceLoader`/extensions of each pi instance, which you can do over RPC via a custom `runRpcMode` entry *without* surrendering process isolation. The pure in-process win that B can't get is zero-serialization latency and direct tree-branching calls — nice, but not worth one-crash-kills-all for a many-slot server.

The single biggest independent unlock, available in **any** path, is **implementing the extension-UI protocol client** (stop auto-cancelling `confirm/select/input/editor`). That's a self-contained win worth doing first regardless of the transport decision.

---

## Recommended next steps

1. **Prototype the extension-UI client over current RPC** — route `extension_ui_request` (select/confirm/input/editor) to a web modal instead of `cancelled:true`. Self-contained, immediately useful, transport-agnostic.
2. **Spike a custom RPC entry** (`runRpcMode(runtime)` with a `DefaultResourceLoader({extensionFactories})`) that injects one custom tool + one `tool_call` permission gate, to prove path B end-to-end while keeping isolation.
3. **Micro-benchmark** in-process `subscribe` vs RPC JSONL round-trip latency on streaming deltas — quantify what path A/C actually buys before accepting the isolation cost.
4. **Verify multi-agent-one-process isolation** empirically (shared `AuthStorage`/`ModelRegistry`/`SettingsManager` cross-talk, WASM-OOM blast radius) before ever considering path A.

---

## Prior art: how other pi front-ends drive pi (researched 2026-07-10)

The ecosystem splits cleanly along the same **SDK-in-process vs RPC-subprocess** line as our decision — and the two mature community *web UIs* both chose the SDK.

### Web UIs (SDK, in-process)
- **`@agegr/pi-web`** (github.com/agegr/pi-web) and **`pi-app`** (github.com/asiachrispy/pi-app) — the same Next.js project (shared/forked README). **Drive pi via the SDK**: a Next.js API route (`api/agent/`) calls `createAgentSession` and streams events to the browser over **SSE** (not WebSocket). Deps include `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai` directly. They read the same `~/.pi/agent/sessions/<enc-cwd>/<ts>_<uuid>.jsonl` files, expose model/auth/skills panels, git-worktree switching, file browser + preview (pdf/mermaid/katex), context/cost/compaction telemetry, and session-tree branching ("Edit from here" = in-file branch; "Fork" = new jsonl). `pi-app` additionally adds `redis`, `web-push`, `qrcode` → **mobile PWA with push notifications**. Closest analogue to our dashboard; validates path A for a single-user local web UI. It uses SSE per-session rather than one persistent process per slot — the isolation concern is smaller because it's local + single-user.

### Editor / protocol bridges (RPC subprocess)
- **`pi-acp`** (github.com/svkozak/pi-acp) — Agent Client Protocol adapter. **Spawns `pi --mode rpc`** (same transport as our dashboard) and bridges ACP JSON-RPC 2.0 over stdio ↔ pi RPC, targeting **Zed editor**. Maps pi `tool_execution` → ACP `tool_call`/`tool_call_update`, emits structured diffs for `edit` (snapshots file pre-edit, infers 1-based line from unique `oldText`), resolves relative paths to cwd for follow-along, keeps its own `~/.pi/pi-acp/session-map.json` to reattach via `session/load`. Confirms RPC is the right boundary when the consumer is a separate process/editor in another language.
- **`pi-mcp-adapter`** — exposes MCP servers to pi as one ~200-token proxy tool instead of bloating context; an *extension*, not a front-end, but shows the extension-injection pattern our path B would use.

### Other harnesses / patterns
- **`@ai-sdk/harness-pi`** — Vercel AI SDK `HarnessV1` adapter; runs pi **in the host Node process** and treats a sandbox as remote FS+shell (no bridge process). Another in-process SDK embedding.
- **`@pasko70/pibo`** — minimal TS wrapper around pi (library-style embedding).
- **`@mjasnikovs/pi-task`** — pipeline extension with a **real-time remote web view** of a multi-phase /task run; front-end bolted onto an extension.
- **`glimpseui`** — generic WebView micro-UI for scripts/agents (bidirectional JSON) — gives any pi extension a native window.
- **`@agentuity/coder-tui`** — Agentuity "Coder Hub" TUI extension.

### Takeaway for our decision
- The **only mature web front-ends (pi-web/pi-app) use the SDK in-process with SSE** — same direction as path A. But they're single-user local tools where one-crash-kills-all is acceptable, and they run per-request AgentSessions rather than N long-lived isolated slots.
- **Every cross-process / cross-language consumer (pi-acp) uses `pi --mode rpc`** — validating RPC as the correct boundary when isolation or another runtime is involved, which is our dashboard's actual situation (many long-lived slots, conductor background sub-agents, WASM-OOM blast radius).
- Net: prior art *reinforces* the hybrid conclusion. If the dashboard were a single-user local viewer, copying pi-web (SDK+SSE) would be the obvious move. Because it runs many isolated long-lived agents, path B (custom `runRpcMode` entry with injected extensions/tools + the extension-UI client) captures the SDK's control-surface wins without pi-web's shared-heap fragility.
