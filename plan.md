# Plan: HTML/JS viewer + markup sidecar for pi-dashboard

Source of truth: `design.md` (approved). This plan cuts that design into ordered,
atomic, vertical slices. Reduced Strategy B, the sandbox token string, and the
Origin guard are **approved decisions** — this plan schedules their build, it
does not re-litigate them.

## Sequencing overview

| # | Slice | Layer | Depends on | Ships in |
|---|-------|-------|------------|----------|
| 1 | Origin guard (`sameOriginOnly`) | backend | — | v1 (FIRST) |
| 2 | HTML viewing (sandboxed iframe + Preview/Source, Source-mode commenting) | frontend + tiny FE fetch change | 1 | v1 |
| 3 | Rendered-page markup (injected bridge + postMessage → reverse-map) | frontend | 2 | v1 |
| 4 | Live-reload hardening + state-reset acceptance | frontend | 2 | v1 |
| 5 | Auto-open WS trigger | backend + frontend | 2 | v1.1 (optional) |

**Hard constraint honored:** Slice 1 (the security guard) lands **before** Slice 2,
the slice that introduces the JS-executing iframe. There must be no revision in
which a sandboxed artifact can run before `sameOriginOnly` is guarding the
un-authed mutation routes. Slices 1 and 2 may be developed in parallel but Slice 1
must **merge first**.

**Note on file-type detection:** changing `detectFileType` so `.html → 'html'`
produces *no observable behavior on its own* (it is a horizontal change — a type
with no renderer). It is therefore **not** a standalone slice; it is folded into
Slice 2, where it first produces visible behavior (the iframe renders). Do not
split it out.

---

### Slice 1: `sameOriginOnly` Origin guard on state-mutating `/api` routes

**Goal**: A request carrying `Origin: null` or `Sec-Fetch-Site: cross-site`
(i.e. a sandboxed-iframe `fetch`) to any state-mutating `/api` route is rejected
with `403`, while a legitimate same-origin dashboard POST passes. This is the
only barrier between artifact JS and the un-authed file-mutation API — it must
exist before any JS-running iframe does.

**Files**:
- `backend/routes/files.ts` — add a `sameOriginOnly` middleware (Express
  `(req,res,next)`) and apply it to the mutating routes registered here:
  `POST /api/file-write` (L163), `POST /api/file-comments` (L213),
  `POST /api/save-image` (L108), `POST /api/upload-files` (L122),
  `PUT /api/styles/:name` (L268), `DELETE /api/styles/:name` (L277),
  `PUT /api/styles-active` (L285). GET routes (`file-read`, `file-versions`,
  `file-comments` GET, `local-file`) stay open — no state change.
  - Logic per design "Backend": `ok = (origin == null || origin === http(s)://host)
    && site !== 'cross-site'`. Reject with `403 {error:'cross-origin request rejected'}`.
  - Prefer defining it once and applying per-route (or as a scoped `app.use`
    matcher) rather than duplicating; the existing no-op `app.use('/api', …)`
    passthrough at `server.ts:83` is an available seam if a broader mount is
    cleaner — but keep it scoped to mutators so GETs and the SPA static path are
    unaffected.
- `backend/__tests__/server-routes.test.js` (existing) — add guard cases.

**Acceptance**:
- `POST /api/file-write` with `Origin: null` → `403`.
- `POST /api/file-write` with `Origin: http://<host>` (matching `Host`) → passes
  (reaches handler; 200/expected).
- `POST /api/file-write` with `Sec-Fetch-Site: cross-site` → `403`.
- `POST /api/file-comments`, `save-image`, `upload-files`, style PUT/DELETE
  reject null-origin identically.
- `GET /api/file-read` / `file-versions` / `file-comments` with `Origin: null`
  → **unaffected** (still 200) — a frame reading files it was generated from is
  harmless.
- **Load-bearing check to confirm in impl**: real browser same-origin POSTs from
  the dashboard attach `Origin: <dashboard origin>` and `Sec-Fetch-Site:
  same-origin` and therefore pass. Verify with a manual smoke (save a file from
  the running dashboard) *before* declaring done — if legit POSTs 403, the guard
  logic is wrong and Slice 2 is blocked.

