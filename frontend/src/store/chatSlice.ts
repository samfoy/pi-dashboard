import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import { api } from '../api/client'
import { addSlotOptimistic, removeSlotOptimistic, markSlotRead, fetchSlots } from './dashboardSlice'
import type { ChatMessage, SessionInfo } from '../types'

const SKIP_ROLES = new Set(['chunk', 'done'])
const MAX_MESSAGES_PER_SESSION = 500

const filterMessages = (msgs: ChatMessage[]) => msgs.filter(m => !SKIP_ROLES.has(m.role))

type SlotState = 'idle' | 'streaming' | 'tool_running' | 'stopping'

export interface ContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

interface ChatState {
  activeSlot: string | null
  messages: ChatMessage[]
  slotRunning: boolean
  slotStopping: boolean
  slotState: SlotState
  slotHasMore: boolean
  slotOldestIndex: number
  loadingOlder: boolean
  history: SessionInfo[]
  historyHasMore: boolean
  historyOffset: number
  pendingInput: string | null
  _resendQueued: string | null
  contextUsage: ContextUsage | null
  extensionStatuses: Record<string, string>
  _lastChunkSeq: number
  slotSwitching: boolean
}

const initialState: ChatState = {
  activeSlot: null,
  messages: [],
  slotRunning: false,
  slotStopping: false,
  slotState: 'idle',
  slotHasMore: false,
  slotOldestIndex: 0,
  loadingOlder: false,
  history: [],
  historyHasMore: false,
  historyOffset: 0,
  pendingInput: null,
  _resendQueued: null,
  contextUsage: null,
  extensionStatuses: {},
  _lastChunkSeq: -1,
  slotSwitching: false,
}

export const fetchHistory = createAsyncThunk(
  'chat/fetchHistory',
  async (append: boolean, { getState }) => {
    const state = (getState() as { chat: ChatState }).chat
    const offset = append ? state.historyOffset : 0
    const d = await api.sessions(30, offset)
    return { sessions: (d.sessions || d) as SessionInfo[], hasMore: d.has_more || false, offset, append }
  },
)

export const switchSlot = createAsyncThunk(
  'chat/switchSlot',
  async (key: string | null, { dispatch }) => {
    if (!key) return { key: null, messages: [], running: false, stopping: false, hasMore: false, total: 0, contextUsage: null }
    dispatch(markSlotRead(key))
    const d = await api.chatSlotDetail(key, 200)
    return { key, messages: filterMessages(d.messages || []), running: d.running || false, stopping: d.stopping || false, hasMore: d.has_more || false, total: d.total || 0, contextUsage: d.contextUsage || null }
  },
)

/** Re-fetch messages for a slot without changing activeSlot. Only applies if still active. */
export const refreshSlot = createAsyncThunk(
  'chat/refreshSlot',
  async (key: string, { getState }) => {
    const state = (getState() as { chat: ChatState }).chat
    if (state.activeSlot !== key) return null
    const d = await api.chatSlotDetail(key, 200)
    return { key, messages: filterMessages(d.messages || []), running: d.running || false, stopping: d.stopping || false, hasMore: d.has_more || false, total: d.total || 0, contextUsage: d.contextUsage || null }
  },
)

export const createSlot = createAsyncThunk(
  'chat/createSlot',
  async (opts: { agent?: string; model?: string; cwd?: string } | undefined, { dispatch }) => {
    const slot = await api.createChatSlot(undefined, opts?.agent, opts?.model, opts?.cwd)
    dispatch(addSlotOptimistic(slot))
    return slot
  },
)

export const deleteSlot = createAsyncThunk(
  'chat/deleteSlot',
  async (key: string, { dispatch }) => {
    dispatch(removeSlotOptimistic(key))
    try {
      await api.deleteChatSlot(key)
    } catch {
      // Save failed — backend restored the slot; re-fetch to sync UI
      dispatch(fetchSlots())
      throw new Error('save failed')
    }
    return key
  },
)

