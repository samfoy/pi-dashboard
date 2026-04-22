# AI Coding Agent Dashboard UX Research

> Research date: 2026-04-21
> Purpose: Inform pi-dashboard (web + iOS) design for managing multiple pi coding agent sessions

---

## 1. Leading AI Coding Agent GUIs — What Works

### Cursor 3 (April 2026) — The New Benchmark
Cursor 3 is the most significant reference point. It shifted from "IDE with chat sidebar" to "agent-first workspace."

**Key patterns:**
- **Agents Window**: Full-screen workspace replacing the old Composer pane. Agents are the primary unit of work, not chat completions
- **Agent Tabs**: View multiple agent chats side-by-side or in a grid layout
- **Tiled Layout** (v3.1): Split view into panes to run/manage several agents in parallel. Expand panes to focus, drag agents into tiles, keyboard shortcuts for navigation
- **Environment isolation**: Each agent can run in its own context — local, cloud, worktree, remote SSH — visible in the UI
- **Background agents**: Agents keep working when laptop is closed. Status is always visible
- **Unified interface**: Chat → Composer → Agent merged into single panel. Start conversation, naturally transition to multi-file edit
- **Design Mode**: Visual annotation of browser UI elements, sent directly to agents (not applicable to pi-dashboard but shows the trend of rich interaction modes)
- **Best-of-N**: Run same prompt against multiple models, pick best result

**Takeaway for pi-dashboard**: The tiled/grid layout for parallel agents is directly applicable. Agent status should be glanceable without opening each session.

### Cline (VS Code Extension)
**Key patterns:**
- **Generative streaming UI**: Real-time visualization of tool execution including diffs, browser interactions, command output
- **Plan/Act workflow**: Two distinct modes — planning (reasoning/discussion) vs acting (making changes). Visual separation
- **Permission gates**: Every tool call requires explicit approval. Each action shows what will happen before it does
- **Collapsible tool results**: Tool calls shown inline but collapsed by default, expandable for detail
- **Chat row grouping**: Messages grouped visually into coherent blocks (user message + all resulting tool calls + response)
- **Cost tracking**: Token/cost display per message and cumulative

**Takeaway for pi-dashboard**: Collapsible tool calls are essential. Group related messages. Show cost/token info.

### Claude Code (Terminal)
**Key patterns:**
- **Streaming with structure**: Even in terminal, separates thinking, tool calls, and responses visually
- **Compact tool output**: Summarizes tool results (e.g., "✔ 142 lines (3.2KB)") with ability to expand
- **Session persistence**: Resume sessions across terminal restarts
- **Subagent spawning**: Visual indication of background work

**Takeaway for pi-dashboard**: The compact-with-expand pattern for tool results is critical on mobile.

### Windsurf (Cascade)
**Key patterns:**
- **Flow-aware context**: Cascade tracks what you've been doing and maintains context automatically
- **In-IDE preview**: Live preview of changes without leaving the editor
- **Agentic mode**: More autonomous than Cursor's chat, tries to do more without asking

### GitHub Copilot Chat
**Key patterns:**
- **Slash commands**: `/fix`, `/explain`, `/tests` — quick action shortcuts
- **Context chips**: Visual indicators of what context is being sent (files, selections, terminal output)
- **Inline suggestions**: Suggestions appear in-context, not just in a sidebar

---

## 2. Chat-Based Developer Tool UX Patterns

### Message Rendering

**Code blocks:**
- Syntax highlighting with Shiki or similar (language auto-detection)
- Copy button on every code block (top-right corner, appears on hover)
- Line numbers for blocks > 5 lines
- Collapsible for blocks > 15-20 lines (`maxCollapsedLines` pattern)
- Language label visible in header bar
- Diff rendering for file edits (red/green, not just raw code)

**Tool call visualization:**
- Show tool name + brief description inline in chat flow
- Collapse results by default, show 1-line summary
- Status indicator: pending → running → complete/error
- Expandable detail with full output
- Group: user message → thinking → tool calls → response as one visual unit
- Sandbox component pattern: collapsible container with status badge + tabs for code/output

