# Design: HTML/JS viewer + markup sidecar for pi-dashboard

## Goal
Let a user open a locally-generated, JS-bearing HTML artifact (e.g. a
`narrative-review` CR page — tabs, collapsibles, Mermaid diagrams, syntax
highlighting) **inside the dashboard's document panel**, view it with its
JavaScript actually running, mark it up with comments, and round-trip those
comments to the agent for a fix → live-reload cycle — exactly analogous to how
markdown/text files work today. Single-user, Tailscale-only trust model.

## Approach

Add a first-class `html` file type to the existing document-panel pipeline. The
panel gains a **Preview / Source** toggle (mirroring the current Preview / Edit):

- **Preview** renders the file into a **sandboxed `<iframe srcdoc={content}>`**
  with `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` —
  **no `allow-same-origin`**. JS runs; the frame has an opaque/null origin, so it
  cannot touch the dashboard's DOM, cookies, `localStorage`, or same-origin state.
- **Source** is the *existing* `TextRenderer` on the raw `.html` text — fully
  editable, savable, and (critically) **this is where commenting happens**.

**Markup in v1 is rendered-page commenting (reduced Strategy B):** the user
comments **on the Preview** — selecting rendered text in the iframe — exactly as
markdown works today. This is the user's explicit product decision (visual
commenting over source-line commenting).

The key realization (which collapses the false dichotomy in my first draft):
markdown commenting *already* happens on the rendered Preview.
`DocumentPanel.handleContextMenu` (L80–120) reads `window.getSelection()` over
the rendered DOM and **reverse-maps the selected text back to source lines** —
Strategy 1: raw substring match in `content`; Strategy 2: `stripMd`-ed per-line
match. The `startLine/endLine` model is an invisible implementation detail; the
user never touches source. So visual commenting and line-number storage are *not*
in tension — markdown does both today.

The *only* reason this doesn't come free for HTML is that the Preview is an
**opaque-origin iframe**, so the parent's `window.getSelection()` cannot read a
selection made inside it. The fix is a **reduced** postMessage bridge: an
injected script captures the selection *inside* the iframe and `postMessage`s the
**selected text string** (plus minimal context) to the parent; the parent then
runs the **existing reverse-map** to resolve it to `startLine/endLine`. Comments
therefore persist as `Comment{startLine,endLine}` in the **same**
`.comments.json` sidecar via the **same** `/api/file-comments`, and flow through
the **same** "Review Comments" round-trip — **zero** change to storage or
round-trip precision, and **no fragile CSS selectors**. The `Comment.anchor?`
field (`usePanelState.ts:14`) stays unused in v1 (a v2 concern only if text
reverse-map proves insufficient).

Everything else falls out for near-free: `srcdoc` is bound to `panel.content`,
so the existing WS file-watch → `file_changed` → `setContent` path **live-reloads
the iframe automatically** (replacing `srcdoc` re-renders the frame; no
cross-origin `location.reload()` needed). Transport reuses `/api/file-read`.
No new comment schema; the only new surface is the injected bridge + its one
postMessage shape.

**Security is not optional in v1.** The opaque-origin sandbox stops the artifact
from reading the parent DOM/cookies/storage, but it does **not** stop its JS from
calling `fetch('/api/file-write', …)` with `Origin: null` against the un-authed
backend. So a **server-side reject of null/cross-site `Origin`** on
state-mutating `/api` routes is a **required v1 slice**, not hardening.

## Public interface

### File-type detection (`frontend/src/hooks/usePanelState.ts`)
```ts
export type FileType = 'text' | 'html' | 'pdf' | 'docx' | 'spreadsheet' | 'image' | 'unknown'

// Move '.html'/'.htm' OUT of TEXT_EXTS and into EXT_MAP:
const EXT_MAP: Record<string, FileType> = {
  '.html': 'html',
  '.htm':  'html',
  // ...existing pdf/docx/image entries unchanged
}
// '.html' removed from TEXT_EXTS.
```
`Comment` is **unchanged** for v1 (`startLine`/`endLine`/`content`/`version`).
The optional `anchor?: string` field stays reserved for v1.1.

