/**
 * Teeth test for per-slot transport on a REAL PiRpcSession.
 *
 * The slice-5 round-trip test (session-store.test.js) builds plain objects and
 * the endpoint test mocks the manager, so neither exercises a constructed
 * PiRpcSession's `transport` field. This test constructs a real session with an
 * explicit transport distinct from the default and asserts it (a) lands on the
 * instance and (b) survives saveSlotStateSync -> loadSlotState.
 *
 * Self-verified as having teeth: removing `this.transport = opts.transport ||
 * 'rpc'` from the PiRpcSession constructor makes the first assertion below go
 * RED (the field falls back to the class-field default 'rpc').
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { PiRpcSession } from '../pi-manager.js'
import { saveSlotStateSync, loadSlotState } from '../session-store.js'

describe('PiRpcSession transport (real instance)', () => {
  it('assigns an explicit non-default transport from opts', () => {
    const pi = new PiRpcSession('chat-teeth-1', { transport: 'sdk' })
    // The class-field default is 'rpc'; this MUST reflect the opts override.
    expect(pi.transport).toBe('sdk')
  })

  it('defaults to rpc when no transport is provided', () => {
    const pi = new PiRpcSession('chat-teeth-2', {})
    expect(pi.transport).toBe('rpc')
  })

  describe('survives saveSlotStateSync -> loadSlotState', () => {
    // Uses the real STATE_FILE; snapshot/restore so we don't clobber the
    // developer's actual dashboard state (mirrors session-store.test.js).
    const stateFile = join(homedir(), '.pi', 'agent', 'pi-web-sessions.json')
    let backup = null
    let existed = false

    beforeEach(() => {
      existed = existsSync(stateFile)
      backup = existed ? readFileSync(stateFile, 'utf-8') : null
    })
    afterEach(() => {
      if (existed) writeFileSync(stateFile, backup, 'utf-8')
      else if (existsSync(stateFile)) rmSync(stateFile)
    })

    it('persists a real session\'s explicit transport', () => {
      const pi = new PiRpcSession('chat-teeth-3', {
        transport: 'sdk',
        sessionFile: '/tmp/teeth.jsonl',
      })
      expect(pi.transport).toBe('sdk')

      const slots = new Map()
      slots.set('chat-teeth-3', pi)
      saveSlotStateSync(slots)

      const loaded = loadSlotState()
      const entry = loaded.find((s) => s.key === 'chat-teeth-3')
      expect(entry).toBeDefined()
      expect(entry.transport).toBe('sdk')
    })
  })
})
