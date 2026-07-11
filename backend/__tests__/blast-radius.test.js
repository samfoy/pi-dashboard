/**
 * Blast-radius mitigation tests (SDK-migration slice 8) — per-slot error
 * boundaries on `PiSdkSession`. NO server import here (keeps this suite free of
 * the heavy child_process/pi-manager mocks) so the real `PiManager.ensureRunning`
 * respawn path can be exercised. The WS `chat_error`/`chat_done` mapping and the
 * process-level backstop live in `blast-radius-wiring.test.js`.
 *
 * What slice 8 adds and this file proves:
 *   1. A throw from `await session.prompt()` is contained to the throwing slot:
 *      it disposes (alive→false), resets turn state, and emits `exit` (the SAME
 *      signal an RPC child exit emits, so `_wireSlotEvents` broadcasts
 *      chat_error/chat_done identically — asserted in the wiring suite).
 *   2. A dead slot is respawnable on the next prompt via `ensureRunning`
 *      (mirrors the RPC respawn-on-next-prompt path).
 *   3. Sibling slots are UNAFFECTED when one slot throws.
 *   4. A throw INSIDE the subscribe-listener body (`_safeTranslate`) is
 *      contained — it never propagates into pi's synchronous event loop.
 *   5. `dispose`/`kill` tears down the subscription + pending-UI timers + the
 *      SDK session (no leak into the shared in-process heap).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PiSdkSession } from '../pi-sdk-session.js'
import { PiManager } from '../pi-manager.js'

/** Record every internal emission (name + payload), preserving order. */
function capture(pi) {
  const events = []
  const orig = pi.emit.bind(pi)
  pi.emit = (name, ...args) => {
    events.push({ name, payload: args.length <= 1 ? args[0] : args })
    return orig(name, ...args)
  }
  return events
}

describe('slice 8 — PiSdkSession prompt() error boundary', () => {
  it('a throw from await session.prompt() disposes the slot and emits exit (chat_error/chat_done signal)', async () => {
    const pi = new PiSdkSession('s-throw')
    // Documented test seam: inject a fake live session (no provider). isStreaming
    // false → not queued; prompt() rejects to simulate a provider/session fault.
    pi._session = { isStreaming: false, prompt: async () => { throw new Error('boom-prompt') } }
    pi._disposed = false
    const events = capture(pi)

    const result = await pi.prompt('hello')

    // Contained: the throw did NOT escape prompt(); it returned false.
    expect(result).toBe(false)
    // Disposed → dead so ensureRunning respawns it on the next prompt.
    expect(pi.alive).toBe(false)
    expect(pi._session).toBe(null)
    // Turn state reset (no wedged "running" slot).
    expect(pi.running).toBe(false)
    expect(pi._outstandingPrompts).toBe(0)
    // Emitted `exit` — the SAME terminal signal an RPC child exit emits, so
    // _wireSlotEvents produces chat_error (mid-turn) / chat_done identically.
    const exit = events.find(e => e.name === 'exit')
    expect(exit).toBeTruthy()
    expect(exit.payload).toBe(1)
  })

  it('marks the slot dead so ensureRunning respawns it on the next prompt (mirrors RPC)', async () => {
    const manager = new PiManager()
    clearInterval(manager._healthInterval) // don't leak the 5s health timer into vitest
    const pi = new PiSdkSession('s-respawn')
    manager.slots.set('s-respawn', pi)

    // Simulate a fatal prompt fault → dead slot.
    pi._session = { isStreaming: false, prompt: async () => { throw new Error('boom') } }
    pi._disposed = false
    await pi.prompt('x')
    expect(pi.alive).toBe(false)
    // The dead-slot guard must NOT be wedged by a stale resolved _initPromise —
    // kill() clears it so start() can re-init (the respawn precondition).
    expect(pi._initPromise).toBe(null)

    // Stub _init so respawn doesn't touch the real SDK/provider.
    pi._init = async () => { pi._session = { isStreaming: false }; pi.ready = true }
    const same = manager.ensureRunning('s-respawn')
    expect(same).toBe(pi)
    await pi._initPromise // let the stubbed re-init settle
    expect(pi.alive).toBe(true) // respawned
  })

  it('a sibling slot is UNAFFECTED when another slot throws from prompt()', async () => {
    const bad = new PiSdkSession('s-bad')
    const good = new PiSdkSession('s-good')
    // good slot has a healthy fake session that resolves.
    let goodCalled = false
    good._session = { isStreaming: false, prompt: async () => { goodCalled = true } }
    good._disposed = false
    bad._session = { isStreaming: false, prompt: async () => { throw new Error('boom') } }
    bad._disposed = false

    await bad.prompt('crash')
    const goodResult = await good.prompt('still working')

    expect(bad.alive).toBe(false)   // the failing slot died
    expect(good.alive).toBe(true)   // the sibling is untouched
    expect(goodCalled).toBe(true)   // and still dispatches prompts
    expect(goodResult).toBe(true)
  })
})

