/**
 * Slice-10 flip guard: resolveTransport() precedence + the new foreground
 * default ('sdk').
 *
 * The foreground default flip (rpc -> sdk) is the single behavior-changing
 * commit of the SDK migration. These tests pin the exact contract:
 *   - no override + no env  -> 'sdk'   (the flip)
 *   - explicit override     -> wins    (rollback per-slot)
 *   - PI_DASH_TRANSPORT=rpc -> 'rpc'   (rollback global, env)
 *   - PI_DASH_TRANSPORT=sdk -> 'sdk'
 *   - a garbage env value is ignored (falls back to the default)
 * The background->rpc rule lives in conductorDetach() (sets this.transport at
 * detach time), not in resolveTransport, so it is covered elsewhere.
 *
 * Self-verified as having teeth: reverting the foreground fallback to 'rpc'
 * makes the first assertion go RED.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { resolveTransport } from '../pi-manager.js'

describe('resolveTransport (slice-10 foreground default flip)', () => {
  const prev = process.env.PI_DASH_TRANSPORT
  afterEach(() => {
    if (prev === undefined) delete process.env.PI_DASH_TRANSPORT
    else process.env.PI_DASH_TRANSPORT = prev
  })

  it('defaults foreground slots to sdk when no override and no env', () => {
    delete process.env.PI_DASH_TRANSPORT
    expect(resolveTransport()).toBe('sdk')
    expect(resolveTransport(null)).toBe('sdk')
    expect(resolveTransport(undefined)).toBe('sdk')
  })

  it('honors an explicit per-slot override over the default (rollback path)', () => {
    delete process.env.PI_DASH_TRANSPORT
    expect(resolveTransport('rpc')).toBe('rpc')
    expect(resolveTransport('sdk')).toBe('sdk')
  })

  it('honors PI_DASH_TRANSPORT=rpc as the global rollback', () => {
    process.env.PI_DASH_TRANSPORT = 'rpc'
    expect(resolveTransport()).toBe('rpc')
  })

  it('honors PI_DASH_TRANSPORT=sdk', () => {
    process.env.PI_DASH_TRANSPORT = 'sdk'
    expect(resolveTransport()).toBe('sdk')
  })

  it('lets a per-slot override win over the env', () => {
    process.env.PI_DASH_TRANSPORT = 'sdk'
    expect(resolveTransport('rpc')).toBe('rpc')
    process.env.PI_DASH_TRANSPORT = 'rpc'
    expect(resolveTransport('sdk')).toBe('sdk')
  })

  it('ignores a garbage env value and falls back to the foreground default', () => {
    process.env.PI_DASH_TRANSPORT = 'nonsense'
    expect(resolveTransport()).toBe('sdk')
  })
})
