# Design: pi-dashboard RPC → SDK in-process migration

_Status: system design. Companion to `docs/sdk-migration-exploration.md` (the two-path analysis) and the oracle gate that locked the decisions below. This doc is architecture only — the planner produces the slices._

> **Source of truth for the planner:** this file (`docs/sdk-migration-design.md`) + `docs/sdk-migration-exploration.md` are the ONLY authoritative docs for this migration. The repo-root `design.md` and `plan.md` describe a **different, unrelated feature** (the HTML/JS-viewer document panel, already landed) — do not read them as migration context. Verified via oracle gate against pi SDK **v0.80.3** `.d.ts` declarations.

## Goal

Migrate the dashboard's per-slot agent transport from **one `pi --mode rpc` subprocess per slot** (`backend/pi-manager.ts` `PiProcess`) to the **pi SDK in-process** (`createAgentSession` + `session.subscribe`), via a **strangler-fig**: extract a `PiSession` interface, ship two implementations (`PiRpcSession` = today's behavior, `PiSdkSession` = in-process), and choose the transport **per slot**. The frontend WebSocket contract is frozen and the migration must be invisible to it. End state is full in-process; the interface + per-slot flag is the *route*, giving instant rollback, A/B, and the ability to keep isolation-sensitive slots (conductor background sub-agents) on RPC.

This directly answers the user's Q2 — **yes, a sub-agent (or any slot) can be in-process *or* RPC**, selected per slot, because transport is a first-class per-slot property, not a global switch.

---

## Locked decisions (from the oracle gate)

1. Strangler-fig, not big-bang. `PiManager` and `server.ts:_wireSlotEvents` depend on the **interface**, never on `PiProcess` concretely.
2. Per-slot transport selection is first-class: `PI_DASH_TRANSPORT=rpc|sdk` default, overridable per slot + persisted in slot state + settable via API. Defaults: foreground → `sdk`, conductor background sub-agents → `rpc`.
3. Blast-radius mitigations are in-scope: (a) launch the server under the V8 WASM flags; (b) continuous slot-state autosave + auto-respawn; (c) per-slot error boundaries + `session.dispose()`. The `uncaughtException` log-and-continue (`server.ts:761`) is false comfort in-process and must be hardened.
4. Port the race-fixes (`_outstandingPrompts`, `_pendingRequests` 30s timeout) — do **not** assume they dissolve. Preserve behavior + tests.

---

## 1. The `PiSession` interface

Extracted from `PiProcess`'s **actual** public surface (verified in `pi-manager.ts`). Two axes: **command methods** (things `server.ts`/`chat.ts` call) and **emitted events** (things `_wireSlotEvents` subscribes to). Both must be identical across implementations so `_wireSlotEvents` is written once.

```typescript
// backend/pi-session.ts  (new)
import type { EventEmitter } from 'events'
import type { ChatMessage } from './session-store.js'

export type PiTransport = 'rpc' | 'sdk'

/** The contract PiManager + _wireSlotEvents depend on. Both PiRpcSession
 *  and PiSdkSession implement it. EventEmitter is part of the contract —
 *  server.ts subscribes via pi.on(...) and today even monkey-patches pi.emit
 *  (server.ts:295) for the stall detector, so the interface extends it. */
export interface PiSession extends EventEmitter {
  // ── identity / state (public fields read across server.ts + chat.ts) ──
  readonly slotKey: string
  readonly transport: PiTransport
  sessionFile: string | null
  modelProvider: string | null
  modelId: string | null
  thinkingLevel: string | null
  cwd: string | null
  messages: ChatMessage[]
  running: boolean
  _stopping: boolean
  _pendingApproval: boolean
  _contextUsage: any | null      // cached, broadcast on context_usage
  _tokenStats: any | null        // cached, broadcast on token_stats
  _wired?: boolean               // guard in chat.ts fork/resume paths
  // slot metadata written/read by server.ts + chat.ts (must be on the
  // interface or the extraction slice won't typecheck — see §1a):
  _title: string                 // 7 sites (title derivation, persist)
  _userRenamed: boolean          // 2 sites (suppress auto-title after manual rename)
  _tags: string[]                // 3 sites (conductor tagging, persist)
  _toolsRunning: number          // 3 sites — written by server.ts stall detector (388/425/459)

  // ── lifecycle ──
  start(): void
  kill(): void
  checkHealth(): boolean
  gracefulShutdown(timeoutMs?: number): Promise<void>

  // ── prompting / turn control ──
  prompt(message: string, images?: ImagePayload[]): Promise<boolean | void>
  abort(): boolean
  conductorDetach(): void

  // ── model / thinking ──
  setModel(provider: string, modelId: string): Promise<any>
  setThinkingLevel(level: string): Promise<any>
  getState(): Promise<any>
  getAvailableModels(): Promise<any[]>
  getCommands(): Promise<any[]>

  // ── stats / session ops (today go through request(); see §5, §3) ──
  getSessionStats(): Promise<any>          // was request({type:'get_session_stats'})
  fork(entryId: string): Promise<{ text?: string; cancelled?: boolean; sessionFile?: string | null }>
  getForkMessages(): Promise<any>
  newSession(): Promise<void>              // was send({type:'new_session'})
  compact(instructions?: string): Promise<any>
  exportHtml(path?: string): Promise<any>
  setSessionName(name: string): Promise<any>
  getLastAssistantText(): Promise<string>

  // ── extension UI round-trip (see §6) ──
  respondExtensionUi(id: string, response: { cancelled?: boolean; value?: any }): void
}
```

