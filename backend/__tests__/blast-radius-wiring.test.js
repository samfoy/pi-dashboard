/**
 * Blast-radius wiring tests (SDK-migration slice 8):
 *   (a) the SDK slot's `exit` emission is mapped by the REAL `_wireSlotEvents`
 *       to `chat_error` (mid-turn) / `chat_done` (idle) — the SAME frames an RPC
 *       child exit produces — observed over a real WebSocket broadcast.
 *   (b) the hardened `uncaughtException` / `unhandledRejection` backstop keeps
 *       the process alive (no `process.exit`) for unrelated faults, and runs the
 *       crash-path `saveSlotStateSync` autosave.
 *
 * Mock scaffolding mirrors extension-ui.test.js so the Express app + module
 * `server` (which owns the WS upgrade handler) import without spawning real
 * processes. The module `server` doesn't auto-listen under VITEST, so we listen
 * on it ourselves to get the upgrade handler + broadcast path.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import WebSocket from 'ws'

vi.mock('child_process', () => ({ spawn: vi.fn(), execSync: vi.fn(() => ''), exec: vi.fn((cmd, opts, cb) => { if (typeof opts === 'function') { cb = opts } cb(null, { stdout: '', stderr: '' }) }) }))
vi.mock('node-pty', () => ({ default: { spawn: vi.fn() }, spawn: vi.fn() }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    mkdirSync: vi.fn(), writeFileSync: vi.fn(), readFileSync: vi.fn(() => '[]'),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false, isSymbolicLink: () => false })),
    existsSync: vi.fn(() => false), watch: vi.fn(() => ({ close: vi.fn() })),
  }
})
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => ''), writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ size: 0 })),
  open: vi.fn(async () => ({ read: vi.fn(async () => ({ bytesRead: 0 })), close: vi.fn() })),
}))

// session-store — includes saveSlotStateSync (the backstop's crash-path autosave).
const saveSlotStateSync = vi.fn()
vi.mock('../session-store.js', () => ({
  saveSlotState: vi.fn(),
  saveSlotStateSync,
  loadSlotState: vi.fn(() => []),
  findSessionFile: vi.fn(() => null),
  parseSessionMessages: vi.fn(() => []),
  parseSessionTree: vi.fn(() => ({ entries: [], leafId: null })),
  extractText: vi.fn((c) => (typeof c === 'string' ? c : '')),
}))
vi.mock('../pi-env.js', () => ({
  getSkills: vi.fn(() => []), getModels: vi.fn(() => []), getCrontab: vi.fn(() => ''),
  getLessons: vi.fn(() => []), getFacts: vi.fn(() => ({})),
  getDashConfig: vi.fn(() => ({ vault: { path: '' } })), saveDashConfig: vi.fn(),
  getMemoryFacts: vi.fn(() => []), getMemoryPreferences: vi.fn(() => []),
  getMemoryLessons: vi.fn(() => []), getMeta: vi.fn(() => null),
}))

let mockManager
function makeMockManager() {
  return {
    status: vi.fn(() => ({ version: '1.0.0', uptime: 42, sessions: 0, messages: 0, tool_calls: 0, provider: 'pi' })),
    listSlots: vi.fn(() => []),
    createSlot: vi.fn((name) => ({ key: 'chat-br-1', title: name || 'New Chat', messages: 0, running: false })),
    getSlot: vi.fn(() => null), getSlotDetail: vi.fn(() => null), getModels: vi.fn(() => []),
    deleteSlot: vi.fn(), shutdown: vi.fn(), restoreSlot: vi.fn(), ensureRunning: vi.fn(() => null),
    _onStateChange: null, slots: new Map(),
  }
}
mockManager = makeMockManager()
vi.mock('../pi-manager.js', () => ({ PiManager: vi.fn(function () { return mockManager }) }))

// Snapshot process listeners BEFORE importing server so we can isolate the
// backstop handlers the module registers.
const _uncaughtBefore = process.listeners('uncaughtException').slice()
const _rejectionBefore = process.listeners('unhandledRejection').slice()

const { app, server } = await import('../server.js')

const serverUncaught = process.listeners('uncaughtException').filter(h => !_uncaughtBefore.includes(h))
const serverRejection = process.listeners('unhandledRejection').filter(h => !_rejectionBefore.includes(h))

function listen() {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}
function stop() { return new Promise((resolve) => server.close(resolve)) }
async function post(port, path, body = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}
function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`)
    const frames = []
    ws.on('message', (raw) => { try { frames.push(JSON.parse(raw.toString())) } catch {} })
    ws.on('open', () => resolve({ ws, frames }))
    ws.on('error', reject)
  })
}
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))

/** Fake SDK-like slot the real `_wireSlotEvents` can attach to. */
function makeSdkPi() {
  const pi = new EventEmitter()
  pi.slotKey = 'chat-br-1'
  pi.transport = 'sdk'
  pi.messages = []
  pi.running = false
  pi._stopping = false
  pi._toolsRunning = 0
  pi._pendingExtensionUi = new Map()
  pi._wired = false
  pi.checkHealth = () => false
  pi.getSessionStats = () => null
  return pi
}

