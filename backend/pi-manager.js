/**
 * Pi RPC Process Manager
 * Spawns and manages `pi --mode rpc` processes, one per chat slot.
 */
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { extractText } from './session-store.js'

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
    this._startTime = Date.now()
    this._pendingRequests = new Map() // id → { resolve, timer }
    this._stopping = false
    this._pendingApproval = false
    this._streamIdx = -1  // index where partial streaming messages start
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

    this.proc = spawn('pi', args, spawnOpts)

    // Capture session file path after startup
    this._sessionFileTimer = setTimeout(() => {
      this.request({ type: 'get_state' }, 10000).then(resp => {
        if (resp?.data?.sessionFile) {
          this.sessionFile = resp.data.sessionFile
          this.emit('session_file', this.sessionFile)
        }
      }).catch(() => {})
    }, 2000)

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
      if (text) this.emit('log', { level: 'warn', msg: text })
    })

    this.proc.on('exit', (code) => {
      this.ready = false
      this.running = false
      this._stopping = false
      this._pendingApproval = false
      this.emit('exit', code)
    })

    this.proc.on('error', (err) => {
      this.emit('error', err)
    })

    this.ready = true
  }

  send(cmd) {
    if (!this.proc || !this.proc.stdin.writable) return false
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

  prompt(message, images) {
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
      const promptCmd = { type: 'prompt', message }
      if (images?.length) promptCmd.images = images
      return this.send(promptCmd)
    }

    // Regular message
    const cmd = { type: 'prompt', message }
    if (images?.length) cmd.images = images
    if (this.running) {
      cmd.streamingBehavior = 'followUp'
    }
    this.running = true
    this.messages.push({ role: 'user', content: message, ts: new Date().toISOString() })
    return this.send(cmd)
  }

  abort() {
    this._stopping = true
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
            } else if (m.role === 'toolResult') {
              // Attach result to the matching tool message
              const toolMsg = [...this.messages].reverse().find(
                msg => msg.role === 'tool' && msg.meta?.toolCallId === m.toolCallId
              )
              if (toolMsg) {
                const resultText = Array.isArray(m.content)
                  ? m.content.filter(c => c.type === 'text').map(c => c.text).join('')
                  : ''
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
    if (!pi.proc) pi.start()
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
    return Array.from(this.slots.entries()).map(([key, pi]) => ({
      key,
      title: pi._title || 'New Chat',
      messages: pi.messages.length,
      running: pi.running,
      stopping: pi._stopping || false,
      pending_approval: pi._pendingApproval || false,
      model: pi.modelId ? `${pi.modelProvider}/${pi.modelId}` : null,
      cwd: pi.cwd || null,
    }))
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

  shutdown() {
    for (const pi of this.slots.values()) {
      pi.kill()
    }
    this.slots.clear()
  }
}
