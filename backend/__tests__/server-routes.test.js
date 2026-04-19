/**
 * Integration tests for server.js API routes.
 *
 * Strategy: mock all heavy dependencies (PiManager, session-store, pi-env,
 * pty-manager, child_process, fs) so the Express app can be imported without
 * spawning real processes or binding to a port.  Each test starts the app on
 * a random port (listen(0)) and tears it down afterwards.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from 'http'

// ── Mocks must be declared before the module under test is imported ──────────

// child_process – prevent PiProcess from spawning anything
vi.mock('child_process', () => ({ spawn: vi.fn(), execSync: vi.fn(() => '') }))

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

// ── PiManager mock factory ────────────────────────────────────────────────────

function makeMockManager(overrides = {}) {
  return {
    status: vi.fn(() => ({
      version: '1.0.0',
      uptime: 42,
      sessions: 0,
      messages: 0,
      tool_calls: 0,
      provider: 'pi',
    })),
    listSlots: vi.fn(() => []),
    createSlot: vi.fn((name) => ({
      key: 'chat-1-1700000000000',
      title: name || 'New Chat',
      messages: 0,
      running: false,
    })),
    getSlot: vi.fn(() => null),
    getSlotDetail: vi.fn(() => null),
    deleteSlot: vi.fn(),
    shutdown: vi.fn(),
    restoreSlot: vi.fn(),
    ensureRunning: vi.fn(() => null),
    _onStateChange: null,
    slots: new Map(),
    ...overrides,
  }
}

// We need to inject our mock manager into the module.  Because server.js creates
// `new PiManager()` at the top level, we mock the entire pi-manager module.
let mockManager = makeMockManager()

vi.mock('../pi-manager.js', () => {
  // Must use a real function (not arrow) so `new PiManager()` works.
  // Returning a plain object from a constructor makes `new` return that object.
  return {
    PiManager: vi.fn(function () { return mockManager }),
  }
})

// ── Import app after all mocks are set up ─────────────────────────────────────
const { app } = await import('../server.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve) => {
    const srv = createServer(app)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      resolve({ srv, port })
    })
  })
}

function stopServer(srv) {
  return new Promise((resolve) => srv.close(resolve))
}

async function get(port, path) {
  return fetch(`http://127.0.0.1:${port}${path}`)
}
async function post(port, path, body = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
async function del(port, path) {
  return fetch(`http://127.0.0.1:${port}${path}`, { method: 'DELETE' })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/status', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('returns 200 with status shape', async () => {
    const res = await get(port, '/api/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      version: expect.any(String),
      uptime: expect.any(Number),
      sessions: expect.any(Number),
      provider: 'pi',
    })
  })

  it('calls manager.status()', async () => {
    mockManager.status.mockClear()
    await get(port, '/api/status')
    expect(mockManager.status).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/chat/slots', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('returns 200 with empty array when no slots', async () => {
    mockManager.listSlots.mockReturnValue([])
    const res = await get(port, '/api/chat/slots')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  it('returns slot list from manager', async () => {
    const slots = [
      { key: 'chat-1-1000', title: 'Alpha', messages: 3, running: false },
      { key: 'chat-2-2000', title: 'Beta', messages: 0, running: true },
    ]
    mockManager.listSlots.mockReturnValue(slots)
    const res = await get(port, '/api/chat/slots')
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].key).toBe('chat-1-1000')
    expect(body[1].running).toBe(true)
  })
})

describe('POST /api/chat/slots', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  beforeEach(() => {
    // getSlot used by _wireSlotEvents — return a minimal stub
    mockManager.getSlot.mockReturnValue({
      on: vi.fn(),
      _wired: false,
      messages: [],
      running: false,
    })
    mockManager.createSlot.mockReturnValue({
      key: 'chat-1-1700000000000',
      title: 'My Slot',
      messages: 0,
      running: false,
    })
  })

  it('returns 200 with new slot object', async () => {
    const res = await post(port, '/api/chat/slots', { name: 'My Slot' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      key: expect.stringMatching(/^chat-/),
      title: expect.any(String),
      messages: expect.any(Number),
    })
  })

  it('passes name and model to manager.createSlot', async () => {
    mockManager.createSlot.mockClear()
    await post(port, '/api/chat/slots', { name: 'Work', model: 'anthropic/claude-3-5-sonnet' })
    expect(mockManager.createSlot).toHaveBeenCalledWith(
      'Work',
      undefined,
      expect.objectContaining({ modelProvider: 'anthropic', modelId: 'claude-3-5-sonnet' }),
    )
  })

  it('handles model without slash gracefully', async () => {
    mockManager.createSlot.mockClear()
    await post(port, '/api/chat/slots', { name: 'Test', model: 'badformat' })
    // modelProvider/modelId should be null when no slash in model string
    expect(mockManager.createSlot).toHaveBeenCalledWith(
      'Test',
      undefined,
      expect.objectContaining({ modelProvider: null, modelId: null }),
    )
  })
})

describe('GET /api/chat/slots/:key', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('returns 404 when slot does not exist', async () => {
    mockManager.getSlotDetail.mockReturnValue(null)
    const res = await get(port, '/api/chat/slots/missing-key')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ error: expect.any(String) })
  })

  it('returns 200 with slot detail when slot exists', async () => {
    const detail = {
      messages: [{ role: 'user', content: 'hello', ts: '2024-01-01T00:00:00Z' }],
      running: false,
      stopping: false,
      pending_approval: false,
      has_more: false,
      total: 1,
      model: null,
      cwd: null,
      contextUsage: null,
    }
    mockManager.getSlotDetail.mockReturnValue(detail)
    const res = await get(port, '/api/chat/slots/chat-1-1000')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('passes limit query param to getSlotDetail', async () => {
    mockManager.getSlotDetail.mockReturnValue({ messages: [], running: false, stopping: false, pending_approval: false, has_more: false, total: 0, model: null, cwd: null, contextUsage: null })
    mockManager.getSlotDetail.mockClear()
    await get(port, '/api/chat/slots/chat-1-1000?limit=50')
    expect(mockManager.getSlotDetail).toHaveBeenCalledWith('chat-1-1000', 50)
  })
})

describe('DELETE /api/chat/slots/:key', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('returns 200 ok and calls deleteSlot', async () => {
    mockManager.deleteSlot.mockClear()
    const res = await del(port, '/api/chat/slots/chat-1-1000')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true })
    expect(mockManager.deleteSlot).toHaveBeenCalledWith('chat-1-1000')
  })
})

describe('GET /api/notifications', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('returns 200 with notifications array', async () => {
    const res = await get(port, '/api/notifications')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('notifications')
    expect(Array.isArray(body.notifications)).toBe(true)
  })
})

describe('POST /api/notifications/clear', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('returns 200 ok', async () => {
    const res = await post(port, '/api/notifications/clear')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true })
  })
})

describe('PATCH /api/chat/slots/:key/title', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('returns 404 when slot not found', async () => {
    mockManager.getSlot.mockReturnValue(null)
    const res = await fetch(`http://127.0.0.1:${port}/api/chat/slots/no-such-slot/title`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New Title' }),
    })
    expect(res.status).toBe(404)
  })

  it('updates the slot title and returns ok', async () => {
    const fakeSlot = { _title: 'Old', _userRenamed: false, on: vi.fn(), messages: [], running: false }
    mockManager.getSlot.mockReturnValue(fakeSlot)
    const res = await fetch(`http://127.0.0.1:${port}/api/chat/slots/chat-1-1000/title`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My New Title' }),
    })
    expect(res.status).toBe(200)
    expect(fakeSlot._title).toBe('My New Title')
    expect(fakeSlot._userRenamed).toBe(true)
  })
})

describe('SPA fallback / unknown routes', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('serves SPA index.html (200) for an unmatched /api path', async () => {
    // Server has no explicit 404 handler — unknown paths fall through to SPA fallback.
    // This test documents (and protects) that contract.
    const res = await get(port, '/api/does-not-exist')
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type') || ''
    expect(ct).toMatch(/html/)
  })

  it('serves SPA index.html (200) for a totally unknown path', async () => {
    const res = await get(port, '/xyz/unknown')
    expect(res.status).toBe(200)
  })
})

describe('POST /api/chat/slots/:key/stop', () => {
  let srv, port
  beforeAll(async () => ({ srv, port } = await startServer()))
  afterAll(() => stopServer(srv))

  it('returns 404 when slot not found', async () => {
    mockManager.getSlot.mockReturnValue(null)
    const res = await post(port, '/api/chat/slots/no-slot/stop')
    expect(res.status).toBe(404)
  })

  it('calls abort() on the slot and returns ok', async () => {
    const abort = vi.fn()
    mockManager.getSlot.mockReturnValue({ abort, on: vi.fn(), messages: [], running: true })
    const res = await post(port, '/api/chat/slots/chat-1-1000/stop')
    expect(res.status).toBe(200)
    expect(abort).toHaveBeenCalled()
  })
})