**Markdown rendering:**
- Full markdown support (headers, lists, bold, links, tables)
- Buffer incomplete markdown during streaming before rendering
- Don't render half-open tags (`**partial` shouldn't break layout)

### Streaming Output

**Critical practices:**
- **First token in 200-400ms** — streaming reduces perceived latency by 60-80%
- **Batch DOM updates** — don't re-render on every token; batch to avoid janky rendering
- **Avoid layout thrash** — new tokens shouldn't cause entire message to re-layout; use CSS that allows container to grow without shifting surrounding elements
- **Progressive code block rendering** — show code appearing with "streaming" indicator, or defer until closing fence
- **Stop button**: Prominent during streaming, not hidden in a menu
- **Retry button**: One-click regeneration preserving original prompt
- **Scroll behavior**: Auto-scroll to bottom during streaming, but stop auto-scroll if user scrolls up to read earlier content

**Accessibility:**
- `aria-live="polite"` on response container
- `aria-atomic="false"` so only new tokens are announced
- Debounce screen reader announcements during fast streaming

### Session Management

**History:**
- Auto-save every message as it completes (never lose work)
- Session list in sidebar: title (auto-generated or editable), timestamp, preview snippet
- Search across sessions (semantic, not just text)
- Group by project, date, or custom folders

**Context window transparency:**
- Tell user when old messages are being truncated ("Using last 20 messages for context")
- Allow pinning important messages to always include in context
- Conversation branching — start new thread inheriting selected context

**Multi-session:**
- Sidebar listing all active sessions
- Quick switching without losing scroll position or draft prompts
- Visual indicators of session state (active/streaming, idle, waiting for input, errored, complete)

---

## 3. Dashboard Design for Agent Orchestration

### Multi-Agent Views

**From Cursor 3 Agents Window:**
- Grid/tiled layout — each agent gets a tile showing current status
- Expand any tile to full view, collapse back
- Drag agents between tiles
- Keyboard shortcuts for navigation between tiles

**From AgentsRoom:**
- All agents in one dashboard with live status indicators
- Color-coded status: yellow pulsing dot (thinking), green (done), red (waiting for input)
- Elapsed time and current activity displayed in real-time
- Role-based assignment labels (Frontend, Backend, QA, DevOps)
- Git worktree isolation visible per agent
- Token spend tracking per agent and total

**From Zypsy Agent Orchestration UI:**
Core UI surfaces for agent orchestration:

| Surface | Purpose | Key Elements |
|---------|---------|--------------|
| Orchestration Canvas | Compose, version, run multi-agent flows | Visual graph, node palette, execution controls |
| Run Dashboard | Monitor live/historical runs | Timeline, step status, logs, traces |
| Prompt Registry | Manage prompt templates | Version history, A/B test config, playground |
| Trace Viewer | Debug individual runs | Token-level trace, tool calls, latency breakdown |

### Status Indicators

**Essential states:**
1. **Idle** — session exists but agent isn't running (gray)
2. **Running/Thinking** — agent is processing (animated indicator, yellow/blue)
3. **Streaming** — actively producing output (pulsing, distinct from thinking)
4. **Waiting for input** — needs human attention (red/orange, prominent)
5. **Tool executing** — running a tool call (shows tool name)
6. **Complete** — task finished (green checkmark)
7. **Error/Crashed** — something went wrong (red with error badge)

"Waiting for input" is the most important state — it's the only one requiring immediate human action.

### Notifications

**Push notification triggers (from Agentfy/AgentsRoom patterns):**
- Agent finished task
- Agent needs user input/approval
- Agent errored/crashed
- Agent has been idle too long (stalled)

**NOT worth notifying:**
- Every tool call
- Every message
- Streaming progress

---

## 4. Mobile-First Considerations