export const resumeFromHistory = createAsyncThunk(
  'chat/resumeFromHistory',
  async ({ key, title }: { key: string; title: string }, { dispatch }) => {
    const d = await api.resumeChatSlot(key, title)
    if (d.ok) dispatch(addSlotOptimistic({ key: d.key, title: title || d.key, messages: 0, running: false }))
    return { ok: d.ok, key: d.key, messages: filterMessages(d.messages || []), hasMore: d.has_more || false, total: d.total || 0 }
  },
)

export const deleteHistorySession = createAsyncThunk(
  'chat/deleteHistorySession',
  async (key: string) => { await api.deleteSession(key); return key },
)

export const loadOlderMessages = createAsyncThunk(
  'chat/loadOlder',
  async (_, { getState }) => {
    const state = (getState() as { chat: ChatState }).chat
    if (!state.activeSlot || !state.slotHasMore || state.loadingOlder) return null
    if (state.slotOldestIndex <= 0) return null
    const d = await api.chatSlotDetail(state.activeSlot, 100, state.slotOldestIndex)
    return { messages: filterMessages(d.messages || []), hasMore: d.has_more || false, total: d.total || 0 }
  },
)

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setActiveSlot(state, action: PayloadAction<string | null>) { state.activeSlot = action.payload },
    setPendingInput(state, action: PayloadAction<string | null>) { state.pendingInput = action.payload },
    clearResendQueued(state) { state._resendQueued = null },
    promoteQueued(state) { for (const m of state.messages) { if (m.role === 'queued') m.role = 'user' } },
    appendMessage(state, action: PayloadAction<ChatMessage>) {
      state.messages.push(action.payload)
      if (state.messages.length > MAX_MESSAGES_PER_SESSION) {
        state.messages = state.messages.slice(state.messages.length - MAX_MESSAGES_PER_SESSION)
      }
    },
    updateStreamingMessage(state, action: PayloadAction<string>) {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'streaming') { last.content = action.payload }
      else { state.messages.push({ role: 'streaming', content: action.payload, cls: 'msg msg-a' }) }
    },
    finalizeAssistant(state, action: PayloadAction<string | { content: string; ts?: string }>) {
      const payload = typeof action.payload === 'string' ? { content: action.payload } : action.payload
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'streaming') { last.role = 'assistant'; last.content = payload.content; if (payload.ts) last.ts = payload.ts }
      else { state.messages.push({ role: 'assistant', content: payload.content, cls: 'msg msg-a', ts: payload.ts }) }
    },
    removeThinking(state) { state.messages = state.messages.filter(m => m.role !== 'thinking') },
    setSlotRunning(state, action: PayloadAction<boolean>) { state.slotRunning = action.payload },
    setSlotStopping(state, action: PayloadAction<boolean>) { state.slotStopping = action.payload },
    setSlotState(state, action: PayloadAction<SlotState>) { state.slotState = action.payload },
    setContextUsage(state, action: PayloadAction<{ slot: string; usage: ContextUsage }>) {
      if (action.payload.slot === state.activeSlot) state.contextUsage = action.payload.usage
    },
    setExtensionStatus(state, action: PayloadAction<{ slot: string; key: string; text?: string }>) {
      if (action.payload.slot !== state.activeSlot) return
      if (action.payload.text) state.extensionStatuses[action.payload.key] = action.payload.text
      else delete state.extensionStatuses[action.payload.key]
    },
    clearMessages(state) { state.messages = []; state.slotHasMore = false; state.slotOldestIndex = 0 },
    /** Handle chat messages pushed via global SSE/WS (works after refresh). */
    sseChatMessage(state, action: PayloadAction<{ slot: string; role: string; content: string; ts?: string; cls?: string; meta?: Record<string, unknown>; seq?: number }>) {
      const { slot, role, content, ts, cls, meta } = action.payload
      if (slot !== state.activeSlot) return
      // WS chunk — accumulate into streaming message, preserve rawText
      if (role === 'chunk') {
        // Deduplicate chunks using monotonic seq from server
        const seq = (action.payload as any).seq
        if (typeof seq === 'number') {
          if (seq <= state._lastChunkSeq) return // already processed
          state._lastChunkSeq = seq
        }
        state.slotState = 'streaming'
        let streamIdx = -1
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'streaming') { streamIdx = i; break }
        }
        if (streamIdx >= 0) {
          const msg = state.messages[streamIdx]
          msg.content += content
          msg.rawText = msg.content
        } else {
          state.messages.push({ role: 'streaming', content, cls: 'msg msg-a', rawText: content })
        }
        return
      }
      // WS done — finalize streaming into assistant, rawText preserved for reparse
      if (role === '_done') {
        state.slotState = 'idle'
        state._lastChunkSeq = -1 // reset for next stream
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'streaming') {
            const msg = state.messages[i]
            msg.role = 'assistant'
            msg.rawText = msg.content
            break
          }
        }
        // Promote queued message to user and flag for re-send
        const qIdx = state.messages.findIndex(m => m.role === 'queued')
        if (qIdx >= 0) {
          state.messages[qIdx].role = 'user'
          state._resendQueued = state.messages[qIdx].content
        } else {
          state.slotRunning = false
        }
        state.slotStopping = false
        return
      }
      // Tool result — attach result to matching tool message
      if (role === '_tool_result') {
        const toolCallId = meta?.toolCallId
        if (toolCallId) {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const m = state.messages[i]
            if (m.role === 'tool' && (m.meta as any)?.toolCallId === toolCallId) {
              m.meta = { ...m.meta, result: meta?.result, isError: meta?.isError }
              break
            }
          }
        }
        return
      }
      // Tool call — update state; insert before streaming so agent text stays at bottom
      if (role === 'tool') {
        state.slotState = 'tool_running'
        const baseTitle = content.replace(/^🔧 /, '')
        // Search for consecutive tool messages, skipping trailing streaming message
        const last = state.messages[state.messages.length - 1]
        const searchFrom = last?.role === 'streaming' ? state.messages.length - 2 : state.messages.length - 1
        for (let i = searchFrom; i >= 0; i--) {
          const m = state.messages[i]
          if (m.role !== 'tool') break
          const existingTitle = m.content.replace(/^🔧 /, '').replace(/ ×\d+$/, '')
          if (existingTitle === baseTitle) {
            const match = m.content.match(/ ×(\d+)$/)
            const count = match ? parseInt(match[1]) + 1 : 2
            m.content = `🔧 ${baseTitle} ×${count}`
            return
          }
        }
      }
      // Replace streaming placeholder with final assistant message
      if (role === 'assistant') {
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'streaming') {
            state.messages[i].role = 'assistant'; state.messages[i].content = content; if (ts) state.messages[i].ts = ts
            return
          }
        }
      }
      // Keep streaming/assistant text at the bottom — insert other messages before it
      const newMsg = { role, content, cls: cls || '', ts, meta }
      const tail = state.messages[state.messages.length - 1]
      if (tail?.role === 'streaming') {
        state.messages.splice(state.messages.length - 1, 0, newMsg)
      } else {
        state.messages.push(newMsg)
      }
      // Trim to prevent unbounded memory growth
      if (state.messages.length > MAX_MESSAGES_PER_SESSION) {
        state.messages = state.messages.slice(state.messages.length - MAX_MESSAGES_PER_SESSION)
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchHistory.fulfilled, (state, action) => {
        const { sessions, hasMore, offset, append } = action.payload
        state.history = append ? [...state.history, ...sessions] : sessions
        state.historyHasMore = hasMore
        state.historyOffset = offset + sessions.length
      })
      .addCase(switchSlot.pending, (state, action) => {
        // Set activeSlot immediately so WS messages for the new slot aren't dropped
        // while the API fetch is in flight.
        const switchingSlot = action.meta.arg !== state.activeSlot
        state.activeSlot = action.meta.arg
        if (switchingSlot) {
          state.slotSwitching = true
          // Clear old slot's messages to avoid mixing content from two slots.
          // The fulfilled handler will restore messages from the API response,
          // which includes in-progress content from the backend's in-memory buffer.
          state.messages = []
          state.slotHasMore = false
          state.slotOldestIndex = 0
          state.contextUsage = null
          state.extensionStatuses = {}
        }
      })
      .addCase(switchSlot.fulfilled, (state, action) => {
        state.slotSwitching = false
        const { key, messages, running, hasMore, total } = action.payload
        // User may have switched again while this fetch was in flight
        if (state.activeSlot !== key) return
        // WS may have delivered messages during the fetch. The API response
        // is the authoritative snapshot. However, if WS delivered streaming
        // content that's more recent (longer), keep it.
        const lastLocal = state.messages[state.messages.length - 1]
        if (
          lastLocal?.role === 'streaming'
          && state.messages.length > messages.length
        ) {
          // WS is ahead — keep current messages, just update metadata
        } else {
          state.messages = messages
        }
        state.slotState = running ? state.slotState : 'idle'
        state.slotRunning = running
        state.slotStopping = action.payload.stopping ?? false
        state.slotHasMore = hasMore
        state.slotOldestIndex = hasMore ? total - messages.length : 0
        state.contextUsage = action.payload.contextUsage
      })
      .addCase(switchSlot.rejected, (state) => {
        state.slotSwitching = false
      })
      .addCase(refreshSlot.fulfilled, (state, action) => {
        if (!action.payload) return
        const { key, messages, running, hasMore, total } = action.payload
        if (state.activeSlot !== key) return  // user switched away
        state.messages = messages
        state.slotRunning = running
        state.slotStopping = action.payload.stopping ?? false
        state.slotHasMore = hasMore
        state.slotOldestIndex = hasMore ? total - messages.length : 0
        if (action.payload.contextUsage) state.contextUsage = action.payload.contextUsage
      })
      .addCase(createSlot.fulfilled, (state, action) => {
        state.activeSlot = action.payload.key
        state.messages = []
        state.slotRunning = false
        state.slotStopping = false
        state.slotState = 'idle'
        state.slotHasMore = false
        state.slotOldestIndex = 0
      })
      .addCase(deleteSlot.fulfilled, (state, action) => {
        if (state.activeSlot === action.payload) {
          state.activeSlot = null
          state.messages = []
        }
      })
      .addCase(resumeFromHistory.fulfilled, (state, action) => {
        if (action.payload.ok) {
          state.activeSlot = action.payload.key
          state.messages = action.payload.messages
          state.slotState = 'idle'
          state.slotHasMore = action.payload.hasMore
          state.slotOldestIndex = action.payload.hasMore ? action.payload.total - action.payload.messages.length : 0
        }
      })
      .addCase(deleteHistorySession.fulfilled, (state, action) => {
        state.history = state.history.filter(s => s.key !== action.payload)
      })
      .addCase(loadOlderMessages.pending, (state) => {
        state.loadingOlder = true
      })
      .addCase(loadOlderMessages.fulfilled, (state, action) => {
        state.loadingOlder = false
        if (action.payload) {
          state.messages = [...action.payload.messages, ...state.messages]
          state.slotHasMore = action.payload.hasMore
          state.slotOldestIndex = action.payload.hasMore ? action.payload.total - state.messages.length : 0
        }
      })
      .addCase(loadOlderMessages.rejected, (state) => {
        state.loadingOlder = false
      })
  },
})

export const {
  setActiveSlot, setPendingInput, clearResendQueued, promoteQueued, appendMessage, updateStreamingMessage, finalizeAssistant,
  removeThinking, setSlotRunning, setSlotStopping, setSlotState, setContextUsage, setExtensionStatus, clearMessages, sseChatMessage,
} = chatSlice.actions
export default chatSlice.reducer
