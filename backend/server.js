/**
 * Pi Dashboard — Express server with WebSocket
 * Bridges the React frontend to pi via RPC mode.
 */
import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join, basename } from 'path'
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, watch as fsWatch } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import os from 'os'
import { execSync } from 'child_process'
import { PiManager } from './pi-manager.js'
import { handlePtyConnection, shutdownAll as shutdownPty } from './pty-manager.js'
import * as piEnv from './pi-env.js'
import { saveSlotState, loadSlotState, findSessionFile, parseSessionMessages, parseSessionTree } from './session-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PI_DASH_PORT || '7777', 10)
const DIST_DIR = join(__dirname, '..', 'frontend', 'dist')

// ── Notifications ──
/** @type {{ kind: string; title: string; body: string; ts: string; acked: boolean; slot?: string }[]} */
const notifications = []
const NOTIF_MAX = 200
const LONG_TOOL_THRESHOLD_MS = 60_000 // 60 seconds

function addNotification(notif) {
  const entry = { ...notif, ts: new Date().toISOString(), acked: false }
  notifications.push(entry)
  if (notifications.length > NOTIF_MAX) notifications.splice(0, notifications.length - NOTIF_MAX)
  broadcast('notification', entry)
  return entry
}

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })
const manager = new PiManager()

// ── Restore persisted slots on startup ──
const savedSlots = loadSlotState()
for (const s of savedSlots) {
  if (s.messages?.length > 0) {
    manager.restoreSlot(s.key, s.title, s.messages, {
      modelProvider: s.modelProvider,
      modelId: s.modelId,
      cwd: s.cwd,
      sessionFile: s.sessionFile || null,
    })
  }
}
if (savedSlots.length > 0) console.log(`   Restored ${savedSlots.length} chat slot(s)`)

// ── Auto-save slot state on changes ──
function persistSlots() { saveSlotState(manager.slots) }
manager._onStateChange = persistSlots

/** @type {Set<import('ws').WebSocket>} */
const wsClients = new Set()

// ── Middleware ──
app.use(express.json({ limit: '50mb' }))

// ── Broadcast to all WS clients ──
function broadcast(type, data) {
  try {
    const msg = JSON.stringify({ type, data })
    for (const ws of wsClients) {
      try { if (ws.readyState === 1) ws.send(msg) } catch {}
    }
  } catch (e) {
    console.error('broadcast error:', e.message)
  }
}

function broadcastSlots() {
  broadcast('slots', manager.listSlots())
}

// ── Version Store + Recent Writes (Doc Collaboration) ──
const versionStore = new Map() // Map<path, {version,content,timestamp}[]>
const recentWrites = new Map() // Map<path, timestamp> for self-write suppression

function createVersion(filePath, content) {
  let versions = versionStore.get(filePath)
  if (!versions) { versions = []; versionStore.set(filePath, versions) }
  const version = versions.length ? versions[versions.length - 1].version + 1 : 1
  versions.push({ version, content, timestamp: new Date().toISOString() })
  if (versions.length > 50) versions.shift()
  return version
}

// ── File Watcher (Doc Collaboration) ──
// Map<path, { watcher: FSWatcher, debounceTimer: Timeout|null, clients: Set<ws> }>
const fileWatchers = new Map()

function startWatching(filePath, ws) {
  let entry = fileWatchers.get(filePath)
  if (entry) {
    entry.clients.add(ws)
    return
  }
  const clients = new Set([ws])
  let debounceTimer = null
  const watcher = fsWatch(filePath, (eventType) => {
    if (eventType === 'rename') {
      // File deleted or renamed
      const e = fileWatchers.get(filePath)
      if (e) {
        const msg = JSON.stringify({ type: 'file_deleted', data: { path: filePath } })
        for (const c of e.clients) { if (c.readyState === 1) c.send(msg) }
        stopWatchingAll(filePath)
      }
      return
    }
    // Debounce rapid changes
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
      } catch {
        // File may have been deleted between event and read
      }
    }, 300)
  })
  watcher.on('error', () => stopWatchingAll(filePath))
  fileWatchers.set(filePath, { watcher, debounceTimer, clients })
}

function stopWatching(filePath, ws) {
  const entry = fileWatchers.get(filePath)
  if (!entry) return
  entry.clients.delete(ws)
  if (entry.clients.size === 0) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.watcher.close()
    fileWatchers.delete(filePath)
  }
}

function stopWatchingAll(filePath) {
  const entry = fileWatchers.get(filePath)
  if (!entry) return
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  entry.watcher.close()
  fileWatchers.delete(filePath)
}

function cleanupClientWatchers(ws) {
  for (const filePath of [...fileWatchers.keys()]) {
    stopWatching(filePath, ws)
  }
}

// ── Status polling (push to WS every 5s) ──
setInterval(() => broadcast('dashboard', manager.status()), 5000)

// ── REST API ──

app.get('/api/status', (_req, res) => res.json(manager.status()))

