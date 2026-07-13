# SDK-migration status

Authoritative "where things stand" note for the RPC→SDK in-process migration on
`feature/sdk-migration`. The migration is **complete and live**. This note does
not duplicate the design/plan/spike, it points at them:

- Design & rationale: [`docs/sdk-migration-design.md`](./sdk-migration-design.md)
- Ordered slice plan: [`docs/sdk-migration-plan.md`](./sdk-migration-plan.md)
- Live-validation checklist + harness: [`docs/spikes/sdk-ab-measurement.md`](./spikes/sdk-ab-measurement.md)
- Fork-semantics spike (O5): [`docs/spikes/fork-semantics.md`](./spikes/fork-semantics.md)

---

## 1. TL;DR

The RPC→SDK in-process migration is **COMPLETE, merged, and LIVE-VALIDATED** on
`feature/sdk-migration` (base `70ba9ca1`).

Delivered: a full `PiSession` strangler interface with two implementations
(`PiRpcSession`, `PiSdkSession`), per-slot transport selection, full SDK parity
(events, race-fixes, stats, extension-UI, model/command ops, fork), blast-radius
mitigations, a live-validation harness, and **the slice-10 default flip**.

**Foreground user chat slots now run in-process via `PiSdkSession` (the flip is
live).** Background/detached/job slots stay isolated `PiRpcSession` subprocesses.
The three flip gates passed against a live LLM provider: fixture fidelity (item 1,
HARD), two-slot cross-talk isolation (item 5, HARD), and latency (item 6).

**Global rollback remains config-only:** `PI_DASH_TRANSPORT=rpc` (or `transport:'rpc'`
per slot) forces every slot back onto the isolated RPC subprocess — no code revert,
no data migration (session JSONL is pi-owned and shared).

**The additive phase has begun.** Slice 11 (permission-gating UI) is DONE at
`88421cd8` behind its own `toolApproval` flag (default OFF, ships dark).
Slices 12–17 remain — see [`docs/additive-backlog-handoff.md`](./additive-backlog-handoff.md)
for the per-feature SDK-hook mapping and the full-stack-slice process lesson.

Test suite: **220 pass / 1 skip.**

---

## 2. Commit ledger

Read directly from `git log --oneline 70ba9ca1..HEAD` (oldest first):

