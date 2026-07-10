# Plan: pi-dashboard RPC → SDK in-process migration

_Ordered, atomic, vertical slices derived from the approved `docs/sdk-migration-design.md` (authoritative) + `docs/sdk-migration-exploration.md` (background). The repo-root `design.md`/`plan.md` are a **different** feature (HTML/JS-viewer) — not migration sources._

## Ground rules (apply to every slice)

- **Branch:** `feature/sdk-migration` off `master` (`70ba9ca1`). Remote is personal GitHub → publish with **`git push`** (not Brazil `cr`). Each slice = one commit, pushed, as its stopping point.
- **Green bar:** every slice up to and including slice 9 must leave **"no NEW test failures vs the slice-0 baseline"** (the standing `/api/models` alias failure is the only permitted red — see slice 0). Frontend WS contract stays frozen: existing frames unchanged; adding a new frame the old FE ignores is allowed.
- **Flag state:** `PI_DASH_TRANSPORT` ships `rpc`; per-slot `transport` defaults `rpc`. **Slices 0–9 keep the SDK path OFF in production → zero behavior change.** **Slice 10 is the ONLY behavior-changing slice** (flips the foreground default to `sdk`). Slices 11+ are additive and gated behind their own flags.
- **Verification commands** (referenced by number below):
  - `V-BE` = `npm run typecheck` (backend `tsc -p backend/tsconfig.json --noEmit`)
  - `V-FE` = `cd frontend && npx tsc --noEmit`
  - `V-TEST` = `npm test` (`vitest run --config vitest.backend.config.js`) — assert **no NEW failures vs baseline**
  - `V-SMOKE` = manual browser check (only where a slice changes WS behavior)

---

### Slice 0: Green baseline — quarantine the pre-existing `/api/models` failure

**Goal**: establish an unambiguous test baseline so any downstream regression is visible instead of hiding behind the standing 89/90 red.

**Files**:
- `backend/__tests__/server-routes.test.js` — mark the failing Bedrock Opus/Sonnet alias assertion `it.skip` (or `it.fails`) with a comment linking to this plan; OR fix the alias assertion if the drift is trivially correctable.
- `docs/sdk-migration-plan.md` — record the named baseline (this file) if quarantined rather than fixed.

**Depends-on**: none.

**Acceptance**:
- `npm test` reports a clean, fully-green run (quarantined test excluded/expected-fail), OR a single explicitly-named known-red that all later gates measure against.
- No production code touched.

**Verification**:
- `V-TEST` → green (or the one named baseline failure only).

**Commit**: `test: quarantine pre-existing /api/models alias failure as migration baseline`
**Push**: `origin/feature/sdk-migration`

**Rollback**: revert the single test-file edit. No product impact.

**Flag state**: OFF (no transport code).

---

### Slice 1: Commit migration docs + create branch

**Goal**: durable record of the design/exploration on the migration branch; zero code.

**Files**:
- `docs/sdk-migration-exploration.md` (untracked `??` → tracked)
- `docs/sdk-migration-design.md` (untracked `??` → tracked)
- `docs/sdk-migration-plan.md` (this file → tracked)

**Depends-on**: 0 (branch created from clean `master`; baseline recorded).

**Acceptance**:
- `git status` shows no untracked migration docs.
- No `.ts`/`.tsx`/config change.

**Verification**:
- `V-TEST` → unchanged vs baseline (docs-only commit).

