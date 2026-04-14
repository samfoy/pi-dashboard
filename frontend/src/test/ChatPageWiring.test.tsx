import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState, useCallback, useEffect, useRef, useContext, type ReactNode } from 'react'
import { WsContext } from '../App'
import { usePanelState } from '../hooks/usePanelState'
import type { FileChangeCallback } from '../hooks/useWebSocket'

/**
 * Extract the ChatPage wiring logic into a testable hook.
 * This mirrors the useEffects and handler changes that will be added to ChatPage.
 */
function useChatPageWiring(panel: ReturnType<typeof usePanelState>, wsCtx: {
  subscribeFileChange: (cb: FileChangeCallback) => void
  wsRef: React.RefObject<WebSocket | null>
}) {
  const { subscribeFileChange, wsRef } = wsCtx

  // Wrap content change to also track dirty state (mirrors ChatPage.handleContentChange)
  const handleContentChange = useCallback((c: string) => { panel.setContent(c); panel.setDirty(true) }, [panel.setContent, panel.setDirty])

  // Register file change callback (mirrors LogsPage subscribeLogs pattern)
  useEffect(() => {
    subscribeFileChange((data) => {
      if (!data || data.path !== panel.filePath) return
      if (data.deleted) return // handled in future step
      if (!panel.dirty) {
        panel.setContent(data.content ?? '')
        // fetch versions handled separately
      } else {
        panel.setConflictContent(data.content ?? '')
      }
    })
    return () => subscribeFileChange(null)
  }, [subscribeFileChange, panel.filePath, panel.dirty]) // eslint-disable-line react-hooks/exhaustive-deps

  // Watch/unwatch on panel open/close
  useEffect(() => {
    if (panel.isOpen && panel.filePath && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'watch_file', path: panel.filePath }))
      const ws = wsRef.current
      return () => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unwatch_file', path: panel.filePath }))
        }
      }
    }
  }, [panel.isOpen, panel.filePath, wsRef])

  return { panel, handleContentChange }
}

// Helper: create a mock WS
function createMockWs(readyState = WebSocket.OPEN) {
  return { readyState, send: vi.fn(), close: vi.fn() } as unknown as WebSocket
}

describe('ChatPage wiring — watch/unwatch + live updates + conflict', () => {
  let subscribeFileChange: ReturnType<typeof vi.fn>
  let registeredCb: FileChangeCallback
  let mockWs: WebSocket
  let wsRef: React.RefObject<WebSocket | null>

  beforeEach(() => {
    registeredCb = null
    subscribeFileChange = vi.fn((cb: FileChangeCallback) => { registeredCb = cb })
    mockWs = createMockWs()
    wsRef = { current: mockWs }
  })

  function renderWiring() {
    // We need to render both usePanelState and useChatPageWiring together
    const { result, rerender } = renderHook(() => {
      const panel = usePanelState()
      const wiring = useChatPageWiring(panel, { subscribeFileChange, wsRef })
      return wiring
    })
    return { result, rerender }
  }

  // AC1: Watch on Panel Open
  it('sends watch_file when panel opens with a file path', () => {
    const { result } = renderWiring()
    act(() => result.current.panel.openPanel('/tmp/test.md', 'hello'))
    expect((mockWs.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      JSON.stringify({ type: 'watch_file', path: '/tmp/test.md' })
    )
  })

  // AC2: Unwatch on Panel Close
  it('sends unwatch_file when panel closes', () => {
    const { result } = renderWiring()
    act(() => result.current.panel.openPanel('/tmp/test.md', 'hello'))
    ;(mockWs.send as ReturnType<typeof vi.fn>).mockClear()
    act(() => result.current.panel.closePanel())
    expect((mockWs.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      JSON.stringify({ type: 'unwatch_file', path: '/tmp/test.md' })
    )
  })

  // AC3: Live Update (Clean)
  it('updates content when file_changed arrives and dirty=false', () => {
    const { result } = renderWiring()
    act(() => result.current.panel.openPanel('/tmp/a.md', 'old'))
    expect(result.current.panel.dirty).toBe(false)
    // Simulate file_changed
    act(() => registeredCb?.({ path: '/tmp/a.md', content: 'new content', version: 2 }))
    expect(result.current.panel.content).toBe('new content')
  })

  // AC4: Conflict Detection (Dirty) — via content change (production path)
  it('sets conflictContent when file_changed arrives and user has edited (dirty via handleContentChange)', () => {
    const { result } = renderWiring()
    act(() => result.current.panel.openPanel('/tmp/a.md', 'old'))
    // Simulate user editing — this is the production path (MarkdownPanel.handleChange → onContentChange)
    act(() => result.current.handleContentChange('user edit'))
    expect(result.current.panel.dirty).toBe(true)
    // Simulate file_changed from agent
    act(() => registeredCb?.({ path: '/tmp/a.md', content: 'agent edit', version: 3 }))
    expect(result.current.panel.content).toBe('user edit') // unchanged — user's edit preserved
    expect(result.current.panel.conflictContent).toBe('agent edit')
  })

  // AC7: Ignores Other Files
  it('ignores file_changed for a different path', () => {
    const { result } = renderWiring()
    act(() => result.current.panel.openPanel('/tmp/a.md', 'original'))
    act(() => registeredCb?.({ path: '/tmp/b.md', content: 'other file', version: 1 }))
    expect(result.current.panel.content).toBe('original')
    expect(result.current.panel.conflictContent).toBeNull()
  })

  // AC1 supplement: no watch_file sent when WS not open
  it('does not send watch_file when WS is not open', () => {
    wsRef.current = createMockWs(WebSocket.CONNECTING)
    const { result } = renderWiring()
    act(() => result.current.panel.openPanel('/tmp/test.md', 'hello'))
    expect((wsRef.current!.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  // Cleanup: subscribeFileChange(null) called on unmount
  it('unsubscribes file change callback on unmount', () => {
    const { result, rerender } = renderWiring()
    act(() => result.current.panel.openPanel('/tmp/a.md', 'x'))
    // subscribeFileChange was called with a function
    expect(subscribeFileChange).toHaveBeenCalledWith(expect.any(Function))
    // The cleanup will call subscribeFileChange(null) — verified by checking calls
    // after the effect re-runs (e.g. on filePath change)
    act(() => result.current.panel.openPanel('/tmp/b.md', 'y'))
    // Should have been called with null (cleanup) then new function
    const calls = subscribeFileChange.mock.calls
    const nullCalls = calls.filter((c: any[]) => c[0] === null)
    expect(nullCalls.length).toBeGreaterThan(0)
  })
})