app.get('/api/system', (_req, res) => {
  const mem = os.totalmem()
  const free = os.freemem()
  const used = mem - free
  const toGB = (b) => (b / 1073741824).toFixed(1)
  const cpus = os.cpus()
  const load = os.loadavg()

  // Disk usage
  let diskTotal = '', diskFree = ''
  try {
    const df = execSync("df -BG / | tail -1", { encoding: 'utf-8' }).trim().split(/\s+/)
    diskTotal = parseFloat(df[1])
    diskFree = parseFloat(df[3])
  } catch {}

  // IP
  let ip = ''
  try {
    const nets = os.networkInterfaces()
    for (const iface of Object.values(nets)) {
      for (const cfg of iface || []) {
        if (cfg.family === 'IPv4' && !cfg.internal) { ip = cfg.address; break }
      }
      if (ip) break
    }
  } catch {}

  // Process info
  let procMem = '', procCpu = '', childProcs = '', threads = ''
  try {
    procMem = (process.memoryUsage.rss() / 1048576).toFixed(1)
  } catch {}
  try {
    const ps = execSync(`ps -o rss=,nlwp= -p ${process.pid}`, { encoding: 'utf-8' }).trim().split(/\s+/)
    if (!procMem) procMem = (parseInt(ps[0]) / 1024).toFixed(1)
    threads = ps[1]
  } catch {}
  try {
    childProcs = execSync(`pgrep -c -P ${process.pid} 2>/dev/null || echo 0`, { encoding: 'utf-8' }).trim()
  } catch {}

  // CPU usage (simple 1s sample)
  const cpuTimes = cpus.reduce((a, c) => {
    a.idle += c.times.idle; a.total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
    return a
  }, { idle: 0, total: 0 })
  const cpuPct = (100 - (cpuTimes.idle / cpuTimes.total * 100)).toFixed(1)

  res.json({
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu_count: cpus.length,
    cpu_pct: parseFloat(cpuPct),
    load_1m: load[0].toFixed(2),
    load_5m: load[1].toFixed(2),
    load_15m: load[2].toFixed(2),
    mem_total_gb: toGB(mem),
    mem_used_gb: toGB(used),
    mem_free_gb: toGB(free),
    disk_total_gb: diskTotal || '—',
    disk_free_gb: diskFree || '—',
    ip,
    pid: process.pid,
    python: '—',
    proc_mem_mb: procMem || '—',
    proc_cpu_pct: null,
    child_processes: childProcs || '0',
    thread_count: threads || '—',
    cwd: process.cwd(),
    ollama_running: false,
    net_rx_kbs: null,
    net_tx_kbs: null,
  })
})

// Chat slots
app.get('/api/chat/slots', (_req, res) => res.json(manager.listSlots()))

app.post('/api/chat/slots', (req, res) => {
  const { name, agent, model, cwd } = req.body || {}
  let modelProvider = null, modelId = null
  if (model && model.includes('/')) {
    const idx = model.indexOf('/')
    modelProvider = model.slice(0, idx)
    modelId = model.slice(idx + 1)
  }
  const slot = manager.createSlot(name, agent, { modelProvider, modelId, cwd: cwd || null })
  const pi = manager.getSlot(slot.key)
  _wireSlotEvents(pi, slot.key)
  pi._wired = true
  broadcastSlots()
  res.json(slot)
})


