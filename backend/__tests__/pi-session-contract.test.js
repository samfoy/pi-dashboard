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
import { deriveStatsFrames } from '../pi-session.js'

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
    // Steer-vs-queue seam: prime the impl's busy state, dispatch a prompt, and
    // return the `streamingBehavior` the impl chose ('followUp' | undefined).
    // RPC reads its authoritative busy state from a `get_state` round-trip when
    // its local counter is clean, so stub `request()` to reflect `streaming`.
    capturePrompt: async (pi, msg, { streaming }) => {
      const writes = []
      pi.proc = { killed: false, exitCode: null, stdin: { writable: true, write: (d) => writes.push(d) } }
      pi._readyPromise = null
      pi.running = streaming
      pi._outstandingPrompts = 0
      pi.request = async () => ({ data: { isStreaming: streaming } })
      await pi.prompt(msg)
      const cmd = JSON.parse(writes[writes.length - 1].trim())
      return cmd.streamingBehavior
    },
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
    // Steer-vs-queue seam: SDK decides from the AUTHORITATIVE `session.isStreaming`
    // getter, so inject a fake session exposing it plus a capturing `prompt`.
    capturePrompt: async (pi, msg, { streaming }) => {
      let opts
      pi._session = { isStreaming: streaming, prompt: async (_m, o) => { opts = o } }
      await pi.prompt(msg)
      return opts?.streamingBehavior
    },
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

describe.each(impls)('PiSession contract — $name', ({ transport, make, feed, setAlive, deadStates, capturePrompt }) => {
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

  // ── prompt-queueing / race-fix: steer-vs-followUp driven by busy state ──
  // The dashboard queues a prompt as `followUp` iff a turn is genuinely live.
  // RPC reads that from a `get_state` isStreaming round-trip; the SDK reads the
  // authoritative `session.isStreaming` getter. Both must pick the SAME behavior.
  describe('prompt queueing (steer vs followUp)', () => {
    it('sends a fresh prompt (no followUp) when NOT streaming', async () => {
      const behavior = await capturePrompt(make(), 'hello', { streaming: false })
      expect(behavior).toBeUndefined()
    })

    it('queues as followUp when a turn is already streaming', async () => {
      const behavior = await capturePrompt(make(), 'hello again', { streaming: true })
      expect(behavior).toBe('followUp')
    })
  })
})

