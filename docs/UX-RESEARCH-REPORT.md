# AI Coding Agent Dashboard UX Research Report

*April 2026 — Research for pi-dashboard (web + iOS)*

---

## Executive Summary

The AI coding agent space has converged on several clear UX patterns while simultaneously grappling with fundamental interaction design challenges. The shift from single-chat to multi-agent orchestration is the defining trend of 2026. This report synthesizes findings from leading tools (Cursor 3, Claude Code, Cline, etc.), emerging multi-agent dashboards, mobile-first tools, and UX criticism to produce actionable recommendations for pi-dashboard.

---

## 1. Leading AI Coding Agent UI Patterns

### Cursor 3 — Agent-First Multi-Session

Cursor 3 (April 2026) is the strongest signal for where agent UIs are heading:

- **Agents Window** replaces the old Composer pane as the primary interface
- **Tabbed agents** — each agent runs in its own tab, viewable side-by-side or in a tiled grid layout
- **Tiled layout** (3.1 release) — split views for managing several agents in parallel, with drag-to-tile and keyboard nav
- **Environment isolation** — each agent can target local, worktree, cloud, or remote SSH independently
- **`/worktree` command** — create git worktrees for isolated parallel work
- **Design Mode** — annotate browser UIs and send elements directly to agents (visual interaction)

**Key takeaway**: The IDE is becoming a control surface for fleets of agents, not a single chat window. Tabs + tiles for parallel agent visibility is the emerging standard.

### Claude Code — Terminal-Native React UI

- Built with **React + Ink** (React renderer for terminals) — fully reactive with components, hooks, state
- **Parallel Sessions** redesign — sidebar for listing all sessions, switch between multiple tasks
- **Subagent architecture** — spawn background agents for independent work streams
- **Permission dialogs** — inline approval gates before consequential actions
- **Tool call displays** — structured rendering of what tools the agent is using
- **Progress indicators** — real-time visibility into the agentic loop

**Key takeaway**: Even terminal UIs benefit from React-style component architecture. The "check in on results as they come" mental model is critical.

### Cline — VS Code Extension

- **Diff view provider** — side-by-side before/after diffs for every file edit
- **Chat row grouping** — related tool calls grouped under meaningful labels
- **Permission-per-step** — user approves each action (file edit, command execution, browser use)
- **Animated diffs** for large file edits with edit count indicators
- **Webview-based chat** — full React app inside VS Code's webview panel

**Key takeaway**: Diff rendering quality and tool call grouping are differentiators. Users want to see what changed, not raw logs.

### Common Patterns Across All Tools

| Pattern | Tools Using It | Notes |
|---------|---------------|-------|
| Streaming token display | All | Baseline expectation |
| Tool call visualization | Claude Code, Cline, Cursor | Collapsible, labeled by action type |
| Diff views for edits | Cline, Cursor, Claude Code | Side-by-side or inline |
| Session sidebar | Cursor 3, Claude Code desktop | List, search, switch sessions |
| Permission gates | Cline, Claude Code | Before file writes, commands, external calls |
| Code block syntax highlighting | All | With copy button, language label |
| Stop/interrupt button | All | Prominent during streaming |
| Retry/regenerate | ChatGPT, Claude.ai, most chat UIs | One-click redo |

---

## 2. Chat-Based Developer Tool UX Patterns

### Streaming Response Rendering

This is where most UIs still struggle:

- **Buffer incomplete markdown** — half-open bold tags, unclosed code fences break layouts
- **Defer code block rendering** until closing fence arrives, or show "streaming" indicator inside block
- **Avoid layout thrash** — each new token shouldn't cause full re-layout; use CSS that allows container growth without shifting surrounding elements
- **Batch DOM updates** — e.g., DeltaKit's `batchMs` prop controls update frequency to prevent flicker
- **`aria-live="polite"` with `aria-atomic="false"`** — for screen readers, announce only new tokens, debounced

**Best practice**: Stream structured lifecycle events (`STEP_STARTED`, `TOOL_CALLED`, `STEP_FINISHED`) rather than raw tokens for agentic workflows. Users reading individual reasoning tokens is noise, not transparency.

### Code Block Rendering

- Syntax highlighting with language detection (fallback to plaintext)
- **Copy button** on every code block (top-right corner, always visible)
- **Language label** (top-left, e.g., "typescript", "bash")
- **Line numbers** for longer blocks (optional, toggleable)
- **Diff-aware rendering** — show green/red for additions/removals
- **Collapsible** for very long outputs (show first N lines + "expand")
- On mobile: horizontal scroll for wide code, with momentum scrolling

### Tool Call Visualization

Three-tier progressive disclosure model (from tianpan.co):

1. **Tier 1 (always visible)**: What the agent is doing + what it produced. "Searched 3 databases. Found 12 records."
2. **Tier 2 (expandable)**: Reasoning behind decisions, alternatives considered, uncertainty
3. **Tier 3 (debug/inspector)**: Full tool call logs, raw retrieval results, internal state

