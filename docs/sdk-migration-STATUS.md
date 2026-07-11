# SDK-migration status + live-validation handoff

Authoritative "where things stand + what you do next" note for the RPC→SDK
in-process migration on `feature/sdk-migration`. This is a handoff for the repo
owner returning to the work — it does not duplicate the design/plan/spike, it
points at them:

- Design & rationale: [`docs/sdk-migration-design.md`](./sdk-migration-design.md)
- Ordered slice plan: [`docs/sdk-migration-plan.md`](./sdk-migration-plan.md)
- Live-validation checklist + harness: [`docs/spikes/sdk-ab-measurement.md`](./spikes/sdk-ab-measurement.md)
- Fork-semantics spike (O5): [`docs/spikes/fork-semantics.md`](./spikes/fork-semantics.md)

---

## 1. TL;DR

Slices 0–9 of the RPC→SDK in-process migration are **COMPLETE and merged** on
`feature/sdk-migration` (17 commits, base `70ba9ca1`, tip `f6932f3f`).

Delivered: a full `PiSession` strangler interface with two implementations
(`PiRpcSession`, `PiSdkSession`), per-slot transport selection, full SDK parity
(events, race-fixes, stats, extension-UI, model/command ops, fork), blast-radius
mitigations, and a live-validation harness.

**The default transport is still `rpc` — no behavior change has shipped.** The
only remaining step (slice 10, the default flip) is **DEFERRED to the user
pending live validation**, because it requires a live LLM provider that the
automated build session cannot use.

Test suite: **196 pass / 1 skip.**

---

## 2. Commit ledger

Read directly from `git log --oneline 70ba9ca1..f6932f3f` (oldest first):

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

17 commits total.

---

## 3. What works now

The strangler architecture is fully in place, all behind an OFF-by-default flag.

- **`PiSession` interface** — the strangler seam. Both transports implement it;
  call-sites in `server.ts` / `chat.ts` are transport-agnostic.
- **`PiRpcSession`** — behavior-identical to the old `PiProcess` (a renamed,
  re-pointed refactor; existing tests re-target it unchanged).
- **`PiSdkSession`** — in-process session via the SDK's `createAgentSession`;
  no child process for the agent loop.
- **Per-slot `transport`** — resolved by `resolveTransport()` in
  `backend/pi-manager.ts`: per-slot override wins, then `PI_DASH_TRANSPORT` env
  default, else `'rpc'`. Opt-in endpoint: `POST /api/chat/slots/:key/transport`
  with `{transport:'rpc'|'sdk'}` recreates the slot on the chosen transport and
  re-adopts its session file.
- **Foreground→sdk / background→rpc policy** — background/detached slots always
  run `rpc`; `conductorDetach()` imperatively forces `this.transport = 'rpc'` at
  detach time (no background signal exists at slot-creation time).
- **Event translation byte-identical to RPC** — proven by the golden-transcript
  test (`backend/__tests__/golden-transcript.test.js`); the SDK translator and
  the RPC translator agree on hand-built events.
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

**Test suite: 196 pass / 1 skip** (`npm test`; the 1 skip is the quarantined
`/api/models` baseline from slice 0 — see §7).

---

## 4. How to run live validation (slice 9 live steps)

The runnable checklist is [`docs/spikes/sdk-ab-measurement.md`](./spikes/sdk-ab-measurement.md).
It **requires a machine with pi auth configured (a live LLM provider)** — the
automated build session cannot run any of it, which is why this handoff exists.

Flow:

1. Build: `npm run typecheck && (cd frontend && npx vite build)`, start the
   dashboard server.
2. Opt **one** slot into SDK — leave every other slot on `rpc`:
   ```bash
   curl -sS -X POST "http://localhost:${PI_DASH_PORT:-7777}/api/chat/slots/<KEY>/transport" \
     -H 'Content-Type: application/json' \
     -H "Origin: http://localhost:${PI_DASH_PORT:-7777}" \
     -d '{"transport":"sdk"}'
   ```
3. **Fixture fidelity** (HARD GATE, item 1): `npx tsx scripts/validate-event-fixtures.ts`
   — runs a live SDK slot and diffs the REAL `AgentSessionEvent`s against the
   golden-fixture shape catalog. No endpoint needed.
4. **Latency** (item 6): `npx tsx scripts/measure-sdk-latency.ts` — SDK vs RPC
   TTFD/TURN on the same prompt. No endpoint needed.
5. **Two-SDK-slot cross-talk** (HARD GATE, item 5): unit half is
   `sdk-isolation.test.js` (in `npm test`); the **live** half (§3 of the spike)
   is two live SDK slots with different models/thinking, run concurrently, asserting
   zero bleed.
6. Work the rest of the 10-item §8 flip bar and record PASS/FAIL + numbers in the
   spike doc.

**Hard gates (both must pass live before the flip):**

- **Item 1 — Fixture fidelity:** live SDK events match the golden fixtures (core
  events + `session_info_changed`/`thinking_level_changed` shapes).
- **Item 5 — Two-SDK-slot cross-talk isolation:** different models/thinking,
  zero bleed — unit test **and** the live two-slot run.

If item 5 fails live, the flip is **blocked** and both foreground and background
stay `rpc` (per-slot `rpc` is the escape hatch).

---

## 5. Slice 10 — the flip (user action)

Once the hard gates + the rest of the §8 bar pass live, the flip is a **one-line
default change** in `backend/pi-manager.ts` `resolveTransport()`:

```ts
// BEFORE (slices 0–9, flag OFF):
return override ?? envTransport ?? 'rpc'
// AFTER (slice 10 — foreground → sdk; background stays rpc because
// conductorDetach() forces this.transport = 'rpc' at detach time):
return override ?? envTransport ?? 'sdk'
```

**MUST NOT be done until the hard gates (items 1 and 5) pass live** and the rest
of the §8 bar is recorded PASS.

**Rollback (config-only, no code revert):** revert the one-liner, or set
`PI_DASH_TRANSPORT=rpc` globally, or `transport:'rpc'` per slot. Both
implementations coexist permanently and the session JSONL format is shared
(owned by pi), so there is no data migration.

---

## 6. Deferred additive backlog (slices 11–17)

Post-flip, each behind its **own** flag, **never** coupled to the transport swap:

| Slice | Feature |
|-------|---------|
| 11 | Permission-gating UI (`tool_call` block + mutate) |
| 12 | Custom tools (`defineTool`) |
| 13 | Tool-result middleware |
| 14 | Custom providers |
| 15 | Session-tree branching UI |
| 16 | Live skill/extension reload |
| 17 | Programmatic compaction |

---

## 7. Known follow-ups / tech debt

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
  remains the only true isolation and stays per-slot selectable.

---

## 8. Honest risk statement

The byte-identical event parity is proven against **hand-built fixtures** and the
real SDK `.d.ts` types — not yet against a live SDK event stream. Final
confirmation that the REAL SDK events match the fixtures is the fixture-fidelity
live step (§4 item 1). **Until that passes, treat the flip as unvalidated.**