### Panel dispatch (`frontend/src/components/DocumentPanel.tsx`)
```ts
const fileType = detectFileType(filePath)
// html is NOT binary: it must keep Save + commenting enabled.
const isBinary = fileType !== 'text' && fileType !== 'html'

// mode state widened for html: 'preview' | 'edit'  (edit == Source view for html)
// Toolbar: for html, label the two buttons "Preview" / "Source"
//          (Source uses the existing edit/TextRenderer path).

// New render branch, before the TextRenderer fallback:
fileType === 'html' && mode === 'preview'
  ? <Suspense fallback={LOADING_FALLBACK}><HtmlRenderer content={content} /></Suspense>
  : /* html+source OR text → existing TextRenderer (editable, comment-capable) */
```

### New component `frontend/src/components/renderers/HtmlRenderer.tsx`
```tsx
// The artifact HTML is wrapped so a small BRIDGE script is appended before
// injecting into srcDoc. The bridge runs INSIDE the opaque-origin frame and
// is the only way the parent learns about in-frame selections.
function withBridge(html: string): string {
  return html + `<script>(function(){
    document.addEventListener('mouseup', function(){
      var s = window.getSelection();
      if (!s || s.isCollapsed) return;
      var text = s.toString();
      if (!text.trim()) return;
      parent.postMessage({ __picomment: true, kind: 'selection', text: text }, '*');
    });
  })()<\/script>`
}

export default function HtmlRenderer({
  content, onSelect,
}: { content: string; onSelect: (text: string) => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      // Accept only messages from OUR frame's opaque origin (event.source check);
      // do not trust event.origin (it is 'null' for sandboxed frames).
      if (e.source !== ref.current?.contentWindow) return
      const d = e.data
      if (d && d.__picomment && d.kind === 'selection' && typeof d.text === 'string') {
        onSelect(d.text)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onSelect])
  return (
    <iframe
      ref={ref}
      title="HTML preview"
      srcDoc={withBridge(content)}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="w-full h-full border-0 bg-white"
    />
  )
}
```
Lazy-imported like the other binary renderers
(`const HtmlRenderer = lazy(() => import('./renderers/HtmlRenderer'))`).
`onSelect` is wired in `DocumentPanel` to the **existing** reverse-map
(`handleContextMenu`'s Strategy-1/Strategy-2 text→line resolver, extracted so
both the textarea path and the iframe path share it) → `onAddComment(startLine,
endLine, …)`. No new comment schema.

**postMessage protocol (the only new wire shape):**
```ts
// iframe → parent
{ __picomment: true, kind: 'selection', text: string }
```
Trust boundary: the parent validates `event.source === iframe.contentWindow`
(NOT `event.origin`, which is the useless string `"null"` for a sandboxed frame)
and the `__picomment` tag before acting. The bridge only ever *sends* selected
text outward; it is not given any parent capability.

### `handleFileOpen` (`frontend/src/pages/ChatPage.tsx:332`)
```ts
const ft = detectFileType(filePath)
if (ft === 'text' || ft === 'html') {           // html now fetches text too
  const res = await fetch('/api/file-read?path=' + encodeURIComponent(filePath))
  text = res.ok ? await res.text() : `_Error…_`
}
```
Version + comment fetches on open are already type-agnostic — unchanged.

