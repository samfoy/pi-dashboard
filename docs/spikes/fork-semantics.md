# Spike: `runtime.fork()` JSONL file semantics (O5)

**Slice 6 of the SDK-migration plan.** Gates slice 7d's fork path.
**Date:** 2026-07-11 · **SDK:** `@earendil-works/pi-coding-agent@0.80.3` · **Node:** v24.7.0

## Question (open-question O5)

When `PiSdkSession` forks, does `AgentSessionRuntime.fork()` write to the **same**
JSONL file (in-place branch) or create a **new** JSONL file? Load-bearing: if it is
in-place *and* `chat.ts` spins up a new slot from the returned session while keeping
the old slot alive, two slots would write one file → corruption.

## Answer

**NEW FILE.** `runtime.fork()` always produces a new `.jsonl` path and never
mutates the parent file. Confirmed by both a headless empirical run **and** a source
read (the runtime cannot be driven fully headless without a live LLM provider, so the
observation targets the exact `SessionManager` call chain `runtime.fork()` delegates
its file behaviour to — see "Why not the full runtime" below).

Additional confirmed facts:

- **Return shape:** `{ cancelled: boolean; selectedText?: string }`. The field is
  **`selectedText`**, not `editorText` (the design's field-name fix is correct).
  Source: `dist/core/agent-session-runtime.d.ts:87`.
- **`runtime.session` is replaced in-place.** `fork()` calls `this.apply(...)` which
  reassigns `this._session` (`dist/core/agent-session-runtime.js:111-112`), and
  `get session()` returns `_session`. So after a fork the runtime's `session` (and
  therefore `runtime.session.sessionFile`) points at the **new** file; the old
  `AgentSession` is torn down via `teardownCurrent("fork", …)`.

## What `runtime.fork()` actually does (source)

`dist/core/agent-session-runtime.js` `async fork(entryId, options)`, persisted-session
branch (the common case). For `position:"before"` it resolves `targetLeafId` to the
selected user message's `parentId` and extracts `selectedText`; for `position:"at"` it
uses the entry id itself. Then:

```js
const sessionManager = SessionManager.open(currentSessionFile, sessionDir);
const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
if (!forkedSessionPath) throw new Error("Failed to create forked session");
await this.teardownCurrent("fork", sessionManager.getSessionFile());
this.apply(await this.createRuntime({
  cwd: sessionManager.getCwd(),
  agentDir: this.services.agentDir,
  sessionManager,
  sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
}));
return { cancelled: false, selectedText };
```

`SessionManager.createBranchedSession(leafId)` (`dist/core/session-manager.js`) mints a
**fresh** session id + timestamped filename, writes the root→leaf path into it, records
the parent file as `parentSession` in the new header, and sets `this.sessionFile =
newSessionFile`. It **never** rewrites the parent file. The parent is referenced only as
`parentSession` metadata. Its doc comment on the sibling `branch()` method makes the
contrast explicit: *"Unlike fork() which creates a new session file, this stays in the
same file."* (`dist/core/agent-session.d.ts:546`).

One nuance surfaced by the spike: `createBranchedSession` only writes the new file to
disk immediately if the branched path already contains an assistant message; otherwise
it defers the physical write to the first assistant response (matching the
`newSession()` contract). Either way the returned/adopted **path** is new and distinct
from the parent — the deferral only affects *when* the file bytes appear, not *which*
path the runtime adopts.

## Spike script (throwaway)

Shipped at `scripts/spike-fork-semantics.ts` (header marks it throwaway; not imported by
product code). It exercises the exact `SessionManager.open(file).createBranchedSession(leafId)`
chain `runtime.fork()` uses:

```ts
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jsonlFiles = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();

const sessionDir = mkdtempSync(join(tmpdir(), "spike-fork-"));
const sm = SessionManager.create(process.cwd(), sessionDir);
const userId = sm.appendMessage({ role: "user",
  content: [{ type: "text", text: "hello, fork me here" }], timestamp: Date.now() });
const assistantId = sm.appendMessage({ role: "assistant",
  content: [{ type: "text", text: "sure, this is the assistant reply" }],
  api: "messages", provider: "anthropic", model: "spike",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  stopReason: "stop", timestamp: Date.now() });

const originalFile = sm.getSessionFile()!;
const originalBytesBefore = readFileSync(originalFile, "utf8");

// Replicate runtime.fork()'s persisted branch exactly.
const smForFork = SessionManager.open(originalFile, sessionDir);
const forkedFile = smForFork.createBranchedSession(userId);   // branch at user entry

// Observations: same vs new file, parent untouched, manager repoints at new file.
// (Full script also branches at the assistant entry to show on-disk materialization.)
```

## Reproduce