describe('slice 8 — PiSdkSession subscribe-listener boundary (_safeTranslate)', () => {
  it('a throw inside the listener body is contained (does not propagate into pi\u2019s loop)', () => {
    const pi = new PiSdkSession('s-listener')
    // Poison the translator: any event throws.
    pi._translate = () => { throw new Error('poison-event') }
    // The subscribe listener is `(ev) => this._safeTranslate(ev)` — invoking it
    // the way pi's synchronous event loop would must NOT throw.
    expect(() => pi._safeTranslate({ type: 'agent_start' })).not.toThrow()
  })

  it('the real subscribe wiring routes through _safeTranslate (a bad event cannot escape)', async () => {
    const pi = new PiSdkSession('s-wire')
    pi._translate = () => { throw new Error('poison-event') }
    let captured = null
    // Minimal fake AgentSession the _rebind path accepts.
    const fakeSession = {
      bindExtensions: async () => {},
      subscribe: (fn) => { captured = fn; return () => {} },
      sessionFile: null,
    }
    await pi._rebind(fakeSession)
    expect(typeof captured).toBe('function')
    // The SDK fires this listener synchronously from its internal loop; the
    // guard must swallow the poison-event throw.
    expect(() => captured({ type: 'anything' })).not.toThrow()
  })

  it('a listener throw in one slot leaves a sibling\u2019s translation working', () => {
    const bad = new PiSdkSession('s-bad2')
    const good = new PiSdkSession('s-good2')
    bad._translate = () => { throw new Error('poison') }
    const goodEvents = capture(good)

    expect(() => bad._safeTranslate({ type: 'agent_start' })).not.toThrow()
    // Sibling still translates a normal event into its emission.
    good._safeTranslate({ type: 'agent_start' })
    expect(goodEvents.some(e => e.name === 'agent_start')).toBe(true)
    expect(good.alive === false || good.alive === true).toBe(true) // sane, no crash
  })
})

describe('slice 8 — dispose teardown (no shared-heap leak)', () => {
  it('kill() unsubscribes, clears pending-UI timers, and disposes the SDK session', () => {
    const pi = new PiSdkSession('s-dispose')
    let unsubbed = false
    let disposed = false
    pi._unsubscribe = () => { unsubbed = true }
    pi._session = { dispose: () => { disposed = true } }
    pi._disposed = false
    const timer = setTimeout(() => {}, 100000)
    pi._pendingExtensionUi.set('p1', { method: 'confirm', timer })

    pi.kill()

    expect(unsubbed).toBe(true)
    expect(disposed).toBe(true)
    expect(pi._unsubscribe).toBe(null)
    expect(pi._session).toBe(null)
    expect(pi._pendingExtensionUi.size).toBe(0)
    expect(pi._disposed).toBe(true)
    expect(pi.alive).toBe(false)
  })
})

/**
 * MUTATION SELF-CHECK (recorded, not run in CI):
 * Removing the try/catch around `await this._session.prompt()` in
 * pi-sdk-session.ts (`prompt()`) — i.e. letting the rejection propagate —
 * makes the first test throw an unhandled rejection instead of returning false,
 * and the "sibling UNAFFECTED" test fails because `bad.prompt('crash')` rejects
 * before `good.prompt()` runs (the await never settles to the contained path).
 * Verified locally by deleting the try/catch: the prompt-boundary tests go red.
 */