### Backend (one REQUIRED v1 change: Origin guard)
`/api/file-read`, `/api/file-comments` (GET/POST), `/api/file-versions`, and the
WS machinery work unmodified for `.html`. **But** state-mutating routes must
reject requests originating from the sandboxed frame's null origin:
```ts
// Express middleware applied to state-mutating /api routes
// (/api/file-write, /api/file-comments POST, and any other mutator).
function sameOriginOnly(req, res, next) {
  const origin = req.get('origin')                 // 'null' for a sandboxed iframe
  const site   = req.get('sec-fetch-site')         // 'cross-site' from null-origin frame
  const ok = (origin == null || origin === `http://${req.headers.host}`
                             || origin === `https://${req.headers.host}`)
             && site !== 'cross-site'
  if (!ok) return res.status(403).json({ error: 'cross-origin request rejected' })
  next()
}
```
**Verified assumption to confirm in impl:** legit dashboard `fetch` POSTs are
same-origin, so the browser sends `Origin: <dashboard origin>` (browsers attach
`Origin` to same-origin POST/PUT/DELETE) and `Sec-Fetch-Site: same-origin` —
both pass. A sandboxed-frame `fetch` carries `Origin: null` /
`Sec-Fetch-Site: cross-site` — rejected. GET routes (file-read, versions) are
left open (no state change; the frame reading files it was generated from is
harmless). This is the **only** barrier between the artifact's JS and the
un-authed file-mutation API — hence required, not optional.

## Data flow

```
Agent writes  ~/vault/Exports/foo.html
      │
      ▼
User clicks the file path / tool-card path in chat
      │  ChatPage.handleFileOpen(rawPath)  (L332)
      ▼
detectFileType → 'html'  ──> fetch /api/file-read?path=  (raw HTML text)
      │
      ▼
panel.openPanel(path, text)   +   fetch versions   +   fetch .foo.html.comments.json
      │                                                        │
      ▼                                                        ▼
