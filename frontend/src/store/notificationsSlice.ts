import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import { api } from '../api/client'
import type { Notification } from '../types'

interface NotificationsState {
  items: Notification[]
}

const initialState: NotificationsState = { items: [] }

export const fetchNotifications = createAsyncThunk(
  'notifications/fetch',
  async () => { const d = await api.notifications(); return (d.notifications || []) as Notification[] },
)

export const clearNotifications = createAsyncThunk(
  'notifications/clear',
  async () => { await api.clearNotifications() },
)

export const deleteNotification = createAsyncThunk(
  'notifications/delete',
  async (ts: string) => { await api.deleteNotification(ts); return ts },
)

export const ackNotification = createAsyncThunk(
  'notifications/ack',
  async (ts: string) => { api.ackNotification(ts).catch(() => {}); return ts },
)

export const unackNotification = createAsyncThunk(
  'notifications/unack',
  async (ts: string) => { api.unackNotification(ts).catch(() => {}); return ts },
)

export const ackAllNotifications = createAsyncThunk(
  'notifications/ackAll',
  async () => { api.ackAllNotifications().catch(() => {}) },
)

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    addNotification(state, action: PayloadAction<Notification>) {
      state.items.push(action.payload)
    },
    ackNotificationByTs(state, action: PayloadAction<string>) {
      state.items = state.items.map(n =>
        n.ts === action.payload ? { ...n, acked: true } : n
      )
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNotifications.fulfilled, (state, action) => { state.items = action.payload })
      .addCase(clearNotifications.fulfilled, (state) => { state.items = [] })
      .addCase(deleteNotification.fulfilled, (state, action) => {
        state.items = state.items.filter(n => n.ts !== action.payload)
      })
      // Optimistic: update Redux immediately, fire-and-forget to backend
      .addCase(ackNotification.pending, (state, action) => {
        const n = state.items.find(i => i.ts === action.meta.arg)
        if (n) n.acked = true
      })
      .addCase(unackNotification.pending, (state, action) => {
        const n = state.items.find(i => i.ts === action.meta.arg)
        if (n) n.acked = false
      })
      .addCase(ackAllNotifications.pending, (state) => {
        for (const n of state.items) n.acked = true
      })
  },
})

export const { addNotification, ackNotificationByTs } = notificationsSlice.actions
export default notificationsSlice.reducer