### 1a. Call-site rewrites — the extraction slice is NOT a zero-risk rename

The interface hides `PiProcess`'s RPC internals, so every transport-specific call site in `server.ts`/`chat.ts` must be **refactored to the interface** before `PiSdkSession` can exist. These are real edits, not a rename — the extraction slice's "tests green" gate must cover them explicitly or it hides work:

**Refactored OUT (transport-specific → typed interface methods):**
- **`pi.request(...)` — 5 sites → typed methods.** `server.ts:260` `request({type:'get_session_stats'})` → `getSessionStats()`; `server.ts:400` `request({type:'get_state'})` (title derivation) → `getState()` (must surface `sessionName`, see §2); `chat.ts:127` `request({type:'fork',entryId})` → `fork(entryId)`; `chat.ts:129` `request({type:'get_state'})` → `getState()`; `chat.ts:156` `request({type:'get_fork_messages'})` → `getForkMessages()`.
- **`pi.proc` liveness checks — 4 sites → `running`/`checkHealth()`.** `server.ts:513`, `chat.ts:322`, `chat.ts:338`, `chat.ts:381` all do `pi.proc && !pi.proc.killed && pi.proc.exitCode===null`. SDK has no child process — replace with `pi.running` (or `pi.checkHealth()` where liveness before a call is meant). `PiRpcSession` keeps the real check behind `checkHealth()`.
- **`pi.ready` — 2 sites (`chat.ts:322,338`) → fold into `checkHealth()`/`running`.** SDK sessions are ready synchronously after `createAgentSession` resolves; RPC keeps its ready-promise internally.
- **`pi.send(...)` — 2 sites.** `server.ts:519` (prompt-hint) and `server.ts:541` (extension-UI auto-cancel) → the auto-cancel becomes `respondExtensionUi(id,{cancelled:true})` as part of §6; the prompt-hint send is internalized.

**Note:** `pi.dash` at `server.ts:746` is a **false positive** (a URL string, not a `PiProcess` field) — ignore it.

With the 4 slot-metadata fields added to the interface above (`_title`/`_userRenamed`/`_tags`/`_toolsRunning`) plus the fields already there, all `server.ts`/`chat.ts` accesses typecheck against `PiSession`. **Alternative considered:** move `_title`/`_tags`/etc. out of the session object entirely into the slot-state record. Rejected for this slice (larger blast radius, touches persist/restore) — deferred as optional cleanup; keeping them on the interface is the minimal change and mirrors the existing `_stopping`/`_contextUsage` placement.

### Emitted events (the second half of the contract)

`_wireSlotEvents` (`server.ts:217`) subscribes to the events below. **Both implementations must emit the same names with the same payload shapes** — this is the frozen-FE guarantee's real enforcement point. (Framing note: server.ts actually subscribes to `message_end` but **not** `message_start`, and to **neither** `turn_start` nor `turn_end` — those are emitted by `PiProcess` but currently unconsumed; they stay in the contract for completeness/future use but are not load-bearing.)

| Internal event | Payload (as consumed by server.ts) | → WS frame |
|---|---|---|
| `agent_start` | `event` | (marks `midTurn`, starts stall/stats timers) |
| `agent_end` | `event` (with `.messages`) | `chat_message` (final splice) + `chat_done` |
| `message_update` | `{ event, delta }` where `delta.type ∈ text_delta\|thinking_end` | `chat_chunk`, `chat_message` |
| `thinking_update` | `{ delta }` | (buffers; flush on `thinking_end`) |
| `message_start` / `message_end` | `event` (custom messages) | `chat_message` (only `message_end` is consumed) |
| `tool_start` | `{ toolCallId, toolName, args }` | `tool_call` |
| `tool_update` | `event` | `tool_update` |
| `tool_end` | `event` | `tool_result` |
| `turn_start` / `turn_end` | `event` | emitted but **not consumed** by server.ts today |
| `compaction_start` / `compaction_end` | `event` | not consumed today (SDK v0.80.3 uses these names; there is **no** `auto_compaction_*` — see §2) |
| `extension_ui` | `event` (`method`, `id`, `statusKey`, …) | `extension_status`, `extension_widget`, + response (§6) |
| `extension_error` | `event` | `log` frame |
| `slash_result` | `{ content }` | `chat_message` |
| `prompt_failed` | `{ error }` | `chat_message` |
| `session_file` | `sessionFile` | (persist) |
| `model_change` | — | (persist + `slots` broadcast) |
| `log` | `{ level, msg }` | `log` frame |
| `startup_error` | `{ code, stderr, slotKey }` | `startup_error` |
| `exit` | `code` | `chat_error` / `chat_done` |
| `error` | `err` | `chat_error` |
| `response` | `event` | **RPC-internal only** — see §5; not emitted by SDK impl |

