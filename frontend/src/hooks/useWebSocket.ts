import { useEffect, useRef, useCallback } from 'react'
import { useAppDispatch } from '../store'
import { store } from '../store'
import { sseStatus, sseConnected, sseDisconnected, sseSlots, sseSlotTitle, triggerRefresh, fetchSlots, markSlotUnread } from '../store/dashboardSlice'
import { addNotification, ackNotificationByTs } from '../store/notificationsSlice'
import { fetchHistory, sseChatMessage, refreshSlot } from '../store/chatSlice'
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

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}/api/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectRef.current = 1000
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
      dispatch(sseDisconnected())
      wsRef.current = null
      // Exponential backoff: 1s, 2s, 4s, max 10s
      const delay = reconnectRef.current
      reconnectRef.current = Math.min(delay * 2, 10000)
      setTimeout(connect, delay)
    }

    ws.onerror = () => { /* onclose will fire */ }
  }, [dispatch])

  useEffect(() => {
    connect()
    return () => { wsRef.current?.close(); wsRef.current = null }
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