**Commit**: `docs: add SDK-migration exploration, design, and slice plan`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert` the docs commit. No product impact.

**Flag state**: OFF.

---

### Slice 2: Extension-UI client on RPC (transport-agnostic, land FIRST)

**Goal**: `confirm/select/input/editor` extension dialogs render as a web modal and round-trip a real answer, instead of the current hardcoded `cancelled:true` (`server.ts:541`). Visible new capability on **today's** RPC transport.

**Files**:
- `backend/server.ts` — in the `pi.on('extension_ui', …)` handler (`:526`): for `method ∈ {confirm,select,input,editor}` broadcast a **new** WS frame `extension_ui_request {slot,id,method,prompt,options?,defaultValue?}` instead of auto-cancelling; keep a **60s timeout → `cancelled:true`** fallback (preserve the anti-wedge wisdom for startup-path dialogs, `:531`). `setStatus/setWidget` behavior unchanged.
- `backend/routes/chat.ts` — new endpoint `POST /api/chat/slots/:key/extension-ui-response {id,cancelled?,value?}` → calls `pi.send({type:'extension_ui_response',id,…})` (the existing RPC response path, no longer hardcoded). Apply the per-method return-type mapping (confirm→boolean; select/input/editor→string|undefined).
- `frontend/src/…` — a modal component subscribing to `extension_ui_request`, POSTing the response; wire into the chat page's WS frame handling.

**Depends-on**: 1.

**Acceptance**:
- An extension dialog raised by a slot shows a modal; answering it delivers the value to the extension; the turn continues.
- No-response within 60s → auto-cancel (no wedge).
- Existing frames unchanged; `extension_ui_request` is strictly additive.

**Verification**:
- `V-BE`, `V-FE`, `V-TEST` (add a route test for the new endpoint + timeout-fallback).
- `V-SMOKE`: trigger a `confirm`/`input` dialog from an extension in a live RPC slot; confirm modal round-trip + 60s fallback.

**Commit**: `feat(ext-ui): render extension dialogs as web modals over RPC (was auto-cancel)`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert`; behavior returns to auto-cancel. Self-contained; no interface dependency.

**Flag state**: OFF (pure RPC; no SDK code). Reused unchanged by slice 7d in-process.

---

### Slice 3: Add the SDK dependency

**Goal**: `@earendil-works/pi-coding-agent` becomes a real, pinned dependency; typechecks resolve against it. Zero behavior change.