```
cd /local/home/samfp/pi-dashboard        # (or your worktree with node_modules linked)
npx tsx scripts/spike-fork-semantics.ts
```

## Observed output

```
originalFile:  …/2026-07-11T…_019f4e88-…-256939.jsonl
userMessageEntryId: e2db083b
jsonl files after 1 turn:  [ '…-256939.jsonl' ]
createBranchedSession() returned:  …/2026-07-11T…_019f4e88-…-393aedf.jsonl
smForFork.getSessionFile() after branch:  …-393aedf.jsonl   (the NEW path)
--- OBSERVATIONS ---
SAME_FILE (returned === original)?:   false
NEW_FILE created on disk?:            false   ← user-entry branch has no assistant → write deferred
original file still exists?:          true
original file byte-unchanged?:        true
new manager now points at NEW file?:  true
VERDICT: NEW-FILE

--- CASE 2: branch at assistant entry ---
createBranchedSession(assistantId) returned:  …/2026-07-11T…-5842398.jsonl
NEW_FILE materialized on disk?:  true    ← branch contains an assistant → written immediately
distinct from original?:         true
jsonl file count now:            2
original still byte-unchanged?:  true
```

**Interpretation:** the returned/adopted path is always a NEW file distinct from the
parent; the parent is byte-for-byte untouched; the new manager repoints at the new
path. The new file's physical bytes appear immediately when the branched path contains
an assistant message, and are deferred to the first assistant reply otherwise.

### Why not the full runtime

`runtime.fork()` lives on `AgentSessionRuntime`, whose construction requires a live
`createRuntime` factory (real provider/model/auth). That can't be driven headless in a
CI-safe spike. But `fork()`'s **file** behaviour is entirely delegated to
`SessionManager.open(file).createBranchedSession(leafId)` (quoted above) — no provider
involved — so exercising that call chain directly is a faithful, deterministic
observation of the exact code path. The runtime-level facts (return field name,
`runtime.session` in-place replacement) are confirmed by source read
(`.d.ts:87` + `.js:111`), which is unambiguous.

## Current RPC fork path (parity anchor)

- `backend/pi-manager.ts:633` `fork(entryId)` → RPC `{type:'fork', entryId}` runs inside
  the slot's **pi child process**; the same `runtime.fork()` → `createBranchedSession`
  runs there, so the RPC path **already produces a new file**.
- `backend/routes/chat.ts:120-147` `/api/chat/slots/:key/fork`: calls `pi.fork(entryId)`,
  reads the new `sessionFile` via `pi.getState()`, `createSlot`s a **new** "Fork: …"
  slot adopting that file, then **`pi.kill()`s the old slot** (`chat.ts:145`).

So today: fork → new file → new slot adopts it → **old slot is killed**. Only one writer
ever touches the new file.

## DECISION FOR SLICE 7d

`runtime.fork()` is **new-file** semantics, so the "fork → new slot, old slot survives on
its own file" UX is *structurally* safe on the file dimension — but there is a second,
in-process hazard the RPC path never had:

> `runtime.fork()` **replaces `this.runtime.session` in-place**. After
> `PiSdkSession.fork()` runs, the **old slot's** runtime no longer points at the parent
> file — it now points at the **new fork file**. If `chat.ts` then creates a second slot
> adopting that same new file **and keeps the old slot alive**, both slots write one
> file → corruption.

Therefore 7d must **preserve the current RPC parity exactly**:

1. `PiSdkSession.fork(entryId)` calls `this.runtime.fork(entryId)` and returns
   `{ text: r?.selectedText, cancelled: r?.cancelled, sessionFile: this.runtime.session.sessionFile ?? null }`
   (the `runtime.session` after the in-place replacement — the new file). Field is
   **`selectedText`**.
2. `chat.ts` continues to `createSlot` the new "Fork: …" slot adopting that returned
   `sessionFile`, **and must keep the `pi.kill()` of the old slot** (`chat.ts:145`).
   Killing the old slot leaves exactly one live writer on the new file, which neutralizes
   the in-place-replacement hazard. **Do not drop the kill in the SDK branch.**
3. No need to switch the fork path to `createBranchedSession()`/`forkFrom()` — `runtime.fork()`
   already produces the new file. `forkFrom()` would only be required if 7d wanted to keep
   the old slot alive on its **original** file (a UX change beyond parity), because
   `runtime.fork()` hijacks the old runtime's `session`. That is explicitly out of scope
   for 7d; true in-place tree branching is deferred to §7c (`session.navigateTree()`).

**Net:** 7d keeps the "fork → new slot + kill old slot" flow. The only SDK-specific
correctness requirement is that the kill is retained; there is no two-slots-one-file
corruption as long as parity is preserved.
