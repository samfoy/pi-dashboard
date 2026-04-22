import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import { api } from '../api/client'
import type { StatusData, ChatSlot } from '../types'

interface DashboardState {
  status: StatusData | null
  connected: boolean
  slots: ChatSlot[]
  approvalMode: string
  refreshTrigger: number
  unreadSlots: string[]
  slotErrors: { slot: string; error: string; ts: string }[]
}

const initialState: DashboardState = {
  status: null,
  connected: false,
  slots: [],
  approvalMode: 'normal',
  refreshTrigger: 0,
  unreadSlots: [],
  slotErrors: [],
}

export const fetchSlots = createAsyncThunk('dashboard/fetchSlots', () => api.chatSlots())

export const changeApprovalMode = createAsyncThunk(
  'dashboard/changeApprovalMode',
  async ({ mode, slot }: { mode: string; slot?: string }) => {
    await api.chatMode(mode, slot)
    return mode
  },
)

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    sseStatus(state, action: PayloadAction<StatusData>) {
      state.status = action.payload
      state.connected = true
      // Sync YOLO from backend (authoritative source)
      if (action.payload.yolo !== undefined) {
        state.approvalMode = action.payload.yolo ? 'yolo' : (state.approvalMode === 'yolo' ? 'normal' : state.approvalMode)
      }
    },
    sseConnected(state) { state.connected = true },
    sseDisconnected(state) { state.connected = false },
    sseSlots(state, action: PayloadAction<ChatSlot[]>) { state.slots = action.payload },
    sseSlotTitle(state, action: PayloadAction<{ key: string; title: string }>) {
      const slot = state.slots.find(s => s.key === action.payload.key)
      if (slot) slot.title = action.payload.title
    },
    addSlotOptimistic(state, action: PayloadAction<ChatSlot>) {
      if (!state.slots.find(s => s.key === action.payload.key)) {
        state.slots.push(action.payload)
      }
    },
    removeSlotOptimistic(state, action: PayloadAction<string>) {
      state.slots = state.slots.filter(s => s.key !== action.payload)
      state.unreadSlots = state.unreadSlots.filter(k => k !== action.payload)
    },
    triggerRefresh(state) { state.refreshTrigger += 1 },
    markSlotUnread(state, action: PayloadAction<string>) {
      if (!state.unreadSlots.includes(action.payload)) state.unreadSlots.push(action.payload)
    },
    markSlotRead(state, action: PayloadAction<string>) {
      state.unreadSlots = state.unreadSlots.filter(k => k !== action.payload)
    },
    addSlotError(state, action: PayloadAction<{ slot: string; error: string }>) {
      state.slotErrors.push({ slot: action.payload.slot, error: action.payload.error, ts: new Date().toISOString() })
      // Keep last 20
      if (state.slotErrors.length > 20) state.slotErrors = state.slotErrors.slice(-20)
    },
    clearSlotErrors(state) {
      state.slotErrors = []
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSlots.fulfilled, (state, action) => {
        state.slots = action.payload
        const liveKeys = new Set(action.payload.map((s: { key: string }) => s.key))
        state.unreadSlots = state.unreadSlots.filter(k => liveKeys.has(k))
      })
      .addCase(changeApprovalMode.fulfilled, (state, action) => { state.approvalMode = action.payload })
  },
})

export const { sseStatus, sseConnected, sseDisconnected, sseSlots, sseSlotTitle, addSlotOptimistic, removeSlotOptimistic, triggerRefresh, markSlotUnread, markSlotRead, addSlotError, clearSlotErrors } = dashboardSlice.actions
export default dashboardSlice.reducer