### Existing Mobile Solutions

**AgentsRoom Mobile (iOS/Android):**
- Real-time desktop ↔ mobile sync via encrypted channel
- Terminal streaming view on phone
- Chat interface for interacting with agents
- Push notifications for agent state changes
- Live preview of web apps being built
- Start/stop agents from phone

**Agentfy (iOS):**
- iOS Live Activities for agent status in Dynamic Island and Lock Screen
- Push notifications when agents finish or need input
- Focused on monitoring, not full interaction
- "Know when Claude needs you" — the key mobile use case

### Mobile UX Recommendations

**What works on mobile:**
1. **Status overview** — Glanceable grid of all agents with color-coded status dots
2. **Push notifications** — Alert when agent needs attention (waiting for input, error, complete)
3. **Quick replies** — Approve/reject tool calls, send short follow-up messages
4. **Session switching** — Swipe between sessions, tap to expand
5. **Live Activities / Dynamic Island** (iOS) — Show active agent count and status without opening app
6. **Compact message view** — Show only latest message per session in overview, expand for full history

**What doesn't work on mobile:**
1. **Full code editing** — Screen too small for meaningful code review
2. **Side-by-side comparison** — Tiled layout doesn't work on phone
3. **Long-form prompting** — Typing detailed instructions is painful
4. **Diff review** — Detailed code diffs need desktop screen width

**Mobile-specific patterns:**
- **Swipe gestures**: Swipe right to approve, left to reject tool calls
- **Haptic feedback**: Subtle vibration when agent state changes
- **Compact code blocks**: Show first/last 3 lines with "N more lines" in middle
- **Voice input**: Dictate messages to agents (Cursor 3.1 added voice in Agents Window)
- **Pull to refresh** for session list, but prefer WebSocket for real-time
- **Bottom navigation**: Sessions | Activity | Settings (not hamburger menu)

---

## 5. Common Anti-Patterns

### Information Overload
- ❌ Showing every token of tool output inline (makes chat unreadable)
- ❌ No distinction between thinking/reasoning and actual output
- ❌ Flat message list with no grouping (hard to find where one task ends and another begins)
- ✅ Collapse tool results by default, show 1-line summary
- ✅ Visual separation between message groups
- ✅ Thinking/reasoning in a distinct, collapsible section

### Poor Streaming UX
- ❌ Layout thrash — page jumping around as content streams in
- ❌ Auto-scroll that can't be overridden (user scrolls up to read, gets yanked back down)
- ❌ No stop button, or stop button hidden/hard to find
- ❌ Rendering half-broken markdown during streaming
- ✅ Sticky auto-scroll that disengages on manual scroll
- ✅ Prominent stop button during streaming
- ✅ Buffer markdown rendering until structure is complete

### Bad Code Formatting
- ❌ No syntax highlighting
- ❌ Code blocks without copy buttons
- ❌ No language labels on code blocks
- ❌ Horizontal scrolling issues on mobile
- ❌ Diffs shown as raw text instead of side-by-side or inline colored diff
- ✅ Shiki-based highlighting with theme matching
- ✅ Responsive code blocks that wrap or scroll gracefully

### Focus & Navigation Issues
- ❌ **Focus stealing** — when response completes, focus moves away from input (biggest complaint from Cursor users)
- ❌ Losing draft prompt when switching sessions
- ❌ No keyboard navigation between messages
- ❌ No way to jump to latest message
- ✅ Keep focus on input after response completes
- ✅ Preserve draft prompts per session
- ✅ Cmd+↓ to jump to bottom, Cmd+↑ to jump to top

### Session Management Failures
- ❌ Sessions dying silently with no notification
- ❌ No way to resume/reconnect to a session
- ❌ Losing scroll position when switching between sessions
- ❌ No search across session history
- ✅ Clear visual indicators of session health
- ✅ Auto-reconnect with retry
- ✅ Preserve scroll position per session