**Verification**:
- `npm test` (root — runs `vitest run --config vitest.backend.config.js` over
  `backend/__tests__/`). Confirm new guard cases pass.
- `npm run typecheck`.
- Manual: with `npm run dev` (or equivalent) up, open a `.md` file in the panel,
  edit, Save → confirm it still writes (legit same-origin POST not blocked).

**Risk**: If a legitimate dashboard POST omits `Origin` in some browser/context
and also lacks a same-origin `Sec-Fetch-Site`, the guard could 403 real saves.
Mitigation: the `origin == null` allowance already passes header-less requests;
the `site !== 'cross-site'` check is the real gate. Confirm the exact header
values a real dashboard POST sends (log them once) before finalizing the
predicate. This slice is load-bearing for the whole feature's safety — get the
predicate exactly right.

---

### Slice 2: HTML viewing — sandboxed iframe + Preview/Source toggle (Source-mode commenting works)

**Goal**: Clicking an `.html` file path in chat opens the document panel in
**Preview**, rendering the artifact in a sandboxed `<iframe srcdoc>` with its JS
actually running (tabs, collapsibles, Mermaid, hljs). A **Preview / Source**
toggle switches to the existing editable `TextRenderer`; in Source, the existing
right-click → comment path works (commenting exists, just not yet on the rendered
page). Save remains enabled. No markup-on-Preview yet (that is Slice 3).

**Files**:
- `frontend/src/hooks/usePanelState.ts` — add `'html'` to the `FileType` union
  (L20); move `'.html'`/`'.htm'` out of `TEXT_EXTS` (L36) into `EXT_MAP` (L22) →
  `'html'`. `Comment` interface unchanged (`anchor?` L17 stays reserved).
- `frontend/src/components/renderers/HtmlRenderer.tsx` — **new**, lazy-imported.
  For this slice it needs only the viewing half: an `<iframe srcDoc={content}>`
  with `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`
  (**no** `allow-same-origin`), `referrerPolicy="no-referrer"`, full-size class.
  The `onSelect`/bridge/message-listener wiring is added in Slice 3 — keep the
  prop surface ready but a no-op here, or add it whole in Slice 3.
- `frontend/src/components/DocumentPanel.tsx` —
  - `lazy(() => import('./renderers/HtmlRenderer'))` alongside the other renderer
    imports (L6–9).
  - Change `isBinary` (L52) so `html` is **not** binary:
    `const isBinary = fileType !== 'text' && fileType !== 'html'` — keeps Save,
    toggle, versions, and Source-mode commenting enabled for html.
  - Add a render branch (in the dispatch at L198–222, before the `TextRenderer`
    fallback): `fileType === 'html' && mode === 'preview'` → `<Suspense
    fallback={LOADING_FALLBACK}><HtmlRenderer content={content} …/></Suspense>`;
    otherwise (`html + edit`, or `text`) → existing `TextRenderer`.
  - Toolbar (L176–177): for `html`, label the two mode buttons **Preview** /
    **Source** (Source maps to the existing `'edit'` mode). Keep `text` labels
    (Preview/Edit) unchanged.
  - Ensure the `onContextMenu` handler at L198 stays active for `html` (it is
    gated on `!isBinary`, which is now correct) so Source-mode commenting works.
- `frontend/src/pages/ChatPage.tsx` — `handleFileOpen` (L332): extend the
  text-fetch condition so `html` also fetches raw text:
  `if (ft === 'text' || ft === 'html') { …/api/file-read… }`. Version + comment
  fetches are already type-agnostic — leave them.

**Acceptance**:
- `detectFileType('x.html') === 'html'`; `'x.htm' === 'html'`; `.css`/`.xml`/`.md`
  still `'text'`; other `EXT_MAP` entries unchanged.
- Opening an `.html` fetches `/api/file-read` (not skipped) and opens the panel in
  Preview mode.
- `DocumentPanel` renders `HtmlRenderer` for `html + preview`, `TextRenderer` for
  `html + source`; `isBinary === false` for `html` (Save + comment context menu
  enabled).
