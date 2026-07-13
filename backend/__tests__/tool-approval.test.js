/**
 * Permission-gating / tool-approval tests (SDK-migration slice 11).
 *
 * Drives the `PiSdkSession` `tool_call` gate directly through the documented
 * fake-runtime seam (same seam sdk-isolation.test.js / the contract tests use):
 * `_toolCallGate(event)` is the hook body registered on every SDK session, and
 * it never touches the live `_session` — so it can be exercised with synthetic
 * `ToolCallEvent`-shaped objects and NO live LLM provider. The gate emits an
 * internal `tool_approval` event (captured here the way server.ts consumes it)
 * and awaits a decision routed back via `respondToolApproval` / the anti-wedge
 * timer armed by `armToolApproval`.
 *
 * Covers:
 *  - Flag OFF (default) → pass-through, NO `tool_approval` frame emitted, tool
 *    runs unchanged (gate resolves undefined).
 *  - Flag ON + approve → tool executes (undefined result, input unchanged).
 *  - Flag ON + approve with editedArgs → event.input mutated IN PLACE.
 *  - Flag ON + deny → tool blocked with a reason.
 *  - Timeout with no response → tool DENIED (fail-closed), not approved.
 *
 * ── MUTATION SELF-CHECK ──
 * The timeout test asserts the gate returns `{ block: true }` with reason
 * "approval timed out". If PiSdkSession.armToolApproval were changed to resolve
 * the timer as 'approve' instead of 'deny' (approve-on-timeout — the fail-OPEN
 * bug the design forbids), the gate would return undefined and this assertion
 * goes RED. So the test genuinely pins the fail-closed contract.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PiSdkSession } from '../pi-sdk-session.js'

/** Capture `tool_approval` emissions the way server.ts's handler sees them. */
function captureApprovals(pi) {
  const events = []
  pi.on('tool_approval', (e) => events.push(e))
  return events
}

function makeEvent(overrides = {}) {
  return { type: 'tool_call', toolCallId: 'tc-1', toolName: 'bash', input: { command: 'ls -la' }, ...overrides }
}

