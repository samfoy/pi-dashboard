import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import McpInfoButton from '../pages/chat/McpInfoButton'

vi.mock('../api/client', () => ({
  api: {
    mcpActive: vi.fn().mockResolvedValue([
      { name: 'builder-mcp', enabled: true },
      { name: 'slack-mcp', enabled: false },
    ]),
  },
}))

describe('McpInfoButton', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders info button', () => {
    render(<McpInfoButton />)
    expect(screen.getByTitle('Session MCP servers')).toBeInTheDocument()
  })

  it('shows server list on click', async () => {
    render(<McpInfoButton />)
    fireEvent.click(screen.getByTitle('Session MCP servers'))
    await waitFor(() => {
      expect(screen.getByText('builder-mcp')).toBeInTheDocument()
      expect(screen.getByText('slack-mcp')).toBeInTheDocument()
    })
  })

  it('shows disabled label for disabled servers', async () => {
    render(<McpInfoButton />)
    fireEvent.click(screen.getByTitle('Session MCP servers'))
    await waitFor(() => {
      expect(screen.getByText('disabled')).toBeInTheDocument()
    })
  })

  it('closes on outside click', async () => {
    render(<McpInfoButton />)
    fireEvent.click(screen.getByTitle('Session MCP servers'))
    await waitFor(() => expect(screen.getByText('builder-mcp')).toBeInTheDocument())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('builder-mcp')).not.toBeInTheDocument()
  })
})