- `HtmlRenderer` emits an iframe whose `sandbox` attribute is **exactly**
  `"allow-scripts allow-popups allow-popups-to-escape-sandbox"` and whose `srcDoc`
  is bound to `content` — assert the attribute string literally to catch an
  accidental `allow-same-origin` regression.
- Source-mode right-click → comment still POSTs to `/api/file-comments` (existing
  path, now reachable for html).

**Verification**:
- `cd frontend && npm test -- DocumentPanel` and a new `HtmlRenderer.test.tsx`
  (RTL/jsdom) asserting the sandbox string + `srcDoc` binding + no
  `allow-same-origin`.
- `cd frontend && npm run typecheck && npm run build`.
- Manual smoke (the real proof): open an actual `narrative-review` export
  (`~/vault/Exports/*.html`) → tabs/collapsibles work, Mermaid renders when CDN
  reachable, hljs highlights; toggle to Source shows editable HTML; paste a probe
  reading `document.cookie`/`window.parent` into a test page and confirm
  same-origin access **throws** (opaque origin holds).

**Risk**: The iframe here is the first surface that runs untrusted JS — it must
not merge before Slice 1. Second risk: `isBinary` is referenced in several
toolbar/conflict/`TextRenderer` props (L173–216); widening it to include `html`
must not accidentally disable the conflict banner or version dropdown for html
(they *should* stay enabled). Verify the toolbar renders Preview/Source + Save +
versions for an open html file.

---

### Slice 3: Rendered-page markup — injected bridge + postMessage → existing reverse-map

**Goal**: The user selects rendered text **in Preview** (inside the iframe) and
gets a comment anchored to `startLine/endLine`, persisted via the unchanged
`.comments.json` sidecar and flowing through the existing "Review Comments"
round-trip — markdown-parity UX. This is the user's explicit product decision
(visual commenting on the rendered page).

**Files**:
- `frontend/src/components/renderers/HtmlRenderer.tsx` —
  - `withBridge(html)`: append the ~10-line bridge `<script>` (per design
    "Public interface") that listens for `mouseup`, reads `window.getSelection()`
    inside the frame, and `parent.postMessage({__picomment:true, kind:'selection',
    text}, '*')` on a non-collapsed, non-empty selection. Inject into `srcDoc` via
    `withBridge(content)`.
  - Add the parent-side `message` listener (`useEffect`): accept **only** messages
    where `event.source === ref.current?.contentWindow` (NOT `event.origin`,
    which is the useless string `"null"` for a sandboxed frame) **and** the
    `__picomment` tag + `kind==='selection'` + `typeof text==='string'`. On a
    valid message call `onSelect(text)`.
  - Add the `onSelect: (text: string) => void` prop.
- `frontend/src/components/DocumentPanel.tsx` —
  - **Extract** the Preview-branch text→line reverse-map from `handleContextMenu`
    (L95–118: Strategy-1 raw `indexOf` substring match, Strategy-2 `stripMd`
    per-line match, `endLine` span computation) into a shared pure helper, e.g.
    `resolveTextToLines(content, selectedText): {startLine, endLine}`. Refactor the
    existing textarea/Preview handler to call it so both paths share one resolver
    (no behavior change to the existing path).
  - Wire `HtmlRenderer.onSelect={(text) => { const {startLine,endLine} =
    resolveTextToLines(content, text); openCommentInputFor(startLine,endLine) }}`
    → routes into the same comment-input → `onAddComment(startLine,endLine,note)`
    flow used today. No new comment schema; `Comment.anchor?` stays unused.

**Acceptance**:
- Simulating a `postMessage {__picomment,kind:'selection',text}` from the frame's
  `contentWindow` → `resolveTextToLines` resolves `startLine/endLine` → comment
  input opens → `onAddComment` fires → `POST /api/file-comments` (guard passes:
  same-origin).
- A spoofed `message` from a *different* window (`event.source` mismatch) is
  **ignored** (no comment created). A message missing the `__picomment` tag is
  ignored.
- "Review Comments" composes the `Lines X-Y:` message including the user's note
  text and clears the sidecar (existing `handleReviewComments`, `ChatPage:842`) —
  unchanged, just now fed by Preview-origin comments.
