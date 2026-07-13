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
 * ── SLICE 7e (this file) ──
 * The model/command surface (`setModel`/`setThinkingLevel`/`getAvailableModels`/
 * `getCommands`) is now implemented against the per-slot in-process session's
 * `modelRegistry`/`extensionRunner`/`promptTemplates`/`resourceLoader`, mirroring
 * the RPC `rpc-mode.js` handlers for byte-identical `.data` shapes and the same
 * argument-less `model_change` internal event. Every method on the core
 * PiSession surface is now fully implemented — none throw an
 * "implemented-later" stub. Extension-UI round-trip
 * (`armExtensionUi`/`respondExtensionUi` + the `bindExtensions` `uiContext`),
 * auto-rebind on session replacement, and `fork`/`getForkMessages` are
 * implemented HERE (slice 7d). Race-fix queueing / `willRetry` gating /
 * `queue_update` / `auto_retry_*` are handled in slice 7b; stats in 7c.
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
import type { PiSession, PiTransport, ImagePayload, ToolApprovalDecision } from './pi-session.js'
import { deriveStatsFrames } from './pi-session.js'
import { randomUUID } from 'crypto'
import {
  createAgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  SessionManager,
  getAgentDir,
  type AgentSession,
  type AgentSessionRuntime,
  type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionUIContext,
  type ToolCallEvent,
  type ToolCallEventResult,
  type ExtensionAPI,
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
  toolApproval?: boolean
}

/** Internal resolution of a gated tool call, passed from `respondToolApproval`
 *  (or the anti-wedge timer) back to the awaiting `tool_call` hook. */