// ── SDK-only race-fix behaviors (willRetry gating / auto_retry / queue_update /
//    phantom-agent_start-on-resume). These are genuine DELTAS the SDK path adds
//    on top of the shared contract (design section 2 / section 5) — RPC has no
//    willRetry field and treats every agent_end as terminal, so they can't run
//    against both impls. ──
describe('PiSdkSession race-fix (SDK-only)', () => {
  it('agent_end willRetry:true does NOT emit a terminal and does not finalize', () => {
    const pi = new PiSdkSession('sdk-retry')
    const events = capture(pi)
    pi._translate({ type: 'agent_start' })
    expect(pi.running).toBe(true)
    const before = pi.messages.length
    pi._translate({
      type: 'agent_end',
      willRetry: true,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'partial' }] }],
    })
    // No premature terminal — the turn is held open for the pending auto-retry.
    expect(events.filter(e => e.name === 'agent_end')).toHaveLength(0)
    expect(pi.running).toBe(true)
    expect(pi._retrying).toBe(true)
    // Not finalized: the willRetry branch skips the splice + message build.
    expect(pi.messages.length).toBe(before)
  })

  it('willRetry:true then a following willRetry:false emits exactly one terminal', () => {
    const pi = new PiSdkSession('sdk-retry2')
    const events = capture(pi)
    pi._translate({ type: 'agent_start' })
    pi._translate({ type: 'agent_end', willRetry: true, messages: [] })
    pi._translate({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: 'boom' })
    pi._translate({ type: 'auto_retry_end', success: true, attempt: 1 })
    pi._translate({
      type: 'agent_end',
      willRetry: false,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'final answer' }] }],
    })
    expect(events.filter(e => e.name === 'agent_end')).toHaveLength(1)
    expect(pi.running).toBe(false)
    expect(pi._retrying).toBe(false)
    expect(pi.messages.some(m => m.role === 'assistant' && m.content === 'final answer')).toBe(true)
  })

  it('auto_retry_start/end track retry-in-progress and emit a log so the gap is not idle', () => {
    const pi = new PiSdkSession('sdk-retry3')
    const events = capture(pi)
    pi._translate({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 50, errorMessage: 'x' })
    expect(pi._retrying).toBe(true)
    // The log emission bumps _wireSlotEvents' _lastEventTime → stall detector
    // won't read the retry gap as idle.
    expect(events.some(e => e.name === 'log')).toBe(true)
    pi._translate({ type: 'auto_retry_end', success: true, attempt: 1 })
    expect(pi._retrying).toBe(false)
  })

  it('queue_update tracks the authoritative queued-prompt state', () => {
    const pi = new PiSdkSession('sdk-q')
    pi._translate({ type: 'queue_update', steering: ['s1'], followUp: ['f1', 'f2'] })
    expect(pi._queued).toEqual({ steering: ['s1'], followUp: ['f1', 'f2'] })
  })

  it('phantom-agent_start-on-resume: after adoption isStreaming is false, no turn emitted, prompt not queued', async () => {
    // Model adoption: a resumed session whose live isStreaming is false (idle).
    // No agent_start is synthesized from adoption, and a subsequent prompt must
    // NOT queue behind a phantom turn (the RPC _wasRestarted fix's SDK analogue,
    // which falls out of reading session.isStreaming instead of a stale mirror).
    const pi = new PiSdkSession('sdk-resume', { sessionFile: '/tmp/resume.jsonl' })
    const events = capture(pi)
    let opts
    pi._session = { isStreaming: false, sessionFile: '/tmp/resume.jsonl', prompt: async (_m, o) => { opts = o } }
    pi.ready = true
    expect(events.some(e => e.name === 'agent_start')).toBe(false)
    expect(pi.running).toBe(false)
    expect(pi._session.isStreaming).toBe(false)
    await pi.prompt('resume message')
    expect(opts?.streamingBehavior).toBeUndefined()
  })
})

