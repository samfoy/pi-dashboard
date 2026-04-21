/**
 * Pi RPC Process Manager
 * Spawns and manages `pi --mode rpc` processes, one per chat slot.
 */
import { spawn, execSync } from 'child_process'
import { EventEmitter } from 'events'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { extractText } from './session-store.js'

// Resolve pi binary path at startup (avoids ENOENT in launchd)
const PI_BIN = (() => {
  try { return execSync('which pi', { encoding: 'utf-8' }).trim() } catch {}
  // Fallback to common locations
  const candidates = ['/opt/homebrew/bin/pi', '/usr/local/bin/pi']
  for (const c of candidates) {
    try { execSync(`test -x ${c}`); return c } catch {}
  }
  return 'pi' // last resort — rely on PATH
})()

const IMAGE_DIR = join(os.tmpdir(), 'pi-dashboard-images')
mkdirSync(IMAGE_DIR, { recursive: true })

function saveImagesToTemp(images) {
  return images.map((img, i) => {
    const ext = (img.mimeType || 'image/png').split('/')[1] || 'png'
    const name = `img-${Date.now()}-${i}.${ext}`
    const filePath = join(IMAGE_DIR, name)
    writeFileSync(filePath, Buffer.from(img.data, 'base64'))
    return filePath
  })
}

/**
 * Normalize image payloads to pi's expected format:
 *   { type: "image", mimeType: "image/jpeg", data: "<base64>" }
 * Accepts various input formats from web frontend or iOS app.
 */
function normalizeImages(images) {
  if (!images?.length) return undefined
  return images.map(img => ({
    type: 'image',
    mimeType: img.mimeType || img.media_type || 'image/png',
    data: img.data || img.source?.data || '',
  })).filter(img => img.data)
}

export class PiProcess extends EventEmitter {
  constructor(slotKey, opts = {}) {
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
    this._title = opts.title || null
    this._userRenamed = false  // true if user manually renamed
    this._startTime = Date.now()
    this._lastActivity = 0  // 0 = never; updated on actual activity
    this._pendingRequests = new Map() // id → { resolve, timer }
    this._stopping = false
    this._pendingApproval = false
    this._streamIdx = -1  // index where partial streaming messages start
    this._stderrLines = []
    this._startupTimer = null
  }

  start() {
    if (!this.cwd) this.cwd = process.env.HOME || '/tmp'
    const args = ['--mode', 'rpc']
    if (this.sessionFile) {
      args.push('--session', this.sessionFile)
    }
    if (this.agent) {
      args.push('--agent', this.agent)
    }
    if (this.modelProvider && this.modelId) {
      args.push('--model', `${this.modelProvider}/${this.modelId}`)
    }

    const spawnOpts = {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PI_RUNTIME: 'dashboard', PI_DASH_PORT: String(process.env.PI_DASH_PORT || 7777) },
    }
    if (this.cwd) spawnOpts.cwd = this.cwd

    this.proc = spawn(PI_BIN, args, spawnOpts)

    // Ready promise — resolves when pi responds to get_state (templates loaded)
    this._readyPromise = this.request({ type: 'get_state' }, 15000).then(resp => {
      if (resp?.data?.sessionFile) {
        this.sessionFile = resp.data.sessionFile
        this.emit('session_file', this.sessionFile)
      }
    }).catch(() => {})

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString()
      let nl
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

