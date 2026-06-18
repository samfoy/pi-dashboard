/**
 * Pi Dashboard — Express server with WebSocket
 * Bridges the React frontend to pi via RPC mode.
 *
 * This is the composition root: creates the Express app, wires middleware,
 * shared state, WebSocket handling, and delegates routes to modules.
 */
import express, { Request, Response, NextFunction } from 'express'
import WebSocket, { WebSocketServer } from 'ws'
import { createServer, IncomingMessage } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { watch as fsWatch, FSWatcher } from 'fs'
import { readFile } from 'fs/promises'
import os from 'os'
import { Duplex } from 'stream'
import { PiManager, PiProcess } from './pi-manager.js'
import { saveSlotState, saveSlotStateSync, loadSlotState, parseSessionMessages, ChatMessage } from './session-store.js'
import type { Notification } from '@shared/types.js'
import {
  registerChatRoutes,
  registerFileRoutes,
  registerSystemRoutes,
  registerSessionRoutes,
  registerJobsRoutes,
} from './routes/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PI_DASH_PORT || '7777', 10)
const DIST_DIR = join(__dirname, '..', 'frontend', 'dist')



// ─── App & Server ────────────────────────────────────────────
const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })
const manager = new PiManager()

// ─── Notifications ───────────────────────────────────────────
const notifications: Notification[] = []
const NOTIF_MAX = 200
const LONG_TOOL_THRESHOLD_MS = 60_000

function addNotification(notif: Omit<Notification, 'ts' | 'acked'>): Notification {
  const entry: Notification = { ...notif, ts: new Date().toISOString(), acked: false }
  notifications.push(entry)
  if (notifications.length > NOTIF_MAX) notifications.splice(0, notifications.length - NOTIF_MAX)
  broadcast('notification', entry)
  return entry
}

// ─── Restore persisted slots on startup ──────────────────────
const savedSlots = loadSlotState()
for (const s of savedSlots) {
  let messages: ChatMessage[] = s.messages || []
  if (s.sessionFile && !messages.length) {
    try {
      messages = parseSessionMessages(s.sessionFile, 200)
    } catch {}
  }
  if (messages.length > 0 || s.sessionFile) {
    manager.restoreSlot(s.key, s.title, messages, {
      modelProvider: s.modelProvider,
      modelId: s.modelId,
      cwd: s.cwd,
      sessionFile: s.sessionFile || null,
      tags: s.tags,
    })
  }
}
if (savedSlots.length > 0) console.log(`   Restored ${savedSlots.length} chat slot(s)`)

// ─── Auto-save slot state on changes ─────────────────────────
function persistSlots(): void { saveSlotState(manager.slots as any) }
manager._onStateChange = persistSlots

const wsClients: Set<WebSocket> = new Set()

// ─── Middleware ──────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }))

app.use('/api', (_req: Request, _res: Response, next: NextFunction) => next())

// ─── Broadcast to all WS clients ────────────────────────────
function broadcast(type: string, data: any): void {
  try {
    const msg = JSON.stringify({ type, data })
    for (const ws of wsClients) {
      try { if (ws.readyState === 1) ws.send(msg) } catch {}
    }
  } catch (e: any) {
    console.error('broadcast error:', e.message)
  }
}

function broadcastSlots(): void {
  broadcast('slots', manager.listSlots())
}

// ─── Version Store + Recent Writes (Doc Collaboration) ───────
const versionStore: Map<string, { version: number; content: string; timestamp: string }[]> = new Map()
const recentWrites: Map<string, number> = new Map()

function createVersion(filePath: string, content: string): number {
  let versions = versionStore.get(filePath)
  if (!versions) { versions = []; versionStore.set(filePath, versions) }
  const version = versions.length ? versions[versions.length - 1].version + 1 : 1
  versions.push({ version, content, timestamp: new Date().toISOString() })
  if (versions.length > 50) versions.shift()
  return version
}

// ─── File Watcher (Doc Collaboration) ────────────────────────
const fileWatchers: Map<string, { watcher: FSWatcher; debounceTimer: ReturnType<typeof setTimeout> | null; clients: Set<WebSocket> }> = new Map()

