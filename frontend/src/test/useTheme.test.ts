import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../hooks/useTheme'

function mockMatchMedia(matches: boolean) {
  const listeners: Array<() => void> = []
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, cb: () => void) => listeners.push(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }),
  }
  window.matchMedia = vi.fn().mockReturnValue(mql)
  return {
    mql,
    listeners,
    setMatches: (v: boolean) => {
      mql.matches = v
      listeners.forEach(cb => cb())
    },
  }
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('defaults to system preference (dark OS)', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    expect(result.current.theme).toBe('dark')
  })

  it('defaults to system preference (light OS)', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    expect(result.current.theme).toBe('light')
  })

  it('reads explicit preference from localStorage', () => {
    mockMatchMedia(true)
    localStorage.setItem('mc-theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('light')
    expect(result.current.theme).toBe('light')
  })

  it('cycle rotates system -> light -> dark -> system', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')

    act(() => result.current.cycle())
    expect(result.current.preference).toBe('light')

    act(() => result.current.cycle())
    expect(result.current.preference).toBe('dark')

    act(() => result.current.cycle())
    expect(result.current.preference).toBe('system')
  })

  it('persists preference to localStorage', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('light'))
    expect(localStorage.getItem('mc-theme')).toBe('light')
  })

  it('reacts to OS theme change when preference is system', () => {
    const { setMatches } = mockMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')

    act(() => setMatches(false))
    expect(result.current.theme).toBe('light')
  })

  it('ignores OS change when preference is explicit', () => {
    const { setMatches } = mockMatchMedia(true)
    localStorage.setItem('mc-theme', 'dark')
    const { result } = renderHook(() => useTheme())

    act(() => setMatches(false))
    expect(result.current.theme).toBe('dark')
  })

  it('sets data-theme on document element', () => {
    mockMatchMedia(true)
    renderHook(() => useTheme())
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