    this.proc.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim()
      if (text) {
        this._stderrLines.push(text)
        if (this._stderrLines.length > 20) this._stderrLines.shift()
        this.emit('log', { level: 'warn', msg: text })
      }
    })

    this.proc.on('exit', (code) => {
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
      this.emit('exit', code)
    })

    this.proc.on('error', (err) => {
      this.emit('error', err)
    })

    // Detect early crash (within first 5s = likely extension/startup failure)
    this._startupTimer = setTimeout(() => { this._startupTimer = null }, 5000)

    this.ready = true
  }

  send(cmd) {
    if (!this.proc || this.proc.killed || this.proc.exitCode !== null || !this.proc.stdin.writable) {
      // Process is dead — reset state
      if (this.running || this._stopping) {
        this.running = false
        this._stopping = false
        this._pendingApproval = false
        this.emit('agent_end', { messages: [] })
      }
      return false
    }
    this.proc.stdin.write(JSON.stringify(cmd) + '\n')
    return true
  }

  /** Send a command and wait for the response by id */
  request(cmd, timeoutMs = 30000) {
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

  async prompt(message, images) {
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

      const RPC_MAP = {
        'compact': { type: 'compact' },
        'new': { type: 'new_session' },
        'clear': { type: 'new_session' },
        'fork': { type: 'fork' },
        'export': { type: 'export_html', path: args || undefined },
        'name': { type: 'set_session_name', name: args || 'New Chat' },
        'reload': { type: 'reload' },
      }

      // Commands that return data — use request() and emit result as a message
      const DATA_CMDS = {
        'session': { type: 'get_session_stats' },
        'copy': { type: 'get_last_assistant_text' },
        'usage': { type: 'get_session_stats' },
        'tools': { type: 'get_commands' },
      }

      if (DATA_CMDS[cmd]) {
        this.request(DATA_CMDS[cmd]).then(resp => {
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
      this.running = true
      this.messages.push({ role: 'user', content: message, ts: new Date().toISOString() })
      const promptCmd = { type: 'prompt', message }
      if (normalizedImages?.length) {
        const paths = saveImagesToTemp(normalizedImages)
        promptCmd.images = normalizedImages
        promptCmd.message += `\n\n[Images saved to disk: ${paths.join(', ')}]`
      }
      return this.send(promptCmd)
    }

    // Regular message
    let msg = message
    const cmd = { type: 'prompt' }
    if (normalizedImages?.length) {
      const paths = saveImagesToTemp(normalizedImages)
      cmd.images = normalizedImages
      msg += `\n\n[Images saved to disk: ${paths.join(', ')}]`
    }
    cmd.message = msg
    if (this.running) {
      cmd.streamingBehavior = 'followUp'
    }
    this.running = true
    this.messages.push({ role: 'user', content: message, ts: new Date().toISOString() })
    return this.send(cmd)
  }

  abort() {
    this._stopping = true
    // If process is already dead, reset state immediately
    if (!this.proc || this.proc.killed || this.proc.exitCode !== null) {
      this.running = false
      this._stopping = false
      this._pendingApproval = false
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

  async getAvailableModels() {
    const resp = await this.request({ type: 'get_available_models' })
    return resp?.data?.models || []
  }

  async getCommands() {
    const resp = await this.request({ type: 'get_commands' })
    return resp?.data?.commands || []
  }

  async setModel(provider, modelId) {
    return this.request({ type: 'set_model', provider, modelId })
  }

  async setThinkingLevel(level) {
    return this.request({ type: 'set_thinking_level', level })
  }

  async getState() {
    return this.request({ type: 'get_state' })
  }

  kill() {
    if (this.proc) {
      this.proc.kill('SIGTERM')
      setTimeout(() => {
        if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL')
      }, 3000)
    }
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
   * @returns {boolean} true if a stale state was detected and fixed
   */
  checkHealth() {
    if (!this.proc) return false
    const dead = this.proc.killed || this.proc.exitCode !== null
    if (dead && (this.running || this._stopping)) {
      this.running = false
      this._stopping = false
      this._pendingApproval = false
      if (this._stoppingTimer) { clearTimeout(this._stoppingTimer); this._stoppingTimer = null }
      this.emit('agent_end', { messages: [] })
      this.emit('log', { level: 'warn', msg: `Slot ${this.slotKey}: health check found dead process, reset state` })
      return true
    }
    return false
  }

  _handleEvent(event) {
    const { type } = event

    // Handle responses to tracked requests
    if (type === 'response' && event.id && this._pendingRequests.has(event.id)) {
      const { resolve, timer } = this._pendingRequests.get(event.id)
      clearTimeout(timer)
      this._pendingRequests.delete(event.id)
      resolve(event)
      return
    }

    switch (type) {
      case 'response':
        this.emit('response', event)
        break

      case 'agent_start':
        this.running = true
        this._stopping = false
        this._pendingApproval = false
        this._streamIdx = this.messages.length  // mark where partials will go
        this.emit('agent_start', event)
        break

      case 'agent_end':
        this.running = false
        this._stopping = false
        this._pendingApproval = false
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
              this.messages.push({ role: 'system', content: `${label} ${text}`, ts, meta: { customType: m.customType } })
            } else if (m.role === 'toolResult') {
              // Attach result to the matching tool message
              const toolMsg = [...this.messages].reverse().find(
                msg => msg.role === 'tool' && msg.meta?.toolCallId === m.toolCallId
              )
              if (toolMsg) {
                let resultText = ''
                if (Array.isArray(m.content)) {
                  const textParts = m.content.filter(c => c.type === 'text').map(c => c.text)
                  const imageParts = m.content.filter(c => c.type === 'image' && c.source?.type === 'base64')
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
          this.messages.push({ role: 'system', content: `${label} ${text}`, ts, meta: { customType: m.customType } })
        }
        this.emit(type, event)
        break

      case 'tool_execution_start':
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
        this.emit('extension_ui', event)
        break

      default:
        this.emit('event', event)
    }
  }

}

export class PiManager {
  constructor() {
    /** @type {Map<string, PiProcess>} */
    this.slots = new Map()
    this._slotCounter = 0
    this._startTime = Date.now()
    this._onStateChange = null
    this._modelCache = null
    this._modelCacheTime = 0
    // Health check every 5s — detect dead processes with stale running/stopping state
    this._healthInterval = setInterval(() => this._healthCheck(), 5000)
  }

  createSlot(name, agent, opts = {}) {
    const key = opts.key || `chat-${++this._slotCounter}-${Date.now()}`
    const pi = new PiProcess(key, { agent, ...opts })
    // Don't start pi process yet — defer to first message (ensureRunning)
    // This allows CWD/model to be changed in WelcomeView before process starts
    this.slots.set(key, pi)
    this._save()
    return { key, title: name || pi._title || 'New Chat', messages: pi.messages.length, running: false }
  }

  restoreSlot(key, title, messages, opts = {}) {
    const pi = new PiProcess(key, { messages, title, ...opts })
    pi.ready = false
    this.slots.set(key, pi)
    if (parseInt(key.split('-')[1]) >= this._slotCounter) {
      this._slotCounter = parseInt(key.split('-')[1]) + 1
    }
  }

  ensureRunning(key) {
    const pi = this.slots.get(key)
    if (!pi) return null
    // Restart if process is missing or dead
    if (!pi.proc || pi.proc.killed || pi.proc.exitCode !== null) {
      pi.proc = null
      pi.running = false
      pi._stopping = false
      pi._pendingApproval = false
      pi.start()
    }
    return pi
  }

  getSlot(key) {
    return this.slots.get(key)
  }

  deleteSlot(key) {
    const pi = this.slots.get(key)
    if (pi) {
      pi.kill()
      this.slots.delete(key)
      this._save()
    }
  }

  listSlots() {
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
        cwd: pi.cwd || null,
        created_at: createdAt,
        updated_at: updatedAt,
      }
    })
  }

  getSlotDetail(key, limit = 200) {
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
      cwd: pi.cwd || null,
      contextUsage: pi._contextUsage || null,
    }
  }

  /** Get available models (cached, refreshed via any running pi process) */
  async getModels() {
    // Cache for 5 minutes
    if (this._modelCache && Date.now() - this._modelCacheTime < 300000) {
      return this._modelCache
    }
    // Find a running pi process to query, or start a temp one
    let pi = null
    for (const p of this.slots.values()) {
      if (p.proc && p.ready) { pi = p; break }
    }
    if (!pi) {
      // Start a temporary process to query models
      pi = new PiProcess('_temp', {})
      pi.start()
      // Wait a bit for startup
      await new Promise(r => setTimeout(r, 8000))
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

  status() {
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

  async getCommands() {
    // Try to get commands from a running pi process via RPC
    for (const pi of this.slots.values()) {
      if (pi.proc && pi.ready) {
        try { return await pi.getCommands() } catch {}
      }
    }
    return null // No running process to query
  }

  _save() {
    if (this._onStateChange) this._onStateChange()
  }

  _healthCheck() {
    const now = Date.now()
    for (const pi of this.slots.values()) {
      pi.checkHealth()
      // Reap idle processes (not running a turn, idle > 10 minutes)
      if (pi.proc && !pi.running && !pi._stopping && pi._lastActivity > 0) {
        const idle = now - pi._lastActivity
        if (idle > 30 * 60 * 1000) {
          pi.emit('log', { level: 'info', msg: `Slot ${pi.slotKey}: idle ${Math.round(idle/60000)}m, stopping process` })
          pi.kill()
          pi.proc = null
        }
      }
    }
  }

  shutdown() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval)
      this._healthInterval = null
    }
    for (const pi of this.slots.values()) {
      pi.kill()
    }
    this.slots.clear()
  }
}