describe('slice 8 — SDK slot exit maps to chat_error / chat_done via _wireSlotEvents', () => {
  let port, pi
  beforeAll(async () => { port = await listen() })
  afterAll(async () => { await stop() })
  beforeEach(() => {
    pi = makeSdkPi()
    mockManager.createSlot.mockReturnValue({ key: 'chat-br-1', title: 'BR', messages: 0, running: false })
    mockManager.getSlot.mockReturnValue(pi)
  })

  it('exit MID-TURN → chat_error broadcast (same frame as an RPC child exit)', async () => {
    const { ws, frames } = await connectWs(port)
    // Wire the REAL _wireSlotEvents onto our pi via the create-slot route.
    const create = await post(port, '/api/chat/slots', { name: 'BR' })
    expect(create.status).toBe(200)
    expect(pi._wired).toBe(true)

    pi.emit('agent_start', {})   // turn goes live → midTurn=true
    await tick()
    pi.emit('exit', 1)           // SDK fatal boundary emits this
    await tick(60)

    const err = frames.find(f => f.type === 'chat_error' && f.data?.slot === 'chat-br-1')
    expect(err).toBeTruthy()
    expect(String(err.data.message)).toMatch(/exited unexpectedly/i)
    ws.close()
  })

  it('exit while IDLE (no live turn) → chat_done broadcast', async () => {
    const { ws, frames } = await connectWs(port)
    await post(port, '/api/chat/slots', { name: 'BR' })
    expect(pi._wired).toBe(true)

    pi.emit('exit', 0)           // no prior agent_start → not mid-turn
    await tick(60)

    const done = frames.find(f => f.type === 'chat_done' && f.data?.slot === 'chat-br-1')
    expect(done).toBeTruthy()
    expect(frames.some(f => f.type === 'chat_error')).toBe(false)
    ws.close()
  })
})

describe('slice 8 — hardened process-level backstop', () => {
  it('registered an uncaughtException and an unhandledRejection handler', () => {
    expect(serverUncaught.length).toBeGreaterThanOrEqual(1)
    expect(serverRejection.length).toBeGreaterThanOrEqual(1)
  })

  it('unhandledRejection keeps the process alive (no exit) and runs crash-path autosave', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit called') })
    saveSlotStateSync.mockClear()
    // A floating promise rejection must NOT kill the process.
    expect(() => serverRejection.forEach(h => h('floating-reason'))).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(saveSlotStateSync).toHaveBeenCalled() // bounded-loss autosave on the crash path
    exitSpy.mockRestore()
  })

  it('uncaughtException keeps the process alive for an unrelated throw (log-and-continue)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit called') })
    saveSlotStateSync.mockClear()
    expect(() => serverUncaught.forEach(h => h(new Error('unrelated')))).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(saveSlotStateSync).toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('uncaughtException STILL exits on EADDRINUSE (unchanged so systemd can retry)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit called') })
    const err = new Error('addr in use'); err.code = 'EADDRINUSE'
    // The handler calls process.exit(1) → our spy throws 'exit called'.
    expect(() => serverUncaught.forEach(h => h(err))).toThrow(/exit called/)
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
