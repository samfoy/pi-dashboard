import { describe, it, expect, vi } from 'vitest'
import reducer, {
  sseStatus,
  sseSlots,
  sseSlotTitle,
  addSlotOptimistic,
  removeSlotOptimistic,
  changeApprovalMode,
} from '../store/dashboardSlice'
import type { StatusData, ChatSlot } from '../types'

vi.mock('../api/client', () => ({
  api: { chatSlots: vi.fn(), chatMode: vi.fn().mockResolvedValue({}) },
}))

describe('dashboardSlice edge cases', () => {
  const initial = reducer(undefined, { type: '@@INIT' })

  describe('sseStatus', () => {
    it('preserves existing approvalMode when yolo is undefined', () => {
      const customMode = { ...initial, approvalMode: 'custom' }
      const status = { uptime: '1h', sessions: 0, messages: 0, cron_jobs: 0, subagents: 0, lessons: 0 } as StatusData
      const state = reducer(customMode, sseStatus(status))
      expect(state.approvalMode).toBe('custom')
    })

    it('preserves non-yolo mode when backend says yolo=false', () => {
      const customMode = { ...initial, approvalMode: 'custom' }
      const status = { uptime: '1h', sessions: 0, messages: 0, cron_jobs: 0, subagents: 0, lessons: 0, yolo: false } as StatusData
      const state = reducer(customMode, sseStatus(status))
      // Should keep 'custom' since it's not 'yolo'
      expect(state.approvalMode).toBe('custom')
    })

    it('sets all status fields', () => {
      const status: StatusData = {
        uptime: '2h 30m',
        sessions: 5,
        messages: 100,
        cron_jobs: 3,
        subagents: 2,
        lessons: 10,
        tool_calls: 50,
        version: '1.2.3',
        platform: 'linux',
      }
      const state = reducer(initial, sseStatus(status))
      expect(state.status).toEqual(status)
      expect(state.connected).toBe(true)
    })
  })

  describe('sseSlots', () => {
    it('replaces all slots', () => {
      const slot1: ChatSlot = { key: 'a', title: 'A', messages: 1, running: false }
      const slot2: ChatSlot = { key: 'b', title: 'B', messages: 2, running: true }
      let state = reducer(initial, sseSlots([slot1]))
      expect(state.slots).toHaveLength(1)
      state = reducer(state, sseSlots([slot1, slot2]))
      expect(state.slots).toHaveLength(2)
      state = reducer(state, sseSlots([]))
      expect(state.slots).toHaveLength(0)
    })
  })

  describe('sseSlotTitle', () => {
    it('no-op when key not found', () => {
      const slot: ChatSlot = { key: 'a', title: 'A', messages: 1, running: false }
      const state = reducer(reducer(initial, sseSlots([slot])), sseSlotTitle({ key: 'nonexistent', title: 'New' }))
      expect(state.slots[0].title).toBe('A')
    })
  })

  describe('addSlotOptimistic', () => {
    it('adds multiple different slots', () => {
      const s1: ChatSlot = { key: 'a', title: 'A', messages: 0, running: false }
      const s2: ChatSlot = { key: 'b', title: 'B', messages: 0, running: false }
      let state = reducer(initial, addSlotOptimistic(s1))
      state = reducer(state, addSlotOptimistic(s2))
      expect(state.slots).toHaveLength(2)
    })
  })

  describe('removeSlotOptimistic', () => {
    it('no-op when key not found', () => {
      const slot: ChatSlot = { key: 'a', title: 'A', messages: 1, running: false }
      const state = reducer(reducer(initial, sseSlots([slot])), removeSlotOptimistic('nonexistent'))
      expect(state.slots).toHaveLength(1)
    })
  })

  describe('changeApprovalMode', () => {
    it('fulfilled updates approval mode', () => {
      const state = reducer(initial, changeApprovalMode.fulfilled('yolo', 'req', { mode: 'yolo' }))
      expect(state.approvalMode).toBe('yolo')
    })

    it('fulfilled switches to normal', () => {
      const yoloState = { ...initial, approvalMode: 'yolo' }
      const state = reducer(yoloState, changeApprovalMode.fulfilled('normal', 'req', { mode: 'normal' }))
      expect(state.approvalMode).toBe('normal')
    })
  })
})