// ── Slice 7c: event-driven stats + session_info_changed→title +
//    thinking_level_changed→model_change (SDK deltas over the shared contract).
//    Driven through the `_translate` seam with an injected fake `_session`
//    exposing `getSessionStats()` — no live provider. The frozen-FE guarantee
//    is enforced by asserting the SDK-emitted frame bodies EQUAL the shared
//    `deriveStatsFrames` output — the exact same derivation the RPC 4s poller
//    (server.ts `_fetchStats`) broadcasts, so the WS frames are identical. ──
describe('PiSdkSession stats + title/thinking sync (slice 7c)', () => {
  // A representative SDK SessionStats object (see agent-session.d.ts).
  const fakeStats = {
    sessionFile: '/tmp/x.jsonl',
    sessionId: 'sid-1',
    userMessages: 2,
    assistantMessages: 3,
    toolCalls: 1,
    toolResults: 1,
    totalMessages: 5,
    tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, total: 150 },
    cost: 0.0123,
    contextUsage: { tokens: 150, contextWindow: 200000, percent: 0.075 },
  }

  it('getSessionStats() returns the SAME {data:SessionStats} envelope as RPC', async () => {
    const pi = new PiSdkSession('sdk-gss')
    pi._session = { getSessionStats: () => fakeStats }
    const resp = await pi.getSessionStats()
    // Envelope shape mirrors the RPC get_session_stats response so server.ts's
    // _fetchStats (resp.data.*) is transport-agnostic.
    expect(resp.data).toEqual(fakeStats)
  })

  it('agent_end (terminal) emits context_usage + token_stats IDENTICAL to RPC frames', () => {
    const pi = new PiSdkSession('sdk-stats')
    pi._session = { getSessionStats: () => fakeStats }
    const events = capture(pi)
    pi._translate({ type: 'agent_start' })
    pi._translate({ type: 'agent_end', willRetry: false, messages: [] })

    const cu = events.find(e => e.name === 'context_usage')
    const ts = events.find(e => e.name === 'token_stats')
    expect(cu).toBeDefined()
    expect(ts).toBeDefined()

    // The frozen-FE contract: SDK's emitted bodies === the shared derivation
    // the RPC poller broadcasts for the same SessionStats.
    const expected = deriveStatsFrames({ data: fakeStats })
    expect(cu.payload).toEqual(expected.contextUsage)
    expect(ts.payload).toEqual(expected.tokenStats)
    // Concrete values (guards against the helper drifting silently).
    expect(cu.payload).toEqual({ tokens: 150, contextWindow: 200000, percent: 0.075 })
    expect(ts.payload).toEqual({
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      totalCost: 0.0123,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    })
  })

  it('turn_end also refreshes stats event-driven (no poll)', () => {
    const pi = new PiSdkSession('sdk-stats-turn')
    pi._session = { getSessionStats: () => fakeStats }
    const events = capture(pi)
    pi._translate({ type: 'turn_end' })
    expect(events.some(e => e.name === 'context_usage')).toBe(true)
    expect(events.some(e => e.name === 'token_stats')).toBe(true)
  })

  it('does not throw / emit stats when the session has no getSessionStats yet', () => {
    const pi = new PiSdkSession('sdk-stats-nosess')
    const events = capture(pi)
    // No _session injected — _emitStats must be a safe no-op.
    expect(() => pi._translate({ type: 'agent_end', willRetry: false, messages: [] })).not.toThrow()
    expect(events.some(e => e.name === 'context_usage')).toBe(false)
    expect(events.some(e => e.name === 'token_stats')).toBe(false)
  })

  it('session_info_changed → internal title emission (SDK); RPC poller path unchanged', () => {
    // SDK: maps the event to `session_info_changed {name}` — server.ts consumes
    // this to update the slot title WITHOUT polling getState.
    const sdk = new PiSdkSession('sdk-title')
    const sdkEvents = capture(sdk)
    sdk._translate({ type: 'session_info_changed', name: 'Refactor auth' })
    const ev = sdkEvents.find(e => e.name === 'session_info_changed')
    expect(ev).toBeDefined()
    expect(ev.payload).toEqual({ name: 'Refactor auth' })

    // RPC: has no such mapping — its _handleEvent routes the unknown type to the
    // generic `event` emission, and the title is still derived by the getState
    // poll. Confirms the RPC path is untouched.
    const rpc = new PiRpcSession('rpc-title')
    const rpcEvents = capture(rpc)
    rpc._handleEvent({ type: 'session_info_changed', name: 'Refactor auth' })
    expect(rpcEvents.some(e => e.name === 'session_info_changed')).toBe(false)
    expect(rpcEvents.some(e => e.name === 'event')).toBe(true)
  })

  it('thinking_level_changed → updates thinkingLevel + emits model_change (SDK)', () => {
    const pi = new PiSdkSession('sdk-think')
    pi.thinkingLevel = 'medium'
    const events = capture(pi)
    pi._translate({ type: 'thinking_level_changed', level: 'high' })
    expect(pi.thinkingLevel).toBe('high')
    // Same frame the RPC path emits for a model/thinking change — server.ts
    // persists + broadcasts slots on model_change, keeping the FE chip in sync.
    expect(events.some(e => e.name === 'model_change')).toBe(true)
  })

  it('thinking_level_changed with an unchanged level does not emit model_change', () => {
    const pi = new PiSdkSession('sdk-think-noop')
    pi.thinkingLevel = 'high'
    const events = capture(pi)
    pi._translate({ type: 'thinking_level_changed', level: 'high' })
    expect(pi.thinkingLevel).toBe('high')
    expect(events.some(e => e.name === 'model_change')).toBe(false)
  })
})