Group related tool calls under meaningful labels ("Edited 3 files", "Ran tests") rather than showing each individually.

### Session Management

- **Auto-save every message** as it completes
- **Auto-generated titles** from first message (editable)
- **Session list** with timestamp, preview, status indicator
- **Search across sessions** — essential as sessions accumulate
- **Quick switching** without losing scroll position or draft prompts
- **Session grouping** — by project, date, or custom folders/tags

### Multi-Session Views

- **Sidebar navigation** — primary pattern (Cursor, Claude Code, AgentsRoom)
- **Grid/tiled layout** — Cursor 3.1's approach for parallel monitoring
- **Status badges** on session list items (running/idle/error/completed)
- **Notification dots** for sessions with new output

---

## 3. Dashboard Design for Agent Orchestration

### Emerging Multi-Agent Dashboards

Several tools have emerged specifically for this problem:

| Tool | Approach | Key Features |
|------|----------|-------------|
| **AgentsRoom** | Desktop + mobile app | Real-time status, role visibility, push notifications |
| **Caspian** | Control room | Isolated workspaces per agent, one-screen overview |
| **Shep** | Feature-per-worktree | CI watching, auto-commits, PR management per agent |
| **OctoAlly** | Orchestration dashboard | Sits atop Claude Code + Codex, cross-project visibility |
| **Weave Agent Fleet** | Web UI fleet manager | Workspace isolation, streaming, diff viewer, files tab |
| **agentdock** | Mobile-friendly web | tmux sessions + git worktrees, multi-repo |

### Key Dashboard Patterns

**Status Indicators**:
- Traffic light (green/yellow/red) for agent health
- Activity pulse/heartbeat animation for actively-running agents
- Idle timer showing how long since last activity
- Error badge with count

**Slot/Session Management**:
- Named slots with associated project/repo context
- One-click spawn new agent in a slot
- Kill/restart individual agents
- Persistent sessions that survive disconnects

**Notifications**:
- Push notifications when agent needs approval or completes a task
- Badge counts on session items
- Toast notifications for errors/completions
- Sound alerts (optional, for long-running background tasks)

**Layout Patterns**:
- **List view** — best for many sessions, scanning status quickly
- **Grid view** — best for monitoring 2-6 active agents simultaneously
- **Focus + sidebar** — one active session expanded, others in sidebar (most common)
- **Tiled/split** — Cursor 3.1's approach, 2-4 panes side by side

---

## 4. Mobile-First Considerations

### What Works on Mobile

Most AI coding tools are desktop-only, but several mobile-specific tools and patterns have emerged:

**AgentsRoom Mobile** (iOS/Android):
- Real-time agent status monitoring
- Terminal streaming to phone
- Chat interface for interaction
- Push notifications for agent events
- End-to-end encrypted desktop↔mobile sync

**Evern** (Mobile AI Terminal):
- "Conversation-first" — replaces bash prompts with natural language
- Renders tool output as **rich interactive cards** instead of raw terminal output
- Code diffs, file trees, error traces as first-class UI elements
- Three-layer rendering pipeline transforms raw output → structured cards

**OpenCodex** (iOS + local backend):
- iPhone connected to Worker service on Mac
- Multi-turn conversation with Claude/Codex
- Terminal access and file browsing on phone
- Command approval from phone

### Mobile UX Principles for Agent Monitoring

1. **Monitoring over editing** — mobile is for checking status, approving actions, reading output. Not for writing code.
2. **Push notifications are critical** — "Agent needs approval", "Task complete", "Error occurred"
3. **Swipe gestures for session switching** — faster than sidebar navigation on small screens
4. **Collapsible tool calls by default** — screen real estate is precious
5. **Rich cards over raw text** — transform terminal output into structured, tappable cards
6. **Sticky action bar** — approve/reject/stop always visible at bottom
7. **Horizontal code scrolling** — with momentum, pinch-to-zoom for code blocks
8. **Dark mode by default** — most developers prefer it, saves battery on OLED
9. **Haptic feedback** — subtle vibration on agent completion or error
10. **Offline queue** — queue messages/approvals when connectivity drops, sync when back

### Mobile Anti-Patterns

- ❌ Trying to replicate the full desktop IDE experience
- ❌ Tiny text for code blocks with no zoom
- ❌ No way to quickly scan which agents need attention
- ❌ Requiring precise cursor placement for any interaction
- ❌ Full keyboard for every interaction (use buttons, quick replies, voice)

---

## 5. Common Anti-Patterns

### The "Thrash" — Decision Overload

The #1 complaint across the industry (Speedscale, multiple blog posts):
- Too many model choices (Opus/Sonnet/Haiku/GPT-5/Gemini)
- Too many mode choices (Fast/Deep/Auto)
- Too many tool choices (Cursor/Claude Code/Windsurf/Copilot)
- **Each interaction requires a meta-decision** about how hard the AI should think