**Design rule:** `_wireSlotEvents` is refactored to take `PiSession` and is *unchanged in behavior*. The SDK implementation's job is to translate `AgentSessionEvent`s into exactly these emissions. This is the single most important parity boundary in the migration.

---

## 2. Event mapping: SDK `AgentSessionEvent` → internal events → WS frames

The SDK event union (verified in `sdk.md`) is ~1:1 with the RPC JSON the dashboard already parses. `PiSdkSession.subscribe` translates:

| SDK event | → internal emit | Shape delta vs RPC |
|---|---|---|
| `agent_start` | `agent_start` | same |
| `agent_end` (`.messages`) | `agent_end` | **same shape** — `messages[]` with `role ∈ assistant/custom/toolResult`, `content` parts `thinking/toolCall/text`. Reuse the existing splice logic verbatim. |
| `message_update` `assistantMessageEvent.text_delta` | `message_update {event,delta}` | `delta.delta` identical |
| `message_update` `assistantMessageEvent.thinking_delta` | `thinking_update {delta}` | identical |
| `message_update` `assistantMessageEvent.thinking_end` | `message_update {event,delta}` | server.ts keys off `event.assistantMessageEvent.type === 'thinking_end'` — same |
| `tool_execution_start` | `tool_start {toolCallId,toolName,args}` | **RESOLVED (O1): field is `args`.** `tool_execution_start = {toolCallId, toolName, args}`. `input` exists only on the additive `tool_call` extension hook (§7c), not the event path. No delta. |
| `tool_execution_update` | `tool_update` | passthrough |
| `tool_execution_end` (`.isError`) | `tool_end` | passthrough |
| `message_start` / `message_end` | same | custom-message handling identical (only `message_end` consumed) |
| `turn_start` / `turn_end` | same | SDK `turn_end` carries `.message` + `.toolResults` (extra, ignorable); neither consumed today |
| `compaction_start` / `compaction_end` | `compaction_start` / `compaction_end` | **NO rename needed.** At v0.80.3 the SDK emits `compaction_start/end`; there is no `auto_compaction_*`. `PiProcess`'s `case 'auto_compaction_start'` is **dead code**, and server.ts subscribes to neither. Pass through as-is (or drop). |
| `agent_end` (`.messages`, **`.willRetry`**) | `agent_end` | **DELTA (load-bearing): gate terminal handling on `willRetry === false`.** When `willRetry === true` an auto-retry is about to fire — emitting `chat_done` here produces a premature done + phantom re-start (exactly the phantom-turn class the race-fixes exist to prevent, §5). Only splice-final + `chat_done` when `willRetry === false`. |
| `auto_retry_start` / `auto_retry_end` | `log` + retry-state | **NOT optional.** These are the signal that pairs with `agent_end.willRetry` — track retry-in-progress so the stall detector and queueing don't treat the gap as idle. Surface as a `log` line (no FE frame change) but the state is required. |
| `session_info_changed` (`.name`) | `model_change`/title update | **DELTA: new, must map.** Today slot titles are derived by polling `getState()`→`sessionName` after each `agent_end` (`server.ts:400-402`). Map `session_info_changed`→title (broadcast `slot_title`), OR require `PiSdkSession.getState()` to surface `sessionName` so the existing poll path works unchanged. Prefer mapping the event (removes the poll). |
| `thinking_level_changed` (`.level`) | `model_change` | New (minor). Update `thinkingLevel` + emit `model_change` so the FE settings chip stays in sync. |
| `queue_update` (`.steering`, `.followUp`) | *(new — drives §5)* | **No RPC analogue.** Replaces `_outstandingPrompts` busy-detection. Not broadcast to FE. |
| extension UI callbacks (§6) | `extension_ui` | **Different delivery** — see §6. |
| *(no event)* — direct return of `session.prompt()` etc. | replaces `response` | See §5. |

**Net deltas the implementer must handle:** (1) **`agent_end.willRetry`** — gate `chat_done`/final-splice on `willRetry === false`, and track `auto_retry_start/end` state (load-bearing for the phantom-turn class, §5); (2) **`session_info_changed`** → slot title (replaces the `getState`→`sessionName` poll); (3) `queue_update` is new and load-bearing for §5; (4) extension UI is a callback not an event/response pair (§6); (5) `thinking_level_changed` (minor). `tool_execution_start` field is `args` (O1 resolved, no delta) and there is **no** `compaction_*` rename (dead code). Everything else is a direct passthrough. **The FE frame set is unchanged.**

---

## 3. Session lifecycle in-process

