import { useEffect, useRef, useCallback } from 'react'
import { useAppDispatch } from '../store'
import { store } from '../store'
import { sseStatus, sseConnected, sseDisconnected, sseSlots, sseSlotTitle, triggerRefresh, fetchSlots, markSlotUnread } from '../store/dashboardSlice'
import { addNotification, ackNotificationByTs } from '../store/notificationsSlice'
import { fetchHistory, sseChatMessage, refreshSlot, setContextUsage, setTokenStats, setExtensionStatus } from '../store/chatSlice'
import type { StatusData, ChatSlot, Notification } from '../types'

type LogCallback = ((data: { level: string; msg: string }) => void) | null
export type FileChangeCallback = ((data: { path: string; content?: string; version?: number; deleted?: boolean }) => void) | null

/** Single multiplexed WebSocket replacing all SSE + polling connections. */
export function useWebSocket() {
  const dispatch = useAppDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const logCbRef = useRef<LogCallback>(null)
  const fileChangeCbRef = useRef<FileChangeCallback>(null)
  const reconnectRef = useRef(1000)
  const wasConnectedRef = useRef(false)
  const lastVersionRef = useRef<string | null>(null)

  const lastMessageRef = useRef<number>(Date.now())
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  const connect = useCallback(() => {
    // Cancel any pending reconnect timer to prevent parallel connections
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    // If already open or connecting, don't create another
    if (wsRef.current) {
      const rs = wsRef.current.readyState
      if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return
      // CLOSING or CLOSED — clean up
      try { wsRef.current.close() } catch {}
      wsRef.current = null
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}/api/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectRef.current = 1000
      lastMessageRef.current = Date.now()
      if (wasConnectedRef.current) {
        // Reconnecting after disconnect — re-fetch state instead of
        // reloading the page.  Preserves unsent messages, scroll
        // position, and form inputs.
        dispatch(sseConnected())
        dispatch(fetchSlots())
        // Re-fetch active slot messages to recover from missed chunks
        const active = store.getState().chat.activeSlot
        if (active) dispatch(refreshSlot(active))
        return
      }
      wasConnectedRef.current = true
      dispatch(sseConnected())
    }

    ws.onmessage = (e) => {
      if (cancelledRef.current) return
      lastMessageRef.current = Date.now()
      try {
        const msg = JSON.parse(e.data)
        const { type, data } = msg
        switch (type) {
          case 'dashboard': {
            // Detect server version change → full reload (actual update)
            const prev = lastVersionRef.current
            const next = (data as StatusData).version
            if (next) lastVersionRef.current = next
            if (prev && next && prev !== next) {
              window.location.reload()
              return
            }
            dispatch(sseStatus(data as StatusData))
            break
          }
          case 'slots':
            dispatch(sseSlots(data as ChatSlot[]))
            break
          case 'slot_title':
            dispatch(sseSlotTitle(data as { key: string; title: string }))
            break
          case 'notification':
            dispatch(addNotification(data as Notification))
            break
          case 'notification_ack':
            dispatch(ackNotificationByTs(data.ts))
            break
          case 'approval':
            dispatch(addNotification({
              kind: 'approval',
              title: `🔐 ${data.source}: Tool approval needed`,
              body: data.tool || 'Unknown tool',
              ts: data.id || String(Date.now()),
            } as Notification))
            break
          case 'refresh': {
            const kinds: string[] = data.kinds || []
            dispatch(triggerRefresh())
            if (kinds.includes('history')) dispatch(fetchHistory(false))
            break
          }
          case 'chat_message':
            dispatch(sseChatMessage(data))
            if (data.slot && data.slot !== store.getState().chat.activeSlot) dispatch(markSlotUnread(data.slot))
            break
          case 'chat_chunk':
            dispatch(sseChatMessage({ ...data, role: 'chunk', seq: data.seq }))
            if (data.slot && data.slot !== store.getState().chat.activeSlot) dispatch(markSlotUnread(data.slot))
            break
          case 'tool_call':
            dispatch(sseChatMessage({
              slot: data.slot, role: 'tool', content: `🔧 ${data.tool}`,
              meta: { toolName: data.tool, toolCallId: data.id, args: typeof data.args === 'string' ? data.args : JSON.stringify(data.args || {}, null, 2) },
            }))
            break
          case 'tool_result': {
            // Update the matching tool message with its result
            const state = store.getState()
            if (data.slot === state.chat.activeSlot) {
              // Find last tool message with matching id and update meta
              const msgs = state.chat.messages
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].role === 'tool' && (msgs[i].meta as any)?.toolCallId === data.id) {
                  dispatch(sseChatMessage({
                    slot: data.slot, role: '_tool_result',
                    content: '', meta: { toolCallId: data.id, result: data.result, isError: data.isError },
                  }))
                  break
                }
              }
            }
            break
          }
          case 'heartbeat':
            // Keep connection alive during long tool execution
            break
          case 'chat_done':
            dispatch(sseChatMessage({ ...data, role: '_done' }))
            // Skip refreshSlot — frontend already has complete streamed content.
            // Previously needed for missed chunks, but our WS is reliable enough.
            break
          case 'context_usage':
            dispatch(setContextUsage({ slot: data.slot, usage: { tokens: data.tokens, contextWindow: data.contextWindow, percent: data.percent } }))
            break
          case 'token_stats':
            dispatch(setTokenStats({ slot: data.slot, stats: { totalInputTokens: data.totalInputTokens, totalOutputTokens: data.totalOutputTokens, totalTokens: data.totalTokens, totalCost: data.totalCost, cacheReadTokens: data.cacheReadTokens, cacheWriteTokens: data.cacheWriteTokens } }))
            break
          case 'extension_status':
            dispatch(setExtensionStatus({ slot: data.slot, key: data.key, text: data.text }))
            break
          case 'log':
            logCbRef.current?.(data)
            break
          case 'file_changed':
            fileChangeCbRef.current?.(data as any)
            break
          case 'file_deleted':
            fileChangeCbRef.current?.({ ...(data as any), deleted: true })
            break
          case 'sessions_restarting':
            // Backend pushed session restart status (restarting/ready)
            dispatch(triggerRefresh())
            break
          case 'refine':
            // Handled by TasksPage via Redux
            dispatch(triggerRefresh())
            break
        }
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      // Only process if this is still the active connection
      if (wsRef.current !== ws) return
      dispatch(sseDisconnected())
      wsRef.current = null
      // Exponential backoff: 1s, 2s, 4s, max 10s
      const delay = reconnectRef.current
      reconnectRef.current = Math.min(delay * 2, 10000)
      // Cancel any existing reconnect timer before scheduling a new one
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => { /* onclose will fire */ }
  }, [dispatch])

  useEffect(() => {
    cancelledRef.current = false
    connect()

    // Health check: server sends dashboard status every 5s.
    // If we haven't received ANY message in 15s, the connection is dead.
    // This catches silent TCP drops on mobile (sleep, network switch).
    healthCheckRef.current = setInterval(() => {
      if (cancelledRef.current) return
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const silentMs = Date.now() - lastMessageRef.current
      if (silentMs > 15_000) {
        console.log('[ws] No messages in 15s — forcing reconnect')
        ws.close()
      }
    }, 5_000)

    // Reconnect immediately when the page becomes visible again.
    // iOS/Android suspend WebSocket connections when the app is backgrounded;
    // the socket may appear OPEN but is actually dead.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          // Already closed — reconnect immediately (skip backoff)
          reconnectRef.current = 0
          connect()
        } else {
          // Socket looks open — but it might be a zombie.
          // Reset the last-message timer so the health check can detect it.
          // Also proactively re-fetch state in case we missed events while suspended.
          lastMessageRef.current = Date.now()
          dispatch(fetchSlots())
          const active = store.getState().chat.activeSlot
          if (active) dispatch(refreshSlot(active))
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Also handle online/offline events (WiFi → cell transitions)
    const onOnline = () => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reconnectRef.current = 0
        connect()
      }
    }
    window.addEventListener('online', onOnline)

    return () => {
      cancelledRef.current = true
      wsRef.current?.close(); wsRef.current = null
      if (healthCheckRef.current) clearInterval(healthCheckRef.current)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [connect])

  /** Subscribe to log events — call with callback on mount, null on unmount. */
  const subscribeLogs = useCallback((cb: LogCallback) => {
    logCbRef.current = cb
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (cb) {
      ws.send(JSON.stringify({ type: 'subscribe_logs' }))
    } else {
      ws.send(JSON.stringify({ type: 'unsubscribe_logs' }))
    }
  }, [])

  const subscribeFileChange = useCallback((cb: FileChangeCallback) => {
    fileChangeCbRef.current = cb
  }, [])

  return { subscribeLogs, subscribeFileChange, wsRef }
}
