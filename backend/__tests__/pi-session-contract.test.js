/**
 * Shared PiSession interface contract suite.
 *
 * Runs the SAME assertions against BOTH transport implementations
 * (`PiRpcSession` and `PiSdkSession`) so the contract `PiManager` +
 * `_wireSlotEvents` depend on is proven identical across transports. Slice 7a
 * covers the CORE surface reachable without a live LLM provider:
 *   - construction + `transport`/`sessionFile` adoption
 *   - `prompt`/`abort` presence
 *   - the `alive` liveness contract (carry-forward from slice 4)
 *   - core event-emission SHAPES (agent_start / tool_start / message_update /
 *     thinking_update / agent_end)
 *
 * Neither impl needs a real provider here: RPC's `_handleEvent` and SDK's
 * `_translate` are driven directly with synthetic event objects (the documented
 * test seam), and liveness is exercised by poking each impl's internal
 * liveness source (RPC `proc`, SDK `_session`/`_disposed`).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { PiRpcSession } from '../pi-manager.js'
import { PiSdkSession } from '../pi-sdk-session.js'

// Per-impl adapters: everything transport-specific is isolated here so the
// test bodies below are written once.
const impls = [
  {
    name: 'PiRpcSession',
    transport: 'rpc',
    make: (opts = {}) => new PiRpcSession('contract-rpc', opts),
    // Drive the translation seam (RPC: stdout JSON → _handleEvent).
    feed: (pi, ev) => pi._handleEvent(ev),
    setAlive: (pi) => { pi.proc = { killed: false, exitCode: null } },
    // Every way the RPC liveness source can read "dead".
    deadStates: [
      (pi) => { pi.proc = null },
      (pi) => { pi.proc = { killed: true, exitCode: null } },
      (pi) => { pi.proc = { killed: false, exitCode: 0 } },
    ],
  },
  {
    name: 'PiSdkSession',
    transport: 'sdk',
    make: (opts = {}) => new PiSdkSession('contract-sdk', opts),
    // Drive the translation seam (SDK: AgentSessionEvent → _translate).
    feed: (pi, ev) => pi._translate(ev),
    setAlive: (pi) => { pi._session = {}; pi._disposed = false },
    deadStates: [
      (pi) => { pi._session = null },
      (pi) => { pi._session = {}; pi._disposed = true },
    ],
  },
]

/** Record every internal emission (name + payload) without swallowing them. */
function capture(pi) {
  const events = []
  const orig = pi.emit.bind(pi)
  pi.emit = (name, ...args) => {
    events.push({ name, payload: args.length <= 1 ? args[0] : args })
    return orig(name, ...args)
  }
  return events
}

describe.each(impls)('PiSession contract — $name', ({ transport, make, feed, setAlive, deadStates }) => {
  let pi
  beforeEach(() => { pi = make() })

  it('reports its transport', () => {
    expect(pi.transport).toBe(transport)
  })

  it('adopts sessionFile from opts', () => {
    const p = make({ sessionFile: '/tmp/adopt.jsonl' })
    expect(p.sessionFile).toBe('/tmp/adopt.jsonl')
  })

  it('exposes prompt() and abort()', () => {
    expect(typeof pi.prompt).toBe('function')
    expect(typeof pi.abort).toBe('function')
  })

  it('getState() resolves to an object exposing data.sessionName', async () => {
    // Prime the impl's session-name source, then assert getState surfaces it.
    if (transport === 'sdk') {
      pi._session = { sessionName: 'my-session' }
    } else {
      // RPC's getState() delegates to a live RPC round-trip; stub request().
      pi.request = async () => ({ data: { sessionName: 'my-session' } })
    }
    const state = await pi.getState()
    expect(state?.data?.sessionName).toBe('my-session')
  })

  // ── alive liveness contract (slice-4 carry-forward) ──
  describe('alive', () => {
    it('is false before start (no proc / no session)', () => {
      expect(pi.alive).toBe(false)
    })

    it('is true once the liveness source is present', () => {
      setAlive(pi)
      expect(pi.alive).toBe(true)
    })

    it('is false for every dead-state variant', () => {
      for (const kill of deadStates) {
        const p = make()
        setAlive(p)
        expect(p.alive).toBe(true) // sanity: alive first
        kill(p)
        expect(p.alive).toBe(false)
      }
    })
  })

  // ── core event-emission shapes ──
  describe('event translation shapes', () => {
    it('agent_start emits agent_start and sets running', () => {
      const events = capture(pi)
      feed(pi, { type: 'agent_start' })
      expect(pi.running).toBe(true)
      expect(events.find(e => e.name === 'agent_start')).toBeDefined()
    })

    it('tool_execution_start emits tool_start {toolCallId,toolName,args}', () => {
      const events = capture(pi)
      feed(pi, { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { cmd: 'ls' } })
      const ev = events.find(e => e.name === 'tool_start')
      expect(ev).toBeDefined()
      expect(ev.payload).toEqual({ toolCallId: 't1', toolName: 'bash', args: { cmd: 'ls' } })
    })

    it('message_update text_delta emits message_update {event,delta}', () => {
      const events = capture(pi)
      const event = { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } }
      feed(pi, event)
      const ev = events.find(e => e.name === 'message_update')
      expect(ev).toBeDefined()
      expect(ev.payload.delta).toEqual({ type: 'text_delta', delta: 'hi' })
    })

    it('message_update thinking_delta emits thinking_update {delta}', () => {
      const events = capture(pi)
      feed(pi, { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' } })
      const ev = events.find(e => e.name === 'thinking_update')
      expect(ev).toBeDefined()
      expect(ev.payload).toEqual({ delta: 'hmm' })
    })

    it('agent_end emits agent_end and clears running', () => {
      const events = capture(pi)
      feed(pi, { type: 'agent_start' })
      feed(pi, { type: 'agent_end', messages: [] })
      expect(pi.running).toBe(false)
      expect(events.find(e => e.name === 'agent_end')).toBeDefined()
    })
  })
})