function startWatching(filePath: string, ws: WebSocket): void {
  let entry = fileWatchers.get(filePath)
  if (entry) {
    entry.clients.add(ws)
    return
  }
  const clients: Set<WebSocket> = new Set([ws])
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const watcher = fsWatch(filePath, (eventType) => {
    if (eventType === 'rename') {
      const e = fileWatchers.get(filePath)
      if (e) {
        const msg = JSON.stringify({ type: 'file_deleted', data: { path: filePath } })
        for (const c of e.clients) { if (c.readyState === 1) c.send(msg) }
        stopWatchingAll(filePath)
      }
      return
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      debounceTimer = null
      const lastWrite = recentWrites.get(filePath)
      const isSelfWrite = lastWrite && (Date.now() - lastWrite < 500)
      try {
        const content = await readFile(filePath, 'utf-8')
        const version = createVersion(filePath, content)
        if (!isSelfWrite) {
          const e = fileWatchers.get(filePath)
          if (e) {
            const msg = JSON.stringify({ type: 'file_changed', data: { path: filePath, content, version } })
            for (const c of e.clients) { if (c.readyState === 1) c.send(msg) }
          }
        }
      } catch {}
    }, 300)
  })
  watcher.on('error', () => stopWatchingAll(filePath))
  fileWatchers.set(filePath, { watcher, debounceTimer, clients })
}

function stopWatching(filePath: string, ws: WebSocket): void {
  const entry = fileWatchers.get(filePath)
  if (!entry) return
  entry.clients.delete(ws)
  if (entry.clients.size === 0) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.watcher.close()
    fileWatchers.delete(filePath)
  }
}

function stopWatchingAll(filePath: string): void {
  const entry = fileWatchers.get(filePath)
  if (!entry) return
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  entry.watcher.close()
  fileWatchers.delete(filePath)
}

function cleanupClientWatchers(ws: WebSocket): void {
  for (const filePath of [...fileWatchers.keys()]) {
    stopWatching(filePath, ws)
  }
}

// ─── Status polling (push to WS every 5s) ───────────────────
if (!process.env.VITEST) setInterval(() => broadcast('dashboard', manager.status()), 5000)

// ─── Wire pi slot events to WS ──────────────────────────────
let _chunkSeq = 0

