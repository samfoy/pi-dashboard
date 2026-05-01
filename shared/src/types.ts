/**
 * Shared types used by both the backend (Node/tsx) and frontend (Vite/React).
 *
 * This is the single source of truth for types that cross the backend ↔
 * frontend boundary (REST responses, WebSocket events, persisted state).
 * Do NOT re-declare these in backend/*.ts or frontend/src/types — import
 * from `@shared/types` on both sides.
 *
 * Keep this file dependency-free (no Node-only or DOM-only imports) so that
 * both build targets can consume it without extra config.
 */

// --- Chat messages -----------------------------------------------------------

/** Role of a chat message as produced by the agent. */
export type ChatRole = 'user' | 'assistant' | 'thinking' | 'tool' | 'system'

/**
 * Structured metadata on a chat message. Known keys are listed for discovery,
 * but the index signature lets either side add fields without blocking the
 * other's build.
 */
export interface ChatMessageMeta {
  toolName?: string
  toolCallId?: string
  args?: string
  result?: string
  isError?: boolean
  customType?: string
  [key: string]: unknown
}

/**
 * A single chat message. This is the wire/persistence shape — the frontend
 * may augment it at render time (e.g. adding CSS classes) via
 * {@link ChatMessageView}.
 */
export interface ChatMessage {
  role: ChatRole
  content: string
  ts?: string
  /** True while the message is still being streamed. */
  _partial?: boolean
  meta?: ChatMessageMeta
}

/**
 * Presentation-augmented ChatMessage used only inside the frontend. Adds the
 * `cls` CSS class and `rawText` reparse source. The role is widened to
 * `string` because the UI adds pseudo-roles like `'streaming'`, `'chunk'`,
 * `'error'`, and `'_tool_update'` that never cross the wire.
 *
 * Backend code should stick to {@link ChatMessage}.
 */
export interface ChatMessageView extends Omit<ChatMessage, 'role'> {
  role: string
  cls: string
  /** Original unprocessed text — source of truth for reparse on stream completion. */
  rawText?: string
}

// --- Notifications ----------------------------------------------------------

/** A notification pushed over the WebSocket to the frontend. */
export interface Notification {
  kind: string
  title: string
  body: string
  ts: string
  acked?: boolean
  slot?: string
  job_id?: string
  task_id?: string
}

// --- Pi memory: lessons, facts ----------------------------------------------

/**
 * A lesson learned by the agent.
 *
 * Backend-loaded lessons include persistence fields (`id`, `created_at`,
 * `negative`). Frontend-rendered lessons may only carry the display fields
 * (`rule`, `category`, `ts`) — both forms are valid.
 */
export interface Lesson {
  id?: string
  rule: string
  category: string
  /** 1 if this is a "do NOT" lesson, 0 otherwise. */
  negative?: number
  created_at?: string
  /** Display timestamp fallback when `created_at` is not used. */
  ts?: string
}

/** A fact stored in the agent's memory. */
export interface Fact {
  key: string
  value: string
  /** Agent's self-reported confidence in this fact (0–1). */
  confidence?: number
  /** Origin of the fact (e.g. 'user-set', 'inferred'). */
  source?: string
  created_at?: string
  updated_at?: string
}

// --- Skills ------------------------------------------------------------------

/**
 * A pi skill exposed by the backend. `key` is optional because some loaders
 * populate it lazily.
 */
export interface Skill {
  key?: string
  name: string
  description: string
  always?: boolean
  source?: string
  package?: string
}

// --- Task runner (autoloops) -------------------------------------------------

export interface TaskStepDetail {
  index: number
  title: string
  description: string
  status: string
  error: string
  result: string
  attempts: number
  depends_on: number[]
  requires_approval: boolean
}

export interface TaskRunRun {
  task_id: string
  name?: string
  running: boolean
  status: string
  steps: number
  completed: number
  failed: number
  skipped: number
  current_step: number
  spec: string
  spec_name: string
  error: string
  tokens_used: number
  replan_count: number
  acceptance_rounds: number
  step_details: TaskStepDetail[]
  started_at: number
  finished_at: number
  work_dir: string
  branch_name: string
  spec_content: string
  lessons_learned: string[]
  commits: number
  original_input: string
  source: string
  groups: number[][]
}

export interface TaskRunnerStatus {
  running: boolean
  available: boolean
  runs: TaskRunRun[]
}

// --- Subagents ---------------------------------------------------------------

export interface SubagentInfo {
  id: string
  task: string
  done: boolean
  error?: string
  result?: string
}
