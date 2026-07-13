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
import { existsSync, rmSync } from 'fs'
import { PiManager, PiRpcSession } from '../pi-manager.js'
import { PiSdkSession } from '../pi-sdk-session.js'
import { registerChatRoutes } from '../routes/chat.js'

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
