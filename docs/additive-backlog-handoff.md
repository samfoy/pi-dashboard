# Additive-backlog handoff (slices 12–17)

Handoff for a returning developer / fresh session picking up the **additive**
phase of the SDK migration on `feature/sdk-migration`.

The RPC→SDK migration itself (slices 0–10) is **COMPLETE and LIVE** — foreground
chat slots run in-process via `PiSdkSession`; background/detached/job slots stay
isolated `PiRpcSession` subprocesses. See [`docs/sdk-migration-STATUS.md`](./sdk-migration-STATUS.md)
for the final architecture and commit ledger.

The additive backlog (slices 11–17) layers **new capabilities** on top of the SDK
control surface. **Slice 11 (permission-gating UI) is DONE** at `88421cd8`. Slices
12–17 remain. This doc captures the template slice 11 established, the process
lesson it taught, and a per-feature implementation sketch.

---

## 1. The pattern established by slice 11 (the template every additive feature follows)

Slice 11 is the reference implementation. Copy its shape:

**(a) Own flag, default OFF — ships dark.**
Each feature gets its **own** per-slot flag, persisted in slot state exactly like
`transport` and `toolApproval` (`backend/session-store.ts` `SlotState` +
`saveSlotState`), with an **optional env default** (slice 11:
`PI_DASH_TOOL_APPROVAL`, resolved by `resolveToolApproval()` in
`backend/pi-manager.ts`). **Default OFF** so the feature ships dark — zero behavior
change until a slot opts in. A live toggle endpoint flips the flag without
recreating the slot; the flag is **preserved across transport recreation**
(`recreateSlotWithTransport`).

**(b) SDK-only — uses an in-process SDK hook RPC slots can't expose.**
Every additive feature rides an in-process SDK hook (`tool_call`, `tool_result`,
`before_provider_request`, session-tree APIs, `ResourceLoader` rebuild,
`session.compact`) that a `pi --mode rpc` subprocess **cannot** surface across the
process boundary. So the feature is **SDK-only**. Document the RPC limitation and
make the RPC path a **safe no-op** rather than silently breaking it — slice 11's
`PiRpcSession.armToolApproval/respondToolApproval` are no-ops, and the frontend
toggle is **disabled on RPC slots**. Because background/detached/job slots are
pinned to `rpc` (isolation), they simply never get the feature — that is correct
and expected.

**(c) Reuse the extension-UI modal/endpoint PATTERN for any UI.**
Any feature that needs a browser decision reuses the shape slice 2 + slice 11
built — do not invent a new transport:
  - an **additive WS frame** pushed from the backend (slice 11:
    `tool_approval_request`), never a change to an existing frame's shape;
  - a **response endpoint** (`POST /api/chat/slots/:key/tool-approval-response`
    `{id, decision, editedArgs?}`);
  - a **sibling modal component** (`frontend/src/components/ToolApprovalModal.tsx`);
  - **chatSlice + useWebSocket + ChatPage wiring** (state/reducers in
    `store/chatSlice.ts`, frame handling in `hooks/useWebSocket.ts`, mount in
    `pages/ChatPage.tsx`, api methods in `api/client.ts`, types in
    `types/index.ts`).

**(d) Tests with a synthetic-event / fake-runtime seam + a mutation self-check.**
Drive the hook with a synthetic event through a fake runtime — **no live
provider** in the unit suite (slice 11: `backend/__tests__/tool-approval.test.js`
exercises OFF-passthrough/approve/deny/timeout against a fake SDK runtime). Where
the feature **mutates** state the model will see (input args, tool results,
provider requests), add a **mutation self-check** asserting the mutation actually
took effect in place (slice 11 asserts `editedArgs` rewrote `event.input`).

**(e) NEVER touch `resolveTransport` / the transport default.**
Additive features must **not** couple to the transport swap.
`resolveTransport()` and the foreground `'sdk'` default are settled — do not read,
branch on, or modify them. The whole point of slices 0–10 was to make "a transport
bug and a feature bug never land in the same un-bisectable slice." Keep it that
way: your flag resolver (`resolveToolApproval`-style) is **separate** from
`resolveTransport`.