interface ToolApprovalResolution {
  decision: ToolApprovalDecision
  editedArgs?: Record<string, unknown>
  reason?: string
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
  /** The runtime that owns the current session + cwd-bound services. Session-
   *  replacement ops (fork/new/switch/import) live here and REPLACE
   *  `runtime.session`; the rebind hooks (registered once in `_init`) re-wire
   *  our subscription + extension bindings on every replacement (slice 7d). */
  runtime: AgentSessionRuntime | null
  /** Unsubscribe handle for the current session's event subscription. Re-created
   *  by `_rebind` on every session replacement (slice 7d). */
  _unsubscribe: (() => void) | null
  /** Pending extension-UI dialogs keyed by request id. The `uiContext` dialog
   *  methods create an entry with a `resolve` (the awaited Promise's resolver);
   *  `armExtensionUi` attaches the anti-wedge timer; `respondExtensionUi`
   *  resolves + clears it. In-process analogue of the RPC `_pendingExtensionUi`. */
  _pendingExtensionUi: Map<string, { method: string; resolve?: (value: any) => void; timer?: ReturnType<typeof setTimeout> }>
  /** Per-slot permission-gating flag (slice 11). When true, the `tool_call`
   *  hook pauses each tool call for a browser approve/deny/edit decision. Default
   *  OFF — when false the hook returns immediately (no frame, tool runs), so the
   *  feature ships dark. Read LIVE inside the hook so a settings-toggle flip
   *  takes effect on the next tool call without recreating the session. */
  toolApproval: boolean
  /** Pending gated tool calls keyed by request id (slice 11). The `tool_call`
   *  hook creates an entry with a `resolve` (the awaited decision's resolver);
   *  `armToolApproval` attaches the anti-wedge DENY timer; `respondToolApproval`
   *  resolves + clears it. Fail-closed: the timer resolves as a `deny`. */
  _pendingToolApproval: Map<string, { resolve: (d: ToolApprovalResolution) => void; timer?: ReturnType<typeof setTimeout> }>
  /** Cached `ExtensionUIContext` passed to `bindExtensions`. Built once and
   *  re-bound to each replacement session so extensions always reach this slot. */
  _uiContext: ExtensionUIContext | null
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
    this.runtime = null
    this._unsubscribe = null
    this._pendingExtensionUi = new Map()
    this.toolApproval = opts.toolApproval || false
    this._pendingToolApproval = new Map()
    this._uiContext = null
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
    // Re-init after a dispose (respawn path): clear the dead flag so `alive`
    // reports live once _init resolves. Set before firing _init so a concurrent
    // liveness read during startup doesn't see a stale dead state.
    this._disposed = false
    this._initPromise = this._init().catch(err => {
      this.ready = false
      this.emit('startup_error', { code: 1, slotKey: this.slotKey, stderr: String(err?.stack || err) })
      this.emit('error', err)
    })
  }

  private async _init(): Promise<void> {
    const cwd = this.cwd || process.env.HOME || '/tmp'
    this.cwd = cwd

    // Adoption: resume an existing session file, else start fresh. Per-slot
    // SessionManager (design §4).
    const sessionManager = this.sessionFile
      ? SessionManager.open(this.sessionFile)
      : SessionManager.create(cwd)

    // Own ONE AgentSessionRuntime per slot (design §3/§4). The runtime holds the
    // cwd-bound services (per-slot, NOT shared — pi's per-slot model/thinking
    // resolver can't cross-talk) and is the layer that owns session-replacement
    // ops (fork/new/switch/import). The `createRuntime` factory is reused by the
    // runtime for every later replacement, so a fork/new rebuilds services for
    // the (possibly new) cwd and resolves this slot's persisted model.
    this.runtime = await createAgentSessionRuntime(this._makeCreateRuntime(), {
      cwd,
      agentDir: getAgentDir(),
      sessionManager,
    })

    // Register the auto-rebind hooks ONCE. They fire automatically on EVERY
    // session replacement (newSession/switchSession/fork/importFromJsonl),
    // which removes the "forget to rebind → silent dead slot" footgun (design
    // §3). `beforeSessionInvalidate` tears down the OLD subscription before the
    // old session is invalidated; `rebindSession` re-wires against the NEW one.
    this.runtime.setBeforeSessionInvalidate(() => {
      try { this._unsubscribe?.() } catch { /* ignore */ }
      this._unsubscribe = null
    })
    this.runtime.setRebindSession((session) => this._rebind(session))

    // Initial wiring: the rebind hook only fires on REPLACEMENT, not on initial
    // creation, so bind + subscribe the first session by hand through the SAME
    // path a rebind uses.
    await this._rebind(this.runtime.session)
    this.ready = true

    // Populate the actual resolved model so the settings chip is correct.
    const st: any = this.runtime.session.state
    const m = st?.model
    if (m?.provider && m?.id) {
      const changed = this.modelProvider !== m.provider || this.modelId !== m.id
      this.modelProvider = m.provider
      this.modelId = m.id
      if (changed) this.emit('model_change')
    }
  }

  /** Build the runtime factory the `AgentSessionRuntime` reuses for the initial
   *  session AND every later replacement. Composes per-slot cwd-bound services
   *  (design §4) + a session resolved against this slot's persisted model. */
  private _makeCreateRuntime(): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir: getAgentDir(),
        // Inject the permission-gating extension (slice 11). The factory ALWAYS
        // registers a `tool_call` hook, but the hook is a no-op unless this
        // slot's live `toolApproval` flag is ON — so the default (OFF) ships dark
        // with zero behavior change, and a settings-toggle flip takes effect on
        // the next tool call WITHOUT recreating the session.
        resourceLoaderOptions: {
          extensionFactories: [(pi: ExtensionAPI) => {
            pi.on('tool_call', (event: ToolCallEvent) => this._toolCallGate(event))
          }],
        },
      })
      const model =
        this.modelProvider && this.modelId
          ? services.modelRegistry.find(this.modelProvider, this.modelId)
          : undefined
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        ...(sessionStartEvent ? { sessionStartEvent } : {}),
        ...(model ? { model } : {}),
        ...(this.thinkingLevel ? { thinkingLevel: this.thinkingLevel as any } : {}),
      })
      return { ...result, services, diagnostics: services.diagnostics }
    }
  }

  /**
   * Re-wire this slot against `session` — the NEW session after a replacement,
   * or the initial session at startup. Registered via `runtime.setRebindSession`
   * so it fires automatically on fork/new/switch/import (design §3). Rebinds the
   * extension `uiContext` and re-subscribes the core translator, then adopts the
   * new `sessionFile` and emits `session_file`. Centralizing this here is what
   * makes "forget to rebind → silent dead slot" structurally impossible.
   */
  private async _rebind(session: AgentSession): Promise<void> {
    this._session = session
    await session.bindExtensions(this._extensionBindings())
    // BLAST-RADIUS GUARD (slice 8, design blast-radius §3): the subscribe
    // listener body is fired SYNCHRONOUSLY from pi's internal event loop. A
    // throw inside `_translate` here would propagate straight back into that
    // loop and — in-process — could take down EVERY slot + the HTTP/WS server.
    // `_safeTranslate` contains a per-event failure to THIS slot (log + swallow)
    // so one malformed event can't cascade. This is NOT covered by the
    // `prompt()` try/catch (that only guards the awaited dispatch, not the
    // subscription callback the SDK invokes out-of-band).
    this._unsubscribe = session.subscribe((ev: AgentSessionEvent) => this._safeTranslate(ev))
    // Adopt sessionFile synchronously (design §3: no ready-race).
    this.sessionFile = session.sessionFile ?? null
    if (this.sessionFile) this.emit('session_file', this.sessionFile)
  }

  /**
   * Contain a throw from the `subscribe` listener body to THIS slot (slice 8).
   * `_translate` runs inside pi's synchronous event loop; letting an exception
   * escape would poison that loop for every slot sharing the in-process heap.
   * Catch, log against this slot, and swallow — a single bad event must not
   * kill the slot (the whole session survives) nor its siblings.
   */
  private _safeTranslate(event: any): void {
    try {
      this._translate(event)
    } catch (err: any) {
      this.emit('log', { level: 'error', msg: `Slot ${this.slotKey}: event handler threw on ${event?.type} (contained, slot survives): ${err?.stack || err}` })
    }
  }

  /**
   * Fatal-fault handler (slice 8, design blast-radius §3): a recoverable async
   * fault attributable to THIS slot (a `prompt()` throw, or a backstop-routed
   * rejection). Reset turn state, `kill()` to dispose the session + listeners +
   * timers (no leak into the shared heap), then emit `exit` so `_wireSlotEvents`
   * broadcasts EXACTLY the frames an RPC child exit does (chat_error mid-turn,
   * else chat_done). Marking the slot dead (kill → `alive === false`) makes
   * `PiManager.ensureRunning` respawn it on the next prompt — mirroring the RPC
   * respawn-on-next-prompt path. Honest limit: a SYNCHRONOUS V8 abort / WASM-OOM
   * is uncatchable and never reaches here — it kills the whole process (all
   * slots), which is why isolation-sensitive slots stay on `rpc`.
   */
  _handleFatal(err: any): void {
    if (this._disposed) return // already reaped; avoid double chat_error/chat_done
    this.emit('log', { level: 'error', msg: `Slot ${this.slotKey}: fatal fault — disposing session, marking slot dead for respawn: ${err?.stack || err}` })
    this.running = false
    this._stopping = false
    this._retrying = false
    this._pendingApproval = false
    this._outstandingPrompts = 0
    this._streamIdx = -1
    this.kill()
    // Mirror an RPC child `exit`: _wireSlotEvents broadcasts chat_error if the
    // turn was live (midTurn), else chat_done. Same frames, same handler.
    this.emit('exit', 1)
  }

  kill(): void {
    this._disposed = true
    // Allow start() to re-init after a dispose so ensureRunning can respawn a
    // dead slot on the next prompt (mirrors RPC proc=null reset). Without this,
    // start()'s `if (this._session || this._initPromise) return` guard would see
    // the resolved _initPromise and no-op, leaving the slot permanently dead.
    this._initPromise = null
    try { this._unsubscribe?.() } catch { /* ignore */ }
    this._unsubscribe = null
    // Reject any in-flight extension-UI dialogs so nothing stays wedged.
    for (const [, pending] of this._pendingExtensionUi) {
      if (pending.timer) clearTimeout(pending.timer)
    }
    this._pendingExtensionUi.clear()
    // Resolve any in-flight tool-approval requests as DENY (fail-closed) so a
    // gated tool call awaiting a decision can't wedge a disposed session.
    for (const [, pending] of this._pendingToolApproval) {
      if (pending.timer) clearTimeout(pending.timer)
      try { pending.resolve({ decision: 'deny', reason: 'session disposed' }) } catch { /* ignore */ }
    }
    this._pendingToolApproval.clear()
    try { this._session?.dispose() } catch { /* ignore */ }
    this._session = null
    try { void this.runtime?.dispose() } catch { /* ignore */ }
    this.runtime = null
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

  /**
   * Await session initialization before dispatching. `start()` is sync per the
   * `PiSession` interface but the SDK create path is async — it fires `_init()`
   * and returns, storing `_initPromise`. A prompt arriving immediately after
   * slot creation (the REST `/api/chat` path: `ensureRunning()` → `start()` →
   * `prompt()`, all without awaiting init) would otherwise hit `!this._session`
   * and be SILENTLY DROPPED — the "new session never starts up" bug: no turn,
   * no message, no error, `running` stuck false.
   *
   * This awaits the in-flight init, starting it if the slot was never started
   * (or was reaped — `kill()` clears `_initPromise` + sets `_disposed`, so
   * `start()` re-inits). It no-ops start() when an init is already in flight, so
   * a concurrent second prompt just awaits the same promise. Returns true once a
   * live session exists; false only if init GENUINELY failed (not just slow) —
   * in which case `start()`'s catch has already emitted the visible
   * `startup_error`, and the caller surfaces a fatal (never a silent drop).
   */
  private async _ensureInit(): Promise<boolean> {
    if (this._session) return true
    if (!this._initPromise) this.start()
    // start() wraps _init in a .catch that emits startup_error+error and
    // swallows, so this await resolves even on failure (session stays null).
    // Guard anyway against a future non-caught rejection.
    try { await this._initPromise } catch { /* startup_error already emitted */ }
    return !!this._session
  }

  async prompt(message: string, images?: ImagePayload[]): Promise<boolean | void> {
    // AWAIT INIT before dispatch (fixes the dropped-first-prompt bug). If init
    // genuinely failed, surface it as a fatal (chat_error / stopped spinner +
    // respawn on next prompt) instead of a silent `return false`.
    if (!(await this._ensureInit())) {
      this._handleFatal(new Error(`Slot ${this.slotKey}: session failed to initialize`))
      return false
    }
    // SLASH-COMMAND DISPATCH (parity with PiRpcSession.prompt, pi-manager.ts).
    // The dashboard synthesizes control/data slash commands (/session, /compact,
    // /new, …) that pi's RPC child intercepts BEFORE the model. `session.prompt()`
    // only auto-handles *extension* commands, /skill: commands, and prompt
    // templates (verified against agent-session.js `prompt()` — `expandPromptTemplates`
    // default true covers `_tryExecuteExtensionCommand` + `_expandSkillCommand` +
    // `expandPromptTemplate`). The dashboard-owned builtins are NOT extension
    // commands, so without this block they'd reach the model as raw text (the
    // `/session` regression). Extension/skill/prompt-template commands fall
    // through to `session.prompt()` below, which expands them correctly.
    if (message.startsWith('/')) {
      const handled = await this._handleSlashCommand(message)
      if (handled) return
      // not a dashboard builtin — fall through so session.prompt() can expand an
      // extension command / /skill: / prompt template (or send raw, matching RPC).
    }
    const imgs = normalizeImages(images)
    // Steer-vs-queue is decided from the AUTHORITATIVE live streaming state
    // (`session.isStreaming`), NOT a hand-mirrored counter that can drift on
    // provider races (bedrock-mantle/openai-responses) or a phantom
    // `agent_start` on resume (design section 5). If a turn is genuinely live
    // the SDK reports `isStreaming === true` and we queue as followUp; after an
    // idle resume it reports false, so we do NOT queue behind a nonexistent
    // turn. During an auto-retry the SDK keeps `isStreaming === true`.
    const streaming = this._session!.isStreaming === true
    this._outstandingPrompts++
    this.running = true
    this.messages.push({ role: 'user', content: message, ts: new Date().toISOString() })
    // BLAST-RADIUS GUARD (slice 8, design blast-radius §3): a throw from the
    // awaited dispatch (provider fault, session internal error) is contained to
    // THIS slot — dispose + emit `exit` (chat_error/chat_done via _wireSlotEvents,
    // exactly like an RPC child exit) + mark dead so ensureRunning respawns on
    // the next prompt. Does NOT catch subscribe-listener throws (see
    // `_safeTranslate`) or the sync V8 abort class (uncatchable — the process
    // backstop is the only — partial — net for those).
    try {
      await this._session!.prompt(message, {
        ...(imgs ? { images: imgs } : {}),
        ...(streaming ? { streamingBehavior: 'followUp' as const } : {}),
      })
      return true
    } catch (err) {
      this._handleFatal(err)
      return false
    }
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
    if (this._disposed) return false
    // Same authoritative streaming discipline as prompt(), but init may not be
    // ready yet (an auto-turn can arrive before the first user prompt). Accept
    // synchronously (mark running, record the message), then AWAIT init in a
    // fire-and-forget block so the auto-turn isn't dropped on a fresh slot.
    this.running = true
    this.messages.push({ role: 'user', content: message, ts: new Date().toISOString(), meta: { autoTrigger: true } })
    void (async () => {
      if (!(await this._ensureInit())) {
        this._handleFatal(new Error(`Slot ${this.slotKey}: session failed to initialize (auto-turn)`))
        return
      }
      const streaming = this._session!.isStreaming === true
      // Route a rejection through the same per-slot fatal boundary as prompt()
      // so a failed auto-turn contains to this slot (chat_error + respawn)
      // instead of leaking to the process-level backstop.
      try {
        await this._session!.prompt(message, streaming ? { streamingBehavior: 'followUp' } : {})
      } catch (err: any) {
        this._handleFatal(err)
      }
    })()
    return true
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State (CORE — getState surfaces sessionName, design §2)
  // ─────────────────────────────────────────────────────────────────────────

  /** Shaped like the RPC get_state response so server.ts's title-derivation
   *  poll (`resp?.data?.sessionName`) works unchanged against either transport. */
  /** Emit a slash-command result as an assistant message, byte-for-byte matching
   *  the RPC DATA_CMDS path (pi-manager.ts): push the fenced content to messages
   *  and emit `slash_result` (server.ts broadcasts it as a `chat_message`). */
  private _emitSlashResult(text: string): void {
    const content = '```\n' + text + '\n```'
    this.messages.push({ role: 'assistant', content, ts: new Date().toISOString() })
    this.emit('slash_result', { content })
  }

  /** Dispatch a dashboard-owned control/data slash command using the in-process
   *  session's real APIs. Returns true when handled (do NOT send to the model);
   *  false to fall through to `session.prompt()` (extension/skill/template).
   *  Mirrors PiRpcSession.prompt's RPC_MAP + DATA_CMDS + /reload set exactly. */
  private async _handleSlashCommand(message: string): Promise<boolean> {
    const spaceIdx = message.indexOf(' ')
    const cmd = (spaceIdx === -1 ? message.slice(1) : message.slice(1, spaceIdx)).trim()
    const args = spaceIdx === -1 ? '' : message.slice(spaceIdx + 1).trim()
    const s = this._session
    if (!s) return false

    switch (cmd) {
      // ── DATA: return info, never hit the model (RPC DATA_CMDS) ────────────
      case 'session':
      case 'usage': {
        const resp = await this.getSessionStats()
        const data = resp?.data
        if (data != null) {
          this._emitSlashResult(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
        }
        return true
      }
      case 'tools': {
        const commands = await this.getCommands()
        this._emitSlashResult(JSON.stringify(commands, null, 2))
        return true
      }
      case 'copy': {
        const text = s.getLastAssistantText?.() ?? ''
        this._emitSlashResult(text || '(no assistant message to copy)')
        return true
      }

      // ── CONTROL: perform a session op, never hit the model (RPC RPC_MAP) ──
      case 'compact': {
        // session.compact drives compaction_start/end events which _translate
        // maps to the same context frames; no model prompt.
        await s.compact(args || undefined)
        return true
      }
      case 'new':
      case 'clear': {
        if (this.runtime) await this.runtime.newSession()
        return true
      }
      case 'name': {
        s.setSessionName(args || 'New Chat')
        return true
      }
      case 'export': {
        // In-process export works (no RPC round-trip). Surface the path so the
        // user gets feedback instead of the command reaching the model.
        try {
          const path = await s.exportToHtml(args || undefined)
          this._emitSlashResult(`Exported session to: ${path}`)
        } catch (err) {
          this._emitSlashResult(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        return true
      }

      // ── GRACEFUL NON-PARITY: handled without hitting the model ────────────
      case 'fork': {
        // The dashboard's real fork flow is the message-picker UI (getForkMessages
        // + the fork endpoint), which needs an entryId. A bare `/fork` has none,
        // so guide the user rather than send `/fork` to the model.
        this._emitSlashResult('To fork, use the fork button and pick the message to branch from.')
        return true
      }
      case 'reload': {
        // No child process to restart in-process. Live ResourceLoader rebuild is
        // deferred (slice 16 — live reload). Report clearly; never hit the model.
        this._emitSlashResult('Reload is not yet wired for in-process (SDK) slots. Start a new session to pick up changed extensions/skills/prompts.')
        return true
      }

      default:
        // Not a dashboard builtin — let session.prompt() expand an extension
        // command / /skill: / prompt template (or reach the model, matching RPC).
        return false
    }
  }

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
  // Model / command surface (slice 7e — SDK parity with the RPC path)
  //
  // Each of these mirrors the SAME operation the RPC server performs in
  // `rpc-mode.js` (get_available_models / set_model / set_thinking_level /
  // get_commands), reading from the per-slot in-process session's
  // `modelRegistry`, `extensionRunner`, `promptTemplates`, and `resourceLoader`.
  // The returned shapes are byte-identical to the RPC `.data.{models,commands}`
  // payloads so `chat.ts` / `server.ts` need no SDK-specific branching.
  // ─────────────────────────────────────────────────────────────────────────

  /** Change the in-process session's model, mirroring RPC's `set_model` handler:
   *  resolve the model out of the per-slot ModelRegistry's *available* set (auth
   *  configured), apply it to the live session, update our persisted
   *  `modelProvider`/`modelId`, and emit the SAME argument-less `model_change`
   *  internal event the RPC path emits (server.ts persists + broadcastSlots on
   *  it → identical WS frame). Returns the resolved model (RPC returns it too). */
  async setModel(provider: string, modelId: string): Promise<any> {
    const s = this._session
    if (!s) throw new Error('PiSdkSession.setModel(): no live session')
    const models = await s.modelRegistry.getAvailable()
    const model = models.find((m: any) => m.provider === provider && m.id === modelId)
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`)
    await s.setModel(model)
    const changed = this.modelProvider !== provider || this.modelId !== modelId
    this.modelProvider = provider
    this.modelId = modelId
    if (changed) this.emit('model_change')
    return model
  }

  /** Set the live session's thinking level (mirrors RPC's `set_thinking_level`,
   *  which is synchronous on the session), update our persisted `thinkingLevel`,
   *  and emit `model_change` so the FE chip stays in sync (server.ts broadcasts
   *  slots on it). The RPC path drives the same broadcast via chat.ts's
   *  `/thinking` route; emitting here keeps the internal contract self-consistent. */
  async setThinkingLevel(level: string): Promise<any> {
    const s = this._session
    if (!s) throw new Error('PiSdkSession.setThinkingLevel(): no live session')
    s.setThinkingLevel(level as any)
    const changed = this.thinkingLevel !== level
    this.thinkingLevel = level
    if (changed) this.emit('model_change')
  }

  /** Enumerate models with auth configured, from the per-slot ModelRegistry —
   *  the SAME `session.modelRegistry.getAvailable()` set the RPC
   *  `get_available_models` handler returns (identical `Model` objects). */
  async getAvailableModels(): Promise<any[]> {
    const s = this._session
    if (!s) return []
    return await s.modelRegistry.getAvailable()
  }

  /** List slash-invocable commands (extension commands + prompt templates +
   *  skills), byte-for-byte mirroring the RPC `get_commands` handler's shape:
   *  `{ name, description, source, sourceInfo }` per entry, with `skill:` prefix
   *  on skills. Reads the live session's runner/templates/resourceLoader. */
  async getCommands(): Promise<any[]> {
    const s = this._session
    if (!s) return []
    const commands: any[] = []
    for (const command of s.extensionRunner.getRegisteredCommands()) {
      commands.push({
        name: command.invocationName,
        description: command.description,
        source: 'extension',
        sourceInfo: command.sourceInfo,
      })
    }
    for (const template of s.promptTemplates) {
      commands.push({
        name: template.name,
        description: template.description,
        source: 'prompt',
        sourceInfo: template.sourceInfo,
      })
    }
    for (const skill of s.resourceLoader.getSkills().skills) {
      commands.push({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: 'skill',
        sourceInfo: skill.sourceInfo,
      })
    }
    return commands
  }
  async getSessionStats(_timeoutMs?: number): Promise<any> {
    // In-process: usage is readable on demand from the live session (no RPC
    // round-trip, no 4s poll). Wrap in the SAME `{ data: SessionStats }`
    // envelope the RPC `get_session_stats` response uses, so any direct caller
    // (and `deriveStatsFrames`) treats both transports identically.
    const stats = this._session?.getSessionStats?.()
    return { ok: true, type: 'get_session_stats', data: stats ?? null }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fork (slice 7d) — per the slice-6 spike (docs/spikes/fork-semantics.md)
  //
  // `runtime.fork()` creates a NEW .jsonl and replaces `runtime.session`
  // IN-PLACE (the old session is torn down). The rebind hook has already
  // repointed `this._session` / `this.sessionFile` at the new file and emitted
  // `session_file` by the time `fork()` returns. We surface the NEW sessionFile
  // so `chat.ts` can `createSlot` a fresh "Fork: …" slot adopting it.
  //
  // Parity requirement (spike DECISION): `chat.ts` MUST keep `pi.kill()`-ing the
  // old slot. Because `runtime.fork()` hijacks the old runtime's `session` to
  // point at the fork file, killing the old slot leaves exactly ONE live writer
  // on the new file — no two-slots-one-JSONL corruption. Field is `selectedText`
  // (NOT `editorText`).
  // ─────────────────────────────────────────────────────────────────────────
  async fork(entryId: string): Promise<{ text?: string; cancelled?: boolean; sessionFile?: string | null }> {
    if (!this.runtime) return { cancelled: true, sessionFile: this.sessionFile }
    const r = await this.runtime.fork(entryId)
    const sessionFile = this.runtime.session?.sessionFile ?? this.sessionFile ?? null
    this.sessionFile = sessionFile
    return { text: r?.selectedText, cancelled: r?.cancelled, sessionFile }
  }

  /** Fork-able user messages for the fork selector. In-process analogue of the
   *  RPC `get_fork_messages` request; returns the SAME `{ data: { messages } }`
   *  envelope shape (`chat.ts` forwards it verbatim to the FE). */
  async getForkMessages(): Promise<any> {
    const messages = this._session?.getUserMessagesForForking?.() ?? []
    return { ok: true, type: 'get_fork_messages', data: { messages } }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Extension-UI round-trip (slice 7d) — in-process analogue of slice-2's RPC
  // path. The dialog methods on the `uiContext` (built in `_makeUiContext`)
  // create a pending entry with a Promise resolver + emit the SAME internal
  // `extension_ui` event that drives slice-2's `extension_ui_request` WS frame,
  // so the SAME modal/endpoint serve both transports. `armExtensionUi` attaches
  // the anti-wedge timer; `respondExtensionUi` resolves the awaited Promise with
  // the per-method return type (design §6b).
  // ─────────────────────────────────────────────────────────────────────────

  /** Attach the anti-wedge auto-cancel timer to a pending extension-UI dialog.
   *  For SDK slots the pending entry (with its Promise `resolve`) already exists
   *  — it was created synchronously by the `uiContext` dialog method BEFORE it
   *  emitted the `extension_ui` event that server.ts handles by calling this. We
   *  merge the timer into that entry (rather than overwrite the resolver). The
   *  fallback branch keeps the method safe if ever armed for an unknown id. */
  armExtensionUi(id: string, method: string, timeoutMs: number): void {
    const timer = setTimeout(() => { this.respondExtensionUi(id, { cancelled: true }) }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    const existing = this._pendingExtensionUi.get(id)
    if (existing) existing.timer = timer
    else this._pendingExtensionUi.set(id, { method, timer })
  }

  /** Resolve a pending extension-UI dialog, mapping the browser response to the
   *  `ExtensionUIContext` method's declared return type:
   *    confirm            → boolean         (value truthy → true; cancel → false)
   *    select/input/editor → string|undefined (cancel → undefined)
   *  Returns false if `id` is unknown (already answered or timed out). */
  respondExtensionUi(id: string, response: { cancelled?: boolean; value?: any }): boolean {
    const pending = this._pendingExtensionUi.get(id)
    if (!pending) return false
    if (pending.timer) clearTimeout(pending.timer)
    this._pendingExtensionUi.delete(id)
    const resolve = pending.resolve
    if (resolve) {
      if (response.cancelled) {
        resolve(pending.method === 'confirm' ? false : undefined)
      } else if (pending.method === 'confirm') {
        resolve(!!response.value)
      } else {
        resolve(response.value != null ? String(response.value) : undefined)
      }
    }
    return true
  }

  // ── extension bindings + uiContext (slice 7d) ──
  // ─────────────────────────────────────────────────────────────────────────
  // Tool-approval / permission gating (slice 11) — SDK-only. The `tool_call`
  // hook (registered in `_makeCreateRuntime` via extensionFactories) can
  // `{ block, reason }` AND mutate `event.input` in place before the tool runs
  // (SDK contract). Modeled on the extension-UI round-trip above: the hook
  // creates a pending entry with a Promise resolver + emits an additive internal
  // `tool_approval` event; server.ts arms the fail-closed DENY timer + broadcasts
  // the `tool_approval_request` WS frame; the endpoint resolves via
  // `respondToolApproval`. RPC can't gate in-process, so this path is SDK-only.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * The `tool_call` hook body. Registered on EVERY SDK session but a no-op
   * unless this slot's live `toolApproval` flag is ON — that is what makes the
   * feature default OFF / ship dark (returning undefined lets the tool run
   * unchanged, and no `tool_approval` frame is emitted). When ON, PAUSE the call:
   * create a pending entry (with the awaited resolver) BEFORE emitting so the
   * synchronous server.ts handler that arms the timer finds it, emit the internal
   * `tool_approval` event, and await the browser decision. `approve` proceeds —
   * mutating `event.input` IN PLACE with `editedArgs` when provided (the SDK
   * requires in-place mutation; a returned object is ignored for arg patching).
   * `deny` (and the anti-wedge timeout, which resolves as a deny) blocks with a
   * reason.
   */
  private async _toolCallGate(event: ToolCallEvent): Promise<ToolCallEventResult | void> {
    // Default OFF: pass through untouched, emit nothing. Zero behavior change.
    if (!this.toolApproval) return
    const id = randomUUID()
    const resolution = await new Promise<ToolApprovalResolution>((resolve) => {
      this._pendingToolApproval.set(id, { resolve })
      // args carries the tool arguments (a shallow copy so the frame can't be
      // mutated by a later in-place patch of event.input).
      this.emit('tool_approval', { id, toolName: event.toolName, args: { ...event.input } })
    })
    if (resolution.decision === 'approve') {
      // Edit-and-approve: mutate event.input IN PLACE (delete removed keys, then
      // assign the edited set) so the tool sees the patched args. No re-validation
      // is performed by pi after mutation (SDK contract), so the modal is the gate.
      if (resolution.editedArgs && typeof resolution.editedArgs === 'object') {
        for (const k of Object.keys(event.input)) delete (event.input as Record<string, unknown>)[k]
        Object.assign(event.input, resolution.editedArgs)
      }
      return
    }
    // deny / timeout → block, fail-closed.
    return { block: true, reason: resolution.reason || 'denied by user' }
  }

  /** Attach the anti-wedge auto-DENY timer to a pending gated tool call. A
   *  permission gate must FAIL CLOSED: an unanswered request (closed tab, no
   *  browser attached) BLOCKS the tool with reason "approval timed out" rather
   *  than auto-approving. The pending entry (with its Promise `resolve`) already
   *  exists — the `tool_call` hook created it synchronously BEFORE emitting the
   *  `tool_approval` event server.ts handles by calling this — so we merge the
   *  timer into it. */
  armToolApproval(id: string, timeoutMs: number): void {
    const timer = setTimeout(() => {
      this.respondToolApproval(id, 'deny', undefined, 'approval timed out')
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    const existing = this._pendingToolApproval.get(id)
    if (existing) existing.timer = timer
  }

  /** Resolve a pending gated tool call. `approve` proceeds (with `editedArgs`
   *  applied in place by the awaiting hook); `deny` blocks with `reason`.
   *  Returns false if `id` is unknown (already answered / timed out). */
  respondToolApproval(id: string, decision: ToolApprovalDecision, editedArgs?: Record<string, unknown>, reason?: string): boolean {
    const pending = this._pendingToolApproval.get(id)
    if (!pending) return false
    if (pending.timer) clearTimeout(pending.timer)
    this._pendingToolApproval.delete(id)
    pending.resolve({ decision, editedArgs, reason })
    return true
  }

  // ── extension bindings + uiContext (slice 7d) ──

  /** The `ExtensionBindings` re-applied to every replacement session. Only the
   *  `uiContext` is host-provided; everything else uses the SDK defaults. */
  private _extensionBindings(): { uiContext: ExtensionUIContext } {
    if (!this._uiContext) this._uiContext = this._makeUiContext()
    return { uiContext: this._uiContext }
  }

  /**
   * Build the in-process `ExtensionUIContext`. The four dialog methods return a
   * Promise that (a) emits the SAME internal `extension_ui` event slice-2's RPC
   * path emits — so server.ts arms the timer + broadcasts the identical
   * `extension_ui_request` frame and the SAME modal shows — and (b) resolves
   * when `respondExtensionUi(id, …)` is called (or the 60s timer cancels). The
   * non-dialog methods emit the SAME `extension_ui` shapes server.ts already
   * handles (setStatus → statusKey/statusText; setWidget → widgetKey/
   * widgetLines/widgetPlacement), matching the RPC-mode uiContext exactly.
   * `custom` is a passthrough (resolves undefined, as RPC mode does). The
   * TUI-only members are no-op stubs — a headless dashboard runtime never calls
   * them. Cast through `unknown` because those stubs don't carry Theme types.
   */
  private _makeUiContext(): ExtensionUIContext {
    const emit = (event: any) => this.emit('extension_ui', event)
    // Create the pending entry (with its Promise resolver) BEFORE emitting, so
    // the synchronous server.ts handler (which calls armExtensionUi) finds it.
    const dialog = (method: string, extra: Record<string, any>): Promise<any> =>
      new Promise((resolve) => {
        const id = randomUUID()
        this._pendingExtensionUi.set(id, { method, resolve })
        emit({ type: 'extension_ui', method, id, ...extra })
      })
    const ctx = {
      select: (title: string, options: string[], _opts?: any) => dialog('select', { title, options }),
      confirm: (title: string, message: string, _opts?: any) => dialog('confirm', { title, message }),
      input: (title: string, placeholder?: string, _opts?: any) => dialog('input', { title, placeholder }),
      editor: (title: string, prefill?: string) => dialog('editor', { title, prefill }),
      notify: (message: string, type?: 'info' | 'warning' | 'error') =>
        emit({ type: 'extension_ui', method: 'notify', id: randomUUID(), message, notifyType: type }),
      setStatus: (key: string, text: string | undefined) =>
        emit({ type: 'extension_ui', method: 'setStatus', id: randomUUID(), statusKey: key, statusText: text }),
      setWidget: (key: string, content: any, options?: any) => {
        // Only string arrays cross the wire (matches RPC mode; factories ignored).
        if (content === undefined || Array.isArray(content)) {
          emit({ type: 'extension_ui', method: 'setWidget', id: randomUUID(), widgetKey: key, widgetLines: content, widgetPlacement: options?.placement })
        }
      },
      setTitle: (title: string) =>
        emit({ type: 'extension_ui', method: 'setTitle', id: randomUUID(), title }),
      async custom() { return undefined },
      onTerminalInput: () => () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setFooter: () => {},
      setHeader: () => {},
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => '',
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false as const }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    }
    return ctx as unknown as ExtensionUIContext
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stats (event-driven — design §5 "drop the 4s poll")
  //
  // Usage is read on demand from the live session (no timer). `_emitStats` is
  // called from `_translate` on `turn_end` and `agent_end`; it derives the
  // context_usage/token_stats frame bodies through the SAME `deriveStatsFrames`
  // helper the RPC poller uses, so the WS frames server.ts broadcasts are
  // byte-identical across transports. The emitted internal events
  // (`context_usage` / `token_stats`) are what `_wireSlotEvents` broadcasts for
  // SDK slots (RPC slots never emit them — they poll instead).
  // ─────────────────────────────────────────────────────────────────────────
  private _emitStats(): void {
    const stats = this._session?.getSessionStats?.()
    if (!stats) return
    const { contextUsage, tokenStats } = deriveStatsFrames({ data: stats })
    if (contextUsage) {
      this._contextUsage = contextUsage
      this.emit('context_usage', contextUsage)
    }
    if (tokenStats) {
      this._tokenStats = tokenStats
      this.emit('token_stats', tokenStats)
    }
  }

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
        // Event-driven stats (design §5): read live usage now that the turn is
        // terminal and emit the context_usage/token_stats frames. Replaces the
        // RPC 4s poller for SDK slots.
        this._emitStats()
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
        this.emit(type, event)
        break

      case 'turn_end':
        this.emit(type, event)
        // Mid-conversation turn boundary: refresh usage so multi-turn stats
        // stay live without a poll (design §5). Same frames as agent_end.
        this._emitStats()
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

      case 'session_info_changed':
        // DELTA (design §2): slot titles were derived by polling
        // getState()->sessionName after each agent_end. Map the event to an
        // internal `session_info_changed {name}` emission that _wireSlotEvents
        // consumes for SDK slots — removing that poll. RPC has no such event
        // (its _handleEvent routes it to the generic `event`), so the RPC poll
        // path is untouched.
        this.emit('session_info_changed', { name: event.name })
        break

      case 'thinking_level_changed':
        // New (design §2, minor): keep this.thinkingLevel in sync and emit
        // `model_change` — the SAME frame the RPC path emits for a model/thinking
        // change — so the FE settings chip updates (server.ts persists +
        // broadcasts slots on model_change).
        if (typeof event.level === 'string') {
          const changed = this.thinkingLevel !== event.level
          this.thinkingLevel = event.level
          if (changed) this.emit('model_change')
        }
        break

      default:
        // compaction_* — not consumed by server.ts today; routed here until an
        // owning slice wires them.
        this.emit('event', event)
    }
  }
}
