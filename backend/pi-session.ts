/**
 * PiSession — the transport-agnostic contract that `PiManager`,
 * `server.ts:_wireSlotEvents`, and the chat routes depend on.
 *
 * Today the only implementation is `PiRpcSession` (a `pi --mode rpc` child
 * process, in pi-manager.ts). A future `PiSdkSession` (SDK-backed, behind a
 * flag) will implement the same interface so the dashboard wiring is written
 * once. This file introduces the strangler seam: nothing above the transport
 * layer should reference the concrete class or any RPC internal (`proc`,
 * `send`, `request`, `_pendingExtensionUi`, …) — only this interface.
 *
 * The interface `extends EventEmitter`: `server.ts` subscribes via `pi.on(...)`
 * and even monkey-patches `pi.emit` for the stall detector, so EventEmitter is
 * part of the contract.
 */
import type { EventEmitter } from 'events'
import type { ChatMessage } from './session-store.js'

export type PiTransport = 'rpc' | 'sdk'

/** A user's decision on a gated tool call (slice 11, permission-gating UI).
 *  `approve` lets the call proceed (optionally with mutated args); `deny`
 *  blocks it with a reason. The anti-wedge timeout resolves as a `deny`. */
export type ToolApprovalDecision = 'approve' | 'deny'

/** Image attachment shape accepted by `prompt()`. Shared with PiRpcSession. */
export interface ImagePayload {
  type: string
  mimeType?: string
  media_type?: string
  data?: string
  source?: { data?: string; type?: string; mediaType?: string }
}

export interface PiSession extends EventEmitter {
  // ── identity / state (public fields read across server.ts + chat.ts) ──
  readonly slotKey: string
  readonly transport: PiTransport
  sessionFile: string | null
  modelProvider: string | null
  modelId: string | null
  thinkingLevel: string | null
  cwd: string | null
  messages: ChatMessage[]
  /** True once the process has started and templates are loaded (RPC). */
  ready: boolean
  /** True while a turn is in progress (turn-state, drives the FE spinner /
   *  followUp queueing). NOT process-liveness — use `alive` for that. */
  running: boolean
  /** Process/session liveness: for RPC, the child is spawned and not exited. */
  readonly alive: boolean
  _stopping: boolean
  _pendingApproval: boolean
  /** Per-slot permission-gating flag (slice 11). When true, an SDK slot pauses
   *  each `tool_call` for a browser approve/deny/edit decision before it runs.
   *  Default OFF (opt-in) — when false, tool calls execute unchanged (this is
   *  the default, so the feature ships dark). SDK-only: RPC slots can't gate
   *  in-process, so the flag is a no-op there. */
  toolApproval?: boolean
  _contextUsage?: any            // cached, broadcast on context_usage
  _tokenStats?: any              // cached, broadcast on token_stats
  _wired?: boolean               // guard in chat.ts fork/resume paths
  // slot metadata written/read by server.ts + chat.ts:
  _title: string | null
  _userRenamed: boolean
  _tags: string[]
  _toolsRunning: number
  /** Wall-clock of last turn/tool activity; drives listSlots' updated_at and
   *  the idle reaper in PiManager._healthCheck. 0 = never. */
  _lastActivity: number
  /** Set by PiManager.ensureRunning when a process/session is (re)started for an
   *  existing conversation, so the first prompt injects a resume hint. */
  _wasRestarted?: boolean

  // ── lifecycle ──
  start(): void
  kill(): void
  /** Reap a dead-but-still-"running" session: if the process died while we
   *  thought a turn was live, reset state + emit agent_end. Returns true iff a
   *  reset happened (drives the stall detector). This is NOT a liveness probe —
   *  use `alive` for that. */
  checkHealth(): boolean
  gracefulShutdown(timeoutMs?: number): Promise<void>

