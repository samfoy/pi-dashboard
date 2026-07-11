/**
 * PiSdkSession — the SDK-backed (`@earendil-works/pi-coding-agent`) implementation
 * of the transport-agnostic `PiSession` contract. It runs a pi agent IN-PROCESS
 * via `createAgentSession*` (no `pi --mode rpc` child) and translates the SDK's
 * `AgentSessionEvent` stream into the SAME internal emissions `PiRpcSession`
 * produces, so `_wireSlotEvents` (server.ts) is written once and the frontend WS
 * contract is frozen.
 *
 * ── SLICE 7a SCOPE (this file) ──
 * CORE only: construction, per-slot cwd-bound service isolation (design §4),
 * `sessionFile` adoption, `getState()` surfacing `sessionName` (design §2),
 * `prompt()`, `abort()`, and the CORE event translation (`agent_start`,
 * `agent_end` partial→final splice, `message_update` text/thinking,
 * `tool_execution_*`). The flag stays OFF — no production slot constructs this
 * (default transport is `rpc`). Verified by direct-instantiation contract +
 * golden-transcript tests.
 *
 * Deferred (throw a clear "implemented in 7c/7d" so the interface is still
 * satisfied): stats / `getSessionStats` (7c), extension-UI round-trip /
 * model+thinking ops / fork / rebind (7d). Race-fix queueing / `willRetry`
 * gating / `queue_update` / `auto_retry_*` are handled here (slice 7b).
 *
 * ── TEST SEAM ──
 * `_translate(event)` is a pure function of `(event, this.messages)` and never
 * touches the live `_session`. The constructor does NOT create a session
 * (creation is deferred to `start()`), so tests can `new PiSdkSession(key)` and
 * feed synthetic `AgentSessionEvent`-shaped objects straight to `_translate`,
 * asserting emitted internal events + `messages` mutations — WITHOUT a live LLM
 * provider (which is unavailable headless). This is the seam the golden-transcript
 * test drives: it feeds the SAME core-event fixtures to `PiRpcSession._handleEvent`
 * and `PiSdkSession._translate` and asserts byte-identical output.
 */