**Files**:
- `package.json` — add `@earendil-works/pi-coding-agent` pinned to the **exact** globally-installed pi version (O2). Add `@earendil-works/pi-ai` as a **direct** dep **only if** slice 7 imports its types directly (else transitive, O3).
- `package-lock.json` — regenerated.
- `deploy.sh`, `Dockerfile.test` — install with `--ignore-scripts` (mirror pi's own guidance).

**Depends-on**: 1.

**Acceptance**:
- `npm ci` resolves; SDK version === global-pi version.
- No import of the SDK in product code yet (or an unused type import only) → no behavior change.

**Verification**:
- `V-BE`, `V-FE`, `V-TEST` → unchanged vs baseline.

**Commit**: `build: add @earendil-works/pi-coding-agent (pinned to global pi) as dependency`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert` (removes dep + lockfile change).

**Flag state**: OFF.

---

### Slice 4: Extract `PiSession` interface + `PiRpcSession` (the strangler seam)

**Goal**: `PiManager`, `server.ts:_wireSlotEvents`, and `chat.ts` depend only on the `PiSession` interface; today's `PiProcess` becomes `PiRpcSession` behind it, behavior-identical. **NOT a zero-risk rename** — includes the §1a call-site rewrites.

**Files**:
- `backend/pi-session.ts` (new) — the `PiSession` interface (§1): command methods + the metadata fields `_title`/`_userRenamed`/`_tags`/`_toolsRunning` (added so `server.ts`/`chat.ts` typecheck) + `PiTransport` type. Interface `extends EventEmitter`.
- `backend/pi-manager.ts` — rename `PiProcess` → `PiRpcSession implements PiSession`; add typed methods that wrap existing RPC calls: `getSessionStats()`, `getState()` (**must surface `sessionName`**, §2), `fork(entryId)`, `getForkMessages()`, `running` getter, `checkHealth()`, `respondExtensionUi(id,{…})`. `PiManager` returns `PiSession`.
- `backend/server.ts` — `_wireSlotEvents` re-typed to `PiSession`; rewrite call sites: `:260` `request(get_session_stats)`→`getSessionStats()`; `:400` `request(get_state)`→`getState()`; `:513` `pi.proc && …`→`pi.running`; `:519`/`:541` `pi.send(…)` internalized / via `respondExtensionUi`. (`:746` `pi.dash` is a URL string — ignore.)
- `backend/routes/chat.ts` — `:127` `request(fork)`→`fork(entryId)`; `:129` `request(get_state)`→`getState()`; `:156` `request(get_fork_messages)`→`getForkMessages()`; `:322/:338` `pi.proc && pi.ready`→`pi.running`/`checkHealth()`; `:381` `pi.proc && …`→`pi.running`.
- `backend/__tests__/pi-manager.test.js` — re-pointed at the interface / `PiRpcSession` (same assertions).

**Depends-on**: 1 (branch). Does not hard-require slice 3 (interface uses no SDK types), but design orders 3 first — fine either way.

**Acceptance**:
- Every `server.ts`/`chat.ts` access typechecks against `PiSession` (no `PiProcess` concrete references remain in those files).
- `PiRpcSession` behavior is byte-identical to old `PiProcess` (same emissions, same RPC frames).
- All existing tests green vs baseline.

**Verification**:
- `V-BE`, `V-FE`, `V-TEST` (existing pi-manager/route tests pass unchanged).
- `V-SMOKE`: a normal RPC chat turn (prompt → stream → tool call → done), fork, model-change — all behave exactly as before.

**Commit**: `refactor: extract PiSession interface; PiProcess → PiRpcSession behind it`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert` (single refactor commit). No data/format change.

**Flag state**: OFF (only RPC impl exists).

---

### Slice 5: Per-slot transport config surface

**Goal**: transport is a first-class, persisted, per-slot property with an API to set it (answers Q2). Selecting `sdk` is a **no-op / 501** until slice 7 — no behavior change for `rpc` (the default).

**Files**:
- `backend/session-store.ts` — add `transport?: PiTransport` to `SlotState` (`:19`); persist in `saveSlotState`/`saveSlotStateSync` (`:255`/`:299`).
- `backend/pi-manager.ts` — `PiProcessOptions` accepts `transport`; `createSlot`/`restoreSlot` read env default `PI_DASH_TRANSPORT` (ship `rpc`) then per-slot override, and instantiate `PiRpcSession` (SDK branch throws 501/"not-yet-implemented"). Default-policy stub: background/detached slots → `rpc`.
- `backend/routes/chat.ts` — `POST /api/chat/slots/:key/transport {transport}` mirroring the `.../model` (`:316`) and `.../thinking` (`:333`) endpoints: recreate the slot's session on the chosen transport, re-adopt `sessionFile`, re-wire. For `sdk` → 501 until slice 7.
- `backend/__tests__/session-store.test.js` / `server-routes.test.js` — cover `transport` persistence + the endpoint (incl. `sdk`→501).

**Depends-on**: 4 (interface + `PiProcessOptions`).

**Acceptance**:
- `transport` round-trips through slot state save/restore.
- `POST .../transport {rpc}` recreates the slot on RPC and re-adopts the session; `{sdk}` returns 501.
- Default remains `rpc` everywhere → no behavior change.

**Verification**:
- `V-BE`, `V-FE`, `V-TEST` (new persistence + endpoint tests).
- `V-SMOKE`: set a slot's transport to `rpc` via the endpoint → slot survives, session re-adopted.

**Commit**: `feat(transport): per-slot transport field, PiProcessOptions, and set-transport endpoint (sdk=501)`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert`; slot state ignores the (now-absent) field.

**Flag state**: OFF (`sdk` selectable but 501).

---

### Slice 6: Fork-semantics spike (O5) — gates the SDK fork path

**Goal**: determine empirically whether `runtime.fork()` writes the **same** JSONL (in-place `branch`) or a **new** one (`createBranchedSession`/`forkFrom`). Records the outcome that gates slice 7d's fork code (in-place + keeping the old slot alive = JSONL corruption).

**Files**:
- `docs/spikes/fork-semantics.md` (new) — the 5-line spike script + its observed result and the decision for 7d.
- (spike script itself is throwaway — run under `/tmp` or a `scripts/spike-*.ts`, not shipped in product paths.)

**Depends-on**: 3 (SDK dep, to call `createAgentSession`/`runtime`).

**Acceptance**:
- A recorded, reproducible answer: same-file vs new-file, plus the confirmed field name (`selectedText`, not `editorText`) and `runtime.session` in-place mutation behavior.
- Decision noted for 7d: whether `PiSdkSession.fork()` must `createBranchedSession` (new file) before `chat.ts` spins up the new slot, or can reuse in-place.

**Verification**:
- Spike run output captured in the findings doc (reproducible command).
- `V-TEST` unchanged (docs/spike-only commit; no product code).

**Commit**: `docs(spike): record runtime.fork() JSONL semantics (O5) for SDK fork path`
**Push**: `origin/feature/sdk-migration`

**Rollback**: n/a (docs only).

**Flag state**: OFF. **This is a spike — its output is a decision input, not runnable production behavior.**

---

### Slice 7a: `PiSdkSession` skeleton + adoption + core event translation (flag OFF)

**Goal**: an instantiable `PiSdkSession implements PiSession` that creates a session in-process, adopts `sessionFile`, prompts, and translates the core stream (`agent_start`, `agent_end` splice, `message_update` text/thinking, `tool_execution_*`) into the **identical** internal emissions. Verified by the shared contract + golden-transcript suites — **no production slot uses it yet**.

**Files**:
- `backend/pi-sdk-session.ts` (new) — `createAgentSession` per-slot (per-slot cwd-bound services, §4), `subscribe(ev)` → `_translate(ev)` emitting the §2 core mappings; `getState()` surfaces `sessionName`; command methods (prompt/abort) as far as core parity needs.
- `backend/pi-manager.ts` — SDK branch instantiates `PiSdkSession` (still guarded; default `rpc`).
- `backend/__tests__/pi-session-contract.test.js` (new) — **shared interface suite** run against both `PiRpcSession` and `PiSdkSession`: prompt, event-emission shapes, adoption.
- `backend/__tests__/golden-transcript.test.js` (new) — capture RPC `agent_end`/`message_update`/`tool_*` payloads for a fixed prompt; assert SDK translation yields byte-identical WS frames (A2/A3 guardrail).

**Depends-on**: 3 (SDK dep), 4 (interface).

**Acceptance**:
- Contract suite passes for **both** impls for the core surface.
- Golden-transcript: SDK core emissions === RPC for the same prompt.
- Production default unchanged (`rpc`); no slot runs SDK.

**Verification**:
- `V-BE`, `V-FE`, `V-TEST` (contract + golden suites green for both impls).

**Commit**: `feat(sdk): PiSdkSession core event translation + shared contract/golden tests (flag off)`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert`; RPC untouched.

**Flag state**: OFF. Verifiable via direct-instantiation tests despite no production use.

---

### Slice 7b: `PiSdkSession` race-fix port (isStreaming / queue_update / willRetry)

**Goal**: port the `_outstandingPrompts`/`_pendingRequests` fixes to the SDK impl using authoritative `session.isStreaming` + `queue_update`, and gate terminal handling on `agent_end.willRetry === false` (track `auto_retry_start/end`). Prevents the phantom-turn class.

**Files**:
- `backend/pi-sdk-session.ts` — `prompt()` picks steer vs `streamingBehavior:'followUp'` from `session.isStreaming`; subscribe `queue_update`; `_translate` gates `chat_done`/final-splice on `willRetry === false`; track retry-in-progress so the stall detector doesn't read the gap as idle.
- `backend/__tests__/pi-session-contract.test.js` — port the existing prompt-queueing/race tests to run against **both** impls; add the phantom-`agent_start`-on-resume assertion (`isStreaming === false` after adoption).

**Depends-on**: 7a.

**Acceptance**:
- Race/queueing tests green for both impls.
- `willRetry:true` does not emit a premature `chat_done`.

**Verification**:
- `V-BE`, `V-TEST` (race suite green for both impls).

**Commit**: `feat(sdk): port prompt-queueing race-fixes + willRetry gating to PiSdkSession`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert`; only SDK-path tests/code affected.

**Flag state**: OFF.

---

### Slice 7c: `PiSdkSession` stats (event-driven) + title/thinking sync

**Goal**: SDK stats read on-demand from session state (no 4s poll); map `session_info_changed`→slot title (removes the `getState`→`sessionName` poll) and `thinking_level_changed`→`model_change`. Same WS frames.

**Files**:
- `backend/pi-sdk-session.ts` — `getSessionStats()` reads live usage; emit `context_usage`/`token_stats` on `turn_end`/`agent_end`; map `session_info_changed`→title broadcast, `thinking_level_changed`→`model_change`.
- `backend/server.ts` — `_wireSlotEvents` computes stats event-driven for SDK slots; RPC slots keep the 4s poller (behavior-preserving). Title path consumes the mapped event.
- `backend/__tests__/pi-session-contract.test.js` — stats-on-event + title-update assertions for the SDK impl.

**Depends-on**: 7a.

**Acceptance**:
- SDK slot emits identical `context_usage`/`token_stats` frames, event-driven.
- Slot title updates from `session_info_changed`; RPC poller path unchanged.

**Verification**:
- `V-BE`, `V-TEST`.

**Commit**: `feat(sdk): event-driven stats + session_info_changed/thinking_level_changed mapping`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert`; RPC poller unaffected.

**Flag state**: OFF.

---

### Slice 7d: `PiSdkSession` extension-UI `uiContext` + rebind hooks + fork

**Goal**: complete SDK parity — in-process extension UI via `ExtensionUIContext` (reusing slice-2's frame/endpoint/return-mapping), auto-rebind on session replacement, and the fork path per the slice-6 spike outcome.

**Files**:
- `backend/pi-sdk-session.ts` — `bindExtensions({uiContext})` implementing **all** methods (`select/confirm/input/editor/notify/setStatus/setWidget/setTitle/custom`); `respondExtensionUi` resolves the awaited Promise with the per-method return type (§6b). Register `runtime.setRebindSession(fn)` + `setBeforeSessionInvalidate(fn)` so fork/new/switch/import auto-rewire (no hand-rolled rebind). `fork()` implemented per slice-6 decision (new-JSONL if in-place, to preserve the "new slot, old slot killed" UX without corruption).
- `backend/__tests__/pi-session-contract.test.js` — extension-UI round-trip (both impls), rebind-after-swap, fork parity.

**Depends-on**: 7a, 6 (fork semantics), 2 (extension-UI frame/endpoint/mapping reused).

**Acceptance**:
- Extension dialogs from an SDK slot round-trip through the **same** modal/endpoint as RPC (slice 2).
- `setStatus/setWidget` emit the same `extension_ui` shapes server.ts expects.
- Fork produces the correct new session without JSONL corruption; rebind fires automatically on every replacement.

**Verification**:
- `V-BE`, `V-TEST` (contract suite fully green for both impls — migration parity "done" per §8, minus A/B).
- `V-SMOKE` (deferred to slice 9, when an SDK slot actually runs).

**Commit**: `feat(sdk): extension-UI uiContext, auto-rebind hooks, and fork parity`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert`; RPC extension-UI (slice 2) unaffected.

**Flag state**: OFF.

---

### Slice 8: Blast-radius mitigations

**Goal**: make in-process failure survivable — server under V8 WASM flags, per-slot error boundaries + subscribe-listener guard + `dispose()`, hardened `uncaughtException`/`unhandledRejection` backstop, crash-recovery autosave.

**Files**:
- `run.sh`, `start.sh`, `restart.sh`, `com.sam.pi-dashboard.plist`, `pi-dashboard.service` — launch the **server** under `--no-wasm-tier-up --liftoff-only --wasm-lazy-compilation` (launch-time isolate flags; can't apply to a live in-process agent). Keep per-spawn V8 flags for RPC child spawns during transition.
- `backend/pi-sdk-session.ts` — try/catch around `await session.prompt()` → `dispose()` + emit `error`/`exit` (so `_wireSlotEvents` broadcasts `chat_error` exactly like an RPC child exit); **separate** try/catch inside the `subscribe` listener body (isolates a failing slot without propagating into pi's loop).
- `backend/server.ts` — harden `uncaughtException` (`:761`) + `unhandledRejection` (`:770`): keep process alive for unrelated throws; where attributable to a slot, dispose that slot; else log-and-continue. Crash-recovery: ensure `saveSlotStateSync` runs on the crash path; on boot, detect mid-turn slots and offer resume.
- Tests — force a throw from `await prompt()` **and** from inside the subscribe listener; assert `chat_error`/`chat_done` broadcast, slot marked dead, auto-respawn on next prompt, **other slots unaffected**; floating rejection hits the backstop without killing the process.

**Depends-on**: 7a (mitigations wrap the SDK session lifecycle). The V8-flags-on-launch portion is independent and could land earlier if desired.

**Acceptance**:
- A crashing SDK slot is contained (chat_error + respawn); sibling slots keep running.
- Server launches under the WASM flags in all launch paths.
- `uncaughtException`/`unhandledRejection` remain the backstop (documented honest limit: a sync V8 abort still kills the process → `rpc` is the only true isolation).

**Verification**:
- `V-BE`, `V-TEST` (crash/dispose tests).
- `V-SMOKE`: confirm the server starts under the flags (log the effective V8 flags).

**Commit**: `feat(resilience): V8 launch flags, per-slot error boundaries + dispose, hardened crash backstop`
**Push**: `origin/feature/sdk-migration`

**Rollback**: `git revert` (launch scripts + guards). RPC path already tolerates child exits.

**Flag state**: OFF.

---

### Slice 9: A/B + measurement (empirical gate for the flip)

**Goal**: run **one** SDK slot alongside RPC slots and capture the numbers that gate the slice-10 flip. No default change.

**Files**:
- `docs/spikes/sdk-ab-measurement.md` (new) — recorded results against the §8 bar: (1) **isolation** — two concurrent SDK slots, different models/thinking, zero cross-talk (the A1 guardrail test); (2) **latency** — streaming-delta latency SDK ≤ RPC; (3) **stability** — SDK slot survives multi-hour idle + resume with no phantom-`agent_start`.
- `backend/__tests__/pi-session-contract.test.js` or a new integration test — the two-SDK-slot cross-talk assertion (gates the flip).

**Depends-on**: 5 (transport selectable end-to-end), 7a–7d (runnable SDK slot), 8 (mitigations in place).

**Acceptance**:
- All three §8 bar items recorded with pass/fail.
- Cross-talk test green (no `ModelRegistry`/`AuthStorage` bleed) — or the flip is **blocked** and background/foreground both stay `rpc`.

**Verification**:
- `V-TEST` (isolation test green).
- `V-SMOKE`: manually set one slot `transport:sdk` via the endpoint; run A/B; confirm no FE-visible difference; capture numbers.

**Commit**: `test(sdk): A/B isolation + latency + stability measurement vs flip bar`
**Push**: `origin/feature/sdk-migration`

**Rollback**: n/a (measurement + one test). Default still `rpc`.

**Flag state**: OFF (one slot manually opted-in for measurement only). **Requires empirical results before slice 10 may proceed.**

---

### Slice 10: Flip defaults — foreground → `sdk` (THE behavior-changing slice)

**Goal**: make `sdk` the default transport for foreground slots; conductor background sub-agents stay `rpc` (isolated). This is the cutover.

**Files**:
- `backend/pi-manager.ts` — default policy: foreground slots → `sdk`; detached/background sub-agents → `rpc`. Env `PI_DASH_TRANSPORT` still overrides globally; per-slot `transport` still overrides.

**Depends-on**: 9 (bar cleared — isolation + latency + stability all pass).

**Acceptance**:
- New foreground slots start in-process (SDK); background sub-agents remain RPC.
- FE behavior indistinguishable from RPC (frozen contract holds).

**Verification**:
- `V-TEST` → no new failures.
- `V-SMOKE`: full foreground session (prompt/stream/tool/fork/extension-UI/model-change/idle-resume) on SDK; spawn a background sub-agent → confirm it's RPC.

**Commit**: `feat(transport)!: default foreground slots to in-process SDK (background stays RPC)`
**Push**: `origin/feature/sdk-migration`

**Rollback**: **config-only, no code revert** — set `PI_DASH_TRANSPORT=rpc` (global) or per-slot `transport:rpc`. Both impls coexist permanently; session JSONL format is shared (no data migration). If code revert is preferred, revert this one-line default change.

**Flag state**: **ON for foreground (the flip).** The only slice that changes production behavior.

---

### Slices 11+: Additive features (one committable slice each — NEVER coupled to the transport swap)

**Goal**: the SDK control-surface wins, each independent, gated behind its own flag, landed only after slice 10.

Each is its own slice with its own goal/files/acceptance/verification/commit/rollback:

- **11 — Permission-gating UI**: `pi.on("tool_call")` `{block,reason}` + input mutation → approve/deny/edit modal.
- **12 — Custom tools**: `defineTool({name,parameters,execute})` via `DefaultResourceLoader({extensionFactories})` — host/browser capabilities as agent tools.
- **13 — Tool-result middleware**: `pi.on("tool_result")` redact/annotate/truncate.
- **14 — Custom providers / request interception**: `before_provider_request`/`after_provider_response` — also the right place to fix the amazon-claude-code truncation canary at source.
- **15 — Session-tree branching UI**: `session.navigateTree()` — visual branch/rewind.
- **16 — Live reload**: rebuild `ResourceLoader` instead of kill+respawn (kills the `/reload` workaround at `pi-manager.ts:448`).
- **17 — Programmatic compaction**: `session.compact(instructions)` + `session_before_compact` hook.

**Depends-on**: 10.
**Verification** (each): `V-BE`, `V-FE`, `V-TEST`, `V-SMOKE`.
**Rule**: a transport bug and a feature bug must never share an un-bisectable slice.

---

## Dependency graph & critical path

```
0 → 1 → ┬→ 2 ───────────────┐
        ├→ 3 → 4 → 5 ───────┤
        │        ├→ 7a → 7b ┤
        │        │    └ 7c  ┤
        │   6 ───┴────→ 7d ─┤   (7d needs 2, 6, 7a)
        └────────────────── 8 → 9 → 10 → 11+
```

**Critical path**: `0 → 1 → 3 → 4 → 7a → 7d → 8 → 9 → 10` (with `2` and `6` as mandatory feeders into `7d`, and `5` a mandatory feeder into `9`).

- **Parallelizable / order-flexible**: slice 2 (RPC extension-UI) is independent of the SDK chain and can land any time after slice 1 — but must precede 7d (which reuses its frame/endpoint). Slice 6 (spike) needs only slice 3 and can run early. The V8-flags portion of slice 8 is independent of the SDK impl.
- **7b and 7c** both depend only on 7a and are independent of each other (either order).

## Slices requiring a spike / empirical result before they can be gated

- **Slice 6** (fork semantics, O5) — gates **7d**'s fork code. Must be run and recorded first.
- **Slice 9** (A/B measurement) — the isolation + latency + stability numbers gate **slice 10**. The two-SDK-slot cross-talk test (A1 guardrail) is the hard gate; if it fails, the flip is blocked and slots stay `rpc`.

## Boundaries that could break "independently committable" — and the fix

- **Slice 4** looks like a rename but is the largest single refactor (call-site rewrites across `server.ts`/`chat.ts`). It stays independently committable **only** because `PiRpcSession` is behavior-identical and the existing tests are re-pointed — if any call-site rewrite changes behavior, split the offending rewrite into its own commit. Do **not** fold any SDK code into slice 4.
- **Slice 7 was split into 7a–7d** precisely so a transport bug is bisectable. Keeping it as one commit would bundle event-translation, race-fixes, stats, and extension-UI into one un-bisectable blob. Each 7x is verifiable via the growing contract/golden/race suites **even with the flag OFF** (direct instantiation) — that is what makes them non-horizontal despite no production use.
- **Slices 11+ must never be coupled to the transport swap** (design §7 rule). They land only after slice 10 and each behind its own flag.

## What can be deferred

- Everything from **slice 11 onward** is deferrable indefinitely — the migration is complete at slice 10.
- Slice 2 delivers standalone value on RPC and could ship even if the SDK migration were paused after it.
