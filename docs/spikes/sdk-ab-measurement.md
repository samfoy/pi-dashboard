# SDK A/B measurement — the live-validation checklist that gates the flip

> **Status: TEMPLATE. All result cells are `TBD` until the USER runs this live.**
> Slice 9 of the SDK-migration plan builds this doc + the harness it drives.
> Slice 9 itself is **flag OFF** — nothing here changes the default transport.
> The **only** slice that flips a default is slice 10, and it **MUST NOT** be
> done until the hard gates (items 1 and 5) *and* the rest of the §8 bar pass
> live and are recorded below.

This doc closes the gap the 7a critic flagged: the golden-transcript test is
**fixture-relative** (it proves the SDK and RPC translators agree on hand-built
events), not **live-relative** (it does not prove those fixtures match what a
real SDK session emits). The `validate-event-fixtures.ts` harness here is the
live-relative half, and the two-slot isolation test is the concurrency half.
Together with the latency + stability runs they are the empirical gate for
slice 10 (design §8; plan Slice 9 / Slice 10).

---

## 0. Prerequisites (READ FIRST)

- A machine with **pi auth configured** (a live LLM provider). The unattended
  build session cannot run any of the live steps — that is the whole reason
  this doc exists.
- Repo `pi-dashboard`, branch `feature/sdk-migration`, built:
  `npm run typecheck && (cd frontend && npx vite build)`.
- **PREREQUISITE — product-code unblock, NOT part of the slice-9 commit.**
  The opt-in endpoint currently refuses `sdk`:

  ```ts
  // backend/routes/chat.ts — the transport endpoint STILL has a stale guard:
  if (transport === 'sdk') {
    return res.status(501).json({ error: 'SDK transport not implemented until slice 7' })
  }
  ```

  Slices 7a–7d are done, so this guard is stale. **Before the FE-driven live
  steps (items 4, 8, 10)**, delete those three lines so the endpoint recreates
  the slot on `sdk` (the code below the guard already does the swap correctly).
  This is a product-code behavior change and is intentionally **not** in the
  slice-9 harness commit — land it as its own tiny commit when starting the live
  run. The `measure-sdk-latency.ts` / `validate-event-fixtures.ts` harnesses
  construct `PiSdkSession` directly and do **not** need this unblock; only the
  browser-driven E2E items do.

---

## 1. The commands

### 1a. Opt ONE slot into SDK (browser-driven items 4, 8, 10)

After the prerequisite unblock above, with the dashboard running:

```bash
# find the slot key in the FE, then:
curl -sS -X POST "http://localhost:${PI_DASH_PORT:-7777}/api/chat/slots/<KEY>/transport" \
  -H 'Content-Type: application/json' \
  -H "Origin: http://localhost:${PI_DASH_PORT:-7777}" \
  -d '{"transport":"sdk"}'
# → {"ok":true,"key":"<KEY>","transport":"sdk"}   (was 501 before the unblock)
```

Leave every OTHER slot on `rpc`. That gives you the one-SDK-slot-next-to-N-RPC-slots
configuration slice 9 measures. Roll back any slot with `-d '{"transport":"rpc"}'`.

### 1b. Latency harness (item 6) — no endpoint needed

```bash
PI_DASH_MODEL_PROVIDER=<provider> PI_DASH_MODEL_ID=<model> \
PI_AB_PROMPT="Reply with exactly the word: pong." PI_AB_RUNS=5 \
npx tsx scripts/measure-sdk-latency.ts
```

Prints per-run + mean TTFD (time-to-first-delta), TURN (total), and delta count
for an SDK slot vs an RPC slot on the SAME prompt, and a PASS/FAIL for
"SDK TTFD <= RPC TTFD".

### 1c. Fixture-fidelity harness (item 1 — HARD GATE half) — no endpoint needed

```bash
PI_DASH_MODEL_PROVIDER=<provider> PI_DASH_MODEL_ID=<model> \
PI_FIX_PROMPT="Use a tool to list the files in the current directory, then tell me how many there are in one sentence." \
npx tsx scripts/validate-event-fixtures.ts
```

Runs a live SDK slot, captures the REAL `AgentSessionEvent`s, and diffs their
`type` names + field shapes against the shape catalog mirrored from the golden
fixtures (`backend/__tests__/golden-transcript.test.js`) plus the
`session_info_changed` / `thinking_level_changed` shapes. Exit 0 = PASS; exit 2
= precise diff (unknown event type or a known type missing a field the
translator reads). Use a tool-exercising prompt for full coverage.

### 1d. Two-SDK-slot cross-talk isolation test (item 5 — HARD GATE unit half)

```bash
npx vitest run --config vitest.backend.config.js backend/__tests__/sdk-isolation.test.js
```

Runs headless (no provider) — it is part of the normal `npm test` suite. It
proves `PiSdkSession`'s OWN per-instance model/thinking/registry state is
isolated across two slots, and includes a mutation self-check that shows a
deliberately-shared mutable session WOULD be caught. **This is necessary but not
sufficient** — see item 5's live note below.

---

## 2. The §8 flip bar — checklist (record PASS/FAIL + numbers here)

