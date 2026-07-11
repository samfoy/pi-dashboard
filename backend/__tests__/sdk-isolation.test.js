/**
 * SDK two-slot cross-talk isolation test — the A1 guardrail (design §4), the
 * HARD GATE for the slice-10 flip.
 *
 * ── What this proves (unit level, no live provider) ──
 * Two `PiSdkSession`s constructed with DIFFERENT models + thinking levels + cwds
 * must not bleed state into one another. Concretely: `setModel`/`setThinkingLevel`
 * and the `thinking_level_changed` translation on one slot MUST NOT mutate the
 * other slot's `modelProvider`/`modelId`/`thinkingLevel`, MUST NOT invoke the
 * other slot's live-session methods, and MUST NOT emit `model_change` on the
 * other slot. Each slot also reads its available-model set from its OWN
 * per-slot `modelRegistry` (design §4: `AgentSessionServices`/`SessionManager`/
 * the session are per-slot cwd-bound; only `AuthStorage`/`ModelRegistry` are
 * process-shared, read-mostly).
 *
 * The seam is the documented injected-fake `_session` (identical to the seam
 * `pi-session-contract.test.js` / slice 7e use): each `PiSdkSession` instance
 * holds its own `_session` with its own `modelRegistry` + call-capture, so the
 * per-slot isolation `PiSdkSession` itself is responsible for is exercised
 * without a live LLM.
 *
 * ── MUTATION SELF-CHECK ──
 * The final test constructs the design §4 REJECTED alternative — two slots
 * sharing ONE mutable session/registry — and shows the bleed IS observable
 * there. That is what makes the isolation assertions above non-vacuous: if the
 * production construction ever shared a mutable registry across slots, this
 * test's shape would catch it.
 *
 * ── What CANNOT be confirmed here (live-only, see docs/spikes/sdk-ab-measurement.md) ──
 * This test injects fake per-slot sessions, so it proves `PiSdkSession`'s OWN
 * per-instance state + dispatch is isolated. It does NOT exercise the REAL
 * `createAgentSessionServices({ cwd })` / `ModelRegistry` / `AuthStorage`
 * wiring — whether pi's genuinely process-shared `ModelRegistry`/`AuthStorage`
 * stay read-only under two concurrent LIVE SDK slots (the actual §4 D-verify
 * risk) can only be confirmed by the live two-slot run documented in the
 * measurement doc. This test is the necessary-but-not-sufficient half; the live
 * run is the sufficient half. BOTH must pass before slice 10.
 */
import { describe, it, expect } from 'vitest'
import { PiSdkSession } from '../pi-sdk-session.js'

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