### Mobile-Specific Anti-Patterns
- ❌ Desktop layout crammed onto mobile screen
- ❌ Tiny tap targets for approve/reject actions
- ❌ No push notifications (have to keep app open)
- ❌ Full terminal emulator on phone (unreadable)
- ✅ Purpose-built mobile layout focused on monitoring + quick actions
- ✅ Large, swipeable action areas
- ✅ Native push notifications for important state changes

---

## 6. Actionable Recommendations for pi-dashboard

### Priority 1: Core Chat Experience
1. **Collapsible tool calls** — Show tool name + 1-line result summary. Tap/click to expand full output. This is the #1 UX improvement for agent chat interfaces
2. **Message grouping** — Group user message + all resulting tool calls + final response as one visual block with subtle separator between groups
3. **Streaming that doesn't thrash** — Buffer markdown, batch DOM updates, auto-scroll with manual override
4. **Stop/retry controls** — Prominent stop button during streaming, retry on any response
5. **Syntax-highlighted code blocks** — With copy button, language label, collapsible for long blocks

### Priority 2: Multi-Session Dashboard
6. **Grid overview** — Show all active sessions as cards with: status dot (color-coded), session name, project, last message preview, elapsed time
7. **Status indicators** — 7 states (idle, thinking, streaming, waiting-for-input, tool-executing, complete, error). "Waiting for input" should be visually loudest
8. **Quick session switching** — Tap card to enter session, preserve scroll position and draft prompts across sessions
9. **Session search** — Search across all sessions by content

### Priority 3: Mobile Experience (iOS)
10. **Push notifications** — Agent needs input, agent errored, agent completed. NOT every message
11. **Live Activities** — Show active agent count + status in Dynamic Island / Lock Screen
12. **Compact view** — Mobile gets abbreviated tool output, compact code blocks (first/last 3 lines)
13. **Quick actions** — Swipe to approve/reject, quick reply without full keyboard
14. **Bottom tab navigation** — Sessions | Activity feed | Settings

### Priority 4: Polish
15. **Token/cost display** — Per message and per session cumulative
16. **Session health monitoring** — Visual indicator when connection drops, auto-reconnect
17. **Keyboard shortcuts** — For power users on desktop/iPad with keyboard
18. **Dark mode** — Must-have for developer tools (probably already done)
19. **Haptic feedback** (iOS) — On agent state transitions

### Architecture Considerations
- **WebSocket for real-time** — SSE works but WebSocket better for bidirectional (sending messages + receiving streams)
- **End-to-end latency target**: < 50ms for streaming relay (per ChatML architecture reference)
- **Batch DOM updates during streaming** — Don't re-render on every token
- **Preserve state per session** — Scroll position, draft prompt, collapsed/expanded tool calls
- **Offline resilience** — Queue messages when disconnected, sync on reconnect

---

## References

- [Cursor 3 Announcement](https://cursor.com/en/blog/cursor-3)
- [Cursor 3.1 Tiled Layout](https://cursor.com/changelog/3-1)
- [AI Chat UI Best Practices (thefrontkit)](https://thefrontkit.com/blogs/ai-chat-ui-best-practices)
- [Cline Architecture Breakdown](https://memo.d.foundation/breakdown/cline)
- [Agent Orchestration UI (Zypsy)](https://llms.zypsy.com/agent-orchestration-ui-prompt-management)
- [AgentsRoom](https://agentsroom.dev/)
- [Agentfy](https://getagentfy.com/)
- [Streaming UX Patterns (Chanl)](https://www.chanl.ai/blog/streaming-ai-responses-sse-websockets-real-time)
- [ChatML WebSocket Architecture](https://chatml.com/blog/streaming-ai-agent-output-websocket-architecture)
- [Martin Fowler: Reducing Friction in AI-Assisted Dev](https://martinfowler.com/articles/reduce-friction-ai/)
- [The 80% Problem in Agentic Coding (Addy Osmani)](https://substack.com/home/post/p-185933546)