  // ── prompting / turn control ──
  prompt(message: string, images?: ImagePayload[]): Promise<boolean | void>
  abort(): boolean
  conductorDetach(): void
  /** Inject a dashboard-originated auto-turn (subagent-result / process-update
   *  hint) — marks running, records the user message, and dispatches it. */
  triggerAutoTurn(message: string): boolean

  // ── model / thinking / state ──
  setModel(provider: string, modelId: string): Promise<any>
  setThinkingLevel(level: string): Promise<any>
  getState(timeoutMs?: number): Promise<any>      // resp.data surfaces sessionName
  getAvailableModels(): Promise<any[]>
  getCommands(): Promise<any[]>

  // ── stats / session ops (RPC: go through request()) ──
  getSessionStats(timeoutMs?: number): Promise<any>
  fork(entryId: string): Promise<{ text?: string; cancelled?: boolean; sessionFile?: string | null }>
  getForkMessages(): Promise<any>

  // ── extension UI round-trip ──
  /** Arm the anti-wedge auto-cancel timer for a pending extension-UI dialog
   *  and record it so a later browser response can resolve it. */
  armExtensionUi(id: string, method: string, timeoutMs: number): void
  /** Resolve a pending extension-UI dialog. Returns false if `id` is unknown
   *  (already answered / timed out). */
  respondExtensionUi(id: string, response: { cancelled?: boolean; value?: any }): boolean

  // ── tool-approval round-trip (slice 11, permission-gating UI) ──
  /** Arm the anti-wedge auto-DENY timer for a pending gated tool call. A
   *  permission gate must FAIL CLOSED: no browser decision within the timeout
   *  blocks the call (reason "approval timed out") rather than auto-approving.
   *  SDK-only; a no-op on RPC (which never emits `tool_approval`). */
  armToolApproval(id: string, timeoutMs: number): void
  /** Resolve a pending gated tool call. `approve` proceeds (mutating the tool
   *  args with `editedArgs` when provided); `deny` blocks with a reason.
   *  Returns false if `id` is unknown (already answered / timed out / no such
   *  slot). SDK-only; a no-op returning false on RPC. */
  respondToolApproval(id: string, decision: ToolApprovalDecision, editedArgs?: Record<string, unknown>): boolean
}

/** The two FE stats-frame payloads derived from a `getSessionStats()` response.
 *  `null` when the underlying response has no usable data. */
export interface StatsFrames {
  contextUsage: { tokens: any; contextWindow: any; percent: any } | null
  tokenStats: {
    totalInputTokens: number
    totalOutputTokens: number
    totalTokens: number
    totalCost: number
    cacheReadTokens: number
    cacheWriteTokens: number
  } | null
}

/**
 * Derive the `context_usage` / `token_stats` WS-frame payloads from a
 * `getSessionStats()` response envelope (`{ data: SessionStats }`). Shared by
 * the RPC 4s poller (server.ts `_fetchStats`) and the SDK event-driven stats
 * path (pi-sdk-session `_emitStats`) so the two transports produce BYTE-IDENTICAL
 * frames — this is the single derivation, not two hand-mirrored copies. The
 * frame the FE ultimately receives is `{ slot, ...contextUsage }` /
 * `{ slot, ...tokenStats }`; this helper produces the spread bodies.
 */
export function deriveStatsFrames(resp: any): StatsFrames {
  const data = resp?.data
  const cu = data?.contextUsage
  return {
    contextUsage: cu
      ? { tokens: cu.tokens, contextWindow: cu.contextWindow, percent: cu.percent }
      : null,
    tokenStats: data
      ? {
          totalInputTokens: data.tokens?.input || 0,
          totalOutputTokens: data.tokens?.output || 0,
          totalTokens: data.tokens?.total || 0,
          totalCost: data.cost || 0,
          cacheReadTokens: data.tokens?.cacheRead || 0,
          cacheWriteTokens: data.tokens?.cacheWrite || 0,
        }
      : null,
  }
}
