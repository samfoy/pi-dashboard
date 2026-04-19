import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { Provider } from 'react-redux'
import { createTestStore } from './helpers'

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------
type WSListener = (e: any) => void

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState = MockWebSocket.CONNECTING
  onopen: WSListener | null = null
  onclose: WSListener | null = null
  onerror: WSListener | null = null
  onmessage: WSListener | null = null
  sentMessages: string[] = []
  closed = false

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.closed = true
    this.onclose?.({})
  }

  // --- Test helpers ---
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.({})
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateError() {
    this.onerror?.({})
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.closed = true
    this.onclose?.({})
  }
}

// We need to mock `store` from '../store' so the hook's direct getState() calls
// use our test store. We'll set a global ref that the mock reads.
let testStoreRef: ReturnType<typeof createTestStore> | null = null

vi.mock('../store', async (importOriginal) => {
  const orig: any = await importOriginal()
  return {
    ...orig,
    get store() {
      return testStoreRef ?? orig.store
    },
  }
})

// Import the hook AFTER vi.mock is set up (vitest hoists vi.mock)
import { useWebSocket } from '../hooks/useWebSocket'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function latestWS(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

function renderWebSocketHook(storeOverride?: ReturnType<typeof createTestStore>) {
  const testStore = storeOverride ?? createTestStore()
  testStoreRef = testStore

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(Provider, { store: testStore }, children)

  const hookResult = renderHook(() => useWebSocket(), { wrapper })
  return { ...hookResult, store: testStore }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    // Provide static constants that the hook reads via WebSocket.OPEN etc.
    ;(globalThis as any).WebSocket.OPEN = MockWebSocket.OPEN
    ;(globalThis as any).WebSocket.CONNECTING = MockWebSocket.CONNECTING
    ;(globalThis as any).WebSocket.CLOSING = MockWebSocket.CLOSING
    ;(globalThis as any).WebSocket.CLOSED = MockWebSocket.CLOSED
    vi.useFakeTimers()
    // Default location
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000', reload: vi.fn() })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    testStoreRef = null
  })

  // -----------------------------------------------------------------------
  // URL construction
  // -----------------------------------------------------------------------
  describe('URL construction', () => {
    it('builds ws:// URL from http: protocol', () => {
      renderWebSocketHook()
      expect(latestWS().url).toBe('ws://localhost:3000/api/ws')
    })

    it('builds wss:// URL from https: protocol', () => {
      vi.stubGlobal('location', { protocol: 'https:', host: 'example.com', reload: vi.fn() })
      renderWebSocketHook()
      expect(latestWS().url).toBe('wss://example.com/api/ws')
    })
  })

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------
  describe('connection lifecycle', () => {
    it('creates a WebSocket on mount', () => {
      renderWebSocketHook()
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('dispatches sseConnected on open', () => {
      const { store } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())
      expect(store.getState().dashboard.connected).toBe(true)
    })

    it('dispatches sseDisconnected on close', () => {
      const { store } = renderWebSocketHook()
      act(() => {
        latestWS().simulateOpen()
      })
      act(() => {
        latestWS().simulateClose()
      })
      expect(store.getState().dashboard.connected).toBe(false)
    })

    it('closes WebSocket on unmount', () => {
      const { unmount } = renderWebSocketHook()
      const ws = latestWS()
      act(() => ws.simulateOpen())
      unmount()
      expect(ws.closed).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Reconnection
  // -----------------------------------------------------------------------
  describe('reconnection', () => {
    it('reconnects after close with initial 1s delay', () => {
      renderWebSocketHook()
      act(() => latestWS().simulateOpen())
      act(() => latestWS().simulateClose())
      expect(MockWebSocket.instances).toHaveLength(1) // not yet
      act(() => vi.advanceTimersByTime(1000))
      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('uses exponential backoff: 1s, 2s, 4s, capped at 10s', () => {
      renderWebSocketHook()
      // Backoff only applies for consecutive closes without successful open.
      // First connect opens, then we close — 1s backoff.
      act(() => latestWS().simulateOpen())
      act(() => latestWS().simulateClose())
      act(() => vi.advanceTimersByTime(1000))
      expect(MockWebSocket.instances).toHaveLength(2)

      // Second close WITHOUT open → 2s
      act(() => latestWS().simulateClose())
      act(() => vi.advanceTimersByTime(1999))
      expect(MockWebSocket.instances).toHaveLength(2) // not yet
      act(() => vi.advanceTimersByTime(1))
      expect(MockWebSocket.instances).toHaveLength(3)

      // Third close WITHOUT open → 4s
      act(() => latestWS().simulateClose())
      act(() => vi.advanceTimersByTime(4000))
      expect(MockWebSocket.instances).toHaveLength(4)

      // Fourth close → 8s
      act(() => latestWS().simulateClose())
      act(() => vi.advanceTimersByTime(8000))
      expect(MockWebSocket.instances).toHaveLength(5)

      // Fifth close → capped at 10s (16 capped to 10)
      act(() => latestWS().simulateClose())
      act(() => vi.advanceTimersByTime(10000))
      expect(MockWebSocket.instances).toHaveLength(6)
    })

    it('resets backoff after successful open', () => {
      renderWebSocketHook()
      // First close → 1s, reconnect → open resets backoff
      act(() => latestWS().simulateOpen())
      act(() => latestWS().simulateClose())
      act(() => vi.advanceTimersByTime(1000))
      // Reconnected — open it, which resets the delay to 1000
      act(() => latestWS().simulateOpen())
      // Close again → should be 1s again (not 2s)
      act(() => latestWS().simulateClose())
      act(() => vi.advanceTimersByTime(1000))
      expect(MockWebSocket.instances).toHaveLength(3)
    })

    it('re-fetches state on reconnection (wasConnected = true)', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)

      // First connect
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      // Close and reconnect
      act(() => latestWS().simulateClose())
      act(() => vi.advanceTimersByTime(1000))
      act(() => latestWS().simulateOpen())

      // Should dispatch sseConnected + fetchSlots
      const types = dispatchSpy.mock.calls.map(c => {
        const action = c[0] as any
        return typeof action === 'function' ? 'thunk' : action?.type
      })
      expect(types).toContain('dashboard/sseConnected')
      expect(types.some(t => t === 'thunk' || t?.includes('fetchSlots'))).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Message parsing & dispatch
  // -----------------------------------------------------------------------
  describe('message handling', () => {
    it('dispatches sseStatus for dashboard messages', () => {
      const { store } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())
      act(() => latestWS().simulateMessage({ type: 'dashboard', data: { version: '1.0', slots: [] } }))
      const state = store.getState().dashboard
      expect(state.status).toBeTruthy()
    })

    it('dispatches sseSlots for slots messages', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'slots',
        data: [{ key: 'slot1', title: 'Test', provider: 'test', model: 'test', status: 'idle' }],
      }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toContain('dashboard/sseSlots')
    })

    it('dispatches sseSlotTitle for slot_title messages', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'slot_title',
        data: { key: 'slot1', title: 'New Title' },
      }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toContain('dashboard/sseSlotTitle')
    })

    it('dispatches addNotification for notification messages', () => {
      const { store } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      act(() => latestWS().simulateMessage({
        type: 'notification',
        data: { kind: 'info', title: 'Test', body: 'hello', ts: '123' },
      }))

      expect(store.getState().notifications.items).toHaveLength(1)
      expect(store.getState().notifications.items[0].title).toBe('Test')
    })

    it('dispatches addNotification for approval messages', () => {
      const { store } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      act(() => latestWS().simulateMessage({
        type: 'approval',
        data: { source: 'pi', tool: 'bash', id: 'abc123' },
      }))

      const item = store.getState().notifications.items[0]
      expect(item.kind).toBe('approval')
      expect(item.title).toContain('Tool approval needed')
    })

    it('dispatches ackNotificationByTs for notification_ack messages', () => {
      const { store } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      // Add a notification first, then ack it
      act(() => latestWS().simulateMessage({
        type: 'notification',
        data: { kind: 'info', title: 'Test', body: 'x', ts: 'ts1' },
      }))
      expect(store.getState().notifications.items).toHaveLength(1)

      act(() => latestWS().simulateMessage({
        type: 'notification_ack',
        data: { ts: 'ts1' },
      }))
      expect(store.getState().notifications.items[0].acked).toBe(true)
    })

    it('dispatches sseChatMessage for chat_message', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'chat_message',
        data: { slot: 'slot1', role: 'assistant', content: 'Hello' },
      }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toContain('chat/sseChatMessage')
    })

    it('dispatches sseChatMessage with role=chunk for chat_chunk', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'chat_chunk',
        data: { slot: 'slot1', content: 'Hi', seq: 1 },
      }))

      const payloads = dispatchSpy.mock.calls.map(c => (c[0] as any)?.payload).filter(Boolean)
      expect(payloads.some((p: any) => p.role === 'chunk')).toBe(true)
    })

    it('dispatches tool_call as sseChatMessage with tool role', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'tool_call',
        data: { slot: 'slot1', tool: 'bash', id: 'tc1', args: { command: 'ls' } },
      }))

      const payloads = dispatchSpy.mock.calls.map(c => (c[0] as any)?.payload).filter(Boolean)
      expect(payloads.some((p: any) => p.role === 'tool' && p.content?.includes('bash'))).toBe(true)
    })

    it('dispatches _done role for chat_done', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'chat_done',
        data: { slot: 'slot1' },
      }))

      const payloads = dispatchSpy.mock.calls.map(c => (c[0] as any)?.payload).filter(Boolean)
      expect(payloads.some((p: any) => p.role === '_done')).toBe(true)
    })

    it('dispatches setContextUsage for context_usage messages', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'context_usage',
        data: { slot: 'slot1', tokens: 5000, contextWindow: 200000, percent: 2.5 },
      }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toContain('chat/setContextUsage')
    })

    it('dispatches setExtensionStatus for extension_status messages', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'extension_status',
        data: { slot: 'slot1', key: 'ext1', text: 'Loading...' },
      }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toContain('chat/setExtensionStatus')
    })

    it('dispatches triggerRefresh for refresh messages', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'refresh',
        data: { kinds: [] },
      }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toContain('dashboard/triggerRefresh')
    })

    it('dispatches fetchHistory when refresh includes history kind', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'refresh',
        data: { kinds: ['history'] },
      }))

      const types = dispatchSpy.mock.calls.map(c => {
        const action = c[0] as any
        return typeof action === 'function' ? 'thunk' : action?.type
      })
      expect(types).toContain('dashboard/triggerRefresh')
      expect(types.some(t => t === 'thunk' || t?.includes('fetchHistory'))).toBe(true)
    })

    it('ignores malformed JSON messages', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      // Send raw string (not through simulateMessage which auto-JSON-stringifies)
      act(() => {
        const ws = latestWS()
        ws.onmessage?.({ data: 'not valid json' })
      })

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toHaveLength(0)
    })

    it('ignores heartbeat messages silently', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({ type: 'heartbeat', data: {} }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toHaveLength(0)
    })

    it('calls log callback for log messages', () => {
      const { result } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      const logCb = vi.fn()
      act(() => result.current.subscribeLogs(logCb))

      act(() => latestWS().simulateMessage({
        type: 'log',
        data: { level: 'info', msg: 'test log' },
      }))

      expect(logCb).toHaveBeenCalledWith({ level: 'info', msg: 'test log' })
    })

    it('calls fileChange callback for file_changed messages', () => {
      const { result } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      const fileCb = vi.fn()
      act(() => result.current.subscribeFileChange(fileCb))

      act(() => latestWS().simulateMessage({
        type: 'file_changed',
        data: { path: '/test.ts', content: 'hello', version: 1 },
      }))

      expect(fileCb).toHaveBeenCalledWith({ path: '/test.ts', content: 'hello', version: 1 })
    })

    it('calls fileChange callback with deleted flag for file_deleted messages', () => {
      const { result } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      const fileCb = vi.fn()
      act(() => result.current.subscribeFileChange(fileCb))

      act(() => latestWS().simulateMessage({
        type: 'file_deleted',
        data: { path: '/test.ts' },
      }))

      expect(fileCb).toHaveBeenCalledWith(expect.objectContaining({ path: '/test.ts', deleted: true }))
    })

    it('triggers page reload on server version change', () => {
      const reloadFn = vi.fn()
      vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000', reload: reloadFn })
      renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      // First dashboard message sets version
      act(() => latestWS().simulateMessage({ type: 'dashboard', data: { version: '1.0' } }))
      expect(reloadFn).not.toHaveBeenCalled()

      // Same version — no reload
      act(() => latestWS().simulateMessage({ type: 'dashboard', data: { version: '1.0' } }))
      expect(reloadFn).not.toHaveBeenCalled()

      // Different version → reload
      act(() => latestWS().simulateMessage({ type: 'dashboard', data: { version: '2.0' } }))
      expect(reloadFn).toHaveBeenCalledTimes(1)
    })

    it('marks slot unread for chat_message targeting non-active slot', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'chat_message',
        data: { slot: 'other-slot', role: 'assistant', content: 'Hi' },
      }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toContain('dashboard/markSlotUnread')
    })

    it('dispatches triggerRefresh for sessions_restarting messages', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => latestWS().simulateMessage({
        type: 'sessions_restarting',
        data: { status: 'restarting' },
      }))

      const types = dispatchSpy.mock.calls.map(c => (c[0] as any)?.type).filter(Boolean)
      expect(types).toContain('dashboard/triggerRefresh')
    })
  })

  // -----------------------------------------------------------------------
  // Visibility & online events
  // -----------------------------------------------------------------------
  describe('visibility and online events', () => {
    it('reconnects immediately when page becomes visible and WS is closed', () => {
      renderWebSocketHook()
      act(() => latestWS().simulateOpen())
      act(() => latestWS().simulateClose())

      const countBefore = MockWebSocket.instances.length

      // Simulate page becoming visible
      act(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Should reconnect immediately (skip backoff)
      expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore)
    })

    it('re-fetches state when page becomes visible and WS is still open', () => {
      const testStore = createTestStore()
      const dispatchSpy = vi.spyOn(testStore, 'dispatch')
      renderWebSocketHook(testStore)
      act(() => latestWS().simulateOpen())
      dispatchSpy.mockClear()

      act(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Should dispatch fetchSlots to refresh state
      const hasThunk = dispatchSpy.mock.calls.some(c => typeof c[0] === 'function')
      expect(hasThunk).toBe(true)
    })

    it('reconnects on online event when WS is closed', () => {
      renderWebSocketHook()
      act(() => latestWS().simulateOpen())
      act(() => latestWS().simulateClose())

      const countBefore = MockWebSocket.instances.length

      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore)
    })

    it('does NOT reconnect on online event when WS is already open', () => {
      renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      const countBefore = MockWebSocket.instances.length

      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(MockWebSocket.instances.length).toBe(countBefore)
    })

    it('removes event listeners on unmount', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      const winRemoveSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = renderWebSocketHook()
      unmount()

      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      expect(winRemoveSpy).toHaveBeenCalledWith('online', expect.any(Function))

      removeSpy.mockRestore()
      winRemoveSpy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------
  describe('health check', () => {
    it('closes WS if no messages received in 15s', () => {
      renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      const ws = latestWS()

      // Advance 15s+ without any messages → health check should close
      act(() => vi.advanceTimersByTime(20_000))

      expect(ws.closed).toBe(true)
    })

    it('does NOT close WS if messages keep arriving', () => {
      renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      const ws = latestWS()

      // Send messages every 4s to keep alive
      for (let i = 0; i < 5; i++) {
        act(() => vi.advanceTimersByTime(4000))
        act(() => ws.simulateMessage({ type: 'heartbeat', data: {} }))
      }

      // 20s passed but messages kept coming — should still be open
      expect(ws.closed).toBe(false)
    })

    it('clears health check interval on unmount', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearInterval')
      const { unmount } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      unmount()

      expect(clearSpy).toHaveBeenCalled()
      clearSpy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // subscribeLogs
  // -----------------------------------------------------------------------
  describe('subscribeLogs', () => {
    it('sends subscribe_logs message when callback is set', () => {
      const { result } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      const ws = latestWS()
      act(() => result.current.subscribeLogs(() => {}))

      expect(ws.sentMessages).toContain(JSON.stringify({ type: 'subscribe_logs' }))
    })

    it('sends unsubscribe_logs message when callback is null', () => {
      const { result } = renderWebSocketHook()
      act(() => latestWS().simulateOpen())

      // Subscribe first
      act(() => result.current.subscribeLogs(() => {}))
      // Then unsubscribe
      const ws = latestWS()
      act(() => result.current.subscribeLogs(null))

      expect(ws.sentMessages).toContain(JSON.stringify({ type: 'unsubscribe_logs' }))
    })

    it('does not send if WS is not open', () => {
      const { result } = renderWebSocketHook()
      // Don't open the WS

      act(() => result.current.subscribeLogs(() => {}))
      expect(latestWS().sentMessages).toHaveLength(0)
    })
  })
})