function _wireSlotEvents(pi: PiProcess, slotKey: string): void {
  let streamBuf = ''
  let midTurn = false
  const toolStartTimes: Map<string, { startTime: number; toolName: string }> = new Map()

  let _partialTextMsg: any = null
  let _partialThinkMsg: any = null
  let _persistTimer: ReturnType<typeof setTimeout> | null = null
  const _throttledPersist = (): void => { if (!_persistTimer) _persistTimer = setTimeout(() => { _persistTimer = null; persistSlots() }, 5000) }

  let _lastEventTime = 0
  let _stallTimer: ReturnType<typeof setInterval> | null = null
  const STALL_CHECK_INTERVAL = 30_000
  const STALL_THRESHOLD = 90_000

  function _startStallDetector(): void {
    _lastEventTime = Date.now()
    if (_stallTimer) return
    _stallTimer = setInterval(() => {
      if (!midTurn) return
      const silent = Date.now() - _lastEventTime
      if (silent > STALL_THRESHOLD) {
        if (pi.checkHealth()) {
          _stopStallDetector()
          return
        }
        broadcast('heartbeat', { slot: slotKey, stallMs: silent })
      }
    }, STALL_CHECK_INTERVAL)
  }

  function _stopStallDetector(): void {
    if (_stallTimer) { clearInterval(_stallTimer); _stallTimer = null }
  }

  // ─── Session stats (token/context/cost) ───────────────────────────────────
  // pi only exposes cumulative stats via get_session_stats, so we query it
  // both at turn end AND on a poll while a turn is running — otherwise the
  // telemetry chips (tok/cache/ctx/cost) stay empty until the turn finishes.
  let _statsTimer: ReturnType<typeof setInterval> | null = null
  const STATS_POLL_INTERVAL = 4000

  function _fetchStats(requireMidTurn = false): void {
    pi.request({ type: 'get_session_stats' }, 5000).then((resp: any) => {
      // Drop a late poll response that resolved after the turn ended, so it
      // can't race the chat_done per-turn delta annotation.
      if (requireMidTurn && !midTurn) return
      const cu = resp?.data?.contextUsage
      if (cu) {
        pi._contextUsage = { tokens: cu.tokens, contextWindow: cu.contextWindow, percent: cu.percent }
        broadcast('context_usage', { slot: slotKey, ...pi._contextUsage })
      }
      const data = resp?.data
      if (data) {
        const tokenStats = {
          totalInputTokens: data.tokens?.input || 0,
          totalOutputTokens: data.tokens?.output || 0,
          totalTokens: data.tokens?.total || 0,
          totalCost: data.cost || 0,
          cacheReadTokens: data.tokens?.cacheRead || 0,
          cacheWriteTokens: data.tokens?.cacheWrite || 0,
        }
        pi._tokenStats = tokenStats
        broadcast('token_stats', { slot: slotKey, ...tokenStats })
      }
    }).catch(() => {})
  }

  function _startStatsPoller(): void {
    if (_statsTimer) return
    _statsTimer = setInterval(() => { if (midTurn) _fetchStats(true) }, STATS_POLL_INTERVAL)
  }

  function _stopStatsPoller(): void {
    if (_statsTimer) { clearInterval(_statsTimer); _statsTimer = null }
  }

  if (typeof pi.emit === 'function') {
    const origEmit = pi.emit.bind(pi)
    pi.emit = function(event: string | symbol, ...args: any[]): boolean {
      if (midTurn) _lastEventTime = Date.now()
      return origEmit(event, ...args)
    }
  }

  pi.on('message_update', ({ event, delta }: any) => {
    if (delta.type === 'text_delta') {
      streamBuf += delta.delta
      _turnChars += delta.delta.length
      if (!_partialTextMsg) {
        _partialTextMsg = { role: 'assistant', content: delta.delta, ts: new Date().toISOString(), _partial: true }
        pi.messages.push(_partialTextMsg)
      } else {
        _partialTextMsg.content += delta.delta
      }
      _throttledPersist()
      broadcast('chat_chunk', {
        slot: slotKey,
        content: delta.delta,
        seq: _chunkSeq++,
      })
    }
  })

  let thinkingBuf = ''
  pi.on('thinking_update', ({ delta }: any) => {
    thinkingBuf += delta
    _turnThinking += delta.length
    if (!_partialThinkMsg) {
      _partialThinkMsg = { role: 'thinking', content: delta, ts: new Date().toISOString(), _partial: true }
      pi.messages.push(_partialThinkMsg)
    } else {
      _partialThinkMsg.content += delta
    }
  })

  pi.on('message_update', ({ event, delta: _d }: any) => {
    if (event?.assistantMessageEvent?.type === 'thinking_end' && thinkingBuf) {
      if (_partialThinkMsg) _partialThinkMsg._partial = false
      _partialThinkMsg = null
      broadcast('chat_message', {
        slot: slotKey,
        role: 'thinking',
        content: thinkingBuf,
        ts: new Date().toISOString(),
      })
      thinkingBuf = ''
    }
  })

  let agentStartTime = 0
  // Truncation canary — detects provider-side stream failures (e.g.
  // amazon-claude-code / bedrock-converse-stream sometimes returns empty
  // streams with stopReason='stop' and 0 tokens, leaving the slot looking
  // idle with no reply). Track per-turn evidence of actual model activity;
  // warn at agent_end if the turn produced nothing.
  let _turnChars = 0
  let _turnTools = 0
  let _turnThinking = 0

  pi.on('agent_start', () => {
    agentStartTime = Date.now()
    midTurn = true
    _turnChars = 0
    _turnTools = 0
    _turnThinking = 0
    console.log(`[server] agent_start slot=${slotKey}`)
    _startStallDetector()
    _startStatsPoller()
    broadcastSlots()
  })

  pi.on('agent_end', () => {
    const dur = agentStartTime ? Date.now() - agentStartTime : 0
    console.log(`[server] agent_end slot=${slotKey} duration=${dur}ms midTurn=${midTurn} chars=${_turnChars} tools=${_turnTools} thinking=${_turnThinking}`)
    // Empty/truncated turn detection. If the turn produced no tool calls,
    // no thinking, and no text in < 10s, the provider almost certainly returned
    // a degenerate stream (witnessed: amazon-claude-code Opus 4.7 returning
    // empty stream with stopReason=stop, 0 tokens). Surface a visible warning
    // so the user knows their slot did not actually just respond with nothing.
    if (midTurn && _turnTools === 0 && _turnThinking === 0 && _turnChars === 0 && dur < 10_000) {
      const warnMsg = '⚠️ Provider returned an empty stream (' + _turnChars + ' chars, 0 tools, ' + dur + 'ms). Likely upstream instability — try resending, or switch the slot model.'
      console.error(`[server] TRUNCATED TURN slot=${slotKey} duration=${dur}ms chars=${_turnChars}`)
      broadcast('chat_message', {
        slot: slotKey,
        role: 'system',
        content: warnMsg,
        ts: new Date().toISOString(),
      })
    }
    midTurn = false
    pi._toolsRunning = 0
    _stopStallDetector()
    _stopStatsPoller()
    streamBuf = ''
    _partialTextMsg = null
    _partialThinkMsg = null
    broadcast('chat_done', { slot: slotKey })
    broadcastSlots()
    persistSlots()

    _fetchStats()

    pi.request({ type: 'get_state' }, 5000).then((resp: any) => {
      const name = resp?.data?.sessionName
      if (name && name !== pi._title && !pi._userRenamed) {
        pi._title = name
        broadcast('slot_title', { key: slotKey, title: name })
        broadcastSlots()
        persistSlots()
      }
    }).catch(() => {})

    const elapsed = Date.now() - agentStartTime
    if (agentStartTime && elapsed >= 60_000) {
      const secs = Math.round(elapsed / 1000)
      const slotTitle = pi._title || slotKey
      addNotification({
        kind: 'input_needed',
        title: `Done (${secs}s)`,
        body: slotTitle,
        slot: slotKey,
      })
    }
    agentStartTime = 0
  })

  pi.on('tool_start', ({ toolName, toolCallId, args }: any) => {
    pi._toolsRunning++
    toolStartTimes.set(toolCallId, { startTime: Date.now(), toolName })
    if (_partialTextMsg) { _partialTextMsg._partial = false; _partialTextMsg = null }
    pi.messages.push({ role: 'tool', content: `🔧 ${toolName}`, ts: new Date().toISOString(), _partial: true, meta: { toolName, toolCallId, args: typeof args === 'string' ? args : JSON.stringify(args || {}, null, 2) } })
    broadcast('tool_call', { slot: slotKey, tool: toolName, id: toolCallId, args })
    _turnTools++
  })

  pi.on('tool_update', (event: any) => {
    // pi-coding-agent's ToolExecutionUpdateEvent uses `partialResult`,
    // but tool_execution_end uses `result` — keep the historical fallback
    // to `event.result` so we don't regress if the upstream shape shifts.
    const structured = event.partialResult ?? event.result
    const partialText = (structured?.content?.[0]?.text || '').slice(0, 5000)
    const partialDetails = (structured?.details && typeof structured.details === 'object')
      ? structured.details as Record<string, unknown>
      : undefined
    for (let i = pi.messages.length - 1; i >= 0; i--) {
      const m = pi.messages[i]
      if (m.role === 'tool' && m.meta?.toolCallId === event.toolCallId) {
        m.meta = { ...m.meta, partialResult: partialText, partialDetails }
        break
      }
    }
    broadcast('tool_update', {
      slot: slotKey,
      tool: event.toolName,
      id: event.toolCallId,
      partial: partialText,
      partialDetails,
    })
  })

  pi.on('tool_end', (event: any) => {
    if (pi._toolsRunning > 0) pi._toolsRunning--
    const result = event.result?.content?.[0]?.text || ''
    for (let i = pi.messages.length - 1; i >= 0; i--) {
      const m = pi.messages[i]
      if (m.role === 'tool' && m.meta?.toolCallId === event.toolCallId) {
        m.meta = { ...m.meta, result: result.slice(0, 5000), isError: event.isError || false }
        m._partial = false
        break
      }
    }
    broadcast('tool_result', {
      slot: slotKey,
      tool: event.toolName,
      id: event.toolCallId,
      result: result.slice(0, 5000),
      isError: event.isError || false,
    })
    _throttledPersist()

    const started = toolStartTimes.get(event.toolCallId)
    toolStartTimes.delete(event.toolCallId)
    if (started) {
      const elapsed = Date.now() - started.startTime
      if (elapsed >= LONG_TOOL_THRESHOLD_MS && started.toolName !== 'bash') {
        const secs = Math.round(elapsed / 1000)
        const slotTitle = pi._title || slotKey
        addNotification({
          kind: 'tool_done',
          title: `${started.toolName} finished (${secs}s)`,
          body: `${slotTitle}`,
          slot: slotKey,
        })
      }
    }
  })

  pi.on('message_end', (event: any) => {
    if (event.message?.role === 'custom') {
      const m = event.message
      const ts = m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString()
      const label = m.customType ? `[${m.customType}]` : '[custom]'
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      broadcast('chat_message', {
        slot: slotKey,
        role: 'system',
        content: `${label} ${text}`,
        ts,
        meta: { customType: m.customType },
      })
      _throttledPersist()

      const TURN_TRIGGER_TYPES = ['subagent-result', 'ad-process:update']
      if (!midTurn && TURN_TRIGGER_TYPES.includes(m.customType)) {
        setTimeout(() => {
          if (!midTurn && pi.proc && !pi.proc.killed && pi.proc.exitCode === null) {
            const hint = m.customType === 'subagent-result'
              ? 'The above subagent result was just injected. React to it and continue your work.'
              : 'The above process update was just injected. React to it and continue your work.'
            pi.running = true
            pi.messages.push({ role: 'user', content: hint, ts: new Date().toISOString(), meta: { autoTrigger: true } })
            pi.send({ type: 'prompt', message: hint })
          }
        }, 500)
      }
    }
  })

  pi.on('extension_ui', (event: any) => {
    // Dashboard cannot render extension dialogs. Auto-cancel any
    // request that requires a response so the extension's init/runtime
    // can proceed via its `defaultValue` instead of waiting forever.
    //
    // Why not auto-confirm or auto-select-first? Many extensions emit
    // these dialogs from their startup path (pi-computer-use was the
    // first to expose this) and the "first option" is often something
    // destructive or a no-op like "Open Settings" that loops back to
    // the same dialog — wedging every dashboard slot. `cancelled: true`
    // matches what `ctx.ui.*` resolves to when the user dismisses the
    // dialog in TUI/print mode, which is the behavior extensions are
    // already coded against.
    if (event.method === 'confirm' || event.method === 'select' ||
        event.method === 'input' || event.method === 'editor') {
      pi.send({ type: 'extension_ui_response', id: event.id, cancelled: true })
    } else if (event.method === 'setStatus') {
      const clean = (event.statusText || '').replace(/\x1b\[[0-9;]*m/g, '')
      broadcast('extension_status', { slot: slotKey, key: event.statusKey, text: clean || undefined })
    } else if (event.method === 'setWidget') {
      broadcast('extension_widget', { slot: slotKey, key: event.widgetKey, lines: event.lines })
    }
    // notify, setTitle, set_editor_text, etc. are fire-and-forget
    // (no response needed) and not displayed in this dashboard yet.
  })

  pi.on('log', (data: any) => {
    for (const ws of wsClients) {
      if ((ws as any)._subscribedLogs && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'log', data }))
      }
    }
  })

  pi.on('extension_error', (event: any) => {
    const msg = `[extension_error] ${event.event}: ${event.error}`
    console.warn(`[pi-manager] Extension error in slot ${slotKey}: ${event.event} — ${event.error}`)
    for (const ws of wsClients) {
      if ((ws as any)._subscribedLogs && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'log', data: { level: 'error', msg } }))
      }
    }
  })

  pi.on('slash_result', ({ content }: any) => {
    broadcast('chat_message', {
      slot: slotKey,
      role: 'assistant',
      content,
      ts: new Date().toISOString(),
    })
  })

  // Surface prompt-failure responses to the FE. Without this, a pi-side
  // prompt rejection (provider error, rate limit, no API key, malformed
  // command) only pushes a system message into pi-manager's internal
  // array and emits agent_end — the user sees their message followed
  // by silent chat_done with no assistant reply.
  pi.on('prompt_failed', ({ error }: any) => {
    console.error(`[server] prompt_failed slot=${slotKey}: ${error}`)
    broadcast('chat_message', {
      slot: slotKey,
      role: 'system',
      content: `⚠️ ${error || 'Prompt failed'}`,
      ts: new Date().toISOString(),
    })
  })

  pi.on('session_file', () => persistSlots())

  pi.on('model_change', () => {
    persistSlots()
    broadcastSlots()
  })

  pi.on('error', (err: any) => {
    if (midTurn) {
      console.error(`[pi-manager] Slot ${slotKey} mid-turn error:`, err?.message || err)
      midTurn = false
      _stopStallDetector()
      _stopStatsPoller()
      streamBuf = ''
      _partialTextMsg = null
      _partialThinkMsg = null
      broadcast('chat_error', {
        slot: slotKey,
        message: `Pi process error: ${err?.message || String(err)}`,
      })
      broadcastSlots()
      persistSlots()
    }
  })

  pi.on('exit', (code: number | null) => {
    _stopStallDetector()
    _stopStatsPoller()
    if (midTurn) {
      console.error(`[pi-manager] Slot ${slotKey} exited mid-turn (code=${code}) — broadcasting chat_error`)
      midTurn = false
      streamBuf = ''
      _partialTextMsg = null
      _partialThinkMsg = null
      const stderr = (pi as any)._stderrLines?.slice(-5)?.join('\n') || ''
      const detail = `Exit code: ${code}${stderr ? '\n' + stderr : ''}`
      broadcast('chat_error', {
        slot: slotKey,
        message: `Pi process exited unexpectedly during generation.\n${detail}`,
      })
    } else {
      broadcast('chat_done', { slot: slotKey })
    }
    broadcastSlots()
  })

  pi.on('startup_error', ({ code, stderr }: { code: number; stderr: string }) => {
    const errorMsg: ChatMessage = {
      role: 'system' as const,
      content: `⚠️ Pi process crashed at startup (exit code ${code}).\n\n${stderr ? '```\n' + stderr + '\n```' : 'No error output captured.'}`,
      ts: new Date().toISOString(),
    }
    pi.messages.push(errorMsg)
    broadcast('startup_error', {
      slot: slotKey,
      message: errorMsg,
    })
    broadcastSlots()
    persistSlots()
  })
}

