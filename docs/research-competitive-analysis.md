# Competitive Analysis: AI Coding Agent Dashboards & Orchestration UIs (2025–2026)

*Last updated: April 2026*

Pi-dashboard is a web-based multi-session chat dashboard with file browser, terminal, and iOS companion app. This analysis identifies features and patterns from competing products that pi-dashboard doesn't have yet.

---

## 1. Cursor 3.x — Agents Window & Design Mode

**What shipped:** Cursor 3.0 (Apr 2, 2026) replaced the Composer pane with a standalone "Agents Window" — a full-screen workspace for running and orchestrating multiple AI agents in parallel. Cursor 3.1 (Apr 13) added tiled multi-agent layouts.

### Key Features
- **Tiled layout** — Split view into panes, each running an independent agent. Drag agents between tiles, expand to focus, keyboard shortcuts for navigation.
- **Cross-environment agents** — Single UI manages agents running locally, in worktrees, in the cloud, or via remote SSH. Seamless handoff between cloud and local.
- **Background agents** — Agents continue running after you close the laptop. Cloud-to-local session handoff when you return.
- **Design Mode** — Click/annotate UI elements in a browser preview to target code changes visually instead of describing them in text.
- **Best-of-N** — Run multiple agents on the same task and pick the best output.

### What pi-dashboard should steal
- **Tiled/split pane view** — Pi-dashboard already has multi-session, but no split-pane for side-by-side comparison. This is the #1 feature every competitor is racing to ship.
- **Agent status indicators at a glance** — Cursor shows which agents are running/idle/waiting across all panes.
- **Background agent persistence** — Sessions survive disconnects, but the dashboard should make "agent is still running" states more visible.

### What they do poorly
- Cursor's Agents Window is desktop-only (Electron). No mobile/web access. Pi-dashboard's web-first approach is a genuine advantage.
- Design Mode is clever but only works for frontend code. Narrow use case.

---

## 2. Windsurf 2.0 — Agent Command Center & Cascade

**What shipped:** Windsurf 2.0 (Apr 2026) introduced the Agent Command Center — a Kanban-style board for managing all agents (local Cascade + cloud Devin) from one view. Cognition AI acquired Codeium/Windsurf for ~$250M.

### Key Features
- **Kanban board by status** — Agents organized into columns: Running, Blocked, Needs Review, Done. At-a-glance view of what each agent is working on.
- **Cascade modes** — Three modes (Code, Chat, Review) each with different tool capabilities. Mode is visible on the agent card.
- **Spaces** — Bundles of agent config, context, and files that can be saved and shared.
- **Native Devin integration** — Cloud Devin sessions appear alongside local Cascade sessions in the same command center.
- **Flow-aware context** — Cascade maintains context across a chain of actions, understanding which files relate to which changes.

### What pi-dashboard should steal
- **Kanban/status-grouped view** — Instead of a flat session list, group sessions by state (active, waiting for input, idle, completed). This is more useful than chronological ordering when running many agents.
- **Agent mode labels** — Show what "mode" or config each session is using (which model, what extensions are loaded).
- **Mixed local/cloud agent management** — Pi already supports multiple backends, but making this explicit in the UI (local vs. remote tags on sessions) would be valuable.

### What they do poorly
- Windsurf is locked to the Codeium/Cognition ecosystem. Pi-dashboard is agent-agnostic.
- Cascade's "flow-aware" context is impressive but opaque — users can't see what context it's using.

---

## 3. AgentsRoom — Multi-Agent Dashboard & Mobile

**What shipped:** AgentsRoom is a macOS desktop + iOS/Android companion app purpose-built for orchestrating Claude Code agents. It's the closest direct competitor to pi-dashboard.

### Key Features
- **Agent cards with live status** — Four states with distinct visual treatment:
  - Yellow pulsing dot + shimmer = thinking/working
  - Green = done
  - Red = waiting for input
  - Gray = idle
  - Each card shows elapsed time and current activity summary
- **Token usage tracking** — Per-agent input/output tokens, cache reads/writes, and cost displayed on each card.
- **Mobile companion** — Full terminal streaming, chat interface, live preview, push notifications. E2E encrypted between desktop and phone.
- **Session history replay** — Scroll back through full terminal history per agent.
- **Project-level overview** — Sidebar groups agents by project/workspace.
- **Push notifications** — Mobile alerts when an agent needs input or finishes.

### What pi-dashboard should steal
- **Token/cost tracking per session** — This is the single biggest visibility gap. Every serious user wants to know what each session costs. Show input tokens, output tokens, cache hits, and estimated cost.
- **Visual status indicators** — Colored dots + animation states (pulsing = thinking) are instantly scannable. Pi-dashboard's session list is mostly text-based.
- **Push notifications (iOS)** — When an agent finishes or needs input, notify the user. Critical for the "walk away and check your phone" workflow.
- **Elapsed time per session** — How long has this agent been running? Simple but missing.