**Fix**: Opinionated defaults. Pick sensible defaults and let power users override. Don't force every user to be an inference cost analyst.

### The Five Agent UI Failures (tianpan.co)

1. **Unfamiliar paradigm** — blank input field with no guidance on what's possible
2. **Ambiguous intent** — agents that over-clarify feel tedious; under-clarify make wrong assumptions
3. **Loss of control** — 30 seconds of no feedback = users think it's hung
4. **Transparency vacuum** — no visibility into micro-decisions erodes trust over sessions
5. **Architectural mismatch** — async multi-step work crammed into synchronous chat UI

### Streaming UX Failures

- Layout thrash (content jumping as tokens arrive)
- Broken markdown during streaming (unclosed tags, partial code blocks)
- No stop button or hard-to-find stop button
- Stealing focus from input field after response completes
- Announcing every token to screen readers

### Information Overload

- Showing every raw tool call without grouping
- Dumping full file contents in chat instead of summaries with expand
- No progressive disclosure — everything at the same visual weight
- Status updates that are technically accurate but semantically meaningless

### Session Management Failures

- Sessions that don't survive page refresh
- No search across historical sessions
- Silent context truncation (dropping old messages without telling user)
- Can't switch sessions without losing scroll position
- No indication of which sessions have new content

---

## 6. Actionable Recommendations for pi-dashboard

### High Priority

1. **Multi-session sidebar with status badges**
   - Show all active sessions with running/idle/error/complete status
   - Badge counts for unread messages
   - Auto-generated titles (editable)
   - Search/filter across sessions

2. **Progressive disclosure for tool calls**
   - Default: one-line summary ("Edited 3 files", "Ran tests ✓")
   - Expand: show details (file names, test output)
   - Inspector mode: full raw tool call data

3. **Streaming that doesn't break**
   - Buffer incomplete markdown before rendering
   - Batch DOM updates (16-50ms intervals)
   - Skeleton states while waiting for first tokens
   - Prominent stop button during streaming

4. **Mobile-optimized monitoring view**
   - Session list with color-coded status dots
   - Push notifications for: agent needs input, task complete, errors
   - Swipe between sessions
   - Collapsible tool calls (collapsed by default on mobile)
   - Sticky bottom bar: input field + quick actions

5. **Code block quality**
   - Syntax highlighting with language detection
   - Copy button, language label
   - Horizontal scroll on mobile (not wrapping)
   - Collapsible for long outputs

### Medium Priority

6. **Tiled/grid view for power users**
   - 2-4 sessions visible simultaneously
   - Useful for monitoring parallel agents
   - Drag-to-resize panes

7. **Notification system**
   - In-app toasts for session events
   - iOS push notifications via APNs
   - Configurable per-session (mute busy sessions)

8. **Session persistence and history**
   - Auto-save, survive refreshes
   - Searchable session history
   - Group by project or tag

9. **Approval gates on mobile**
   - Clear approve/reject UI for permission-required actions
   - Show what the agent wants to do with enough context to decide
   - One-tap approve from notification

### Lower Priority (But Valuable)

10. **Keyboard shortcuts** (web) — Cmd+K for search, arrow keys for session nav, Escape to close panels

11. **Confidence-gated indicators** — show when agent is uncertain, not raw confidence scores

12. **Graceful degradation** — when connection drops, show last known state + reconnecting indicator

13. **Accessibility** — `aria-live` for streaming, keyboard navigation, proper contrast ratios

---

## 7. Design Inspiration Sources

| Tool | What to Learn From It |
|------|----------------------|
| **Cursor 3 Agent Window** | Tiled multi-agent layout, agent tabs, environment isolation per agent |
| **Claude Code Desktop** | Parallel session sidebar, check-in-when-ready mental model |
| **AgentsRoom Mobile** | Push notifications, desktop↔mobile sync, real-time status |
| **Evern** | Rich cards instead of raw terminal output on mobile |
| **Cline** | Diff rendering quality, tool call grouping in chat |
| **Shep** | Feature-per-agent model, CI/PR integration per session |
| **Linear** | Clean status indicators, keyboard-first navigation, sidebar design |
| **Slack** | Thread model, unread indicators, mobile notification UX |
| **GitHub Mobile** | Code rendering on mobile, PR review on small screens |

---

## 8. Key Metrics to Track

Based on the UX research, these are the interaction metrics that indicate whether the dashboard UX is working:

- **Time to first interaction** — how fast can a user send their first message?
- **Session switch frequency** — how often do users jump between sessions?
- **Tool call expand rate** — are users expanding details? (Too high = not enough default info; too low = summaries are sufficient)
- **Mobile vs web usage ratio** — what % of interactions happen on mobile?
- **Notification tap-through rate** — are push notifications useful or noise?
- **Session abandonment rate** — are sessions dying because users can't find/resume them?