// Session tree for a slot
app.get('/api/chat/slots/:key/tree', (req, res) => {
  const pi = manager.getSlot(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  const sessionPath = pi.sessionFile
  if (!sessionPath) return res.json({ entries: [], leafId: null })
  res.json(parseSessionTree(sessionPath))
})

// Fork from a user message — creates a NEW slot with a forked session
app.post('/api/chat/slots/:key/fork', async (req, res) => {
  const { entryId } = req.body
  if (!entryId) return res.status(400).json({ error: 'entryId required' })
  const pi = manager.ensureRunning(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  if (!pi._wired) { _wireSlotEvents(pi, req.params.key); pi._wired = true }
  try {
    const result = await pi.request({ type: 'fork', entryId })
    if (result.data?.cancelled) return res.json({ ok: false, cancelled: true })
    // Pi created a new session file and switched to it — get the new path
    const state = await pi.request({ type: 'get_state' })
    const forkedSessionFile = state.data?.sessionFile || null
    // Restore original slot back to its old session by starting a new_session swap
    // Actually — pi already switched. We need to create a new slot for the fork
    // and restore the original slot.
    const forkedMessages = forkedSessionFile ? parseSessionMessages(forkedSessionFile, 200) : []
    const text = result.data?.text || ''
    // Create new slot for the fork
    const forkSlot = manager.createSlot('Fork: ' + text.slice(0, 40), null, {
      messages: forkedMessages,
      sessionFile: forkedSessionFile,
      title: 'Fork: ' + text.slice(0, 40),
      modelProvider: pi.modelProvider,
      modelId: pi.modelId,
      cwd: pi.cwd,
    })
    const forkPi = manager.getSlot(forkSlot.key)
    _wireSlotEvents(forkPi, forkSlot.key)
    forkPi._wired = true
    // Kill and restart original slot so it goes back to its original session
    pi.kill()
    persistSlots()
    broadcastSlots()
    res.json({ ok: true, text, newSlotKey: forkSlot.key })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Get fork-able messages for a slot
app.get('/api/chat/slots/:key/fork-messages', async (req, res) => {
  const pi = manager.getSlot(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  try {
    const result = await pi.request({ type: 'get_fork_messages' })
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/chat/slots/:key', (req, res) => {
  const limit = parseInt(req.query.limit || '200', 10)
  const detail = manager.getSlotDetail(req.params.key, limit)
  if (!detail) return res.status(404).json({ error: 'slot not found' })
  res.json(detail)
})

app.delete('/api/chat/slots/:key', (req, res) => {
  manager.deleteSlot(req.params.key)
  broadcastSlots()
  res.json({ ok: true })
})

app.post('/api/chat/slots/:key/stop', (req, res) => {
  const pi = manager.getSlot(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  pi.abort()
  res.json({ ok: true })
})

app.patch('/api/chat/slots/:key/title', (req, res) => {
  const pi = manager.getSlot(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  pi._title = req.body.title || 'New Chat'
  broadcastSlots()
  broadcast('slot_title', { key: req.params.key, title: pi._title })
  persistSlots()
  res.json({ ok: true })
})

app.post('/api/chat/slots/:key/generate-title', (req, res) => {
  const pi = manager.getSlot(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  const firstUser = pi.messages.find(m => m.role === 'user')
  const title = firstUser ? firstUser.content.slice(0, 60).replace(/\n/g, ' ') : 'New Chat'
  pi._title = title
  broadcast('slot_title', { key: req.params.key, title })
  broadcastSlots()
  persistSlots()
  res.json({ ok: true, title })
})

app.post('/api/chat/slots/:key/resume', (req, res) => {
  const { name, key: reqKey, title } = req.body || {}
  const sessionKey = req.params.key
  // Find the actual session JSONL file
  const sessionPath = findSessionFile(sessionKey)
  let messages = []
  if (sessionPath) {
    messages = parseSessionMessages(sessionPath, 200)
  }
  // Create a new slot with the loaded messages and session file for pi to resume
  const slot = manager.createSlot(title || name || sessionKey, null, {
    messages,
    sessionFile: sessionPath,
    title: title || name || sessionKey,
  })
  const pi = manager.getSlot(slot.key)
  _wireSlotEvents(pi, slot.key)
  pi._wired = true
  broadcastSlots()
  persistSlots()
  res.json({ ok: true, key: slot.key, messages, has_more: false, total: messages.length })
})

// Send chat message
app.post('/api/chat', async (req, res) => {
  const { message, slot, images } = req.body
  if (!slot) return res.status(400).json({ error: 'slot required' })
  // Lazy-start pi process if needed
  const pi = manager.ensureRunning(slot)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  // Wire events if not already wired
  if (!pi._wired) {
    _wireSlotEvents(pi, slot)
    pi._wired = true
  }
  // Don't broadcast user message — frontend adds it optimistically
  await pi.prompt(message, images)
  persistSlots()
  res.json({ ok: true })
})

// Approval mode (stub)
app.post('/api/chat/mode', (_req, res) => res.json({ ok: true }))

// Notifications (stubs)
app.get('/api/notifications', (_req, res) => res.json({ notifications }))
app.post('/api/notifications/clear', (_req, res) => { notifications.length = 0; res.json({ ok: true }) })
app.post('/api/notifications/ack', (req, res) => {
  const n = notifications.find(n => n.ts === req.body.ts)
  if (n) n.acked = true
  res.json({ ok: true })
})
app.post('/api/notifications/unack', (req, res) => {
  const n = notifications.find(n => n.ts === req.body.ts)
  if (n) n.acked = false
  res.json({ ok: true })
})
app.post('/api/notifications/ack-all', (_req, res) => {
  for (const n of notifications) n.acked = true
  res.json({ ok: true })
})
app.delete('/api/notifications', (_req, res) => { notifications.length = 0; res.json({ ok: true }) })

// Sessions history
app.get('/api/sessions', (req, res) => {
  const limit = parseInt(req.query.limit || '30', 10)
  const sessions = piEnv.getRecentSessions(limit)
  res.json({ sessions, has_more: false })
})
app.delete('/api/sessions/:key', (_req, res) => res.json({ ok: true }))
app.delete('/api/sessions', (_req, res) => res.json({ ok: true }))

// Skills
app.get('/api/skills', (_req, res) => res.json(piEnv.getSkills()))

// Skill files: list all files in a skill directory
app.get('/api/skills/:name/files', (req, res) => {
  const skillDir = join(os.homedir(), '.pi', 'agent', 'skills', req.params.name)
  try {
    const files = []
    const walk = (dir, prefix) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? prefix + '/' + e.name : e.name
        if (e.isDirectory()) walk(join(dir, e.name), rel)
        else files.push(rel)
      }
    }
    walk(skillDir, '')
    res.json({ name: req.params.name, files })
  } catch (e) {
    res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
  }
})

// Read a specific file within a skill
app.get('/api/skills/:name/file', (req, res) => {
  const filePath = req.query.path
  if (!filePath) return res.status(400).json({ error: 'path query param required' })
  // Prevent path traversal
  if (filePath.includes('..')) return res.status(400).json({ error: 'invalid path' })
  const full = join(os.homedir(), '.pi', 'agent', 'skills', req.params.name, filePath)
  try {
    res.json({ content: readFileSync(full, 'utf-8') })
  } catch (e) {
    res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
  }
})

// Write a specific file within a skill
app.put('/api/skills/:name/file', (req, res) => {
  const { path: filePath, content } = req.body
  if (!filePath || content == null) return res.status(400).json({ error: 'path and content required' })
  if (filePath.includes('..')) return res.status(400).json({ error: 'invalid path' })
  const full = join(os.homedir(), '.pi', 'agent', 'skills', req.params.name, filePath)
  try {
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Pi agent file browser — covers skills, extensions, prompts, AGENTS.md, settings.json
const PI_AGENT_DIR = join(os.homedir(), '.pi', 'agent')
const expandHome = (p) => p && p.startsWith('~/') ? join(os.homedir(), p.slice(2)) : p

app.get('/api/pi/files', (req, res) => {
  const sub = req.query.dir || ''
  if (sub.includes('..')) return res.status(400).json({ error: 'invalid path' })
  const target = sub ? join(PI_AGENT_DIR, sub) : PI_AGENT_DIR
  try {
    const entries = readdirSync(target, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'sessions' && e.name !== 'sessions-archive')
      .map(e => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)
    res.json({ dir: sub || '.', entries })
  } catch (e) {
    res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
  }
})

app.get('/api/pi/file', (req, res) => {
  const filePath = req.query.path
  if (!filePath || filePath.includes('..')) return res.status(400).json({ error: 'invalid path' })
  try {
    res.json({ content: readFileSync(join(PI_AGENT_DIR, filePath), 'utf-8') })
  } catch (e) {
    res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
  }
})

app.put('/api/pi/file', (req, res) => {
  const { path: filePath, content } = req.body
  if (!filePath || content == null || filePath.includes('..')) return res.status(400).json({ error: 'invalid path or content' })
  const full = join(PI_AGENT_DIR, filePath)
  try {
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Crons
app.get('/api/crons', (_req, res) => res.json(piEnv.getCrontab()))

// Lessons
app.get('/api/lessons', (_req, res) => res.json(piEnv.getLessons()))
app.get('/api/hooks', (_req, res) => res.json([]))

// MCP (stubs)
app.get('/api/mcp', (_req, res) => res.json([]))
app.get('/api/mcp/active', (_req, res) => res.json([]))
app.get('/api/mcp/probe', (_req, res) => res.json({ results: {} }))
app.post('/api/mcp/probe', (_req, res) => res.json({ results: {} }))

// Memory
app.get('/api/memory/preferences', (_req, res) => res.json({ content: JSON.stringify(piEnv.getFacts(), null, 2) }))
app.get('/api/memory/projects', (_req, res) => res.json({ content: '' }))
app.get('/api/memory/history', (_req, res) => res.json({ content: '' }))
app.get('/api/memory/settings', (_req, res) => res.json({}))
app.get('/api/memory/stats', (_req, res) => res.json(piEnv.getMemoryStats()))
app.get('/api/memory/embedding-status', (_req, res) => res.json({ enabled: false }))
app.put('/api/memory/preferences', (_req, res) => res.json({ ok: true }))
app.put('/api/memory/projects', (_req, res) => res.json({ ok: true }))
app.put('/api/memory/history', (_req, res) => res.json({ ok: true }))

// Agent config (stubs)
app.get('/api/agent/config', (_req, res) => res.json({}))
app.put('/api/agent/config', (_req, res) => res.json({ ok: true }))
app.get('/api/config/default-agent', (_req, res) => res.json({ agent: 'default' }))
app.put('/api/config/default-agent', (_req, res) => res.json({ ok: true }))
app.get('/api/agents/installed', (_req, res) => res.json([]))

// Pi environment APIs
app.get('/api/pi/extensions', (_req, res) => res.json(piEnv.getExtensions()))
app.get('/api/pi/vault', (_req, res) => res.json(piEnv.getVaultStats()))
app.get('/api/pi/vault/daily', (req, res) => {
  const limit = parseInt(req.query.limit || '7', 10)
  res.json(piEnv.getRecentDailyNotes(limit))
})
app.get('/api/pi/vault/daily/:date', (req, res) => {
  const content = piEnv.getDailyNote(req.params.date)
  if (!content) return res.status(404).json({ error: 'not found' })
  res.json({ date: req.params.date, content })
})
app.get('/api/pi/crontab', (_req, res) => res.json(piEnv.getCrontab()))
app.get('/api/pi/memory', (_req, res) => {
  res.json({
    stats: piEnv.getMemoryStats(),
    facts: piEnv.getFacts(),
    lessons: piEnv.getLessons(50),
  })
})

// Task runner (stubs)
app.get('/api/taskrunner', (_req, res) => res.json({ tasks: [] }))

// Logs (stubs)
app.get('/api/logs/level', (_req, res) => res.json({ level: 'info' }))
app.post('/api/logs/level', (_req, res) => res.json({ ok: true }))

// Update (stubs)
app.get('/api/update/check', (_req, res) => res.json({ available: false }))
app.get('/api/changelog', (_req, res) => res.json({ content: '' }))

// Sessions context/usage (stubs)
app.get('/api/sessions/context', (_req, res) => res.json({}))
app.get('/api/sessions/usage', (_req, res) => res.json({}))
app.post('/api/sessions/restart', (_req, res) => {
  res.json({ ok: true })
  console.log('🔄 Restart requested via API — persisting state and exiting...')
  // Give the response time to flush, then gracefully exit
  setTimeout(() => {
    persistSlots()
    manager.shutdown()
    shutdownPty()
    process.exit(0) // run.sh auto-restart loop will bring us back
  }, 500)
})

// Browse directory contents (for file tree picker)
app.get('/api/browse', (req, res) => {
  const target = req.query.path || os.homedir()
  try {
    const showHidden = req.query.hidden === 'true'
    const showFiles = req.query.files === 'true'
    const entries = readdirSync(target, { withFileTypes: true })
      .filter(e => (showHidden || !e.name.startsWith('.')) && e.name !== 'node_modules')
      .map(e => {
        const full = join(target, e.name)
        let isDir = e.isDirectory()
        if (e.isSymbolicLink()) try { isDir = statSync(full).isDirectory() } catch {}
        return { name: e.name, path: full, isDir }
      })
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
      .filter(e => showFiles ? true : e.isDir) // files=true shows all, default dirs-only for CWD picking
    res.json({ path: target, parent: dirname(target), entries })
  } catch (e) {
    res.status(400).json({ error: e.message, path: target, parent: dirname(target), entries: [] })
  }
})

// Path completion — given a partial path, return matching entries
app.get('/api/path-complete', (req, res) => {
  const input = req.query.input || ''
  try {
    let dir, prefix
    const expanded = input.startsWith('~') ? input.replace(/^~/, os.homedir()) : input
    // If input ends with /, list that directory
    if (expanded.endsWith('/')) {
      dir = expanded
      prefix = ''
    } else {
      dir = dirname(expanded)
      prefix = basename(expanded)
    }
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter(e => e.name.startsWith(prefix) && (prefix || !e.name.startsWith('.')))
      .slice(0, 30)
      .map(e => {
        const full = join(dir, e.name)
        let isDir = e.isDirectory()
        if (e.isSymbolicLink()) try { isDir = statSync(full).isDirectory() } catch {}
        return { name: e.name, path: full, isDir }
      })
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    res.json({ dir, prefix, entries })
  } catch {
    res.json({ dir: '', prefix: '', entries: [] })
  }
})

// Workspaces (scan for real project dirs)
app.get('/api/workspaces', (_req, res) => {
  const dirs = []
  // Workspaces from WORKSPACE_DIR env var
  const wsDir = process.env.WORKSPACE_DIR
  if (wsDir) {
    try {
      for (const ws of readdirSync(wsDir)) {
        const full = `${wsDir}/${ws}`
        if (statSync(full).isDirectory()) dirs.push({ name: ws, path: full })
      }
    } catch {}
  }
  // Home dir
  dirs.push({ name: '~', path: os.homedir() })
  dirs.push({ name: 'pi-dashboard', path: join(os.homedir(), 'pi-dashboard') })
  res.json({ workspaces: dirs })
})

// Models
app.get('/api/models', async (_req, res) => {
  try {
    const models = await manager.getModels()
    res.json({ models })
  } catch (e) {
    res.json({ models: [], error: e.message })
  }
})

// Set model for a slot
app.post('/api/chat/slots/:key/model', async (req, res) => {
  const { provider, modelId } = req.body
  const pi = manager.getSlot(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  pi.modelProvider = provider
  pi.modelId = modelId
  // If process is running, switch model via RPC
  if (pi.proc && pi.ready) {
    try {
      await pi.setModel(provider, modelId)
    } catch {}
  }
  persistSlots()
  broadcastSlots()
  res.json({ ok: true })
})

// Set thinking level for a slot
app.post('/api/chat/slots/:key/thinking', async (req, res) => {
  const { level } = req.body
  const pi = manager.getSlot(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  if (pi.proc && pi.ready) {
    try { await pi.setThinkingLevel(level) } catch {}
  }
  res.json({ ok: true })
})

// Set CWD for a slot (before process starts)
app.post('/api/chat/slots/:key/cwd', (req, res) => {
  const { cwd } = req.body
  const pi = manager.getSlot(req.params.key)
  if (!pi) return res.status(404).json({ error: 'slot not found' })
  pi.cwd = cwd
  // If process already running with wrong CWD, restart it
  if (pi.proc && pi.messages.length === 0) {
    pi.kill()
    pi.start()
    if (!pi._wired) {
      _wireSlotEvents(pi, req.params.key)
      pi._wired = true
    }
  }
  persistSlots()
  broadcastSlots()
  res.json({ ok: true })
})

// Spawn, Approvals (stubs)
app.get('/api/spawn', (_req, res) => res.json([]))
app.get('/api/approvals', (_req, res) => res.json([]))

// AIM (stubs)
app.get('/api/aim/mcp', (_req, res) => res.json([]))
app.get('/api/aim/skills', (_req, res) => res.json([]))
app.get('/api/aim/agents', (_req, res) => res.json([]))
app.get('/api/aim/mcp/registry', (_req, res) => res.json([]))


// Slash commands (dynamic — RPC from running pi, fallback to file scan)
const SLASH_BUILTINS = [
  { name: '/clear', description: 'Clear conversation history', source: 'builtin' },
  { name: '/compact', description: 'Compact conversation to free context', source: 'builtin' },
  { name: '/model', description: 'Select model', source: 'builtin' },
  { name: '/export', description: 'Export session (HTML/JSONL)', source: 'builtin' },
  { name: '/copy', description: 'Copy last agent message to clipboard', source: 'builtin' },
  { name: '/name', description: 'Set session display name', source: 'builtin' },
  { name: '/session', description: 'Show session info and stats', source: 'builtin' },
  { name: '/fork', description: 'Create a new fork from a previous message', source: 'builtin' },
  { name: '/new', description: 'Start a new session', source: 'builtin' },
  { name: '/reload', description: 'Reload extensions, skills, prompts, themes', source: 'builtin' },
  { name: '/tools', description: 'Show available tools', source: 'builtin' },
  { name: '/mcp', description: 'Show configured MCP servers', source: 'builtin' },
  { name: '/usage', description: 'Show billing and usage information', source: 'builtin' },
]

app.get('/api/slash-commands', async (_req, res) => {
  // Try RPC first — most accurate, includes runtime-registered commands
  try {
    const rpcCommands = await manager.getCommands()
    if (rpcCommands && rpcCommands.length > 0) {
      // Merge: RPC commands (with /name prefix) + builtins (deduped)
      const rpcNames = new Set(rpcCommands.map(c => '/' + c.name))
      const merged = [...SLASH_BUILTINS.filter(b => !rpcNames.has(b.name))]
      for (const c of rpcCommands) {
        merged.push({ name: '/' + c.name, description: c.description || '', source: c.source || 'extension' })
      }
      return res.json(merged)
    }
  } catch {}

  // Fallback: scan files
  const commands = []

  // Builtin pi commands (includes /import which is only available offline)
  commands.push(...SLASH_BUILTINS, { name: '/import', description: 'Import and resume a session', source: 'builtin' })

  // Extension-registered commands (scan .ts files for registerCommand)
  const extDir = join(os.homedir(), '.pi', 'agent', 'extensions')
  try {
    const scan = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) { scan(full); continue }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) continue
        try {
          const src = readFileSync(full, 'utf-8')
          const re = /registerCommand\("([^"]+)"[^}]*description:\s*"([^"]+)"/g
          let m
          while ((m = re.exec(src)) !== null) {
            commands.push({ name: '/' + m[1], description: m[2], source: 'extension' })
          }
        } catch {}
      }
    }
    scan(extDir)
  } catch {}

  // Skill commands (each skill dir becomes /skill-name)
  const skillDir = join(os.homedir(), '.pi', 'agent', 'skills')
  try {
    for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillMd = join(skillDir, entry.name, 'SKILL.md')
      try {
        const content = readFileSync(skillMd, 'utf-8')
        // Extract description from frontmatter
        const descMatch = content.match(/description:\s*(.+)/)
        const desc = descMatch ? descMatch[1].trim().slice(0, 80) : entry.name
        commands.push({ name: '/' + entry.name, description: desc, source: 'skill' })
      } catch {}
    }
  } catch {}

  res.json(commands)
})

// Pi settings
app.get('/api/pi/settings', (_req, res) => {
  try {
    const settingsPath = join(os.homedir(), '.pi', 'agent', 'settings.json')
    const content = readFileSync(settingsPath, 'utf-8')
    res.json(JSON.parse(content))
  } catch (e) { res.json({}) }
})

app.put('/api/pi/settings', (req, res) => {
  try {
    const settingsPath = join(os.homedir(), '.pi', 'agent', 'settings.json')
    writeFileSync(settingsPath, JSON.stringify(req.body, null, 2) + '\n')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Package management
app.post('/api/pi/packages/install', (req, res) => {
  const { source } = req.body
  if (!source) return res.status(400).json({ error: 'source required' })
  try {
    const out = execSync(`pi install ${JSON.stringify(source)} 2>&1`, { encoding: 'utf-8', timeout: 60000 })
    res.json({ ok: true, output: out })
  } catch (e) { res.status(500).json({ error: e.stderr || e.message }) }
})

app.post('/api/pi/packages/remove', (req, res) => {
  const { source } = req.body
  if (!source) return res.status(400).json({ error: 'source required' })
  try {
    const out = execSync(`pi remove ${JSON.stringify(source)} 2>&1`, { encoding: 'utf-8', timeout: 30000 })
    res.json({ ok: true, output: out })
  } catch (e) { res.status(500).json({ error: e.stderr || e.message }) }
})

// Package gallery (npm search)
app.get('/api/pi/gallery', async (_req, res) => {
  try {
    const resp = await fetch('https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=50')
    const data = await resp.json()
    const packages = (data.objects || []).map(o => ({
      name: o.package.name,
      description: o.package.description || '',
      version: o.package.version,
      author: o.package.author?.name || o.package.publisher?.username || '',
      date: o.package.date,
      links: o.package.links || {},
    }))
    res.json({ packages })
  } catch (e) { res.json({ packages: [], error: e.message }) }
})

// Host pi sessions (tmux scan)
app.get('/api/host-sessions', (_req, res) => {
  try {
    const sessions = []
    // Scan all tmux panes at once for pi processes
    let panes
    try {
      panes = execSync("tmux list-panes -a -F '#{session_name}|#{window_index}|#{pane_index}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{window_name}|#{pane_width}x#{pane_height}' 2>/dev/null", { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
    } catch { return res.json({ sessions: [] }) }

    for (const pane of panes) {
      const [sname, widx, pidx, ppid, cmd, cpath, wname, size] = pane.split('|')
      if (cmd !== 'pi') continue
      if (sname === 'pi-dash') continue

        // Get status line from pi pane
        let lastOutput = ''
        let model = '', contextPct = '', uptime = ''
        try {
          const captured = execSync(`tmux capture-pane -t ${JSON.stringify(sname + ':' + widx + '.' + pidx)} -p -S -10 2>/dev/null`, { encoding: 'utf-8', timeout: 2000 })
          const lines = captured.split('\n').filter(l => l.trim())
          // Parse all lines for status info
          for (const line of lines) {
            // Model: first word after a single non-ASCII char at line start (e.g. ◆ claude-opus-4-6-1m | ...)
            const mMatch = line.match(/^\S\s+([\w][-\w.]*)\s+\|/)
            if (mMatch) model = mMatch[1]
            const cMatch = line.match(/ctx:\s*(\d+%)/)
            if (cMatch) contextPct = cMatch[1]
            // Uptime: digits+h+digits+m pattern anywhere in line
            const tMatch = line.match(/(\d+h\d+m|\d+m\d+s)/)
            if (tMatch) uptime = tMatch[1]
          }
          // Get last meaningful output line (not status bar, not separator)
          for (let i = lines.length - 2; i >= 0; i--) {
            const l = lines[i].trim()
            if (l && !l.match(/^[─━═]+$/) && !l.startsWith('ctx:') && !l.match(/^\S\s+[\w][-\w.]*\s+\|/)) {
              lastOutput = l.slice(0, 200)
              break
            }
          }
        } catch {}

        // Find the most recent session file for this CWD
        let sessionFile = ''
        try {
          // Pi session dirs use CWD with / replaced by - and wrapped in --
          const sessDir = '--' + cpath.replace(/\//g, '-').replace(/^-/, '') + '--'
          const sessPath = join(os.homedir(), '.pi', 'agent', 'sessions', sessDir)
          const files = readdirSync(sessPath).filter(f => f.endsWith('.jsonl')).sort().reverse()
          if (files.length > 0) sessionFile = join(sessPath, files[0])
        } catch {}

        sessions.push({
          tmuxSession: sname,
          tmuxWindow: parseInt(widx),
          tmuxPane: parseInt(pidx),
          pid: parseInt(ppid),
          cwd: cpath,
          windowName: wname,
          size,
          model,
          contextPct,
          uptime,
          lastOutput,
          attachCmd: `tmux attach -t ${sname}`,
          sessionFile,
        })
    }
    res.json({ sessions })
  } catch (e) {
    res.json({ sessions: [], error: e.message })
  }
})

// ── File I/O + Version Routes (Doc Collaboration) ──
app.get('/api/file-read', async (req, res) => {
  const filePath = expandHome(req.query.path)
  if (!filePath) return res.status(400).json({ error: 'path required' })
  try {
    const content = await readFile(filePath, 'utf-8')
    res.type('text/plain').send(content)
  } catch (e) {
    res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
  }
})

app.post('/api/save-image', async (req, res) => {
  const { data, mimeType, path: rawPath } = req.body
  if (!data || !rawPath) return res.status(400).json({ error: 'data and path required' })
  const filePath = rawPath.startsWith('~') ? join(os.homedir(), rawPath.slice(1)) : rawPath.startsWith('/') ? rawPath : join(process.cwd(), rawPath)
  try {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, Buffer.from(data, 'base64'))
    res.json({ ok: true, path: filePath })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/file-write', async (req, res) => {
  const filePath = expandHome(req.body.path)
  const content = req.body.content
  if (!filePath || content == null) return res.status(400).json({ error: 'path and content required' })
  try {
    await mkdir(dirname(filePath), { recursive: true })
    recentWrites.set(filePath, Date.now())
    await writeFile(filePath, content, 'utf-8')
    const version = createVersion(filePath, content)
    res.json({ ok: true, version })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/file-versions', (req, res) => {
  const filePath = expandHome(req.query.path)
  if (!filePath) return res.status(400).json({ error: 'path required' })
  const versions = (versionStore.get(filePath) || []).map(v => ({
    version: v.version, timestamp: v.timestamp, size: v.content.length
  }))
  res.json({ versions })
})

app.get('/api/file-version', (req, res) => {
  const filePath = expandHome(req.query.path)
  const ver = parseInt(req.query.version)
  if (!filePath || isNaN(ver)) return res.status(400).json({ error: 'path and version required' })
  const versions = versionStore.get(filePath)
  const entry = versions?.find(v => v.version === ver)
  if (!entry) return res.status(404).json({ error: 'version not found' })
  res.type('text/plain').send(entry.content)
})

// ── Comment Sidecar Routes (Doc Collaboration) ──
app.get('/api/file-comments', async (req, res) => {
  const filePath = expandHome(req.query.path)
  if (!filePath) return res.status(400).json({ error: 'path required' })
  const dir = dirname(filePath)
  const sidecar = join(dir, '.' + basename(filePath) + '.comments.json')
  try {
    const raw = await readFile(sidecar, 'utf-8')
    res.json({ comments: JSON.parse(raw) })
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ comments: [] })
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/file-comments', async (req, res) => {
  const filePath = expandHome(req.body.path)
  const comments = req.body.comments
  if (!filePath || !Array.isArray(comments)) return res.status(400).json({ error: 'path and comments array required' })
  const dir = dirname(filePath)
  const sidecar = join(dir, '.' + basename(filePath) + '.comments.json')
  try {
    await writeFile(sidecar, JSON.stringify(comments, null, 2), 'utf-8')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Serve local files (images from tool results, etc.) ──
app.get('/api/local-file', (req, res) => {
  const filePath = req.query.path
  if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'path required' })
  let resolved = filePath.startsWith('~') ? join(os.homedir(), filePath.slice(1)) : filePath
  // Resolve relative paths against process cwd
  if (!resolved.startsWith('/')) resolved = join(process.cwd(), resolved)
  res.sendFile(resolved, { root: '/' }, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'not found' }) })
})

// ── Static files ──
app.use(express.static(DIST_DIR))
app.get('*', (_req, res) => {
  res.sendFile(join(DIST_DIR, 'index.html'))
})

// ── WebSocket ──
const ptyWss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  console.log('  WS upgrade:', req.url)
  if (req.url === '/api/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  } else if (req.url?.startsWith('/api/terminal/ws')) {
    ptyWss.handleUpgrade(req, socket, head, (ws) => {
      handlePtyConnection(ws, req)
    })
  } else {
    socket.destroy()
  }
})

wss.on('connection', (ws) => {
  wsClients.add(ws)
  ws.send(JSON.stringify({ type: 'dashboard', data: manager.status() }))
  ws.send(JSON.stringify({ type: 'slots', data: manager.listSlots() }))

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'subscribe_logs') ws._subscribedLogs = true
      if (msg.type === 'unsubscribe_logs') ws._subscribedLogs = false
      if (msg.type === 'watch_file' && msg.path) startWatching(msg.path, ws)
      if (msg.type === 'unwatch_file' && msg.path) stopWatching(msg.path, ws)
    } catch { /* ignore */ }
  })

  ws.on('close', () => {
    cleanupClientWatchers(ws)
    wsClients.delete(ws)
  })
})

// ── Wire pi slot events to WS ──
let _chunkSeq = 0

function _wireSlotEvents(pi, slotKey) {
  let streamBuf = ''
  const toolStartTimes = new Map() // toolCallId → { startTime, toolName }

  // Track partial streaming content and persist incrementally
  let _partialTextMsg = null
  let _partialThinkMsg = null
  let _persistTimer = null
  const _throttledPersist = () => { if (!_persistTimer) _persistTimer = setTimeout(() => { _persistTimer = null; persistSlots() }, 2000) }

  pi.on('message_update', ({ event, delta }) => {
    if (delta.type === 'text_delta') {
      streamBuf += delta.delta
      // Accumulate into a partial message in pi.messages
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
  pi.on('thinking_update', ({ delta }) => {
    thinkingBuf += delta
    // Accumulate into a partial thinking message
    if (!_partialThinkMsg) {
      _partialThinkMsg = { role: 'thinking', content: delta, ts: new Date().toISOString(), _partial: true }
      pi.messages.push(_partialThinkMsg)
    } else {
      _partialThinkMsg.content += delta
    }
  })

  pi.on('message_update', ({ event, delta: _d }) => {
    if (event?.assistantMessageEvent?.type === 'thinking_end' && thinkingBuf) {
      // Finalize the partial thinking msg
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

  pi.on('agent_start', () => {
    agentStartTime = Date.now()
  })

  pi.on('agent_end', () => {
    streamBuf = ''
    _partialTextMsg = null
    _partialThinkMsg = null
    broadcast('chat_done', { slot: slotKey })
    broadcastSlots()
    persistSlots()

    // Fetch context usage and session name from pi process
    pi.request({ type: 'get_session_stats' }, 5000).then(resp => {
      const cu = resp?.data?.contextUsage
      if (cu) {
        pi._contextUsage = { tokens: cu.tokens, contextWindow: cu.contextWindow, percent: cu.percent }
        broadcast('context_usage', { slot: slotKey, ...pi._contextUsage })
      }
    }).catch(() => {})

    // Sync session name set by auto-session-name extension
    pi.request({ type: 'get_state' }, 5000).then(resp => {
      const name = resp?.data?.sessionName
      if (name && name !== pi._title) {
        pi._title = name
        broadcast('slot_title', { key: slotKey, title: name })
        broadcastSlots()
        persistSlots()
      }
    }).catch(() => {})

    // Only notify if agent ran for a significant time (>60s)
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

  pi.on('tool_start', ({ toolName, toolCallId, args }) => {
    toolStartTimes.set(toolCallId, { startTime: Date.now(), toolName })
    // Finalize any partial text before tool call
    if (_partialTextMsg) { _partialTextMsg._partial = false; _partialTextMsg = null }
    // Add partial tool message
    pi.messages.push({ role: 'tool', content: `🔧 ${toolName}`, ts: new Date().toISOString(), _partial: true, meta: { toolName, toolCallId, args: typeof args === 'string' ? args : JSON.stringify(args || {}, null, 2) } })
    broadcast('tool_call', { slot: slotKey, tool: toolName, id: toolCallId, args })
  })

  pi.on('tool_end', (event) => {
    const result = event.result?.content?.[0]?.text || ''
    // Persist result on the tool message so it survives refresh/slot-switch
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
      result: result.slice(0, 5000), // cap for WS
      isError: event.isError || false,
    })
    _throttledPersist()

    // Notify on long-running tool completion
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

  pi.on('message_end', (event) => {
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
    }
  })

  pi.on('extension_ui', (event) => {
    if (event.method === 'confirm') {
      pi.send({ type: 'extension_ui_response', id: event.id, confirmed: true })
    } else if (event.method === 'select') {
      const first = event.options?.[0]
      if (first) pi.send({ type: 'extension_ui_response', id: event.id, value: first })
    } else if (event.method === 'setStatus') {
      // Strip ANSI escape codes from extension status text
      const clean = (event.statusText || '').replace(/\x1b\[[0-9;]*m/g, '')
      broadcast('extension_status', { slot: slotKey, key: event.statusKey, text: clean || undefined })
    } else if (event.method === 'setWidget') {
      broadcast('extension_widget', { slot: slotKey, key: event.widgetKey, lines: event.lines })
    }
  })

  pi.on('log', (data) => {
    for (const ws of wsClients) {
      if (ws._subscribedLogs && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'log', data }))
      }
    }
  })

  pi.on('slash_result', ({ content }) => {
    broadcast('chat_message', {
      slot: slotKey,
      role: 'assistant',
      content,
      ts: new Date().toISOString(),
    })
  })

  pi.on('session_file', () => persistSlots())

  pi.on('exit', () => {
    broadcast('chat_done', { slot: slotKey })
    broadcastSlots()
  })
}

// ── Start ──
const hostname = os.hostname()
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🥧 Pi Dashboard`)
  console.log(`   Local:    http://localhost:${PORT}`)
  console.log(`   Network:  http://${hostname}:${PORT}`)
  console.log(`   Custom:   http://pi.dash:${PORT}`)
  console.log()
})

process.on('SIGINT', () => { manager.shutdown(); shutdownPty(); process.exit(0) })
process.on('SIGTERM', () => { manager.shutdown(); shutdownPty(); process.exit(0) })
process.on('uncaughtException', (err) => {
  console.error('⚠ Uncaught exception (kept running):', err.message)
  console.error(err.stack)
})
process.on('unhandledRejection', (reason) => {
  console.error('⚠ Unhandled rejection (kept running):', reason)
})
