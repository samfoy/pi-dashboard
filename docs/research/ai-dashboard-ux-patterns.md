# AI Coding Agent Dashboard — UI/UX Research Report

> Research date: 2026-04-21
> Focus: Web + iOS dashboard for managing multiple pi coding agent sessions

---

## 1. Leading AI Coding Agent UI Patterns

### Cursor 3 — Agents Window (shipped April 2, 2026)
The most important reference for multi-agent orchestration UI:
- **Agents Window** replaces the old Composer pane with a full-screen workspace for managing multiple agents in parallel
- **Agent Tabs** — side-by-side panels or grid layout showing multiple agent conversations simultaneously. Each tab has its own context, model, and execution environment
- **Best-of-N comparison** — run the same prompt against multiple models, see results side-by-side in worktree-isolated environments
- **Design Mode** — click on UI elements in a live browser preview to annotate and direct agents visually (eliminates text-description friction)
- **Cloud/Local handoff** — start tasks locally, push to cloud for long-running work, pull results back seamlessly
- **Key insight**: Cursor's evolution is from "editor with AI" → "agent-first IDE" → "fleet orchestrator." The developer is now a reviewer, not a typist.

### Claude Code (Terminal)
- Stream-JSON protocol (`--output-format stream-json`) enables custom UIs to consume structured events
- Tool calls rendered inline with conversation — creates visual clutter in long sessions
- **Known pain points** (from GitHub issues):
  - Collapsible tool output sections needed (#36462) — long conversations are hard to scan
  - Configurable tool call visibility needed (#37199) — infrastructure tool calls add noise
  - Mobile/remote interface already collapses tool outputs into single-line summaries that expand on tap — **this is the right pattern**
- AgentsRoom wraps Claude Code in Electron + xterm.js with agent cards in a grid, role labels, status indicators

### Windsurf / Cline / Continue.dev / Copilot Chat
- IDE-integrated side panels (VS Code extension pattern)
- Chat + inline code actions (apply diff, accept/reject)
- Streaming output is the universal baseline expectation
- Code blocks with syntax highlighting and copy buttons
- File references with clickable paths

### Common Patterns Across All Tools
| Pattern | Prevalence |
|---------|-----------|
| Streaming token-by-token output | Universal |
| Code blocks with syntax highlighting + copy | Universal |
| Stop/cancel generation button | Universal |
| Retry/regenerate last response | Most tools |
| File path references (clickable) | Most tools |
| Tool call visualization (expandable) | Claude Code, Cline |
| Multi-agent parallel execution | Cursor 3, AgentsRoom |
| Session/conversation history sidebar | All chat-based tools |

---

## 2. Chat-Based Developer Tool UX Patterns

### Streaming Output
**This is the #1 UX differentiator. Get it right.**

- **Time to first token (TTFT)** of 200-500ms is the threshold — users start trusting the system once they see the first word
- **Buffer incomplete markdown** — half-open bold tags, unterminated code fences, partial tables should NOT be rendered until complete
- **Defer code block rendering** until the closing fence arrives, OR render progressively with a visible "streaming" indicator inside the block
- **Avoid layout thrash** — each new token should not cause the entire message to re-layout. Use CSS that allows the container to grow without shifting surrounding elements
- **Height expansion, not layout shift** — let containers grow smoothly rather than jumping
- **Skeleton loaders** for initial state: 3-5 lines of grey shimmer at decreasing widths (mimics natural text line lengths)
- **Subtle pulse animation** during generation (communicates "active")
- **Stop button must be prominent** during streaming, not hidden in a menu

### Code Block Rendering
- **Streamdown** (Vercel) is the reference implementation — Shiki-powered syntax highlighting, 200+ languages, lazy-loaded
- Incremental rendering of code blocks during streaming is hard — known issue even in Streamdown (#473)
- Best practice: render the code block frame immediately with a "streaming" indicator, then syntax-highlight on completion
- **Copy button** on every code block (absolute must-have)
- **Language label** visible on code blocks
- **Line numbers** for longer blocks
- **Diff view** for edit operations (red/green highlighting)

### Tool Call Visualization
- **Collapsible by default** — show a one-line summary ("✔ Read 142 lines from src/App.tsx") with expandable detail
- Group related tool calls (e.g., multiple file reads for one task)
- Distinguish between: thinking/planning, tool execution, and response text
- Show elapsed time for long-running tool calls
- **Error states inline** — if a tool fails, show the error adjacent to the tool call, not in a banner

### Message Threading & History
- **Linear conversation** is correct for coding agents (not threaded — threading adds complexity without benefit for task-oriented work)
- Auto-save every message as it completes
- AI-generated session names from first prompt (not timestamps)
- **Searchable history** across all sessions
- Session list in sidebar: title, timestamp, preview snippet
- Quick switching between sessions without losing scroll position or draft input
- **Context window transparency** — if truncating history, tell the user

---

## 3. Multi-Agent Dashboard Design

### Grid/Card Layout (from AgentsRoom, Cursor 3, Orquesta)
The dominant pattern for managing multiple concurrent agents:

- **Agent cards in a grid** — each card represents one agent/session
- **Color-coded status indicators** on each card:
  - 🟡 Yellow pulsing dot = thinking/working
  - 🟢 Green = completed/idle
  - 🔴 Red = waiting for input / error
  - ⚪ Grey = inactive/stopped
- **Elapsed time** visible on each card
- **Current activity summary** — one-line description of what the agent is doing
- **Click to expand** — full conversation view when you tap/click a card
- **Drag-and-drop reordering** of cards (customize layout)
- **Unread indicators** — badge or highlight for sessions with new activity since last viewed

### Status & Notifications
- **Push-based status reporting** > polling (from orchestration patterns research)
- **At-a-glance dashboard** — you should be able to understand all agent states in <2 seconds
- **Priority sorting** — agents needing input should surface to top
- Completion notifications (sound, toast, push notification)
- **"Needs attention" vs "cooking"** — Agentfy uses exactly this binary (brilliant simplicity)

### Session Management
- Project grouping — organize sessions by project/workspace
- Role/purpose labels on sessions (e.g., "Frontend", "Backend", "QA", "Research")
- Quick-start new session from template
- Archive old sessions (don't delete, searchable later)
- **Session sharing** for team use cases

---

## 4. Mobile-First Considerations

### The Mobile Monitoring Use Case
Mobile is primarily about **monitoring and quick interaction**, not deep coding work:

1. **"Is it done yet?"** — see status at a glance
2. **"Does it need me?"** — know when agent is waiting for input
3. **Quick responses** — type a short approval or redirect
4. **Review output** — read what the agent produced

### iOS-Specific Patterns (from Agentfy, AgentsRoom Mobile)

#### Live Activities & Dynamic Island (iOS 16.1+)
- **Agentfy's killer feature**: Agent status on lock screen via Live Activity
- Shows "Cooking" (working) or "Your Move" (waiting for input)
- Dynamic Island shows compact status while in other apps
- **This is the best mobile pattern for agent monitoring** — zero friction, always visible

#### Push Notifications
- Notify when: agent needs input, task completes, error occurs
- Rich notifications with action buttons ("Approve", "View", "Dismiss")
- Group notifications by project/session
- **Don't over-notify** — only for state changes that need attention

#### Mobile Chat UI
- **Keyboard handling**: input must stay visible when keyboard opens, push messages up
- **Multi-line input** that expands vertically (not horizontal scroll)
- **44x44pt minimum** tap targets on all action buttons
- **Auto-scroll pause**: stop auto-scrolling when user manually scrolls up to read history. Resume when they scroll back to bottom.
- **History as bottom sheet** or dedicated screen — NOT a sidebar (conflicts with iOS gestures)
- **Code blocks on mobile**: horizontal scroll within code blocks, pinch-to-zoom, copy button easily tappable
- **Swipe gestures**: swipe between sessions (like Messages app)

### Mobile Anti-Patterns to Avoid
- Don't try to replicate the full desktop experience
- Don't show full tool call output by default (collapse everything)
- Don't use hover states (no hover on touch)
- Don't require precise text selection in code blocks
- Don't show full file diffs on mobile — show summary with "View on desktop" option for complex diffs

---

## 5. Common Anti-Patterns

### From Krux's AI UX Audit Research (8 patterns that break AI products):

1. **No visual state while AI processes** — #1 most common failure. Must show immediate state change within 200ms. If >3 seconds, show estimated time. Always provide cancel.

2. **Destructive "Regenerate"** — overwrites user-edited content without warning or versioning. Fix: treat regeneration as a new version alongside existing, not a replacement.

3. **AI features scattered and inconsistently named** — different buttons for the same action. Fix: single consistent naming convention, one AI entry point.

4. **Human vs AI paths that compete** — e.g., "Reply" and "AI Reply" buttons side by side. Fix: AI drafts in background, user accepts/edits/discards.

5. **Wall of text output** — AI dumps paragraphs when user needed one sentence. Fix: structured output (cards, bullets, collapsible sections), lead with the answer, progressive disclosure.

6. **No clear next action after AI output** — user gets result but doesn't know what to do with it. Fix: explicit primary action button ("Apply these changes", "Send this reply").

7. **Missing error states** — AI failures show nothing. Fix: design three states minimum (loading, success, failure). Failure = what went wrong + retry + fallback.

8. **Unmanaged AI draft lifecycle** — drafts lost on navigation, stale after context changes, no conflict handling. Fix: auto-save drafts, handle staleness, show status.

### Coding-Agent-Specific Anti-Patterns:

9. **Information overload from tool calls** — every file read, every bash command shown at full verbosity. Fix: collapse by default, show one-line summaries.

10. **Broken streaming markdown** — flickering, layout shifts, half-rendered code blocks during streaming. Fix: buffer partial structures, defer rendering of incomplete blocks.

11. **No way to navigate long conversations** — scrolling through 200 messages to find a specific exchange. Fix: collapsible sections, search within conversation, jump to tool calls.

12. **Session sprawl** — dozens of unnamed "New Chat" sessions with no organization. Fix: auto-naming, project grouping, archiving, search.

13. **Full-page code diffs on mobile** — unreadable. Fix: summary view with expandable details, or "view on desktop" for complex diffs.

---

## 6. Concrete Recommendations for pi-dashboard

### Priority 1: Core Chat Experience
- [ ] **Streaming with buffered markdown** — don't render incomplete markdown structures. Use a streaming-aware markdown renderer (consider Streamdown or similar)
- [ ] **Collapsible tool calls** — one-line summary by default, expandable for detail. Show icon + tool name + brief result ("✔ Read src/App.tsx · 142 lines")
- [ ] **Stop button** — prominent during streaming, disappears when complete
- [ ] **Code blocks** — syntax highlighting, copy button, language label, horizontal scroll on mobile
- [ ] **Auto-scroll behavior** — follow new content UNLESS user has scrolled up. Show "↓ New messages" pill to jump back

### Priority 2: Multi-Session Dashboard
- [ ] **Card grid layout** — each session as a card with: name, project, status indicator (color-coded dot), elapsed time, current activity summary, unread badge
- [ ] **Status at a glance** — dashboard header showing "3 active, 1 waiting, 2 completed"
- [ ] **Sort/filter** — by status (waiting first), project, recency
- [ ] **Quick actions from cards** — without opening full session: approve, send quick message, stop
- [ ] **Session naming** — auto-generate from first user message, editable

### Priority 3: iOS Native Features
- [ ] **Live Activities** — show active agent status on lock screen (most impactful mobile feature)
- [ ] **Dynamic Island** — compact status indicator while in other apps
- [ ] **Rich push notifications** — with action buttons for common responses
- [ ] **Haptic feedback** — on status changes (completion, needs input)
- [ ] **Bottom sheet for session history** — not a sidebar
- [ ] **Swipe between sessions** — natural iOS gesture

### Priority 4: Polish & Trust
- [ ] **Error states for everything** — network failure, agent crash, timeout, rate limit
- [ ] **Progress indicators** — show what the agent is doing, not just that it's "thinking"
- [ ] **Context window indicator** — show approximate context usage
- [ ] **Session search** — full-text search across all sessions
- [ ] **Keyboard shortcuts** (desktop) — Cmd+K for search, Cmd+N for new session, ←/→ for session switching

### Architecture Notes
- Use **Server-Sent Events (SSE)** or **WebSocket** for streaming — SSE is simpler and sufficient for text streaming
- **`fullStream` over `textStream`** — when agents make tool calls between text steps, textStream concatenates without separators. fullStream preserves step boundaries.
- **Debounce screen reader announcements** during streaming — batch updates every few seconds, not per-token
- Use `aria-live="polite"` and `aria-atomic="false"` on response containers

---

## 7. Reference Products

| Product | What to Study | URL |
|---------|--------------|-----|
| Cursor 3 Agents Window | Multi-agent grid, agent tabs, parallel execution | cursor.com |
| AgentsRoom | Agent cards, status indicators, role labels, mobile companion | agentsroom.dev |
| Agentfy | iOS Live Activities, Dynamic Island, push notifications | getagentfy.com |
| Claude Code stream-json | Structured event protocol for custom UIs | anthropics/claude-code |
| Streamdown | Streaming markdown rendering with Shiki highlighting | streamdown.ai |
| OpenClaw Mission Control | WebSocket-based multi-agent dashboard | cryptoflexllc.com |
| Vercel AI SDK chat-sdk | Streaming patterns, fullStream vs textStream | chat-sdk.dev |

---

## 8. Key Takeaways

1. **The paradigm shift is real**: Cursor 3 moved from "IDE with AI" to "agent orchestrator with IDE." pi-dashboard is already positioned correctly as an agent orchestrator — lean into this.

2. **Mobile monitoring is the killer use case**: Most developers use mobile to check agent status and provide quick input, not to code. iOS Live Activities and rich push notifications are the highest-value mobile features.

3. **Collapse everything by default**: Tool calls, file diffs, long outputs — show one-line summaries. Let users expand what they care about. This is especially critical on mobile.

4. **Status indicators are the dashboard's primary information**: Color-coded dots, activity summaries, and "needs attention" flags should be visible at a glance. A user should understand all agent states in under 2 seconds.

5. **Streaming UX is harder than streaming implementation**: Buffering incomplete markdown, preventing layout thrash, and managing auto-scroll are the hard problems. Use proven libraries (Streamdown) rather than rolling your own.

6. **Error states are not optional**: Design loading, success, and failure states for every AI interaction. Most products skip this and users assume the product is broken.
