# Feature Improvements Research: Pi-Dashboard

> Research date: 2026-04-21
> Focus: Theming, extensions, data viz, advanced chat, notifications, command palette
> Complements: `research-agent-dashboard-ux.md`, `research/ai-dashboard-ux-patterns.md`, `UX-RESEARCH-REPORT.md`

---

## Table of Contents

1. [Theming & Visual Polish](#1-theming--visual-polish)
2. [Extension/Plugin Status Displays](#2-extensionplugin-status-displays)
3. [Data Visualizations for Agent Activity](#3-data-visualizations-for-agent-activity)
4. [Advanced Chat Features](#4-advanced-chat-features)
5. [Smart Notifications & Activity Feed](#5-smart-notifications--activity-feed)
6. [Command Palette & Quick Actions](#6-command-palette--quick-actions)
7. [Prioritized Recommendations](#7-prioritized-recommendations)

---

## 1. Theming & Visual Polish

### Current Landscape

The developer tooling ecosystem has converged on a few dominant theme families. Catppuccin leads with 1.18M+ installs on VS Code alone, followed by Rosé Pine, Dracula, Nord, and Tokyo Night. The common thread: **pastel palettes with high readability and low eye strain**.

### Theme Architecture Patterns

**CSS Custom Properties (Arc Browser approach)**
Arc Browser injects theme colors as CSS custom properties on every page via `data-theme` attribute:
```css
:root {
  --arc-background-gradient-color0: #D2F3E5FF;
  --arc-palette-foregroundTertiary: #51D19BFF;
  --arc-palette-background: #001E15FF;
}
```
ARC UI (their design system) controls themes entirely through CSS custom properties, with `data-theme` on `<html>` switching between dark/light/auto/custom modes. This is the cleanest approach for web apps.

**Catppuccin's Token System**
Catppuccin defines 4 flavors (Latte, Frappé, Macchiato, Mocha) with consistent semantic color tokens: `base`, `surface0-2`, `overlay0-2`, `text`, `subtext0-1`, plus named accent colors (`rosewater`, `flamingo`, `pink`, `mauve`, `red`, `maroon`, `peach`, `yellow`, `green`, `teal`, `sky`, `sapphire`, `blue`, `lavender`). Users can customize the accent color independently of the flavor.

**VS Code 2026 Theme Refresh (Issue #293405)**
Microsoft is actively modernizing VS Code's default themes. The proposal highlights that the dev tools landscape has evolved with AI adoption, requiring fresh visual language. Key concern: maintaining backward compatibility while modernizing.

### Dynamic/Adaptive Themes

**Time-based switching:**
- Flutter's `flutter_adaptive_theme` package implements `AdaptiveThemeMode.timeBased` — automatically transitions between light/dark based on configurable time windows
- Android's Material Design recommends system-level theme adoption with `Theme.AppCompat.DayNight`
- Pattern: sunrise/sunset-aware themes (use device location or configured times)

**Content-aware adaptation:**
- Photo editing apps auto-switch to dark chrome when editing dark images
- Reading apps adjust contrast based on content length (longer = warmer tones)
- Ambient light sensor-driven switching (Android's Adaptive Theme app)

### Recommendations for Pi-Dashboard

| Recommendation | Effort | Impact |
|---|---|---|
| **CSS custom property theme system** — Define ~30 semantic tokens (`--pd-bg-primary`, `--pd-text-primary`, `--pd-accent`, `--pd-surface-*`, `--pd-border-*`) switchable via `data-theme` attribute | Medium | High |
| **Ship 4-5 built-in themes** — Dark (default), Light, Catppuccin Mocha, Rosé Pine, and a high-contrast option | Medium | High |
| **System theme sync** — Respect `prefers-color-scheme` media query, auto-switch dark/light | Low | High |
| **Per-session accent color** — Let users assign a color to each session for quick visual identification (Arc Browser's space colors pattern) | Low | Medium |
| **Theme import via JSON** — Allow importing custom themes as JSON token maps (Catppuccin-style) | Medium | Low |
| **Time-based auto-switch** — Optional schedule for light↔dark transition | Low | Low |

**Key insight**: Per-session accent colors are the highest-leverage visual feature. When managing 5+ parallel agents, color coding is faster than reading labels.

---

## 2. Extension/Plugin Status Displays

### How Leading Tools Handle Extension Status

**VS Code Status Bar Model**
VS Code's status bar has two zones:
- **Left (Primary)**: Workspace-level indicators — errors, warnings, Git branch, sync status
- **Right (Secondary)**: Contextual info — language mode, encoding, line/col, extension-specific

Extension status patterns:
- `StatusBarItem` with severity colors: normal (default), `warningBackground` (yellow), `errorBackground` (red)
- `withProgress({ location: ProgressLocation.Window })` for long-running tasks — shows spinner + text in status bar
- Agent Status Indicator (VS Code Jan 2026): Dedicated indicator in the "command center" area showing AI agent state
- Extension activation is invisible by default — **this is a known UX problem** (Issue #168676: no status indicator while waiting for extension activation)

**JetBrains Approach**
- Background processes shown in a bottom-bar progress indicator
- Plugins can register "background tasks" visible in a task manager
- Key concern: UI freezes from misbehaving plugins (entire livestream dedicated to this in March 2026)

**Status Patterns That Work**
1. **Healthy = invisible** — Don't show anything when extensions are working correctly
2. **Loading = subtle spinner** — Small animated indicator, not blocking
3. **Warning = colored badge** — Yellow dot/badge on the extension icon
4. **Error = persistent indicator** — Red badge + expandable error detail
5. **Background work = progress bar** — Determinate if possible, indeterminate if not

### Recommendations for Pi-Dashboard

| Recommendation | Effort | Impact |
|---|---|---|
| **Extension health strip** — Thin bar at bottom of each session panel showing active extensions as small colored dots (green=ok, yellow=slow, red=error). Tap/click to expand details | Medium | High |
| **"Healthy = invisible" principle** — Only surface extension info when something needs attention | Low | High |
| **Background task indicator** — When pi extensions are doing background work (e.g., session search indexing, memory operations), show a subtle spinner with label in the session header | Low | Medium |
| **Extension error toast** — Non-blocking notification when an extension fails, with "View Details" action | Low | Medium |
| **Extension panel** — Dedicated settings/status view listing all loaded extensions, their state, and resource usage. Accessible from settings, not always visible | Medium | Low |

---

## 3. Data Visualizations for Agent Activity

### Token Usage & Cost Tracking

**CodeBurn** (AgentSeal/codeburn — 769 stars) is the reference implementation:
- TUI dashboard for Claude Code, Codex, Cursor, Pi cost observability
- Tracks by: task type, tool, model, MCP server, project
- **One-shot success rate** per activity type — shows where AI nails it first try vs. burns tokens on retries
- Gradient charts, responsive panels, keyboard navigation
- CSV/JSON export
- macOS menu bar widget via SwiftBar

**AgentsView** (wesm/agentsview) — local-first session intelligence:
- Web UI at `localhost:8080` with full dashboard
- Project filter typeahead, session browser, search
- Usage page with daily cost reports and today's-spend summary
- Reads session JSONL files from disk (supports Claude Code, Codex, Pi, 14+ agents)
- AI-powered session summaries via Claude/Codex/Gemini

**Tokenr** — LLM cost attribution for multi-agent systems:
- Auto-patches OpenAI/Anthropic/Google SDKs
- Real-time dashboards, budget alerts
- Per-agent cost attribution
- Zero latency impact (tracks metadata, not content)

**Connic Observability Guide** — best practices for agent monitoring:
- Total runs, success rates, failures (baseline health)
- Token usage: input vs output vs cached vs reasoning (understand where context goes)
- Cost attribution: per-model pricing, volume tiers, input vs output costs
- Latency percentiles: p50, p95, p99 response times

### Context Window Visualization

**Context Lens** (larsderidder/context-lens):
- Local proxy capturing LLM API calls
- Shows composition breakdown: system prompts, tool definitions, conversation history, tool results, thinking blocks
- Answers "why is this session so expensive?"
- Works with Claude Code, Codex, Pi, and any OpenAI/Anthropic/Google API client

**PureDevTools Context Visualizer**:
- Stacked bar showing: system prompt, few-shot examples, user message, tool results, conversation history
- Warning threshold at 80%, critical at 95%
- Model-specific context limits

**LLM Visuals** (hoodini/llm-visuals):
- Token flow — input/output tokens per request with ratio bar
- Per-request cost tracking
- Full conversation chain inspection
- Cache hit stats

### Session Timeline & Activity Patterns

**GitHub contribution heatmap** adapted for agent activity:
- Calendar grid showing daily agent activity intensity
- Color intensity = total tokens or cost that day
- Gitmap (rudrodip/gitmap) — React component with shadcn, customizable color themes, tooltips

**AgentsRoom** (agentsroom.dev):
- Grid of agent cards with live status indicators
- Real-time token spend per agent
- Desktop + mobile companion app

### Recommendations for Pi-Dashboard

| Recommendation | Effort | Impact |
|---|---|---|
| **Session cost footer** — Show cumulative tokens (in/out) and estimated cost at the bottom of each chat session. Update in real-time during streaming | Low | High |
| **Context window gauge** — Horizontal progress bar showing how full the context window is (with model-specific max). Yellow at 80%, red at 95%. Show breakdown on hover: conversation history, tool results, system prompt | Medium | High |
| **Daily cost summary** — Simple card on the dashboard home showing today's total spend across all sessions, with sparkline of last 7 days | Medium | High |
| **Token composition breakdown** — Pie/donut chart per session: input tokens, output tokens, cached tokens, tool call tokens. Reveals which sessions are expensive and why | Medium | Medium |
| **Activity heatmap** — GitHub-style contribution grid on the sessions list page. Shows agent activity intensity per day over the last 3 months | Medium | Medium |
| **Tool call frequency chart** — Bar chart showing which tools are called most often per session (read, bash, edit, write, web_search, etc.) with success/failure rates | High | Medium |
| **Cost trend line** — 30-day line chart showing daily spend. Identify cost spikes, track optimization efforts | Medium | Low |
| **One-shot success rate** — CodeBurn-style metric showing how often tasks complete without retries. Useful for comparing model effectiveness | High | Low |

**Key insight**: The context window gauge is the single most valuable visualization. Users constantly wonder "how much runway do I have left in this session?" and currently have no visibility.

---

## 4. Advanced Chat Features

### Message Bookmarking & Pinning

This is an **actively requested feature** across the AI tool ecosystem:

**Open-WebUI PR #21519** — "Conversation Anchors":
- Users pin important messages
- Dedicated sidebar section shows all pinned messages
- Quick navigation jumps to pinned message location
- Behavior similar to bookmarks in a PDF reader

**Claude Code Issue #32874** — Pin/bookmark messages:
- Key use case: long coding sessions where decisions, critical outputs, and instructions get buried
- Context compaction makes this worse — once compacted, messages are gone
- Proposed: small bookmark icon on message hover, sidebar list of bookmarks

**ChatGPT Feature Request** (community.openai.com):
- Star/bookmark icon on hover for any message
- Bookmarks panel in sidebar
- Keyboard shortcut to toggle bookmark
- Export bookmarked messages

**Gemini Notebooks**:
- Google's approach: organize chats, files, and notes into dedicated "notebooks"
- Cross-reference between conversations
- Integration with NotebookLM for syncing data

### Conversation Branching/Forking

**assistant-ui** (TypeScript/React library, production-grade):
- Branches created automatically when: user message is edited, assistant message is regenerated
- `BranchPickerPrimitive` component: Previous/Next navigation + branch count display
- Branches tracked by observing changes to the `messages` array
- API: `aui.message().switchToBranch({ position: "previous" })`, `.reload()`

**LangChain's Branching Chat**:
- Requires LangGraph Agent Server backend
- Every edit creates a new branch
- Navigate freely between branches without losing previous work
- "Version-control semantics for chat UI"

**ShapeofAI Branches Pattern**:
- Branches preserve inputs, settings, and outcomes
- Works across modalities (text, image, code)
- Makes exploration auditable — each path is preserved
- Key for "not sure what I want" workflows

### Recommendations for Pi-Dashboard

| Recommendation | Effort | Impact |
|---|---|---|
| **Message bookmarking** — Bookmark icon on message hover. Bookmarks panel in session sidebar. Keyboard shortcut (⌘+D). Bookmarks persist across app restarts | Medium | High |
| **Jump-to-bookmark navigation** — Click bookmark in sidebar → auto-scroll to that message with highlight animation | Low | Medium |
| **Message reactions/ratings** — Thumbs up/down on assistant messages. Useful for personal feedback tracking, could feed into model selection decisions | Low | Medium |
| **Conversation branching (v1)** — When user edits a previous message, fork the conversation. Show branch picker (← 1/3 →) on forked messages. Store branches in session data | High | Medium |
| **Share session snapshot** — Generate a shareable link or exportable markdown of a session (or selected messages). Useful for bug reports, knowledge sharing | Medium | Medium |
| **Message search within session** — ⌘+F to search within the current conversation. Highlight matches, navigate between them | Medium | Medium |
| **Inline code execution results** — For tool calls that produce output, show a collapsible inline result widget (already partially implemented; enhance with tabs for stdout/stderr/exit code) | Medium | Low |

**Key insight**: Message bookmarking is low-effort, high-impact. Long agent sessions (50+ messages) are the norm, and finding "that one message where the agent showed the working solution" is a real pain point.

---

## 5. Smart Notifications & Activity Feed

### Activity Feed Patterns

**GitHub Activity Feed**:
- Chronological stream of events across repositories
- Event types: push, PR, issue, review, release
- **Digest tools** (Gitmore, etc.) aggregate per-event notifications into scheduled summaries
- Pain point: real-time per-event notifications don't scale for teams monitoring many repos

**Linear Notifications**:
- Unified inbox (not scattered across channels)
- Categorized by channel: Desktop, Mobile, Email, Slack
- **Grouped notifications** — e.g., all status change notifications bundled
- Green dot indicators for unread
- Settings per notification type per channel

**37signals (Basecamp/Hey) Notification Bundling**:
- **Time window bundling** — group notifications into time windows rather than linking individual notifications to bundles
- Client-side grouping by subject with Stimulus.js
- Pattern: reduces clutter, works dynamically with new notifications

**Unified Inbox Approach** (DEV Community research):
- One window, one chronological feed, smart filtering
- Pull multiple sources (GitHub, Slack, email) into single stream
- Instant startup time is critical for frequently-used tools

### Digest / "While You Were Away" Patterns

**GitHub Activity Digest Tools (2026)**:
- Scheduled summaries replacing real-time per-event notifications
- Daily/weekly email digests with configurable scope
- Team-level activity rollups

**Key UX principles for digests**:
1. Group by project/session, not by event type
2. Show outcome, not play-by-play (e.g., "Session completed: refactored auth module, 14 files changed" not "edit src/auth.ts... edit src/auth.ts... edit src/auth.ts...")
3. Highlight failures and items needing attention first
4. Include cost summary in digest

### Recommendations for Pi-Dashboard

| Recommendation | Effort | Impact |
|---|---|---|
| **Activity feed on dashboard home** — Chronological feed of events: session started/completed/errored, subagent spawned, notable tool calls (file writes, git commits). Grouped by session | Medium | High |
| **"While you were away" digest** — When opening the dashboard after >30min away, show a summary card: sessions completed, sessions waiting for input, errors, total cost since last visit | High | High |
| **Session status badges** — Glanceable status on each session card: 🟢 Active, 🔵 Waiting for input, 🟡 Running (background), 🔴 Error, ⚪ Idle. Push notification on status change | Low | High |
| **Smart notification grouping** — Bundle rapid-fire events (e.g., 10 file edits in 30 seconds → "Edited 10 files in src/"). Linear-style time-window bundling | Medium | Medium |
| **Push notifications (iOS)** — Notify when: session completes, session errors, session needs user input. Configurable per-session | Medium | Medium |
| **Daily digest email/notification** — Optional end-of-day summary: sessions run, total cost, notable outcomes | High | Low |
| **Notification preferences** — Per-event-type toggle for push/in-app notifications | Medium | Low |

**Key insight**: The "while you were away" digest is the killer feature for a multi-agent dashboard. When running 3-5 agents in parallel, you need a fast way to catch up on what happened without reading each session's full chat log.

---

## 6. Command Palette & Quick Actions

### Design Principles (from Superhuman, Linear, Raycast)

**Superhuman's 5 Rules for Command Palettes**:

1. **Available everywhere** — Same shortcut (⌘K) works in every screen. Capture keyboard events at top-level. Dismiss with same shortcut.
2. **Central** — One place for every command. Don't split actions across ⌘K and ⌘P.
3. **Omnipotent** — Give access to every possible action. When designing new features, always define the corresponding command.
4. **Flexible** — Fuzzy matching with typo tolerance. Use `command-score` (Superhuman's open-source library) or similar. Add aliases/synonyms (e.g., "archive" matches "Mark Done").
5. **Contextually relevant** — Show/hide commands based on current context. Boost scores for contextually likely actions. Each command has a "scale" multiplier for relevance ranking.

**Implementation details from Superhuman**:
- Visually imposing — centered, covers large area, monospaced font
- Last command intentionally cut off (implies more below)
- Each command has its own icon
- Show matching alias alongside canonical name: "Mark Done (Archive)"
- Track last-used items for adaptive ordering
- Default scores for commands before user types anything (highlight important features)

**Raycast Search Bar**:
- Focused by default on open — immediate typing
- Fuzzy search across all content types
- Placeholder text in search bar hints at capabilities
- Root search spans applications, commands, files

**cmdk Library** (by Paco Coursey):
- Powers command palettes in Linear, Raycast, Vercel
- React component: `<Command>`, `<Command.Input>`, `<Command.List>`, `<Command.Item>`
- Automatic filtering, sorting, keyboard navigation, accessibility
- Unstyled by default — compose with shadcn/ui for polished look
- shadcn/ui has a pre-built `Command` component wrapping cmdk

**Sam Solomon's Design Principles**:
- Command palettes are for **doing things**, not just finding things (distinction from regular search)
- Benefit power users who know what the app can do
- Should surface keyboard shortcuts inline to train users
- Group commands by category with visual separators

### Recommendations for Pi-Dashboard

| Recommendation | Effort | Impact |
|---|---|---|
| **Global command palette (⌘K)** — Built with cmdk + shadcn/ui Command component. Available on every screen. Dismissible with ⌘K or Escape | Medium | High |
| **Session actions** — "Switch to session X", "New session", "Stop session", "Send message to session" all accessible via ⌘K | Medium | High |
| **Fuzzy search across sessions** — Search by session name, project path, recent messages. Use command-score or similar for typo-tolerant matching | Medium | High |
| **File quick-open** — ⌘P to jump to any file across all sessions' file browsers | Medium | Medium |
| **Command categories** — Group by: Sessions, Navigation, Settings, Actions. Visual separators + category headers | Low | Medium |
| **Contextual commands** — When viewing a session: show session-specific commands first (stop, restart, clear, bookmark). When on dashboard: show global commands | Medium | Medium |
| **Keyboard shortcut display** — Show shortcut hints next to every command in the palette. Trains users to graduate from palette to direct shortcuts | Low | Medium |
| **Recent commands** — Track and show recently used commands at the top (before user types). Adaptive ordering based on usage frequency | Medium | Low |
| **Quick send** — From command palette, type `/send <session> <message>` to send a message to any session without switching to it | High | Low |

**Key insight**: cmdk + shadcn/ui Command is the obvious implementation choice — it's battle-tested (Linear, Raycast), React-native, accessible, and composable. A basic implementation takes ~2 hours; the real work is registering all actions and tuning relevance.

---

## 7. Prioritized Recommendations

### Tier 1 — High Impact, Low-Medium Effort (Do First)

| # | Feature | Category | Effort | Why |
|---|---------|----------|--------|-----|
| 1 | **Global command palette (⌘K)** | Command Palette | Medium | Unlocks keyboard-driven power usage. cmdk + shadcn makes implementation fast |
| 2 | **Session status badges** | Notifications | Low | 🟢🔵🟡🔴 on every session card. Most important glanceable info |
| 3 | **Context window gauge** | Data Viz | Medium | Answers "how much runway left?" — the #1 question during long sessions |
| 4 | **Message bookmarking** | Chat | Medium | Solve the "find that one important message" problem |
| 5 | **CSS custom property theme system** | Theming | Medium | Foundation for all future theme work. Ship dark + light first |
| 6 | **Session cost footer** | Data Viz | Low | Cumulative tokens/cost per session. Users need this for budget awareness |
| 7 | **System theme sync** | Theming | Low | Respect `prefers-color-scheme`. Table stakes for modern apps |
| 8 | **"Healthy = invisible" extension status** | Extensions | Low | Only surface extension problems, never clutter with "all good" noise |

### Tier 2 — High Impact, Higher Effort (Do Next)

| # | Feature | Category | Effort | Why |
|---|---------|----------|--------|-----|
| 9 | **"While you were away" digest** | Notifications | High | The killer feature for multi-agent workflows |
| 10 | **Activity feed on home** | Notifications | Medium | Chronological event stream, grouped by session |
| 11 | **Fuzzy search across sessions** | Command Palette | Medium | Find any session by name, project, or content |
| 12 | **Daily cost summary** | Data Viz | Medium | Today's spend + 7-day sparkline on dashboard home |
| 13 | **Built-in theme pack** | Theming | Medium | Catppuccin, Rosé Pine, + high-contrast. Community appeal |
| 14 | **Per-session accent color** | Theming | Low | Color-code sessions for instant visual identification |
| 15 | **Push notifications (iOS)** | Notifications | Medium | Session complete/error/needs-input alerts |

### Tier 3 — Medium Impact, Worth Doing Later

| # | Feature | Category | Effort | Why |
|---|---------|----------|--------|-----|
| 16 | **Conversation branching** | Chat | High | Version-control for conversations. Complex but valuable |
| 17 | **Token composition breakdown** | Data Viz | Medium | Pie chart: input/output/cached/tool tokens |
| 18 | **Activity heatmap** | Data Viz | Medium | GitHub-style contribution grid for agent activity |
| 19 | **Smart notification grouping** | Notifications | Medium | Bundle rapid-fire events |
| 20 | **Extension health strip** | Extensions | Medium | Per-session colored dots for extension status |
| 21 | **Share session snapshot** | Chat | Medium | Export/share session as markdown or link |
| 22 | **Message search within session** | Chat | Medium | ⌘F search within conversation |
| 23 | **Tool call frequency chart** | Data Viz | High | Which tools are called most, success rates |
| 24 | **Theme import via JSON** | Theming | Medium | Power-user feature for custom themes |

---

## References

### Theming
- [ARC UI Theming Docs](https://arcui.dev/docs/theming) — CSS custom property theme architecture
- [Catppuccin for VS Code](https://github.com/catppuccin/vscode) — 1.18M installs, 4-flavor semantic token system
- [VS Code Theme Modernization (2026)](https://github.com/microsoft/vscode/issues/293405) — Upcoming default theme refresh
- [Arc Browser theme variables](https://ginger.wtf/posts/creating-a-theme-using-arc/) — CSS custom properties exposed to web pages
- [Flutter Adaptive Theme](https://pub.dev/documentation/flutter_adaptive_theme/latest) — Time-based auto theme switching

### Extensions & Status
- [VS Code Status Bar UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/status-bar) — Official status bar design patterns
- [VS Code Agent Status Indicator](https://github.com/microsoft/vscode/issues/290650) — New agent status in command center (Jan 2026)
- [VS Code extension activation feedback](https://github.com/microsoft/vscode/issues/168676) — UX problem: no loading indicator

### Data Visualization & Cost Tracking
- [CodeBurn](https://github.com/AgentSeal/codeburn) — TUI dashboard for AI coding cost observability (769 stars)
- [AgentsView](https://github.com/wesm/agentsview) — Local-first session intelligence with web dashboard
- [Tokenr](https://tokenr.co/) — LLM cost attribution for multi-agent systems
- [Context Lens](https://github.com/larsderidder/context-lens) — Context window composition breakdown proxy
- [LLM Visuals](https://github.com/hoodini/llm-visuals) — Token flow and cost tracking visualization
- [Connic Agent Observability Guide](https://connic.co/blog/ai-agent-observability-guide) — Best practices for agent monitoring
- [AgentsRoom](https://agentsroom.dev/) — Real-time multi-agent monitoring dashboard
- [Gitmap](https://github.com/rudrodip/gitmap) — React GitHub-style contribution heatmap component

### Advanced Chat
- [assistant-ui Message Branching](https://www.assistant-ui.com/docs/guides/branching) — React library with BranchPickerPrimitive
- [LangChain Branching Chat](https://docs.langchain.com/oss/python/langchain/frontend/branching-chat) — Version-control semantics for chat
- [ShapeofAI Branches Pattern](https://www.shapeof.ai/patterns/branches) — UX pattern for parallel exploration
- [Open-WebUI Conversation Anchors PR](https://github.com/open-webui/open-webui/pull/21519) — Pin messages + quick navigation
- [Claude Code Pin/Bookmark Feature Request](https://github.com/anthropics/claude-code/issues/32874) — Community demand signal

### Notifications & Activity Feed
- [Linear Notifications](https://linear.app/docs/notifications) — Grouped notifications, multi-channel config
- [37signals Notification Bundling](https://github.com/marckohlbrugge/unofficial-37signals-coding-style-guide/blob/40e688fc/notifications.md) — Time-window bundling pattern
- [GitHub Activity Digest Tools (2026)](https://gitmore.io/blog/github-activity-digest-notification-tools) — Digest approaches for teams
- [Activity Feed UX Pattern](https://uxpatterns.dev/patterns/social/activity-feed) — Design pattern reference

### Command Palette
- [How to Build a Remarkable Command Palette (Superhuman)](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) — The definitive guide: 5 rules
- [Designing Command Palettes (Sam Solomon)](https://solomon.io/designing-command-palettes/) — UX design principles
- [cmdk](https://shadcn.io/ui/command) — React command palette library powering Linear, Raycast
- [Raycast Search Bar](https://manual.raycast.com/search-bar) — Fuzzy search, root search patterns
- [Superhuman: Speed as the Product](https://blakecrosley.com/en/guides/design/superhuman) — 50ms target, Cmd+K trains users to shortcuts
