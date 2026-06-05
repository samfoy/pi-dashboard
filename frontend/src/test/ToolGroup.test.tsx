import { describe, it, expect } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from './helpers'
import type { ChatMessage } from '../types'
import ToolGroup from '../pages/chat/ToolGroup'
import ToolCallBlock from '../pages/chat/ToolCallBlock'

const tool = (toolName: string, args: unknown, result = 'ok'): ChatMessage => ({
  role: 'tool',
  content: `🔧 ${toolName}`,
  cls: '',
  meta: {
    toolName,
    args: JSON.stringify(args),
    result,
  },
})

describe('ToolGroup', () => {
  it('does not crash when expanding a grouped edit call with malformed edit entries', () => {
    const tools = [
      { index: 0, message: tool('read', { path: '/tmp/a.ts' }) },
      { index: 1, message: tool('edit', { path: '/tmp/a.ts', edits: [{ oldText: 'a', newText: 'b' }, { newText: 'missing oldText' }] }) },
      { index: 2, message: tool('bash', { command: 'echo ok' }) },
    ]

    renderWithProviders(
      <ToolGroup
        tools={tools}
        renderTool={(i, m) => <ToolCallBlock key={i} content={m.content} meta={m.meta} />}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /expand tool calls/i }))

    expect(screen.getByText('✏️ edit')).toBeTruthy()
  })

  it('ignores non-string paths in grouped tool summaries', () => {
    const tools = [
      { index: 0, message: tool('read', { path: { nested: true } }) },
      { index: 1, message: tool('write', { path: '/tmp/a.ts', content: 'x' }) },
      { index: 2, message: tool('bash', { command: 'echo ok' }) },
    ]

    renderWithProviders(
      <ToolGroup
        tools={tools}
        renderTool={(i, m) => <ToolCallBlock key={i} content={m.content} meta={m.meta} />}
      />,
    )

    expect(screen.getByRole('button', { name: /expand tool calls/i })).toBeTruthy()
  })
})
