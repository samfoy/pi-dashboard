import { describe, it, expect } from 'vitest'
import { groupToolMessages } from '../pages/chat/ToolGroup'
import type { ChatMessage } from '../types'

const msg = (role: string, content = ''): ChatMessage => ({ role, content, cls: '' })

describe('groupToolMessages', () => {
  it('returns empty array for empty input', () => {
    expect(groupToolMessages([])).toEqual([])
  })

  it('keeps non-tool messages as singles', () => {
    const msgs = [msg('user', 'hi'), msg('assistant', 'hello')]
    const result = groupToolMessages(msgs)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ type: 'single', index: 0, message: msgs[0] })
    expect(result[1]).toEqual({ type: 'single', index: 1, message: msgs[1] })
  })

  it('keeps 1-2 consecutive tool messages as singles', () => {
    const msgs = [msg('user'), msg('tool'), msg('tool'), msg('assistant')]
    const result = groupToolMessages(msgs)
    expect(result).toHaveLength(4)
    expect(result.every(r => r.type === 'single')).toBe(true)
  })

  it('groups 3+ consecutive tool messages', () => {
    const msgs = [msg('user'), msg('tool'), msg('tool'), msg('tool'), msg('assistant')]
    const result = groupToolMessages(msgs)
    expect(result).toHaveLength(3) // user, group, assistant
    expect(result[0].type).toBe('single')
    expect(result[1].type).toBe('group')
    if (result[1].type === 'group') {
      expect(result[1].tools).toHaveLength(3)
      expect(result[1].tools[0].index).toBe(1)
      expect(result[1].tools[2].index).toBe(3)
    }
    expect(result[2].type).toBe('single')
  })

  it('handles trailing tool group (no following non-tool)', () => {
    const msgs = [msg('user'), msg('tool'), msg('tool'), msg('tool')]
    const result = groupToolMessages(msgs)
    expect(result).toHaveLength(2) // user, group
    expect(result[1].type).toBe('group')
  })

  it('handles multiple tool groups interspersed', () => {
    const msgs = [
      msg('tool'), msg('tool'), msg('tool'), // group
      msg('assistant'),                       // single
      msg('tool'), msg('tool'), msg('tool'), msg('tool'), // group
    ]
    const result = groupToolMessages(msgs)
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe('group')
    expect(result[1].type).toBe('single')
    expect(result[2].type).toBe('group')
    if (result[2].type === 'group') {
      expect(result[2].tools).toHaveLength(4)
    }
  })

  it('preserves correct message indices', () => {
    const msgs = [msg('user'), msg('tool'), msg('tool'), msg('tool')]
    const result = groupToolMessages(msgs)
    if (result[1].type === 'group') {
      expect(result[1].tools.map(t => t.index)).toEqual([1, 2, 3])
    }
  })

  it('keeps exactly 2 trailing tools as singles', () => {
    const msgs = [msg('tool'), msg('tool')]
    const result = groupToolMessages(msgs)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('single')
    expect(result[1].type).toBe('single')
  })
})
