import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChatFooter from '../pages/chat/ChatFooter'

describe('ChatFooter', () => {
  it('returns null when not running', () => {
    const { container } = render(<ChatFooter running={false} stopping={false} state="" lastRole="" />)
    expect(container.innerHTML).toBe('')
  })

  it('returns null when streaming', () => {
    const { container } = render(<ChatFooter running={true} stopping={false} state="" lastRole="streaming" />)
    expect(container.innerHTML).toBe('')
  })

  it('shows stopping indicator', () => {
    render(<ChatFooter running={true} stopping={true} state="" lastRole="user" />)
    expect(screen.getByRole('status', { name: 'Stopping' })).toBeInTheDocument()
    expect(screen.getByText('Pulling from the oven…')).toBeInTheDocument()
  })

  it('shows tool running indicator', () => {
    render(<ChatFooter running={true} stopping={false} state="tool_running" lastRole="user" />)
    expect(screen.getByRole('status', { name: 'Running tool' })).toBeInTheDocument()
    expect(screen.getByText('Greasing the pan…')).toBeInTheDocument()
  })

  it('shows thinking label when running normally', () => {
    render(<ChatFooter running={true} stopping={false} state="" lastRole="user" />)
    expect(screen.getByRole('status', { name: 'Preheating the oven…' })).toBeInTheDocument()
  })
})
