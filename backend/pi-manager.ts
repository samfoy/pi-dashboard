/**
 * Pi RPC Process Manager
 * Spawns and manages `pi --mode rpc` processes, one per chat slot.
 */
import { spawn, execSync, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { extractText, ChatMessage } from './session-store.js'
import type { PiSession, PiTransport, ImagePayload } from './pi-session.js'
import { PiSdkSession } from './pi-sdk-session.js'

// Resolve the user's configured defaultThinkingLevel the same way pi does:
// project settings (<cwd>/.pi/settings.json) override global
// ($PI_CODING_AGENT_DIR or ~/.pi/agent/settings.json). pi's own model
// resolver IGNORES defaultThinkingLevel whenever --model is passed on the CLI
// (it short-circuits to the hardcoded "medium" default). Because the dashboard
// always spawns slots with --model, every slot would otherwise be stuck on
// medium regardless of settings.json — so we re-apply the resolved default via
// set_thinking_level after the process is up.
function readThinkingLevelFrom(file: string): string | null {
  try {
    const s = JSON.parse(readFileSync(file, 'utf-8'))
    const lvl = s?.defaultThinkingLevel
    return typeof lvl === 'string' ? lvl : null
  } catch { return null }
}

export function resolveDefaultThinkingLevel(cwd?: string | null): string | null {
  // 1. Project-scoped settings take precedence
  if (cwd) {
    const projectLvl = readThinkingLevelFrom(join(cwd, '.pi', 'settings.json'))
    if (projectLvl) return projectLvl
  }
  // 2. Global agent settings
  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? process.env.PI_CODING_AGENT_DIR.replace(/^~(?=$|\/)/, os.homedir())
    : join(os.homedir(), '.pi', 'agent')
  return readThinkingLevelFrom(join(agentDir, 'settings.json'))
}

// Resolve pi binary path at startup (avoids ENOENT in launchd)
// Resolve pi script path at startup (avoids ENOENT in launchd)
const PI_SCRIPT = (() => {
  try { return execSync('which pi', { encoding: 'utf-8' }).trim() } catch {}
  const candidates = ['/opt/homebrew/bin/pi', '/usr/local/bin/pi']
  for (const c of candidates) {
    try { execSync(`test -x ${c}`); return c } catch {}
  }
  return 'pi'
})()

// Resolve node binary path
const NODE_BIN = (() => {
  try { return execSync('which node', { encoding: 'utf-8' }).trim() } catch {}
  const candidates = ['/opt/homebrew/bin/node', '/usr/local/bin/node']
  for (const c of candidates) {
    try { execSync(`test -x ${c}`); return c } catch {}
  }
  return 'node'
})()

// V8 flags that must be passed as CLI args (not allowed in NODE_OPTIONS)
const V8_FLAGS = ['--no-wasm-tier-up', '--liftoff-only', '--wasm-lazy-compilation']

const IMAGE_DIR = join(os.tmpdir(), 'pi-dashboard-images')
mkdirSync(IMAGE_DIR, { recursive: true })

interface PiProcessOptions {
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

// Resolve a slot's transport backend: per-slot override wins, then the
// PI_DASH_TRANSPORT env, else the foreground default 'sdk' (slice 10 flip —
// live gates passed: fixture fidelity, 2-slot isolation, latency). Background/
// detached slots are kept on isolated 'rpc' by two mechanisms (design decision
// #2): (a) background-at-creation paths (scheduled jobs) pass an explicit
// transport:'rpc' override; (b) the conductor-detach route reconstructs a
// foreground SDK slot as a PiRpcSession subprocess at detach time (a field flip
// alone can't re-isolate an already-constructed in-process session). Rollback
// path intact: PI_DASH_TRANSPORT=rpc (env) or an explicit per-slot override
// forces 'rpc'.
export function resolveTransport(override?: PiTransport | null): PiTransport {
  const env = process.env.PI_DASH_TRANSPORT
  const envTransport: PiTransport | undefined = env === 'rpc' || env === 'sdk' ? env : undefined
  return override ?? envTransport ?? 'sdk'
}

interface SlotInfo {
  key: string
  title: string
  messages: number
  running: boolean
  stopping: boolean
  pending_approval: boolean
  model: string | null
  thinkingLevel: string | null
  cwd: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

interface SlotDetail {
  messages: ChatMessage[]
  running: boolean
  stopping: boolean
  pending_approval: boolean
  has_more: boolean
  total: number
  model: string | null
  thinkingLevel: string | null
  cwd: string | null
  contextUsage: any | null
  tokenStats: any | null
}

function saveImagesToTemp(images: ImagePayload[]): string[] {
  return images.map((img, i) => {
    const ext = (img.mimeType || 'image/png').split('/')[1] || 'png'
    const name = `img-${Date.now()}-${i}.${ext}`
    const filePath = join(IMAGE_DIR, name)
    writeFileSync(filePath, Buffer.from(img.data || '', 'base64'))
    return filePath
  })
}

/**
 * Normalize image payloads to pi's expected format:
 *   { type: "image", mimeType: "image/jpeg", data: "<base64>" }
 * Accepts various input formats from web frontend or iOS app.
 */
function normalizeImages(images?: ImagePayload[]): ImagePayload[] | undefined {
  if (!images?.length) return undefined
  return images.map(img => ({
    type: 'image',
    mimeType: img.mimeType || img.media_type || 'image/png',
    data: img.data || img.source?.data || '',
  })).filter(img => img.data)
}

export class PiRpcSession extends EventEmitter implements PiSession {
  slotKey: string
  transport: PiTransport = 'rpc'
  proc: ChildProcess | null
  buffer: string
  ready: boolean
  running: boolean
  messages: ChatMessage[]
  sessionFile: string | null
  agent: string | null
  cwd: string | null
  modelProvider: string | null
  modelId: string | null
  thinkingLevel: string | null
  _title: string | null
  _tags: string[]
  _userRenamed: boolean
  _startTime: number
  _lastActivity: number
  _pendingRequests: Map<string, { resolve: (value: any) => void; timer: ReturnType<typeof setTimeout> }>
  // Extension-UI dialogs (confirm/select/input/editor) awaiting a browser
  // response. Keyed by the request id pi emitted; stores the method (needed to
  // map the response to pi's per-method return type) and the anti-wedge timer
  // that auto-cancels if no browser answers within the timeout.
  _pendingExtensionUi: Map<string, { method: string; timer: ReturnType<typeof setTimeout> }>
  _stopping: boolean
  _pendingApproval: boolean
  // Counts user-initiated prompts that pi-dashboard has issued but for
  // which we have not yet seen agent_end. Gates followUp streamingBehavior
  // so we only queue when *we* know we have an outstanding turn — never
  // on a stale pi.running flag (set by pi child auto-emitting agent_start
  // during session resume / extension hooks / phantom restart events).
  // The earlier behavior — trust pi.running unconditionally — caused
  // fresh user prompts after RESUME to silently queue behind nonexistent
  // turns, surfacing as "slot stops after my message and never returns".
  _outstandingPrompts: number
  _streamIdx: number
  _stderrLines: string[]
  _startupTimer: ReturnType<typeof setTimeout> | null
  _stoppingTimer?: ReturnType<typeof setTimeout> | null
  // Instrumentation only (no longer load-bearing). Was the
  // skip-during-tool-execution guard for the 5-min stuck-turn
  // force-abort in _healthCheck. The force-abort was removed; this
  // counter stays as cheap instrumentation in case a future UI surface
  // wants "tools in flight per slot."
  _toolsRunning: number
  _readyPromise?: Promise<void> | null
  _contextUsage?: any
  _tokenStats?: any
  _wired?: boolean
  _wasRestarted?: boolean  // set when process restarts for an existing session (resume)

  constructor(slotKey: string, opts: PiProcessOptions = {}) {
    super()
    this.slotKey = slotKey
    this.proc = null
    this.buffer = ''
    this.ready = false
    this.running = false
    this.messages = opts.messages || []
    this.sessionFile = opts.sessionFile || null
    this.agent = opts.agent || null
    this.cwd = opts.cwd || null
    this.modelProvider = opts.modelProvider || null
    this.modelId = opts.modelId || null
    this.thinkingLevel = opts.thinkingLevel || null
    this._title = opts.title || null
    this._tags = opts.tags || []
    this._userRenamed = false  // true if user manually renamed
    this._startTime = Date.now()
    this._lastActivity = 0  // 0 = never; updated on actual activity
    this._pendingRequests = new Map() // id → { resolve, timer }
    this._pendingExtensionUi = new Map() // id → { method, timer }
    this._stopping = false
    this._pendingApproval = false
    this._outstandingPrompts = 0
    this._toolsRunning = 0
    this._streamIdx = -1  // index where partial streaming messages start
    this._stderrLines = []
    this._startupTimer = null
    this.transport = opts.transport || 'rpc'
  }

  start(): void {
    // Guard: if a process is already running, kill it first to avoid orphans
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
      console.error(`[pi-manager] ⚠ start() called while process already running (pid=${this.proc.pid}) for slot ${this.slotKey} — killing old process first\n${new Error().stack}`)
      this.proc.kill('SIGTERM')
      this.proc = null
    }
    if (!this.cwd) this.cwd = process.env.HOME || '/tmp'
    // Snapshot the desired thinking level before spawning. A persisted per-slot
    // override (this.thinkingLevel, set via opts on restore or the UI) wins;
    // otherwise fall back to the user's settings.json defaultThinkingLevel.
    // pi ignores defaultThinkingLevel when --model is passed, so we re-apply it
    // ourselves once the process is ready (see get_state handler below).
    const desiredThinking = this.thinkingLevel || resolveDefaultThinkingLevel(this.cwd)
    const args = ['--mode', 'rpc']
    if (this.sessionFile) {
      args.push('--session', this.sessionFile)
      console.log(`[pi-manager] Starting slot with session file: ${this.sessionFile}`)
    } else {
      console.log(`[pi-manager] Starting slot with NO session file`)
    }
    if (this.agent) {
      args.push('--agent', this.agent)
    }
    if (this.modelProvider && this.modelId) {
      args.push('--model', `${this.modelProvider}/${this.modelId}`)
    }

    const spawnOpts: {
      stdio: ['pipe', 'pipe', 'pipe']
      env: NodeJS.ProcessEnv
      cwd?: string
    } = {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PI_RUNTIME: 'dashboard',
        PI_DASH_PORT: String(process.env.PI_DASH_PORT || 7777),
        PI_SLOT_KEY: this.slotKey,
        NODE_OPTIONS: [process.env.NODE_OPTIONS?.replace(/--no-wasm-tier-up/g, '').trim(), '--max-old-space-size=4096'].filter(Boolean).join(' '),
        // If AWS_PROFILE isn't set, fall back to PI_BEDROCK_PROFILE so bedrock sessions work
        ...((!process.env.AWS_PROFILE && process.env.PI_BEDROCK_PROFILE) ? { AWS_PROFILE: process.env.PI_BEDROCK_PROFILE } : {}),
      },
    }
    if (this.cwd) spawnOpts.cwd = this.cwd

    // Spawn via node directly so we can pass V8 flags (--no-wasm-tier-up)
    // that are disallowed in NODE_OPTIONS but prevent WASM compiler OOM crashes
    this.proc = spawn(NODE_BIN, [...V8_FLAGS, PI_SCRIPT, ...args], spawnOpts)
    console.log(`[pi-manager] Spawned slot ${this.slotKey} pid=${this.proc.pid}`)

    // Ready promise — resolves when pi responds to get_state (templates loaded)
    this._readyPromise = this.request({ type: 'get_state' }, 15000).then((resp: any) => {
      console.log(`[pi-manager] get_state response: sessionFile=${resp?.data?.sessionFile}, sessionName=${resp?.data?.sessionName}`)
      if (resp?.data?.sessionFile) {
        if (this.sessionFile && resp.data.sessionFile !== this.sessionFile) {
          console.warn(`[pi-manager] ⚠ Session file changed! Was: ${this.sessionFile}, Now: ${resp.data.sessionFile}`)
        }
        this.sessionFile = resp.data.sessionFile
        this.emit('session_file', this.sessionFile)
      } else if (this.sessionFile) {
        console.warn(`[pi-manager] ⚠ get_state returned no sessionFile, but we expected: ${this.sessionFile}`)
      }
      // Populate the actual model + thinking level pi resolved (defaults from
      // settings.json apply when we didn't pass --model). Without this the
      // ChatSettings modal can't show the selected model on a fresh slot.
      const m = resp?.data?.model
      if (m?.provider && m?.id) {
        const changed = this.modelProvider !== m.provider || this.modelId !== m.id
        this.modelProvider = m.provider
        this.modelId = m.id
        if (changed) this.emit('model_change')
      }
      if (typeof resp?.data?.thinkingLevel === 'string') {
        const reported = resp.data.thinkingLevel
        // pi always resolves "medium" here because we spawn with --model. If the
        // desired level (per-slot override or settings default) differs, re-apply
        // it via set_thinking_level rather than accepting pi's default.
        if (desiredThinking && desiredThinking !== reported) {
          this.setThinkingLevel(desiredThinking).catch((e: any) =>
            console.error(`[pi-manager] failed to apply thinking level ${desiredThinking}:`, e?.message || e))
          const changed = this.thinkingLevel !== desiredThinking
          this.thinkingLevel = desiredThinking
          if (changed) this.emit('model_change')
        } else {
          const changed = this.thinkingLevel !== reported
          this.thinkingLevel = reported
          if (changed) this.emit('model_change')
        }
      }
    }).catch((err: any) => {
      console.error(`[pi-manager] get_state failed:`, err?.message || err)
    })

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      let nl: number
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        let line = this.buffer.slice(0, nl)
        this.buffer = this.buffer.slice(nl + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          this._handleEvent(msg)
        } catch {
          // non-JSON line from pi, ignore
        }
      }
    })

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) {
        this._stderrLines.push(text)
        if (this._stderrLines.length > 20) this._stderrLines.shift()
        this.emit('log', { level: 'warn', msg: text })
      }
    })

    const spawnedProc = this.proc
    const spawnedPid = this.proc.pid
    this.proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      // Ignore exit from a stale process (e.g. after /reload killed the old one)
      if (spawnedProc !== this.proc) {
        console.error(`[pi-manager] Ignoring stale exit (pid=${spawnedPid}, code=${code}, signal=${signal}) for slot ${this.slotKey} — current proc pid=${this.proc?.pid}`)
        return
      }
      this.ready = false
      this.running = false
      this._stopping = false
      this._pendingApproval = false
      this.proc = null
      if (this._stoppingTimer) { clearTimeout(this._stoppingTimer); this._stoppingTimer = null }
      if (this._startupTimer) {
        clearTimeout(this._startupTimer)
        this._startupTimer = null
        this.emit('startup_error', { code, slotKey: this.slotKey, stderr: this._stderrLines.join('\n') })
      }
      console.error(`[pi-manager] Slot ${this.slotKey} (pid=${spawnedPid}) exited with code ${code} signal=${signal}${this._stderrLines.length ? ' | last stderr: ' + this._stderrLines.slice(-3).join(' | ') : ''}`)
      this.emit('exit', code)
    })

    this.proc.on('error', (err: Error) => {
      this.emit('error', err)
    })

    // Detect early crash (within first 5s = likely extension/startup failure)
    this._startupTimer = setTimeout(() => { this._startupTimer = null }, 5000)

    this.ready = true

    // Seed current thinking level from pi only if we don't already have a
    // desired level to enforce. The get_state ready-promise above applies the
    // per-slot override / settings default; blindly re-seeding here would clobber
    // it with pi's "medium" default (which pi reports because we spawn --model).
    setTimeout(() => {
      if (desiredThinking) return
      this.getState().then((state: any) => {
        if (state?.thinkingLevel) this.thinkingLevel = state.thinkingLevel
      }).catch(() => {})
    }, 500)
  }

  send(cmd: Record<string, any>): boolean {
    if (!this.proc || this.proc.killed || this.proc.exitCode !== null || !this.proc.stdin!.writable) {
      // Process is dead — reset state
      if (this.running || this._stopping) {
        this.running = false
        this._stopping = false
        this._pendingApproval = false
        this._outstandingPrompts = 0
        this.emit('agent_end', { messages: [] })
      }
      return false
    }
    this.proc.stdin!.write(JSON.stringify(cmd) + '\n')
    return true
  }

  /** Send a command and wait for the response by id */
  request(cmd: Record<string, any>, timeoutMs: number = 30000): Promise<any> {
    const id = cmd.id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    cmd.id = id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id)
        reject(new Error('RPC timeout'))
      }, timeoutMs)
      this._pendingRequests.set(id, { resolve, timer })
      if (!this.send(cmd)) {
        clearTimeout(timer)
        this._pendingRequests.delete(id)
        reject(new Error('Process not running'))
      }
    })
  }

  async _shouldQueuePromptAsFollowUp(): Promise<boolean> {
    if (this._outstandingPrompts > 0) return true
    if (!this.running) return false

    try {
      const state = await this.request({ type: 'get_state' }, 1000)
      const isStreaming = state?.data?.isStreaming === true || state?.data?.isCompacting === true
      if (!isStreaming) {
        // Keep the old phantom-agent_start recovery: if pi says it is idle,
        // do not queue behind a nonexistent turn.
        this.running = false
      }
      return isStreaming
    } catch {
      // If the child cannot answer get_state, preserve the old behavior rather
      // than queueing behind a possibly phantom turn forever.
      return false
    }
  }

  async prompt(message: string, images?: ImagePayload[]): Promise<boolean | void> {
    this._lastActivity = Date.now()
    // Normalize images to pi's expected format
    const normalizedImages = normalizeImages(images)
    // Wait for pi to be ready (templates loaded) before sending
    if (this._readyPromise) {
      await this._readyPromise
      this._readyPromise = null
    }
    // Map builtin slash commands to RPC types
    if (message.startsWith('/')) {
      const spaceIdx = message.indexOf(' ')
      const cmd = spaceIdx === -1 ? message.slice(1).trim() : message.slice(1, spaceIdx).trim()
      const args = spaceIdx === -1 ? '' : message.slice(spaceIdx + 1).trim()

      // /reload needs special handling — pi's RPC mode doesn't support it.
      // Kill and restart the process to pick up new extensions/skills/config.
      if (cmd === 'reload') {
        if (this.proc) {
          // Clear startup timer BEFORE killing so the old exit handler
          // doesn't falsely emit startup_error for the new process
          if (this._startupTimer) { clearTimeout(this._startupTimer); this._startupTimer = null }
          this.kill()
          this.proc = null
          this.ready = false
          this.running = false
          this.buffer = ''
        }
        this._stderrLines = []
        this.start()
        this.messages.push({ role: 'system', content: '🔄 Reloaded extensions, skills, prompts, and themes.', ts: new Date().toISOString() })
        this.emit('agent_end', { messages: [] })
        return
      }

      const RPC_MAP: Record<string, Record<string, any>> = {
        'compact': { type: 'compact' },
        'new': { type: 'new_session' },
        'clear': { type: 'new_session' },
        'fork': { type: 'fork' },
        'export': { type: 'export_html', path: args || undefined },
        'name': { type: 'set_session_name', name: args || 'New Chat' },
      }

      // Commands that return data — use request() and emit result as a message
      const DATA_CMDS: Record<string, Record<string, any>> = {
        'session': { type: 'get_session_stats' },
        'copy': { type: 'get_last_assistant_text' },
        'usage': { type: 'get_session_stats' },
        'tools': { type: 'get_commands' },
      }

      if (DATA_CMDS[cmd]) {
        this.request(DATA_CMDS[cmd]).then((resp: any) => {
          if (resp?.data) {
            const text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data, null, 2)
            this.messages.push({ role: 'assistant', content: '```\n' + text + '\n```', ts: new Date().toISOString() })
            this.emit('slash_result', { content: '```\n' + text + '\n```' })
          }
        }).catch(() => {})
        return
      }

      if (RPC_MAP[cmd]) {
        return this.send(RPC_MAP[cmd])
      }

      // Extension and skill commands go through prompt() which handles them
      const promptCmd: Record<string, any> = { type: 'prompt', message }
      if (await this._shouldQueuePromptAsFollowUp()) {
        promptCmd.streamingBehavior = 'followUp'
        console.log(`[pi-manager] prompt(${this.slotKey}): slash command queued as FOLLOWUP. msgPreview=${message.slice(0, 60).replace(/\n/g, ' ')}`)
      }
      this._outstandingPrompts++
      this.running = true
      this.messages.push({ role: 'user', content: message, ts: new Date().toISOString() })
      if (normalizedImages?.length) {
        const paths = saveImagesToTemp(normalizedImages)
        promptCmd.images = normalizedImages
        promptCmd.message += `\n\n[Images saved to disk: ${paths.join(', ')}]`
      }
      return this.send(promptCmd)
    }

    // Regular message
    let msg = message
    const cmd: Record<string, any> = { type: 'prompt' }
    if (normalizedImages?.length) {
      const paths = saveImagesToTemp(normalizedImages)
      cmd.images = normalizedImages
      msg += `\n\n[Images saved to disk: ${paths.join(', ')}]`
    }
    // If this process was just restarted for an existing session, prepend a resume
    // hint so the agent doesn't mistake the re-injected session primer for a fresh start.
    if (this._wasRestarted) {
      this._wasRestarted = false
      msg = `[Note for agent: you are RESUMING an existing conversation — not starting a new session. The session primer above is background context only. Continue from where we left off.]\n\n${msg}`
    }
    cmd.message = msg
    // Queue as followUp when dashboard knows a prompt is outstanding. If
    // dashboard's local counter is stale, ask pi for the authoritative
    // isStreaming flag. This catches provider-specific races (seen with
    // bedrock-mantle GPT/openai-responses) without trusting phantom
    // agent_start events from resume/restart.
    if (await this._shouldQueuePromptAsFollowUp()) {
      cmd.streamingBehavior = 'followUp'
      console.log(`[pi-manager] prompt(${this.slotKey}): pi is busy, sending as FOLLOWUP. outstandingPrompts=${this._outstandingPrompts}. msgPreview=${message.slice(0, 60).replace(/\n/g, ' ')}`)
    } else {
      console.log(`[pi-manager] prompt(${this.slotKey}): fresh prompt. msgPreview=${message.slice(0, 60).replace(/\n/g, ' ')}`)
    }
    this._outstandingPrompts++
    this.running = true
    this.messages.push({ role: 'user', content: message, ts: new Date().toISOString() })
    return this.send(cmd)
  }

  /**
   * Signal a running foreground ensemble_spawn to detach → background.
   * Creates the sentinel file that pi-conductor polls in RPC mode.
   * No-op if the pi process is not running.
   */
  conductorDetach(): void {
    // Default-policy: detached/background slots always run on 'rpc' — they
    // can't be steered onto an experimental backend after detaching.
    this.transport = 'rpc'
    if (!this.proc?.pid) return
    const filePath = `/tmp/pi-conductor-detach-${this.proc.pid}`
    try { writeFileSync(filePath, '') } catch { /* ignore */ }
  }

  abort(): boolean {
    this._stopping = true
    // If process is already dead, reset state immediately
    if (!this.proc || this.proc.killed || this.proc.exitCode !== null) {
      this.running = false
      this._stopping = false
      this._pendingApproval = false
      this._outstandingPrompts = 0
      this.emit('agent_end', { messages: [] })
      return false
    }
    // Watchdog: if still stopping after 10s, force-kill
    if (this._stoppingTimer) clearTimeout(this._stoppingTimer)
    this._stoppingTimer = setTimeout(() => {
      if (this._stopping) {
        this.emit('log', { level: 'warn', msg: `Slot ${this.slotKey}: abort watchdog triggered, force-killing` })
        this.kill()
      }
    }, 10000)
    return this.send({ type: 'abort' })
  }

  async getAvailableModels(): Promise<any[]> {
    const resp = await this.request({ type: 'get_available_models' })
    return resp?.data?.models || []
  }

  async getCommands(): Promise<any[]> {
    const resp = await this.request({ type: 'get_commands' })
    return resp?.data?.commands || []
  }

  async setModel(provider: string, modelId: string): Promise<any> {
    return this.request({ type: 'set_model', provider, modelId })
  }

  async setThinkingLevel(level: string): Promise<any> {
    return this.request({ type: 'set_thinking_level', level })
  }

  async getState(timeoutMs: number = 30000): Promise<any> {
    return this.request({ type: 'get_state' }, timeoutMs)
  }

  /** Cumulative session stats (tokens / context / cost). Was
   *  request({type:'get_session_stats'}). Default 5s timeout matches the
   *  server.ts poll site. */
  async getSessionStats(timeoutMs: number = 5000): Promise<any> {
    return this.request({ type: 'get_session_stats' }, timeoutMs)
  }

  /** Fork the session at a user entry. Was request({type:'fork',entryId}).
   *  Returns the unwrapped result; sessionFile is resolved by the caller via a
   *  separate getState() (unchanged wire sequence). */
  async fork(entryId: string): Promise<{ text?: string; cancelled?: boolean; sessionFile?: string | null }> {
    const resp = await this.request({ type: 'fork', entryId })
    return { text: resp?.data?.text, cancelled: resp?.data?.cancelled, sessionFile: resp?.data?.sessionFile }
  }

  /** Fork-able message list. Was request({type:'get_fork_messages'}). Returns
   *  the full response (callers forward it verbatim). */
  async getForkMessages(): Promise<any> {
    return this.request({ type: 'get_fork_messages' })
  }

  /**
   * Gracefully shut down the pi process by closing stdin.
   * This triggers pi's session_shutdown lifecycle (memory consolidation, etc.)
   * and waits for the process to exit naturally.
   * Returns a promise that resolves when the process exits or the timeout fires.
   */
  gracefulShutdown(timeoutMs: number = 60000): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.proc || this.proc.killed || this.proc.exitCode !== null) {
        this._rejectPendingRequests()
        return resolve()
      }

      // Mark as stopping so health check / idle reaper don't interfere
      this._stopping = true

      // Listen for exit
      const onExit = () => {
        clearTimeout(watchdog)
        resolve()
      }
      this.proc.once('exit', onExit)

      // Watchdog: force-kill if graceful shutdown takes too long
      const watchdog = setTimeout(() => {
        this.proc?.removeListener('exit', onExit)
        console.error(`[pi-manager] Slot ${this.slotKey}: graceful shutdown timed out after ${timeoutMs}ms, force-killing`)
        this.kill()
        resolve()
      }, timeoutMs)

      // Close stdin — triggers pi's onInputEnd → shutdown() → session_shutdown → dispose
      try {
        this.proc.stdin!.end()
      } catch {
        // stdin already closed or errored — fall back to kill
        clearTimeout(watchdog)
        this.proc?.removeListener('exit', onExit)
        this.kill()
        resolve()
      }
    })
  }

  kill(): void {
    if (this.proc) {
      this.proc.kill('SIGTERM')
      setTimeout(() => {
        if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL')
      }, 3000)
    }
    this._rejectPendingRequests()
  }

  private _rejectPendingRequests(): void {
    // Reject pending requests
    for (const [id, { resolve, timer }] of this._pendingRequests) {
      clearTimeout(timer)
      resolve(null)
    }
    this._pendingRequests.clear()
  }

  /**
   * Check if the child process is still alive. If it's dead but we still
   * think we're running/stopping, reset state and emit agent_end so the
   * UI can recover.
   */
  checkHealth(): boolean {
    if (!this.proc) return false
    const dead = this.proc.killed || this.proc.exitCode !== null
    if (dead && (this.running || this._stopping)) {
      this.running = false
      this._stopping = false
      this._pendingApproval = false
      this._outstandingPrompts = 0
      if (this._stoppingTimer) { clearTimeout(this._stoppingTimer); this._stoppingTimer = null }
      this.emit('agent_end', { messages: [] })
      this.emit('log', { level: 'warn', msg: `Slot ${this.slotKey}: health check found dead process, reset state` })
      return true
    }
    return false
  }

  /**
   * Process liveness: the child is spawned and has not exited. Distinct from
   * `running` (turn-in-progress) and from `checkHealth()` (dead-state reaper).
   * Replaces the inline `proc && !proc.killed && exitCode===null` liveness
   * checks that used to live in server.ts / chat.ts.
   */
  get alive(): boolean {
    return !!this.proc && !this.proc.killed && this.proc.exitCode === null
  }

  /**
   * Inject a dashboard-originated auto-turn (e.g. a subagent-result or
   * process-update hint). Bypasses prompt()'s slash/queue handling by design —
   * marks running, records the user message, and dispatches the prompt frame.
   */
  triggerAutoTurn(message: string): boolean {
    this.running = true
    this.messages.push({ role: 'user', content: message, ts: new Date().toISOString(), meta: { autoTrigger: true } })
    return this.send({ type: 'prompt', message })
  }

  /**
   * Arm the anti-wedge auto-cancel timer for a pending extension-UI dialog and
   * record it (keyed by request id) so a later browser response can resolve it.
   * On timeout, auto-cancels via respondExtensionUi so a dialog raised with no
   * attached browser can't wedge the slot's turn forever.
   */
  armExtensionUi(id: string, method: string, timeoutMs: number): void {
    const timer = setTimeout(() => {
      this.respondExtensionUi(id, { cancelled: true })
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    this._pendingExtensionUi.set(id, { method, timer })
  }

  /**
   * Resolve a pending extension-UI dialog, mapping the response to pi's
   * per-method return type (confirm -> {confirmed}, select/input/editor ->
   * {value}, cancel -> {cancelled}). Returns false if `id` is unknown (already
   * answered or timed out).
   */
  respondExtensionUi(id: string, response: { cancelled?: boolean; value?: any }): boolean {
    const pending = this._pendingExtensionUi.get(id)
    if (!pending) return false
    clearTimeout(pending.timer)
    this._pendingExtensionUi.delete(id)
    if (response.cancelled) {
      this.send({ type: 'extension_ui_response', id, cancelled: true })
    } else if (pending.method === 'confirm') {
      this.send({ type: 'extension_ui_response', id, confirmed: !!response.value })
    } else {
      this.send({ type: 'extension_ui_response', id, value: response.value != null ? String(response.value) : undefined })
    }
    return true
  }

  _handleEvent(event: any): void {
    const { type } = event

    // Handle responses to tracked requests
    if (type === 'response' && event.id && this._pendingRequests.has(event.id)) {
      const { resolve, timer } = this._pendingRequests.get(event.id)!
      clearTimeout(timer)
      this._pendingRequests.delete(event.id)
      resolve(event)
      return
    }

    switch (type) {
      case 'response':
        // If a prompt failed (e.g. no API key), reset running state
        if (event.command === 'prompt' && event.success === false) {
          console.error(`[pi-manager] PROMPT FAILED on slot ${this.slotKey}: ${event.error || '<no error>'} | full event:`, JSON.stringify(event).slice(0, 500))
          this.running = false
          this._stopping = false
          this._pendingApproval = false
          if (this._outstandingPrompts > 0) this._outstandingPrompts--
          const errMsg = `⚠️ ${event.error || 'Prompt failed'}`
          this.messages.push({ role: 'system', content: errMsg, ts: new Date().toISOString() })
          // Emit a synthetic chat_message so server.ts broadcasts the error
          // to the FE — otherwise the user sees their message and then
          // silence (chat_done with no assistant reply).
          this.emit('prompt_failed', { error: event.error || 'Prompt failed' })
          this.emit('agent_end', { messages: [] })
        }
        this.emit('response', event)
        break

      case 'agent_start':
        this.running = true
        this._stopping = false
        this._pendingApproval = false
        this._streamIdx = this.messages.length  // mark where partials will go
        // Bump activity at turn start so re-entrant turns (extension followUp,
        // sub-agent completion injections via triggerTurn) don't inherit a
        // stale _lastActivity from before the long wait and trip the
        // _healthCheck stuck-turn watchdog (5min). LOAD-BEARING.
        this._lastActivity = Date.now()
        this.emit('agent_start', event)
        break

      case 'agent_end':
        this.running = false
        this._stopping = false
        this._pendingApproval = false
        if (this._outstandingPrompts > 0) this._outstandingPrompts--
        this._lastActivity = Date.now()
        if (this._stoppingTimer) { clearTimeout(this._stoppingTimer); this._stoppingTimer = null }
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
        // Track in-flight tool count + bump activity so long single-tool-call
        // turns (deploys, big test runs, conductor foreground sub-agents)
        // don't trip the _healthCheck stuck-turn watchdog. The _toolsRunning
        // counter is the skip-during-tool-execution guard at _healthCheck.
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
        // Math.max clamp guards against unpaired _end (process restart,
        // missed event) sending the counter negative.
        this._toolsRunning = Math.max(0, this._toolsRunning - 1)
        this._lastActivity = Date.now()
        this.emit('tool_end', event)
        break

      case 'turn_start':
      case 'turn_end':
        this.emit(type, event)
        break

      case 'auto_compaction_start':
      case 'auto_compaction_end':
        this.emit(type, event)
        break

      case 'extension_ui_request':
        // pi-conductor item 1 (D1) defense — bump _lastActivity on
        // extension UI requests so slots actively orchestrating
        // sub-agents (each spawn re-renders the conductor widget,
        // emitting extension_ui_request events) don't get reaped
        // by the 30h idle-reaper at _healthCheck. Background
        // sub-agents end the parent's turn immediately on tool
        // return, so the parent slot looks idle from pi-dashboard's
        // POV without a heartbeat from the orchestrator.
        // See pi-conductor docs/items-1-11-pi-dashboard-inspector-map.md.
        this._lastActivity = Date.now()
        this.emit('extension_ui', event)
        break

      case 'extension_error':
        this.emit('extension_error', event)
        break

      default:
        this.emit('event', event)
    }
  }

}

export class PiManager {
  slots: Map<string, PiSession>
  _slotCounter: number
  _startTime: number
  _onStateChange: (() => void) | null
  _modelCache: any[] | null
  _modelCacheTime: number
  _healthInterval: ReturnType<typeof setInterval> | null

  constructor() {
    this.slots = new Map()
    this._slotCounter = 0
    this._startTime = Date.now()
    this._onStateChange = null
    this._modelCache = null
    this._modelCacheTime = 0
    // Health check every 5s — detect dead processes with stale running/stopping state
    this._healthInterval = setInterval(() => this._healthCheck(), 5000)
  }

  createSlot(name: string, agent: string | null, opts: PiProcessOptions = {}): { key: string; title: string; messages: number; running: boolean } {
    const key = opts.key || `chat-${++this._slotCounter}-${Date.now()}`
    const transport = resolveTransport(opts.transport)
    // Foreground default is 'sdk' (slice 10 flip). A per-slot override or
    // PI_DASH_TRANSPORT=rpc forces the isolated RPC subprocess; background
    // slots are moved to 'rpc' by conductorDetach() after creation.
    const pi: PiSession = transport === 'sdk'
      ? new PiSdkSession(key, { agent, ...opts, transport })
      : new PiRpcSession(key, { agent, ...opts, transport })
    // Don't start pi process yet — defer to first message (ensureRunning)
    // This allows CWD/model to be changed in WelcomeView before process starts
    this.slots.set(key, pi)
    this._save()
    return { key, title: name || pi._title || 'New Chat', messages: pi.messages.length, running: false }
  }

  restoreSlot(key: string, title: string, messages: ChatMessage[], opts: PiProcessOptions = {}): void {
    console.log(`[pi-manager] Restoring slot ${key}: title="${title}", msgs=${messages.length}, sessionFile=${opts.sessionFile || 'NONE'}`)
    // Backward compat: slot state saved before transport existed has no
    // `transport` field → resolveTransport applies the foreground default
    // ('sdk' since slice 10). A persisted 'rpc' transport is honored as an
    // override and keeps the slot on the isolated RPC subprocess.
    const transport = resolveTransport(opts.transport)
    const pi: PiSession = transport === 'sdk'
      ? new PiSdkSession(key, { messages, title, ...opts, transport })
      : new PiRpcSession(key, { messages, title, ...opts, transport })
    pi.ready = false
    this.slots.set(key, pi)
    if (parseInt(key.split('-')[1]) >= this._slotCounter) {
      this._slotCounter = parseInt(key.split('-')[1]) + 1
    }
  }

  ensureRunning(key: string): PiSession | null {
    const pi = this.slots.get(key)
    if (!pi) return null
    // Restart if process/session is missing or dead. `alive` is the
    // transport-agnostic liveness probe (for RPC it is exactly the old
    // `proc && !killed && exitCode===null` inline check).
    if (!pi.alive) {
      const reason = pi instanceof PiRpcSession
        ? (!pi.proc ? 'proc=null' : pi.proc.killed ? `proc.killed (pid=${pi.proc.pid})` : `exitCode=${pi.proc.exitCode} (pid=${pi.proc.pid})`)
        : 'session dead'
      const isResume = pi.messages.length > 0 || !!pi.sessionFile
      console.error(`[pi-manager] ensureRunning: starting slot ${key} because ${reason}${isResume ? ' (RESUME)' : ''}`)
      if (pi instanceof PiRpcSession) pi.proc = null
      pi.running = false
      pi._stopping = false
      pi._pendingApproval = false
      pi.start()
      // Flag so the first prompt injects a resume hint — prevents the session primer
      // (re-injected by pi-session-search on every process start) from confusing the
      // agent into thinking it's a fresh new session.
      if (isResume) pi._wasRestarted = true
    }
    return pi
  }

  getSlot(key: string): PiSession | undefined {
    return this.slots.get(key)
  }

  deleteSlot(key: string): void {
    const pi = this.slots.get(key)
    if (pi) {
      this.slots.delete(key)
      this._save()
      // Graceful shutdown in background — lets pi-memory consolidate
      pi.gracefulShutdown().catch(() => {})
    }
  }

  listSlots(): SlotInfo[] {
    return Array.from(this.slots.entries()).map(([key, pi]) => {
      // Derive timestamps: created from key, updated from last message or last activity
      const keyParts = key.split('-')
      const keyMs = keyParts.length >= 3 ? parseInt(keyParts[keyParts.length - 1], 10) : Date.now()
      const createdAt = isNaN(keyMs) ? new Date().toISOString() : new Date(keyMs).toISOString()
      const lastMsg = pi.messages[pi.messages.length - 1]
      const updatedAt = lastMsg?.ts || pi._lastActivity ? new Date(Math.max(
        lastMsg?.ts ? new Date(lastMsg.ts).getTime() : 0,
        pi._lastActivity || 0
      )).toISOString() : createdAt
      return {
        key,
        title: pi._title || 'New Chat',
        messages: pi.messages.length,
        running: pi.running,
        stopping: pi._stopping || false,
        pending_approval: pi._pendingApproval || false,
        model: pi.modelId ? `${pi.modelProvider}/${pi.modelId}` : null,
        thinkingLevel: pi.thinkingLevel,
        cwd: pi.cwd || null,
        tags: pi._tags || [],
        created_at: createdAt,
        updated_at: updatedAt,
        created: createdAt,
        updated: updatedAt,
      }
    })
  }

  getSlotDetail(key: string, limit: number = 200): SlotDetail | null {
    const pi = this.slots.get(key)
    if (!pi) return null
    const msgs = pi.messages.slice(-limit)
    return {
      messages: msgs,
      running: pi.running,
      stopping: pi._stopping || false,
      pending_approval: pi._pendingApproval || false,
      has_more: pi.messages.length > limit,
      total: pi.messages.length,
      model: pi.modelId ? `${pi.modelProvider}/${pi.modelId}` : null,
      thinkingLevel: pi.thinkingLevel,
      cwd: pi.cwd || null,
      contextUsage: pi._contextUsage || null,
      tokenStats: pi._tokenStats || null,
    }
  }

  /** Get available models (cached, refreshed via any running pi process) */
  async getModels(): Promise<any[]> {
    // Cache for 5 minutes
    if (this._modelCache && Date.now() - this._modelCacheTime < 300000) {
      return this._modelCache
    }
    // Find a running pi process to query, or start a temp one
    let pi: PiSession | null = null
    for (const p of this.slots.values()) {
      if (p.alive && p.ready) { pi = p; break }
    }
    if (!pi) {
      // Start a temporary process to query models
      pi = new PiRpcSession('_temp', {})
      pi.start()
      // Wait a bit for startup
      await new Promise<void>(r => setTimeout(r, 8000))
    }
    try {
      const models = await pi.getAvailableModels()
      this._modelCache = models
      this._modelCacheTime = Date.now()
      return models
    } catch {
      return this._modelCache || []
    } finally {
      if (pi.slotKey === '_temp') pi.kill()
    }
  }

  status(): { version: string; uptime: number; sessions: number; messages: number; tool_calls: number; provider: string } {
    let totalMessages = 0
    let totalToolCalls = 0
    for (const pi of this.slots.values()) {
      totalMessages += pi.messages.length
      totalToolCalls += pi.messages.filter(m => m.role === 'tool').length
    }
    return {
      version: '1.0.0',
      uptime: Math.floor((Date.now() - this._startTime) / 1000),
      sessions: this.slots.size,
      messages: totalMessages,
      tool_calls: totalToolCalls,
      provider: 'pi',
    }
  }

  async getCommands(): Promise<any[] | null> {
    // Try to get commands from a running pi process via RPC
    for (const pi of this.slots.values()) {
      if (pi.alive && pi.ready) {
        try { return await pi.getCommands() } catch {}
      }
    }
    return null // No running process to query
  }

  _save(): void {
    if (this._onStateChange) this._onStateChange()
  }

  // Periodic health sweep. Idle-process reaping ONLY — frees RSS on slots
  // that have been !running for >30 min. Does NOT second-guess pi on
  // time-to-completion: pi has its own provider retries (settings.json
  // retry.maxRetries) and per-tool timeouts. The previous 5-min
  // stuck-turn force-abort (introduced + patched in 810cd776) produced
  // more false positives than true positives — killed legitimately slow
  // LLM turns, long single tool calls, and foreground sub-agent waits.
  // Removed in favor of letting pi own that decision.
  //
  // 2026-05-21 — idle reaper formerly DISABLED for pi-conductor compat,
  // since 30-min reaping was killing parent slots while background sub-agents
  // (`ensemble_spawn` foreground=false) were still doing real work. Witnessed
  // twice on pi-conductor v0.11 slice 2 builder runs (`builder-shzs` 22m,
  // `builder-utrr` 39m). 2026-05-28 (origin/master aa118fca): replaced the
  // disable with a 30-hour threshold so slots survive overnight without
  // being reaped — fixes the conductor problem with much less collateral.
  _healthCheck(): void {
    const now = Date.now()
    for (const pi of this.slots.values()) {
      pi.checkHealth()
      // Reap idle processes (not running a turn, idle > 30 hours)
      // 30h lets slots survive overnight without being reaped.
      if (pi.alive && !pi.running && !pi._stopping && pi._lastActivity > 0) {
        const idle = now - pi._lastActivity
        if (idle > 30 * 60 * 60 * 1000) {
          pi.emit('log', { level: 'info', msg: `Slot ${pi.slotKey}: idle ${Math.round(idle/60000)}m, gracefully stopping process` })
          pi.gracefulShutdown().then(() => { if (pi instanceof PiRpcSession) pi.proc = null })
        }
      }
    }
  }

  shutdown(): void {
    if (this._healthInterval) {
      clearInterval(this._healthInterval)
      this._healthInterval = null
    }
    for (const pi of this.slots.values()) {
      pi.kill()
    }
    this.slots.clear()
  }

  /** Graceful shutdown — gives each pi process time to consolidate memory */
  async gracefulShutdown(timeoutMs: number = 60000): Promise<void> {
    if (this._healthInterval) {
      clearInterval(this._healthInterval)
      this._healthInterval = null
    }
    // Shut down all slots in parallel, each with its own timeout
    const promises = Array.from(this.slots.values()).map(pi => pi.gracefulShutdown(timeoutMs))
    await Promise.all(promises)
    this.slots.clear()
  }
}
