import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { createTestStore } from './helpers'

// We need to test the fmt function indirectly through the hook
// and the hook behavior with different start_time values
import { useUptime } from '../hooks/useUptime'

function createWrapper(startTime?: number) {
  const store = createTestStore({
    dashboard: {
      status: startTime !== undefined ? { uptime: '', sessions: 0, messages: 0, cron_jobs: 0, subagents: 0, lessons: 0, start_time: startTime } : null,
      connected: true,
      slots: [],
      approvalMode: 'normal',
      refreshTrigger: 0,
      unreadSlots: [],
    },
  } as any)

  return ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  )
}

describe('useUptime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "—" when no status/start_time', () => {
    const { result } = renderHook(() => useUptime(), {
      wrapper: createWrapper(),
    })
    expect(result.current).toBe('—')
  })

  it('formats uptime with minutes and seconds', () => {
    // Set start_time to 65 seconds ago
    const now = Math.floor(Date.now() / 1000)
    const { result } = renderHook(() => useUptime(), {
      wrapper: createWrapper(now - 65),
    })
    expect(result.current).toBe('1m 5s')
  })

  it('formats uptime with hours', () => {
    const now = Math.floor(Date.now() / 1000)
    // 1 hour, 2 minutes, 3 seconds ago
    const { result } = renderHook(() => useUptime(), {
      wrapper: createWrapper(now - 3723),
    })
    expect(result.current).toBe('1h 2m 3s')
  })

  it('formats zero uptime', () => {
    const now = Math.floor(Date.now() / 1000)
    const { result } = renderHook(() => useUptime(), {
      wrapper: createWrapper(now),
    })
    expect(result.current).toBe('0m 0s')
  })

  it('ticks every second', () => {
    const now = Math.floor(Date.now() / 1000)
    const { result } = renderHook(() => useUptime(), {
      wrapper: createWrapper(now),
    })

    expect(result.current).toBe('0m 0s')

    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe('0m 1s')

    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe('0m 2s')
  })
})