- Source-mode fallback (Slice 2) still works unchanged.

**Reverse-map edge cases — explicit expected behavior (per design "Failure
modes"), verify each degrades, do not treat as bugs**:
- *Selection spans multiple DOM nodes* → resolver keys on the first non-empty
  trimmed line and computes `endLine` from span line count (existing behavior).
  Good enough; same as markdown.
- *Selected text occurs multiple times in source* → resolver takes the **first**
  `indexOf` hit; the comment may anchor to the wrong occurrence, but the exact
  selected text rides along in the "Review Comments" note so the agent can
  disambiguate. Accepted.
- *Text generated by JS at runtime (not present in source HTML)* → no substring
  match; resolver falls back to `startLine=endLine=1`. **This is the one genuine
  gap.** Acceptance: comment attaches to top-of-file **and** a subtle affordance
  tells the user "couldn't locate in source — comment attached to top of file;
  include the quoted text." No crash. (v2 CSS/anchor mapping is the escalation —
  out of scope.)

**Verification**:
- `cd frontend && npm test -- HtmlRenderer` and `-- DocumentPanel`: RTL tests for
  (a) valid postMessage → comment POST, (b) `event.source` mismatch ignored,
  (c) the three reverse-map edge cases resolve/degrade as specified.
- `cd frontend && npm run typecheck && npm run build`.
- Manual smoke: on a real narrative export, select a rendered paragraph in
  Preview → comment input appears → add note → comment persists and shows;
  "Review Comments" sends `Lines X-Y: <note>`; then select JS-generated text and
  confirm the top-of-file degradation affordance.

