import { describe, it, expect, vi } from 'vitest'
import reducer, {
  setActiveSlot,
  appendMessage,
  updateStreamingMessage,
  finalizeAssistant,
  setSlotRunning,
  setSlotStopping,
  setSlotState,
  clearMessages,
  sseChatMessage,
  setContextUsage,
  setExtensionStatus,
} from '../store/chatSlice'

vi.mock('../api/client', () => ({
  api: {
    sessions: vi.fn(),
    chatSlotDetail: vi.fn(),
    createChatSlot: vi.fn(),
    deleteChatSlot: vi.fn(),
    resumeChatSlot: vi.fn(),
    deleteSession: vi.fn(),
    chatSlots: vi.fn(),
    chatMode: vi.fn(),
  },
}))

describe('chatSlice edge cases', () => {
  const initial = reducer(undefined, { type: '@@INIT' })

  it('setSlotState transitions through all states', () => {
    let state = reducer(initial, setSlotState('streaming'))
    expect(state.slotState).toBe('streaming')
    state = reducer(state, setSlotState('tool_running'))
    expect(state.slotState).toBe('tool_running')
    state = reducer(state, setSlotState('stopping'))
    expect(state.slotState).toBe('stopping')
    state = reducer(state, setSlotState('idle'))
    expect(state.slotState).toBe('idle')
  })

  it('setSlotStopping sets and clears', () => {
    let state = reducer(initial, setSlotStopping(true))
    expect(state.slotStopping).toBe(true)
    state = reducer(state, setSlotStopping(false))
    expect(state.slotStopping).toBe(false)
  })

  it('setSlotRunning sets and clears', () => {
    let state = reducer(initial, setSlotRunning(true))
    expect(state.slotRunning).toBe(true)
    state = reducer(state, setSlotRunning(false))
    expect(state.slotRunning).toBe(false)
  })

  it('appendMessage preserves existing messages', () => {
    let state = reducer(initial, appendMessage({ role: 'user', content: 'first', cls: '' }))
    state = reducer(state, appendMessage({ role: 'assistant', content: 'reply', cls: '' }))
    state = reducer(state, appendMessage({ role: 'user', content: 'second', cls: '' }))
    expect(state.messages).toHaveLength(3)
    expect(state.messages[0].content).toBe('first')
    expect(state.messages[2].content).toBe('second')
  })

  it('clearMessages does not affect activeSlot', () => {
    let state = reducer(initial, setActiveSlot('test-slot'))
    state = reducer(state, appendMessage({ role: 'user', content: 'hello', cls: '' }))
    state = reducer(state, clearMessages())
    expect(state.activeSlot).toBe('test-slot')
    expect(state.messages).toEqual([])
  })

  it('finalizeAssistant when no streaming message exists appends new assistant', () => {
    const state = reducer(initial, finalizeAssistant('direct reply'))
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('assistant')
    expect(state.messages[0].content).toBe('direct reply')
  })

  it('updateStreamingMessage replaces content fully', () => {
    let state = reducer(initial, updateStreamingMessage('line 1'))
    state = reducer(state, updateStreamingMessage('line 1\nline 2'))
    expect(state.messages[0].content).toBe('line 1\nline 2')
  })

  it('setActiveSlot to null clears active slot', () => {
    let state = reducer(initial, setActiveSlot('slot-1'))
    state = reducer(state, setActiveSlot(null))
    expect(state.activeSlot).toBeNull()
  })
})

describe('sseChatMessage edge cases', () => {
  const initial = reducer(undefined, { type: '@@INIT' })
  const withSlot = { ...initial, activeSlot: 'slot-1' }

  it('chunk with empty content creates streaming message', () => {
    const state = reducer(withSlot, sseChatMessage({ slot: 'slot-1', role: 'chunk', content: '' }))
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('streaming')
    expect(state.messages[0].content).toBe('')
  })

  it('user message is appended directly', () => {
    const state = reducer(withSlot, sseChatMessage({ slot: 'slot-1', role: 'user', content: 'hello' }))
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('user')
  })

  it('multiple _done calls are safe', () => {
    let state = reducer(withSlot, sseChatMessage({ slot: 'slot-1', role: 'chunk', content: 'text' }))
    state = reducer(state, sseChatMessage({ slot: 'slot-1', role: '_done', content: '' }))
    state = reducer(state, sseChatMessage({ slot: 'slot-1', role: '_done', content: '' }))
    expect(state.slotRunning).toBe(false)
    expect(state.slotState).toBe('idle')
  })

  it('permission message is appended', () => {
    const state = reducer(withSlot, sseChatMessage({ slot: 'slot-1', role: 'permission', content: 'Allow bash?' }))
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('permission')
  })

  it('tool dedup increments count on third call', () => {
    let state = reducer(withSlot, sseChatMessage({ slot: 'slot-1', role: 'tool', content: '🔧 bash' }))
    state = reducer(state, sseChatMessage({ slot: 'slot-1', role: 'tool', content: '🔧 bash' }))
    state = reducer(state, sseChatMessage({ slot: 'slot-1', role: 'tool', content: '🔧 bash' }))
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].content).toContain('×3')
  })

  it('different tools are not deduplicated', () => {
    let state = reducer(withSlot, sseChatMessage({ slot: 'slot-1', role: 'tool', content: '🔧 bash' }))
    state = reducer(state, sseChatMessage({ slot: 'slot-1', role: 'tool', content: '🔧 read' }))
    expect(state.messages).toHaveLength(2)
  })
})

describe('setContextUsage and setExtensionStatus', () => {
  const initial = reducer(undefined, { type: '@@INIT' })

  it('setContextUsage updates when slot matches', () => {
    let state = { ...initial, activeSlot: 'slot-1' }
    state = reducer(state, setContextUsage({ slot: 'slot-1', usage: { tokens: 5000, contextWindow: 200000, percent: 2.5 } }))
    expect(state.contextUsage).toEqual({ tokens: 5000, contextWindow: 200000, percent: 2.5 })
  })

  it('setContextUsage ignores when slot does not match', () => {
    let state = { ...initial, activeSlot: 'slot-1' }
    state = reducer(state, setContextUsage({ slot: 'slot-2', usage: { tokens: 5000, contextWindow: 200000, percent: 2.5 } }))
    expect(state.contextUsage).toBeNull()
  })

  it('setExtensionStatus updates when slot matches', () => {
    let state = { ...initial, activeSlot: 'slot-1' }
    state = reducer(state, setExtensionStatus({ slot: 'slot-1', key: 'lsp', text: 'running' }))
    expect(state.extensionStatuses).toEqual({ lsp: 'running' })
  })

  it('setExtensionStatus ignores when slot does not match', () => {
    let state = { ...initial, activeSlot: 'slot-1' }
    state = reducer(state, setExtensionStatus({ slot: 'slot-2', key: 'lsp', text: 'running' }))
    expect(state.extensionStatuses).toEqual({})
  })
})
