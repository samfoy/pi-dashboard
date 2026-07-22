/**
 * SDK two-slot cross-talk isolation test — the A1 guardrail (design §4), the
 * unit half of the HARD GATE for the slice-10 flip.
 *
 * ── What this unit test PROVES (no live provider) ──
 * 1. Per-instance isolation: two `PiSdkSession`s constructed with DIFFERENT
 *    models + thinking levels + cwds keep their OWN `modelProvider`/`modelId`/
 *    `thinkingLevel`, live-session handles, and event streams. `setModel`/
 *    `setThinkingLevel`/`thinking_level_changed` on one slot MUST NOT mutate the
 *    other slot's persisted state, invoke the other slot's live-session methods,
 *    or emit `model_change` on the other slot.
 * 2. ONE real cross-talk case: when A and B SHARE a single `ModelRegistry`
 *    object (modeling design §4's process-shared, read-mostly registry), a
 *    mutation on A must NOT leak into the shared registry that B reads. This is
 *    the assertion the per-instance tests structurally CANNOT make — they give
 *    each slot its own fake registry, so a bleed through genuinely shared scope
 *    slips past them. The shared-registry test below closes that gap.
 *
 * The seam is the documented injected-fake `_session` (identical to the seam
 * `pi-session-contract.test.js` / slice 7e use): each `PiSdkSession` instance
 * holds its own `_session`, so per-instance isolation is exercised without a
 * live LLM.
 *
 * ── MUTATION SELF-CHECK ──
 * Two self-checks keep the assertions non-vacuous:
 *  - the design §4 REJECTED alternative (two slots sharing ONE mutable session)
 *    is constructed and the bleed shown to BE observable there;
 *  - the shared-registry cross-talk test is written so that hoisting a
 *    `PiSdkSession` field write onto the shared registry (a real §4 bleed) turns
 *    it RED — proving it is not a per-instance-construction guard in disguise.
 *
 * ── What this unit test CANNOT prove (live-only) ──
 * Per docs/spikes/sdk-ab-measurement.md §3: this test injects FAKE per-slot
 * sessions and a FAKE (if shared) registry. It proves `PiSdkSession`'s own
 * per-instance state + dispatch is isolated and that it does not write into a
 * registry object it is handed. It does NOT exercise the REAL
 * `createAgentSessionServices({ cwd })` / `ModelRegistry` / `AuthStorage`
 * wiring — whether pi's genuinely process-shared `ModelRegistry`/`AuthStorage`
 * stay read-only under two concurrent LIVE SDK slots (the actual §4 D-verify
 * risk) can ONLY be confirmed by the live two-slot run in the measurement doc.
 * This is the necessary-but-not-sufficient half; the live run is the sufficient
 * half. BOTH must pass before slice 10.
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
 * object with its OWN `modelRuntime` + call-capture — mirroring design §4's
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
    modelRuntime: registry,
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
    expect(a._session.modelRuntime).not.toBe(b._session.modelRuntime)
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

  // ── REAL CROSS-TALK (shared ModelRegistry) ────────────────────────────────
  // The per-instance tests above hand each slot its OWN fake registry, so a
  // bleed through genuinely shared scope slips past them (a critic proved this:
  // hoisting setModel's model write to a global store passed all of them,
  // because no test drove BOTH slots and cross-read a SHARED surface after a
  // mutation). This test closes that gap: A and B SHARE one registry object
  // (design §4: `ModelRegistry` is process-shared, read-mostly), each keeps its
  // OWN per-slot session, and we assert A's mutation does NOT leak into the
  // shared registry that B reads.
  //
  // Shared registry models the read-only model catalog; per-slot "current
  // model" lives on each per-slot session (NOT the registry). A correct
  // `PiSdkSession.setModel` therefore never writes `registry.current` — hoist
  // that write onto the shared registry and this test goes RED (the self-check).
  function primeSharedRegistrySlot(pi, sharedRegistry) {
    const state = { currentModel: null, thinking: null }
    pi._session = {
      modelRuntime: sharedRegistry,
      setModel: async (m) => { state.currentModel = m },
      setThinkingLevel: (l) => { state.thinking = l },
    }
    pi._disposed = false
    return state
  }

  it('mutating A does not leak into the process-shared ModelRegistry that B reads', async () => {
    // `current` is a sentinel a correct impl NEVER writes; getAvailable is the
    // read-mostly catalog both slots share.
    const sharedRegistry = { current: null, getAvailable: () => MODELS_A }
    const a = new PiSdkSession('shared-reg-A', {
      cwd: '/tmp/ws-a', modelProvider: 'anthropic', modelId: 'claude-sonnet', thinkingLevel: 'low',
    })
    const b = new PiSdkSession('shared-reg-B', {
      cwd: '/tmp/ws-b', modelProvider: 'anthropic', modelId: 'claude-opus', thinkingLevel: 'high',
    })
    const sa = primeSharedRegistrySlot(a, sharedRegistry)
    const sb = primeSharedRegistrySlot(b, sharedRegistry)
    const evB = capture(b)

    // Drive EVERY mutation surface on A: model, thinking, and the SDK-event
    // translation seam.
    await a.setModel('anthropic', 'claude-opus')
    await a.setThinkingLevel('medium')
    a._translate({ type: 'thinking_level_changed', level: 'medium' })

    // A moved.
    expect(a.modelId).toBe('claude-opus')
    expect(a.thinkingLevel).toBe('medium')
    expect(sa.currentModel).toEqual({ provider: 'anthropic', id: 'claude-opus', name: 'Claude Opus' })

    // CROSS-READ B's model / thinking / registry state — all UNCHANGED.
    expect(b.modelProvider).toBe('anthropic')
    expect(b.modelId).toBe('claude-opus') // B's construction value; A didn't move it
    expect(b.thinkingLevel).toBe('high')
    expect(sb.currentModel).toBeNull()     // A's setModel never touched B's session
    expect(sb.thinking).toBeNull()
    expect(evB.some(e => e.name === 'model_change')).toBe(false)

    // THE TEETH: A's mutations must NOT have written the shared registry. If a
    // field write is hoisted onto `s.modelRuntime` (a real §4 shared-registry
    // bleed), this flips RED — while the separate-registry tests above stay
    // green, because their registries aren't shared.
    expect(sharedRegistry.current).toBeNull()
    expect(await b.getAvailableModels()).toEqual(MODELS_A) // catalog uncorrupted
  })

  // ── MUTATION SELF-CHECK ──────────────────────────────────────────────────
  // Construct the design §4 REJECTED alternative (fully shared mutable session)
  // and show the bleed IS observable there. Together with the shared-registry
  // test above, this keeps the isolation assertions non-vacuous: a no-op
  // implementation, or one that shared a mutable registry/session across slots,
  // would be caught.
  it('MUTATION SELF-CHECK: a deliberately-shared mutable session bleeds — the test would catch it', async () => {
    const a = new PiSdkSession('shared-A', { modelProvider: 'anthropic', modelId: 'claude-sonnet' })
    const b = new PiSdkSession('shared-B', { modelProvider: 'anthropic', modelId: 'claude-sonnet' })
    // The bug being guarded against: both slots share ONE mutable session +
    // registry (what a naive `createAgentSession()` with default services gives).
    const sharedRegistry = { current: null, getAvailable: () => MODELS_A }
    const sharedSession = {
      modelRuntime: sharedRegistry,
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
    expect(b._session.modelRuntime.current).toEqual({ provider: 'anthropic', id: 'claude-opus', name: 'Claude Opus' })
    expect(a._session).toBe(b._session) // same object — the root cause
  })
})