### What they do poorly
- Claude Code only. Pi-dashboard supports any pi session.
- Desktop app required — not browser-accessible. Pi-dashboard's web-first approach is better for remote access.
- No file browser, no diff view, no terminal integration in the dashboard itself. Pi-dashboard already has all of these.

---

## 4. Devin — Session Management & Planning

**What shipped:** Devin (Cognition AI) is the most mature autonomous agent dashboard. Major 2025-2026 updates include batch sessions, scheduled sessions, session categorization, plan mode, and a PR review digest.

### Key Features
- **Batch sessions with visual hierarchy** — Child sessions indented under parent sessions in sidebar. Multi-agent orchestration with visible parent-child relationships.
- **Session categorization & subcategories** — Tag sessions by type (feature, bug, refactor, review) and filter/group by category.
- **Scheduled sessions** — Create recurring or one-time sessions on a cron schedule. Visual editor for frequency.
- **Plan mode** — Agents can enter an explicit planning phase before executing. Plan is visible and reviewable.
- **Streaming terminals** — Real-time terminal output in the session view.
- **PR Digest** — Read-only digest of PRs from all Devin sessions (open, draft, merged). Cross-session PR visibility.
- **Session resume** — `/resume` CLI alias to continue work across sessions.
- **Focus pings** — Keep a session from sleeping while you're actively watching it.
- **Lines left to review counter** — In PR review diff viewer, shows progress.

### What pi-dashboard should steal
- **Session categorization/tagging** — Let users tag sessions (feature, bug, research, etc.) and filter by tag. Simple but powerful for managing many sessions.
- **Parent-child session hierarchy** — When a main agent spawns subagents, show the tree relationship. Pi already has subagents — the UI should show the orchestration graph.
- **Scheduled sessions** — Cron-based session creation. Useful for recurring tasks (daily reports, monitoring).
- **PR digest / cross-session summary** — Aggregate view of what all sessions produced (PRs opened, files changed, commands run).

### What they do poorly
- $500/month pricing. Pi is free.
- Closed ecosystem — can't use your own models or run locally.
- The UI is web-only with no native apps (pi-dashboard has iOS).

---

## 5. Claude Artifacts / Claude Projects

**What shipped:** Anthropic's Claude.ai added Artifacts (live interactive outputs alongside chat), Projects (shared workspaces with knowledge), and MCP integration.

### Key Features
- **Artifacts panel** — Live-rendered React components, HTML, SVGs, documents alongside the conversation. Edit artifacts iteratively through conversation.
- **Side-by-side layout** — Chat on left, artifact on right. Natural split-pane for conversation + output.
- **Project knowledge** — Upload files to a project that persist across conversations as context.
- **MCP integration** — Artifacts can connect to external tools via Model Context Protocol.

### What pi-dashboard should steal
- **Artifact/preview panel** — For sessions that produce visual output (HTML, React components, charts), render it inline. Currently pi-dashboard shows raw code only.
- **Persistent project context** — Associate files/docs with a project that auto-attach to new sessions in that project.

### What they do poorly
- Single-session only. No multi-agent, no parallel sessions.
- No terminal, no file system access, no git integration.
- Artifacts are sandboxed — can't access APIs or databases.

---

## 6. Cline 3.x — Plan/Act Mode & Checkpoints

**What shipped:** Cline (VS Code extension) reached v3.57+ with Plan/Act mode, checkpoints, task timeline, model orchestration, hooks, and voice mode.

### Key Features
- **Plan/Act mode toggle** — Explicit separation of planning (read-only exploration) and execution (file changes). Visual toggle in the UI.
- **Checkpoints** — Every file modification or command creates a snapshot. Restore any checkpoint while keeping conversation context. Changes how you work — approve more freely knowing you can roll back.
- **Task timeline** — Visual timeline of all actions taken, scrollable navigation. Shows the progression of work.
- **Model orchestration** — Use different models for different phases (cheap model for planning, expensive for execution). Per-mode model selection.
- **Hooks** — Inject custom logic into Cline's workflow at defined points.
- **YOLO mode** — Auto-approve all actions, automatic plan/act switching.
- **Boomerang Tasks** (Roo Code fork) — Child tasks return summaries to parent tasks for automated hand-offs.

