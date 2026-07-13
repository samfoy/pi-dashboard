/**
 * Isolation-regression tests for the slice-10 flip.
 *
 * After the foreground default flipped rpc -> sdk (slice 10), background/
 * conductor/job/detached slots silently lost RPC process isolation (design
 * decision #2). These tests pin the restored invariant:
 *   - foreground user slots stay on the in-process `sdk` transport (flip intact),
 *   - job/background-at-creation slots are constructed as isolated PiRpcSession,
 *   - detaching a foreground SDK slot RECONSTRUCTS it as a PiRpcSession
 *     subprocess (not a mere field flip) and writes the detach sentinel.
 *
 * Uses a REAL PiManager (constructor is light: deferred slots, no spawn) and the
 * real chat routes. PiRpcSession.start() (which spawns a pi child) is stubbed so
 * reconstruction + ensureRunning don't fork a real subprocess.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import { createServer } from 'http'
import { existsSync, rmSync, readFileSync, writeFileSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { PiManager, PiRpcSession } from '../pi-manager.js'
import { PiSdkSession } from '../pi-sdk-session.js'
import { registerChatRoutes } from '../routes/chat.js'
import { registerJobsRoutes } from '../routes/jobs.js'

// ── Real-construction classification (no routes, no spawn) ────────────────────
describe('slot transport classification (real PiManager)', () => {
  let manager
  beforeEach(() => { manager = new PiManager() })
  afterEach(() => { if (manager?._healthInterval) clearInterval(manager._healthInterval) })

  it('foreground slot (no override) resolves to sdk — slice-10 flip intact', () => {
    const { key } = manager.createSlot('Foreground', null, {})
    expect(manager.getSlot(key)).toBeInstanceOf(PiSdkSession)
    expect(manager.getSlot(key).transport).toBe('sdk')
  })

  it('background/job slot (explicit transport:rpc) resolves to isolated PiRpcSession', () => {
    const { key } = manager.createSlot('Job: nightly', null, { transport: 'rpc', tags: ['job', 'j1'] })
    expect(manager.getSlot(key)).toBeInstanceOf(PiRpcSession)
    expect(manager.getSlot(key).transport).toBe('rpc')
  })

  it('PI_DASH_TRANSPORT=rpc forces rpc even for foreground slots (rollback path)', () => {
    const prev = process.env.PI_DASH_TRANSPORT
    process.env.PI_DASH_TRANSPORT = 'rpc'
    try {
      const { key } = manager.createSlot('Foreground', null, {})
      expect(manager.getSlot(key)).toBeInstanceOf(PiRpcSession)
    } finally {
      if (prev === undefined) delete process.env.PI_DASH_TRANSPORT
      else process.env.PI_DASH_TRANSPORT = prev
    }
  })
})

// ── Detach reconstruction (real manager + real chat routes) ───────────────────
describe('conductor-detach reconstructs SDK slots as isolated PiRpcSession', () => {
  let manager, srv, port, startSpy
  const FAKE_PID = 424242
  const sentinel = `/tmp/pi-conductor-detach-${FAKE_PID}`

  function minimalDeps(app, mgr) {
    return {
      app, manager: mgr,
      broadcast: () => {}, broadcastSlots: () => {}, persistSlots: () => {},
      wsClients: new Set(), notifications: [],
      addNotification: (n) => ({ ...n, ts: Date.now(), acked: false }),
      wireSlotEvents: () => {},
      versionStore: new Map(), recentWrites: new Map(), createVersion: () => 1,
      fileWatchers: new Map(), startWatching: () => {}, stopWatching: () => {},
      cleanupClientWatchers: () => {},
    }
  }

  beforeEach(async () => {
    if (existsSync(sentinel)) rmSync(sentinel)
    // Stub the real subprocess spawn: give the reconstructed RPC slot a live
    // fake proc+pid so ensureRunning() -> start() doesn't fork a pi child and
    // conductorDetach() has a pid to write its sentinel with.
    startSpy = vi.spyOn(PiRpcSession.prototype, 'start').mockImplementation(function () {
      this.proc = { pid: FAKE_PID, killed: false, exitCode: null }
    })
    manager = new PiManager()
    const app = express()
    app.use(express.json())
    registerChatRoutes(minimalDeps(app, manager))
    await new Promise((resolve) => {
      srv = createServer(app)
      srv.listen(0, '127.0.0.1', () => { port = srv.address().port; resolve() })
    })
  })

  afterEach(async () => {
    startSpy?.mockRestore()
    if (manager?._healthInterval) clearInterval(manager._healthInterval)
    if (existsSync(sentinel)) rmSync(sentinel)
    await new Promise((resolve) => srv.close(resolve))
  })

  async function detach(key) {
    return fetch(`http://127.0.0.1:${port}/api/chat/slots/${key}/conductor-detach`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
  }

  it('detaching a foreground SDK slot swaps it to a PiRpcSession + writes the sentinel', async () => {
    const { key } = manager.createSlot('Foreground', null, {})
    expect(manager.getSlot(key)).toBeInstanceOf(PiSdkSession) // precondition: in-process

    const res = await detach(key)
    expect(res.status).toBe(200)

    // The slot for the SAME key is now an isolated RPC subprocess (reconstructed,
    // session state re-adopted), not the original in-process SDK session.
    expect(manager.getSlot(key)).toBeInstanceOf(PiRpcSession)
    expect(manager.getSlot(key).transport).toBe('rpc')
    // Sentinel handshake exercised (pi-conductor polls this file in RPC mode).
    expect(existsSync(sentinel)).toBe(true)
  })

  it('detaching an already-RPC slot does NOT reconstruct (keeps the same instance)', async () => {
    const { key } = manager.createSlot('Background', null, { transport: 'rpc' })
    const before = manager.getSlot(key)
    expect(before).toBeInstanceOf(PiRpcSession)

    const res = await detach(key)
    expect(res.status).toBe(200)
    // Same object identity — no delete/recreate churn for an already-isolated slot.
    expect(manager.getSlot(key)).toBe(before)
  })

  it('returns 404 for a missing slot', async () => {
    const res = await detach('missing-9-9')
    expect(res.status).toBe(404)
  })
})

// ── Jobs run through the caller (runJob) create isolated RPC slots ────────────
// runJob() (jobs.ts) is not exported; the only caller-level entry is the manual
// -run route POST /api/jobs/:id/run. This drives that real path and asserts the
// slot runJob creates is an isolated PiRpcSession — the background-isolation
// invariant (decision #2). The existing pi-manager-transport test builds an rpc
// slot directly and so would NOT catch runJob dropping its transport:'rpc' pin.
describe('scheduled/manual jobs create isolated rpc slots (runJob caller path)', () => {
  const STORE_PATH = join(os.homedir(), '.pi', 'dashboard-jobs.json')
  let manager, srv, port, startSpy, promptSpy, createSlotSpy, storeSnapshot

  function minimalDeps(app, mgr) {
    return {
      app, manager: mgr,
      broadcast: () => {}, broadcastSlots: () => {}, persistSlots: () => {},
      wsClients: new Set(), notifications: [],
      addNotification: (n) => ({ ...n, ts: Date.now(), acked: false }),
      wireSlotEvents: () => {},
      versionStore: new Map(), recentWrites: new Map(), createVersion: () => 1,
      fileWatchers: new Map(), startWatching: () => {}, stopWatching: () => {},
      cleanupClientWatchers: () => {},
    }
  }

  beforeEach(async () => {
    // Snapshot the real jobs store so creating a test job doesn't pollute it.
    storeSnapshot = existsSync(STORE_PATH) ? readFileSync(STORE_PATH, 'utf-8') : null
    // Stub the subprocess spawn + prompt so runJob's ensureRunning()->start()
    // and prompt() don't fork a real pi child or write to a dead stdin.
    startSpy = vi.spyOn(PiRpcSession.prototype, 'start').mockImplementation(function () {
      this.proc = { pid: 515151, killed: false, exitCode: null }
    })
    promptSpy = vi.spyOn(PiRpcSession.prototype, 'prompt').mockResolvedValue(undefined)
    manager = new PiManager()
    createSlotSpy = vi.spyOn(manager, 'createSlot')
    const app = express()
    app.use(express.json())
    registerJobsRoutes(minimalDeps(app, manager))
    await new Promise((resolve) => {
      srv = createServer(app)
      srv.listen(0, '127.0.0.1', () => { port = srv.address().port; resolve() })
    })
  })

  afterEach(async () => {
    startSpy?.mockRestore()
    promptSpy?.mockRestore()
    createSlotSpy?.mockRestore()
    if (manager?._healthInterval) clearInterval(manager._healthInterval)
    await new Promise((resolve) => srv.close(resolve))
    // Restore the jobs store exactly as it was.
    if (storeSnapshot === null) { if (existsSync(STORE_PATH)) rmSync(STORE_PATH) }
    else writeFileSync(STORE_PATH, storeSnapshot)
  })

  async function post(path, body) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  }

  it('a manually-run job creates a PiRpcSession with transport:rpc (background isolation)', async () => {
    const created = await (await post('/api/jobs', {
      name: 'nightly-report', prompt: 'summarize', cron: '0 0 * * *',
    })).json()
    expect(created.ok).toBe(true)

    const runRes = await post(`/api/jobs/${created.job.id}/run`, {})
    expect(runRes.status).toBe(200)
    const { run } = await runRes.json()

    // The slot runJob created for this job is an isolated RPC subprocess.
    const slot = manager.getSlot(run.slotKey)
    expect(slot).toBeInstanceOf(PiRpcSession)
    expect(slot.transport).toBe('rpc')

    // And the pin was passed at the createSlot call site (mutation-sensitive):
    // if runJob dropped `transport:'rpc'`, opts.transport would be undefined and
    // the slot would resolve to the 'sdk' foreground default.
    const jobCall = createSlotSpy.mock.calls.find(c => c[0] === 'Job: nightly-report')
    expect(jobCall).toBeDefined()
    expect(jobCall[2].transport).toBe('rpc')
  })
})