### Session adoption
`PiRpcSession` adopts `sessionFile` from the `get_state` ready-promise (today's `pi-manager.ts:270`). `PiSdkSession` reads `session.sessionFile` directly after `createAgentSession({ sessionManager: SessionManager.create(cwd) })` resolves — synchronous, no ready-race, emits `session_file` immediately.

### Runtime + replacement (fork / new / switch / import)
`PiSdkSession` owns one `AgentSessionRuntime` per slot (via `createAgentSessionRuntime`, the same layer the built-in modes use). Session-replacement ops (`newSession`, `fork`, `switchSession`, `importFromJsonl`) live on the **runtime**, not the session, and **replace `runtime.session`**.

**The new bug class (no RPC analogue):** after *every* replacement, event subscriptions and extension bindings point at the **old** `AgentSession`. Miss the rebind → the slot goes silently dead (events stop, UI frozen, no error). **Use the SDK's automatic rebind hooks** rather than hand-calling after each op: register the rebind via `runtime.setRebindSession(fn)` (+ `runtime.setBeforeSessionInvalidate(fn)`) once at construction — they fire automatically on EVERY replacement (`newSession`/`switchSession`/`fork`/`importFromJsonl`), which removes the "forget to rebind" footgun entirely. Centralize the logic in one method:

```typescript
// PiSdkSession — register ONCE; the runtime invokes it on every swap
constructor() {
  this.runtime.setBeforeSessionInvalidate(() => { this._unsubscribe?.() })
  this.runtime.setRebindSession(async () => {
    const s = this.runtime.session
    await s.bindExtensions(this._extensionBindings)   // re-bind extensions
    this._unsubscribe = s.subscribe(ev => this._translate(ev))  // re-subscribe
    this.sessionFile = s.sessionFile ?? null
    this.emit('session_file', this.sessionFile)
  })
}

async newSession() { await this.runtime.newSession() }   // rebind fires automatically
async fork(entryId: string) {
  const r = await this.runtime.fork(entryId)             // returns { cancelled, selectedText }
  return { text: r?.selectedText, cancelled: r?.cancelled, sessionFile: this.runtime.session.sessionFile ?? null }
}
```

> **Field-name fix:** `runtime.fork(entryId, {position})` returns `{ cancelled, selectedText }` — **`selectedText`**, not `editorText`.

**⚠️ Fork-semantics spike is a GATE before §3 is implemented (open question O5 — the only genuinely-open one, and it's a spike, not a user call).** `SessionManager` exposes both `branch(id)` (in-place, writes the **SAME** JSONL) and `createBranchedSession()`/`forkFrom()` (**NEW** JSONL). Which one `runtime.fork()` calls is **not** determinable from the `.d.ts` — confirm with a 5-line runtime spike before building the fork path. **If `runtime.fork()` is in-place** and `chat.ts` `createSlot`s from the returned sessionFile while keeping the old slot alive, **two slots write one JSONL → corruption.** Two safe outcomes:
- If `runtime.fork()` creates a NEW JSONL → keep the current "fork → new slot" UX (old slot survives, new slot adopts the new file).
- If it's in-place → either kill the old slot (as RPC does today, `pi.kill()` at `chat.ts:145`) so only one writer remains, or switch the fork path to `createBranchedSession()`/`forkFrom()` for the new-JSONL semantics.

**Fork parity note:** today `chat.ts:120` forks via `pi.request({type:'fork', entryId})`, reads `get_state`, then **creates a whole new slot and kills the old one** (`pi.kill()`). The design preserves that UX: `PiSdkSession.fork()` returns the new `sessionFile` and `chat.ts` continues to `createSlot` from it. Because RPC already kills the old slot, the in-place-corruption risk only bites if the SDK path *drops* that kill — the spike outcome decides. A future additive slice (§7c) adds true in-place tree branching via `session.navigateTree()`.

---

## 4. Concurrency / service isolation

**The core risk (oracle finding #2, HIGH).** N in-process `AgentSession`s share one Node heap. Shared singletons (`AuthStorage`, `ModelRegistry`, `SettingsManager`) can cross-talk — and the dashboard *already* fights pi's model/thinking resolver per-slot (`resolveDefaultThinkingLevel` + the `--model` short-circuit workaround, `pi-manager.ts:14–38`). A shared `ModelRegistry` bleeding model/thinking state across slots would resurrect exactly that bug.

**Model chosen — per-slot cwd-bound services, shared auth/registry read-only:**

```typescript
// one AgentSessionRuntime per slot; services are cwd-bound and NOT shared
const services = await createAgentSessionServices({ cwd: slot.cwd })   // per-slot
const runtime  = await createAgentSessionRuntime(createRuntime, {
  cwd: slot.cwd,
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(slot.cwd),   // per-slot
})
```

- **Per-slot (isolated):** `AgentSessionServices`, `SessionManager`, the `AgentSession`/runtime, thinking-level state, subscriptions, extension bindings.
- **Process-shared (read-mostly, created once):** `AuthStorage` (credential store) and `ModelRegistry` (model catalog). These are read-heavy and safe to share; the dashboard already treats models as a process-wide cache (`PiManager._modelCache`).

**Risk & guardrail:** "works if you keep services separate" is not a formal guarantee. Therefore **decision D-verify**: before flipping the default to `sdk` (§8), run an empirical two-SDK-slot isolation test — set different models/thinking levels on two concurrent SDK slots and assert no bleed. This is exploration next-step #4, still unrun. Until it passes, `sdk` stays opt-in per slot.

**Rejected alternative:** fully shared singletons across all sessions (what a naive `createAgentSession()` with default services gives). Rejected — highest cross-talk risk, directly threatens the model-resolver workaround. **Rejected alternative:** separate OS process per session — that *is* `PiRpcSession`; it remains available per-slot as the isolation escape hatch (the whole point of per-slot transport).

---

## 5. Stats & race-fixes (replacing `request()` machinery)

### Stats — drop the 4s poll
Today `_wireSlotEvents` polls `get_session_stats` every 4s during a turn (`server.ts:258`, `_startStatsPoller`) because RPC only exposes cumulative stats on request. In-process, usage is readable on demand from session/agent state.

- **`PiSdkSession.getSessionStats()`** reads live usage from `session.agent.state` / session usage accessor (no round-trip).
- `_wireSlotEvents` calls it **on `turn_end` and `agent_end`** (event-driven) instead of on a timer. The 4s poller is deleted for SDK slots. RPC slots keep the poller (behavior-preserving).
- **Same WS frames** (`context_usage`, `token_stats`) — FE unchanged.

### Race-fixes — port, don't dissolve
The `_outstandingPrompts` counter + `_shouldQueuePromptAsFollowUp()` (`pi-manager.ts:415`) and the `_pendingRequests` 30s timeout encode fixes for: phantom `agent_start` on resume, and provider races (bedrock-mantle/openai-responses) where the dashboard's local "busy" mirror goes stale.

- **`_pendingRequests` + 30s timeout → deleted for SDK.** Replaced by direct awaited method calls (`session.setModel()`, `getSessionStats()`, etc.). No id-correlation, no timeout machinery. The `response` internal event is **not emitted** by `PiSdkSession`.
- **`_outstandingPrompts` busy-detection → `session.isStreaming` + `queue_update`.** `PiSdkSession.prompt()` decides steer/followUp from the **authoritative** `session.isStreaming` getter (live, not a mirror) instead of a counter that can drift. `queue_update` events keep the dashboard's view of the queue accurate.
- **Behavior + tests preserved:** the existing prompt-queueing tests are re-pointed at the interface and must pass for **both** implementations. The phantom-`agent_start`-on-resume scenario becomes a test asserting `isStreaming === false` after adoption, so we don't queue behind a nonexistent turn.

```typescript
// PiSdkSession.prompt — isStreaming is authoritative, no counter drift
async prompt(message: string, images?) {
  if (message.startsWith('/')) return this._handleSlash(message, images)   // parity with RPC_MAP/DATA_CMDS
  const streaming = this.session.isStreaming
  await this.session.prompt(message, {
    images: normalizeImages(images),
    ...(streaming ? { streamingBehavior: 'followUp' } : {}),
  })
}
```

---

## 6. Extension-UI client (land FIRST, on RPC — transport-agnostic)

Today `server.ts:526` **auto-cancels** every `confirm/select/input/editor` extension dialog (`cancelled:true`) because the dashboard can't render pi's TUI dialogs. This is the single biggest independent unlock and is **decoupled from the transport swap**.

**Design (RPC first):**
1. On `extension_ui` with `method ∈ {confirm,select,input,editor}`, instead of auto-cancelling, broadcast a new WS frame **`extension_ui_request`** `{ slot, id, method, prompt, options?, defaultValue? }`.
2. FE renders a modal; user responds. FE POSTs to a new endpoint `POST /api/chat/slots/:key/extension-ui-response` `{ id, cancelled?, value? }`.
3. Server calls `pi.respondExtensionUi(id, {...})` → `PiRpcSession` sends `{type:'extension_ui_response', id, ...}` (the existing RPC response path, just no longer hardcoded to `cancelled:true`).
4. **Safety guardrail (keep the current wisdom):** a per-request timeout (e.g. 60s) falls back to `cancelled:true` — preserving the anti-wedge behavior for dialogs emitted from extension startup paths (the `pi-computer-use` case documented at `server.ts:531`). Never auto-*confirm*.

**In-process (identical FE contract):** `PiSdkSession` provides the same `extension_ui` emission + `respondExtensionUi`, but the delivery is a **Promise** from the SDK's `ExtensionUIContext`, wired via `bindExtensions({ uiContext })`. `ExtensionUIContext` covers `select / confirm / input / editor / notify / setStatus / setWidget / setTitle / custom` — the callback/Promise abstraction is correct. Two implementation requirements:

**(a) Cover the non-dialog methods too.** server.ts already handles `setStatus` and `setWidget` as `extension_ui` methods (broadcasting `extension_status`/`extension_widget`), and `notify`/`setTitle` are fire-and-forget. So `PiSdkSession`'s `uiContext` must implement **all** of them, not just the 4 dialogs: `setStatus/setWidget` → emit `extension_ui` with the same `{method, statusKey/widgetKey, ...}` shape server.ts expects; `notify/setTitle/custom` → no-op or emit as today.

**(b) `respondExtensionUi({cancelled, value})` → correct return type per method.** The `uiContext` method returns a Promise the SDK awaits; `respondExtensionUi` resolves it. Map `value` to each method's declared return type:
- `confirm` → `boolean` (`value` truthy → `true`; `cancelled` → `false`)
- `select` → `string | undefined` (selected option id; `cancelled` → `undefined`)
- `input` → `string | undefined` (entered text; `cancelled` → `undefined`)
- `editor` → `string | undefined` (edited buffer; `cancelled` → `undefined`)

The `PiSession` interface hides all this: server.ts sees the same `extension_ui` event and calls the same `respondExtensionUi`. Because the client (frame + modal + endpoint + timeout) is built against the interface, it works unchanged once transport flips.

**This is a strictly-additive frame** (`extension_ui_request`) — it doesn't alter any existing frame, so "frozen FE contract" holds (frozen = existing frames unchanged; adding a new frame the old FE ignores is compatible).

---

## 7. Feature classification (slice discipline)

The exploration doc's trap: the *reasons to migrate* (custom tools, gating, providers) are **not** the migration. Bucket strictly.

### (a) Migration-intrinsic — parity work (breaks slots if wrong)
- `PiSession` interface extraction + `PiRpcSession` (behavior-preserving wrap of today's `PiProcess`).
- `_wireSlotEvents` re-typed to the interface.
- `PiSdkSession` event translation (§2), session adoption + `setRebindSession`/`setBeforeSessionInvalidate` (§3), per-slot services (§4), stats + race-fix port (§5).
- Per-slot transport config surface (§ below).
- Blast-radius mitigations (§ below).

### (b) Transport-agnostic — land FIRST on RPC, before any SDK work
- **Extension-UI client (§6).** Proven end-to-end on RPC, then free in-process.

### (c) Additive — SEPARATE post-cutover slices, NEVER coupled to the transport swap
Each is its own committable slice, gated behind its own flag, landed only after `sdk` is the default:
- Permission-gating UI — `pi.on("tool_call")` `{block, reason}` + input mutation.
- Custom tools — `defineTool({name, parameters, execute})` injected via `DefaultResourceLoader({extensionFactories})`.
- Tool-result middleware — `pi.on("tool_result")` redact/annotate.
- Custom providers / request interception — `before_provider_request` / `after_provider_response` (also the *right* place to fix the amazon-claude-code truncation canary at source).
- Session-tree branching UI — `session.navigateTree()`.
- Live reload — rebuild `ResourceLoader` instead of kill+respawn (kills the `/reload` workaround at `pi-manager.ts:448`).
- Programmatic compaction — `session.compact(instructions)`.

**Rule:** a transport bug and a feature bug must never land in the same un-bisectable slice.

---

## Per-slot transport config surface

Transport is a first-class per-slot property (answers Q2). Three layers:

1. **Env default:** `PI_DASH_TRANSPORT=rpc|sdk` (process-wide default; ship as `rpc` initially).
2. **Per-slot override, persisted:** add `transport?: PiTransport` to the slot-state record (`session-store.ts:19` `SlotState` + `saveSlotState`/`saveSlotStateSync` at lines 255/299). `PiManager.createSlot`/`restoreSlot` accept `transport` in `PiProcessOptions` and instantiate `PiRpcSession` or `PiSdkSession` accordingly.
3. **API to set it:** `POST /api/chat/slots/:key/transport { transport }` → recreate the slot's session on the chosen transport (kill old, start new, re-adopt `sessionFile`, re-wire). Mirrors the existing `.../model` and `.../thinking` endpoints (`chat.ts:316/333`).

**Default policy (in `PiManager`):**
- Foreground slots → `sdk` (once §8 bar cleared; until then `rpc`).
- Conductor background sub-agents (spawned with the detach/background path) → `rpc` (isolated). Detected the same way `conductorDetach()` is relevant today.
- Both overridable via (2)/(3).

This is **path C delivered for free** by the interface: one SDK foreground slot next to N isolated RPC background builders, in the same server.

---

## Blast-radius mitigations (in-scope)

In-process, a WASM-OOM or uncatchable V8 abort takes down **every slot + the HTTP/WS server**. Single-user makes each incident *worse* (user loses all concurrent work). Three mitigations:

1. **Launch the server under the V8 WASM flags.** `V8_FLAGS = ['--no-wasm-tier-up','--liftoff-only','--wasm-lazy-compilation']` are launch-time isolate flags — in-process you can't apply them to a live agent, so they must move to the **dashboard server's own launch** (`run.sh` / `start.sh` / `com.sam.pi-dashboard.plist` / `pi-dashboard.service`). Cost: whole-server perf hit from disabled WASM tier-up; accepted per user decision #3. RPC slots no longer need per-spawn V8 flags (they inherit), but keep them for RPC spawns during the transition.
2. **Continuous slot-state autosave + auto-respawn.** Slot state (messages live in the session JSONL owned by pi; dashboard metadata in `saveSlotState`) is already persisted on a throttle. Add: on server boot, detect slots that were mid-turn (crash recovery) and offer resume; ensure `saveSlotStateSync` runs on the crash path too. The session JSONL is the durable record. **Blast-radius correction:** unlike an RPC child crash (loses only that one slot's in-flight turn), an in-process fatal kills the whole Node process and therefore loses **ALL slots' in-flight turns simultaneously** — an N× amplification, not "at most the current partial turn." Autosave bounds the loss to *un-persisted deltas* of every concurrently-running turn; it does not prevent the N× blast. This is the core reason isolation-sensitive slots stay on `rpc`.
3. **Per-slot error boundaries + dispose — with honest limits.** Guard three distinct failure surfaces, because a single `try/catch` around `await session.prompt()` does **not** catch them all:
   - **`await session.prompt()` throw** → try/catch here; `session.dispose()`, emit `error`/`exit` so `_wireSlotEvents` broadcasts `chat_error` exactly as an RPC child exit does today, mark slot dead (auto-respawn on next prompt via `ensureRunning`).
   - **Throws inside the `subscribe(listener)` callback body** → fired synchronously from pi's internal loop, **not** covered by the prompt try/catch. The `_translate(ev)` listener body needs its **own** try/catch that isolates the failing slot without propagating into pi's loop.
   - **Detached timer callbacks / floating promise rejections** → not covered by either. `uncaughtException` **and** `unhandledRejection` (`server.ts:761/770`) must **remain the process-level backstop** — they cannot be fully replaced by per-slot try/catch. Harden them to: keep the process alive for unrelated throws, and where the error is attributable to a slot, dispose that slot's session; otherwise log-and-continue as today.

**Honest limit:** a synchronous V8 abort / WASM-OOM is uncatchable and kills the process, taking **all** slots with it (N×). Mitigation (1) reduces its probability; (2) bounds loss to un-persisted turn deltas across all running slots; the per-slot guards in (3) only contain *recoverable* async faults. Full isolation for a given slot remains available only by keeping it on `rpc` — the reason per-slot transport exists.

---

## 8. Cutover & rollback strategy

- **"Migration done" ≠ "flag flipped."** Migration is done when: `PiSdkSession` passes the full interface test suite (both impls green), extension-UI client works on both, and one SDK slot runs A/B alongside RPC slots without FE-visible difference.
- **Flag flip bar (must clear before default → `sdk`):**
  1. **Isolation:** two concurrent SDK slots with different models/thinking levels show zero cross-talk (§4 D-verify; the slice-9 isolation test).
  2. **Latency:** streaming-delta latency (`subscribe` vs RPC JSONL round-trip) measured; SDK ≤ RPC (expected, since no serialization).
  3. **Stability:** SDK slot survives a multi-hour idle + resume without the phantom-`agent_start` regression; graceful shutdown consolidates memory as RPC does.
- **Rollback:** flip `PI_DASH_TRANSPORT=rpc` (global) or per-slot `transport:rpc`. Because both implementations coexist permanently, rollback is a config change with **no code revert** and **no data migration** (session JSONL format is shared, owned by pi).
- **Background sub-agents** stay `rpc` even after the default flips, unless explicitly opted in.

---

## 9. Dependency add

`@earendil-works/pi-coding-agent` becomes a **real dep** (currently absent — `package.json` has only express/ws/node-pty/uuid; the SDK is resolved today only because the dashboard spawns the globally-installed `pi`). `@earendil-works/pi-ai` comes in **transitively** (see O3 below).

- **ESM-only**, requires **Node ≥ 22.19** — repo is ESM + Node v24.7 → OK.
- **Version pin (O2 RESOLVED — pin).** Pin `@earendil-works/pi-coding-agent` to the **exact** version of the globally-installed `pi`, and bump in lockstep during the RPC/SDK coexistence window. They share the pi-owned session JSONL format; independent drift between the in-process SDK and the RPC child is the real skew risk. pi's own install guidance uses `--ignore-scripts` — mirror that in `deploy.sh` / `Dockerfile.test`.
- **`@earendil-works/pi-ai` (O3 RESOLVED — transitive).** `pi-ai@^0.80.3` is a **direct dep of `pi-coding-agent`**; `AuthStorage`/`ModelRegistry` come from `pi-coding-agent`, so `pi-ai` does not need to be a direct dependency. Add it as a **direct** dep **only if** the dashboard imports its types directly (e.g. `AssistantMessageEvent` / `Model` for the `_translate` signatures) — and if so, pin it to the same version as `pi-coding-agent`.

---

## Recommended slice decomposition sketch (planner owns final)

Each slice independently committable + pushable. Ordering enforces "parity seam before transport swap."

0. **Green baseline.** Fix or explicitly quarantine the pre-existing `/api/models` alias-drift test failure (89/90 today — a Bedrock Opus/Sonnet alias assertion, unrelated to this work). Either fix it, or record it as a named baseline and redefine every downstream "tests green" gate as **"no NEW failures vs the named baseline."** Without this, a real migration regression hides behind the standing red bar.
1. **Commit the migration docs** (`docs/sdk-migration-exploration.md` + `docs/sdk-migration-design.md`). Zero code. _(both currently untracked — `??` — not yet staged.)_
2. **Extension-UI client on RPC** (§6, bucket b) — new `extension_ui_request` frame, modal, `POST .../extension-ui-response`, 60s cancel-fallback, all 4 dialog return-type mappings. Fully testable on today's transport. **Land before any SDK work.**
3. **Add SDK dep** (§9) — `@earendil-works/pi-coding-agent` pinned to the global-pi version (`pi-ai` transitive; direct only if types imported). Typecheck only, zero behavior change.
4. **Extract `PiSession` interface + `PiRpcSession`** (§1, §1a, §7a) — **NOT a zero-risk rename.** Includes the enumerated call-site rewrites (§1a): 5× `pi.request()` → typed methods, 4× `pi.proc` liveness → `running`/`checkHealth()`, 2× `pi.ready`, 2× `pi.send()`, plus the 4 slot-metadata fields (`_title`/`_userRenamed`/`_tags`/`_toolsRunning`) added to the interface. `PiRpcSession` = `PiProcess` behind the interface, behavior identical; existing tests re-pointed and green (against the slice-0 baseline). **This is the strangler seam; it MUST precede the SDK impl.**
5. **Per-slot transport config surface** (§ config) — `transport` field in slot state + `PiProcessOptions` + `POST .../transport`, default `rpc`. No SDK impl yet; selecting `sdk` is a no-op/501 until slice 7.
6. **Fork-semantics spike (O5)** — 5-line runtime spike to determine whether `runtime.fork()` writes the same JSONL (in-place) or a new one. Gates the §3 fork path. Its outcome is recorded before slice 7's fork code is written.
7. **`PiSdkSession` — core parity** (§2–§5) behind `transport:sdk`, default OFF: event translation (incl. `willRetry` gating + `session_info_changed`→title), session adoption + `setRebindSession`/`setBeforeSessionInvalidate`, per-slot services, stats event-driven, race-fix port, extension-UI `uiContext`. Interface test suite passes for both impls.
8. **Blast-radius mitigations** (§ mitigations) — server launched under V8 flags; per-slot error boundary + subscribe-listener guard + dispose; harden `uncaughtException`/`unhandledRejection` backstop; crash-recovery autosave.
9. **A/B + measurement** — run one SDK slot alongside RPC; capture latency/isolation/stability numbers against the §8 bar.
10. **Flip defaults** — foreground → `sdk`; background sub-agents stay `rpc`. Only after slice 9 clears the bar.
11+. **Additive slices** (§7c), one per capability, each gated and independent: permission-gating, custom tools, tool-result middleware, custom providers (+truncation fix), tree-branching UI, live reload, programmatic compaction.

---

## Risks (load-bearing assumptions)

- **A1 — service isolation holds** (§4). If shared `ModelRegistry`/`AuthStorage` cross-talk, the model-resolver workaround breaks. _Guardrail: the slice-9 isolation test gates the flip; per-slot `rpc` is the escape hatch._
- **A2 — `agent_end.messages` shape is identical** between SDK and RPC. The entire final-message splice (`_handleEvent` agent_end, ~130 lines) is reused verbatim on this assumption. _Guardrail: a golden-transcript test comparing RPC vs SDK `agent_end` payloads for the same prompt._
- **A3 — `queue_update` + `isStreaming` fully replace `_outstandingPrompts`** (§5). If they miss a provider race, the phantom-turn queueing bug returns. _Guardrail: port the existing race tests to both impls._
- **A4 — synchronous V8 aborts remain rare** under the launch flags. Not fully mitigable in-process; `rpc` per-slot is the only true isolation.
- **A5 — SDK/global-pi version skew** doesn't corrupt session JSONL (O2).

## Open questions

- **O1 — RESOLVED.** `tool_execution_start` field is **`args`** (`{toolCallId, toolName, args}`). `input` exists only on the additive `tool_call` extension hook (§7c), not the event path. No delta.
- **O2 — RESOLVED (pin).** Pin `@earendil-works/pi-coding-agent` to the exact globally-installed pi version; bump in lockstep during coexistence (shared session JSONL format; drift is the skew risk).
- **O3 — RESOLVED (transitive).** `pi-ai@^0.80.3` is a direct dep of `pi-coding-agent`; add as a direct dashboard dep only if its types are imported directly, pinned to the same version.
- **O4 — RESOLVED.** In-process extension UI is `ExtensionUIContext` (select/confirm/input/editor/notify/setStatus/setWidget/setTitle/custom) via `bindExtensions({uiContext})`; methods return Promises (confirm→boolean, select/input/editor→string|undefined). See §6.
- **O5 — OPEN (spike, slice 6).** Whether `runtime.fork()` writes the same JSONL (in-place `branch`) or a new one (`createBranchedSession`/`forkFrom`) is not determinable from the `.d.ts` — confirm via a 5-line runtime spike **before** the §3 fork path is built. In-place + keeping the old slot alive = JSONL corruption. This is the only genuinely-open question and it's a spike, not a user decision.

## Test strategy

- **Unit / contract:** one **shared interface test suite** run against both `PiRpcSession` and `PiSdkSession` — prompt queueing (steer/followUp/isStreaming), model/thinking set, abort, session adoption, slash-command mapping, event emission shapes. This suite *is* the frozen-contract enforcement. All gates are **"no NEW failures vs the slice-0 baseline"** (the standing `/api/models` alias failure is quarantined).
- **Golden-transcript:** capture RPC `agent_end` / `message_update` / `tool_*` payloads for a fixed prompt; assert SDK translation produces byte-identical WS frames (A2, A3).
- **Isolation (integration):** two concurrent SDK slots, distinct models/thinking → assert no state bleed (gates §8).
- **Latency (integration):** measure delta-to-WS latency, SDK vs RPC.
- **Crash/dispose:** force a session throw (both from `await prompt()` **and** from inside the `subscribe` listener body) → assert `chat_error`/`chat_done` broadcast + slot marked dead + auto-respawn on next prompt, **other slots unaffected**; and that a floating rejection hits the `unhandledRejection` backstop without killing the process.
- **Manual smoke:** extension-UI modal round-trip (slice 2, on RPC); fork → new slot; resume after long idle (phantom-agent_start regression); `/reload`.