// ─── Register route modules ─────────────────────────────────
const routeDeps = {
  app,
  manager,
  broadcast,
  broadcastSlots,
  persistSlots,
  wsClients,
  notifications,
  addNotification,
  wireSlotEvents: _wireSlotEvents,
  versionStore,
  recentWrites,
  createVersion,
  fileWatchers,
  startWatching,
  stopWatching,
  cleanupClientWatchers,
}

registerChatRoutes(routeDeps)
registerFileRoutes(routeDeps)
registerSystemRoutes(routeDeps)
registerSessionRoutes(routeDeps)
registerJobsRoutes(routeDeps)

// ─── Static files ────────────────────────────────────────────
app.use(express.static(DIST_DIR))
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(join(DIST_DIR, 'index.html'))
})

// ─── WebSocket ───────────────────────────────────────────────
server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  console.log('  WS upgrade:', req.url)

  const wsPath = (req.url || '').split('?')[0]
  if (wsPath === '/api/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

let _wsIdCounter = 0
wss.on('connection', (ws: WebSocket) => {
  (ws as any)._id = ++_wsIdCounter
  wsClients.add(ws)
  console.log(`[ws] Client #${(ws as any)._id} connected (total: ${wsClients.size})`)
  ws.send(JSON.stringify({ type: 'dashboard', data: manager.status() }))
  ws.send(JSON.stringify({ type: 'slots', data: manager.listSlots() }))

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'subscribe_logs') (ws as any)._subscribedLogs = true
      if (msg.type === 'unsubscribe_logs') (ws as any)._subscribedLogs = false
      if (msg.type === 'watch_file' && msg.path) startWatching(msg.path, ws)
      if (msg.type === 'unwatch_file' && msg.path) stopWatching(msg.path, ws)
    } catch { /* ignore */ }
  })

  ws.on('close', () => {
    console.log(`[ws] Client #${(ws as any)._id} disconnected (remaining: ${wsClients.size - 1})`)
    cleanupClientWatchers(ws)
    wsClients.delete(ws)
  })
})

