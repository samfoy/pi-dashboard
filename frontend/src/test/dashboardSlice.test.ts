import { describe, it, expect, vi } from 'vitest'
import reducer, {
  sseStatus,
  sseConnected,
  sseDisconnected,
  sseSlots,
  sseSlotTitle,
  addSlotOptimistic,
  removeSlotOptimistic,
  triggerRefresh,
  markSlotUnread,
  markSlotRead,
  fetchSlots,
} from '../store/dashboardSlice'
import type { StatusData, ChatSlot } from '../types'

vi.mock('../api/client', () => ({
  api: { chatSlots: vi.fn(), chatMode: vi.fn() },
}))

const slot1: ChatSlot = { key: 'chat-1', title: 'Chat 1', messages: 5, running: false }
const slot2: ChatSlot = { key: 'chat-2', title: 'Chat 2', messages: 3, running: true }

describe('dashboardSlice', () => {
  const initial = reducer(undefined, { type: '@@INIT' })

  it('has correct initial state', () => {
    expect(initial.status).toBeNull()
    expect(initial.connected).toBe(false)
    expect(initial.slots).toEqual([])
    expect(initial.approvalMode).toBe('normal')
    expect(initial.refreshTrigger).toBe(0)
    expect(initial.unreadSlots).toEqual([])
  })

  describe('sseStatus', () => {
    it('sets status and connected', () => {
      const status = { uptime: '1h', sessions: 2, messages: 10, cron_jobs: 0, subagents: 0, lessons: 0 } as StatusData
      const state = reducer(initial, sseStatus(status))
      expect(state.status).toEqual(status)
      expect(state.connected).toBe(true)
    })

    it('syncs yolo mode from backend', () => {
      const status = { uptime: '1h', sessions: 0, messages: 0, cron_jobs: 0, subagents: 0, lessons: 0, yolo: true } as StatusData
      const state = reducer(initial, sseStatus(status))
      expect(state.approvalMode).toBe('yolo')
    })

    it('reverts from yolo when backend says false', () => {
      const yoloState = { ...initial, approvalMode: 'yolo' }
      const status = { uptime: '1h', sessions: 0, messages: 0, cron_jobs: 0, subagents: 0, lessons: 0, yolo: false } as StatusData
      const state = reducer(yoloState, sseStatus(status))
      expect(state.approvalMode).toBe('normal')
    })
  })

  it('sseConnected sets connected true', () => {
    expect(reducer(initial, sseConnected()).connected).toBe(true)
  })

  it('sseDisconnected sets connected false', () => {
    const connected = { ...initial, connected: true }
    expect(reducer(connected, sseDisconnected()).connected).toBe(false)
  })

  it('sseSlots replaces slots', () => {
    const state = reducer(initial, sseSlots([slot1, slot2]))
    expect(state.slots).toHaveLength(2)
  })

  it('sseSlotTitle updates matching slot title', () => {
    const withSlots = reducer(initial, sseSlots([slot1, slot2]))
    const state = reducer(withSlots, sseSlotTitle({ key: 'chat-1', title: 'Renamed' }))
    expect(state.slots[0].title).toBe('Renamed')
    expect(state.slots[1].title).toBe('Chat 2')
  })

  it('addSlotOptimistic adds if not present', () => {
    const state = reducer(initial, addSlotOptimistic(slot1))
    expect(state.slots).toHaveLength(1)
    // Adding same key again should not duplicate
    const state2 = reducer(state, addSlotOptimistic(slot1))
    expect(state2.slots).toHaveLength(1)
  })

  it('removeSlotOptimistic removes by key', () => {
    const withSlots = reducer(initial, sseSlots([slot1, slot2]))
    const state = reducer(withSlots, removeSlotOptimistic('chat-1'))
    expect(state.slots).toHaveLength(1)
    expect(state.slots[0].key).toBe('chat-2')
  })

  it('removeSlotOptimistic also clears unread for removed slot', () => {
    let state = reducer(initial, sseSlots([slot1, slot2]))
    state = reducer(state, markSlotUnread('chat-1'))
    state = reducer(state, removeSlotOptimistic('chat-1'))
    expect(state.unreadSlots).toEqual([])
  })

  it('fetchSlots.fulfilled reconciles unreadSlots against live slots', () => {
    let state = reducer(initial, sseSlots([slot1, slot2]))
    state = reducer(state, markSlotUnread('chat-1'))
    state = reducer(state, markSlotUnread('chat-2'))
    // Simulate fetchSlots returning only slot2 (slot1 was deleted remotely)
    state = reducer(state, fetchSlots.fulfilled([slot2], 'requestId'))
    expect(state.unreadSlots).toEqual(['chat-2'])
  })

  it('triggerRefresh increments counter', () => {
    const state = reducer(initial, triggerRefresh())
    expect(state.refreshTrigger).toBe(1)
    const state2 = reducer(state, triggerRefresh())
    expect(state2.refreshTrigger).toBe(2)
  })

  describe('unread slots', () => {
    it('markSlotUnread adds slot key', () => {
      const state = reducer(initial, markSlotUnread('chat-1'))
      expect(state.unreadSlots).toEqual(['chat-1'])
    })

    it('markSlotUnread does not duplicate', () => {
      let state = reducer(initial, markSlotUnread('chat-1'))
      state = reducer(state, markSlotUnread('chat-1'))
      expect(state.unreadSlots).toEqual(['chat-1'])
    })

    it('markSlotRead removes slot key', () => {
      let state = reducer(initial, markSlotUnread('chat-1'))
      state = reducer(state, markSlotUnread('chat-2'))
      state = reducer(state, markSlotRead('chat-1'))
      expect(state.unreadSlots).toEqual(['chat-2'])
    })

    it('markSlotRead is a no-op for unknown key', () => {
      const state = reducer(initial, markSlotRead('nonexistent'))
      expect(state.unreadSlots).toEqual([])
    })
  })
})