**Risk**: The reverse-map extraction is a refactor of live code
(`handleContextMenu` L81–120) that markdown depends on — a regression here breaks
markdown commenting too. Mitigation: extract as a pure function with no behavior
change, keep the existing markdown Preview/Edit tests green (`npm test --
DocumentPanel`) as the guardrail. Second risk: `postMessage(…, '*')` target
origin is `'*'` (required — the frame is opaque); the parent's `event.source ===
contentWindow` check is the *only* trust gate, so it must not be dropped.

---

### Slice 4: Live-reload hardening + in-frame state-reset acceptance

**Goal**: When the agent rewrites the open `.html` (the "Review Comments" fix
loop), the iframe re-renders with the new content automatically, with no manual
refresh. The known in-frame state reset (scroll/active-tab/expanded/Mermaid) is
explicitly accepted for v1.

**Files**:
- `frontend/src/components/renderers/HtmlRenderer.tsx` — add `key={version}` (or a
  content-hash key) on the `<iframe>` as belt-and-suspenders so a `srcDoc` change
  reliably forces a fresh document parse/execute even if a browser coalesces the
  `srcDoc` update. Thread a `version` prop from `DocumentPanel` (it already tracks
  `selectedVersion`/versions).
- No backend change — the existing WS `watch_file` → `file_changed` →
  `subscribeFileChange` (`ChatPage:295`) → `panel.setContent` path is
  type-agnostic and drives `srcDoc` for free.

**Acceptance**:
- Simulated `file_changed` for the open html path (not dirty) → `content` updates
  → `srcDoc` prop changes → iframe re-renders (assert re-render / new content in
  frame).
- Dirty case (unsaved Source edits) → existing conflict banner (Reload / Keep
  Mine / Show Diff, `ChatPage:305`) still fires — unchanged.
- **Accepted failure mode (documented, not fixed in v1)**: after reload,
  scroll/open-tab/collapsible/Mermaid state resets. Verify it resets gracefully
  (no crash, no stuck state) and record it as accepted. v2 mitigation
  (bridge postMessage-persists state) is out of scope.

**Verification**:
- `cd frontend && npm test -- ChatPage` / `DocumentPanel`: integration test
  simulating `file_changed` → assert `srcDoc`/`content` re-render while not-dirty;
  assert conflict banner path when dirty.
- Manual smoke: open a narrative export, run the full loop — comment in Preview →
  "Review Comments" → agent edits the file → confirm the iframe live-reloads with
  the change (and note the state reset is the expected v1 behavior).

**Risk**: Small slice; main risk is that `key={version}` remounts the iframe on
*every* version tick even when unnecessary, amplifying the state-reset jolt.
Confirm the key only changes on actual content change, not on incidental version
metadata refreshes.

---

### Slice 5 (OPTIONAL, v1.1): Auto-open WS trigger

**Goal**: After the agent writes an artifact, the panel opens it automatically
instead of the user clicking the path. **Not required for v1** — clicking the
printed output path already reaches `handleFileOpen`. Listed for completeness;
schedule only if the user wants it.

**Files**:
- `backend/server.ts` — emit a WS server→client message `{type:'open_file',
  path}` (via the existing `broadcast` helper) when the agent/skill signals it.
- `frontend/src/pages/ChatPage.tsx` — subscribe to `open_file` and call
  `handleFileOpen(path)`.
- Agent-side convention (skill post-step) to emit the signal — an
  agent-convention change, deliberately kept off the v1 critical path so the
  renderer slice stays atomic.

**Acceptance**:
- A simulated `{type:'open_file', path}` WS message opens the panel on that path.

**Verification**:
- `cd frontend && npm test -- ChatPage` (WS message → `handleFileOpen` called).
- Manual: agent writes an export → panel auto-opens.

**Risk**: Couples an agent-side convention to the dashboard; if the signal fires
for unexpected paths it could yank the panel unexpectedly. Gate on artifact paths
only. Defer unless requested.

---

## Global verification (run after each slice)

- Frontend: `cd frontend && npm run typecheck && npm run build && npm test`
- Backend: `npm test && npm run typecheck` (from repo root)
- Whole-feature rollback check (per design): reverting the single `EXT_MAP`
  entry drops `.html` back to the `TextRenderer` path; `HtmlRenderer` becomes dead
  code; sidecar format unchanged; the only backend change to reason about is the
  Slice 1 guard (which is safe to keep regardless).

## Ambiguities surfaced (not blockers, flag to builder)

- **Origin-guard scope (design Open question):** v1 applies `sameOriginOnly` to
  the file/style mutators listed in Slice 1. The design asks whether *all*
  state-changing `/api` routes should be covered uniformly. Slice 1 covers the
  known mutators in `files.ts`; if other mutating routes exist elsewhere
  (`registerFileRoutes` is one of several registrars), audit and extend. Builder
  should grep for `app.post`/`app.put`/`app.delete` across all route registrars
  and confirm coverage.
- **`allow-popups-to-escape-sandbox`:** design flags confirming we accept deep
  links opening as fully-unsandboxed tabs. Approved for self-generated internal
  artifacts; no action, just noted.

---

## Implementation notes (as-built — supersedes the per-route scoping above)

The origin guard shipped **broader** than Slice 1 described, resolving the design's
open question in favour of uniform coverage:

- **HTTP:** a single method-based middleware at `server.ts` (mounted at
  `app.use('/api', …)`, before all `registerXRoutes()` calls) rejects every
  non-GET/HEAD/OPTIONS `/api` request whose origin isn't the dashboard host and
  whose `Sec-Fetch-Site` is `cross-site`. This covers **all** mutators across
  `files.ts`, `chat.ts`, `jobs.ts`, `system.ts`, `sessions.ts` — not just file
  routes.
- **WebSocket:** the `server.on('upgrade')` handler for `/api/ws` bypasses Express
  middleware, so it got the **same origin check** independently. Without it a
  sandboxed artifact could open the socket and use `watch_file` to read/exfiltrate
  arbitrary files (WS frames are readable cross-origin, unlike fetch responses).
  This was a HIGH-severity gap the initial slice plan missed; closed in the same change.
- **Shared predicate** `originAllowed(origin, host)` backs both. Header-less
  clients (native apps) and same-host browsers pass; the opaque-origin iframe's
  `Origin: null` string is rejected by both the origin clause and the site clause.
- **Proxy escape hatch:** `PI_DASH_ALLOWED_ORIGIN` env var adds one extra allowed
  origin for TLS-terminating-proxy deployments (Tailscale serve/funnel), where the
  browser Origin ≠ internal Host. Unset by default → behaviour unchanged.