// ── Export for testing ──
export { app, server }

// ── Start ──
const hostname = os.hostname()
const BIND_HOST = process.env.PI_DASH_HOST || '0.0.0.0'
if (!process.env.VITEST) server.listen(PORT, BIND_HOST, () => {
  console.log(`\n🥧 Pi Dashboard`)
  console.log(`   Local:    http://localhost:${PORT}`)
  console.log(`   Network:  http://${hostname}:${PORT}`)
  console.log(`   Custom:   http://pi.dash:${PORT}`)
  if (process.env.TAILSCALE_IP) console.log(`   Tailscale: http://${process.env.TAILSCALE_IP}:${PORT}`)
  console.log()
})

process.on('SIGINT', () => {
  saveSlotStateSync(manager.slots as any)
  manager.gracefulShutdown(55000).finally(() => { process.exit(0) })
  setTimeout(() => { process.exit(0) }, 60000).unref()
})
process.on('SIGTERM', () => {
  saveSlotStateSync(manager.slots as any)
  manager.gracefulShutdown(55000).finally(() => { process.exit(0) })
  setTimeout(() => { process.exit(0) }, 60000).unref()
})
process.on('uncaughtException', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} already in use — exiting so systemd can retry`)
    process.exit(1)
  }
  console.error('⚠ Uncaught exception (kept running):', err.message)
  console.error(err.stack)
})
process.on('unhandledRejection', (reason) => {
  console.error('⚠ Unhandled rejection (kept running):', reason)
})
