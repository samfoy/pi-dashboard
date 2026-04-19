import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLogSSE } from '../hooks/useLogSSE'

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent)
  }

  simulateError() {
    this.onerror?.()
  }
}

describe('useLogSSE', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('creates EventSource on mount', () => {
    const onMessage = vi.fn()
    renderHook(() => useLogSSE(onMessage))

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/logs')
  })

  it('calls onMessage when receiving data', () => {
    const onMessage = vi.fn()
    renderHook(() => useLogSSE(onMessage))

    const es = MockEventSource.instances[0]
    es.simulateMessage(JSON.stringify({ level: 'info', msg: 'hello' }))

    expect(onMessage).toHaveBeenCalledWith({ level: 'info', msg: 'hello' })
  })

  it('handles multiple messages', () => {
    const onMessage = vi.fn()
    renderHook(() => useLogSSE(onMessage))

    const es = MockEventSource.instances[0]
    es.simulateMessage(JSON.stringify({ level: 'info', msg: 'first' }))
    es.simulateMessage(JSON.stringify({ level: 'warn', msg: 'second' }))

    expect(onMessage).toHaveBeenCalledTimes(2)
  })

  it('ignores malformed JSON', () => {
    const onMessage = vi.fn()
    renderHook(() => useLogSSE(onMessage))

    const es = MockEventSource.instances[0]
    es.simulateMessage('not json')

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('closes EventSource on unmount', () => {
    const onMessage = vi.fn()
    const { unmount } = renderHook(() => useLogSSE(onMessage))

    const es = MockEventSource.instances[0]
    expect(es.closed).toBe(false)

    unmount()
    expect(es.closed).toBe(true)
  })

  it('reconnects after error with 3s delay', () => {
    const onMessage = vi.fn()
    renderHook(() => useLogSSE(onMessage))

    expect(MockEventSource.instances).toHaveLength(1)
    const es = MockEventSource.instances[0]

    // Simulate error
    es.simulateError()
    expect(es.closed).toBe(true)

    // Should not reconnect immediately
    expect(MockEventSource.instances).toHaveLength(1)

    // Advance timer past reconnect delay
    act(() => { vi.advanceTimersByTime(3000) })
    expect(MockEventSource.instances).toHaveLength(2)
    expect(MockEventSource.instances[1].url).toBe('/api/logs')
  })

  it('uses latest callback reference', () => {
    const onMessage1 = vi.fn()
    const onMessage2 = vi.fn()

    const { rerender } = renderHook(
      ({ cb }) => useLogSSE(cb),
      { initialProps: { cb: onMessage1 } },
    )

    // Update the callback
    rerender({ cb: onMessage2 })

    const es = MockEventSource.instances[0]
    es.simulateMessage(JSON.stringify({ level: 'info', msg: 'test' }))

    expect(onMessage1).not.toHaveBeenCalled()
    expect(onMessage2).toHaveBeenCalledWith({ level: 'info', msg: 'test' })
  })
})