DocumentPanel (mode = 'preview')                     comments[] in panel state
      │
      ├── Preview ─> HtmlRenderer ─> <iframe srcdoc={content + bridge}
      │                                sandbox="allow-scripts allow-popups
      │                                         allow-popups-to-escape-sandbox">
      │                              JS runs in OPAQUE origin; Mermaid/hljs
      │                              fetch from cdn.jsdelivr.net (allowed).
      │                                     │
      │       user selects rendered text ──┤ bridge: window.getSelection()
      │                                     ▼
      │       postMessage{__picomment,kind:'selection',text}  ──▶ parent
      │                                     │  (parent verifies event.source)
      │                                     ▼
      │       reverse-map (existing stripMd/substring matcher)
      │       text → startLine/endLine   ──> handleAddComment(startLine,endLine)
      │                                     │
      │                                     ▼
      │                   saveComments() ─POST─> /api/file-comments
      │                          (sameOriginOnly guard passes: same-origin POST)
      │
      └── Source ─> TextRenderer(edit) ── right-click selection (fallback path)
                       │                     → context menu → CommentInput
                       │                     → handleAddComment(startLine,endLine)
                       ▼
                   saveComments() ─POST─> /api/file-comments  (.comments.json sidecar)
                       │
                       ▼
             "Review Comments" button (comments > 0)
                       │  handleReviewComments (ChatPage:842)
                       ▼
             send("Please review and address the comments in <path>:
                   Lines 40-45: make the arch section default-open ...")
                       │  agent edits foo.html, rewrites file
                       ▼
             WS file_changed{path,content,version}  (server.ts:146)
                       │  ChatPage:295 subscribeFileChange
                       ▼
             panel.setContent(newHTML)  → srcdoc changes → iframe RE-RENDERS (live reload)
```

## Failure modes

- **Malicious/buggy JS in the artifact tries to reach dashboard APIs.** The
  opaque-origin sandbox blocks same-origin access (cookies, `localStorage`,
  parent DOM). It does **not**, by itself, stop the frame from issuing
  `fetch('/api/file-write', …)` with `Origin: null` to the un-authed backend —
  which could overwrite or delete any file the server can reach.
  *Surfaced/mitigated:* the **required v1 `sameOriginOnly` guard** (see Backend)
  rejects `Origin: null` / `Sec-Fetch-Site: cross-site` on all state-mutating
  routes with a 403. This is the one real barrier, so it ships in v1, not later.
- **srcDoc rebind on live-reload destroys in-frame JS state.** Every agent edit
  replaces `srcDoc`, so the frame re-parses from scratch: scroll position, the
  open tab, expanded collapsibles, and rendered Mermaid all reset — invisible for
  markdown, a visible jolt for an interactive artifact. *Surfaced:* accepted for
  v1 (correctness over polish). *v2 mitigation idea (not scoped):* the bridge
  could postMessage-persist scroll/active-tab state to the parent and restore it
  after the reload. Not in v1.
- **Reverse-map edge cases (selected rendered text → source line):**
  - *Selection spans multiple DOM nodes* → `getSelection().toString()` yields
    text with newlines/whitespace; the existing matcher already keys on the
    first non-empty trimmed line and computes `endLine` from the span line count
    (`DocumentPanel.tsx:96–118`). Same behavior markdown relies on; good enough.
  - *Selected text appears multiple times in source* → the existing matcher takes
    the **first** `indexOf` hit. Comment may anchor to the wrong occurrence.
    *Degradation:* the comment still carries the exact selected text in its
    `content` when composed for the agent ("Review Comments" includes the user's
    note), so the agent can disambiguate from the text even if the line is
    approximate. Same limitation as markdown today.
  - *Text generated by JS at runtime (not in source HTML)* → no substring match;
    reverse-map finds nothing. *Degradation:* fall back to `startLine=endLine=1`
    (matcher default) **and** surface a subtle "couldn't locate in source—comment
    attached to top of file; include the quoted text" affordance so the user
    knows to lean on the text in their note. This is the genuine gap of the
    text-reverse-map approach and the only case where v2 CSS/anchor mapping would
    help; acceptable for v1 since narrative pages are mostly static markup.
- **CDN unreachable (offline / corp network).** Mermaid + highlight.js load from
  `cdn.jsdelivr.net`; the generator already ships `onerror`/`setTimeout`
  fallbacks that show diagram source as text. Page still renders. No dashboard
  handling needed — surfaced inside the iframe by the artifact itself.
- **Relative/sibling asset reference in the HTML.** Under `srcdoc` the base URL
  is `about:srcdoc`, so `./style.css` would 404. Verified narrative-review
  output inlines all CSS/JS and uses only absolute CDN URLs, so this does not
  occur for the target artifact. *Surfaced:* broken sub-resource inside the
  frame; documented as a known limitation for non-self-contained pages (see Open
  questions for the `src=`-with-`<base>` escape hatch).
- **Comment line drifts after the agent regenerates the page.** Comments are
  version-stamped; `filteredComments` only shows comments matching the current
  version, and "Review Comments" clears the sidecar after sending. So a
  regenerate naturally invalidates stale anchors — same behavior as markdown
  today. *Surfaced:* comments from an old version stop showing; no crash.
- **Edit-then-external-change conflict.** If the user is in Source mode with
  unsaved edits and the agent rewrites the file, the existing dirty-check routes
  to the conflict banner (Reload / Keep Mine / Show Diff, `ChatPage:305`).
  Unchanged.
- **Huge page inlined into `srcdoc`.** Multi-hundred-KB attribute strings are
  fine in modern browsers; only pathological (10s of MB) pages would strain it.
  *Rollback:* if this bites, switch Preview to `src="/api/local-file?path="`
  (still opaque under the sandbox attr) — a localized HtmlRenderer change.

**Rollback story:** the entire feature is gated on `detectFileType` returning
`'html'`. Revert that one map entry and `.html` falls back to today's
TextRenderer path; the new component becomes dead code. No data migration
(sidecar format unchanged), no backend change to undo.

## Alternatives considered

### Strategy C — `allow-same-origin` + Content-Security-Policy (rejected)
- **Idea:** grant the iframe same-origin so the parent can read/annotate its DOM
  directly, and contain the JS with a CSP.
- **Cons:** With `src="/api/local-file"` the frame would run at the dashboard's
  *own* origin with full access to its cookies/`localStorage`/same-origin APIs —
  the worst posture given there is **no auth**. CSP cannot substitute for the
  origin barrier here: the artifact legitimately needs `script-src`
  `cdn.jsdelivr.net` and inline scripts (Mermaid bootstrap is inline
  `onload=`/`setTimeout`), so any CSP tight enough to matter would break the
  page, and one loose enough to render it wouldn't meaningfully contain it. There
  is also zero CSP infra today — all net-new.
- **Why rejected:** trades the one guarantee we get for free (origin isolation)
  for a containment mechanism the target artifact structurally defeats.

### Strategy B (reduced) — rendered-page commenting via injected bridge + `postMessage` text (CHOSEN for v1)
- **Idea:** inject a small bridge into the `srcdoc` HTML. On selection inside the
  frame it `postMessage`s the **selected text string** to the parent. The parent
  runs the **existing** stripMd/substring reverse-map (the same code markdown
  uses) to turn that text into `startLine/endLine`, then stores a plain
  `Comment{startLine,endLine}` in the unchanged `.comments.json` sidecar.
- **Crucial distinction from "full" Strategy B:** we deliberately do **not** send
  `{cssSelector, rect}` or populate `Comment.anchor`. Anchoring is by *text*, not
  by DOM selector — so there are **no fragile selectors** and the agent still
  receives line numbers, identical to markdown's round-trip.
- **Pros:** user comments directly on the rendered page (markdown-parity UX, the
  user's product decision); storage + round-trip + "Review Comments" are the
  existing code path **verbatim**; opaque-origin sandbox is preserved
  (`postMessage` crosses it, `getSelection` does not need to); the only new
  surface is ~10 lines of injected bridge + one message shape.
- **Cons:** requires appending a script to the artifact (benign, same-origin-less
  frame) and a `message` listener; JS-generated text that isn't in source can't
  be reverse-mapped (degrades to top-of-file + quoted text — see Failure modes).
- **Why chosen:** it satisfies both v1 pillars *and* the user's visual-commenting
  decision **without** sacrificing round-trip precision — the false tradeoff my
  first draft assumed. The reverse-map already exists; we're just feeding it a
  selection from across the iframe boundary.

### Strategy A — source-line-only commenting (rejected; fallback)
- **What it is:** comment only in the **Source** view; no bridge. Reuses
  everything, zero new surface.
- **Why rejected:** the user explicitly chose visual commenting on the rendered
  page. Source-only commenting forces the user to flip to Source and hunt for the
  markup behind a rendered region — worse than markdown's UX. My first draft
  recommended A on a **false premise** (that visual anchoring must cost
  round-trip precision); the reduced Strategy B shows it does not.
- **Retained as fallback:** because Source mode *is* the existing editable
  TextRenderer with its own right-click→comment path, source-line commenting
  keeps working for free. If the bridge ever misbehaves, or for the
  JS-generated-text gap, the user can drop to Source and comment there. So A is
  the **degradation path**, not a deleted option.

## Sandbox posture (precise)

`sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`

- **`allow-scripts`** → JS executes. Required (tabs, collapsibles, Mermaid, hljs).
- **omit `allow-same-origin`** → frame is forced to an **opaque origin** even
  though `srcdoc`/`/api/local-file` would nominally be same-origin. Consequence:
  the frame **cannot** read the dashboard's cookies, `localStorage`,
  `sessionStorage`, IndexedDB, or reach into the parent DOM (`window.parent.*`
  cross-origin throws). This is the core containment.
- **`allow-popups` + `allow-popups-to-escape-sandbox`** → the artifact's many
  deep links (`code.amazon.com`, AWS console) open in a new tab as normal,
  unsandboxed pages. Without these, `target="_blank"` links silently fail.
- **CDN network is NOT gated by `sandbox`** — `allow-scripts` frames can still
  `fetch`/load `<script src=cdn…>`. So Mermaid/hljs work. Good, because a CSP
  restricting this would break the page.
- **What JS in the frame CAN still do:** issue `fetch` to arbitrary URLs
  (including the dashboard's own un-authed `/api/*`) with `Origin: null`. The
  sandbox does not stop network egress. This is why the **required** v1
  `sameOriginOnly` guard on state-mutating routes (see Backend) is not optional —
  it is the only thing between the artifact's JS and the file-mutation API.

## Live-reload reuse

Confirmed the existing path drives the iframe with **no new mechanism**:
- On open, client sends `{type:'watch_file',path}` (`ChatPage:314`); server
  `startWatching` pushes `{type:'file_changed',data:{path,content,version}}`
  (`server.ts:146`, with 500ms self-write suppression).
- `subscribeFileChange` (`ChatPage:295`) calls `panel.setContent(newHTML)` when
  not dirty.
- Because `HtmlRenderer` binds `srcDoc={content}`, a content change **re-renders
  the iframe wholesale** — a fresh document parse/execute. This sidesteps the
  cross-origin `iframe.contentWindow.location.reload()` block the brief flagged;
  **no key-remount is required** (though a `key={version}` on the iframe is a
  cheap belt-and-suspenders if any browser coalesces the srcdoc update).
- **Interaction with in-flight comments:** comments are version-stamped and the
  round-trip clears the sidecar on send, so a reload after the agent's fix
  correctly starts a fresh comment cycle. If the user has unsaved *Source* edits,
  the existing dirty→conflict-banner path applies unchanged.

## Auto-open trigger

**Recommendation: not required for the smallest v1.** Clicking the file path (or
a tool-card path) in chat already reaches `handleFileOpen` and opens the panel;
the agent simply needs to surface the output path (which `narrative-review`
already prints). Ship v1 without auto-open.

**Fast-follow sketch (v1.1, ~small):** add a WS server→client message
`{type:'open_file', path}` and, in `ChatPage`, subscribe to it and call
`handleFileOpen(path)`. The agent (or a skill post-step) emits it after writing
the artifact. Kept out of the v1 critical path to keep the slice atomic and avoid
an agent-side convention change landing with the renderer.

## Test strategy

- **Unit:**
  - `detectFileType('x.html') === 'html'`, `'.htm'` too; `.css`/`.xml` still
    `'text'`; unaffected extensions unchanged.
  - `DocumentPanel` renders `HtmlRenderer` for `html + preview` and `TextRenderer`
    for `html + source`; `isBinary` is `false` for `html` (Save + comment context
    menu remain enabled).
  - `HtmlRenderer` emits an iframe with the exact `sandbox` token string and
    `srcDoc` bound to `content` (guards against an accidental `allow-same-origin`
    regression — assert the attribute string literally).
- **Integration (jsdom / RTL):**
  - Open `.html` → `/api/file-read` fetched (not skipped), panel opens in
    Preview, comment fetch fires.
  - Add a comment **in Preview**: simulate a `postMessage`
    `{__picomment,kind:'selection',text}` from the frame → reverse-map resolves
    `startLine/endLine` → `POST /api/file-comments`. Also assert `event.source`
    mismatch is ignored (spoofed message from another window rejected).
  - Source-mode fallback still works: right-click comment → same POST.
  - "Review Comments" composes the `Lines X-Y:` message (including the user's
    note text) and clears the sidecar.
  - **Origin guard:** `POST /api/file-write` with `Origin: null` → 403; with a
    same-origin `Origin` → 200. GET routes unaffected.
  - Simulate `file_changed` → `content` updates → `srcDoc` prop changes (assert
    re-render) while not-dirty; dirty case shows conflict banner.
- **Manual smoke (the real proof):**
  - Open an actual `narrative-review` export: confirm tabs/collapsibles work,
    Mermaid renders (CDN reachable) and degrades to source text (CDN blocked),
    hljs highlights.
  - Confirm the frame **cannot** read `document.cookie`/parent (paste a probe
    script into a test HTML; expect same-origin access to throw).
  - Full loop: **select rendered text in Preview** → Review Comments → agent
    edits file → iframe live-reloads with the change.
  - Reverse-map degradation: select JS-generated text not in source → comment
    attaches to top-of-file with the quoted text surfaced (no crash).
  - External deep link opens in a new tab.

## Smallest shippable v1

One cohesive slice delivers **viewing + rendered-page markup + the security
guard** together:

1. `usePanelState.ts` — add `'html'` to `FileType`, move `.html`/`.htm` into
   `EXT_MAP`.
2. `HtmlRenderer.tsx` — sandboxed `srcdoc` iframe + injected selection bridge +
   `message` listener (new, ~40 lines), lazy-imported.
3. `DocumentPanel.tsx` — `isBinary` excludes `html`; add the
   `html + preview → HtmlRenderer` branch; relabel the toggle **Preview/Source**
   for html (Source = existing editable TextRenderer, the fallback comment path);
   **extract the existing `handleContextMenu` text→line reverse-map** into a
   shared helper and wire `HtmlRenderer.onSelect` to it → `onAddComment`.
4. `ChatPage.handleFileOpen` — fetch text for `html` as well as `text`.
5. **Backend `sameOriginOnly` middleware** on state-mutating `/api` routes
   (`/api/file-write`, `/api/file-comments` POST) — rejects `Origin: null` /
   `Sec-Fetch-Site: cross-site`. REQUIRED; this is the only barrier to the
   un-authed file API from sandboxed-frame JS.

Sidecar storage, versioning, and the "Review Comments" round-trip all come from
existing machinery unchanged — the comment schema is untouched (`anchor?` unused).

**Slice-ability for the planner:**
- **Slice 1 (viewing):** items 1–4 above minus the bridge — open an `.html`, see
  it render with JS, toggle to Source, comment in Source (reused path works once
  `isBinary` is correct). Independently shippable.
- **Slice 2 (rendered-page markup):** the injected bridge + `message` listener +
  reverse-map wiring (part of item 2/3). Turns Source-only commenting into
  Preview commenting. Depends on Slice 1.
- **Slice 3 (security guard — REQUIRED, land with or before Slice 1):** the
  `sameOriginOnly` middleware (item 5). Independent of the frontend slices and
  must ship in v1; sequence it first so no window exists where a sandboxed frame
  can hit the mutation API.
- **Slice 4 (v1.1 UX, optional):** auto-open WS message.
- **v2 (not scoped):** in-frame state restore across live-reload; CSS/selector
  anchoring (`Comment.anchor`) only if the JS-generated-text reverse-map gap
  proves painful.

## Risks

- **Load-bearing assumption: target HTML is self-contained (inline CSS/JS, only
  absolute CDN URLs).** Verified for `narrative-review`
  (`build-review-html.py` inlines styles/scripts; only `cdn.jsdelivr.net` for
  Mermaid/hljs). If a future artifact references sibling files, `srcdoc` breaks
  those sub-resources — mitigation is the `src="/api/local-file"` +
  server-injected `<base>` escape hatch (Open questions).
- **Residual (now closed in v1): un-authed mutation APIs reachable from the frame
  via `Origin: null` fetch.** The opaque origin stops DOM/cookie/storage access
  but not raw network egress. Closed by the **required** `sameOriginOnly` guard
  (Slice 3). Load-bearing assumption to verify in impl: legit dashboard POSTs
  carry a same-origin `Origin`/`Sec-Fetch-Site: same-origin` and thus pass.
- **Assumption: `srcdoc` replacement reliably re-executes scripts on live
  reload across the user's browser.** True in Chromium/Firefox; the `key={version}`
  fallback removes any doubt. Note this reload resets in-frame state (Failure
  modes) — accepted for v1.
- **Reverse-map coverage:** anchoring assumes selected rendered text exists in
  the source HTML. Holds for mostly-static narrative pages; JS-generated text is
  the known gap (degrades to top-of-file + quoted text). If this becomes common,
  v2 selector/anchor mapping is the escalation.

## Open questions

- **Non-self-contained future artifacts:** do we ever need to render HTML that
  references sibling assets? If yes, prefer `src="/api/local-file?path="` (the
  `sandbox` attr still forces opaque origin) and have the backend inject a
  `<base href>` — but that reintroduces a same-origin `src` and relative-path
  resolution concerns. Deferred until such an artifact exists.
- **Should the `Origin` guard also cover non-file mutation routes?** v1 scopes it
  to file mutators; audit whether other state-changing `/api` routes exist that a
  sandboxed frame could reach, and apply the middleware uniformly.
- **`allow-popups-to-escape-sandbox` scope:** confirm we're comfortable that
  links open as fully unsandboxed tabs (fine for trusted internal
  `code.amazon.com`/console links; the artifacts are self-generated).
