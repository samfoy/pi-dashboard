/**
 * Tests for PiProcess class in pi-manager.js
 * Mocks child_process.spawn to avoid spawning real processes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock child_process before importing pi-manager
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// Mock fs operations used at module level (IMAGE_DIR creation, saveImagesToTemp)
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

// Mock session-store extractText
vi.mock('../session-store.js', () => ({
  extractText: (content, sep = '') => {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.filter(p => p.type === 'text').map(p => p.text || '').join(sep)
    }
    return ''
  },
}))

const { spawn } = await import('child_process')
const { PiProcess } = await import('../pi-manager.js')

/** Create a mock child process with EventEmitter behavior */
function createMockProc({ killed = false, exitCode = null, stdinWritable = true } = {}) {
  const proc = new EventEmitter()
  proc.killed = killed
  proc.exitCode = exitCode
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = {
    writable: stdinWritable,
    write: vi.fn(),
  }
  proc.kill = vi.fn(() => {
    proc.killed = true
  })
  return proc
}

describe('PiProcess', () => {
  let pi

  beforeEach(() => {
    vi.clearAllMocks()
    pi = new PiProcess('test-slot-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 1. Constructor defaults ──
  describe('constructor defaults', () => {
    it('has correct initial state', () => {
      expect(pi.running).toBe(false)
      expect(pi._stopping).toBe(false)
      expect(pi.ready).toBe(false)
      expect(pi.messages).toEqual([])
      expect(pi.slotKey).toBe('test-slot-1')
      expect(pi.proc).toBeNull()
      expect(pi.buffer).toBe('')
      expect(pi._pendingApproval).toBe(false)
      expect(pi._pendingRequests).toBeInstanceOf(Map)
      expect(pi._pendingRequests.size).toBe(0)
      expect(pi._stderrLines).toEqual([])
      expect(pi._title).toBeNull()
      expect(pi.sessionFile).toBeNull()
      expect(pi.agent).toBeNull()
    })

    it('accepts options', () => {
      const msgs = [{ role: 'user', content: 'hi' }]
      const pi2 = new PiProcess('slot-2', {
        messages: msgs,
        title: 'Test Chat',
        cwd: '/tmp',
        modelProvider: 'anthropic',
        modelId: 'claude-3',
      })
      expect(pi2.messages).toBe(msgs)
      expect(pi2._title).toBe('Test Chat')
      expect(pi2.cwd).toBe('/tmp')
      expect(pi2.modelProvider).toBe('anthropic')
      expect(pi2.modelId).toBe('claude-3')
    })
  })

  // ── 2. send() with dead process ──
  describe('send() with dead process', () => {
    it('returns false and emits agent_end when proc is killed', () => {
      const mockProc = createMockProc({ killed: true })
      pi.proc = mockProc
      pi.running = true
      pi._stopping = true

      const agentEndSpy = vi.fn()
      pi.on('agent_end', agentEndSpy)

      const result = pi.send({ type: 'prompt', message: 'hello' })

      expect(result).toBe(false)
      expect(pi.running).toBe(false)
      expect(pi._stopping).toBe(false)
      expect(agentEndSpy).toHaveBeenCalledWith({ messages: [] })
    })

    it('returns false when proc is null', () => {
      pi.proc = null
      const result = pi.send({ type: 'prompt', message: 'hello' })
      expect(result).toBe(false)
    })

    it('returns false when proc has non-null exitCode', () => {
      const mockProc = createMockProc({ exitCode: 1 })
      pi.proc = mockProc
      pi.running = true

      const agentEndSpy = vi.fn()
      pi.on('agent_end', agentEndSpy)

      const result = pi.send({ type: 'test' })
      expect(result).toBe(false)
      expect(agentEndSpy).toHaveBeenCalled()
    })

    it('does not emit agent_end if not running or stopping', () => {
      const mockProc = createMockProc({ killed: true })
      pi.proc = mockProc
      pi.running = false
      pi._stopping = false

      const agentEndSpy = vi.fn()
      pi.on('agent_end', agentEndSpy)

      pi.send({ type: 'test' })
      expect(agentEndSpy).not.toHaveBeenCalled()
    })
  })

  // ── 3. send() with live process ──
  describe('send() with live process', () => {
    it('writes JSON to stdin and returns true', () => {
      const mockProc = createMockProc()
      pi.proc = mockProc

      const cmd = { type: 'prompt', message: 'hello' }
      const result = pi.send(cmd)

      expect(result).toBe(true)
      expect(mockProc.stdin.write).toHaveBeenCalledWith(
        JSON.stringify(cmd) + '\n'
      )
    })
  })

  // ── 4. abort() with dead process ──
  describe('abort() with dead process', () => {
    it('resets state and emits agent_end immediately', () => {
      pi.proc = null
      pi.running = true
      pi._stopping = false

      const agentEndSpy = vi.fn()
      pi.on('agent_end', agentEndSpy)

      const result = pi.abort()

      expect(result).toBe(false)
      expect(pi.running).toBe(false)
      expect(pi._stopping).toBe(false)
      expect(pi._pendingApproval).toBe(false)
      expect(agentEndSpy).toHaveBeenCalledWith({ messages: [] })
    })
  })

  // ── 5. abort() with live process ──
  describe('abort() with live process', () => {
    it('sets _stopping and sends abort command', () => {
      const mockProc = createMockProc()
      pi.proc = mockProc

      const result = pi.abort()

      expect(pi._stopping).toBe(true)
      expect(result).toBe(true)
      expect(mockProc.stdin.write).toHaveBeenCalledWith(
        JSON.stringify({ type: 'abort' }) + '\n'
      )
    })
  })

  // ── 6. abort() watchdog ──
  describe('abort() watchdog', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('force-kills after 10s if still stopping', () => {
      const mockProc = createMockProc()
      pi.proc = mockProc
      pi._stopping = false

      // Spy on kill
      const killSpy = vi.spyOn(pi, 'kill').mockImplementation(() => {
        pi._stopping = false
      })

      pi.abort()
      expect(pi._stopping).toBe(true)

      // Advance time by 10 seconds
      vi.advanceTimersByTime(10000)

      expect(killSpy).toHaveBeenCalled()
    })

    it('does not force-kill if stopping resolved before 10s', () => {
      const mockProc = createMockProc()
      pi.proc = mockProc

      const killSpy = vi.spyOn(pi, 'kill')

      pi.abort()
      // Simulate agent_end arriving which clears _stopping
      pi._stopping = false

      vi.advanceTimersByTime(10000)

      expect(killSpy).not.toHaveBeenCalled()
    })
  })

  // ── 7. exit handler resets state ──
  describe('exit handler', () => {
    it('resets state on proc exit', () => {
      const mockProc = createMockProc()
      spawn.mockReturnValue(mockProc)

      pi.cwd = '/tmp'
      pi.start()

      // Set active state
      pi.running = true
      pi._stopping = true
      pi._pendingApproval = true

      // Simulate exit
      mockProc.emit('exit', 0)

      expect(pi.ready).toBe(false)
      expect(pi.running).toBe(false)
      expect(pi._stopping).toBe(false)
      expect(pi._pendingApproval).toBe(false)
    })

    it('emits exit event with code', () => {
      const mockProc = createMockProc()
      spawn.mockReturnValue(mockProc)

      pi.cwd = '/tmp'
      pi.start()

      const exitSpy = vi.fn()
      pi.on('exit', exitSpy)

      mockProc.emit('exit', 1)

      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ── 8. startup crash detection ──
  describe('startup crash detection', () => {
    it('emits startup_error if exit happens within 5s', () => {
      const mockProc = createMockProc()
      spawn.mockReturnValue(mockProc)

      pi.cwd = '/tmp'
      pi.start()

      const startupErrorSpy = vi.fn()
      pi.on('startup_error', startupErrorSpy)

      // Push some stderr before exit
      mockProc.stderr.emit('data', Buffer.from('Extension failed to load'))

      // Exit within 5s (the _startupTimer is still active)
      mockProc.emit('exit', 1)

      expect(startupErrorSpy).toHaveBeenCalledWith({
        code: 1,
        slotKey: 'test-slot-1',
        stderr: 'Extension failed to load',
      })
    })

    it('does not emit startup_error after 5s', () => {
      vi.useFakeTimers()
      const mockProc = createMockProc()
      spawn.mockReturnValue(mockProc)

      pi.cwd = '/tmp'
      pi.start()

      const startupErrorSpy = vi.fn()
      pi.on('startup_error', startupErrorSpy)

      // Advance past 5s to clear startup timer
      vi.advanceTimersByTime(5001)

      // Now exit
      mockProc.emit('exit', 1)

      expect(startupErrorSpy).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  // ── 9. kill() rejects pending requests ──
  describe('kill()', () => {
    it('resolves pending requests with null', () => {
      const mockProc = createMockProc()
      pi.proc = mockProc

      const resolve1 = vi.fn()
      const resolve2 = vi.fn()
      const timer1 = setTimeout(() => {}, 10000)
      const timer2 = setTimeout(() => {}, 10000)

      pi._pendingRequests.set('req-1', { resolve: resolve1, timer: timer1 })
      pi._pendingRequests.set('req-2', { resolve: resolve2, timer: timer2 })

      pi.kill()

      expect(resolve1).toHaveBeenCalledWith(null)
      expect(resolve2).toHaveBeenCalledWith(null)
      expect(pi._pendingRequests.size).toBe(0)
    })

    it('sends SIGTERM to the process', () => {
      const mockProc = createMockProc()
      pi.proc = mockProc

      pi.kill()

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')
    })
  })

  // ── 10. normalizeImages ──
  describe('normalizeImages (tested via prompt)', () => {
    it('normalizes standard image format', async () => {
      const mockProc = createMockProc()
      pi.proc = mockProc
      pi.running = false
      pi._readyPromise = null

      const images = [
        { mimeType: 'image/jpeg', data: 'abc123base64' },
      ]

      await pi.prompt('describe this', images)

      // The prompt command should have been sent with normalized images
      const writtenData = mockProc.stdin.write.mock.calls[0][0]
      const cmd = JSON.parse(writtenData.trim())
      expect(cmd.type).toBe('prompt')
      expect(cmd.images).toEqual([
        { type: 'image', mimeType: 'image/jpeg', data: 'abc123base64' },
      ])
    })

    it('normalizes Anthropic-style image format', async () => {
      const mockProc = createMockProc()
      pi.proc = mockProc
      pi.running = false
      pi._readyPromise = null

      const images = [
        { media_type: 'image/png', source: { data: 'pngdata123' } },
      ]

      await pi.prompt('look at this', images)

      const writtenData = mockProc.stdin.write.mock.calls[0][0]
      const cmd = JSON.parse(writtenData.trim())
      expect(cmd.images).toEqual([
        { type: 'image', mimeType: 'image/png', data: 'pngdata123' },
      ])
    })

    it('filters out images with empty data', async () => {
      const mockProc = createMockProc()
      pi.proc = mockProc
      pi.running = false
      pi._readyPromise = null

      const images = [
        { mimeType: 'image/jpeg', data: '' },
        { mimeType: 'image/png', data: 'realdata' },
      ]

      await pi.prompt('test', images)

      const writtenData = mockProc.stdin.write.mock.calls[0][0]
      const cmd = JSON.parse(writtenData.trim())
      expect(cmd.images).toEqual([
        { type: 'image', mimeType: 'image/png', data: 'realdata' },
      ])
    })
  })

  // ── _handleEvent tests ──
  describe('_handleEvent', () => {
    it('resolves pending request on response', () => {
      const resolve = vi.fn()
      const timer = setTimeout(() => {}, 10000)
      pi._pendingRequests.set('req-42', { resolve, timer })

      pi._handleEvent({ type: 'response', id: 'req-42', data: { ok: true } })

      expect(resolve).toHaveBeenCalledWith({ type: 'response', id: 'req-42', data: { ok: true } })
      expect(pi._pendingRequests.has('req-42')).toBe(false)
    })

    it('handles agent_start event', () => {
      const spy = vi.fn()
      pi.on('agent_start', spy)

      pi._handleEvent({ type: 'agent_start' })

      expect(pi.running).toBe(true)
      expect(pi._stopping).toBe(false)
      expect(spy).toHaveBeenCalled()
    })

    it('handles agent_end event and resets state', () => {
      pi.running = true
      pi._stopping = true
      const spy = vi.fn()
      pi.on('agent_end', spy)

      pi._handleEvent({ type: 'agent_end', messages: [] })

      expect(pi.running).toBe(false)
      expect(pi._stopping).toBe(false)
      expect(spy).toHaveBeenCalled()
    })
  })
})