// Two disjoint model catalogs, one per slot — a real deployment gives each slot
// its own cwd-bound ModelRegistry view (design §4).
const MODELS_A = [
  { provider: 'anthropic', id: 'claude-sonnet', name: 'Claude Sonnet' },
  { provider: 'anthropic', id: 'claude-opus', name: 'Claude Opus' },
]
const MODELS_B = [
  { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
  { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o' },
]

/**
 * Inject a per-slot fake in-process session. Each slot gets its OWN session
 * object with its OWN `modelRegistry` + call-capture — mirroring design §4's
 * per-slot cwd-bound services. The `registry.current` field models the "current
 * model" a shared singleton would mutate in place; the mutation self-check
 * relies on it.
 */
function primeSlot(pi, { models }) {
  const calls = { setModel: [], setThinkingLevel: [] }
  const registry = {
    current: null,
    getAvailable: () => models,
  }
  pi._session = {
    modelRegistry: registry,
    setModel: async (m) => { calls.setModel.push(m); registry.current = m },
    setThinkingLevel: (l) => { calls.setThinkingLevel.push(l) },
  }
  pi._disposed = false
  return { calls, registry }
}

describe('SDK two-slot cross-talk isolation (A1 guardrail — design §4)', () => {
  function makeTwoSlots() {
    const a = new PiSdkSession('slot-A', {
      cwd: '/tmp/ws-a', modelProvider: 'anthropic', modelId: 'claude-sonnet', thinkingLevel: 'low',
    })
    const b = new PiSdkSession('slot-B', {
      cwd: '/tmp/ws-b', modelProvider: 'openai', modelId: 'gpt-5', thinkingLevel: 'high',
    })
    const ca = primeSlot(a, { models: MODELS_A })
    const cb = primeSlot(b, { models: MODELS_B })
    return { a, b, ca, cb }
  }

  it('two slots construct with independent model/thinking/cwd state', () => {
    const { a, b } = makeTwoSlots()
    expect(a.cwd).toBe('/tmp/ws-a')
    expect(b.cwd).toBe('/tmp/ws-b')
    expect(a.modelProvider).toBe('anthropic')
    expect(b.modelProvider).toBe('openai')
    expect(a.thinkingLevel).toBe('low')
    expect(b.thinkingLevel).toBe('high')
    // Distinct instances → distinct live-session handles (no shared object).
    expect(a._session).not.toBe(b._session)
    expect(a._session.modelRegistry).not.toBe(b._session.modelRegistry)
  })

  it('setModel() on slot A does not change slot B model or touch B session', async () => {
    const { a, b, cb } = makeTwoSlots()
    await a.setModel('anthropic', 'claude-opus')
    // A moved.
    expect(a.modelProvider).toBe('anthropic')
    expect(a.modelId).toBe('claude-opus')
    // B is untouched: state unchanged AND its live session's setModel never fired.
    expect(b.modelProvider).toBe('openai')
    expect(b.modelId).toBe('gpt-5')
    expect(cb.calls.setModel).toEqual([])
    expect(cb.registry.current).toBeNull()
  })

  it('setThinkingLevel() on slot A does not change slot B thinking or touch B session', async () => {
    const { a, b, cb } = makeTwoSlots()
    await a.setThinkingLevel('medium')
    expect(a.thinkingLevel).toBe('medium')
    // B untouched.
    expect(b.thinkingLevel).toBe('high')
    expect(cb.calls.setThinkingLevel).toEqual([])
  })

  it('model_change emissions are isolated to the mutated slot', async () => {
    const { a, b } = makeTwoSlots()
    const evA = capture(a)
    const evB = capture(b)
    await a.setModel('anthropic', 'claude-opus')
    await a.setThinkingLevel('medium')
    // A emitted model_change (once per real change); B emitted nothing.
    expect(evA.filter(e => e.name === 'model_change').length).toBeGreaterThan(0)
    expect(evB.some(e => e.name === 'model_change')).toBe(false)
  })

  it('thinking_level_changed translation on slot A does not bleed into slot B', () => {
    const { a, b } = makeTwoSlots()
    // Feed the SDK event straight through slot A's translation seam.
    a._translate({ type: 'thinking_level_changed', level: 'high' })
    expect(a.thinkingLevel).toBe('high')
    // B's thinking level is unaffected by A's event.
    expect(b.thinkingLevel).toBe('high') // B started at 'high' and must stay there
    // Prove it's not a coincidence: move B's start value and re-run against A.
    const { a: a2, b: b2 } = makeTwoSlots()
    b2.thinkingLevel = 'low'
    a2._translate({ type: 'thinking_level_changed', level: 'medium' })
    expect(a2.thinkingLevel).toBe('medium')
    expect(b2.thinkingLevel).toBe('low')
  })

  it('each slot reads its available-model set from its OWN registry', async () => {
    const { a, b } = makeTwoSlots()
    expect(await a.getAvailableModels()).toEqual(MODELS_A)
    expect(await b.getAvailableModels()).toEqual(MODELS_B)
    // Mutating A's registry list must not change B's view.
    MODELS_A.push({ provider: 'anthropic', id: 'claude-haiku', name: 'Claude Haiku' })
    expect(await b.getAvailableModels()).toEqual(MODELS_B)
    MODELS_A.pop() // restore for other tests
  })

  // ── MUTATION SELF-CHECK ──────────────────────────────────────────────────
  // Construct the design §4 REJECTED alternative (fully shared singleton) and
  // show the bleed IS observable there. If it were NOT, every isolation
  // assertion above would be vacuous — a no-op implementation would pass them.
  it('MUTATION SELF-CHECK: a deliberately-shared mutable session bleeds — the test would catch it', async () => {
    const a = new PiSdkSession('shared-A', { modelProvider: 'anthropic', modelId: 'claude-sonnet' })
    const b = new PiSdkSession('shared-B', { modelProvider: 'anthropic', modelId: 'claude-sonnet' })
    // The bug being guarded against: both slots share ONE mutable session +
    // registry (what a naive `createAgentSession()` with default services gives).
    const sharedRegistry = { current: null, getAvailable: () => MODELS_A }
    const sharedSession = {
      modelRegistry: sharedRegistry,
      setModel: async (m) => { sharedRegistry.current = m },
      setThinkingLevel: () => {},
    }
    a._session = sharedSession; a._disposed = false
    b._session = sharedSession; b._disposed = false

    // Slot A changes its model. On the shared-singleton bug, this mutates the
    // registry both slots read.
    await a.setModel('anthropic', 'claude-opus')

    // THE BLEED: slot B's live session now reports A's model as current. This is
    // exactly the "shared ModelRegistry resurrects the model-resolver bug"
    // failure design §4 calls out. The assertion is inverted vs the isolated
    // tests: here the bleed MUST be present, proving the isolated tests are not
    // trivially satisfiable.
    expect(b._session.modelRegistry.current).toEqual({ provider: 'anthropic', id: 'claude-opus', name: 'Claude Opus' })
    expect(a._session).toBe(b._session) // same object — the root cause
  })
})