---

## 2. CRITICAL process lesson — each additive feature is a FULL-STACK slice

Each additive feature is a **full-stack vertical slice**: backend hook + WS frame +
response endpoint + frontend modal + chatSlice/useWebSocket/ChatPage wiring +
tests. That is a lot for one builder turn.

**Slice 11 MAXED OUT a 30-minute builder and timed out mid-verify.** The commit
had already landed; the run was salvaged only by manually verifying, pushing, and
spawning the critic by hand. Do not repeat that. For slices 12–17, pick one:

- **Split each feature into two commits** — a **backend slice** (hook + flag +
  frame + endpoint + backend tests) landed first, then a **frontend slice** (modal
  + wiring + FE checks). This is the safer default; each half fits a 30-min turn
  and stays independently bisectable.
- **OR give the builder a 40–45 minute timeout** if keeping it as one full-stack
  slice.

**Reconciliation ritual for EVERY additive builder** (origin is source of truth):

```bash
git fetch origin
git reset --hard origin/feature/sdk-migration    # take the current tip
# worktree has no node_modules — symlink from the main checkout:
ln -s /local/home/samfp/pi-dashboard/node_modules node_modules
ln -s /local/home/samfp/pi-dashboard/frontend/node_modules frontend/node_modules
cd frontend && npx vite build && cd ..            # BEFORE npm test
npm test                                          # (never pipe through tail/head/grep)
```

Spawn with `merge_strategy: "none"` (origin is authoritative; do not auto-merge).
Push with `git push` to `origin/feature/sdk-migration` (personal GitHub — override
the push hook: `# steering-override: no-git-push — personal repo, plan mandates push`).

---

## 3. The six remaining features

Each behind its **own** flag, default OFF, SDK-only, following the §1 template.
The SDK-hook mapping is from [`docs/sdk-migration-exploration.md`](./sdk-migration-exploration.md)
("What NEW becomes possible") and [`docs/sdk-migration-design.md`](./sdk-migration-design.md)
§7(c).

### 12 — Custom tools
**SDK hook:** `defineTool({name, parameters, execute})` injected via the SDK
extension mechanism (`bindExtensions` / extension factories on
`resourceLoaderOptions.extensionFactories` — the same seam slice 11's `tool_call`
hook registers through).
**Sketch:** the dashboard becomes a **tool provider**, exposing host/browser
capabilities as agent tools ("read the open file", "post to this WS channel",
"query the dashboard DB", browser-side tools resolved via the frontend). Register
one or more `defineTool` factories on the SDK slot when the flag is ON; a
browser-resolved tool round-trips its `execute` result back over the additive WS
frame + response endpoint pattern (§1c). No-op on RPC slots.
**Flag:** `customTools`.

