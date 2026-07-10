/**
 * Route tests for the extension-UI web-modal bridge (SDK-migration slice 2).
 *
 * Covers:
 *  (a) POST /api/chat/slots/:key/extension-ui-response resolves a pending
 *      request with pi's per-method return-type mapping (confirm→confirmed,
 *      select/input/editor→value, cancel→cancelled).
 *  (b) The server-side 60s anti-wedge timeout auto-cancels an unanswered
 *      extension dialog (using fake timers), and a timely answer clears it.
 *
 * Mock scaffolding mirrors server-routes.test.js so the Express app can be
 * imported without spawning real processes or binding a port.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createServer } from 'http'
import { EventEmitter } from 'events'

// ── Mocks must be declared before the module under test is imported ──────────

// child_process – prevent PiProcess from spawning anything
vi.mock('child_process', () => ({ spawn: vi.fn(), execSync: vi.fn(() => ''), exec: vi.fn((cmd, opts, cb) => { if (typeof opts === 'function') { cb = opts } cb(null, { stdout: '', stderr: '' }) }) }))

// node-pty – pty-manager imports this; stub it out entirely
vi.mock('node-pty', () => ({
  default: { spawn: vi.fn() },
  spawn: vi.fn(),
}))

// fs sync helpers used by pi-manager and server.js at module load time
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => '[]'),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false, isSymbolicLink: () => false })),
    existsSync: vi.fn(() => false),
    watch: vi.fn(() => ({ close: vi.fn() })),
  }
})

// fs/promises – used by some route handlers
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ size: 0 })),
  open: vi.fn(async () => ({ read: vi.fn(async () => ({ bytesRead: 0 })), close: vi.fn() })),
}))

// session-store – avoid real file I/O on startup
vi.mock('../session-store.js', () => ({
  saveSlotState: vi.fn(),
  loadSlotState: vi.fn(() => []),
  findSessionFile: vi.fn(() => null),
  parseSessionMessages: vi.fn(() => []),
  parseSessionTree: vi.fn(() => ({ entries: [], leafId: null })),
  extractText: vi.fn((c) => (typeof c === 'string' ? c : '')),
}))

// pi-env – avoid reading ~/.pi on the test machine
vi.mock('../pi-env.js', () => ({
  getSkills: vi.fn(() => []),
  getModels: vi.fn(() => []),
  getCrontab: vi.fn(() => ''),
  getLessons: vi.fn(() => []),
  getFacts: vi.fn(() => ({})),
  getDashConfig: vi.fn(() => ({ vault: { path: '' } })),
  saveDashConfig: vi.fn(),
  getMemoryFacts: vi.fn(() => []),
  getMemoryPreferences: vi.fn(() => []),
  getMemoryLessons: vi.fn(() => []),
  getMeta: vi.fn(() => null),
}))

// ── PiManager mock ────────────────────────────────────────────────────────────

function makeMockManager(overrides = {}) {
  return {
    status: vi.fn(() => ({ version: '1.0.0', uptime: 42, sessions: 0, messages: 0, tool_calls: 0, provider: 'pi' })),
    listSlots: vi.fn(() => []),
    createSlot: vi.fn((name) => ({ key: 'chat-ext-1', title: name || 'New Chat', messages: 0, running: false })),
    getSlot: vi.fn(() => null),
    getSlotDetail: vi.fn(() => null),
    getModels: vi.fn(() => []),
    deleteSlot: vi.fn(),
    shutdown: vi.fn(),
    restoreSlot: vi.fn(),
    ensureRunning: vi.fn(() => null),
    _onStateChange: null,
    slots: new Map(),
    ...overrides,
  }
}

let mockManager = makeMockManager()

vi.mock('../pi-manager.js', () => ({
  PiManager: vi.fn(function () { return mockManager }),
}))

// ── Import app after all mocks are set up ─────────────────────────────────────
const { app } = await import('../server.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve) => {
    const srv = createServer(app)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}
function stopServer(srv) {
  return new Promise((resolve) => srv.close(resolve))
}
async function post(port, path, body = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Minimal EventEmitter-backed pi that the real `_wireSlotEvents` handler can
 * attach to. `send` records the RPC frames the server writes back to the child.
 */