| Commit | Slice | Description |
|--------|-------|-------------|
| `95854944` | 0 | Quarantine pre-existing `/api/models` alias failure as migration baseline |
| `3c66169f` | 1 | Add SDK-migration exploration, design, and slice plan docs |
| `f3c1b6ff` | 2 | Render extension dialogs as web modals over RPC (was auto-cancel) |
| `d8ce0245` | 3 | Add `@earendil-works/pi-coding-agent` (pinned 0.80.3) as dependency |
| `5d58ede7` | 4 | Extract `PiSession` interface; `PiProcess` → `PiRpcSession` behind it |
| `5b940e32` | 5 | Per-slot `transport` field, `PiProcessOptions`, set-transport endpoint (sdk=501) |
| `75087463` | 5 | Assign per-slot transport on `PiRpcSession` + test with teeth |
| `b7fe6607` | 6 | Record `runtime.fork()` JSONL semantics (O5) for SDK fork path |
| `2cc0c461` | 7a | `PiSdkSession` core event translation + shared contract/golden tests (flag off) |
| `f247dffb` | 7b | Port prompt-queueing race-fixes + `willRetry` gating to `PiSdkSession` |
| `8b832869` | 7c | Event-driven stats + `session_info_changed`/`thinking_level_changed` mapping |
| `7b02d12c` | 7d | Extension-UI `uiContext`, auto-rebind hooks, and fork parity |
| `a00749a3` | 7e | Model/command ops (`setModel`/`setThinkingLevel`/`getAvailableModels`/`getCommands`) |
| `ee7ce1bc` | 8 | V8 launch flags, per-slot error boundaries + dispose, hardened crash backstop |
| `90c1c1fd` | 9 | A/B isolation test + latency/fixture-fidelity harness + live-validation checklist |
| `11c2ae6f` | 9 (unblock) | Enable sdk transport endpoint now that `PiSdkSession` is complete (7a–7e) |
| `f6932f3f` | 9 (follow-up) | Add real cross-talk assertion to isolation test + honest header |
| `627c401c` | 9 (docs) | SDK-migration status + live-validation handoff |
| `6af8dfcc` | 10 | Live 2-slot cross-talk isolation probe (flip bar item 5) |
| `8407050d` | 10 | **Flip foreground default `rpc`→`sdk`** (live gates passed) |
| `28560199` | 10 | Record live A/B measurement results + slice-10 flip |
| `ab84e43a` | 10 (fix) | Reconstruct detached/background/job slots as isolated `PiRpcSession` (restore decision #2) |
| `94568ce0` | follow-up | Assert scheduled jobs create isolated rpc slots (background isolation guard) |
| `8cb8d334` | 10 (docs) | STATUS refresh — slice-10 flip live + isolation fix complete |
| `88421cd8` | 11 | **Permission-gating UI** — approve/deny/edit tool calls (own `toolApproval` flag, default OFF) |

25 commits + this doc-refresh commit = **26 total** (the doc cannot list its own
hash; find it with `git log --oneline 70ba9ca1..HEAD`). Verify with
`git rev-list --count 70ba9ca1..HEAD` — the pre-refresh count is 25.

---

## 3. What works now (final architecture)

The strangler architecture is fully in place and the foreground flip is live.

**Transport policy (as shipped):**

- **Foreground user chat slots → in-process `PiSdkSession`.** The slice-10 flip:
  `resolveTransport()` foreground default is `'sdk'`.
- **Background / detached (conductor sub-agents) + scheduled jobs → isolated
  `PiRpcSession` subprocess.** Scheduled/manual jobs pin `transport:'rpc'` at
  `createSlot` time (`backend/routes/jobs.ts` `runJob`); the conductor-detach
  route **reconstructs** a foreground SDK slot as a `PiRpcSession` subprocess
  (via the shared `recreateSlotWithTransport` helper), not a mere field flip.
- **Fork inherits the parent slot's transport** — forking an RPC slot stays RPC,
  forking an SDK slot stays SDK.
- **Global rollback:** `PI_DASH_TRANSPORT=rpc` forces every slot back to the
  isolated RPC subprocess; a per-slot `transport:'rpc'` override does the same
  for one slot.

**Capabilities:**

- **`PiSession` interface** — the strangler seam. Both transports implement it;
  call-sites in `server.ts` / `chat.ts` are transport-agnostic.
- **`PiRpcSession`** — behavior-identical to the old `PiProcess` (a renamed,
  re-pointed refactor; existing tests re-target it unchanged).
- **`PiSdkSession`** — in-process session via the SDK's `createAgentSession`;
  no child process for the agent loop.
- **Per-slot `transport`** — resolved by `resolveTransport()` in
  `backend/pi-manager.ts`: per-slot override wins, then `PI_DASH_TRANSPORT` env
  default, else the `'sdk'` foreground default. Opt-in/switch endpoint:
  `POST /api/chat/slots/:key/transport` with `{transport:'rpc'|'sdk'}` recreates
  the slot on the chosen transport and re-adopts its session file.
- **Event translation byte-identical to RPC** — proven by the golden-transcript
  test (`backend/__tests__/golden-transcript.test.js`) AND confirmed live against
  a real SDK event stream (fixture-fidelity gate, item 1).
- **Race-fix parity** — `isStreaming` / `queue_update` / `willRetry` gating
  ported into `PiSdkSession`.
- **Event-driven stats** — plus `session_info_changed` / `thinking_level_changed`
  mapping.
- **Extension-UI web modals** — extension dialogs render as web modals over both
  transports (RPC path landed first in slice 2, reused by 7d).
- **Fork parity** — SDK fork path built against the recorded `runtime.fork()`
  JSONL semantics from the O5 spike.
- **Resilience** — V8 launch flags, per-slot error boundaries + dispose, and a
  hardened crash backstop.

**Test suite: 220 pass / 1 skip** (`npm test`; the 1 skip is the quarantined
`/api/models` baseline from slice 0 — see §7).

---

## 4. Live validation results (slice 9 + slice 10 gates)

The flip gates were run against a **live LLM provider** (see
[`docs/spikes/sdk-ab-measurement.md`](./spikes/sdk-ab-measurement.md) for the raw
tables and reproduce commands). Results:

| Item | Gate | Result |
|------|------|--------|
| 1 | **Fixture fidelity** (HARD) | **PASS** — `scripts/validate-event-fixtures.ts` ran a live SDK slot; every real `AgentSessionEvent` type is in the golden-fixture catalog and carries the fields the translator reads (core stream + `session_info_changed`). |
| 5 | **Two-SDK-slot cross-talk isolation** (HARD) | **PASS** — `scripts/probe-2slot-isolation.ts` stood up two concurrent live SDK slots with distinct models (haiku / sonnet, different cwds); each kept its own per-slot `modelRegistry`, and mutating slot A (`setModel`/`setThinkingLevel`) left slot B unchanged. Zero bleed. |
| 6 | **Latency** (SDK ≤ RPC) | **PASS** — over 3 runs: SDK TTFD ~12.8s / TURN ~13.0s vs RPC TTFD ~15.4s / TURN ~15.6s. SDK is faster. |

Both hard gates (1, 5) cleared → the flip proceeded.

**Deferred longer-horizon live checks** (documented in the spike doc,
non-blocking — need induced faults / long horizons, not doable in a single run):

- **Item 3 — retry-exhaustion cleanup:** verify a real retry-exhaustion (no final
  `agent_end{willRetry:false}`) releases `running`/`_outstandingPrompts`.
- **Item 7 — multi-hour stability:** memory growth over a long-running in-process
  session.
- **Item 10 — live crash → sibling survival:** induce an SDK-slot fault and
  confirm sibling slots + the server survive (bounded by the honest sync-abort
  limit in §7).

Items 2/4/8/9 are proven at the backend level; browser round-trips are optional
follow-ups.

---

## 5. Slice 10 — the flip (DONE, live)

The flip shipped in `8407050d` — a one-line default change in
`backend/pi-manager.ts` `resolveTransport()`:

```ts
// BEFORE (slices 0–9, flag OFF):
return override ?? envTransport ?? 'rpc'
// AFTER (slice 10 — foreground → sdk):
return override ?? envTransport ?? 'sdk'
```

Background isolation was then restored in `ab84e43a`: because background/job/
detached slots are created via the same `createSlot` path, the foreground `sdk`
default would have silently run them in-process. The fix pins jobs to
`transport:'rpc'` and makes the conductor-detach route **reconstruct** an SDK
slot as a `PiRpcSession` subprocess (shared `recreateSlotWithTransport` helper) —
not the old field-flip. Guarded by `backend/__tests__/detach-isolation.test.js`
(detach reconstruction + jobs-create-rpc caller-path test).

**Rollback (config-only, no code revert):** revert the one-liner, or set
`PI_DASH_TRANSPORT=rpc` globally, or `transport:'rpc'` per slot. Both
implementations coexist permanently and the session JSONL format is shared
(owned by pi), so there is no data migration.

---

## 6. Additive backlog (slices 11–17)

Post-flip features, each behind its **own** flag (default OFF, ships dark),
**never** coupled to the transport swap. **The additive phase has begun.** Full
per-feature SDK-hook mapping, the full-stack-slice process lesson, and the slice-11
template are in [`docs/additive-backlog-handoff.md`](./additive-backlog-handoff.md).

| Slice | Feature | Flag | Status |
|-------|---------|------|--------|
| 11 | Permission-gating UI (`tool_call` block + mutate) | `toolApproval` | **DONE** (`88421cd8`) |
| 12 | Custom tools (`defineTool`) | `customTools` | pending |
| 13 | Tool-result middleware (`tool_result`) | `toolResultMiddleware` | pending |
| 14 | Custom providers (`before/after_provider_*`) | `providerMiddleware` | pending |
| 15 | Session-tree branching UI (`session.navigateTree`) | `treeUi` | pending |
| 16 | Live skill/extension reload (`ResourceLoader` rebuild) | `liveReload` | pending |
| 17 | Programmatic compaction (`session.compact`) | `compactionUi` | pending |

---

## 7. Known follow-ups / tech debt

- **Upgrade-window transport persistence:** slots persisted **before** the
  slice-5 `transport` field existed have no `transport` in their saved state, so
  on restore `resolveTransport()` applies the foreground default — now `'sdk'`.
  This only affects the one-time upgrade window; every new job/detached slot
  persists `transport:'rpc'` explicitly, and foreground slots are meant to be
  `sdk` anyway. Set `PI_DASH_TRANSPORT=rpc` during the upgrade if pre-flip RPC
  behavior is wanted for old slots.
- **`PiSdkSession.conductorDetach()` is effectively dead code:** detach now goes
  through the route's `recreateSlotWithTransport(key,'rpc')` reconstruction, which
  supersedes the old in-place field-flip. The method remains on the interface
  (harmless; only reachable if something bypasses the route). Tidy later.
- **Un-skip the `/api/models` baseline:** `backend/__tests__/server-routes.test.js`
  has the quarantined pre-existing `/api/models` alias failure (slice 0). Fix the
  alias and un-skip the test.
- **Make `STATE_FILE` injectable:** `~/.pi/agent/pi-web-sessions.json` isn't
  injectable, so some tests touch the real file. Make it injectable.
- **`start.sh` vs systemd path (cosmetic):** `start.sh` references
  `backend/server.js` (works via tsx `.js`→`.ts` resolution) while the systemd
  unit uses `server.ts`. Cosmetic; align when convenient.
- **Honest isolation limit:** a synchronous V8 abort / WASM-OOM is uncatchable
  and kills all in-process slots (N× loss). The slice-8 mitigations reduce
  probability and bound loss but do not make it survivable. `rpc` transport
  remains the only true isolation and stays per-slot selectable — which is why
  background/job/detached slots are pinned to it.

---

## 8. Honest risk statement

Byte-identical event parity is proven against the golden fixtures **and**
confirmed live against the real SDK event stream (fixture-fidelity gate, item 1
— PASS). The flip is validated for the exercised event set. Not-yet-exercised
surfaces (recorded in the spike doc): `extension_ui`, `queue_update`,
`auto_retry_*`, `thinking_level_changed` were not emitted by the validation
prompt — they route through the same translator paths the golden test covers, but
have not been seen from a live stream. The longer-horizon live checks (§4: retry
exhaustion, multi-hour stability, live crash→sibling survival) remain open and
non-blocking.