| # | Bar item | Gate | How to verify | Result |
|---|----------|------|---------------|--------|
| 1 | **Fixture fidelity** — live SDK events match the golden fixtures (core events + `session_info_changed`/`thinking_level_changed` shapes) | **HARD GATE** | `scripts/validate-event-fixtures.ts` (1c) | `TBD` |
| 2 | `getState()` → `sessionName` live read returns the real session name | — | opt a slot to SDK, rename via FE, confirm the slot title updates (no poll error) | `TBD` |
| 3 | `willRetry` retry-exhaustion cleanup releases `running` (no stuck spinner after final failure) | — | force a provider error to exhaust auto-retry on an SDK slot; confirm spinner clears + `chat_error` | `TBD` |
| 4 | Live SDK chat E2E (prompt → stream → tool → done) FE-identical to RPC | — | side-by-side SDK vs RPC slot, same prompt, compare rendered transcript | `TBD` |
| 5 | **Two-SDK-slot cross-talk isolation** — different models/thinking, zero bleed | **HARD GATE** | `sdk-isolation.test.js` (1d, unit) **AND** the live two-slot run in §3 | `TBD` |
| 6 | Latency: SDK streaming-delta latency ≤ RPC | — | `scripts/measure-sdk-latency.ts` (1b) | `TBD` |
| 7 | Stability: multi-hour idle + resume → no phantom `agent_start`; bounded memory growth; WASM-OOM blast radius understood | — | §4 below | `TBD` |
| 8 | Live model/thinking round-trip on an SDK slot | — | change model + thinking via FE on the SDK slot; confirm chip updates + next turn uses it | `TBD` |
| 9 | `_init` / `createAgentSessionRuntime` live adoption path (resume an existing `sessionFile` into an SDK slot) | — | opt a slot with existing history to SDK; confirm prior messages load + next turn continues | `TBD` |
| 10 | Live SDK-slot crash → siblings keep streaming (slice-8 blast-radius) | — | trigger a recoverable fault on the SDK slot mid-turn while an RPC sibling streams; confirm sibling unaffected + SDK slot respawns on next prompt | `TBD` |

Record the raw latency table (item 6) here:

```
transport   TTFD(ms)   TURN(ms)   deltas
RPC         TBD        TBD        TBD
SDK         TBD        TBD        TBD
```

Record the fixture-fidelity observed-types list (item 1) here:

```
TBD — paste the "Live event types observed" block from validate-event-fixtures.ts
```

---

## 3. Item 5 live confirmation — what the unit test CANNOT prove

`sdk-isolation.test.js` injects fake per-slot `_session` objects, so it proves
`PiSdkSession`'s per-instance state + dispatch is isolated. It does **not**
exercise the REAL `createAgentSessionServices({ cwd })` / `ModelRegistry` /
`AuthStorage` wiring. The actual §4 D-verify risk — whether pi's genuinely
process-shared `ModelRegistry`/`AuthStorage` stay read-only under two concurrent
**live** SDK slots — can only be confirmed live:

1. Open **two** SDK slots (both opted in via 1a), different cwds.
2. Set slot A to model X + thinking `low`; slot B to model Y + thinking `high`.
3. Run a turn on each **concurrently**.
4. Assert: A's responses use model X / thinking `low`; B's use Y / `high`; no
   slot's model or thinking chip changes when the other's does; `getState()` on
   each returns its own model.

If ANY bleed is observed, the flip is **blocked** and both foreground and
background stay `rpc` (per-slot `rpc` is the escape hatch). Record: `TBD`.

---

## 4. Item 7 stability run

1. **Idle + resume:** open an SDK slot, run a turn, leave it idle multi-hour (or
   simulate by restarting the server and re-adopting the `sessionFile`). On
   resume, send a prompt; confirm NO phantom `agent_start` (the slot must not
   queue behind a nonexistent turn — `session.isStreaming === false` after
   adoption). Record: `TBD`.
2. **Memory:** capture RSS before/after a multi-turn SDK session; confirm
   graceful shutdown consolidates memory as RPC does. Record: `TBD`.
3. **WASM-OOM blast radius:** understood + accepted, not "fixed" — a synchronous
   V8 abort / WASM-OOM kills the whole process (all slots, N× loss). The
   slice-8 mitigations (V8 launch flags, autosave, per-slot error boundaries)
   reduce probability + bound loss but do not make it survivable. Confirm the
   server launches under the V8 flags. Record: `TBD`.

---

## 5. Slice 10 — DO NOT DO THIS UNTIL THE BAR IS GREEN

**Slice 10 (flipping the default to `sdk`) MUST NOT be started until items 1 and
5 (the hard gates) pass live AND items 2, 3, 4, 6, 7, 8, 9, 10 are recorded as
PASS above.** If the two-SDK-slot cross-talk check (item 5) fails, the flip is
blocked and both foreground and background stay `rpc`.

Once the bar is green, slice 10 is a trivial default change in
`backend/pi-manager.ts` `resolveTransport()` — today it defaults to `'rpc'`:

```ts
// backend/pi-manager.ts — resolveTransport()
// BEFORE (slice 9, flag OFF):
return override ?? envTransport ?? 'rpc'
// AFTER (slice 10, the flip — foreground → sdk; background stays rpc because
// conductorDetach() imperatively forces this.transport = 'rpc' at detach time):
return override ?? envTransport ?? 'sdk'
```

Rollback is config-only, no code revert: set `PI_DASH_TRANSPORT=rpc` globally or
`transport:rpc` per slot. Both implementations coexist permanently and the
session JSONL format is shared (owned by pi), so there is no data migration.