import { EventEmitter } from 'events'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { extractText, ChatMessage } from './session-store.js'
import type { PiSession, PiTransport, ImagePayload } from './pi-session.js'
import {
  createAgentSessionServices,
  createAgentSessionFromServices,
  SessionManager,
  getAgentDir,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'

// Mirror of the RPC path's temp image dir (pi-manager.ts). Duplicated (not
// shared) so the two transports stay independent; the golden-transcript test
// pins that agent_end's image-persist + toolResult-attach behavior is identical.
const IMAGE_DIR = join(os.tmpdir(), 'pi-dashboard-images')
mkdirSync(IMAGE_DIR, { recursive: true })

export interface PiSdkSessionOptions {
  messages?: ChatMessage[]
  sessionFile?: string | null
  agent?: string | null
  cwd?: string | null
  modelProvider?: string | null
  modelId?: string | null
  thinkingLevel?: string | null
  title?: string | null
  key?: string
  tags?: string[]
  transport?: PiTransport | null
}

/** Normalize image payloads to the SDK's `ImageContent` shape. Mirrors the RPC
 *  path's normalizeImages (pi-manager.ts). */
function normalizeImages(images?: ImagePayload[]): { type: 'image'; mimeType: string; data: string }[] | undefined {
  if (!images?.length) return undefined
  return images
    .map(img => ({
      type: 'image' as const,
      mimeType: img.mimeType || img.media_type || 'image/png',
      data: img.data || img.source?.data || '',
    }))
    .filter(img => img.data)
}

const NOT_YET = (method: string, slice: string) =>
  new Error(`PiSdkSession.${method}() is implemented in slice ${slice} — not in 7a (core event translation) scope`)

export class PiSdkSession extends EventEmitter implements PiSession {
  slotKey: string
  transport: PiTransport = 'sdk'
  sessionFile: string | null
  agent: string | null
  cwd: string | null
  modelProvider: string | null
  modelId: string | null
  thinkingLevel: string | null
  messages: ChatMessage[]
  ready: boolean
  running: boolean
  _stopping: boolean
  _pendingApproval: boolean
  _outstandingPrompts: number
  _streamIdx: number
  _toolsRunning: number
  _title: string | null
  _tags: string[]
  _userRenamed: boolean
  _startTime: number
  _lastActivity: number
  _contextUsage?: any
  _tokenStats?: any
  _wired?: boolean
  _wasRestarted?: boolean

  // ── Race-fix state (slice 7b) ──
  /** True while an auto-retry is in flight (between `auto_retry_start` and its
   *  matching `auto_retry_end`). Load-bearing: the stall detector must NOT read
   *  the retry gap as idle, and queueing must keep treating the slot as busy.
   *  Pairs with `agent_end.willRetry` (design section 2 / section 5). */
  _retrying: boolean
  /** Latest queued-prompt view from the SDK `queue_update` event. Replaces the
   *  RPC `_outstandingPrompts` busy-detection view of the queue (design section
   *  5). Not broadcast to the FE. */
  _queued: { steering: readonly string[]; followUp: readonly string[] }

  // ── SDK-specific internals (NOT part of the PiSession contract) ──
  /** The live in-process agent session. `null` until `start()` resolves and
   *  after `dispose`. Liveness (`alive`) is derived from it. Tests never set it. */
  _session: AgentSession | null
  /** Unsubscribe handle for the event subscription (rebind lands in 7d). */
  _unsubscribe: (() => void) | null
  /** In-flight async init promise (start() is sync per the interface but the
   *  SDK create path is async — start() fires this and returns). */
  _initPromise: Promise<void> | null
  /** Set once dispose/kill has run so `alive` reports dead. */
  _disposed: boolean

  constructor(slotKey: string, opts: PiSdkSessionOptions = {}) {
    super()
    this.slotKey = slotKey
    this.transport = opts.transport || 'sdk'
    this.messages = opts.messages || []
    this.sessionFile = opts.sessionFile || null
    this.agent = opts.agent || null
    this.cwd = opts.cwd || null
    this.modelProvider = opts.modelProvider || null
    this.modelId = opts.modelId || null
    this.thinkingLevel = opts.thinkingLevel || null
    this._title = opts.title || null
    this._tags = opts.tags || []
    this._userRenamed = false
    this._startTime = Date.now()
    this._lastActivity = 0
    this.ready = false
    this.running = false
    this._stopping = false
    this._pendingApproval = false
    this._outstandingPrompts = 0
    this._retrying = false
    this._queued = { steering: [], followUp: [] }
    this._streamIdx = -1
    this._toolsRunning = 0
    this._session = null
    this._unsubscribe = null
    this._initPromise = null
    this._disposed = false
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /** Create the in-process session. The interface is `start(): void`, but the
   *  SDK create path is async — we fire `_init()` and return, storing the
   *  promise so callers that need readiness can await `_initPromise`. Errors
   *  surface as `startup_error` + `error` (mirroring the RPC spawn-failure path). */
  start(): void {
    if (this._session || this._initPromise) return
    this._initPromise = this._init().catch(err => {
      this.ready = false
      this.emit('startup_error', { code: 1, slotKey: this.slotKey, stderr: String(err?.stack || err) })
      this.emit('error', err)
    })
  }

  private async _init(): Promise<void> {
    const cwd = this.cwd || process.env.HOME || '/tmp'
    this.cwd = cwd

    // Per-slot cwd-bound services (design §4): do NOT share ModelRegistry /
    // SettingsManager mutably across slots — each slot gets its own services
    // bound to its cwd so pi's per-slot model/thinking resolver can't cross-talk.
    const services = await createAgentSessionServices({ cwd, agentDir: getAgentDir() })

    // Adoption: resume an existing session file, else start fresh. Per-slot
    // SessionManager (design §4).
    const sessionManager = this.sessionFile
      ? SessionManager.open(this.sessionFile)
      : SessionManager.create(cwd)

    // Resolve the persisted per-slot model against this slot's registry.
    const model =
      this.modelProvider && this.modelId
        ? services.modelRegistry.find(this.modelProvider, this.modelId)
        : undefined

    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(model ? { model } : {}),
      ...(this.thinkingLevel ? { thinkingLevel: this.thinkingLevel as any } : {}),
    })

    this._session = session
    this.ready = true

    // Adopt sessionFile synchronously (design §3: no ready-race).
    this.sessionFile = session.sessionFile ?? null
    if (this.sessionFile) this.emit('session_file', this.sessionFile)

    // Populate the actual resolved model so the settings chip is correct.
    const st: any = session.state
    const m = st?.model
    if (m?.provider && m?.id) {
      const changed = this.modelProvider !== m.provider || this.modelId !== m.id
      this.modelProvider = m.provider
      this.modelId = m.id
      if (changed) this.emit('model_change')
    }

    // Subscribe the core translator. (Automatic rebind on session replacement
    // is a 7d concern — for 7a there is exactly one session per slot.)
    this._unsubscribe = session.subscribe((ev: AgentSessionEvent) => this._translate(ev))
  }

  kill(): void {
    this._disposed = true
    try { this._unsubscribe?.() } catch { /* ignore */ }
    this._unsubscribe = null
    try { this._session?.dispose() } catch { /* ignore */ }
    this._session = null
  }

  /**
   * Reap a dead-but-still-"running" session. The SDK path has no child process,
   * so "dead" means the session was disposed while we still think a turn is
   * live. Mirrors the RPC reaper's emit-agent_end-and-reset behavior. Returns
   * true iff a reset happened. NOT a liveness probe — use `alive` for that.
   */
  checkHealth(): boolean {
    if (this.alive) return false
    if (this.running || this._stopping) {
      this.running = false
      this._stopping = false
      this._retrying = false
      this._pendingApproval = false
      this._outstandingPrompts = 0
      this.emit('agent_end', { messages: [] })
      this.emit('log', { level: 'warn', msg: `Slot ${this.slotKey}: health check found dead session, reset state` })
      return true
    }
    return false
  }

  async gracefulShutdown(_timeoutMs: number = 60000): Promise<void> {
    // In-process: no stdin to close / process to await. Dispose triggers the
    // SDK's own session_shutdown lifecycle synchronously.
    this._stopping = true
    this.kill()
  }

  /**
   * Process/session liveness: a session exists and hasn't been disposed.
   * Distinct from `running` (turn-in-progress). Mirrors PiRpcSession.alive
   * (which checks the child proc) so the shared liveness contract holds for
   * both transports.
   */
  get alive(): boolean {
    return !!this._session && !this._disposed
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Prompting / turn control (CORE)
  // ─────────────────────────────────────────────────────────────────────────

  async prompt(message: string, images?: ImagePayload[]): Promise<boolean | void> {
    if (!this._session) return false
    const imgs = normalizeImages(images)
    // Steer-vs-queue is decided from the AUTHORITATIVE live streaming state
    // (`session.isStreaming`), NOT a hand-mirrored counter that can drift on
    // provider races (bedrock-mantle/openai-responses) or a phantom
    // `agent_start` on resume (design section 5). If a turn is genuinely live
    // the SDK reports `isStreaming === true` and we queue as followUp; after an
    // idle resume it reports false, so we do NOT queue behind a nonexistent
    // turn. During an auto-retry the SDK keeps `isStreaming === true`.
    const streaming = this._session.isStreaming === true
    this._outstandingPrompts++
    this.running = true
    this.messages.push({ role: 'user', content: message, ts: new Date().toISOString() })
    await this._session.prompt(message, {
      ...(imgs ? { images: imgs } : {}),
      ...(streaming ? { streamingBehavior: 'followUp' as const } : {}),
    })
    return true
  }

  abort(): boolean {
    this._stopping = true
    if (!this.alive) {
      this.running = false
      this._stopping = false
      this._retrying = false
      this._pendingApproval = false
      this._outstandingPrompts = 0
      this.emit('agent_end', { messages: [] })
      return false
    }
    // AgentSession.abort() is async; the resulting agent_end flows through
    // _translate and resets state. Fire-and-forget mirrors the RPC send.
    void this._session!.abort()
    return true
  }

  /** Detached/background slots always run on 'rpc' (design policy). Setting the
   *  transport here mirrors PiRpcSession.conductorDetach. */
  conductorDetach(): void {
    this.transport = 'rpc'
  }

  /** Inject a dashboard-originated auto-turn (subagent-result / process-update
   *  hint). Mirrors PiRpcSession.triggerAutoTurn: marks running, records the
   *  user message, dispatches. */
  triggerAutoTurn(message: string): boolean {
    if (!this._session) return false
    // Same authoritative streaming discipline as prompt(): queue as followUp
    // only when the SDK reports a genuinely live turn.
    const streaming = this._session.isStreaming === true
    this.running = true
    this.messages.push({ role: 'user', content: message, ts: new Date().toISOString(), meta: { autoTrigger: true } })
    void this._session.prompt(message, streaming ? { streamingBehavior: 'followUp' } : {})
    return true
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State (CORE — getState surfaces sessionName, design §2)
  // ─────────────────────────────────────────────────────────────────────────

  /** Shaped like the RPC get_state response so server.ts's title-derivation
   *  poll (`resp?.data?.sessionName`) works unchanged against either transport. */
  async getState(_timeoutMs: number = 30000): Promise<any> {
    const s = this._session
    return {
      data: {
        sessionFile: this.sessionFile,
        sessionName: s?.sessionName,
        model: this.modelProvider && this.modelId ? { provider: this.modelProvider, id: this.modelId } : undefined,
        thinkingLevel: this.thinkingLevel ?? undefined,
      },
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Deferred surface (interface satisfied; throws until the owning slice)
  // ─────────────────────────────────────────────────────────────────────────

  async setModel(_provider: string, _modelId: string): Promise<any> { throw NOT_YET('setModel', '7d') }
  async setThinkingLevel(_level: string): Promise<any> { throw NOT_YET('setThinkingLevel', '7d') }
  async getAvailableModels(): Promise<any[]> { throw NOT_YET('getAvailableModels', '7d') }
  async getCommands(): Promise<any[]> { throw NOT_YET('getCommands', '7d') }
  async getSessionStats(_timeoutMs?: number): Promise<any> { throw NOT_YET('getSessionStats', '7c') }
  async fork(_entryId: string): Promise<{ text?: string; cancelled?: boolean; sessionFile?: string | null }> { throw NOT_YET('fork', '7d') }
  async getForkMessages(): Promise<any> { throw NOT_YET('getForkMessages', '7d') }
  armExtensionUi(_id: string, _method: string, _timeoutMs: number): void { throw NOT_YET('armExtensionUi', '7d') }
  respondExtensionUi(_id: string, _response: { cancelled?: boolean; value?: any }): boolean { throw NOT_YET('respondExtensionUi', '7d') }

  // ─────────────────────────────────────────────────────────────────────────
  // CORE event translation — the parity boundary
  //
  // Byte-identical to PiRpcSession._handleEvent's core cases. The RPC path is
  // left untouched; the golden-transcript test enforces that this method's
  // output matches it for the same event fixtures. Any drift goes RED there.
  //
  // Out-of-scope SDK events (session_info_changed, thinking_level_changed,
  // compaction_*) are routed to the default `event` emission for now — none are
  // consumed by server.ts today. The race-fix events (queue_update,
  // auto_retry_*) and `agent_end.willRetry` gating ARE handled here (slice 7b).
  // ─────────────────────────────────────────────────────────────────────────
  _translate(event: any): void {
    const { type } = event

    switch (type) {
      case 'agent_start':
        this.running = true
        this._stopping = false
        this._pendingApproval = false
        this._streamIdx = this.messages.length
        this._lastActivity = Date.now()
        this.emit('agent_start', event)
        break

      case 'agent_end':
        // Terminal handling (partial->final splice + `agent_end` emission, which
        // drives `chat_done` in _wireSlotEvents) is GATED on willRetry === false
        // (design section 2, load-bearing DELTA vs RPC). When willRetry === true
        // an auto-retry is about to fire; emitting the terminal here would
        // produce a premature done + a phantom re-start (exactly the phantom-turn
        // class the race-fixes prevent, section 5). Hold the turn open: keep
        // running, keep the partial-stream marker, and bump activity so the
        // stall detector doesn't read the retry gap as idle.
        if (event.willRetry === true) {
          this._retrying = true
          this._lastActivity = Date.now()
          this.emit('log', { level: 'warn', msg: `Slot ${this.slotKey}: agent_end willRetry=true — auto-retry pending, holding turn open (no chat_done)` })
          break
        }
        this.running = false
        this._stopping = false
        this._retrying = false
        this._pendingApproval = false
        if (this._outstandingPrompts > 0) this._outstandingPrompts--
        this._lastActivity = Date.now()
        // Remove partial streaming messages, replace with final
        if (this._streamIdx >= 0) {
          this.messages.splice(this._streamIdx)
          this._streamIdx = -1
        }
        if (event.messages) {
          for (const m of event.messages) {
            if (m.role === 'assistant') {
              const ts = m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString()
              // Preserve original interleaved order: thinking, tool calls, text
              if (Array.isArray(m.content)) {
                for (const part of m.content) {
                  if (part.type === 'thinking' && part.thinking) {
                    this.messages.push({ role: 'thinking', content: part.thinking, ts })
                  } else if (part.type === 'toolCall') {
                    this.messages.push({
                      role: 'tool',
                      content: `🔧 ${part.name || 'tool'}`,
                      ts,
                      meta: {
                        toolName: part.name,
                        toolCallId: part.id,
                        args: typeof part.arguments === 'string'
                          ? part.arguments
                          : JSON.stringify(part.arguments || {}, null, 2),
                      },
                    })
                  } else if (part.type === 'text' && part.text) {
                    this.messages.push({ role: 'assistant', content: part.text, ts })
                  }
                }
              } else {
                // String content fallback
                const text = extractText(m.content)
                if (text) {
                  this.messages.push({ role: 'assistant', content: text, ts })
                }
              }
            } else if (m.role === 'custom') {
              const ts = m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString()
              const label = m.customType ? `[${m.customType}]` : '[custom]'
              const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
              this.messages.push({ role: 'system', content: `${label} ${text}`, ts, meta: { customType: m.customType, ...(m.details ? { details: m.details } : {}) } })
            } else if (m.role === 'toolResult') {
              // Attach result to the matching tool message
              const toolMsg = [...this.messages].reverse().find(
                (msg: ChatMessage) => msg.role === 'tool' && msg.meta?.toolCallId === m.toolCallId
              )
              if (toolMsg) {
                let resultText = ''
                if (Array.isArray(m.content)) {
                  const textParts = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text)
                  const imageParts = m.content.filter((c: any) => c.type === 'image' && c.source?.type === 'base64')
                  resultText = textParts.join('')
                  if (imageParts.length) {
                    // Save base64 images to temp dir and inject markdown image refs
                    mkdirSync(IMAGE_DIR, { recursive: true })
                    for (const img of imageParts) {
                      const ext = (img.source.mediaType || 'image/png').split('/')[1] || 'png'
                      const name = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
                      const filePath = join(IMAGE_DIR, name)
                      writeFileSync(filePath, Buffer.from(img.source.data, 'base64'))
                      resultText += `\n\n![image](/api/local-file?path=${encodeURIComponent(filePath)})`
                    }
                  }
                }
                toolMsg.meta = {
                  ...toolMsg.meta,
                  result: resultText.slice(0, 5000),
                  isError: m.isError || false,
                }
              }
            }
          }
        }
        this.emit('agent_end', event)
        break

      case 'message_update': {
        this._lastActivity = Date.now()
        const delta = event.assistantMessageEvent
        if (delta) {
          if (delta.type === 'thinking_delta') {
            this.emit('thinking_update', { delta: delta.delta })
          } else {
            this.emit('message_update', { event, delta })
          }
        }
        break
      }

      case 'message_start':
      case 'message_end':
        // Surface custom messages (e.g. meeting-transcript, meeting-prep) into the chat
        if (type === 'message_end' && event.message?.role === 'custom') {
          const m = event.message
          const ts = m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString()
          const label = m.customType ? `[${m.customType}]` : '[custom]'
          const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          this.messages.push({ role: 'system', content: `${label} ${text}`, ts, meta: { customType: m.customType, ...(m.details ? { details: m.details } : {}) } })
        }
        this.emit(type, event)
        break

      case 'tool_execution_start':
        this._toolsRunning++
        this._lastActivity = Date.now()
        this.emit('tool_start', {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        })
        break

      case 'tool_execution_update':
        this.emit('tool_update', event)
        break

      case 'tool_execution_end':
        this._toolsRunning = Math.max(0, this._toolsRunning - 1)
        this._lastActivity = Date.now()
        this.emit('tool_end', event)
        break

      case 'turn_start':
      case 'turn_end':
        this.emit(type, event)
        break

      case 'extension_error':
        this.emit('extension_error', event)
        break

      case 'queue_update':
        // Replaces the RPC `_outstandingPrompts` busy-detection view of the
        // queue (design section 5). Track the authoritative queued-prompt state
        // and bump activity. Not broadcast to the FE (no frame change); emitted
        // internally for any state consumer.
        this._queued = { steering: event.steering || [], followUp: event.followUp || [] }
        this._lastActivity = Date.now()
        this.emit('queue_update', event)
        break

      case 'auto_retry_start':
        // Pairs with `agent_end.willRetry` (design section 2). Mark retry-in-
        // progress and emit a log line — the emission bumps _wireSlotEvents'
        // _lastEventTime so the stall detector does NOT read the retry gap as
        // idle. No FE frame change.
        this._retrying = true
        this._lastActivity = Date.now()
        this.emit('log', { level: 'warn', msg: `Slot ${this.slotKey}: auto-retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms—${event.errorMessage || ''}` })
        break

      case 'auto_retry_end':
        this._retrying = false
        this._lastActivity = Date.now()
        this.emit('log', { level: event.success ? 'info' : 'warn', msg: `Slot ${this.slotKey}: auto-retry ${event.success ? 'succeeded' : 'failed'}${event.finalError ? ': ' + event.finalError : ''}` })
        break

      default:
        // session_info_changed / thinking_level_changed / compaction_* — none
        // consumed by server.ts today; routed here until their owning slices
        // (7c/7d) wire them.
        this.emit('event', event)
    }
  }
}