### What pi-dashboard should steal
- **Checkpoint/snapshot timeline** — Visual timeline showing every significant action with ability to see state at any point. Pi has the message stream but no explicit "checkpoint" markers.
- **Plan/Act mode indicator** — When a session is in planning vs. executing, show it visually. Pi sessions with autoresearch already have this pattern — surface it in UI.
- **Task timeline with scrollable navigation** — A minimap/timeline rail showing the structure of a long session. Click to jump to any point.

### What they do poorly
- VS Code extension only. No standalone dashboard, no mobile.
- Single session at a time.
- No remote/cloud execution.

---

## 7. AG-UI Protocol — Event Streaming Standard

**What it is:** AG-UI is an open, lightweight, event-based protocol (created by CopilotKit, adopted by Microsoft Agent Framework) that standardizes how AI agents communicate with frontend UIs. Uses Server-Sent Events (SSE).

### 17 Event Types

| Category | Events |
|----------|--------|
| **Lifecycle** | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED` |
| **Text Messages** | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END` |
| **Tool Calls** | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_CHUNK`, `TOOL_CALL_RESULT` |
| **State Mgmt** | `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT` |
| **Custom** | `CUSTOM` |

### Key Design Decisions
- **State snapshots + deltas** — Full state can be sent via `STATE_SNAPSHOT`, incremental updates via `STATE_DELTA`. Enables reconnection without replay.
- **Step-level granularity** — `STEP_STARTED`/`STEP_FINISHED` wrapping groups of events gives structure to agent work.
- **Frontend tools** — Agents can call tools that execute in the browser (UI rendering, user input collection).
- **Framework agnostic** — Works with LangChain, CrewAI, AutoGen, Microsoft Agent Framework.

### What pi-dashboard should steal
- **Step-level event grouping** — Pi streams messages, but grouping them into logical "steps" (research phase, coding phase, testing phase) would make long sessions much easier to navigate.
- **State snapshot/delta pattern** — For reconnection resilience. When a client reconnects, send a snapshot instead of replaying everything.
- **Frontend tool rendering** — Agents triggering UI-side rendering (charts, forms, previews) is a powerful pattern for interactive dashboards.

### What they do poorly
- It's a protocol, not a product. No reference dashboard implementation to look at.
- Overly abstract for simple use cases.

---

## 8. OpenHands (formerly OpenDevin) — Autonomous Agent UI

**What shipped:** OpenHands v1.6.0 (Mar 2026) — open-source autonomous coding agent with 70k+ GitHub stars. Full web GUI with embedded VS Code, terminal, and browser.

### Key Features
- **Chat + Changes + VS Code + Terminal + Browser** — Five-panel workspace:
  - Chat panel for conversation
  - Changes tab showing file diffs
  - Embedded VS Code for manual editing
  - Terminal for command execution
  - Browser panel showing agent's web browsing
- **Sandboxed Docker execution** — Agent runs in isolated containers. Safe for autonomous operation.
- **CLI + Web GUI** — Both `openhands web` (terminal in browser) and `openhands serve` (full GUI) modes.
- **Workspace mounting** — Mount local directories into the agent's sandbox.
- **MIT licensed** — Fully open source, self-hosted.

### What pi-dashboard should steal
- **Browser/preview panel** — Show what the agent's browser is seeing. Pi agents with browser-harness or fetch_content could render previews.
- **Changes/diff tab** — Dedicated tab showing all file changes across a session. Pi-dashboard has DiffView but it could be surfaced more prominently as a session-level "what changed" summary.
- **Workspace mounting UX** — Clear UI for which directories the agent can access.

### What they do poorly
- Single agent only. No multi-session management.
- Docker requirement makes setup heavy.
- No mobile app, no iOS companion.

---

## 9. BONUS: Google Antigravity — Manager View

**What shipped:** Google Antigravity (2026) is a VS Code fork with two distinct views: Editor View (traditional) and Manager View (agent orchestration).

### Key Features
- **Manager View / Mission Control** — Dedicated view for managing multiple agents. Not a sidebar — a full separate mode.
- **Cross-surface agents** — Agents coordinate across editor, terminal, and browser simultaneously.
- **Agent-first UX** — The IDE's primary interface is managing agents, not editing files.

### Relevance to pi-dashboard
- Validates the "dashboard as mission control" concept that pi-dashboard already embodies.
- "Manager View" as a distinct mode is exactly what pi-dashboard is — the manager layer on top of pi agents.

---

## Gap Analysis: What Pi-Dashboard Is Missing

| Feature | Who Has It | Pi-Dashboard Status |
|---------|-----------|-------------------|
| Tiled/split-pane multi-session view | Cursor, Antigravity | ❌ Missing — sessions are one-at-a-time |
| Kanban/status-grouped session list | Windsurf | ❌ Missing — flat chronological list |
| Token/cost tracking per session | AgentsRoom, Devin | ❌ Missing |
| Visual status indicators (animated) | AgentsRoom, Cursor | ⚠️ Basic — no pulsing/shimmer states |
| Session categorization/tags | Devin | ❌ Missing |
| Parent-child session tree | Devin, Cline (Boomerang) | ❌ Missing — subagents not visualized |
| Push notifications (iOS) | AgentsRoom | ❌ Missing |
| Session elapsed time | AgentsRoom, Devin | ❌ Missing |
| Checkpoint/timeline navigation | Cline | ❌ Missing |
| Plan/Act mode indicator | Cline, Devin | ❌ Missing |
| Artifact/preview rendering | Claude, OpenHands | ❌ Missing |
| Scheduled/recurring sessions | Devin | ❌ Missing |
| Cross-session PR/output digest | Devin | ❌ Missing |
| Step-level event grouping | AG-UI | ❌ Missing |
| Browser preview panel | OpenHands | ❌ Missing |
| Session-level diff summary | OpenHands | ⚠️ Has DiffView but not session-level |
| Background agent persistence indicator | Cursor | ⚠️ Partial |

---

## 🎯 Prioritized "Steal List"

Ranked by impact × feasibility for a web-based multi-session dashboard with iOS app:

### Tier 1 — High Impact, Should Build Next

1. **Token/cost tracking per session** — Every competitor shows this. Users running multiple agents need cost visibility. Display input/output tokens, cache stats, estimated cost per session and globally.

2. **Visual session status indicators** — Animated colored dots (thinking/done/needs-input/idle) on session cards. Instantly scannable. Minimal effort, huge UX improvement.

3. **Split-pane / tiled multi-session view** — Side-by-side session comparison. This is the marquee feature of Cursor 3 and Antigravity. For a web dashboard, implement as resizable split panes with drag-to-reorder.

4. **Session elapsed time + active duration** — Show how long each session has been running and how long it's been active (not idle). Simple counter on each session card.

5. **iOS push notifications** — Alert when a session finishes, errors, or needs input. AgentsRoom's killer feature for the mobile use case. Critical for "start agent, walk away, check phone" workflow.

### Tier 2 — Medium Impact, Build Soon

6. **Session tags/categories** — Let users tag sessions (feature, bug, research, ops). Filter sidebar by tag. Low effort, high organization value at scale.

7. **Parent-child session tree** — When a session spawns subagents, show the tree. Pi already has the subagent concept — the UI should visualize the orchestration graph.

8. **Kanban/grouped session view** — Toggle between chronological list and status-grouped view (Running | Waiting | Done). Makes many-session management tractable.

9. **Session-level "what changed" summary** — Aggregate all file diffs, commands run, and outputs for a session into a summary tab. Like OpenHands' Changes panel but across the whole session.

10. **Checkpoint/action timeline** — Visual minimap/rail showing the structure of a long session. Each tool call or significant event is a dot on the timeline. Click to jump.

### Tier 3 — Nice to Have, Build Later

11. **Plan/Act mode indicator** — Surface when a session is planning vs. executing. Useful for autoresearch and structured workflows.

12. **Artifact/preview rendering** — Render HTML/React outputs inline. More complex but valuable for frontend development sessions.

13. **Scheduled sessions** — Cron-based recurring sessions. Useful for automation (daily reports, monitoring checks).

14. **Cross-session digest** — Dashboard-level view of all PRs opened, files changed, and tasks completed across all sessions. Executive summary view.

15. **Step-level event grouping (AG-UI style)** — Group messages into logical phases (research → plan → code → test). Makes long sessions navigable.

16. **State snapshot reconnection** — When client reconnects, send a state snapshot instead of replaying the full stream. Better reconnection UX for flaky mobile connections.

---

## Key Takeaways

1. **The industry is converging on "agent mission control"** — Cursor, Windsurf, Antigravity, and AgentsRoom all shipped dedicated agent management views in Q1-Q2 2026. Pi-dashboard was ahead of this curve but needs to keep pace on features.

2. **Token/cost visibility is table stakes** — Every serious competitor shows this. It's the #1 gap.

3. **Mobile companion is a real differentiator** — Only AgentsRoom has a native mobile app for agent management. Pi-dashboard's iOS app is a strong competitive advantage if push notifications are added.

4. **Web-first is an advantage** — Most competitors are desktop-only (Electron IDEs or native apps). Pi-dashboard being browser-accessible is genuinely valuable for remote access and team use.

5. **Pi-dashboard's existing strengths** — File browser, terminal, diff view, multi-session chat, and iOS app are features most competitors lack. The gap is in agent orchestration visibility (status, cost, hierarchy, timeline), not in core functionality.