function makePi() {
  const pi = new EventEmitter()
  pi.slotKey = 'chat-ext-1'
  pi.send = vi.fn(() => true)
  pi._pendingExtensionUi = new Map()
  pi._wired = false
  pi.messages = []
  pi.running = false
  pi.proc = { killed: false, exitCode: null }
  // Test double for the extension-UI seam that PiRpcSession now owns. Mirrors
  // pi-manager.ts:armExtensionUi/respondExtensionUi exactly so the behavioral
  // assertions below (wire frames via pi.send, _pendingExtensionUi state, the
  // anti-wedge timer) are unchanged after the strangler-seam extraction.
  pi.armExtensionUi = (id, method, timeoutMs) => {
    const timer = setTimeout(() => { pi.respondExtensionUi(id, { cancelled: true }) }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    pi._pendingExtensionUi.set(id, { method, timer })
  }
  pi.respondExtensionUi = (id, response) => {
    const pending = pi._pendingExtensionUi.get(id)
    if (!pending) return false
    clearTimeout(pending.timer)
    pi._pendingExtensionUi.delete(id)
    if (response.cancelled) {
      pi.send({ type: 'extension_ui_response', id, cancelled: true })
    } else if (pending.method === 'confirm') {
      pi.send({ type: 'extension_ui_response', id, confirmed: !!response.value })
    } else {
      pi.send({ type: 'extension_ui_response', id, value: response.value != null ? String(response.value) : undefined })
    }
    return true
  }
  return pi
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/chat/slots/:key/extension-ui-response', () => {
  let srv, port, pi
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  beforeEach(() => {
    pi = makePi()
    // Both the create-slot wiring path and the endpoint lookup resolve to the
    // same EventEmitter pi so the real extension_ui handler is wired to it.
    mockManager.createSlot.mockReturnValue({ key: 'chat-ext-1', title: 'Ext', messages: 0, running: false })
    mockManager.getSlot.mockReturnValue(pi)
  })
  afterEach(() => { vi.useRealTimers() })

  it('404s when there is no pending request for the id', async () => {
    const res = await post(port, '/api/chat/slots/chat-ext-1/extension-ui-response', { id: 'nope' })
    expect(res.status).toBe(404)
  })

  it('400s when id is missing', async () => {
    const res = await post(port, '/api/chat/slots/chat-ext-1/extension-ui-response', {})
    expect(res.status).toBe(400)
  })

  it('maps confirm → { confirmed: boolean } and clears the timer', async () => {
    const timer = setTimeout(() => {}, 100000)
    pi._pendingExtensionUi.set('c1', { method: 'confirm', timer })
    const res = await post(port, '/api/chat/slots/chat-ext-1/extension-ui-response', { id: 'c1', value: true })
    expect(res.status).toBe(200)
    expect(pi.send).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'c1', confirmed: true })
    expect(pi._pendingExtensionUi.has('c1')).toBe(false)
    clearTimeout(timer)
  })

  it('maps a falsy confirm value → confirmed:false', async () => {
    pi._pendingExtensionUi.set('c2', { method: 'confirm', timer: setTimeout(() => {}, 100000) })
    await post(port, '/api/chat/slots/chat-ext-1/extension-ui-response', { id: 'c2', value: false })
    expect(pi.send).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'c2', confirmed: false })
  })

  it('maps select/input/editor → { value: string }', async () => {
    for (const method of ['select', 'input', 'editor']) {
      pi.send.mockClear()
      const id = `v-${method}`
      pi._pendingExtensionUi.set(id, { method, timer: setTimeout(() => {}, 100000) })
      await post(port, '/api/chat/slots/chat-ext-1/extension-ui-response', { id, value: 'hello' })
      expect(pi.send).toHaveBeenCalledWith({ type: 'extension_ui_response', id, value: 'hello' })
    }
  })

  it('maps an explicit cancel → { cancelled: true } regardless of method', async () => {
    pi._pendingExtensionUi.set('x1', { method: 'input', timer: setTimeout(() => {}, 100000) })
    await post(port, '/api/chat/slots/chat-ext-1/extension-ui-response', { id: 'x1', cancelled: true })
    expect(pi.send).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'x1', cancelled: true })
  })

  it('60s no-response timeout falls back to cancelled:true (anti-wedge)', async () => {
    vi.useFakeTimers()
    // Wire the real extension_ui handler onto our pi via the create-slot route.
    const create = await post(port, '/api/chat/slots', { name: 'Ext' })
    expect(create.status).toBe(200)
    expect(pi._wired).toBe(true)

    // Extension raises a confirm dialog — handler broadcasts a request frame
    // and registers a pending entry with a 60s anti-wedge timer.
    pi.emit('extension_ui', { method: 'confirm', id: 'timeout-1', title: 'Proceed?' })
    expect(pi._pendingExtensionUi.has('timeout-1')).toBe(true)
    expect(pi.send).not.toHaveBeenCalled()

    // No browser answers within the window → auto-cancel.
    vi.advanceTimersByTime(60_000)
    expect(pi.send).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'timeout-1', cancelled: true })
    expect(pi._pendingExtensionUi.has('timeout-1')).toBe(false)
  })

  it('a response before the deadline prevents the timeout from firing', async () => {
    vi.useFakeTimers()
    await post(port, '/api/chat/slots', { name: 'Ext' })
    pi.emit('extension_ui', { method: 'input', id: 'race-1', title: 'Name?' })
    expect(pi._pendingExtensionUi.has('race-1')).toBe(true)

    // Answer arrives (endpoint clears the timer + pending entry).
    const res = await post(port, '/api/chat/slots/chat-ext-1/extension-ui-response', { id: 'race-1', value: 'sam' })
    expect(res.status).toBe(200)
    expect(pi.send).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'race-1', value: 'sam' })

    pi.send.mockClear()
    vi.advanceTimersByTime(60_000)
    // Timer was cleared — no late cancelled:true.
    expect(pi.send).not.toHaveBeenCalled()
  })
})