describe('PiSdkSession tool-approval gate (slice 11 permission gating)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('flag OFF (default): passes through, emits NO tool_approval frame', async () => {
    const pi = new PiSdkSession('slot-off', {})
    expect(pi.toolApproval).toBe(false) // default OFF
    const approvals = captureApprovals(pi)
    const event = makeEvent()
    const result = await pi._toolCallGate(event)
    // Undefined result = tool proceeds; input untouched; no frame broadcast.
    expect(result).toBeUndefined()
    expect(approvals).toEqual([])
    expect(event.input).toEqual({ command: 'ls -la' })
  })

  it('flag ON + approve: tool executes, args unchanged', async () => {
    const pi = new PiSdkSession('slot-approve', {})
    pi.toolApproval = true
    const approvals = captureApprovals(pi)
    const event = makeEvent()
    const gate = pi._toolCallGate(event)
    // The gate emits synchronously during Promise construction.
    expect(approvals).toHaveLength(1)
    const { id, toolName, args } = approvals[0]
    expect(toolName).toBe('bash')
    expect(args).toEqual({ command: 'ls -la' })
    // Approve with no edits.
    expect(pi.respondToolApproval(id, 'approve')).toBe(true)
    const result = await gate
    expect(result).toBeUndefined()          // proceeds
    expect(event.input).toEqual({ command: 'ls -la' }) // unchanged
  })

  it('flag ON + approve with editedArgs: tool executes with MUTATED input', async () => {
    const pi = new PiSdkSession('slot-edit', {})
    pi.toolApproval = true
    const approvals = captureApprovals(pi)
    const event = makeEvent()
    const gate = pi._toolCallGate(event)
    const { id } = approvals[0]
    // Edit-and-approve: patch the command.
    expect(pi.respondToolApproval(id, 'approve', { command: 'ls -la /safe' })).toBe(true)
    const result = await gate
    expect(result).toBeUndefined()          // proceeds
    // event.input mutated IN PLACE (SDK contract) — old keys gone, new set applied.
    expect(event.input).toEqual({ command: 'ls -la /safe' })
  })

  it('flag ON + approve with editedArgs removing a key: input reflects removal', async () => {
    const pi = new PiSdkSession('slot-edit2', {})
    pi.toolApproval = true
    const approvals = captureApprovals(pi)
    const event = makeEvent({ input: { command: 'rm -rf /', force: true } })
    const gate = pi._toolCallGate(event)
    const { id } = approvals[0]
    pi.respondToolApproval(id, 'approve', { command: 'echo safe' })
    await gate
    // `force` key removed by the in-place delete-then-assign.
    expect(event.input).toEqual({ command: 'echo safe' })
    expect('force' in event.input).toBe(false)
  })

  it('flag ON + deny: tool blocked with a reason', async () => {
    const pi = new PiSdkSession('slot-deny', {})
    pi.toolApproval = true
    const approvals = captureApprovals(pi)
    const event = makeEvent()
    const gate = pi._toolCallGate(event)
    const { id } = approvals[0]
    expect(pi.respondToolApproval(id, 'deny')).toBe(true)
    const result = await gate
    expect(result).toEqual({ block: true, reason: 'denied by user' })
  })

  it('timeout with no response: tool DENIED (fail-closed), NOT approved', async () => {
    vi.useFakeTimers()
    const pi = new PiSdkSession('slot-timeout', {})
    pi.toolApproval = true
    const approvals = captureApprovals(pi)
    const event = makeEvent()
    const gate = pi._toolCallGate(event)
    const { id } = approvals[0]
    // server.ts arms the fail-closed DENY timer on the emitted request.
    pi.armToolApproval(id, 120_000)
    // No browser answer; the window elapses.
    vi.advanceTimersByTime(120_000)
    const result = await gate
    // MUTATION SELF-CHECK anchor: must be a BLOCK, not a pass-through.
    expect(result).toEqual({ block: true, reason: 'approval timed out' })
  })

  it('respondToolApproval returns false for an unknown / already-answered id', () => {
    const pi = new PiSdkSession('slot-unknown', {})
    pi.toolApproval = true
    expect(pi.respondToolApproval('nope', 'approve')).toBe(false)
  })

  it('kill() resolves an in-flight gated call as deny (no wedge)', async () => {
    const pi = new PiSdkSession('slot-kill', {})
    pi.toolApproval = true
    const approvals = captureApprovals(pi)
    const gate = pi._toolCallGate(makeEvent())
    expect(approvals).toHaveLength(1)
    pi.kill()
    const result = await gate
    expect(result).toEqual({ block: true, reason: 'session disposed' })
  })
})

describe('resolveToolApproval (slice 11 env default)', () => {
  const prev = process.env.PI_DASH_TOOL_APPROVAL
  afterEach(() => {
    if (prev === undefined) delete process.env.PI_DASH_TOOL_APPROVAL
    else process.env.PI_DASH_TOOL_APPROVAL = prev
  })

  it('defaults OFF when no override and no env (ships dark)', async () => {
    const { resolveToolApproval } = await import('../pi-manager.js')
    delete process.env.PI_DASH_TOOL_APPROVAL
    expect(resolveToolApproval()).toBe(false)
    expect(resolveToolApproval(null)).toBe(false)
    expect(resolveToolApproval(undefined)).toBe(false)
  })

  it('honors an explicit per-slot override over the env default', async () => {
    const { resolveToolApproval } = await import('../pi-manager.js')
    process.env.PI_DASH_TOOL_APPROVAL = '1'
    expect(resolveToolApproval(false)).toBe(false) // override wins
    delete process.env.PI_DASH_TOOL_APPROVAL
    expect(resolveToolApproval(true)).toBe(true)
  })

  it('PI_DASH_TOOL_APPROVAL=1/true enables; other values stay OFF', async () => {
    const { resolveToolApproval } = await import('../pi-manager.js')
    process.env.PI_DASH_TOOL_APPROVAL = '1'
    expect(resolveToolApproval()).toBe(true)
    process.env.PI_DASH_TOOL_APPROVAL = 'true'
    expect(resolveToolApproval()).toBe(true)
    process.env.PI_DASH_TOOL_APPROVAL = 'yes'
    expect(resolveToolApproval()).toBe(false)
    process.env.PI_DASH_TOOL_APPROVAL = '0'
    expect(resolveToolApproval()).toBe(false)
  })
})