### 13 — Tool-result middleware
**SDK hook:** `pi.on("tool_result")`.
**Sketch:** rewrite/redact/annotate/**truncate** tool results **before the model
sees them** — intelligent truncation of large outputs, secret scrubbing, citation
injection. Register the `tool_result` hook on the SDK slot when the flag is ON;
the hook mutates the result in place. This is a **mutation** feature → include the
§1d mutation self-check (assert the redaction/truncation actually changed the
result the model receives). Likely needs no UI (or a lightweight audit view).
**Flag:** `toolResultMiddleware`.

### 14 — Custom providers / request interception
**SDK hook:** `before_provider_request` / `after_provider_response` hooks
(`pi.registerProvider(...)` for full custom providers).
**Sketch:** intercept the provider request/response loop in-process — per-slot
model routing, proxy/SSO injection, raw-token-stream capture, A/B providers
without touching pi's binary. **This is also the right place to fix the known
`amazon-claude-code` truncation canary at source:** a truncated stream reports
`stopReason=stop` with `totalTokens=0` — detect that in `after_provider_response`
and repair/retry there, instead of the current heuristic `agent_end` check in
`server.ts`. **Mutation** feature → §1d self-check.
**Flag:** `providerMiddleware`.

### 15 — Session-tree branching UI
**SDK hook:** `session.navigateTree()` + the `SessionManager` tree APIs
(`getTree` / `branch` / `branchWithSummary` / clone-at-position).
**Sketch:** render the session tree in the frontend and let users **branch/rewind
visually** ("edit from here" = in-file branch; "fork" = new JSONL), replacing the
current fork-file dance. This is the most **frontend-heavy** feature (a tree
visualization) — a strong candidate for the §2 backend/frontend split. Backend
exposes tree read + branch/navigate endpoints; frontend renders + wires actions.
**Flag:** `treeUi`.

### 16 — Live reload
**SDK hook:** in-process `ResourceLoader` rebuild (skills / extensions / prompts).
**Sketch:** rebuild the `ResourceLoader` **in-process** to pick up new
skills/extensions/prompts **without kill+respawn**. This **kills the `/reload`
kill+respawn workaround** currently in `backend/pi-manager.ts` (the RPC path at
`cmd === 'reload'`, ~`pi-manager.ts:491–506`, which calls `this.kill()` then
restarts because pi's RPC mode doesn't support `/reload`). On an SDK slot, re-bind
the resources live instead. No-op / keep the old kill+respawn on RPC slots.
Minimal UI (a reload button already exists; just make it live on SDK slots).
**Flag:** `liveReload`.

### 17 — Programmatic compaction
**SDK hook:** `session.compact(instructions)` + the `session_before_compact` hook.
**Sketch:** user-directed compaction — the dashboard drives smart compaction with
instructions and **shows what got dropped** (the `session_before_compact` hook
surfaces the pre-compaction state). UI shows a compaction summary/diff. Reuse the
modal/endpoint pattern for the instruction prompt + the "what was dropped" view.
**Flag:** `compactionUi`.

---

## 4. Reference docs

- [`docs/sdk-migration-exploration.md`](./sdk-migration-exploration.md) — each new
  capability and its exact SDK hook ("What NEW becomes possible").
- [`docs/sdk-migration-design.md`](./sdk-migration-design.md) §7 — the feature
  classification / additive rule (§7(c): "SEPARATE post-cutover slices, NEVER
  coupled to the transport swap").
- [`docs/sdk-migration-STATUS.md`](./sdk-migration-STATUS.md) — final architecture,
  transport policy, commit ledger, known follow-ups.
- [`docs/spikes/sdk-ab-measurement.md`](./spikes/sdk-ab-measurement.md) — the
  live-validation harness + results (fixture fidelity, cross-talk isolation,
  latency).

---

## 5. Still-open migration follow-ups (carry forward)

These are pre-existing follow-ups from the migration phase — not additive
features, but keep them on the radar (detail in `docs/sdk-migration-STATUS.md` §7):

- **Slice-0 `/api/models` unskip** — fix the aliased route and un-skip the
  quarantined baseline test in `backend/__tests__/server-routes.test.js`.
- **Make `STATE_FILE` injectable** — `~/.pi/agent/pi-web-sessions.json` isn't
  injectable, so some tests touch the real file.
- **Longer-horizon live checks** (non-blocking, need induced faults / long
  horizons): item 3 retry-exhaustion cleanup, item 7 multi-hour stability, item 10
  live crash → sibling survival.
- **Pre-slice-5 persisted-slot restore** — slots persisted before the `transport`
  field existed restore under the foreground `'sdk'` default (one-time upgrade
  window; set `PI_DASH_TRANSPORT=rpc` during upgrade if pre-flip RPC is wanted).
- **Dead `PiSdkSession.conductorDetach()` field-flip tidy** — detach now goes
  through `recreateSlotWithTransport(key,'rpc')`; the old in-place field-flip
  method is effectively dead code on the interface. Tidy later.
